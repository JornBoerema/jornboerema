//! The dialogs of the app's screen: a new list or an edited task and the
//! delete question (components/workspace-app.tsx), sharing a list
//! (share-list-dialog.tsx), a new workspace (workspace-switcher.tsx) and the
//! list spotlight (list-spotlight.tsx). The new issue dialog is in board.rs.

use gpui_kit::component::input::{Input, InputEvent, InputState, MoveDown, MoveUp};

use super::api::{ShareRole, SharingCommand, SharingData, WorkspaceCommand};
use super::overlay::{dialog_close, dialog_footer, dialog_header, dialog_panel, labeled, modal, on_escape};
use super::*;

pub(super) enum Dialog {
    Editor(Editor),
    Deletion(Deletion),
    Share(Share),
    NewWorkspace(NewWorkspace),
    Spotlight(SpotlightState),
    NewIssue(board::NewIssue),
}

pub(super) struct Editor {
    kind: EditorKind,
    input: Entity<InputState>,
    _events: Subscription,
}

#[derive(Clone)]
enum EditorKind {
    CreateList(ListKind),
    UpdateTodo(String),
}

#[derive(Clone)]
pub(super) enum Deletion {
    List { id: String, title: String },
    Todo { id: String, title: String },
    ClearDone { list_id: String, count: usize },
}

pub(super) struct Share {
    list: TodoList,
    /// The role a new link gets, until there is a link with its own.
    pub(super) role: ShareRole,
    data: Option<SharingData>,
    pending: bool,
    error: Option<SharedString>,
    /// The link, in a field to select and copy from.
    link: Entity<InputState>,
}

pub(super) struct NewWorkspace {
    input: Entity<InputState>,
    pending: bool,
    _events: Subscription,
}

pub(super) struct SpotlightState {
    input: Entity<InputState>,
    highlight: usize,
    _events: Subscription,
}

/// One row the spotlight can open: the overview (`None`) or a list.
struct SpotlightRow {
    id: Option<String>,
    kind: Option<ListKind>,
    name: SharedString,
}

/// list-spotlight.tsx `normalize`: without accents, lower case.
fn normalize(value: &str) -> String {
    value
        .chars()
        .map(|c| match c {
            'á' | 'à' | 'ä' | 'â' | 'ã' | 'å' | 'Á' | 'À' | 'Ä' | 'Â' => 'a',
            'é' | 'è' | 'ë' | 'ê' | 'É' | 'È' | 'Ë' | 'Ê' => 'e',
            'í' | 'ì' | 'ï' | 'î' | 'Í' | 'Ì' | 'Ï' | 'Î' => 'i',
            'ó' | 'ò' | 'ö' | 'ô' | 'õ' | 'Ó' | 'Ò' | 'Ö' | 'Ô' => 'o',
            'ú' | 'ù' | 'ü' | 'û' | 'Ú' | 'Ù' | 'Ü' | 'Û' => 'u',
            'ç' | 'Ç' => 'c',
            'ñ' | 'Ñ' => 'n',
            other => other,
        })
        .collect::<String>()
        .to_lowercase()
}

impl TodoApp {
    pub(super) fn close_dialog(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.dialog.take().is_none() {
            return;
        }
        // The issue below it gets the keyboard back, else the app.
        match &self.issue {
            Some(issue) => window.focus(&issue.focus, cx),
            None => window.focus(&self.focus, cx),
        }
        cx.notify();
    }

    // ─── A new list, an edited task ─────────────────────────────────────────

    fn open_editor(&mut self, kind: EditorKind, value: &str, window: &mut Window, cx: &mut Context<Self>) {
        let placeholder = match &kind {
            EditorKind::CreateList(ListKind::Board) => t("For example: Website", "Bijvoorbeeld: Website"),
            EditorKind::CreateList(_) => t("For example: Work", "Bijvoorbeeld: Werk"),
            EditorKind::UpdateTodo(_) => "",
        };
        let input = cx.new(|cx| {
            InputState::new(window, cx)
                .placeholder(placeholder)
                .default_value(value.to_string())
        });
        let events = cx.subscribe_in(&input, window, |this, _, event: &InputEvent, window, cx| match event {
            InputEvent::PressEnter { .. } => this.save_editor(window, cx),
            InputEvent::Change => cx.notify(),
            _ => {}
        });
        input.update(cx, |input, cx| input.focus(window, cx));
        self.menu = None;
        self.dialog = Some(Dialog::Editor(Editor {
            kind,
            input,
            _events: events,
        }));
        cx.notify();
    }

    pub(super) fn new_list(&mut self, kind: ListKind, window: &mut Window, cx: &mut Context<Self>) {
        self.open_editor(EditorKind::CreateList(kind), "", window, cx);
    }

    pub(super) fn edit_task(&mut self, id: &str, window: &mut Window, cx: &mut Context<Self>) {
        let Some(todo) = self.data.todos.iter().find(|todo| todo.id == id) else { return };
        let title = todo.title.clone();
        self.open_editor(EditorKind::UpdateTodo(id.to_string()), &title, window, cx);
    }

    fn save_editor(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(Dialog::Editor(editor)) = &self.dialog else { return };
        let value = editor.input.read(cx).value().trim().to_string();
        if value.is_empty() {
            return;
        }
        let kind = editor.kind.clone();
        self.close_dialog(window, cx);
        match kind {
            EditorKind::UpdateTodo(id) => {
                let title: String = value.chars().take(500).collect();
                self.run(
                    Command::UpdateTodo {
                        id,
                        title: Some(title),
                        completed: None,
                        in_progress: None,
                    },
                    window,
                    cx,
                );
            }
            EditorKind::CreateList(kind) => {
                let Some(workspace_id) = self.active().map(|workspace| workspace.id.clone()) else { return };
                let id = api::new_id();
                self.run(
                    Command::CreateList {
                        id: id.clone(),
                        workspace_id,
                        name: value.chars().take(80).collect(),
                        kind,
                    },
                    window,
                    cx,
                );
                self.select_list(&id, window, cx);
            }
        }
    }

    fn render_editor(&self, editor: &Editor, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let empty = editor.input.read(cx).value().trim().is_empty();
        let (title, description, label, submit) = match &editor.kind {
            EditorKind::CreateList(ListKind::Board) => (
                t("New board", "Nieuw bord"),
                t(
                    "Plan work like in Linear: issues move through statuses.",
                    "Plan werk zoals in Linear: issues schuiven door statussen.",
                ),
                t("Board name", "Naam van het bord"),
                t("Create board", "Bord maken"),
            ),
            EditorKind::CreateList(_) => (
                t("New list", "Nieuwe lijst"),
                t("Give your list a recognisable name.", "Geef je lijst een herkenbare naam."),
                t("List name", "Naam van de lijst"),
                t("Create list", "Lijst maken"),
            ),
            EditorKind::UpdateTodo(_) => (
                t("Edit task", "Taak bewerken"),
                t("Change the text of your task.", "Pas de tekst van je taak aan."),
                t("Task", "Taak"),
                t("Save", "Opslaan"),
            ),
        };
        let mut fields = div().flex().flex_col().gap(px(24.));
        if let EditorKind::CreateList(chosen) = &editor.kind {
            // Two kinds of task lists: the simple one stays the default.
            let options = [ListKind::Todo, ListKind::Board].map(|kind| {
                let checked = *chosen == kind;
                let (icon, name, help) = if kind == ListKind::Board {
                    (
                        "kanban",
                        t("Advanced board", "Geavanceerd bord"),
                        t(
                            "Issues with statuses, projects, priority, assignees, sub-issues and files.",
                            "Issues met statussen, projecten, prioriteit, toegewezen personen, sub-issues en bestanden.",
                        ),
                    )
                } else {
                    (
                        "task-01",
                        t("Simple list", "Simpele lijst"),
                        t("Tasks with a checkbox. Quick and light.", "Taken met een vinkje. Snel en licht."),
                    )
                };
                div()
                    .id(SharedString::from(format!("kind-{kind:?}")))
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .items_start()
                    .gap(px(4.))
                    .rounded(theme::RADIUS)
                    .cursor_pointer()
                    // The web's chosen option has a second line inside its edge.
                    .map(|el| {
                        if checked {
                            el.p(px(11.)).border_2().border_color(theme::primary_mark())
                        } else {
                            el.p(px(12.))
                                .border_1()
                                .border_color(theme::border())
                                .hover(|el| el.bg(theme::with_alpha(theme::muted_bg(), 0.5)))
                        }
                    })
                    .child(
                        theme::hi(icon)
                            .size(px(20.))
                            .mb(px(2.))
                            .text_color(if checked { theme::primary_mark() } else { theme::muted() }),
                    )
                    .child(div().text_size(px(14.)).font_weight(FontWeight::SEMIBOLD).child(name))
                    .child(
                        div()
                            .text_size(px(12.))
                            .line_height(relative(1.45))
                            .text_color(theme::muted())
                            .child(help),
                    )
                    .on_click(cx.listener(move |this, _, window, cx| {
                        if let Some(Dialog::Editor(editor)) = &mut this.dialog {
                            editor.kind = EditorKind::CreateList(kind);
                            let placeholder = if kind == ListKind::Board {
                                t("For example: Website", "Bijvoorbeeld: Website")
                            } else {
                                t("For example: Work", "Bijvoorbeeld: Werk")
                            };
                            editor.input.update(cx, |input, cx| {
                                input.set_placeholder(placeholder, window, cx);
                                input.focus(window, cx);
                            });
                            cx.notify();
                        }
                    }))
            });
            fields = fields.child(labeled("Type", div().flex().gap(px(8.)).children(options)));
        }
        fields = fields.child(labeled(label, kit::field(&editor.input, window, cx)));
        let panel = dialog_panel("editor-dialog", window)
            .key_context("TodoOverlay")
            .child(dialog_header(title, Some(description.into()), false))
            .child(
                div().flex().flex_col().gap(px(20.)).child(fields).child(
                    dialog_footer()
                        .child(
                            ui::button("editor-cancel", t("Cancel", "Annuleren"), ui::Variant::Outline)
                                .on_click(cx.listener(|this, _, window, cx| this.close_dialog(window, cx))),
                        )
                        .child(
                            ui::button("editor-save", submit, ui::Variant::Primary)
                                .when(empty, ui::disabled)
                                .when(!empty, |el| {
                                    el.on_click(cx.listener(|this, _, window, cx| this.save_editor(window, cx)))
                                }),
                        ),
                ),
            )
            .child(
                dialog_close("editor-close").on_click(cx.listener(|this, _, window, cx| this.close_dialog(window, cx))),
            );
        let panel = on_escape(panel, cx, |this, window, cx| this.close_dialog(window, cx));
        modal(
            1,
            None,
            window,
            panel,
            cx.listener(|this, _, window, cx| this.close_dialog(window, cx)),
        )
    }

    // ─── Deleting ───────────────────────────────────────────────────────────

    pub(super) fn ask_delete(&mut self, deletion: Deletion, window: &mut Window, cx: &mut Context<Self>) {
        self.menu = None;
        self.dialog = Some(Dialog::Deletion(deletion));
        window.focus(&self.overlay_focus, cx);
        cx.notify();
    }

    fn confirm_deletion(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(Dialog::Deletion(deletion)) = &self.dialog else { return };
        let command = match deletion.clone() {
            Deletion::List { id, .. } => Command::DeleteList { id },
            Deletion::Todo { id, .. } => Command::DeleteTodo { id },
            Deletion::ClearDone { list_id, .. } => Command::ClearDone { list_id },
        };
        self.close_dialog(window, cx);
        self.run(command, window, cx);
    }

    fn render_deletion(&self, deletion: &Deletion, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let (title, body): (&str, String) = match deletion {
            Deletion::ClearDone { count, .. } => (
                t("Delete done tasks?", "Klaar-taken verwijderen?"),
                t(
                    format!(
                        "{count} done {} will be deleted. This can't be undone.",
                        if *count == 1 { "task" } else { "tasks" }
                    ),
                    format!(
                        "{count} {} verwijderd. Dit kun je niet ongedaan maken.",
                        if *count == 1 { "taak die klaar is wordt" } else { "taken die klaar zijn worden" }
                    ),
                ),
            ),
            Deletion::List { title, .. } => (
                t("Delete list?", "Lijst verwijderen?"),
                t(
                    format!("“{title}” will be deleted, along with all tasks in this list. This can't be undone."),
                    format!("“{title}” wordt verwijderd, samen met alle taken in deze lijst. Dit kun je niet ongedaan maken."),
                ),
            ),
            Deletion::Todo { title, .. } => (
                t("Delete task?", "Taak verwijderen?"),
                t(
                    format!("“{title}” will be deleted. This can't be undone."),
                    format!("“{title}” wordt verwijderd. Dit kun je niet ongedaan maken."),
                ),
            ),
        };
        let panel = dialog_panel("deletion-dialog", window)
            .key_context("TodoOverlay")
            .track_focus(&self.overlay_focus)
            .on_action(cx.listener(|this, _: &Dismiss, window, cx| this.close_dialog(window, cx)))
            .child(dialog_header(title, Some(body.into()), true))
            .child(
                dialog_footer()
                    .child(
                        ui::button("deletion-cancel", t("Cancel", "Annuleren"), ui::Variant::Outline)
                            .on_click(cx.listener(|this, _, window, cx| this.close_dialog(window, cx))),
                    )
                    .child(
                        ui::button("deletion-confirm", t("Delete", "Verwijderen"), ui::Variant::Destructive)
                            .on_click(cx.listener(|this, _, window, cx| this.confirm_deletion(window, cx))),
                    ),
            );
        // An alert dialog stays until one of its buttons is pressed.
        modal(1, None, window, panel, |_, _, _| {})
    }

    // ─── Sharing a list ─────────────────────────────────────────────────────

    pub(super) fn share_list(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(list) = self.selected() else { return };
        let link = cx.new(|cx| InputState::new(window, cx));
        self.menu = None;
        self.dialog = Some(Dialog::Share(Share {
            list: list.clone(),
            role: ShareRole::Viewer,
            data: None,
            pending: false,
            error: None,
            link,
        }));
        window.focus(&self.overlay_focus, cx);
        self.load_sharing(list.id, window, cx);
        cx.notify();
    }

    fn load_sharing(&mut self, list_id: String, window: &mut Window, cx: &mut Context<Self>) {
        let client = self.client.clone();
        let id = list_id.clone();
        let task = cx.background_executor().spawn(async move { api::sharing(&client, &id) });
        cx.spawn_in(window, async move |this, cx| {
            let result = task.await;
            let _ = this.update_in(cx, |this, window, cx| {
                let message = result.as_ref().err().map(|error| this.message(error, cx));
                let Some(Dialog::Share(share)) = &mut this.dialog else { return };
                if share.list.id != list_id {
                    return;
                }
                share.pending = false;
                match result {
                    Ok(data) => {
                        let url = data
                            .link
                            .as_ref()
                            .map(|link| format!("{}/shared/{}", api::web_origin(), link.token))
                            .unwrap_or_default();
                        share.link.update(cx, |input, cx| input.set_value(url, window, cx));
                        share.data = Some(data);
                    }
                    Err(_) => share.error = message,
                }
                cx.notify();
            });
        })
        .detach();
    }

    pub(super) fn change_sharing(&mut self, command: SharingCommand, window: &mut Window, cx: &mut Context<Self>) {
        let Some(Dialog::Share(share)) = &mut self.dialog else { return };
        share.pending = true;
        share.error = None;
        let list_id = share.list.id.clone();
        let client = self.client.clone();
        let task = cx
            .background_executor()
            .spawn(async move { api::change_sharing(&client, &command) });
        cx.spawn_in(window, async move |this, cx| {
            let result = task.await;
            let _ = this.update_in(cx, |this, window, cx| match result {
                Ok(()) => this.load_sharing(list_id, window, cx),
                Err(error) => {
                    let message = this.message(&error, cx);
                    if let Some(Dialog::Share(share)) = &mut this.dialog {
                        share.pending = false;
                        share.error = Some(message);
                    }
                    cx.notify();
                }
            });
        })
        .detach();
        cx.notify();
    }

    /// The role the dialog's select shows, and what picking another does.
    pub(super) fn share_role(&self) -> Option<ShareRole> {
        let Some(Dialog::Share(share)) = &self.dialog else { return None };
        Some(
            share
                .data
                .as_ref()
                .and_then(|data| data.link.as_ref())
                .map(|link| link.role)
                .unwrap_or(share.role),
        )
    }

    pub(super) fn set_share_role(&mut self, role: ShareRole, window: &mut Window, cx: &mut Context<Self>) {
        let Some(Dialog::Share(share)) = &mut self.dialog else { return };
        share.role = role;
        let has_link = share.data.as_ref().is_some_and(|data| data.link.is_some());
        let list_id = share.list.id.clone();
        if has_link {
            self.change_sharing(SharingCommand::EnableLink { list_id, role }, window, cx);
        }
        cx.notify();
    }

    fn render_share(&self, share: &Share, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let workspace = self.active().map(|workspace| workspace.name.clone()).unwrap_or_default();
        let name = &share.list.name;
        let pending = share.pending;
        let mut panel = dialog_panel("share-dialog", window)
            .key_context("TodoOverlay")
            .track_focus(&self.overlay_focus)
            .child(dialog_header(
                t("Share list", "Lijst delen"),
                Some(
                    t(
                        format!("Everyone in {workspace} can already see ‘{name}’. A link also shares it with someone without an account."),
                        format!("Iedereen in {workspace} ziet ‘{name}’ al. Met een link deel je hem ook met iemand zonder account."),
                    )
                    .into(),
                ),
                false,
            ));
        match &share.data {
            None if share.error.is_none() => panel = panel.child(kit::skeleton().h(px(80.)).w_full()),
            None => {}
            Some(data) => {
                let role = data.link.as_ref().map(|link| link.role).unwrap_or(share.role);
                let label = if role == ShareRole::Editor {
                    t("Can edit", "Kan bewerken")
                } else {
                    t("Can view", "Kan bekijken")
                };
                let mut fields = div().flex().flex_col().gap(px(24.)).child(labeled(
                    t("Access via link", "Toegang via link"),
                    self.select_trigger("share-role", label, None, MenuKind::ShareRole, true, pending, cx),
                ));
                if data.link.is_some() {
                    fields = fields.child(labeled(
                        t("Link to the list", "Link naar de lijst"),
                        kit::field(&share.link, window, cx),
                    ));
                }
                let mut body = div().flex().flex_col().gap(px(16.)).child(fields);
                let list_id = share.list.id.clone();
                if data.link.is_some() {
                    let url = share.link.read(cx).value().to_string();
                    let revoke = list_id.clone();
                    body = body
                        .child(
                            ui::button("share-copy", t("Copy link", "Link kopiëren"), ui::Variant::Primary)
                                .w_full()
                                .when(pending, ui::disabled)
                                .when(!pending, |el| {
                                    el.on_click(cx.listener(move |_, _, window, cx| {
                                        cx.write_to_clipboard(ClipboardItem::new_string(url.clone()));
                                        ui::toast(t("Link copied.", "Link gekopieerd."), window, cx);
                                    }))
                                }),
                        )
                        .child(
                            ui::button("share-revoke", t("Revoke link", "Link intrekken"), ui::Variant::Ghost)
                                .w_full()
                                .when(pending, ui::disabled)
                                .when(!pending, |el| {
                                    el.on_click(cx.listener(move |this, _, window, cx| {
                                        this.change_sharing(
                                            SharingCommand::RevokeLink { list_id: revoke.clone() },
                                            window,
                                            cx,
                                        )
                                    }))
                                }),
                        );
                } else {
                    let label = if pending { t("One moment…", "Even geduld…") } else { t("Create link", "Link maken") };
                    body = body.child(
                        ui::button("share-create", label, ui::Variant::Primary)
                            .w_full()
                            .when(pending, ui::disabled)
                            .when(!pending, |el| {
                                el.on_click(cx.listener(move |this, _, window, cx| {
                                    let role = this.share_role().unwrap_or(ShareRole::Viewer);
                                    this.change_sharing(
                                        SharingCommand::EnableLink {
                                            list_id: list_id.clone(),
                                            role,
                                        },
                                        window,
                                        cx,
                                    )
                                }))
                            }),
                    );
                }
                panel = panel.child(body);
            }
        }
        if let Some(error) = share.error.clone() {
            panel = panel.child(kit::alert(None, error, true));
        }
        let panel = panel.child(dialog_close("share-close").on_click(cx.listener(|this, _, window, cx| {
            this.close_share(window, cx)
        })));
        let panel = on_escape(panel, cx, |this, window, cx| this.close_share(window, cx));
        modal(
            1,
            None,
            window,
            panel,
            cx.listener(|this, _, window, cx| this.close_share(window, cx)),
        )
    }

    /// Not while a change to the link is on its way.
    fn close_share(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if matches!(&self.dialog, Some(Dialog::Share(share)) if share.pending) {
            return;
        }
        self.close_dialog(window, cx);
    }

    // ─── A new workspace ────────────────────────────────────────────────────

    pub(super) fn new_workspace(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let input = cx.new(|cx| InputState::new(window, cx).placeholder(t("For example: Work", "Bijvoorbeeld: Werk")));
        let events = cx.subscribe_in(&input, window, |this, _, event: &InputEvent, window, cx| match event {
            InputEvent::PressEnter { .. } => this.create_workspace(window, cx),
            InputEvent::Change => cx.notify(),
            _ => {}
        });
        input.update(cx, |input, cx| input.focus(window, cx));
        self.menu = None;
        self.dialog = Some(Dialog::NewWorkspace(NewWorkspace {
            input,
            pending: false,
            _events: events,
        }));
        cx.notify();
    }

    fn create_workspace(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(Dialog::NewWorkspace(dialog)) = &mut self.dialog else { return };
        let name: String = dialog.input.read(cx).value().trim().chars().take(60).collect();
        if name.is_empty() || dialog.pending {
            return;
        }
        dialog.pending = true;
        let id = api::new_id();
        let command = WorkspaceCommand::Create {
            id: id.clone(),
            name: name.clone(),
        };
        let client = self.client.clone();
        let task = cx.background_executor().spawn(async move {
            let result = api::change_workspace(&client, &command);
            (result, api::workspaces(&client))
        });
        cx.spawn_in(window, async move |this, cx| {
            let (result, workspaces) = task.await;
            let _ = this.update_in(cx, |this, window, cx| match result {
                Ok(()) => {
                    this.close_dialog(window, cx);
                    if let Ok(workspaces) = workspaces {
                        this.set_workspaces(workspaces, cx);
                    }
                    this.select_workspace(&id, window, cx);
                    ui::toast(
                        t(format!("Workspace ‘{name}’ created."), format!("Workspace ‘{name}’ gemaakt.")),
                        window,
                        cx,
                    );
                }
                Err(error) => {
                    let message = this.message(&error, cx);
                    ui::toast_error(message, window, cx);
                    if let Some(Dialog::NewWorkspace(dialog)) = &mut this.dialog {
                        dialog.pending = false;
                    }
                    cx.notify();
                }
            });
        })
        .detach();
        cx.notify();
    }

    fn render_new_workspace(&self, dialog: &NewWorkspace, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let pending = dialog.pending;
        let blocked = pending || dialog.input.read(cx).value().trim().is_empty();
        let close = |this: &mut Self, window: &mut Window, cx: &mut Context<Self>| {
            if !matches!(&this.dialog, Some(Dialog::NewWorkspace(dialog)) if dialog.pending) {
                this.close_dialog(window, cx);
            }
        };
        let panel = dialog_panel("workspace-dialog", window)
            .key_context("TodoOverlay")
            .child(dialog_header(
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
            .child(labeled(t("Name", "Naam"), kit::field(&dialog.input, window, cx)))
            .child(
                dialog_footer()
                    .child(
                        ui::button("workspace-cancel", t("Cancel", "Annuleren"), ui::Variant::Outline)
                            .when(pending, ui::disabled)
                            .on_click(cx.listener(move |this, _, window, cx| close(this, window, cx))),
                    )
                    .child(
                        ui::button(
                            "workspace-create",
                            if pending { t("Creating…", "Maken…") } else { t("Create workspace", "Workspace maken") },
                            ui::Variant::Primary,
                        )
                        .when(blocked, ui::disabled)
                        .when(!blocked, |el| {
                            el.on_click(cx.listener(|this, _, window, cx| this.create_workspace(window, cx)))
                        }),
                    ),
            )
            .child(dialog_close("workspace-close").on_click(cx.listener(move |this, _, window, cx| close(this, window, cx))));
        let panel = on_escape(panel, cx, close);
        modal(1, None, window, panel, cx.listener(move |this, _, window, cx| close(this, window, cx)))
    }

    // ─── The list spotlight (⌘K) ────────────────────────────────────────────

    pub(super) fn toggle_spotlight(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        match &self.dialog {
            Some(Dialog::Spotlight(_)) => self.close_dialog(window, cx),
            // Do not interrupt editing or confirmation dialogs.
            Some(_) => {}
            None if self.issue.is_some() => {}
            None => self.open_spotlight(window, cx),
        }
    }

    pub(super) fn open_spotlight(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let input = cx.new(|cx| InputState::new(window, cx).placeholder(t("Search for a list…", "Zoek een lijst…")));
        let events = cx.subscribe_in(&input, window, |this, _, event: &InputEvent, window, cx| match event {
            InputEvent::PressEnter { .. } => this.spotlight_open(None, window, cx),
            InputEvent::Change => {
                if let Some(Dialog::Spotlight(spotlight)) = &mut this.dialog {
                    spotlight.highlight = 0;
                }
                cx.notify();
            }
            _ => {}
        });
        input.update(cx, |input, cx| input.focus(window, cx));
        self.menu = None;
        self.dialog = Some(Dialog::Spotlight(SpotlightState {
            input,
            highlight: 0,
            _events: events,
        }));
        cx.notify();
    }

    /// What the spotlight shows for what is typed: every word must be in the
    /// row's name or its keywords.
    fn spotlight_rows(&self, query: &str) -> Vec<SpotlightRow> {
        let query = normalize(query);
        let words: Vec<&str> = query.split_whitespace().collect();
        let matches = |keywords: &str| {
            let keywords = normalize(keywords);
            words.iter().all(|word| keywords.contains(word))
        };
        let mut rows = Vec::new();
        if matches(t("Overview Dashboard Home", "Overzicht Dashboard Home")) {
            rows.push(SpotlightRow {
                id: None,
                kind: None,
                name: t("Overview", "Overzicht").into(),
            });
        }
        let lists = self.lists();
        for kind in [ListKind::Todo, ListKind::Board] {
            let keyword = if kind == ListKind::Board { t("Boards", "Borden") } else { t("tasks", "taken") };
            for list in lists.iter().filter(|list| list.kind == kind) {
                if matches(&format!("{} {keyword}", list.name)) {
                    rows.push(SpotlightRow {
                        id: Some(list.id.clone()),
                        kind: Some(kind),
                        name: list.name.clone().into(),
                    });
                }
            }
        }
        rows
    }

    fn spotlight_step(&mut self, by: isize, cx: &mut Context<Self>) {
        let Some(Dialog::Spotlight(spotlight)) = &self.dialog else { return };
        let count = self.spotlight_rows(&spotlight.input.read(cx).value()).len();
        if count == 0 {
            return;
        }
        let Some(Dialog::Spotlight(spotlight)) = &mut self.dialog else { return };
        // The web's `loop`: past the last row comes the first.
        spotlight.highlight = (spotlight.highlight as isize + by).rem_euclid(count as isize) as usize;
        cx.notify();
    }

    /// Opens the row at `index`, or the highlighted one.
    fn spotlight_open(&mut self, index: Option<usize>, window: &mut Window, cx: &mut Context<Self>) {
        let Some(Dialog::Spotlight(spotlight)) = &self.dialog else { return };
        let rows = self.spotlight_rows(&spotlight.input.read(cx).value());
        let Some(row) = rows.get(index.unwrap_or(spotlight.highlight)) else { return };
        let id = row.id.clone();
        self.close_dialog(window, cx);
        match id {
            Some(id) => self.select_list(&id, window, cx),
            None => self.show_overview(window, cx),
        }
    }

    fn render_spotlight(&self, spotlight: &SpotlightState, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let rows = self.spotlight_rows(&spotlight.input.read(cx).value());
        let current = self.selected().map(|list| list.id);
        let on_overview = self.selected_id.is_none();
        let highlight = spotlight.highlight.min(rows.len().saturating_sub(1));
        let mut list = div()
            .id("spotlight-list")
            .flex()
            .flex_col()
            .max_h(px(360.).min(window.viewport_size().height * 0.45))
            .overflow_y_scroll();
        if rows.is_empty() {
            list = list.child(
                div().py(px(24.)).flex().justify_center().text_size(px(14.)).child(t(
                    "No lists found. Try another name.",
                    "Geen lijsten gevonden. Probeer een andere naam.",
                )),
            );
        }
        let mut group: Option<Option<ListKind>> = None;
        let mut column = div().flex().flex_col().p(px(4.));
        for (index, row) in rows.iter().enumerate() {
            if group != Some(row.kind) {
                if group.is_some() {
                    list = list.child(column);
                    column = div().flex().flex_col().p(px(4.));
                }
                let heading = match row.kind {
                    Some(ListKind::Board) => Some(t("Boards", "Borden")),
                    Some(_) => Some(t("Task lists", "Takenlijsten")),
                    None => None,
                };
                if let Some(heading) = heading {
                    column = column.child(
                        div()
                            .px(px(8.))
                            .py(px(6.))
                            .text_size(px(12.))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(theme::muted())
                            .child(heading),
                    );
                }
                group = Some(row.kind);
            }
            let icon = match row.kind {
                Some(ListKind::Board) => "kanban",
                Some(_) => "task-01",
                None => "home-01",
            };
            let checked = match &row.id {
                Some(id) => current.as_ref() == Some(id) && !on_overview,
                None => on_overview,
            };
            let selected = index == highlight;
            column = column.child(
                div()
                    .id(("spotlight-row", index))
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(px(8.))
                    .min_h(px(42.))
                    .px(px(8.))
                    .py(px(6.))
                    .rounded(theme::RADIUS_SM)
                    .text_size(px(14.))
                    .cursor_pointer()
                    .when(selected, |el| el.bg(theme::muted_bg()))
                    .hover(|el| el.bg(theme::muted_bg()))
                    .child(theme::hi(icon).text_color(if selected { theme::foreground() } else { theme::muted() }))
                    .child(div().flex_1().min_w_0().child(row.name.clone()))
                    .when(checked, |el| el.child(theme::hi("tick-02").text_color(theme::foreground())))
                    .on_click(cx.listener(move |this, _, window, cx| this.spotlight_open(Some(index), window, cx))),
            );
        }
        if group.is_some() {
            list = list.child(column);
        }
        let width = (window.viewport_size().width - px(32.)).min(px(448.));
        let panel = div()
            .id("spotlight")
            .occlude()
            .key_context("TodoOverlay TodoSpotlight")
            // Up and down belong to the rows here, not to the field's caret.
            .capture_action(cx.listener(|this, _: &MoveUp, _, cx| this.spotlight_step(-1, cx)))
            .capture_action(cx.listener(|this, _: &MoveDown, _, cx| this.spotlight_step(1, cx)))
            .flex()
            .flex_col()
            .w(width)
            .p(px(8.))
            .rounded(px(12.))
            .bg(theme::popover())
            .border_1()
            .border_color(theme::with_alpha(theme::foreground(), if theme::is_dark() { 0.1 } else { 0.05 }))
            .shadow_xl()
            .font_family(theme::FONT)
            .text_color(theme::foreground())
            .child(
                div().px(px(4.)).pt(px(4.)).pb(px(8.)).child(
                    div()
                        .flex()
                        .items_center()
                        .h(px(42.))
                        .rounded(theme::RADIUS_MD)
                        .bg(theme::with_alpha(theme::input(), 0.5))
                        .text_size(px(14.))
                        .child(
                            Input::new(&spotlight.input)
                                .appearance(false)
                                .suffix(theme::hi("search-01").text_color(theme::faint())),
                        ),
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
                    .child(t("↑ ↓ choose", "↑ ↓ kiezen"))
                    .child(t("↵ open", "↵ openen"))
                    .child(t("esc close", "esc sluiten")),
            );
        let panel = on_escape(panel, cx, |this, window, cx| this.close_dialog(window, cx));
        // `.list-spotlight`: a fifth down the window, at most 160.
        let top = (window.viewport_size().height * 0.2).min(px(160.));
        modal(
            1,
            Some(top),
            window,
            panel,
            cx.listener(|this, _, window, cx| this.close_dialog(window, cx)),
        )
    }

    /// The open dialog, above the issue when both show.
    pub(super) fn render_dialog(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let Some(dialog) = self.dialog.take() else { return Vec::new() };
        let element = match &dialog {
            Dialog::Editor(editor) => self.render_editor(editor, window, cx),
            Dialog::Deletion(deletion) => self.render_deletion(deletion, window, cx),
            Dialog::Share(share) => self.render_share(share, window, cx),
            Dialog::NewWorkspace(workspace) => self.render_new_workspace(workspace, window, cx),
            Dialog::Spotlight(spotlight) => self.render_spotlight(spotlight, window, cx),
            Dialog::NewIssue(issue) => self.render_new_issue(issue, window, cx),
        };
        self.dialog = Some(dialog);
        vec![element]
    }
}

#[cfg(test)]
mod tests {
    use super::normalize;

    #[test]
    fn search_ignores_accents_and_case() {
        assert_eq!(normalize("Café ÉÉN"), "cafe een");
    }
}
