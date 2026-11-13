//! What the open conversation asks in a dialog: a task in Even doen from this
//! mail (`TodoDialog` in components/todo-from-mail.tsx, a small spotlight
//! like the snooze picker) and whether to leave a mailing list
//! (components/unsubscribe-button.tsx). The mail's webview makes way while
//! one shows (`MailView::veiled`).

use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::input::{Input, InputState};
use gpui_kit::component::menu::{DropdownMenu as _, PopupMenuItem};

use crate::api::{conversation_path, Unsubscribe};
use crate::{prefs, ui};

use super::super::api;
use super::extras::{Got, Todo, TodoList};
use super::page::unsubscribe_key;
use super::*;

/// The list picked last time, so the next task goes there without asking
/// (`LAST_LIST_KEY` in lib/todos.ts).
const LAST_LIST: &str = "mail.todo-list";

pub(super) enum Dialog {
    Todo(TodoDialog),
    Unsubscribe(Leaving),
}

pub(super) struct TodoDialog {
    thread_id: String,
    subject: String,
    /// Who the mail is from: the link the task keeps.
    from: Option<String>,
    input: Entity<InputState>,
    /// Empty until one is picked: the last list used, or else the first.
    list_id: String,
    creating: bool,
}

/// A mailing list about to be left.
pub(super) struct Leaving {
    thread_id: String,
    message_id: String,
    sender: String,
    /// What names the list (`unsubscribe_key`).
    key: String,
    description: String,
    busy: bool,
}

/// "www.shop.nl" as "shop.nl" (`siteOf`).
fn site_of(link: &str) -> String {
    url::Url::parse(link)
        .ok()
        .and_then(|url| url.host_str().map(|host| host.trim_start_matches("www.").to_string()))
        .unwrap_or_default()
}

impl MailView {
    /// T, and Make a task in the toolbar.
    pub(crate) fn open_todo(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !Feature::Todos.on() || self.reader.dialog.is_some() {
            return;
        }
        let Some(thread) = self.open.clone() else { return };
        let conversation = match self.reading.get(&thread.id) {
            Some(Reading::Ready(conversation)) => Some(conversation.clone()),
            _ => None,
        };
        let subject = conversation.as_ref().map_or(thread.subject.clone(), |conversation| conversation.subject.clone());
        let from = conversation
            .as_ref()
            .and_then(|conversation| conversation.last.as_ref())
            .and_then(|last| last.from.as_ref())
            .map(|from| from.label().to_string())
            .or_else(|| thread.from_name.clone().filter(|name| !name.is_empty()))
            .or_else(|| thread.from_email.clone());
        // The keyboard comes back from the mail document, which holds it natively.
        if let Some(webview) = &self.webview {
            let _ = webview.read(cx).raw().focus_parent();
        }
        let value = subject.clone();
        let input = cx.new(|cx| InputState::new(window, cx).default_value(value));
        input.update(cx, |input, cx| input.focus(window, cx));
        self.reader.dialog = Some(Dialog::Todo(TodoDialog {
            thread_id: thread.id,
            subject,
            from,
            input,
            list_id: String::new(),
            creating: false,
        }));
        if !matches!(self.reader.todo_lists, Got::Pending) {
            if self.reader.todo_lists.here().is_none() {
                self.reader.todo_lists = Got::Pending;
            }
            self.fetch(
                cx,
                |client| {
                    #[derive(serde::Deserialize)]
                    struct Answer {
                        lists: Vec<TodoList>,
                    }
                    Ok(client.get_json::<Answer>("/api/mail/todo-lists")?.lists)
                },
                |this, result, _| match result {
                    Ok(lists) => this.reader.todo_lists = Got::Here(lists),
                    Err(_) if this.reader.todo_lists.here().is_none() => this.reader.todo_lists = Got::Failed,
                    Err(_) => {}
                },
            );
        }
        cx.notify();
    }

    /// The list the task goes to: the one picked, the last one used while
    /// it still exists, or the first.
    fn todo_list(&self, dialog: &TodoDialog) -> Option<TodoList> {
        let lists = self.reader.todo_lists.here()?;
        let last = prefs::get(LAST_LIST);
        lists
            .iter()
            .find(|list| list.id == dialog.list_id)
            .or_else(|| lists.iter().find(|list| Some(&list.id) == last.as_ref()))
            .or_else(|| lists.first())
            .cloned()
    }

    /// Tab and Shift+Tab: the next list, round and round.
    fn todo_step(&mut self, by: isize, cx: &mut Context<Self>) {
        let Some(Dialog::Todo(dialog)) = &self.reader.dialog else { return };
        let Some(lists) = self.reader.todo_lists.here().filter(|lists| !lists.is_empty()) else {
            return;
        };
        let current = self.todo_list(dialog).map(|list| list.id);
        let index = lists.iter().position(|list| Some(&list.id) == current.as_ref()).unwrap_or(0) as isize;
        let next = lists[(index + by).rem_euclid(lists.len() as isize) as usize].id.clone();
        if let Some(Dialog::Todo(dialog)) = &mut self.reader.dialog {
            dialog.list_id = next;
        }
        cx.notify();
    }

    fn todo_submit(&mut self, cx: &mut Context<Self>) {
        let Some(Dialog::Todo(dialog)) = &self.reader.dialog else { return };
        let title = dialog.input.read(cx).value().replace('\n', " ").trim().to_string();
        let Some(list) = self.todo_list(dialog) else { return };
        if title.is_empty() || dialog.creating {
            return;
        }
        prefs::set(LAST_LIST, &list.id);
        let thread_id = dialog.thread_id.clone();
        let path = conversation_path(&thread_id, "/todo");
        if let Some(Dialog::Todo(dialog)) = &mut self.reader.dialog {
            dialog.creating = true;
        }
        self.fetch(
            cx,
            move |client| {
                #[derive(serde::Deserialize)]
                struct Answer {
                    todo: Todo,
                }
                let body = api::todo_body(&list.id, &title);
                Ok(client.post_json::<Answer>(&path, &body)?.todo)
            },
            move |this, result, cx| match result {
                Ok(todo) => {
                    this.reader.dialog = None;
                    let list = todo.list_name.clone();
                    this.toast(
                        t(format!("Task added to {list}"), format!("Taak toegevoegd aan {list}")),
                        ToastKind::Success,
                        Some((t("Open", "Openen").into(), ToastAction::Open(todo.url.clone()))),
                        false,
                        cx,
                    );
                    this.add_todo(&thread_id, todo, cx);
                }
                Err(error) => {
                    if let Some(Dialog::Todo(dialog)) = &mut this.reader.dialog {
                        dialog.creating = false;
                    }
                    this.toast_error(error, cx);
                }
            },
        );
        cx.notify();
    }

    /// "Unsubscribe" beside mail from a mailing list: asks first what will happen.
    pub(super) fn ask_unsubscribe(
        &mut self,
        thread_id: String,
        message_id: String,
        sender: String,
        unsubscribe: &Unsubscribe,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let account = self
            .open
            .as_ref()
            .and_then(|thread| self.mailbox(&thread.account_id))
            .map(|mailbox| mailbox.email.clone());
        let description = match (&unsubscribe.url, &unsubscribe.mailto, account) {
            (Some(link), _, _) if unsubscribe.one_click => {
                let site = site_of(link);
                t(
                    format!("Even mailen asks {site} to take you off this list. You won't get its mail anymore."),
                    format!("Even mailen vraagt {site} je van deze lijst af te halen. Je krijgt dan geen mail meer van ze."),
                )
            }
            (_, Some(mailto), Some(from)) => {
                let address = &mailto.address;
                t(
                    format!("An unsubscribe message goes to {address}, from {from}."),
                    format!("Er gaat een afmeldmail naar {address}, vanaf {from}."),
                )
            }
            (Some(link), _, _) => {
                let site = site_of(link);
                t(
                    format!("The unsubscribe page of {site} opens in your browser; finish there."),
                    format!("De afmeldpagina van {site} opent in je browser; rond het daar af."),
                )
            }
            _ => return,
        };
        if let Some(webview) = &self.webview {
            let _ = webview.read(cx).raw().focus_parent();
        }
        window.focus(&self.focus, cx);
        self.reader.dialog = Some(Dialog::Unsubscribe(Leaving {
            thread_id,
            message_id,
            sender,
            key: unsubscribe_key(unsubscribe),
            description,
            busy: false,
        }));
        cx.notify();
    }

    /// Asks our server to leave the list: it reads the message's headers
    /// itself and tries one-click, then the list's unsubscribe mailbox. Only
    /// a list with neither leaves a page for the reader, which opens.
    fn leave_list(&mut self, cx: &mut Context<Self>) {
        let Some(Dialog::Unsubscribe(leaving)) = &mut self.reader.dialog else { return };
        if leaving.busy {
            return;
        }
        leaving.busy = true;
        let (thread_id, message_id) = (leaving.thread_id.clone(), leaving.message_id.clone());
        let (sender, key) = (leaving.sender.clone(), leaving.key.clone());
        let shown = thread_id.clone();
        self.fetch(
            cx,
            move |client| api::unsubscribe(client, &thread_id, &message_id),
            move |this, result, cx| match result {
                Ok(page) => {
                    this.reader.dialog = None;
                    let text = match page {
                        // An opened page still needs the reader; only a request sent is done.
                        Some(page) => {
                            let _ = open::that_detached(page);
                            t("Unsubscribe page opened", "Afmeldpagina geopend").to_string()
                        }
                        None => {
                            this.reader.left.insert(key.clone());
                            this.mark_left(&shown, &key, cx);
                            t(format!("Unsubscribed from {sender}"), format!("Uitgeschreven bij {sender}"))
                        }
                    };
                    this.toast(text, ToastKind::Success, None, false, cx);
                }
                Err(_) => {
                    if let Some(Dialog::Unsubscribe(leaving)) = &mut this.reader.dialog {
                        leaving.busy = false;
                    }
                    this.toast(
                        t(
                            "Unsubscribing didn't work. Try the link in the mail instead.",
                            "Uitschrijven lukte niet. Probeer de link in de mail.",
                        ),
                        ToastKind::Error,
                        None,
                        false,
                        cx,
                    );
                }
            },
        );
        cx.notify();
    }

    /// The list is left: every message of it in the page says so.
    fn mark_left(&mut self, thread_id: &str, key: &str, cx: &mut Context<Self>) {
        let Some(Reading::Ready(conversation)) = self.reading.get(thread_id) else {
            return;
        };
        let parts: Vec<String> = conversation
            .parts
            .iter()
            .enumerate()
            .filter(|(_, part)| part.unsubscribe.as_ref().is_some_and(|unsubscribe| unsubscribe_key(unsubscribe) == key))
            .map(|(index, _)| index.to_string())
            .collect();
        if self.page_shows(thread_id) {
            self.tell_page(&format!("even.unsubscribed([{}])", parts.join(",")), cx);
        }
    }

    /// Esc, or a click beside it. True when there was a dialog to close.
    pub(crate) fn close_reader_dialog(&mut self, window: &mut Window, cx: &mut Context<Self>) -> bool {
        let busy = match &self.reader.dialog {
            Some(Dialog::Todo(dialog)) => dialog.creating,
            Some(Dialog::Unsubscribe(leaving)) => leaving.busy,
            None => return false,
        };
        if !busy {
            self.reader.dialog = None;
            window.focus(&self.focus, cx);
            cx.notify();
        }
        true
    }

    fn dialog_key(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        let todo = matches!(self.reader.dialog, Some(Dialog::Todo(_)));
        match event.keystroke.key.as_str() {
            "escape" => {
                cx.stop_propagation();
                self.close_reader_dialog(window, cx);
            }
            "enter" if todo => {
                cx.stop_propagation();
                self.todo_submit(cx);
            }
            "tab" if todo => {
                cx.stop_propagation();
                self.todo_step(if event.keystroke.modifiers.shift { -1 } else { 1 }, cx);
            }
            _ => {}
        }
    }

    pub(crate) fn render_reader_dialog(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Option<AnyElement> {
        let dialog = self.reader.dialog.as_ref()?;
        let centred = matches!(dialog, Dialog::Unsubscribe(_));
        let panel = match dialog {
            Dialog::Todo(dialog) => self.render_todo(dialog, cx),
            Dialog::Unsubscribe(leaving) => self.render_unsubscribe(leaving, cx),
        };
        // The web's dialog overlay, as the spotlights and questions in overlays.rs lie over mail.
        Some(
            div()
                .id("reader-dialog")
                .absolute()
                .inset_0()
                .flex()
                .flex_col()
                .items_center()
                .when(centred, |el| el.justify_center())
                // A spotlight sits near the top (`top: min(20dvh, 160px)`).
                .when(!centred, |el| el.pt(window.viewport_size().height.min(px(800.)) * 0.2))
                .px(px(16.))
                // The rail is beside mail, not under it: this far left centres the panel in the window.
                .pr(px(16. + 80.))
                .bg(rgba(0x0000004d))
                .occlude()
                .capture_key_down(cx.listener(Self::dialog_key))
                .on_click(cx.listener(|this, _, window, cx| {
                    this.close_reader_dialog(window, cx);
                }))
                .child(panel)
                .into_any_element(),
        )
    }

    /// The task as it will look in Even doen (an empty box, its name, the mail
    /// it links to), the list it goes to, Tab to pick another, Enter to make it.
    fn render_todo(&self, dialog: &TodoDialog, cx: &mut Context<Self>) -> AnyElement {
        let picked = self.todo_list(dialog);
        let lists = self.reader.todo_lists.here().cloned().unwrap_or_default();
        let mut workspaces: Vec<(String, String)> = Vec::new();
        for list in &lists {
            if !workspaces.iter().any(|(id, _)| *id == list.workspace_id) {
                workspaces.push((list.workspace_id.clone(), list.workspace_name.clone()));
            }
        }
        let several = workspaces.len() > 1;
        let ready = picked.is_some() && !dialog.creating && !dialog.input.read(cx).value().trim().is_empty();
        let linked = match &dialog.from {
            Some(from) => t(format!("Linked to the mail from {from}"), format!("Gekoppeld aan de mail van {from}")),
            None => dialog.subject.clone(),
        };
        let chooser = match (&picked, &self.reader.todo_lists) {
            (Some(picked), _) => {
                let this = cx.weak_entity();
                let current = picked.id.clone();
                let trigger = Button::new("todo-list").ghost().max_w(px(300.)).child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(6.))
                        .min_w_0()
                        .text_size(px(13.))
                        .text_color(theme::muted())
                        .child(theme::hi("left-to-right-list-bullet").text_color(theme::muted()))
                        .child(
                            div()
                                .min_w_0()
                                .truncate()
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(theme::foreground())
                                .child(picked.name.clone()),
                        )
                        .when(several, |el| {
                            el.child(div().min_w_0().truncate().child(format!("· {}", picked.workspace_name)))
                        })
                        .child(theme::hi("unfold-more").text_color(theme::muted())),
                );
                trigger
                    .dropdown_menu(move |menu, _, _| {
                        let mut menu = menu.min_w(px(240.)).max_w(px(240.));
                        for (index, (workspace, name)) in workspaces.iter().enumerate() {
                            if index > 0 {
                                menu = menu.separator();
                            }
                            // Workspaces are only named when there are several.
                            if several {
                                menu = menu.item(PopupMenuItem::label(name.clone()));
                            }
                            for list in lists.iter().filter(|list| list.workspace_id == *workspace) {
                                let (this, id) = (this.clone(), list.id.clone());
                                menu = menu.item(
                                    PopupMenuItem::new(list.name.clone()).checked(list.id == current).on_click(
                                        move |_, _, cx| {
                                            let _ = this.update(cx, |this, cx| {
                                                if let Some(Dialog::Todo(dialog)) = &mut this.reader.dialog {
                                                    dialog.list_id = id.clone();
                                                }
                                                cx.notify();
                                            });
                                        },
                                    ),
                                );
                            }
                        }
                        menu
                    })
                    .into_any_element()
            }
            (None, Got::Here(_)) => div()
                .text_size(px(14.))
                .text_color(theme::muted())
                .child(t("You have no lists in Even doen yet.", "Je hebt nog geen lijsten in Even doen."))
                .into_any_element(),
            (None, Got::Failed) => div().into_any_element(),
            // `Skeleton className="h-8 w-40 rounded-lg"`.
            (None, _) => div()
                .w(px(160.))
                .h(px(32.))
                .rounded(theme::RADIUS)
                .bg(theme::muted_bg())
                .into_any_element(),
        };
        let create = ui::button("todo-create", "", ui::Variant::Primary)
            .ml_auto()
            .px(px(12.))
            .text_size(px(13.))
            .map(|el| {
                if dialog.creating {
                    el.child(ui::spinner())
                } else {
                    el.child(t("Make task", "Taak maken"))
                }
            })
            .map(|el| {
                if ready {
                    el.on_click(cx.listener(|this, _, _, cx| {
                        cx.stop_propagation();
                        this.todo_submit(cx)
                    }))
                } else {
                    ui::disabled(el)
                }
            });
        // `.list-spotlight.todo-capture`.
        div()
            .id("todo-capture")
            .flex()
            .flex_col()
            .flex_none()
            .w(px(520.))
            .max_w_full()
            .p(px(8.))
            .rounded(px(12.))
            .bg(theme::popover())
            .border_1()
            .border_color(theme::border())
            .shadow_xl()
            .text_size(px(14.))
            // A click inside is not a click beside it.
            .on_click(|_, _, cx| cx.stop_propagation())
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .px(px(8.))
                    .pt(px(4.))
                    .pb(px(8.))
                    .text_size(px(12.))
                    .line_height(px(16.))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(theme::muted())
                    .child(theme::hi("task-add-01").size(px(14.)).text_color(theme::muted()))
                    .child(t("Task in Even doen", "Taak in Even doen")),
            )
            .child(
                // `.todo-capture-task`, with the field in it: its edge takes the accent.
                div()
                    .flex()
                    .items_start()
                    .gap(px(12.))
                    .pt(px(14.))
                    .px(px(14.))
                    .pb(px(12.))
                    .rounded(px(10.))
                    .bg(theme::mix(theme::foreground(), 5.))
                    .border_1()
                    .border_color(theme::mix(theme::primary(), 55.))
                    .child(
                        // `.todo-capture-box`: an open task's box, as Even doen draws it.
                        div()
                            .flex_none()
                            .size(px(18.))
                            .mt(px(2.))
                            .rounded(px(5.))
                            .border_color(theme::mix(theme::foreground(), 35.))
                            .border(px(1.5)),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .flex_1()
                            .min_w_0()
                            .gap(px(8.))
                            .child(
                                // The field's own inset taken back, so its words start where the link's do.
                                div()
                                    .ml(px(-10.))
                                    .text_size(px(15.))
                                    .font_weight(FontWeight::MEDIUM)
                                    .child(Input::new(&dialog.input).appearance(false)),
                            )
                            .child(
                                // The link it keeps: where the task will open from.
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(6.))
                                    .min_w_0()
                                    .text_size(px(12.))
                                    .text_color(theme::muted())
                                    .child(theme::hi("mail-01").size(px(14.)).text_color(theme::muted()))
                                    .child(div().min_w_0().truncate().child(linked)),
                            ),
                    ),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .px(px(4.))
                    .pt(px(12.))
                    .pb(px(4.))
                    .child(chooser)
                    .child(create),
            )
            .into_any_element()
    }

    /// The web's alert dialog: what happens, then Cancel and Unsubscribe.
    fn render_unsubscribe(&self, leaving: &Leaving, cx: &mut Context<Self>) -> AnyElement {
        let sender = &leaving.sender;
        let busy = leaving.busy;
        let cancel = ui::button("unsubscribe-cancel", t("Cancel", "Annuleren"), ui::Variant::Outline);
        let confirm = ui::button("unsubscribe-confirm", t("Unsubscribe", "Uitschrijven"), ui::Variant::Primary);
        div()
            .id("unsubscribe")
            .flex()
            .flex_col()
            .flex_none()
            .gap(px(24.))
            .w(px(448.))
            .max_w_full()
            .p(px(24.))
            .rounded(theme::RADIUS_XL)
            .bg(theme::popover())
            .border_1()
            .border_color(theme::border())
            .shadow_xl()
            .on_click(|_, _, cx| cx.stop_propagation())
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(6.))
                    .child(
                        div()
                            .text_size(px(16.))
                            .font_weight(FontWeight::MEDIUM)
                            .child(t(format!("Unsubscribe from {sender}?"), format!("Uitschrijven bij {sender}?"))),
                    )
                    .child(
                        div()
                            .text_size(px(14.))
                            .text_color(theme::muted())
                            .child(leaving.description.clone()),
                    ),
            )
            .child(
                div()
                    .flex()
                    .justify_end()
                    .gap(px(8.))
                    .child(if busy {
                        ui::disabled(cancel)
                    } else {
                        cancel.on_click(cx.listener(|this, _, window, cx| {
                            cx.stop_propagation();
                            this.close_reader_dialog(window, cx);
                        }))
                    })
                    .child(if busy {
                        ui::disabled(confirm)
                    } else {
                        confirm.on_click(cx.listener(|this, _, _, cx| {
                            cx.stop_propagation();
                            this.leave_list(cx)
                        }))
                    }),
            )
            .into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::site_of;

    #[test]
    fn a_site_is_named_without_www() {
        assert_eq!(site_of("https://www.shop.nl/unsubscribe?x=1"), "shop.nl");
        assert_eq!(site_of("https://news.shop.nl/u"), "news.shop.nl");
        assert_eq!(site_of("nonsense"), "");
    }
}
