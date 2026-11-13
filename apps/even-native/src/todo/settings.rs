//! Even doen's pages in the settings window (components/settings): its part
//! of the shared connections page, and the workspace's own pages: general,
//! members, statuses and projects. The account, appearance and about pages
//! are the window's own (src/shell.rs).

use std::collections::HashMap;

use gpui_kit::component::input::{Escape, Input, InputEvent, InputState, Textarea, TextareaState};

use super::api::{BoardProject, BoardStatus, WorkspaceCommand, WorkspaceRole};
use super::core::{sort_statuses, PROJECT_COLORS, STATUS_COLORS};
use super::dashboard::day_and_month;
use super::overlay::{dialog_close, dialog_footer, dialog_header, dialog_panel, modal, on_escape};
use super::*;

/// workspace-settings.tsx: in the desktop app the lists' part of the shared
/// connections page, and the workspace's own pages.
pub(super) fn pages() -> Vec<SettingsPage> {
    let words = |list: &str| list.split(" | ").map(|word| SharedString::from(word.to_string())).collect();
    vec![
        SettingsPage {
            id: "connections",
            label: t("Connections", "Koppelingen").into(),
            icon: "share-08",
            shared: true,
            keywords: words("mcp | chatgpt | ai | koppelingen | connections"),
        },
        SettingsPage {
            id: "workspace",
            label: t("General", "Algemeen").into(),
            icon: "settings-01",
            shared: false,
            keywords: words("workspace | name | delete | leave | naam | verwijderen | verlaten | algemeen | general"),
        },
        SettingsPage {
            id: "members",
            label: t("Members", "Leden").into(),
            icon: "user-group",
            shared: false,
            keywords: words("workspace | invite | roles | admin | uitnodigen | rollen | beheerder | leden | members"),
        },
        SettingsPage {
            id: "statuses",
            label: t("Statuses", "Statussen").into(),
            icon: "kanban",
            shared: false,
            keywords: words("statuses | workflow | columns | board | linear | statussen | kolommen | bord"),
        },
        SettingsPage {
            id: "projects",
            label: t("Projects", "Projecten").into(),
            icon: "folder-01",
            shared: false,
            keywords: words("projects | board | linear | projecten | bord"),
        },
    ]
}

/// i18n settings.ts `roles`.
pub(super) fn role_name(role: WorkspaceRole) -> &'static str {
    match role {
        WorkspaceRole::Owner => t("Owner", "Eigenaar"),
        WorkspaceRole::Admin => t("Admin", "Beheerder"),
        WorkspaceRole::Member => t("Member", "Lid"),
    }
}

/// A status's name, edited in place in the statuses page.
struct StatusName {
    input: Entity<InputState>,
    /// The name as last shown from the data, to see a rename made elsewhere.
    shown: String,
    _events: Subscription,
}

pub(super) struct ProjectEditor {
    id: Option<String>,
    name: Entity<InputState>,
    description: Entity<TextareaState>,
    color: String,
    _events: Subscription,
}

pub(super) enum SettingsDialog {
    /// Delete the workspace (its owner) or leave it (anyone else).
    Gone,
    DeleteStatus { id: String, replacement: String },
    Project(ProjectEditor),
    DeleteProject(String),
}

pub(super) struct SettingsState {
    /// The name field must take the open workspace's name again.
    pub sync_name: bool,
    name: Entity<InputState>,
    /// What is on its way to the server ("rename", "invite", "role-<id>", …).
    busy: Option<String>,
    email: Entity<InputState>,
    pub invite_role: WorkspaceRole,
    copied: bool,
    adding: Option<(StatusCategory, Entity<InputState>, Subscription)>,
    status_names: HashMap<String, StatusName>,
    pub dialog: Option<SettingsDialog>,
    /// Where the keyboard was before a dialog took it.
    restore: Option<FocusHandle>,
    _events: Vec<Subscription>,
}

impl SettingsState {
    pub(super) fn new(window: &mut Window, cx: &mut Context<TodoApp>) -> Self {
        let name = cx.new(|cx| InputState::new(window, cx));
        let email = cx.new(|cx| InputState::new(window, cx).placeholder(t("name@example.com", "naam@voorbeeld.nl")));
        let events = vec![
            cx.subscribe_in(&name, window, |this, _, event: &InputEvent, window, cx| match event {
                InputEvent::PressEnter { .. } => this.rename_workspace(window, cx),
                InputEvent::Change => cx.notify(),
                _ => {}
            }),
            cx.subscribe_in(&email, window, |this, _, event: &InputEvent, window, cx| match event {
                InputEvent::PressEnter { .. } => this.invite_member(window, cx),
                InputEvent::Change => cx.notify(),
                _ => {}
            }),
        ];
        Self {
            sync_name: true,
            name,
            busy: None,
            email,
            invite_role: WorkspaceRole::Member,
            copied: false,
            adding: None,
            status_names: HashMap::new(),
            dialog: None,
            restore: None,
            _events: events,
        }
    }

    pub(super) fn editing_project_color(&self) -> Option<String> {
        match &self.dialog {
            Some(SettingsDialog::Project(editor)) => Some(editor.color.clone()),
            _ => None,
        }
    }

    pub(super) fn set_editing_project_color(&mut self, color: String) {
        if let Some(SettingsDialog::Project(editor)) = &mut self.dialog {
            editor.color = color;
        }
    }

    /// The status being deleted and where its issues would go.
    pub(super) fn deleting_status(&self) -> Option<(String, String)> {
        match &self.dialog {
            Some(SettingsDialog::DeleteStatus { id, replacement }) => Some((id.clone(), replacement.clone())),
            _ => None,
        }
    }

    pub(super) fn set_replacement(&mut self, status_id: String) {
        if let Some(SettingsDialog::DeleteStatus { replacement, .. }) = &mut self.dialog {
            *replacement = status_id;
        }
    }
}

/// packages/ui settings-dialog.tsx `SettingsRow`, with a description that is
/// more than a line of text and a title that can warn.
fn row(title: impl Into<SharedString>, description: Option<AnyElement>, destructive: bool, control: Option<AnyElement>) -> AnyElement {
    div()
        .flex()
        .items_center()
        .justify_between()
        .gap(px(24.))
        .px(px(20.))
        .py(px(16.))
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(4.))
                .min_w_0()
                .flex_1()
                .child(
                    div()
                        .text_size(px(14.))
                        .font_weight(FontWeight::MEDIUM)
                        .when(destructive, |el| el.text_color(theme::danger()))
                        .child(title.into()),
                )
                .when_some(description, |el, description| {
                    el.child(div().text_size(px(14.)).text_color(theme::muted()).child(description))
                }),
        )
        .when_some(control, |el, control| {
            el.child(div().flex().flex_none().items_center().gap(px(8.)).child(control))
        })
        .into_any_element()
}

fn text(value: impl Into<SharedString>) -> Option<AnyElement> {
    Some(div().child(value.into()).into_any_element())
}

/// packages/ui badge.tsx, `variant="secondary"`.
fn badge(label: &'static str) -> Div {
    div()
        .flex()
        .flex_none()
        .items_center()
        .h(px(20.))
        .px(px(8.))
        .rounded_full()
        .bg(theme::secondary())
        .text_size(px(12.))
        .font_weight(FontWeight::MEDIUM)
        .child(label)
}

impl TodoApp {
    // ─── What the pages do ──────────────────────────────────────────────────

    /// lib/workspaces.ts `useWorkspaceCommand`: runs the change, then reads
    /// the workspaces and members again. `done` runs when the server took it.
    fn workspace_command(
        &mut self,
        action: impl Into<String>,
        command: WorkspaceCommand,
        window: &mut Window,
        cx: &mut Context<Self>,
        done: impl FnOnce(&mut Self, &mut Window, &mut Context<Self>) + 'static,
    ) {
        if self.settings.busy.is_some() {
            return;
        }
        self.settings.busy = Some(action.into());
        let client = self.client.clone();
        let task = cx.background_executor().spawn(async move {
            let result = api::change_workspace(&client, &command);
            (result, api::workspaces(&client))
        });
        cx.spawn_in(window, async move |this, cx| {
            let (result, workspaces) = task.await;
            let _ = this.update_in(cx, |this, window, cx| {
                this.settings.busy = None;
                if let Ok(workspaces) = workspaces {
                    this.set_workspaces(workspaces, cx);
                }
                match result {
                    Ok(()) => done(this, window, cx),
                    Err(error) => {
                        let message = this.message(&error, cx);
                        ui::toast_error(message, window, cx);
                    }
                }
                this.load_members(cx);
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }

    fn rename_workspace(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(workspace) = self.active().cloned() else { return };
        let name: String = self.settings.name.read(cx).value().trim().chars().take(60).collect();
        if name.is_empty() || name == workspace.name || !workspace.role.can_manage() {
            return;
        }
        self.workspace_command(
            "rename",
            WorkspaceCommand::Rename {
                workspace_id: workspace.id,
                name,
            },
            window,
            cx,
            |_, window, cx| {
                ui::toast(
                    t("Workspace name updated.", "Naam van de workspace bijgewerkt."),
                    window,
                    cx,
                )
            },
        );
    }

    fn invite_member(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(workspace) = self.active().cloned() else { return };
        let email = self.settings.email.read(cx).value().trim().to_lowercase();
        if email.is_empty() {
            return;
        }
        let to = email.clone();
        self.workspace_command(
            "invite",
            WorkspaceCommand::Invite {
                workspace_id: workspace.id,
                email,
                role: self.settings.invite_role,
            },
            window,
            cx,
            move |this, window, cx| {
                this.settings.email.update(cx, |input, cx| input.set_value("", window, cx));
                ui::toast(
                    t(format!("Invitation sent to {to}."), format!("Uitnodiging verstuurd naar {to}.")),
                    window,
                    cx,
                );
            },
        );
    }

    pub(super) fn change_member_role(&mut self, member_id: &str, role: WorkspaceRole, window: &mut Window, cx: &mut Context<Self>) {
        let Some(workspace) = self.active().cloned() else { return };
        self.workspace_command(
            format!("role-{member_id}"),
            WorkspaceCommand::UpdateMember {
                workspace_id: workspace.id,
                member_id: member_id.to_string(),
                role,
            },
            window,
            cx,
            |_, _, _| {},
        );
    }

    /// Deletes the workspace (its owner) or leaves it, then opens another one.
    fn confirm_gone(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(workspace) = self.active().cloned() else { return };
        let owner = workspace.role == WorkspaceRole::Owner;
        let command = if owner {
            WorkspaceCommand::Delete {
                workspace_id: workspace.id.clone(),
            }
        } else {
            WorkspaceCommand::Leave {
                workspace_id: workspace.id.clone(),
            }
        };
        self.workspace_command("gone", command, window, cx, move |this, window, cx| {
            this.settings.dialog = None;
            ui::toast(
                if owner {
                    t("Workspace deleted.", "Workspace verwijderd.")
                } else {
                    t("You left the workspace.", "Je hebt de workspace verlaten.")
                },
                window,
                cx,
            );
            // The list of workspaces was read again: the first one left opens.
            let other = this
                .workspaces
                .iter()
                .flatten()
                .find(|other| other.id != workspace.id)
                .map(|other| other.id.clone());
            if let Some(other) = other {
                this.active_id = None;
                this.select_workspace(&other, window, cx);
            }
        });
    }

    fn start_adding_status(&mut self, category: StatusCategory, window: &mut Window, cx: &mut Context<Self>) {
        let name = category_name(category).to_lowercase();
        let input = cx.new(|cx| {
            InputState::new(window, cx).placeholder(t(format!("New {name} status"), format!("Nieuwe status ({name})")))
        });
        let events = cx.subscribe_in(&input, window, |this, _, event: &InputEvent, window, cx| match event {
            InputEvent::PressEnter { .. } => this.add_status(window, cx),
            InputEvent::Change => cx.notify(),
            _ => {}
        });
        input.update(cx, |input, cx| input.focus(window, cx));
        self.settings.adding = Some((category, input, events));
        cx.notify();
    }

    fn add_status(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some((category, input, _)) = &self.settings.adding else { return };
        let Some(workspace_id) = self.active().map(|workspace| workspace.id.clone()) else { return };
        let name: String = input.read(cx).value().trim().chars().take(40).collect();
        if name.is_empty() {
            return;
        }
        // The first colour no status has yet.
        let color = STATUS_COLORS
            .iter()
            .find(|color| !self.data.statuses.iter().any(|status| status.color.eq_ignore_ascii_case(color)))
            .unwrap_or(&STATUS_COLORS[0])
            .to_string();
        let command = Command::CreateStatus {
            id: api::new_id(),
            workspace_id,
            name,
            category: *category,
            color,
        };
        self.settings.adding = None;
        self.run(command, window, cx);
    }

    /// A status's name saves when its field is left or on Enter.
    fn commit_status_name(&mut self, id: &str, window: &mut Window, cx: &mut Context<Self>) {
        let Some(status) = self.data.statuses.iter().find(|status| status.id == id) else { return };
        let Some(field) = self.settings.status_names.get_mut(id) else { return };
        let next: String = field.input.read(cx).value().trim().chars().take(40).collect();
        if next.is_empty() {
            let name = status.name.clone();
            field.input.update(cx, |input, cx| input.set_value(name, window, cx));
            return;
        }
        if next == status.name {
            return;
        }
        field.shown = next.clone();
        self.run(
            Command::UpdateStatus {
                id: id.to_string(),
                name: Some(next),
                category: None,
                color: None,
            },
            window,
            cx,
        );
    }

    pub(super) fn ask_delete_status(&mut self, id: &str, window: &mut Window, cx: &mut Context<Self>) {
        let statuses = sort_statuses(&self.data.statuses);
        let Some(status) = statuses.iter().find(|status| status.id == id) else { return };
        // Its issues go to another status of the same kind, else to any other.
        let replacement = statuses
            .iter()
            .find(|other| other.id != status.id && other.category == status.category)
            .or_else(|| statuses.iter().find(|other| other.id != status.id));
        let Some(replacement) = replacement else { return };
        self.settings.dialog = Some(SettingsDialog::DeleteStatus {
            id: id.to_string(),
            replacement: replacement.id.clone(),
        });
        self.settings.restore = window.focused(cx);
        window.focus(&self.overlay_focus, cx);
        cx.notify();
    }

    pub(super) fn edit_project(&mut self, id: Option<&str>, window: &mut Window, cx: &mut Context<Self>) {
        let project = id.and_then(|id| self.data.projects.iter().find(|project| project.id == id));
        let (name, description, color) = match project {
            Some(project) => (project.name.clone(), project.description.clone(), project.color.clone()),
            None => (
                String::new(),
                String::new(),
                PROJECT_COLORS[self.data.projects.len() % PROJECT_COLORS.len()].to_string(),
            ),
        };
        let name = cx.new(|cx| {
            InputState::new(window, cx)
                .placeholder(t("For example: Launch 2027", "Bijvoorbeeld: Lancering 2027"))
                .default_value(name)
        });
        let description = cx.new(|cx| {
            TextareaState::new(window, cx)
                .rows(3)
                .placeholder(t(
                    "What is this project about? (optional)",
                    "Waar gaat dit project over? (optioneel)",
                ))
                .default_value(description)
        });
        let events = cx.subscribe_in(&name, window, |this, _, event: &InputEvent, window, cx| match event {
            InputEvent::PressEnter { .. } => this.save_project(window, cx),
            InputEvent::Change => cx.notify(),
            _ => {}
        });
        name.update(cx, |input, cx| input.focus(window, cx));
        self.settings.dialog = Some(SettingsDialog::Project(ProjectEditor {
            id: id.map(str::to_string),
            name,
            description,
            color,
            _events: events,
        }));
        cx.notify();
    }

    fn save_project(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(SettingsDialog::Project(editor)) = &self.settings.dialog else { return };
        let Some(workspace_id) = self.active().map(|workspace| workspace.id.clone()) else { return };
        let name: String = editor.name.read(cx).value().trim().chars().take(80).collect();
        if name.is_empty() {
            return;
        }
        let description: String = editor.description.read(cx).value().trim().chars().take(2000).collect();
        let command = match &editor.id {
            Some(id) => Command::UpdateProject {
                id: id.clone(),
                name: Some(name),
                description: Some(description),
                color: Some(editor.color.clone()),
            },
            None => Command::CreateProject {
                id: api::new_id(),
                workspace_id,
                name,
                description,
                color: editor.color.clone(),
            },
        };
        self.settings.dialog = None;
        self.run(command, window, cx);
    }

    pub(super) fn ask_delete_project(&mut self, id: &str, window: &mut Window, cx: &mut Context<Self>) {
        self.settings.dialog = Some(SettingsDialog::DeleteProject(id.to_string()));
        self.settings.restore = window.focused(cx);
        window.focus(&self.overlay_focus, cx);
        cx.notify();
    }

    fn close_settings_dialog(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        // Not while the workspace is being deleted or left.
        if matches!(self.settings.dialog, Some(SettingsDialog::Gone)) && self.settings.busy.is_some() {
            return;
        }
        self.settings.dialog = None;
        // The keyboard goes back to the settings window.
        if let Some(restore) = self.settings.restore.take() {
            window.focus(&restore, cx);
        }
        cx.notify();
    }

    // ─── The pages ──────────────────────────────────────────────────────────

    pub(super) fn render_settings_page(&mut self, page: &str, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        if page == "connections" {
            return self.render_connections(cx).into_any_element();
        }
        // The data is read when the app's own screen first shows; the settings
        // can open before that.
        if self.server.is_none() || self.active().is_none() {
            return div()
                .flex()
                .flex_col()
                .gap(px(12.))
                .child(kit::skeleton().h(px(40.)).w_full())
                .child(kit::skeleton().h(px(40.)).w_full())
                .into_any_element();
        }
        let sections: Vec<AnyElement> = match page {
            "workspace" => self.render_general(window, cx),
            "members" => self.render_members(window, cx),
            "statuses" => self.render_statuses(window, cx),
            "projects" => self.render_projects(cx),
            _ => Vec::new(),
        };
        let overlays = self.render_overlays(Surface::Settings, window, cx);
        div()
            .flex()
            .flex_col()
            .gap(px(32.))
            .children(sections)
            .children(overlays)
            .into_any_element()
    }

    /// connections-settings.tsx: the MCP address for ChatGPT and the like.
    fn render_connections(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let url = format!("{}/mcp", crate::api::api_url());
        let copy = url.clone();
        let step = |number: usize, words: &'static str| div().flex().gap(px(6.)).child(format!("{number}.")).child(words);
        ui::settings_section(
            "Even doen",
            Some(
                t(
                    "Let ChatGPT or another MCP client read and update your lists.",
                    "Laat ChatGPT of een andere MCP-client je lijsten lezen en bijwerken.",
                )
                .into(),
            ),
            vec![
                row(
                    t("MCP URL", "MCP-URL"),
                    Some(
                        div()
                            .text_size(px(12.))
                            .font_family("Menlo")
                            .text_color(theme::foreground())
                            .child(url)
                            .into_any_element(),
                    ),
                    false,
                    Some(
                        ui::button(
                            "todo-mcp-copy",
                            if self.settings.copied { t("Copied", "Gekopieerd") } else { t("Copy", "Kopiëren") },
                            ui::Variant::Outline,
                        )
                        .on_click(cx.listener(move |this, _, _, cx| {
                            cx.write_to_clipboard(ClipboardItem::new_string(copy.clone()));
                            this.settings.copied = true;
                            cx.notify();
                        }))
                        .into_any_element(),
                    ),
                ),
                row(
                    t("How to connect", "Zo koppel je"),
                    Some(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(12.))
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .gap(px(4.))
                                    .pl(px(4.))
                                    .child(step(
                                        1,
                                        t(
                                            "In ChatGPT, turn on Developer mode (Settings → Security and login).",
                                            "Zet in ChatGPT Developer mode aan (Settings → Security and login).",
                                        ),
                                    ))
                                    .child(step(
                                        2,
                                        t(
                                            "Add a connection, paste the MCP URL above and choose OAuth.",
                                            "Voeg een koppeling toe, plak de MCP-URL hierboven en kies OAuth.",
                                        ),
                                    ))
                                    .child(step(
                                        3,
                                        t(
                                            "Sign in with your Even doen account and allow access.",
                                            "Log in met je Even doen-account en geef toestemming.",
                                        ),
                                    )),
                            )
                            .child(t(
                                "Then try: “Add ‘Send invoice’ to my Work list.”",
                                "Probeer daarna: “Zet ‘Factuur sturen’ op mijn lijst Werk.”",
                            ))
                            .into_any_element(),
                    ),
                    false,
                    None,
                ),
            ],
        )
    }

    /// workspace-general-settings.tsx.
    fn render_general(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let Some(workspace) = self.active().cloned() else { return Vec::new() };
        if self.settings.sync_name {
            self.settings.sync_name = false;
            let name = workspace.name.clone();
            self.settings.name.update(cx, |input, cx| input.set_value(name, window, cx));
        }
        let can_manage = workspace.role.can_manage();
        let owner = workspace.role == WorkspaceRole::Owner;
        let is_last = self.workspaces.as_ref().is_some_and(|workspaces| workspaces.len() == 1);
        let busy = self.settings.busy.clone();
        let typed = self.settings.name.read(cx).value().trim().to_string();
        let unchanged = typed.is_empty() || typed == workspace.name;

        let mut name_control = div()
            .flex()
            .gap(px(8.))
            .child(div().w(px(240.)).child(if can_manage && busy.is_none() {
                kit::field(&self.settings.name, window, cx)
            } else {
                // Only the owner and admins can change the name.
                div()
                    .flex()
                    .items_center()
                    .h(px(32.))
                    .px(px(10.))
                    .rounded(theme::RADIUS_MD)
                    .bg(theme::with_alpha(theme::input(), 0.5))
                    .opacity(0.5)
                    .child(div().truncate().child(workspace.name.clone()))
            }));
        if can_manage {
            let blocked = busy.is_some() || unchanged;
            name_control = name_control.child(
                ui::button(
                    "workspace-rename",
                    if busy.as_deref() == Some("rename") { t("Saving…", "Opslaan…") } else { t("Save", "Opslaan") },
                    ui::Variant::Primary,
                )
                .when(blocked, ui::disabled)
                .when(!blocked, |el| {
                    el.on_click(cx.listener(|this, _, window, cx| this.rename_workspace(window, cx)))
                }),
            );
        }
        let general = ui::settings_section(
            t("General", "Algemeen"),
            Some(
                t(
                    "Everyone in this workspace sees and edits the same lists.",
                    "Iedereen in deze workspace ziet en bewerkt dezelfde lijsten.",
                )
                .into(),
            ),
            vec![
                row(
                    t("Name", "Naam"),
                    (!can_manage)
                        .then(|| {
                            text(t(
                                "Only the owner and admins can change the name.",
                                "Alleen de eigenaar en beheerders kunnen de naam wijzigen.",
                            ))
                        })
                        .flatten(),
                    false,
                    Some(name_control.into_any_element()),
                ),
                row(
                    t("Your role", "Jouw rol"),
                    text(t(
                        "Determines whether you can manage members and settings.",
                        "Bepaalt of je leden en instellingen kunt beheren.",
                    )),
                    false,
                    Some(div().text_size(px(14.)).child(role_name(workspace.role)).into_any_element()),
                ),
            ],
        );
        let ask = cx.listener(|this, _: &ClickEvent, window, cx| {
            this.settings.restore = window.focused(cx);
            window.focus(&this.overlay_focus, cx);
            this.settings.dialog = Some(SettingsDialog::Gone);
            cx.notify();
        });
        let danger_row = if owner {
            let blocked = is_last || busy.is_some();
            row(
                t("Delete workspace", "Workspace verwijderen"),
                text(if is_last {
                    t(
                        "This is your only workspace. Create another one first.",
                        "Dit is je enige workspace. Maak eerst een andere aan.",
                    )
                } else {
                    t(
                        "All lists and notes in this workspace disappear, for all members.",
                        "Alle lijsten en notities in deze workspace verdwijnen, voor alle leden.",
                    )
                }),
                true,
                Some(
                    ui::button_with_icon(
                        "workspace-delete",
                        "delete-02",
                        t("Delete", "Verwijderen"),
                        ui::Variant::Destructive,
                    )
                    .when(blocked, ui::disabled)
                    .when(!blocked, |el| el.on_click(ask))
                    .into_any_element(),
                ),
            )
        } else {
            let blocked = busy.is_some();
            row(
                t("Leave workspace", "Workspace verlaten"),
                text(t(
                    "You lose access to all lists in this workspace. An admin can invite you again.",
                    "Je verliest toegang tot alle lijsten in deze workspace. Een beheerder kan je opnieuw uitnodigen.",
                )),
                true,
                Some(
                    ui::button("workspace-leave", t("Leave", "Verlaten"), ui::Variant::Destructive)
                        .when(blocked, ui::disabled)
                        .when(!blocked, |el| el.on_click(ask))
                        .into_any_element(),
                ),
            )
        };
        let danger = ui::settings_section_with(t("Danger zone", "Gevarenzone"), None, None, true, vec![danger_row]);
        vec![general.into_any_element(), danger.into_any_element()]
    }

    /// workspace-members-settings.tsx.
    fn render_members(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let Some(workspace) = self.active().cloned() else { return Vec::new() };
        let can_manage = workspace.role.can_manage();
        let busy = self.settings.busy.clone();
        let is_busy = busy.is_some();
        let mut sections = Vec::new();

        if can_manage {
            let blocked = is_busy || self.settings.email.read(cx).value().trim().is_empty();
            let control = div()
                .flex()
                .gap(px(8.))
                .child(div().w(px(224.)).child(kit::field(&self.settings.email, window, cx)))
                .child(self.select_trigger(
                    "invite-role",
                    role_name(self.settings.invite_role),
                    None,
                    MenuKind::InviteRole,
                    false,
                    is_busy,
                    cx,
                ))
                .child(
                    ui::button_with_icon(
                        "invite-send",
                        "user-add-01",
                        if busy.as_deref() == Some("invite") {
                            t("Sending…", "Versturen…")
                        } else {
                            t("Invite", "Uitnodigen")
                        },
                        ui::Variant::Primary,
                    )
                    .when(blocked, ui::disabled)
                    .when(!blocked, |el| {
                        el.on_click(cx.listener(|this, _, window, cx| this.invite_member(window, cx)))
                    }),
                );
            sections.push(
                ui::settings_section(
                    t("Invite members", "Leden uitnodigen"),
                    Some(
                        t(
                            "They get an e-mail and accept with an account on the same e-mail address.",
                            "De ontvanger krijgt een e-mail en accepteert met een account op hetzelfde e-mailadres.",
                        )
                        .into(),
                    ),
                    vec![row(
                        t("Email address", "E-mailadres"),
                        text(if self.settings.invite_role == WorkspaceRole::Admin {
                            t(
                                "Admins can invite members and manage the workspace.",
                                "Beheerders kunnen leden uitnodigen en de workspace beheren.",
                            )
                        } else {
                            t(
                                "Members can view and edit all lists.",
                                "Leden kunnen alle lijsten bekijken en bewerken.",
                            )
                        }),
                        false,
                        Some(control.into_any_element()),
                    )],
                )
                .into_any_element(),
            );
        }

        let rows: Vec<AnyElement> = match (&self.members, &self.members_error) {
            (None, Some(error)) => vec![div().p(px(20.)).child(kit::alert(None, error.clone(), true)).into_any_element()],
            (None, None) => vec![div()
                .flex()
                .flex_col()
                .gap(px(12.))
                .p(px(20.))
                .child(kit::skeleton().h(px(40.)).w_full())
                .child(kit::skeleton().h(px(40.)).w_full())
                .into_any_element()],
            (Some(members), _) => members
                .members
                .iter()
                .map(|member| {
                    let me = member.user_id == self.user.id;
                    let editable = can_manage && member.role != WorkspaceRole::Owner && !me;
                    let title = if me {
                        t(format!("{} (you)", member.name), format!("{} (jij)", member.name))
                    } else {
                        member.name.clone()
                    };
                    let control: AnyElement = if editable {
                        let (member_id, name) = (member.id.clone(), member.name.clone());
                        let workspace_id = workspace.id.clone();
                        div()
                            .flex()
                            .items_center()
                            .gap(px(8.))
                            .child(self.select_trigger(
                                SharedString::from(format!("member-role-{}", member.id)),
                                role_name(member.role),
                                None,
                                MenuKind::MemberRole(member.id.clone()),
                                false,
                                is_busy,
                                cx,
                            ))
                            .child(
                                ui::button(
                                    SharedString::from(format!("member-remove-{}", member.id)),
                                    t("Remove", "Verwijderen"),
                                    ui::Variant::Ghost,
                                )
                                .when(is_busy, ui::disabled)
                                .when(!is_busy, |el| {
                                    el.on_click(cx.listener(move |this, _, window, cx| {
                                        let name = name.clone();
                                        this.workspace_command(
                                            format!("remove-{member_id}"),
                                            WorkspaceCommand::RemoveMember {
                                                workspace_id: workspace_id.clone(),
                                                member_id: member_id.clone(),
                                            },
                                            window,
                                            cx,
                                            move |_, window, cx| {
                                                ui::toast(
                                                    t(
                                                        format!("{name} has been removed from the workspace."),
                                                        format!("{name} is verwijderd uit de workspace."),
                                                    ),
                                                    window,
                                                    cx,
                                                )
                                            },
                                        )
                                    }))
                                }),
                            )
                            .into_any_element()
                    } else {
                        badge(role_name(member.role)).into_any_element()
                    };
                    row(title, text(member.email.clone()), false, Some(control))
                })
                .collect(),
        };
        sections.push(
            ui::settings_section(
                t("Members", "Leden"),
                Some(
                    if can_manage {
                        t(
                            "Change roles or remove someone from the workspace.",
                            "Pas rollen aan of verwijder iemand uit de workspace.",
                        )
                    } else {
                        t(
                            "Only the owner and admins can manage members.",
                            "Alleen de eigenaar en beheerders kunnen leden beheren.",
                        )
                    }
                    .into(),
                ),
                rows,
            )
            .into_any_element(),
        );

        let invitations = self.members.as_ref().map(|members| members.invitations.clone()).unwrap_or_default();
        if !invitations.is_empty() {
            let rows = invitations
                .iter()
                .map(|invite| {
                    let (role, date) = (role_name(invite.role), day_and_month(invite.expires_at));
                    let control = can_manage.then(|| {
                        let resend_role = if invite.role == WorkspaceRole::Admin {
                            WorkspaceRole::Admin
                        } else {
                            WorkspaceRole::Member
                        };
                        let (email, invitation_id) = (invite.email.clone(), invite.id.clone());
                        let (resend_to, revoke_from) = (workspace.id.clone(), workspace.id.clone());
                        div()
                            .flex()
                            .items_center()
                            .gap(px(8.))
                            .child(
                                ui::button_with_icon(
                                    SharedString::from(format!("invite-resend-{}", invite.id)),
                                    "mail-01",
                                    t("Send again", "Opnieuw sturen"),
                                    ui::Variant::Outline,
                                )
                                .when(is_busy, ui::disabled)
                                .when(!is_busy, |el| {
                                    el.on_click(cx.listener(move |this, _, window, cx| {
                                        let email = email.clone();
                                        let to = email.clone();
                                        this.workspace_command(
                                            "resend",
                                            WorkspaceCommand::Invite {
                                                workspace_id: resend_to.clone(),
                                                email,
                                                role: resend_role,
                                            },
                                            window,
                                            cx,
                                            move |_, window, cx| {
                                                ui::toast(
                                                    t(
                                                        format!("Invitation sent again to {to}."),
                                                        format!("Uitnodiging opnieuw verstuurd naar {to}."),
                                                    ),
                                                    window,
                                                    cx,
                                                )
                                            },
                                        )
                                    }))
                                }),
                            )
                            .child(
                                ui::button(
                                    SharedString::from(format!("invite-revoke-{}", invite.id)),
                                    t("Revoke", "Intrekken"),
                                    ui::Variant::Ghost,
                                )
                                .when(is_busy, ui::disabled)
                                .when(!is_busy, |el| {
                                    el.on_click(cx.listener(move |this, _, window, cx| {
                                        this.workspace_command(
                                            "revoke",
                                            WorkspaceCommand::RevokeInvite {
                                                workspace_id: revoke_from.clone(),
                                                invitation_id: invitation_id.clone(),
                                            },
                                            window,
                                            cx,
                                            |_, _, _| {},
                                        )
                                    }))
                                }),
                            )
                            .into_any_element()
                    });
                    row(
                        invite.email.clone(),
                        text(t(
                            format!("{role} · valid until {date}"),
                            format!("{role} · geldig tot {date}"),
                        )),
                        false,
                        control,
                    )
                })
                .collect();
            sections.push(
                ui::settings_section(t("Pending invitations", "Openstaande uitnodigingen"), None, rows).into_any_element(),
            );
        }
        sections
    }

    /// The fields that hold the statuses' names, one per status, kept in step with the data.
    fn sync_status_names(&mut self, statuses: &[BoardStatus], window: &mut Window, cx: &mut Context<Self>) {
        self.settings
            .status_names
            .retain(|id, _| statuses.iter().any(|status| &status.id == id));
        for status in statuses {
            match self.settings.status_names.get_mut(&status.id) {
                Some(field) => {
                    // Renamed elsewhere: show the new name.
                    if field.shown != status.name && !field.input.read(cx).focus_handle(cx).is_focused(window) {
                        field.shown = status.name.clone();
                        let name = status.name.clone();
                        field.input.update(cx, |input, cx| input.set_value(name, window, cx));
                    }
                }
                None => {
                    let input = cx.new(|cx| InputState::new(window, cx).default_value(status.name.clone()));
                    let id = status.id.clone();
                    let events = cx.subscribe_in(&input, window, move |this, _, event: &InputEvent, window, cx| {
                        if matches!(event, InputEvent::Blur | InputEvent::PressEnter { .. }) {
                            this.commit_status_name(&id, window, cx);
                        }
                    });
                    self.settings.status_names.insert(
                        status.id.clone(),
                        StatusName {
                            input,
                            shown: status.name.clone(),
                            _events: events,
                        },
                    );
                }
            }
        }
    }

    /// The button that opens a colour menu (`.settings-swatch-button`).
    fn swatch(&self, key: SharedString, kind: MenuKind, icon: AnyElement, cx: &mut Context<Self>) -> impl IntoElement {
        let anchor = key.clone();
        let open = self.menu.as_ref().is_some_and(|menu| menu.anchor == key);
        div()
            .id(key.clone())
            .relative()
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
            .size(px(28.))
            .rounded(theme::RADIUS_MD)
            .cursor_pointer()
            .when(open, |el| el.bg(theme::muted_bg()))
            .hover(|el| el.bg(theme::muted_bg()))
            .child(kit::track(&self.tracked, key))
            .child(icon)
            .on_click(cx.listener(move |this, _, window, cx| this.open_menu(kind.clone(), anchor.clone(), window, cx)))
    }

    /// The "more" button of a status or project row.
    fn more(&self, key: SharedString, kind: MenuKind, cx: &mut Context<Self>) -> impl IntoElement {
        let anchor = key.clone();
        let open = self.menu.as_ref().is_some_and(|menu| menu.anchor == key);
        kit::icon_button(key.clone(), "more-horizontal", 28.)
            .relative()
            .when(open, |el| el.bg(theme::muted_bg()))
            .child(kit::track(&self.tracked, key))
            .on_click(cx.listener(move |this, _, window, cx| this.open_menu(kind.clone(), anchor.clone(), window, cx)))
    }

    /// board-settings.tsx `StatusesSettings`: the columns of every board, per category.
    fn render_statuses(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let statuses = sort_statuses(&self.data.statuses);
        self.sync_status_names(&statuses, window, cx);
        let usage = |id: &str| self.data.todos.iter().filter(|todo| todo.status_id.as_deref() == Some(id)).count();
        let mut groups = div().flex().flex_col().gap(px(16.)).p(px(12.));
        for category in StatusCategory::ALL {
            let name = category_name(category);
            let mut rows = div().flex().flex_col().gap(px(2.));
            for status in statuses.iter().filter(|status| status.category == category) {
                let Some(field) = self.settings.status_names.get(&status.id) else { continue };
                let focused = field.input.read(cx).focus_handle(cx).is_focused(window);
                let count = usage(&status.id);
                rows = rows.child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(6.))
                        .min_h(px(40.))
                        .px(px(4.))
                        .py(px(2.))
                        .rounded(px(10.))
                        .hover(|el| el.bg(theme::with_alpha(theme::muted_bg(), 0.55)))
                        .child(self.swatch(
                            SharedString::from(format!("status-color-{}", status.id)),
                            MenuKind::StatusColor(status.id.clone()),
                            kit::status_icon(Some(status.category), Some(&status.color), 16.).into_any_element(),
                            cx,
                        ))
                        .child(
                            // board-settings.tsx `NameInput`: no edge or fill until it is used.
                            div()
                                .id(SharedString::from(format!("status-name-{}", status.id)))
                                .flex()
                                .flex_1()
                                .min_w_0()
                                .items_center()
                                .h(px(32.))
                                .rounded(theme::RADIUS_MD)
                                .text_size(px(14.))
                                .when(focused, |el| el.bg(theme::with_alpha(theme::input(), 0.5)))
                                .hover(|el| el.bg(theme::with_alpha(theme::input(), 0.5)))
                                .child(Input::new(&field.input).appearance(false)),
                        )
                        .child(
                            div()
                                .flex_none()
                                .text_size(px(12.))
                                .text_color(theme::muted())
                                .child(format!("{count} {}", if count == 1 { "issue" } else { "issues" })),
                        )
                        .child(self.more(
                            SharedString::from(format!("status-options-{}", status.id)),
                            MenuKind::StatusOptions(status.id.clone()),
                            cx,
                        )),
                );
            }
            if let Some((_, input, _)) = self.settings.adding.as_ref().filter(|(adding, ..)| *adding == category) {
                let empty = input.read(cx).value().trim().is_empty();
                rows = rows.child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(6.))
                        .min_h(px(40.))
                        .px(px(4.))
                        .py(px(2.))
                        .on_action(cx.listener(|this, _: &Escape, _, cx| {
                            this.settings.adding = None;
                            cx.notify();
                        }))
                        .child(div().mx(px(6.)).child(kit::status_icon(Some(category), None, 16.)))
                        .child(div().flex_1().min_w_0().child(kit::field(input, window, cx)))
                        .child(
                            ui::button_sm("status-add-save", t("Add", "Toevoegen"), ui::Variant::Primary)
                                .when(empty, ui::disabled)
                                .when(!empty, |el| {
                                    el.on_click(cx.listener(|this, _, window, cx| this.add_status(window, cx)))
                                }),
                        )
                        .child(
                            ui::button_sm("status-add-cancel", t("Cancel", "Annuleren"), ui::Variant::Ghost).on_click(
                                cx.listener(|this, _, _, cx| {
                                    this.settings.adding = None;
                                    cx.notify();
                                }),
                            ),
                        ),
                );
            }
            groups = groups.child(
                div()
                    .flex()
                    .flex_col()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .px(px(2.))
                            .pb(px(4.))
                            .child(
                                div()
                                    .text_size(px(12.))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_color(theme::muted())
                                    .child(name.to_uppercase()),
                            )
                            .child(
                                kit::icon_button(SharedString::from(format!("status-add-{category:?}")), "add-01", 28.)
                                    .tooltip(ui::tip(t("Add status", "Status toevoegen")))
                                    .on_click(cx.listener(move |this, _, window, cx| {
                                        this.start_adding_status(category, window, cx)
                                    })),
                            ),
                    )
                    .child(rows),
            );
        }
        vec![ui::settings_section(
            t("Statuses", "Statussen"),
            Some(
                t(
                    "The columns of every board in this workspace, grouped like in Linear. Issues in Completed and Canceled count as done.",
                    "De kolommen van elk bord in deze workspace, gegroepeerd zoals in Linear. Issues in Afgerond en Geannuleerd tellen als klaar.",
                )
                .into(),
            ),
            vec![groups.into_any_element()],
        )
        .into_any_element()]
    }

    /// board-settings.tsx `ProjectsSettings`.
    fn render_projects(&mut self, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let projects: Vec<BoardProject> = self.data.projects.clone();
        let add = ui::button_sm("project-add", t("Add project", "Project toevoegen"), ui::Variant::Primary)
            .on_click(cx.listener(|this, _, window, cx| this.edit_project(None, window, cx)));
        let body: AnyElement = if projects.is_empty() {
            div()
                .flex()
                .flex_col()
                .items_center()
                .gap(px(4.))
                .px(px(24.))
                .py(px(40.))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .justify_center()
                        .size(px(36.))
                        .mb(px(8.))
                        .rounded(theme::RADIUS)
                        .bg(theme::muted_bg())
                        .child(theme::hi("folder-01").text_color(theme::muted())),
                )
                .child(
                    div()
                        .text_size(px(14.))
                        .font_weight(FontWeight::MEDIUM)
                        .child(t("No projects yet.", "Nog geen projecten.")),
                )
                .child(div().max_w(px(320.)).text_size(px(14.)).text_color(theme::muted()).child(t(
                    "Create a project to group issues from any board.",
                    "Maak een project om issues van alle borden te bundelen.",
                )))
                .into_any_element()
        } else {
            let mut rows = div().flex().flex_col().gap(px(2.)).p(px(8.));
            for project in &projects {
                let issues: Vec<&Todo> = self
                    .data
                    .todos
                    .iter()
                    .filter(|todo| todo.project_id.as_ref() == Some(&project.id) && todo.parent_id.is_none())
                    .collect();
                let done = issues.iter().filter(|issue| issue.completed).count();
                let count = issues.len();
                rows = rows.child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(10.))
                        .min_h(px(40.))
                        .px(px(4.))
                        .py(px(6.))
                        .rounded(px(10.))
                        .hover(|el| el.bg(theme::with_alpha(theme::muted_bg(), 0.55)))
                        .child(self.swatch(
                            SharedString::from(format!("project-color-{}", project.id)),
                            MenuKind::ProjectColor(project.id.clone()),
                            kit::project_dot(Some(&project.color), 16.),
                            cx,
                        ))
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .flex_1()
                                .min_w_0()
                                .child(
                                    div()
                                        .truncate()
                                        .text_size(px(14.))
                                        .font_weight(FontWeight::MEDIUM)
                                        .child(project.name.clone()),
                                )
                                .when(!project.description.is_empty(), |el| {
                                    el.child(
                                        div()
                                            .truncate()
                                            .text_size(px(12.))
                                            .text_color(theme::muted())
                                            .child(project.description.clone()),
                                    )
                                }),
                        )
                        .child(
                            div()
                                .flex()
                                .flex_none()
                                .items_center()
                                .gap(px(8.))
                                .w(px(150.))
                                .text_size(px(12.))
                                .text_color(theme::muted())
                                .child(div().flex_1().child(kit::progress(if count == 0 {
                                    0.
                                } else {
                                    done as f32 / count as f32 * 100.
                                })))
                                .child(format!("{count} {}", if count == 1 { "issue" } else { "issues" })),
                        )
                        .child(self.more(
                            SharedString::from(format!("project-options-{}", project.id)),
                            MenuKind::ProjectOptions(project.id.clone()),
                            cx,
                        )),
                );
            }
            rows.into_any_element()
        };
        vec![ui::settings_section_with(
            t("Projects", "Projecten"),
            Some(
                t(
                    "Group issues across boards. Every member can create and edit projects.",
                    "Groepeer issues over borden heen. Elk lid kan projecten maken en wijzigen.",
                )
                .into(),
            ),
            Some(add.into_any_element()),
            false,
            vec![body],
        )
        .into_any_element()]
    }

    // ─── The pages' dialogs ─────────────────────────────────────────────────

    pub(super) fn render_settings_dialog(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let Some(workspace) = self.active().cloned() else { return Vec::new() };
        let Some(dialog) = self.settings.dialog.take() else { return Vec::new() };
        let cancel = |id: &'static str, cx: &mut Context<Self>| {
            ui::button(id, t("Cancel", "Annuleren"), ui::Variant::Outline)
                .on_click(cx.listener(|this, _, window, cx| this.close_settings_dialog(window, cx)))
        };
        let element = match &dialog {
            SettingsDialog::Gone => {
                let owner = workspace.role == WorkspaceRole::Owner;
                let name = &workspace.name;
                let busy = self.settings.busy.is_some();
                let panel = dialog_panel("workspace-gone-dialog", window)
                    .key_context("TodoOverlay")
                    .track_focus(&self.overlay_focus)
                    .on_action(cx.listener(|this, _: &Dismiss, window, cx| this.close_settings_dialog(window, cx)))
                    .child(dialog_header(
                        if owner {
                            t(format!("Delete ‘{name}’?"), format!("‘{name}’ verwijderen?"))
                        } else {
                            t(format!("Leave ‘{name}’?"), format!("‘{name}’ verlaten?"))
                        },
                        Some(
                            if owner {
                                t(
                                    "All lists, tasks and notes in this workspace are permanently deleted, also for the other members.",
                                    "Alle lijsten, taken en notities in deze workspace worden definitief verwijderd, ook voor de andere leden.",
                                )
                            } else {
                                t(
                                    "You won’t see this workspace’s lists anymore.",
                                    "Je ziet de lijsten van deze workspace daarna niet meer.",
                                )
                            }
                            .into(),
                        ),
                        true,
                    ))
                    .child(
                        dialog_footer()
                            .child(cancel("workspace-gone-cancel", cx).when(busy, ui::disabled))
                            .child(
                                ui::button(
                                    "workspace-gone-confirm",
                                    if busy {
                                        t("Please wait…", "Even geduld…")
                                    } else if owner {
                                        t("Delete permanently", "Definitief verwijderen")
                                    } else {
                                        t("Leave", "Verlaten")
                                    },
                                    ui::Variant::Destructive,
                                )
                                .when(busy, ui::disabled)
                                .when(!busy, |el| {
                                    el.on_click(cx.listener(|this, _, window, cx| this.confirm_gone(window, cx)))
                                }),
                            ),
                    );
                modal(3, None, window, panel, |_, _, _| {})
            }
            SettingsDialog::DeleteStatus { id, replacement } => {
                let status = self.data.statuses.iter().find(|status| &status.id == id);
                let target = self.data.statuses.iter().find(|status| &status.id == replacement);
                let name = status.map(|status| status.name.clone()).unwrap_or_default();
                let count = self
                    .data
                    .todos
                    .iter()
                    .filter(|todo| todo.status_id.as_ref() == Some(id))
                    .count();
                let body = if count == 0 {
                    t("No issues use this status.".to_string(), "Geen issues gebruiken deze status.".to_string())
                } else if count == 1 {
                    t(
                        "1 issue uses this status. Choose where to move it.".to_string(),
                        "1 issue gebruikt deze status. Kies waar het naartoe gaat.".to_string(),
                    )
                } else {
                    t(
                        format!("{count} issues use this status. Choose where to move them."),
                        format!("{count} issues gebruiken deze status. Kies waar ze naartoe gaan."),
                    )
                };
                let (delete, to) = (id.clone(), replacement.clone());
                let panel = dialog_panel("status-delete-dialog", window)
                    .key_context("TodoOverlay")
                    .track_focus(&self.overlay_focus)
                    .on_action(cx.listener(|this, _: &Dismiss, window, cx| this.close_settings_dialog(window, cx)))
                    .child(dialog_header(
                        t(format!("Delete status “{name}”?"), format!("Status “{name}” verwijderen?")),
                        Some(body.into()),
                        true,
                    ))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(8.))
                            .child(
                                div()
                                    .text_size(px(14.))
                                    .font_weight(FontWeight::MEDIUM)
                                    .child(t("Move issues to", "Issues verplaatsen naar")),
                            )
                            .child(self.select_trigger(
                                "status-replacement",
                                target.map(|status| status.name.clone()).unwrap_or_default(),
                                target.map(|status| {
                                    kit::status_icon(Some(status.category), Some(&status.color), 14.).into_any_element()
                                }),
                                MenuKind::Replacement,
                                true,
                                false,
                                cx,
                            )),
                    )
                    .child(
                        dialog_footer().child(cancel("status-delete-cancel", cx)).child(
                            ui::button("status-delete-confirm", t("Delete", "Verwijderen"), ui::Variant::Destructive)
                                .on_click(cx.listener(move |this, _, window, cx| {
                                    this.settings.dialog = None;
                                    this.run(
                                        Command::DeleteStatus {
                                            id: delete.clone(),
                                            replacement_id: to.clone(),
                                        },
                                        window,
                                        cx,
                                    );
                                })),
                        ),
                    );
                modal(3, None, window, panel, |_, _, _| {})
            }
            SettingsDialog::Project(editor) => {
                let typed = editor.name.read(cx).value().trim().to_string();
                let title = match &editor.id {
                    Some(_) => t(format!("Edit {typed}"), format!("{typed} bewerken")),
                    None => t("Add project", "Project toevoegen").to_string(),
                };
                let focused = editor.description.read(cx).focus_handle(cx).is_focused(window);
                let panel = dialog_panel("project-dialog", window)
                    .key_context("TodoOverlay")
                    .child(dialog_header(
                        title,
                        Some(
                            t(
                                "Group issues across boards. Every member can create and edit projects.",
                                "Groepeer issues over borden heen. Elk lid kan projecten maken en wijzigen.",
                            )
                            .into(),
                        ),
                        false,
                    ))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(16.))
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(8.))
                                    .child(self.swatch(
                                        "project-editor-color".into(),
                                        MenuKind::EditingProjectColor,
                                        kit::project_dot(Some(&editor.color), 20.),
                                        cx,
                                    ))
                                    .child(kit::field(&editor.name, window, cx)),
                            )
                            .child(
                                // packages/ui textarea.tsx.
                                div()
                                    .min_h(px(64.))
                                    .rounded(theme::RADIUS_MD)
                                    .border_1()
                                    .border_color(if focused { theme::ring() } else { gpui_kit::transparent_black().into() })
                                    .bg(theme::with_alpha(theme::input(), 0.5))
                                    .text_size(px(14.))
                                    .child(Textarea::new(&editor.description).appearance(false)),
                            )
                            .child(dialog_footer().child(cancel("project-cancel", cx)).child(
                                ui::button(
                                    "project-save",
                                    if editor.id.is_some() { t("Save", "Opslaan") } else { t("Add", "Toevoegen") },
                                    ui::Variant::Primary,
                                )
                                .when(typed.is_empty(), ui::disabled)
                                .when(!typed.is_empty(), |el| {
                                    el.on_click(cx.listener(|this, _, window, cx| this.save_project(window, cx)))
                                }),
                            )),
                    )
                    .child(
                        dialog_close("project-close")
                            .on_click(cx.listener(|this, _, window, cx| this.close_settings_dialog(window, cx))),
                    );
                let panel = on_escape(panel, cx, |this, window, cx| this.close_settings_dialog(window, cx));
                modal(
                    3,
                    None,
                    window,
                    panel,
                    cx.listener(|this, _, window, cx| this.close_settings_dialog(window, cx)),
                )
            }
            SettingsDialog::DeleteProject(id) => {
                let name = self
                    .data
                    .projects
                    .iter()
                    .find(|project| &project.id == id)
                    .map(|project| project.name.clone())
                    .unwrap_or_default();
                let delete = id.clone();
                let panel = dialog_panel("project-delete-dialog", window)
                    .key_context("TodoOverlay")
                    .track_focus(&self.overlay_focus)
                    .on_action(cx.listener(|this, _: &Dismiss, window, cx| this.close_settings_dialog(window, cx)))
                    .child(dialog_header(
                        t(format!("Delete project “{name}”?"), format!("Project “{name}” verwijderen?")),
                        Some(
                            t(
                                "Its issues stay on their boards, without a project.",
                                "De issues blijven op hun borden staan, zonder project.",
                            )
                            .into(),
                        ),
                        true,
                    ))
                    .child(
                        dialog_footer().child(cancel("project-delete-cancel", cx)).child(
                            ui::button("project-delete-confirm", t("Delete", "Verwijderen"), ui::Variant::Destructive)
                                .on_click(cx.listener(move |this, _, window, cx| {
                                    this.settings.dialog = None;
                                    this.run(Command::DeleteProject { id: delete.clone() }, window, cx);
                                })),
                        ),
                    );
                modal(3, None, window, panel, |_, _, _| {})
            }
        };
        self.settings.dialog = Some(dialog);
        vec![element]
    }
}
