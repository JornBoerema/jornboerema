//! What opens over the app: the dialogs for a new note and for deleting one
//! (components/workspace-app.tsx), a new workspace
//! (components/workspace-switcher.tsx), the public link
//! (components/share-list-dialog.tsx) and ⌘K (components/list-spotlight.tsx
//! with packages/ui/src/styles/spotlight.css).

use gpui_kit::component::input::{Input, InputEvent, InputState, MoveDown, MoveUp};
use gpui_kit::prelude::*;
use gpui_kit::*;

use crate::app::AppEvent;
use crate::i18n::t;
use crate::{theme, ui};

use super::api::{self, Failure, LinkRole, List};
use super::note::MAX_NAME;
use super::{parts, Menu, Nav, NotesApp};

pub(super) enum Overlay {
    NewNote {
        input: Entity<InputState>,
        _events: Subscription,
    },
    Delete {
        id: String,
        title: String,
        /// Which button has the keyboard: Cancel when the question opens, as
        /// the web's AlertDialog; Tab moves it, Enter presses it.
        on_delete: bool,
        /// Tab was used: the button with the keyboard shows it (`:focus-visible`).
        ring: bool,
    },
    NewWorkspace {
        input: Entity<InputState>,
        pending: bool,
        _events: Subscription,
    },
    Share(Share),
    Spotlight {
        input: Entity<InputState>,
        /// The highlighted row among those that match.
        index: usize,
        _events: Subscription,
    },
}

/// The public link to one note. Workspace members already see every note.
pub(super) struct Share {
    list_id: String,
    list_name: String,
    /// `None` until the link's state is in.
    sharing: Option<api::Sharing>,
    /// What a new link will allow, until there is one.
    role: LinkRole,
    pending: bool,
    error: Option<SharedString>,
    /// The link, in a field to select and copy from.
    link: Entity<InputState>,
}

/// A row of the spotlight: the overview, or a note by its place in the sidebar.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Hit {
    Overview,
    Note(usize),
}

/// Lower case and without accents, so "idee" finds "Ideeën" (`normalize` in list-spotlight.tsx).
fn normalize(text: &str) -> String {
    text.chars()
        .flat_map(char::to_lowercase)
        .filter_map(|c| {
            Some(match c {
                'à'..='å' | 'ā' | 'ă' | 'ą' => 'a',
                'ç' | 'ć' | 'č' => 'c',
                'è'..='ë' | 'ē' | 'ė' | 'ę' | 'ě' => 'e',
                'ì'..='ï' | 'ī' | 'į' => 'i',
                'ñ' | 'ń' | 'ň' => 'n',
                'ò'..='ö' | 'ō' | 'ő' => 'o',
                'ù'..='ü' | 'ū' | 'ů' | 'ű' => 'u',
                'ý' | 'ÿ' => 'y',
                'š' | 'ś' => 's',
                'ž' | 'ź' | 'ż' => 'z',
                // Accents written as their own character after the letter.
                '\u{300}'..='\u{36f}' => return None,
                other => other,
            })
        })
        .collect()
}

/// Every word of the search is somewhere in the keywords.
fn matches(search: &str, keywords: &str) -> bool {
    let keywords = normalize(keywords);
    normalize(search).split_whitespace().all(|word| keywords.contains(word))
}

fn hits(search: &str, notes: &[List]) -> Vec<Hit> {
    let mut hits = Vec::new();
    if matches(search, t("Overview Dashboard Home", "Overzicht Dashboard Home")) {
        hits.push(Hit::Overview);
    }
    for (index, note) in notes.iter().enumerate() {
        // The title and the start of the text, as the web's keywords.
        let text: String = note.markdown().chars().take(2000).collect();
        if matches(search, &format!("{} {text}", note.name)) {
            hits.push(Hit::Note(index));
        }
    }
    hits
}

impl NotesApp {
    pub(super) fn close_overlay(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        // A dialog that is busy stays until it is done.
        match &self.overlay {
            Some(Overlay::NewWorkspace { pending: true, .. }) => return,
            Some(Overlay::Share(share)) if share.pending => return,
            _ => {}
        }
        if self.overlay.take().is_some() {
            if self.menu == Some(Menu::LinkRole) {
                self.menu = None;
            }
            window.focus(&self.focus, cx);
            cx.notify();
        }
    }

    // A new note.

    pub(super) fn open_new_note(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.disabled() {
            return;
        }
        let input = Self::dialog_input(
            t("For example: Ideas", "Bijvoorbeeld: Ideeën"),
            MAX_NAME,
            window,
            cx,
        );
        let events = cx.subscribe_in(&input, window, |this, _, event: &InputEvent, window, cx| match event {
            InputEvent::PressEnter { .. } => this.create_note(window, cx),
            // The button follows whether there is a title.
            InputEvent::Change => cx.notify(),
            _ => {}
        });
        self.overlay = Some(Overlay::NewNote { input, _events: events });
        cx.notify();
    }

    fn render_new_note(&self, input: &Entity<InputState>, window: &Window, cx: &mut Context<Self>) -> AnyElement {
        let ready = !self.disabled() && !input.read(cx).value().trim().is_empty();
        parts::dialog_panel("new-note-dialog", window)
            .on_mouse_down_out(cx.listener(|this, _, window, cx| this.close_overlay(window, cx)))
            .child(parts::dialog_header(
                t("New note", "Nieuwe notitie"),
                Some(
                    t(
                        "Give your note a recognisable title.",
                        "Geef je notitie een herkenbare titel.",
                    )
                    .into(),
                ),
                false,
            ))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(20.))
                    .child(parts::labelled(t("Title", "Titel"), parts::field(input, window, cx)))
                    .child(
                        parts::dialog_footer()
                            .child(
                                ui::button("cancel-note", t("Cancel", "Annuleren"), ui::Variant::Outline)
                                    .on_click(cx.listener(|this, _, window, cx| this.close_overlay(window, cx))),
                            )
                            .child(
                                ui::button("create-note", t("Create note", "Notitie maken"), ui::Variant::Primary)
                                    .when(!ready, ui::disabled)
                                    .when(ready, |el| {
                                        el.on_click(cx.listener(|this, _, window, cx| this.create_note(window, cx)))
                                    }),
                            ),
                    ),
            )
            .child(
                parts::dialog_close("close-new-note")
                    .on_click(cx.listener(|this, _, window, cx| this.close_overlay(window, cx))),
            )
            .into_any_element()
    }

    // Deleting a note.

    /// The question whether to delete `id`, with the keyboard on Cancel.
    pub(super) fn ask_delete(&mut self, id: String, title: String, window: &mut Window, cx: &mut Context<Self>) {
        self.overlay = Some(Overlay::Delete {
            id,
            title,
            on_delete: false,
            ring: false,
        });
        window.focus(&self.focus, cx);
        cx.notify();
    }

    /// Tab in the delete question: the keyboard goes to the other button.
    pub(super) fn next_button(&mut self, cx: &mut Context<Self>) {
        match &mut self.overlay {
            Some(Overlay::Delete { on_delete, ring, .. }) => {
                *on_delete = !*on_delete;
                *ring = true;
                cx.notify();
            }
            _ => cx.propagate(),
        }
    }

    /// Enter in the delete question presses the button that has the keyboard.
    pub(super) fn press_button(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        match &self.overlay {
            Some(Overlay::Delete { on_delete: true, .. }) if !self.disabled() => self.delete_note(window, cx),
            Some(Overlay::Delete { on_delete: false, .. }) => self.close_overlay(window, cx),
            Some(Overlay::Delete { .. }) => {}
            _ => cx.propagate(),
        }
    }

    fn render_delete(&self, title: &str, on_delete: bool, ring: bool, window: &Window, cx: &mut Context<Self>) -> AnyElement {
        let disabled = self.disabled();
        // `focus-visible:outline-2 outline-offset-1 outline-ring`: around the button, taking no room.
        let focused = |button: Stateful<Div>, shown: bool| {
            div()
                .p(px(3.))
                .m(px(-3.))
                .rounded(px(11.))
                .border_2()
                .border_color(if shown { theme::ring() } else { theme::with_alpha(theme::ring(), 0.) })
                .child(button)
        };
        parts::dialog_panel("delete-note-dialog", window)
            .on_mouse_down_out(cx.listener(|this, _, window, cx| this.close_overlay(window, cx)))
            .child(parts::dialog_header(
                t("Delete note?", "Notitie verwijderen?"),
                Some(
                    t(
                        format!("“{title}” will be deleted. This can't be undone."),
                        format!("“{title}” wordt verwijderd. Dit kan niet ongedaan worden gemaakt."),
                    )
                    .into(),
                ),
                true,
            ))
            .child(
                parts::dialog_footer()
                    .child(focused(
                        ui::button("keep-note", t("Cancel", "Annuleren"), ui::Variant::Outline)
                            .on_click(cx.listener(|this, _, window, cx| this.close_overlay(window, cx))),
                        ring && !on_delete,
                    ))
                    .child(focused(
                        ui::button("confirm-delete", t("Delete", "Verwijderen"), ui::Variant::Destructive)
                            .when(disabled, ui::disabled)
                            .when(!disabled, |el| {
                                el.on_click(cx.listener(|this, _, window, cx| this.delete_note(window, cx)))
                            }),
                        ring && on_delete,
                    )),
            )
            .into_any_element()
    }

    // A new workspace.

    pub(super) fn open_new_workspace(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.menu = None;
        let input = Self::dialog_input(t("For example: Work", "Bijvoorbeeld: Werk"), 60, window, cx);
        let events = cx.subscribe_in(&input, window, |this, _, event: &InputEvent, window, cx| match event {
            InputEvent::PressEnter { .. } => this.create_workspace(window, cx),
            InputEvent::Change => cx.notify(),
            _ => {}
        });
        self.overlay = Some(Overlay::NewWorkspace {
            input,
            pending: false,
            _events: events,
        });
        cx.notify();
    }

    fn create_workspace(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(Overlay::NewWorkspace { input, pending, .. }) = &mut self.overlay else {
            return;
        };
        let name = input.read(cx).value().trim().to_string();
        if name.is_empty() || *pending {
            return;
        }
        *pending = true;
        let id = api::new_id();
        let client = self.client.clone();
        let (new_id, new_name) = (id.clone(), name.clone());
        let task = cx.background_executor().spawn(async move {
            api::create_workspace(&client, &new_id, &new_name)?;
            // The list again, with the new one in it.
            api::workspaces(&client)
        });
        cx.spawn_in(window, async move |this, cx| {
            let result = task.await;
            let _ = this.update_in(cx, |this, window, cx| {
                if let Some(Overlay::NewWorkspace { pending, .. }) = &mut this.overlay {
                    *pending = false;
                }
                match result {
                    Ok(workspaces) => {
                        this.close_overlay(window, cx);
                        this.workspaces = workspaces;
                        this.select_workspace(id, window, cx);
                        ui::toast(
                            t(
                                format!("Workspace ‘{name}’ created."),
                                format!("Workspace ‘{name}’ gemaakt."),
                            ),
                            window,
                            cx,
                        );
                    }
                    Err(error) => match api::failure(&error) {
                        Failure::SignedOut => cx.emit(AppEvent::SignedOut),
                        Failure::Gone(message) | Failure::Conflict(message) | Failure::Other(message) => {
                            ui::toast_error(
                                message.unwrap_or_else(|| {
                                    t("That didn't work. Please try again.", "Dit is niet gelukt. Probeer het opnieuw.")
                                        .to_string()
                                }),
                                window,
                                cx,
                            )
                        }
                        Failure::Offline => ui::toast_error(
                            t("That didn't work. Please try again.", "Dit is niet gelukt. Probeer het opnieuw."),
                            window,
                            cx,
                        ),
                    },
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }

    fn render_new_workspace(
        &self,
        input: &Entity<InputState>,
        pending: bool,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let ready = !pending && !input.read(cx).value().trim().is_empty();
        parts::dialog_panel("new-workspace-dialog", window)
            .on_mouse_down_out(cx.listener(|this, _, window, cx| this.close_overlay(window, cx)))
            .child(parts::dialog_header(
                t("New workspace", "Nieuwe workspace"),
                Some(
                    t(
                        "For example for work or your household. You can invite members afterwards.",
                        "Bijvoorbeeld voor werk of je huishouden. Daarna kun je leden uitnodigen.",
                    )
                    .into(),
                ),
                false,
            ))
            .child(parts::labelled(t("Name", "Naam"), parts::field(input, window, cx)))
            .child(
                parts::dialog_footer()
                    .child(
                        ui::button("cancel-workspace", t("Cancel", "Annuleren"), ui::Variant::Outline)
                            .when(pending, ui::disabled)
                            .on_click(cx.listener(|this, _, window, cx| this.close_overlay(window, cx))),
                    )
                    .child(
                        ui::button(
                            "create-workspace",
                            if pending {
                                t("Creating…", "Maken…")
                            } else {
                                t("Create workspace", "Workspace maken")
                            },
                            ui::Variant::Primary,
                        )
                        .when(!ready, ui::disabled)
                        .when(ready, |el| {
                            el.on_click(cx.listener(|this, _, window, cx| this.create_workspace(window, cx)))
                        }),
                    ),
            )
            .child(
                parts::dialog_close("close-new-workspace")
                    .on_click(cx.listener(|this, _, window, cx| this.close_overlay(window, cx))),
            )
            .into_any_element()
    }

    // The public link.

    pub(super) fn open_share(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some((list_id, list_name)) = self.selected_note().map(|note| (note.id.clone(), note.name.clone())) else {
            return;
        };
        self.overlay = Some(Overlay::Share(Share {
            list_id,
            list_name,
            sharing: None,
            role: LinkRole::Viewer,
            pending: false,
            error: None,
            link: cx.new(|cx| InputState::new(window, cx)),
        }));
        window.focus(&self.focus, cx);
        self.load_sharing(window, cx);
        cx.notify();
    }

    fn load_sharing(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(Overlay::Share(share)) = &self.overlay else { return };
        let list_id = share.list_id.clone();
        let client = self.client.clone();
        let asked = list_id.clone();
        let task = cx
            .background_executor()
            .spawn(async move { api::sharing(&client, &asked) });
        cx.spawn_in(window, async move |this, cx| {
            let result = task.await;
            let _ = this.update_in(cx, |this, window, cx| this.sharing_loaded(&list_id, result, window, cx));
        })
        .detach();
    }

    fn sharing_loaded(
        &mut self,
        list_id: &str,
        result: anyhow::Result<api::Sharing>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(Overlay::Share(share)) = &mut self.overlay else { return };
        if share.list_id != list_id {
            return;
        }
        share.pending = false;
        match result {
            Ok(sharing) => {
                let url = sharing
                    .link
                    .as_ref()
                    .map(|link| format!("{}/shared/{}", api::notes_web_url(), link.token))
                    .unwrap_or_default();
                share.link.update(cx, |input, cx| input.set_value(url, window, cx));
                share.sharing = Some(sharing);
            }
            Err(error) => match api::failure(&error) {
                Failure::SignedOut => cx.emit(AppEvent::SignedOut),
                Failure::Gone(message) | Failure::Conflict(message) | Failure::Other(message) => {
                    share.error = Some(message.unwrap_or_else(try_again).into())
                }
                Failure::Offline => share.error = Some(try_again().into()),
            },
        }
        cx.notify();
    }

    /// Makes the link, changes what it allows, or with `None` takes it away.
    fn change_sharing(&mut self, role: Option<LinkRole>, window: &mut Window, cx: &mut Context<Self>) {
        let Some(Overlay::Share(share)) = &mut self.overlay else { return };
        if share.pending {
            return;
        }
        share.pending = true;
        share.error = None;
        let list_id = share.list_id.clone();
        let client = self.client.clone();
        let asked = list_id.clone();
        let task = cx.background_executor().spawn(async move {
            api::share(&client, &asked, role)?;
            api::sharing(&client, &asked)
        });
        cx.spawn_in(window, async move |this, cx| {
            let result = task.await;
            let _ = this.update_in(cx, |this, window, cx| this.sharing_loaded(&list_id, result, window, cx));
        })
        .detach();
        cx.notify();
    }

    fn pick_link_role(&mut self, role: LinkRole, window: &mut Window, cx: &mut Context<Self>) {
        self.menu = None;
        let Some(Overlay::Share(share)) = &mut self.overlay else { return };
        share.role = role;
        // A link that exists changes at once; else the choice waits for "Create link".
        let has_link = share.sharing.as_ref().is_some_and(|sharing| sharing.link.is_some());
        if has_link {
            self.change_sharing(Some(role), window, cx);
        }
        cx.notify();
    }

    fn copy_link(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(Overlay::Share(share)) = &self.overlay else { return };
        let url = share.link.read(cx).value().to_string();
        cx.write_to_clipboard(ClipboardItem::new_string(url));
        ui::toast(t("Link copied.", "Link gekopieerd."), window, cx);
    }

    fn render_share(&self, share: &Share, window: &Window, cx: &mut Context<Self>) -> AnyElement {
        let workspace = self
            .active_workspace()
            .map(|workspace| workspace.name.clone())
            .unwrap_or_default();
        let name = &share.list_name;
        let pending = share.pending;
        let role_name = |role: LinkRole| match role {
            LinkRole::Viewer => t("Can view", "Kan bekijken"),
            LinkRole::Editor => t("Can edit", "Kan bewerken"),
        };
        let panel = parts::dialog_panel("share-dialog", window)
            .on_mouse_down_out(cx.listener(|this, _, window, cx| this.close_overlay(window, cx)))
            .child(parts::dialog_header(
                t("Share note", "Notitie delen"),
                Some(
                    t(
                        format!(
                            "Everyone in {workspace} can already see ‘{name}’. A link also shares it with someone without an account."
                        ),
                        format!(
                            "Iedereen in {workspace} ziet ‘{name}’ al. Met een link deel je hem ook met iemand zonder account."
                        ),
                    )
                    .into(),
                ),
                false,
            ));
        let panel = match &share.sharing {
            None if share.error.is_none() => panel.child(parts::skeleton(80.)),
            None => panel,
            Some(sharing) => {
                let link = sharing.link.as_ref();
                let role = link.map_or(share.role, |link| link.role);
                let open = self.menu == Some(Menu::LinkRole);
                // The web's Select: the choice in a field, the two choices under it.
                let select = div()
                    .relative()
                    .child(
                        div()
                            .id("link-role")
                            .flex()
                            .items_center()
                            .justify_between()
                            .h(px(32.))
                            .px(px(10.))
                            .rounded(theme::RADIUS_MD)
                            .bg(theme::mix(theme::input(), 50.))
                            .text_size(px(14.))
                            .child(role_name(role))
                            .child(theme::hi("arrow-down-01").text_color(theme::muted()))
                            .when(pending, ui::disabled)
                            .when(!pending, |el| {
                                el.cursor_pointer()
                                    .on_click(cx.listener(|this, _, _, cx| this.toggle_menu(Menu::LinkRole, cx)))
                            }),
                    )
                    .when(open, |el| {
                        el.child(
                            deferred(
                                div()
                                    .absolute()
                                    .top(px(36.))
                                    .left_0()
                                    .w_full()
                                    .occlude()
                                    .on_mouse_down_out(cx.listener(|this, _, _, cx| this.close_menu(cx)))
                                    .child(parts::menu_panel().children(
                                        [LinkRole::Viewer, LinkRole::Editor].into_iter().map(|choice| {
                                            parts::menu_item(role_name(choice), false)
                                                .child(div().flex_1().child(role_name(choice)))
                                                .when(choice == role, |el| {
                                                    el.child(theme::hi("tick-02").text_color(theme::muted()))
                                                })
                                                .on_click(cx.listener(move |this, _, window, cx| {
                                                    this.pick_link_role(choice, window, cx)
                                                }))
                                        }),
                                    )),
                            )
                            .with_priority(2),
                        )
                    });
                let fields = div()
                    .flex()
                    .flex_col()
                    .gap(px(24.))
                    .child(parts::labelled(t("Access via link", "Toegang via link"), select))
                    .when(link.is_some(), |el| {
                        el.child(parts::labelled(
                            t("Link to the note", "Link naar de notitie"),
                            parts::field_with(&share.link, true, window, cx),
                        ))
                    });
                let wide = |id: &'static str, label: &'static str, variant: ui::Variant| {
                    ui::button(id, label, variant).w_full().when(pending, ui::disabled)
                };
                let buttons = if link.is_some() {
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(16.))
                        .child(
                            wide("copy-link", t("Copy link", "Link kopiëren"), ui::Variant::Primary).when(
                                !pending,
                                |el| el.on_click(cx.listener(|this, _, window, cx| this.copy_link(window, cx))),
                            ),
                        )
                        .child(
                            wide("revoke-link", t("Revoke link", "Link intrekken"), ui::Variant::Ghost).when(
                                !pending,
                                |el| {
                                    el.on_click(
                                        cx.listener(|this, _, window, cx| this.change_sharing(None, window, cx)),
                                    )
                                },
                            ),
                        )
                } else {
                    div().flex().flex_col().child(
                        wide(
                            "create-link",
                            if pending {
                                t("One moment…", "Even geduld…")
                            } else {
                                t("Create link", "Link maken")
                            },
                            ui::Variant::Primary,
                        )
                        .when(!pending, |el| {
                            el.on_click(cx.listener(move |this, _, window, cx| {
                                this.change_sharing(Some(role), window, cx)
                            }))
                        }),
                    )
                };
                panel.child(div().flex().flex_col().gap(px(16.)).child(fields).child(buttons))
            }
        };
        panel
            .when_some(share.error.clone(), |el, error| {
                el.child(parts::alert(None, error, true))
            })
            .child(
                parts::dialog_close("close-share")
                    .on_click(cx.listener(|this, _, window, cx| this.close_overlay(window, cx))),
            )
            .into_any_element()
    }

    // ⌘K.

    pub(super) fn toggle_spotlight(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        match &self.overlay {
            Some(Overlay::Spotlight { .. }) => self.close_overlay(window, cx),
            // Not over another dialog.
            Some(_) => {}
            None => self.open_spotlight(window, cx),
        }
    }

    pub(super) fn open_spotlight(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.menu = None;
        let input = cx.new(|cx| {
            InputState::new(window, cx).placeholder(t("Search your notes…", "Zoek in je notities…"))
        });
        input.update(cx, |input, cx| input.focus(window, cx));
        let events = cx.subscribe_in(&input, window, |this, _, event: &InputEvent, window, cx| match event {
            InputEvent::PressEnter { .. } => this.choose_highlighted(window, cx),
            // Another search starts at its first match.
            InputEvent::Change => {
                if let Some(Overlay::Spotlight { index, .. }) = &mut this.overlay {
                    *index = 0;
                }
                cx.notify();
            }
            _ => {}
        });
        self.overlay = Some(Overlay::Spotlight {
            input,
            index: 0,
            _events: events,
        });
        cx.notify();
    }

    fn spotlight_hits(&self, cx: &App) -> Vec<Hit> {
        match &self.overlay {
            Some(Overlay::Spotlight { input, .. }) => hits(&input.read(cx).value(), &self.view),
            _ => Vec::new(),
        }
    }

    /// ↑ and ↓ go round (`loop` on the web's Command).
    fn step_spotlight(&mut self, by: isize, cx: &mut Context<Self>) {
        let count = self.spotlight_hits(cx).len() as isize;
        if let Some(Overlay::Spotlight { index, .. }) = &mut self.overlay {
            if count > 0 {
                *index = (*index as isize + by).rem_euclid(count) as usize;
            }
            cx.notify();
        }
    }

    fn choose_highlighted(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(Overlay::Spotlight { index, .. }) = &self.overlay else { return };
        if let Some(hit) = self.spotlight_hits(cx).get(*index).copied() {
            self.choose(hit, window, cx);
        }
    }

    fn choose(&mut self, hit: Hit, window: &mut Window, cx: &mut Context<Self>) {
        let nav = match hit {
            Hit::Overview => Nav::Overview,
            Hit::Note(index) => match self.view.get(index) {
                Some(note) => Nav::Note(note.id.clone()),
                None => return,
            },
        };
        self.close_overlay(window, cx);
        self.go(nav, window, cx);
    }

    fn render_spotlight(
        &self,
        input: &Entity<InputState>,
        index: usize,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let size = window.viewport_size();
        let hits = self.spotlight_hits(cx);
        let row = |position: usize, hit: Hit, icon: &str, label: SharedString, current: bool| {
            // `[data-slot="command-item"]`: 42 tall; the highlighted one on the quiet fill.
            div()
                .id(("spotlight-hit", position))
                .flex()
                .flex_none()
                .items_center()
                .gap(px(8.))
                .min_h(px(42.))
                .px(px(8.))
                .py(px(6.))
                .rounded(theme::RADIUS_SM)
                .cursor_pointer()
                .when(position == index, |el| el.bg(theme::muted_bg()))
                .child(theme::hi(icon).text_color(theme::muted()))
                .child(div().flex_1().min_w_0().child(label))
                .when(current, |el| el.child(theme::hi("tick-02").text_color(theme::muted())))
                .on_hover(cx.listener(move |this, hovered: &bool, _, cx| {
                    if let (true, Some(Overlay::Spotlight { index, .. })) = (*hovered, &mut this.overlay) {
                        if *index != position {
                            *index = position;
                            cx.notify();
                        }
                    }
                }))
                .on_click(cx.listener(move |this, _, window, cx| this.choose(hit, window, cx)))
        };
        let mut list = div()
            .id("spotlight-list")
            .flex()
            .flex_col()
            .max_h(px(360f32.min(f32::from(size.height) * 0.45)))
            .overflow_y_scroll();
        if hits.is_empty() {
            list = list.child(
                div().py(px(24.)).text_center().child(t(
                    "No notes found. Try another word.",
                    "Geen notities gevonden. Probeer een ander woord.",
                )),
            );
        }
        let mut heading_shown = false;
        for (position, hit) in hits.iter().enumerate() {
            match *hit {
                Hit::Overview => {
                    list = list.child(div().p(px(4.)).child(row(
                        position,
                        *hit,
                        "home-01",
                        t("Overview", "Overzicht").into(),
                        self.selected.is_none(),
                    )));
                }
                Hit::Note(note_index) => {
                    let Some(note) = self.view.get(note_index) else { continue };
                    if !heading_shown {
                        heading_shown = true;
                        // `[cmdk-group-heading]`.
                        list = list.child(
                            div()
                                .px(px(12.))
                                .pt(px(10.))
                                .pb(px(6.))
                                .text_size(px(12.))
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(theme::muted())
                                .child(t("Notes", "Notities")),
                        );
                    }
                    list = list.child(div().px(px(4.)).child(row(
                        position,
                        *hit,
                        "note-01",
                        note.name.clone().into(),
                        self.selected.as_ref() == Some(&note.id),
                    )));
                }
            }
        }
        let help = |text: &'static str| div().child(text);
        // `.list-spotlight`: 448 wide, 8 of room, a fifth down the window (160 at most).
        div()
            .id("spotlight")
            .occlude()
            .mt(px(160f32.min(f32::from(size.height) * 0.2)))
            .w((size.width - px(32.)).min(px(448.)))
            .flex()
            .flex_col()
            .flex_none()
            .self_start()
            .p(px(8.))
            .rounded(px(12.))
            .bg(theme::popover())
            .border_1()
            .border_color(theme::mix(theme::foreground(), if theme::is_dark() { 10. } else { 5. }))
            .shadow_xl()
            .on_mouse_down_out(cx.listener(|this, _, window, cx| this.close_overlay(window, cx)))
            // The field would take ↑ and ↓ for itself.
            .capture_action(cx.listener(|this, _: &MoveUp, _, cx| {
                cx.stop_propagation();
                this.step_spotlight(-1, cx)
            }))
            .capture_action(cx.listener(|this, _: &MoveDown, _, cx| {
                cx.stop_propagation();
                this.step_spotlight(1, cx)
            }))
            .child(
                div().px(px(4.)).pt(px(4.)).pb(px(8.)).child(
                    div()
                        .flex()
                        .items_center()
                        .h(px(42.))
                        .pl(px(10.))
                        .rounded(theme::RADIUS_MD)
                        .bg(theme::mix(theme::input(), 50.))
                        .child(theme::hi("search").text_color(theme::muted()).opacity(0.5))
                        .child(Input::new(input).appearance(false)),
                ),
            )
            .child(list)
            .child(
                div()
                    .flex()
                    .gap(px(16.))
                    .px(px(12.))
                    .pt(px(12.))
                    .pb(px(4.))
                    .text_size(px(11.))
                    .text_color(theme::muted())
                    .child(help(t("↑ ↓ choose", "↑ ↓ kiezen")))
                    .child(help(t("↵ open", "↵ openen")))
                    .child(help(t("esc close", "esc sluiten"))),
            )
            .into_any_element()
    }

    pub(super) fn render_overlay(&self, window: &Window, cx: &mut Context<Self>) -> Option<impl IntoElement> {
        let overlay = self.overlay.as_ref()?;
        let centred = |dialog: AnyElement| div().flex().flex_col().justify_center().child(dialog).into_any_element();
        let dialog = match overlay {
            Overlay::NewNote { input, .. } => centred(self.render_new_note(input, window, cx)),
            Overlay::Delete {
                title, on_delete, ring, ..
            } => centred(self.render_delete(title, *on_delete, *ring, window, cx)),
            Overlay::NewWorkspace { input, pending, .. } => {
                centred(self.render_new_workspace(input, *pending, window, cx))
            }
            Overlay::Share(share) => centred(self.render_share(share, window, cx)),
            Overlay::Spotlight { input, index, .. } => self.render_spotlight(input, *index, window, cx),
        };
        Some(parts::backdrop(window, dialog))
    }
}

fn try_again() -> String {
    t("Please try again.", "Probeer opnieuw.").to_string()
}

#[cfg(test)]
mod tests {
    use super::{hits, matches, normalize, Hit};
    use crate::notes::api::{List, ListRole, Note};

    fn note(name: &str, markdown: &str) -> List {
        List {
            id: name.into(),
            name: name.into(),
            kind: Some("note".into()),
            note: Some(Note {
                markdown: markdown.into(),
                version: 0,
            }),
            role: ListRole::Owner,
        }
    }

    #[test]
    fn searching_ignores_case_and_accents() {
        assert_eq!(normalize("Ideeën CAFÉ"), "ideeen cafe");
        assert!(matches("idee cafe", "Ideeën voor het café"));
        assert!(!matches("idee thee", "Ideeën voor het café"));
        assert!(matches("  ", "alles"));
    }

    #[test]
    fn the_spotlight_finds_titles_and_text() {
        let notes = [note("Boodschappen", "- melk"), note("Werk", "Vergadering over melkprijs")];
        assert!(hits("", &notes).len() == 3);
        assert!(hits("melk", &notes) == [Hit::Note(0), Hit::Note(1)]);
        assert!(hits("werk", &notes) == [Hit::Note(1)]);
        assert!(hits("dashboard", &notes) == [Hit::Overview]);
    }
}
