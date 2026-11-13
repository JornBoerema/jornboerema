//! What is in each menu (the web's DropdownMenus and Selects): the workspace
//! switcher's, a list's and a task's options, the board's status, priority,
//! project and assignee menus (components/board/board-meta.tsx), the toolbar's
//! filter, and the menus of the settings pages.

use super::api::{ShareRole, WorkspaceRole};
use super::board::{AssigneeFilter, ProjectFilter};
use super::core::{sort_statuses, PROJECT_COLORS, STATUS_COLORS};
use super::dialogs::Deletion;
use super::overlay::{Entry, Item, Look, Target};
use super::sidebar::workspace_avatar;
use super::*;

impl TodoApp {
    pub(super) fn menu_look(&self, kind: &MenuKind) -> Look {
        let look = |min_width: f32| Look {
            min_width,
            above: false,
            end: false,
            compact: false,
            fit: false,
        };
        match kind {
            MenuKind::Workspace => Look {
                above: true,
                fit: true,
                ..look(216.)
            },
            MenuKind::ListOptions | MenuKind::Task(_) | MenuKind::IssueOptions | MenuKind::ProjectOptions(_) => Look {
                end: true,
                ..look(128.)
            },
            MenuKind::StatusOptions(_) => Look {
                end: true,
                ..look(192.)
            },
            MenuKind::Status(_) | MenuKind::Project(_) => look(192.),
            MenuKind::Priority(_) => look(176.),
            MenuKind::Assignees(_) => look(224.),
            MenuKind::Filter => Look {
                compact: true,
                ..look(176.)
            },
            MenuKind::FilterProject | MenuKind::FilterAssignee => Look {
                compact: true,
                ..look(160.)
            },
            MenuKind::StatusColor(_) | MenuKind::ProjectColor(_) | MenuKind::EditingProjectColor => look(0.),
            MenuKind::ShareRole | MenuKind::InviteRole | MenuKind::MemberRole(_) | MenuKind::Replacement => Look {
                fit: true,
                ..look(144.)
            },
        }
    }

    /// The issue's current values, or the new issue dialog's.
    fn target_values(&self, target: &Target) -> (Option<String>, u8, Option<String>, Vec<String>) {
        match target {
            Target::Issue(id) => self
                .data
                .todos
                .iter()
                .find(|todo| &todo.id == id)
                .map(|todo| {
                    (
                        todo.status_id.clone(),
                        todo.priority.unwrap_or(0),
                        todo.project_id.clone(),
                        todo.assignee_ids.clone(),
                    )
                })
                .unwrap_or_default(),
            Target::Draft => self
                .draft()
                .map(|draft| {
                    (
                        draft.status_id.clone(),
                        draft.priority,
                        draft.project_id.clone(),
                        draft.assignee_ids.clone(),
                    )
                })
                .unwrap_or_default(),
        }
    }

    fn set_assignees(&mut self, target: &Target, ids: Vec<String>, window: &mut Window, cx: &mut Context<Self>) {
        match target {
            Target::Issue(id) => {
                let mut command = Command::update_issue(id);
                if let Command::UpdateIssue { assignee_ids, .. } = &mut command {
                    *assignee_ids = Some(ids);
                }
                self.run(command, window, cx);
            }
            Target::Draft => {
                if let Some(draft) = self.draft_issue() {
                    draft.assignee_ids = ids;
                }
            }
        }
        cx.notify();
    }

    /// The grid of colours of a status or a project (board-settings.tsx `ColorMenu`).
    fn color_grid(
        &self,
        colors: &'static [&'static str],
        value: &str,
        cx: &mut Context<Self>,
        pick: impl Fn(&mut Self, String, &mut Window, &mut Context<Self>) + Clone + 'static,
    ) -> Entry {
        // `grid grid-cols-5 gap-1.5` in a `p-2` panel: five of 28 with 6 between
        // (164), and 4 of room here beside the panel's own 4.
        let mut grid = div().flex().flex_wrap().gap(px(6.)).p(px(4.)).w(px(172.));
        for (index, color) in colors.iter().enumerate() {
            let pick = pick.clone();
            let selected = color.eq_ignore_ascii_case(value);
            grid = grid.child(
                div()
                    .id(("color", index))
                    .flex()
                    .flex_none()
                    .items_center()
                    .justify_center()
                    .size(px(28.))
                    .rounded(theme::RADIUS)
                    .cursor_pointer()
                    .hover(|el| el.bg(theme::accent()))
                    .child(
                        // The chosen colour wears a ring, as the web's outline.
                        div()
                            .flex()
                            .items_center()
                            .justify_center()
                            .size(px(24.))
                            .rounded_full()
                            .border_2()
                            .border_color(if selected { theme::ring() } else { gpui_kit::transparent_black().into() })
                            .child(div().size(px(16.)).rounded_full().bg(kit::hex(color))),
                    )
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.close_menu(window, cx);
                        pick(this, color.to_string(), window, cx);
                    })),
            );
        }
        Entry::Custom(grid.into_any_element())
    }

    /// The rows of a menu, from what the data says right now.
    pub(super) fn menu_entries(&self, kind: &MenuKind, _window: &mut Window, cx: &mut Context<Self>) -> Vec<Entry> {
        let mut entries = Vec::new();
        match kind {
            // components/workspace-switcher.tsx: in the desktop app only the workspaces.
            MenuKind::Workspace => {
                let active = self.active().map(|workspace| workspace.id.clone());
                entries.push(Entry::Label("Workspaces".into()));
                for workspace in self.workspaces.iter().flatten() {
                    let id = workspace.id.clone();
                    let mut item = Item::new(workspace.name.clone(), move |this, window, cx| {
                        this.select_workspace(&id, window, cx)
                    })
                    .icon(workspace_avatar(&workspace.name, true))
                    .checked(active.as_ref() == Some(&workspace.id));
                    if workspace.member_count > 1 {
                        item = item.hint(t(
                            format!("{} members", workspace.member_count),
                            format!("{} leden", workspace.member_count),
                        ));
                    }
                    entries.push(Entry::Item(item));
                }
                entries.push(Entry::Item(
                    Item::new(t("New workspace", "Nieuwe workspace"), |this, window, cx| {
                        this.new_workspace(window, cx)
                    })
                    .hi("add-01"),
                ));
            }
            MenuKind::ListOptions => {
                let Some(list) = self.selected() else { return entries };
                let done = self
                    .data
                    .todos
                    .iter()
                    .filter(|todo| todo.list_id == list.id && todo.completed)
                    .count();
                if list.kind == ListKind::Todo && list.role != api::ListRole::Viewer && done > 0 {
                    let list_id = list.id.clone();
                    entries.push(Entry::Item(
                        Item::new(t("Delete done tasks", "Klaar-taken verwijderen"), move |this, window, cx| {
                            this.ask_delete(
                                Deletion::ClearDone {
                                    list_id: list_id.clone(),
                                    count: done,
                                },
                                window,
                                cx,
                            )
                        })
                        .hi("tick-double-02"),
                    ));
                }
                if list.role == api::ListRole::Owner {
                    let label = if list.kind == ListKind::Board {
                        t("Delete board", "Bord verwijderen")
                    } else {
                        t("Delete list", "Lijst verwijderen")
                    };
                    entries.push(Entry::Item(
                        Item::new(label, move |this, window, cx| {
                            this.ask_delete(
                                Deletion::List {
                                    id: list.id.clone(),
                                    title: list.name.clone(),
                                },
                                window,
                                cx,
                            )
                        })
                        .hi("delete-02")
                        .destructive(),
                    ));
                }
            }
            MenuKind::Task(id) => {
                let (edit, delete) = (id.clone(), id.clone());
                entries.push(Entry::Item(
                    Item::new(t("Edit", "Bewerken"), move |this, window, cx| this.edit_task(&edit, window, cx))
                        .hi("pencil-edit-02"),
                ));
                entries.push(Entry::Item(
                    Item::new(t("Delete", "Verwijderen"), move |this, window, cx| {
                        this.ask_delete_task(&delete, window, cx)
                    })
                    .hi("delete-02")
                    .destructive(),
                ));
            }
            MenuKind::Status(target) => {
                let (current, ..) = self.target_values(target);
                entries.push(Entry::Label("Status".into()));
                for status in sort_statuses(&self.data.statuses) {
                    let target = target.clone();
                    let id = status.id.clone();
                    entries.push(Entry::Item(
                        Item::new(status.name.clone(), move |this, window, cx| match &target {
                            Target::Issue(issue) => {
                                let mut command = Command::update_issue(issue);
                                if let Command::UpdateIssue { status_id, .. } = &mut command {
                                    *status_id = Some(id.clone());
                                }
                                this.run(command, window, cx);
                            }
                            Target::Draft => {
                                if let Some(draft) = this.draft_issue() {
                                    draft.status_id = Some(id.clone());
                                }
                            }
                        })
                        .icon(kit::status_icon(Some(status.category), Some(&status.color), 14.))
                        .checked(current.as_ref() == Some(&status.id)),
                    ));
                }
            }
            MenuKind::Priority(target) => {
                let (_, current, ..) = self.target_values(target);
                entries.push(Entry::Label(t("Priority", "Prioriteit").into()));
                for level in 0..=4u8 {
                    let target = target.clone();
                    entries.push(Entry::Item(
                        Item::new(priority_name(level), move |this, window, cx| match &target {
                            Target::Issue(issue) => {
                                let mut command = Command::update_issue(issue);
                                if let Command::UpdateIssue { priority, .. } = &mut command {
                                    *priority = Some(level);
                                }
                                this.run(command, window, cx);
                            }
                            Target::Draft => {
                                if let Some(draft) = this.draft_issue() {
                                    draft.priority = level;
                                }
                            }
                        })
                        .icon(kit::priority_icon(level))
                        .checked(current == level),
                    ));
                }
            }
            MenuKind::Project(target) => {
                let (_, _, current, _) = self.target_values(target);
                entries.push(Entry::Label("Project".into()));
                let choices = std::iter::once(None).chain(self.data.projects.iter().map(Some));
                for project in choices {
                    let target = target.clone();
                    let id = project.map(|project| project.id.clone());
                    let label: SharedString = match project {
                        Some(project) => project.name.clone().into(),
                        None => t("No project", "Geen project").into(),
                    };
                    let checked = current == id;
                    entries.push(Entry::Item(
                        Item::new(label, move |this, window, cx| match &target {
                            Target::Issue(issue) => {
                                let mut command = Command::update_issue(issue);
                                if let Command::UpdateIssue { project_id, .. } = &mut command {
                                    *project_id = Some(id.clone());
                                }
                                this.run(command, window, cx);
                            }
                            Target::Draft => {
                                if let Some(draft) = this.draft_issue() {
                                    draft.project_id = id.clone();
                                }
                            }
                        })
                        .icon(kit::project_dot(project.map(|project| project.color.as_str()), 14.))
                        .checked(checked),
                    ));
                }
            }
            MenuKind::Assignees(target) => {
                let (.., current) = self.target_values(target);
                entries.push(Entry::Label(t("Assignees", "Toegewezen aan").into()));
                if self.data.members.is_empty() {
                    entries.push(Entry::Custom(
                        div()
                            .px(px(8.))
                            .py(px(6.))
                            .text_size(px(12.))
                            .text_color(theme::muted())
                            .child(t(
                                "Only workspace members can be assigned.",
                                "Alleen leden van de workspace kun je toewijzen.",
                            ))
                            .into_any_element(),
                    ));
                }
                for member in &self.data.members {
                    let target = target.clone();
                    let id = member.id.clone();
                    let checked = current.contains(&member.id);
                    entries.push(Entry::Item(
                        Item::new(member.label().to_string(), move |this, window, cx| {
                            let (.., mut ids) = this.target_values(&target);
                            if ids.contains(&id) {
                                ids.retain(|other| other != &id);
                            } else {
                                ids.push(id.clone());
                            }
                            this.set_assignees(&target, ids, window, cx);
                        })
                        .icon(kit::member_avatar(member, 18.))
                        .checked(checked)
                        // Stay open, so several people can be picked in one go.
                        .keep_open(),
                    ));
                }
                if !current.is_empty() {
                    let target = target.clone();
                    entries.push(Entry::Separator);
                    entries.push(Entry::Item(
                        Item::new(t("Unassigned", "Niet toegewezen"), move |this, window, cx| {
                            this.set_assignees(&target, Vec::new(), window, cx)
                        })
                        .checked(false),
                    ));
                }
            }
            MenuKind::Filter => {
                entries.push(Entry::Item(
                    Item::sub("Project", MenuKind::FilterProject).hi("folder-01"),
                ));
                if !self.data.members.is_empty() {
                    entries.push(Entry::Item(
                        Item::sub(t("Assignee", "Toegewezen aan"), MenuKind::FilterAssignee)
                            .hi("user"),
                    ));
                }
                entries.push(Entry::Separator);
                let show = self.board.show_sub;
                entries.push(Entry::Item(
                    Item::new(t("Show sub-issues", "Sub-issues tonen"), move |this, _, cx| {
                        this.board.set_show_sub(!show);
                        cx.notify();
                    })
                    .hi("layers-01")
                    .checked(show),
                ));
            }
            MenuKind::FilterProject => {
                let current = self.board.project.clone();
                let mut push = |label: SharedString, icon: Option<AnyElement>, filter: ProjectFilter| {
                    let checked = current == filter;
                    let mut item = Item::new(label, move |this, _, cx| {
                        this.board.project = filter.clone();
                        cx.notify();
                    })
                    .checked(checked);
                    item.icon = icon;
                    entries.push(Entry::Item(item));
                };
                push(t("All projects", "Alle projecten").into(), None, ProjectFilter::All);
                push(
                    t("No project", "Geen project").into(),
                    Some(kit::project_dot(None, 14.)),
                    ProjectFilter::None,
                );
                for project in &self.data.projects {
                    push(
                        project.name.clone().into(),
                        Some(kit::project_dot(Some(&project.color), 14.)),
                        ProjectFilter::Project(project.id.clone()),
                    );
                }
            }
            MenuKind::FilterAssignee => {
                let current = self.board.assignee.clone();
                let mut push = |label: SharedString, filter: AssigneeFilter| {
                    let checked = current == filter;
                    entries.push(Entry::Item(
                        Item::new(label, move |this, _, cx| {
                            this.board.assignee = filter.clone();
                            cx.notify();
                        })
                        .checked(checked),
                    ));
                };
                push(t("Everyone", "Iedereen").into(), AssigneeFilter::All);
                push(t("Assigned to me", "Aan mij toegewezen").into(), AssigneeFilter::Me);
                push(t("Unassigned", "Niet toegewezen").into(), AssigneeFilter::None);
                for member in self.data.members.iter().filter(|member| member.id != self.user.id) {
                    push(member.label().to_string().into(), AssigneeFilter::Member(member.id.clone()));
                }
            }
            MenuKind::IssueOptions => {
                entries.push(Entry::Item(
                    Item::new(t("Copy link", "Link kopiëren"), |this, window, cx| {
                        this.copy_open_issue_link(window, cx)
                    })
                    .hi("share-08"),
                ));
                let read_only = self.selected().is_some_and(|list| list.role == api::ListRole::Viewer);
                if !read_only {
                    entries.push(Entry::Item(
                        Item::new(t("Delete issue", "Issue verwijderen"), |this, window, cx| {
                            this.ask_delete_issue(window, cx)
                        })
                        .hi("delete-02")
                        .destructive(),
                    ));
                }
            }

            // ── components/settings/board-settings.tsx ──
            MenuKind::StatusOptions(id) => {
                let statuses = sort_statuses(&self.data.statuses);
                let Some(status) = statuses.iter().find(|status| &status.id == id).cloned() else {
                    return entries;
                };
                let group: Vec<&api::BoardStatus> = statuses
                    .iter()
                    .filter(|other| other.category == status.category)
                    .collect();
                let index = group.iter().position(|other| other.id == status.id).unwrap_or(0);
                let name = &status.name;
                let mut neighbour = |label: String, target: Option<&&api::BoardStatus>, placement: Placement| {
                    if let Some(target) = target {
                        let (id, target_id) = (status.id.clone(), target.id.clone());
                        entries.push(Entry::Item(Item::new(label, move |this, window, cx| {
                            this.run(
                                Command::MoveStatus {
                                    id: id.clone(),
                                    target_id: target_id.clone(),
                                    placement,
                                },
                                window,
                                cx,
                            )
                        })));
                    }
                };
                neighbour(
                    t(format!("Move {name} up"), format!("{name} omhoog")),
                    index.checked_sub(1).and_then(|previous| group.get(previous)),
                    Placement::Before,
                );
                neighbour(
                    t(format!("Move {name} down"), format!("{name} omlaag")),
                    group.get(index + 1),
                    Placement::After,
                );
                entries.push(Entry::Label(
                    t(format!("Category of {name}"), format!("Categorie van {name}")).into(),
                ));
                for category in StatusCategory::ALL {
                    let id = status.id.clone();
                    entries.push(Entry::Item(
                        Item::new(category_name(category), move |this, window, cx| {
                            this.run(
                                Command::UpdateStatus {
                                    id: id.clone(),
                                    name: None,
                                    category: Some(category),
                                    color: None,
                                },
                                window,
                                cx,
                            )
                        })
                        .icon(kit::status_icon(Some(category), Some(&status.color), 14.))
                        .checked(status.category == category),
                    ));
                }
                let id = status.id.clone();
                entries.push(Entry::Item(
                    Item::new(
                        t(format!("Delete {name}"), format!("{name} verwijderen")),
                        move |this, window, cx| this.ask_delete_status(&id, window, cx),
                    )
                    .hi("delete-02")
                    .destructive()
                    .disabled(statuses.len() < 2),
                ));
            }
            MenuKind::StatusColor(id) => {
                let Some(status) = self.data.statuses.iter().find(|status| &status.id == id) else {
                    return entries;
                };
                let id = id.clone();
                entries.push(self.color_grid(&STATUS_COLORS, &status.color, cx, move |this, color, window, cx| {
                    this.run(
                        Command::UpdateStatus {
                            id: id.clone(),
                            name: None,
                            category: None,
                            color: Some(color),
                        },
                        window,
                        cx,
                    )
                }));
            }
            MenuKind::ProjectColor(id) => {
                let Some(project) = self.data.projects.iter().find(|project| &project.id == id) else {
                    return entries;
                };
                let id = id.clone();
                entries.push(self.color_grid(&PROJECT_COLORS, &project.color, cx, move |this, color, window, cx| {
                    this.run(
                        Command::UpdateProject {
                            id: id.clone(),
                            name: None,
                            description: None,
                            color: Some(color),
                        },
                        window,
                        cx,
                    )
                }));
            }
            MenuKind::EditingProjectColor => {
                let color = self.settings.editing_project_color().unwrap_or_default();
                entries.push(self.color_grid(&PROJECT_COLORS, &color, cx, |this, color, _, cx| {
                    this.settings.set_editing_project_color(color);
                    cx.notify();
                }));
            }
            MenuKind::ProjectOptions(id) => {
                let Some(project) = self.data.projects.iter().find(|project| &project.id == id) else {
                    return entries;
                };
                let name = &project.name;
                let (edit, delete) = (id.clone(), id.clone());
                entries.push(Entry::Item(
                    Item::new(
                        t(format!("Edit {name}"), format!("{name} bewerken")),
                        move |this, window, cx| this.edit_project(Some(&edit), window, cx),
                    )
                    .hi("pencil-edit-02"),
                ));
                entries.push(Entry::Item(
                    Item::new(
                        t(format!("Delete {name}"), format!("{name} verwijderen")),
                        move |this, window, cx| this.ask_delete_project(&delete, window, cx),
                    )
                    .hi("delete-02")
                    .destructive(),
                ));
            }

            // ── The web's Selects ──
            MenuKind::ShareRole => {
                let current = self.share_role();
                for (role, label) in [
                    (ShareRole::Viewer, t("Can view", "Kan bekijken")),
                    (ShareRole::Editor, t("Can edit", "Kan bewerken")),
                ] {
                    entries.push(Entry::Item(
                        Item::new(label, move |this, window, cx| this.set_share_role(role, window, cx))
                            .checked(current == Some(role)),
                    ));
                }
            }
            MenuKind::InviteRole => {
                let current = self.settings.invite_role;
                for role in [WorkspaceRole::Member, WorkspaceRole::Admin] {
                    entries.push(Entry::Item(
                        Item::new(settings::role_name(role), move |this, _, cx| {
                            this.settings.invite_role = role;
                            cx.notify();
                        })
                        .checked(current == role),
                    ));
                }
            }
            MenuKind::MemberRole(member_id) => {
                let current = self
                    .members
                    .as_ref()
                    .and_then(|members| members.members.iter().find(|member| &member.id == member_id))
                    .map(|member| member.role);
                for role in [WorkspaceRole::Member, WorkspaceRole::Admin] {
                    let member_id = member_id.clone();
                    entries.push(Entry::Item(
                        Item::new(settings::role_name(role), move |this, window, cx| {
                            this.change_member_role(&member_id, role, window, cx)
                        })
                        .checked(current == Some(role)),
                    ));
                }
            }
            MenuKind::Replacement => {
                let (deleting, current) = self.settings.deleting_status().unwrap_or_default();
                for status in sort_statuses(&self.data.statuses) {
                    if status.id == deleting {
                        continue;
                    }
                    let id = status.id.clone();
                    entries.push(Entry::Item(
                        Item::new(status.name.clone(), move |this, _, cx| {
                            this.settings.set_replacement(id.clone());
                            cx.notify();
                        })
                        .icon(kit::status_icon(Some(status.category), Some(&status.color), 14.))
                        .checked(current == status.id),
                    ));
                }
            }
        }
        entries
    }

    /// packages/ui select.tsx `SelectTrigger`: the chosen value on the quiet
    /// fill, with the up-and-down arrows; its menu opens below.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn select_trigger(
        &self,
        key: impl Into<SharedString>,
        label: impl Into<SharedString>,
        icon: Option<AnyElement>,
        kind: MenuKind,
        full_width: bool,
        disabled: bool,
        cx: &mut Context<Self>,
    ) -> Stateful<Div> {
        let key: SharedString = key.into();
        let anchor = key.clone();
        div()
            .id(key.clone())
            .relative()
            .flex()
            .flex_none()
            .items_center()
            .justify_between()
            .gap(px(6.))
            .h(px(32.))
            .px(px(12.))
            .rounded(theme::RADIUS_MD)
            .bg(theme::with_alpha(theme::input(), 0.5))
            .text_size(px(14.))
            .when(full_width, |el| el.w_full())
            .child(kit::track(&self.tracked, key))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .min_w_0()
                    .children(icon)
                    .child(div().min_w_0().truncate().child(label.into())),
            )
            .child(theme::hi("unfold-more").text_color(theme::muted()))
            .map(|el| {
                if disabled {
                    el.opacity(0.5)
                } else {
                    el.cursor_pointer()
                        .on_click(cx.listener(move |this, _, window, cx| {
                            this.open_menu(kind.clone(), anchor.clone(), window, cx)
                        }))
                }
            })
    }
}
