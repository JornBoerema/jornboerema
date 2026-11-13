//! The open note: its title (components/inline-name.tsx) and its text with
//! saving as you type (components/note-editor.tsx). The draft is kept on disk
//! until the server has it, saved 600 ms after the last change, and held back
//! with a choice when the note was changed elsewhere in the meantime.

use std::path::PathBuf;
use std::time::Duration;

use gpui_kit::component::input::{Input, InputEvent, InputState};
use gpui_kit::prelude::*;
use gpui_kit::*;
use serde::{Deserialize, Serialize};

use crate::app::AppEvent;
use crate::i18n::t;
use crate::{theme, ui};

use super::api::{self, Command, Failure, ListRole, MAX_NOTE};
use super::body::NoteBody;
use super::{parts, Menu, Nav, NotesApp, Overlay};

/// The web saves this long after the last keystroke.
const SAVE_AFTER: Duration = Duration::from_millis(600);

/// A note's title holds this many characters.
pub(super) const MAX_NAME: usize = 80;

pub(super) struct Editor {
    pub(super) list_id: String,
    pub(super) body: NoteBody,
    /// The text on screen, the text the server has, and the server's version of it.
    markdown: String,
    saved: String,
    version: u64,
    can_edit: bool,
    in_flight: bool,
    /// Saving waits for the user to choose between their draft and the newer version.
    blocked: bool,
    conflict: bool,
    error: Option<SharedString>,
    timer: Option<Task<()>>,
    /// Where to go once the draft is saved.
    pub(super) after_save: Option<Nav>,
    _changes: Subscription,
}

impl Editor {
    fn dirty(&self) -> bool {
        self.markdown != self.saved
    }

    /// For a picture of the conflict notice (see `show_for_a_picture`).
    #[cfg(debug_assertions)]
    pub(super) fn show_conflict(&mut self) {
        self.conflict = true;
        self.error = Some(remote_changed());
    }
}

/// The title while it is being renamed.
pub(super) struct Naming {
    input: Entity<InputState>,
    error: Option<SharedString>,
    /// The rename on its way to the server.
    waiting: Option<u64>,
    _events: Subscription,
}

fn remote_changed() -> SharedString {
    t(
        "This note was changed elsewhere. Your draft is kept.",
        "Deze notitie is elders gewijzigd. Je concept blijft bewaard.",
    )
    .into()
}

fn save_failed_draft() -> String {
    t(
        "Saving didn't work. Your draft is kept here.",
        "Opslaan is niet gelukt. Je concept blijft hier bewaard.",
    )
    .to_string()
}

// The draft on disk: the web's localStorage entry `even-doen:note-draft:<user>:<note>`.

#[derive(Serialize, Deserialize)]
struct Draft {
    markdown: String,
    version: u64,
}

fn draft_file(user: &str, list: &str) -> Option<PathBuf> {
    let safe = |text: &str| -> String {
        text.chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
            .collect()
    };
    Some(
        crate::auth::data_dir()?
            .join("note-drafts")
            .join(format!("{}-{}.json", safe(user), safe(list))),
    )
}

/// Keeps the draft, or with `None` forgets it: the server has the text.
fn store_draft(user: &str, list: &str, draft: Option<Draft>) {
    let Some(path) = draft_file(user, list) else { return };
    match draft {
        None => {
            let _ = std::fs::remove_file(path);
        }
        Some(draft) => {
            if let Some(dir) = path.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            if let Ok(bytes) = serde_json::to_vec(&draft) {
                let _ = std::fs::write(path, bytes);
            }
        }
    }
}

fn stored_draft(user: &str, list: &str) -> Option<Draft> {
    serde_json::from_slice(&std::fs::read(draft_file(user, list)?).ok()?).ok()
}

/// As JavaScript counts a string's length, which is what the API checks.
fn length(text: &str) -> usize {
    text.encode_utf16().count()
}

/// `download` in note-editor.tsx: the title without what a file name can't hold.
fn file_name(title: &str) -> String {
    let name: String = title
        .chars()
        .filter(|c| c.is_alphanumeric() || matches!(c, ' ' | '_' | '-'))
        .collect();
    if name.is_empty() {
        t("note", "notitie").to_string()
    } else {
        name
    }
}

impl NotesApp {
    // The text.

    pub(super) fn open_editor(&mut self, id: &str, window: &mut Window, cx: &mut Context<Self>) {
        let Some(list) = self.view.iter().find(|note| note.id == id) else {
            return;
        };
        let can_edit = list.role != ListRole::Viewer;
        let markdown = list.markdown().to_string();
        let version = list.note.as_ref().map_or(0, |note| note.version);
        let body = NoteBody::new(&markdown, can_edit, window, cx);
        let changes = body.on_change(window, cx, |this, window, cx| this.body_changed(window, cx));
        let mut editor = Editor {
            list_id: id.to_string(),
            body,
            saved: markdown.clone(),
            markdown,
            version,
            can_edit,
            in_flight: false,
            blocked: false,
            conflict: false,
            error: None,
            timer: None,
            after_save: None,
            _changes: changes,
        };
        // A draft that never reached the server comes back.
        let mut resume = false;
        if can_edit {
            if let Some(draft) = stored_draft(&self.user.id, id) {
                if length(&draft.markdown) <= MAX_NOTE && draft.markdown != editor.saved {
                    editor.body.set_markdown(&draft.markdown, window, cx);
                    editor.markdown = draft.markdown;
                    if draft.version != editor.version {
                        editor.blocked = true;
                        editor.conflict = true;
                        editor.error = Some(
                            t(
                                "There is a local draft and a newer version. Choose which text you want to keep.",
                                "Er is een lokaal concept en een nieuwere versie. Kies welke tekst je wilt bewaren.",
                            )
                            .into(),
                        );
                    } else {
                        resume = true;
                    }
                }
            }
        }
        self.editor = Some(editor);
        if resume {
            self.save(window, cx);
        }
    }

    /// The note leaves the screen. What is not saved yet is sent once more;
    /// the draft on disk stays until that has worked.
    pub(super) fn close_editor(&mut self, cx: &mut Context<Self>) {
        let Some(editor) = self.editor.take() else { return };
        let exists = self.view.iter().any(|note| note.id == editor.list_id);
        if !editor.dirty() || editor.blocked || !editor.can_edit || !exists || length(&editor.markdown) > MAX_NOTE {
            return;
        }
        let Some(workspace) = self.active.clone() else { return };
        let (client, user) = (self.client.clone(), self.user.id.clone());
        let command = Command::UpdateNote {
            id: editor.list_id.clone(),
            markdown: editor.markdown.clone(),
            version: editor.version,
        };
        let list_id = editor.list_id.clone();
        cx.background_executor()
            .spawn(async move {
                if api::run(&client, &workspace, &command).is_ok() {
                    store_draft(&user, &list_id, None);
                }
            })
            .detach();
    }

    fn persist(&self) {
        let Some(editor) = &self.editor else { return };
        let draft = editor.dirty().then(|| Draft {
            markdown: editor.markdown.clone(),
            version: editor.version,
        });
        store_draft(&self.user.id, &editor.list_id, draft);
    }

    fn body_changed(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(editor) = &mut self.editor else { return };
        let text = editor.body.markdown(cx);
        if text == editor.markdown {
            return;
        }
        editor.markdown = text;
        // A new timer replaces the one running: the save waits for a pause in the typing.
        editor.timer = Some(cx.spawn_in(window, async move |this, cx| {
            cx.background_executor().timer(SAVE_AFTER).await;
            let _ = this.update_in(cx, |this, window, cx| this.save(window, cx));
        }));
        self.persist();
    }

    /// `save` in note-editor.tsx: sends the draft until the server has what is
    /// on screen. How it ended reaches `save_ended`.
    pub(super) fn save(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let online = self.online;
        let Some(workspace) = self.active.clone() else { return };
        let Some(editor) = &mut self.editor else { return };
        // The save under way sends what was typed since, too.
        if editor.in_flight {
            return;
        }
        if editor.blocked {
            return self.save_ended(false, window, cx);
        }
        if !editor.dirty() {
            return self.save_ended(true, window, cx);
        }
        if !editor.can_edit {
            return self.save_ended(false, window, cx);
        }
        let refused = if !online {
            Some(t(
                "You're offline. Your draft is kept here; reconnect to save.",
                "Je bent offline. Je concept blijft hier bewaard; verbind opnieuw om op te slaan.",
            ))
        } else if length(&editor.markdown) > MAX_NOTE {
            Some(t(
                "This note is too long. Use at most 100,000 characters.",
                "Deze notitie is te lang. Gebruik maximaal 100.000 tekens.",
            ))
        } else {
            None
        };
        if let Some(message) = refused {
            editor.error = Some(message.into());
            self.persist();
            return self.save_ended(false, window, cx);
        }
        editor.in_flight = true;
        editor.error = None;
        let (list_id, markdown, version) = (editor.list_id.clone(), editor.markdown.clone(), editor.version);
        let command = Command::UpdateNote {
            id: list_id.clone(),
            markdown: markdown.clone(),
            version,
        };
        let client = self.client.clone();
        let sent = command.clone();
        let task = cx
            .background_executor()
            .spawn(async move { api::run(&client, &workspace, &sent) });
        cx.spawn_in(window, async move |this, cx| {
            let result = task.await;
            let _ = this.update_in(cx, |this, window, cx| {
                let Some(editor) = this.editor.as_mut().filter(|editor| editor.list_id == list_id) else {
                    return;
                };
                editor.in_flight = false;
                match result {
                    Ok(()) => {
                        editor.saved = markdown;
                        editor.version = version + 1;
                        let more = editor.dirty();
                        this.online = true;
                        api::apply(&mut this.lists, &command);
                        this.recompute();
                        this.persist();
                        if more {
                            this.save(window, cx);
                        } else {
                            this.fetch(window, cx);
                            this.save_ended(true, window, cx);
                        }
                    }
                    Err(error) => {
                        let message = match api::failure(&error) {
                            Failure::SignedOut => return cx.emit(AppEvent::SignedOut),
                            Failure::Offline => {
                                this.online = false;
                                save_failed_draft()
                            }
                            Failure::Conflict(message) => {
                                editor.blocked = true;
                                editor.conflict = true;
                                message.unwrap_or_else(save_failed_draft)
                            }
                            Failure::Gone(message) | Failure::Other(message) => {
                                message.unwrap_or_else(save_failed_draft)
                            }
                        };
                        if let Some(editor) = &mut this.editor {
                            editor.error = Some(message.into());
                        }
                        this.persist();
                        this.save_ended(false, window, cx);
                    }
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }

    /// The save is over: on to where the user was going, if it worked.
    fn save_ended(&mut self, ok: bool, window: &mut Window, cx: &mut Context<Self>) {
        let nav = self.editor.as_mut().and_then(|editor| editor.after_save.take());
        if let (true, Some(nav)) = (ok, nav) {
            self.show(nav, window, cx);
        }
        cx.notify();
    }

    /// The notes came in again: a newer version of the open one replaces the
    /// text, unless there is a draft; then the user chooses.
    pub(super) fn incoming(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(editor) = &mut self.editor else { return };
        let Some(list) = self.lists.iter().find(|list| list.id == editor.list_id) else {
            return;
        };
        editor.can_edit = list.role != ListRole::Viewer;
        editor.body.set_editable(editor.can_edit);
        let Some(note) = &list.note else { return };
        if note.version <= editor.version || editor.in_flight {
            return;
        }
        if editor.dirty() {
            editor.blocked = true;
            editor.conflict = true;
            editor.error = Some(remote_changed());
        } else {
            editor.markdown = note.markdown.clone();
            editor.saved = note.markdown.clone();
            editor.version = note.version;
            editor.body.set_markdown(&note.markdown, window, cx);
        }
    }

    /// `resolveConflict`: the newest version from the server, then either it
    /// or the draft on top of it.
    fn resolve_conflict(&mut self, keep_local: bool, window: &mut Window, cx: &mut Context<Self>) {
        let Some(workspace) = self.active.clone() else { return };
        let Some(list_id) = self.editor.as_ref().map(|editor| editor.list_id.clone()) else {
            return;
        };
        let client = self.client.clone();
        let task = cx
            .background_executor()
            .spawn(async move { api::workspace(&client, &workspace) });
        cx.spawn_in(window, async move |this, cx| {
            let result = task.await;
            let _ = this.update_in(cx, |this, window, cx| {
                let Some(editor) = this.editor.as_mut().filter(|editor| editor.list_id == list_id) else {
                    return;
                };
                let latest = match result {
                    Ok(data) => data.lists.into_iter().find(|list| list.id == list_id),
                    Err(error) => {
                        if matches!(api::failure(&error), Failure::SignedOut) {
                            return cx.emit(AppEvent::SignedOut);
                        }
                        editor.error = Some(
                            t(
                                "The latest version couldn't be loaded.",
                                "De nieuwste versie kon niet worden opgehaald.",
                            )
                            .into(),
                        );
                        return cx.notify();
                    }
                };
                let note = latest
                    .filter(|list| list.role != ListRole::Viewer)
                    .and_then(|list| list.note);
                let Some(note) = note else {
                    editor.error = Some(
                        t(
                            "You no longer have edit rights. You can download your draft.",
                            "Je hebt geen bewerkrechten meer. Je kunt je concept downloaden.",
                        )
                        .into(),
                    );
                    return cx.notify();
                };
                editor.version = note.version;
                if !keep_local {
                    editor.body.set_markdown(&note.markdown, window, cx);
                    editor.markdown = note.markdown.clone();
                }
                editor.saved = note.markdown;
                editor.blocked = false;
                editor.conflict = false;
                editor.error = None;
                this.persist();
                if keep_local {
                    this.save(window, cx);
                }
                cx.notify();
            });
        })
        .detach();
    }

    /// "Download .md": the web hands the browser a file; here it goes to
    /// Downloads, as the mail's attachments do.
    fn download(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let (Some(editor), Some(note)) = (&self.editor, self.selected_note()) else {
            return;
        };
        let (markdown, name) = (editor.markdown.clone(), file_name(&note.name));
        let task = cx.background_executor().spawn(async move {
            let dir = dirs::download_dir()
                .or_else(|| dirs::home_dir().map(|home| home.join("Downloads")))
                .ok_or_else(|| anyhow::anyhow!("no Downloads folder"))?;
            std::fs::create_dir_all(&dir)?;
            // Never over a file that is already there.
            let mut path = dir.join(format!("{name}.md"));
            let mut count = 1;
            while path.exists() {
                count += 1;
                path = dir.join(format!("{name} {count}.md"));
            }
            std::fs::write(&path, markdown)?;
            anyhow::Ok(path.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_default())
        });
        cx.spawn_in(window, async move |this, cx| {
            let result = task.await;
            let _ = this.update_in(cx, |_, window, cx| match result {
                Ok(file) => ui::toast(
                    t(format!("{file} is in Downloads"), format!("{file} staat in Downloads")),
                    window,
                    cx,
                ),
                Err(_) => ui::toast_error(t("Please try again.", "Probeer opnieuw."), window, cx),
            });
        })
        .detach();
    }

    // The title.

    /// Double-click on the title: it becomes a field with the name selected.
    pub(super) fn start_naming(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(note) = self.selected_note() else { return };
        if self.disabled() || note.role != ListRole::Owner || self.naming.is_some() {
            return;
        }
        let name = note.name.clone();
        let input = cx.new(|cx| InputState::new(window, cx).default_value(name));
        input.update(cx, |input, cx| {
            input.focus(window, cx);
            input.select_all(window, cx);
        });
        let events = cx.subscribe_in(&input, window, |this, _, event: &InputEvent, window, cx| match event {
            InputEvent::PressEnter { .. } | InputEvent::Blur => this.save_naming(window, cx),
            InputEvent::Change => {
                if let Some(naming) = &mut this.naming {
                    naming.error = None;
                    cx.notify();
                }
            }
            InputEvent::Focus => {}
        });
        self.naming = Some(Naming {
            input,
            error: None,
            waiting: None,
            _events: events,
        });
        cx.notify();
    }

    fn save_naming(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(current) = self.selected_note().map(|note| (note.id.clone(), note.name.clone())) else {
            return;
        };
        let disabled = self.disabled();
        let Some(naming) = &mut self.naming else { return };
        if naming.waiting.is_some() || disabled {
            return;
        }
        let text = naming
            .input
            .read(cx)
            .value()
            .split('\n')
            .map(str::trim)
            .collect::<Vec<_>>()
            .join(" ")
            .trim()
            .to_string();
        let problem = if length(&text) > MAX_NAME {
            Some(t(
                format!("Use at most {MAX_NAME} characters."),
                format!("Gebruik maximaal {MAX_NAME} tekens."),
            ))
        } else if text.is_empty() {
            Some(t("Enter a name.", "Vul een naam in.").to_string())
        } else {
            None
        };
        if let Some(problem) = problem {
            naming.error = Some(problem.into());
            let input = naming.input.clone();
            input.update(cx, |input, cx| input.focus(window, cx));
            return cx.notify();
        }
        if text == current.1 {
            return self.cancel_naming(window, cx);
        }
        let seq = self.run(
            Command::RenameList {
                id: current.0,
                name: text,
            },
            window,
            cx,
        );
        if let Some(naming) = &mut self.naming {
            match seq {
                Some(seq) => naming.waiting = Some(seq),
                None => naming.error = Some(naming_failed()),
            }
        }
        cx.notify();
    }

    pub(super) fn cancel_naming(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.naming.take().is_some() {
            window.focus(&self.focus, cx);
            cx.notify();
        }
    }

    /// A change reached the server, or didn't: the title's field closes or says so.
    pub(super) fn command_finished(&mut self, seq: u64, ok: bool, window: &mut Window, cx: &mut Context<Self>) {
        let Some(naming) = &mut self.naming else { return };
        if naming.waiting != Some(seq) {
            return;
        }
        if ok {
            self.cancel_naming(window, cx);
        } else {
            naming.waiting = None;
            naming.error = Some(naming_failed());
        }
    }

    // The page.

    /// The open note: its title with the share and options buttons, what went
    /// wrong with saving if anything did, and the text.
    pub(super) fn render_note(&self, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let (Some(note), Some(editor)) = (self.selected_note(), &self.editor) else {
            return Vec::new();
        };
        let disabled = self.disabled();
        let owner = note.role == ListRole::Owner;
        let can_rename = owner && !disabled;

        let title: AnyElement = match &self.naming {
            Some(naming) => div()
                .flex()
                .flex_col()
                .child(
                    // The field keeps 10 before its text; taken back, so the name stays where it was.
                    heading().ml(px(-10.)).child(
                        Input::new(&naming.input)
                            .appearance(false)
                            .h(px(40.))
                            .text_size(px(28.))
                            .line_height(relative(1.3))
                            .font_weight(FontWeight::SEMIBOLD),
                    ),
                )
                .when_some(naming.error.clone(), |el, error| {
                    el.child(div().text_size(px(14.)).text_color(theme::danger()).child(error))
                })
                .into_any_element(),
            None => heading()
                .id("note-title")
                .child(note.name.clone())
                .when(can_rename, |el| {
                    el.tooltip(ui::tip(t("Double-click to edit", "Dubbelklik om te bewerken")))
                        .on_click(cx.listener(|this, event: &ClickEvent, window, cx| {
                            if event.click_count() == 2 {
                                this.start_naming(window, cx);
                            }
                        }))
                })
                .into_any_element(),
        };

        let share_label = t("Share note", "Notitie delen");
        let buttons = div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(4.))
            .when(owner, |el| {
                el.child(
                    parts::icon_button("share-note", "share-08")
                        .tooltip(ui::tip(share_label))
                        .when(disabled, ui::disabled)
                        .when(!disabled, |el| {
                            el.on_click(cx.listener(|this, _, window, cx| this.open_share(window, cx)))
                        }),
                )
            })
            .child(
                div()
                    .relative()
                    .child(
                        parts::icon_button("note-options", "more-horizontal")
                            .when(self.menu == Some(Menu::NoteOptions), |el| el.bg(theme::muted_bg()))
                            .when(disabled, ui::disabled)
                            .when(!disabled, |el| {
                                el.on_click(cx.listener(|this, _, _, cx| this.toggle_menu(Menu::NoteOptions, cx)))
                            }),
                    )
                    .when(self.menu == Some(Menu::NoteOptions), |el| {
                        el.child(self.render_note_options(owner, cx))
                    }),
            );

        let mut page = vec![div()
            .flex()
            .flex_none()
            .items_start()
            .justify_between()
            .gap(px(16.))
            .mb(px(20.))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .child(title)
                    .when(note.role == ListRole::Viewer, |el| {
                        el.child(
                            div()
                                .mt(px(8.))
                                .text_size(px(13.))
                                .text_color(theme::muted())
                                .child(t("Read only", "Alleen lezen")),
                        )
                    }),
            )
            .child(buttons)
            .into_any_element()];
        if let Some(error) = &editor.error {
            page.push(self.render_save_error(error.clone(), editor.conflict, cx).into_any_element());
        }
        page.push(editor.body.render().into_any_element());
        page
    }

    /// The menu under the three dots: download, and for the owner, delete.
    fn render_note_options(&self, owner: bool, cx: &mut Context<Self>) -> impl IntoElement {
        deferred(
            div()
                .absolute()
                .top(px(36.))
                .right_0()
                .occlude()
                .on_mouse_down_out(cx.listener(|this, _, _, cx| this.close_menu(cx)))
                .child(
                    parts::menu_panel()
                        .min_w(px(160.))
                        .child(
                            parts::menu_item("download-note", false)
                                .child(theme::hi("download-04").text_color(theme::muted()))
                                .child(div().whitespace_nowrap().child("Download .md"))
                                .on_click(cx.listener(|this, _, window, cx| {
                                    this.close_menu(cx);
                                    this.download(window, cx);
                                })),
                        )
                        .when(owner, |el| {
                            el.child(
                                parts::menu_item("delete-note", true)
                                    .child(theme::hi("delete-02").text_color(theme::danger()))
                                    .child(
                                        div()
                                            .whitespace_nowrap()
                                            .child(t("Delete note", "Notitie verwijderen")),
                                    )
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.close_menu(cx);
                                        if let Some((id, title)) =
                                            this.selected_note().map(|note| (note.id.clone(), note.name.clone()))
                                        {
                                            this.overlay = Some(Overlay::Delete { id, title });
                                        }
                                        cx.notify();
                                    })),
                            )
                        }),
                ),
        )
        .with_priority(1)
    }

    /// Above the text when saving went wrong: what happened and the ways out.
    fn render_save_error(&self, error: SharedString, conflict: bool, cx: &mut Context<Self>) -> impl IntoElement {
        let choice = |id: &'static str, label: &'static str| {
            ui::button_sm(id, label, ui::Variant::Outline).text_color(theme::foreground())
        };
        let ways = div()
            .flex()
            .flex_wrap()
            .gap(px(8.))
            .mt(px(8.))
            .when(conflict, |el| {
                el.child(
                    choice("use-latest", t("Use latest version", "Nieuwste versie gebruiken"))
                        .on_click(cx.listener(|this, _, window, cx| this.resolve_conflict(false, window, cx))),
                )
                .child(
                    choice("keep-mine", t("Keep my draft", "Mijn concept bewaren"))
                        .on_click(cx.listener(|this, _, window, cx| this.resolve_conflict(true, window, cx))),
                )
            })
            .when(!conflict, |el| {
                el.child(
                    choice("save-again", t("Save again", "Opnieuw opslaan"))
                        .on_click(cx.listener(|this, _, window, cx| this.save(window, cx))),
                )
            })
            .child(
                choice("download-draft", t("Download draft", "Download concept"))
                    .on_click(cx.listener(|this, _, window, cx| this.download(window, cx))),
            );
        parts::alert(None, div().child(error).child(ways), true)
    }
}

fn naming_failed() -> SharedString {
    t(
        "Saving didn't work. Please try again.",
        "Opslaan is niet gelukt. Probeer het opnieuw.",
    )
    .into()
}

/// `.task-heading h1`: 28 points, semibold, lines close together.
fn heading() -> Div {
    div()
        .text_size(px(28.))
        .font_weight(FontWeight::SEMIBOLD)
        .line_height(relative(1.3))
}

#[cfg(test)]
mod tests {
    use super::{file_name, length};

    #[test]
    fn a_title_becomes_a_file_name() {
        assert_eq!(file_name("Ideeën: werk/privé (2026)"), "Ideeën werkprivé 2026");
        assert!(!file_name("???").is_empty());
    }

    #[test]
    fn length_counts_as_the_web_does() {
        assert_eq!(length("één"), 3);
        assert_eq!(length("👍"), 2);
    }
}
