//! An advanced board (components/board/board-view.tsx): the toolbar with the
//! view and filters, the columns per status with their issue cards (dragged
//! from one column to another), the same issues as a list, and the dialog
//! for a new issue.

use std::path::PathBuf;

use gpui_kit::component::input::{InputEvent, Textarea, TextareaState};

use super::api::{BoardMember, BoardStatus, ListRole};
use super::core::{default_status, sort_issues, sort_statuses};
use super::overlay::{modal, on_escape, Target};
use super::*;

#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub(super) enum View {
    #[default]
    Board,
    List,
}

#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub(super) enum ProjectFilter {
    #[default]
    All,
    None,
    Project(String),
}

#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub(super) enum AssigneeFilter {
    #[default]
    All,
    Me,
    None,
    Member(String),
}

/// What the web keeps per open board: the view and "show sub-issues" are
/// remembered per board (localStorage there, the preferences here), the
/// filters last until another list opens.
#[derive(Default)]
pub(super) struct BoardState {
    list_id: Option<String>,
    pub view: View,
    pub project: ProjectFilter,
    pub assignee: AssigneeFilter,
    pub show_sub: bool,
}

impl BoardState {
    fn pref(list_id: &str, name: &str) -> String {
        format!("even-doen:board:{list_id}:{name}")
    }

    /// Reads the board's remembered view when another board opens.
    pub(super) fn open(&mut self, list_id: &str) {
        if self.list_id.as_deref() == Some(list_id) {
            return;
        }
        self.list_id = Some(list_id.to_string());
        self.view = match prefs::get(&Self::pref(list_id, "view")).as_deref() {
            Some("list") => View::List,
            _ => View::Board,
        };
        self.show_sub = prefs::get(&Self::pref(list_id, "sub")).as_deref() == Some("yes");
    }

    pub(super) fn reset_filters(&mut self) {
        self.list_id = None;
        self.project = ProjectFilter::All;
        self.assignee = AssigneeFilter::All;
    }

    fn set_view(&mut self, view: View) {
        self.view = view;
        if let Some(list_id) = &self.list_id {
            prefs::set(&Self::pref(list_id, "view"), if view == View::List { "list" } else { "board" });
        }
    }

    pub(super) fn set_show_sub(&mut self, show: bool) {
        self.show_sub = show;
        if let Some(list_id) = &self.list_id {
            prefs::set(&Self::pref(list_id, "sub"), if show { "yes" } else { "no" });
        }
    }
}

/// The issue being written in the new issue dialog.
pub(super) struct NewIssue {
    list_id: String,
    title: Entity<TextareaState>,
    description: Entity<TextareaState>,
    pub status_id: Option<String>,
    pub priority: u8,
    pub assignee_ids: Vec<String>,
    pub project_id: Option<String>,
    files: Vec<PathBuf>,
    expanded: bool,
    /// "Create more": keep the properties, start a fresh title.
    more: bool,
    _events: Vec<Subscription>,
}

struct Column {
    status: BoardStatus,
    issues: Vec<Todo>,
}

/// `color-mix(in oklab, top N%, base)`, near enough in sRGB for the board's quiet tints.
fn blend(top: Rgba, percent: f32, base: Rgba) -> Rgba {
    let amount = percent / 100.;
    Rgba {
        r: base.r + (top.r - base.r) * amount,
        g: base.g + (top.g - base.g) * amount,
        b: base.b + (top.b - base.b) * amount,
        a: 1.,
    }
}

impl TodoApp {
    fn board_columns(&self, list: &TodoList) -> (Vec<Column>, Vec<Todo>, usize) {
        let statuses = sort_statuses(&self.data.statuses);
        let all = self.todos_of(&list.id);
        let visible: Vec<Todo> = all
            .iter()
            .filter(|issue| {
                (self.board.show_sub || issue.parent_id.is_none())
                    && match &self.board.project {
                        ProjectFilter::All => true,
                        ProjectFilter::None => issue.project_id.is_none(),
                        ProjectFilter::Project(id) => issue.project_id.as_ref() == Some(id),
                    }
                    && match &self.board.assignee {
                        AssigneeFilter::All => true,
                        AssigneeFilter::None => issue.assignee_ids.is_empty(),
                        AssigneeFilter::Me => issue.assignee_ids.contains(&self.user.id),
                        AssigneeFilter::Member(id) => issue.assignee_ids.contains(id),
                    }
            })
            .cloned()
            .collect();
        // Issues whose status was removed show in the first column until moved.
        let fallback = statuses.first().map(|status| status.id.clone());
        let column_of = |issue: &Todo| match &issue.status_id {
            Some(id) if statuses.iter().any(|status| &status.id == id) => Some(id.clone()),
            _ => fallback.clone(),
        };
        let shown = visible.len();
        let columns = statuses
            .iter()
            .cloned()
            .map(|status| {
                let issues = sort_issues(
                    visible
                        .iter()
                        .filter(|issue| column_of(issue).as_ref() == Some(&status.id))
                        .cloned()
                        .collect(),
                );
                Column { status, issues }
            })
            .collect();
        (columns, all, shown)
    }

    pub(super) fn render_board_page(&mut self, list: &TodoList, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.board.open(&list.id);
        let read_only = list.role == ListRole::Viewer;
        let (columns, all, shown) = self.board_columns(list);
        let open = all.iter().filter(|issue| issue.parent_id.is_none() && !issue.completed).count();
        let filtered = self.board.project != ProjectFilter::All || self.board.assignee != AssigneeFilter::All;

        let content: AnyElement = if all.is_empty() {
            let create = (!read_only).then(|| {
                ui::button_with_icon("board-empty-new", "add-01", t("New issue", "Nieuw issue"), ui::Variant::Primary)
                    .on_click(cx.listener(|this, _, window, cx| this.new_issue(None, window, cx)))
                    .into_any_element()
            });
            div()
                .pr(px(32.))
                .child(
                    kit::empty(
                        Some(theme::hi("kanban").size(px(28.)).text_color(theme::muted()).into_any_element()),
                        t("No issues yet", "Nog geen issues"),
                        if read_only {
                            t("This board has no issues yet.", "Dit bord heeft nog geen issues.")
                        } else {
                            t(
                                "Create an issue and move it across the board as work progresses.",
                                "Maak een issue en schuif het over het bord naarmate het werk vordert.",
                            )
                        },
                        create,
                    )
                    .py(px(64.)),
                )
                .into_any_element()
        } else if self.board.view == View::Board {
            self.render_kanban(&columns, read_only, cx).into_any_element()
        } else {
            self.render_issue_list(&columns, read_only, cx).into_any_element()
        };

        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .pl(px(32.))
            .pt(px(48.))
            .children(self.render_sync_alert().map(|alert| div().pr(px(32.)).child(alert)))
            .child(self.render_list_heading(list, None, cx).pr(px(32.)).mb(px(12.)))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_h_0()
                    .child(self.render_board_toolbar(open, read_only, window, cx))
                    .child(content)
                    .when(filtered && !all.is_empty() && shown == 0, |el| {
                        el.child(
                            div()
                                .flex()
                                .flex_none()
                                .justify_center()
                                .pt(px(24.))
                                .pr(px(32.))
                                .pb(px(24.))
                                .text_size(px(13.))
                                .text_color(theme::muted())
                                .child(t("No issues match these filters.", "Geen issues met deze filters.")),
                        )
                    }),
            )
    }

    /// `.board-tool`: one control style for the whole toolbar: 28 points, quiet until used.
    fn board_tool(id: impl Into<ElementId>, icon: &str, label: impl Into<SharedString>, active: bool) -> Stateful<Div> {
        div()
            .id(id)
            .flex()
            .flex_none()
            .items_center()
            .gap(px(6.))
            .h(px(28.))
            .px(px(10.))
            .rounded(theme::RADIUS_MD)
            .text_size(px(12.5))
            .font_weight(FontWeight::MEDIUM)
            .cursor_pointer()
            .map(|el| {
                if active {
                    el.bg(theme::muted_bg()).text_color(theme::foreground())
                } else {
                    el.text_color(theme::muted())
                        .hover(|el| el.bg(theme::muted_bg()).text_color(theme::foreground()))
                }
            })
            .child(theme::hi(icon).size(px(14.)).text_color(if active { theme::foreground() } else { theme::muted() }))
            .child(label.into())
    }

    fn render_board_toolbar(&self, open: usize, read_only: bool, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let view = self.board.view;
        let filters = usize::from(self.board.project != ProjectFilter::All)
            + usize::from(self.board.assignee != AssigneeFilter::All)
            + usize::from(self.board.show_sub);
        let menu_open = self
            .menu
            .as_ref()
            .is_some_and(|menu| matches!(menu.kind, MenuKind::Filter));
        let mut left = div()
            .flex()
            .flex_wrap()
            .items_center()
            .gap(px(4.))
            .min_w_0()
            .child(
                div()
                    .flex()
                    .gap(px(2.))
                    .child(
                        Self::board_tool("board-view-board", "kanban", t("Board", "Bord"), view == View::Board).on_click(
                            cx.listener(|this, _, _, cx| {
                                this.board.set_view(View::Board);
                                cx.notify();
                            }),
                        ),
                    )
                    .child(
                        Self::board_tool(
                            "board-view-list",
                            "left-to-right-list-bullet",
                            t("List", "Lijst"),
                            view == View::List,
                        )
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.board.set_view(View::List);
                            cx.notify();
                        })),
                    ),
            )
            .child(div().flex_none().w(px(1.)).h(px(16.)).mx(px(6.)).bg(theme::border()))
            .child(
                Self::board_tool("board-filter", "filter", "Filter", menu_open)
                    .relative()
                    .when(filters > 0 && !menu_open, |el| el.text_color(theme::foreground()))
                    .child(kit::track(&self.tracked, "board-filter"))
                    .when(filters > 0, |el| {
                        el.child(
                            div()
                                .flex()
                                .items_center()
                                .justify_center()
                                .min_w(px(16.))
                                .h(px(16.))
                                .px(px(4.))
                                .rounded_full()
                                .bg(theme::primary())
                                .text_color(theme::primary_foreground())
                                .text_size(px(10.5))
                                .child(filters.to_string()),
                        )
                    })
                    .on_click(cx.listener(|this, _, window, cx| {
                        this.open_menu(MenuKind::Filter, "board-filter", window, cx)
                    })),
            );
        // Active filters as removable chips, like Linear.
        let chip = |id: &'static str, icon: AnyElement, label: SharedString| {
            div()
                .flex()
                .flex_none()
                .items_center()
                .gap(px(6.))
                .max_w(px(200.))
                .h(px(26.))
                .ml(px(4.))
                .pl(px(9.))
                .pr(px(3.))
                .rounded(theme::RADIUS_MD)
                .border_1()
                .border_color(theme::border())
                .text_size(px(12.5))
                .font_weight(FontWeight::MEDIUM)
                .child(icon)
                .child(div().min_w_0().truncate().child(label))
                .child(
                    div()
                        .id(id)
                        .flex()
                        .flex_none()
                        .items_center()
                        .justify_center()
                        .size(px(20.))
                        .rounded(theme::RADIUS_SM)
                        .cursor_pointer()
                        .hover(|el| el.bg(theme::muted_bg()))
                        .child(theme::hi("cancel-01").size(px(12.)).text_color(theme::muted())),
                )
        };
        if self.board.project != ProjectFilter::All {
            let project = match &self.board.project {
                ProjectFilter::Project(id) => self.data.projects.iter().find(|project| &project.id == id),
                _ => None,
            };
            let label: SharedString = match project {
                Some(project) => project.name.clone().into(),
                None => t("No project", "Geen project").into(),
            };
            left = left.child(
                chip(
                    "clear-project-filter",
                    kit::project_dot(project.map(|project| project.color.as_str()), 14.),
                    label,
                )
                .on_mouse_down(
                    MouseButton::Left,
                    cx.listener(|this, _, _, cx| {
                        this.board.project = ProjectFilter::All;
                        cx.notify();
                    }),
                ),
            );
        }
        if self.board.assignee != AssigneeFilter::All {
            let label: SharedString = match &self.board.assignee {
                AssigneeFilter::Me => t("Assigned to me", "Aan mij toegewezen").into(),
                AssigneeFilter::None => t("Unassigned", "Niet toegewezen").into(),
                AssigneeFilter::Member(id) => self
                    .data
                    .members
                    .iter()
                    .find(|member| &member.id == id)
                    .map(|member| member.name.clone())
                    .unwrap_or_default()
                    .into(),
                AssigneeFilter::All => "".into(),
            };
            left = left.child(
                chip(
                    "clear-assignee-filter",
                    theme::hi("user").size(px(14.)).text_color(theme::foreground()).into_any_element(),
                    label,
                )
                .on_mouse_down(
                    MouseButton::Left,
                    cx.listener(|this, _, _, cx| {
                        this.board.assignee = AssigneeFilter::All;
                        cx.notify();
                    }),
                ),
            );
        }
        let mut right = div().flex().flex_none().items_center().gap(px(4.)).child(
            div().text_size(px(12.5)).text_color(theme::muted()).child(t(
                format!("{open} open {}", if open == 1 { "issue" } else { "issues" }),
                format!("{open} open {}", if open == 1 { "issue" } else { "issues" }),
            )),
        );
        if !read_only {
            right = right.child(
                div()
                    .id("board-new-issue")
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(px(6.))
                    .h(px(28.))
                    .ml(px(8.))
                    .px(px(10.))
                    .rounded(theme::RADIUS_MD)
                    .bg(theme::primary())
                    .hover(|el| el.bg(blend(theme::foreground(), 12., theme::primary())))
                    .text_color(theme::primary_foreground())
                    .text_size(px(12.5))
                    .font_weight(FontWeight::MEDIUM)
                    .cursor_pointer()
                    .child(theme::hi("add-01").size(px(14.)).text_color(theme::primary_foreground()))
                    .child(t("New issue", "Nieuw issue"))
                    .on_click(cx.listener(|this, _, window, cx| this.new_issue(None, window, cx))),
            );
        }
        div()
            .flex()
            .flex_none()
            .flex_wrap()
            .items_center()
            .justify_between()
            .gap(px(12.))
            .pr(px(32.))
            .pb(px(10.))
            .mb(px(16.))
            .border_b_1()
            .border_color(theme::border())
            .child(left)
            .child(right)
    }

    /// The project, sub-issue and file chips on a card or a row.
    fn issue_chips(&self, issue: &Todo, compact: bool) -> Vec<Div> {
        let chip = || {
            div()
                .flex()
                .flex_none()
                .items_center()
                .gap(px(4.))
                .max_w(px(160.))
                .h(px(22.))
                .px(px(7.))
                .rounded_full()
                .border_1()
                .border_color(theme::border())
                .text_size(px(11.5))
                .text_color(theme::muted())
        };
        let mut chips = Vec::new();
        let priority = issue.priority.unwrap_or(0);
        if priority > 0 && !compact {
            chips.push(chip().child(kit::priority_icon(priority)));
        }
        if let Some(project) = self.data.projects.iter().find(|project| Some(&project.id) == issue.project_id.as_ref()) {
            chips.push(
                chip()
                    .child(kit::project_dot(Some(&project.color), 14.))
                    .child(div().min_w_0().truncate().child(project.name.clone())),
            );
        }
        let children: Vec<&Todo> = self
            .data
            .todos
            .iter()
            .filter(|todo| todo.parent_id.as_ref() == Some(&issue.id))
            .collect();
        if !children.is_empty() {
            let done = children.iter().filter(|child| child.completed).count();
            chips.push(
                chip()
                    .child(theme::hi("layers-01").size(px(14.)).text_color(theme::muted()))
                    .child(format!("{done}/{}", children.len())),
            );
        }
        if !issue.attachments.is_empty() {
            chips.push(
                chip()
                    .child(theme::hi("attachment-01").size(px(14.)).text_color(theme::muted()))
                    .child(issue.attachments.len().to_string()),
            );
        }
        chips
    }

    fn assignees_of<'a>(&'a self, issue: &Todo) -> Vec<&'a BoardMember> {
        self.data
            .members
            .iter()
            .filter(|member| issue.assignee_ids.contains(&member.id))
            .collect()
    }

    /// A column's header: the status, how many issues, and the add button.
    fn column_header(&self, column: &Column, read_only: bool, prefix: &'static str, cx: &mut Context<Self>) -> Div {
        let status_id = column.status.id.clone();
        let name = column.status.name.clone();
        div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(8.))
            .pl(px(12.))
            .pr(px(6.))
            .child(kit::status_icon(Some(column.status.category), Some(&column.status.color), 14.))
            .child(
                div()
                    .min_w_0()
                    .truncate()
                    .text_size(px(13.))
                    .font_weight(FontWeight::SEMIBOLD)
                    .child(column.status.name.clone()),
            )
            .child(
                div()
                    .flex_none()
                    .text_size(px(12.))
                    .text_color(theme::muted())
                    .child(column.issues.len().to_string()),
            )
            .when(!read_only, |el| {
                el.child(
                    kit::icon_button(SharedString::from(format!("{prefix}-add-{}", column.status.id)), "add-01", 28.)
                        .ml_auto()
                        .tooltip(ui::tip(t(
                            format!("Add issue to {name}"),
                            format!("Issue toevoegen aan {name}"),
                        )))
                        .on_click(cx.listener(move |this, _, window, cx| {
                            this.new_issue(Some(status_id.clone()), window, cx)
                        })),
                )
            })
    }

    /// board-view.tsx `target`: where in the column the pointer would drop.
    fn drop_target(&self, column: &Column, dragged: &str, y: Pixels) -> IssueDrop {
        let cards: Vec<&Todo> = column.issues.iter().filter(|issue| issue.id != dragged).collect();
        let before = cards.iter().find(|issue| {
            self.card_bounds
                .get(&issue.id)
                .is_some_and(|bounds| y < bounds.top() + bounds.size.height / 2.)
        });
        if let Some(before) = before {
            return IssueDrop {
                status_id: column.status.id.clone(),
                target_id: Some(before.id.clone()),
                placement: Some(Placement::Before),
            };
        }
        let last = cards.last();
        IssueDrop {
            status_id: column.status.id.clone(),
            target_id: last.map(|issue| issue.id.clone()),
            placement: last.map(|_| Placement::After),
        }
    }

    fn finish_issue_drop(&mut self, dragged: &str, window: &mut Window, cx: &mut Context<Self>) {
        let Some(drop) = self.issue_drop.take() else { return };
        self.run(
            Command::MoveIssue {
                id: dragged.to_string(),
                status_id: drop.status_id,
                target_id: drop.target_id,
                placement: drop.placement,
            },
            window,
            cx,
        );
    }

    fn render_kanban(&self, columns: &[Column], read_only: bool, cx: &mut Context<Self>) -> impl IntoElement {
        let dark = theme::is_dark();
        let dragging = cx.has_active_drag();
        let mut board = div()
            .id("kanban")
            .flex()
            .flex_1()
            .min_h_0()
            .gap(px(12.))
            .overflow_x_scroll()
            .pb(px(24.));
        for column in columns {
            let is_target = dragging && self.issue_drop.as_ref().is_some_and(|drop| drop.status_id == column.status.id);
            let mut cards = div()
                .id(SharedString::from(format!("kanban-cards-{}", column.status.id)))
                .flex()
                .flex_col()
                .flex_1()
                .min_h(px(60.))
                .gap(px(6.))
                .px(px(8.))
                .pt(px(2.))
                .pb(px(12.))
                .overflow_y_scroll();
            let line = || {
                div()
                    .flex_none()
                    .h(px(2.))
                    .mx(px(4.))
                    .my(px(-4.))
                    .rounded(px(2.))
                    .bg(theme::primary_mark())
            };
            for issue in &column.issues {
                let show_line = is_target
                    && self
                        .issue_drop
                        .as_ref()
                        .is_some_and(|drop| drop.target_id.as_ref() == Some(&issue.id));
                let placement = self.issue_drop.as_ref().and_then(|drop| drop.placement);
                if show_line && placement == Some(Placement::Before) {
                    cards = cards.child(line());
                }
                cards = cards.child(self.render_issue_card(issue, read_only, dark, cx));
                if show_line && placement == Some(Placement::After) {
                    cards = cards.child(line());
                }
            }
            if column.issues.is_empty() {
                cards = cards.child(
                    div()
                        .flex()
                        .flex_none()
                        .items_center()
                        .justify_center()
                        .h(px(64.))
                        .rounded(px(10.))
                        .border_1()
                        .border_dashed()
                        .border_color(if is_target { theme::primary_mark() } else { theme::border() })
                        .text_size(px(12.))
                        .text_color(if is_target { theme::foreground() } else { theme::muted() })
                        .child(t("No issues", "Geen issues")),
                );
            }
            let status_id = column.status.id.clone();
            let over = Column {
                status: column.status.clone(),
                issues: column.issues.clone(),
            };
            let mut panel = div()
                .id(SharedString::from(format!("kanban-column-{}", column.status.id)))
                .flex()
                .flex_col()
                .flex_none()
                .w(px(288.))
                .h_full()
                .min_h_0()
                .rounded(theme::RADIUS_XL)
                .bg(theme::with_alpha(theme::muted_bg(), if dark { 0.35 } else { 0.55 }))
                .border_1()
                .border_color(if is_target {
                    theme::with_alpha(theme::ring(), 0.6)
                } else {
                    gpui_kit::transparent_black().into()
                })
                .child(self.column_header(column, read_only, "kanban", cx).h(px(40.)))
                .child(cards);
            if !read_only {
                panel = panel
                    .on_drag_move(cx.listener(move |this, event: &DragMoveEvent<DragIssue>, _, cx| {
                        if !event.bounds.contains(&event.event.position) {
                            return;
                        }
                        let dragged = event.drag(cx).id.clone();
                        let next = this.drop_target(&over, &dragged, event.event.position.y);
                        if this.issue_drop.as_ref() != Some(&next) {
                            this.issue_drop = Some(next);
                            cx.notify();
                        }
                    }))
                    .on_drop(cx.listener(move |this, drag: &DragIssue, window, cx| {
                        // Dropped without a move over this column first: on top of it.
                        if this.issue_drop.as_ref().map(|drop| &drop.status_id) != Some(&status_id) {
                            this.issue_drop = Some(IssueDrop {
                                status_id: status_id.clone(),
                                target_id: None,
                                placement: None,
                            });
                        }
                        this.finish_issue_drop(&drag.id, window, cx);
                    }));
            }
            board = board.child(panel);
        }
        // The room the web's padding leaves at the right end of the scroller.
        board.child(div().flex_none().w(px(20.)))
    }

    /// `.issue-card`: the number and who has it, the title, the chips.
    fn render_issue_card(&self, issue: &Todo, read_only: bool, dark: bool, cx: &mut Context<Self>) -> impl IntoElement {
        let chips = self.issue_chips(issue, false);
        let assignees = self.assignees_of(issue);
        let id = issue.id.clone();
        let tracked = issue.id.clone();
        let drag = DragIssue {
            id: issue.id.clone(),
            title: issue.title.clone().into(),
        };
        let is_dragged = cx.has_active_drag() && self.dragged_issue.as_deref() == Some(issue.id.as_str());
        let (fill, edge, hover_fill, hover_edge) = if dark {
            (
                blend(theme::foreground(), 6., theme::background()),
                theme::with_alpha(theme::foreground(), 0.09),
                blend(theme::foreground(), 9., theme::background()),
                theme::with_alpha(theme::foreground(), 0.16),
            )
        } else {
            (
                theme::card(),
                theme::border(),
                theme::card(),
                blend(theme::foreground(), 22., theme::border()),
            )
        };
        div()
            .id(SharedString::from(format!("issue-card-{}", issue.id)))
            .flex()
            .flex_col()
            .flex_none()
            .gap(px(6.))
            .w_full()
            .px(px(12.))
            .py(px(10.))
            .rounded(px(10.))
            .bg(fill)
            .border_1()
            .border_color(edge)
            .hover(move |el| el.bg(hover_fill).border_color(hover_edge))
            .when(!dark, |el| el.shadow_xs())
            .when(is_dragged, |el| el.opacity(0.4))
            .cursor_pointer()
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .min_h(px(18.))
                    .child(
                        div()
                            .text_size(px(12.))
                            .text_color(theme::muted())
                            .child(format!("#{}", issue.number.unwrap_or(0))),
                    )
                    .children(kit::avatar_stack(&assignees, 18., 3)),
            )
            .child(
                div()
                    .text_size(px(13.5))
                    .line_height(relative(1.4))
                    .font_weight(FontWeight::MEDIUM)
                    .line_clamp(3)
                    .when(issue.completed, |el| el.text_color(theme::muted()))
                    .child(issue.title.clone()),
            )
            .when(!chips.is_empty(), |el| {
                el.child(div().flex().flex_wrap().gap(px(4.)).children(chips))
            })
            .on_click(cx.listener(move |this, _, window, cx| this.open_issue(&id, window, cx)))
            .when(!read_only, |el| {
                el.on_drag(drag, {
                    let app = cx.entity().downgrade();
                    move |drag, _, _, cx| {
                        let id = drag.id.clone();
                        let _ = app.update(cx, |this, _| this.dragged_issue = Some(id));
                        cx.new(|_| DragPreview {
                            label: drag.title.clone(),
                            width: px(264.),
                        })
                    }
                })
                // Where each card is, for the column to find the drop place.
                .on_drag_move(cx.listener(move |this, event: &DragMoveEvent<DragIssue>, _, _| {
                    this.card_bounds.insert(tracked.clone(), event.bounds);
                }))
            })
    }

    /// The same columns as a list (`IssueList`): a header per status, a row per issue.
    fn render_issue_list(&self, columns: &[Column], read_only: bool, cx: &mut Context<Self>) -> impl IntoElement {
        let mut list = div()
            .id("issue-list")
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .gap(px(12.))
            .overflow_y_scroll()
            .track_scroll(&self.issue_list_scroll)
            .pr(px(32.))
            .pb(px(32.));
        // `.issue-list-header { position: sticky; top: 0 }`: the header of the
        // status whose rows are passing under the top stays there, and is
        // pushed out by the next one. A section is its 36-point header, 4 of
        // room and 40-point rows 1 apart; sections are 12 apart.
        let scrolled = -f32::from(self.issue_list_scroll.offset().y);
        let mut stuck: Option<(&Column, f32)> = None;
        let mut top = 0.;
        for column in columns.iter().filter(|column| !column.issues.is_empty()) {
            let (place, height) = (top, section_height(column.issues.len()));
            top += height + 12.;
            if scrolled > place && scrolled < place + height {
                stuck = Some((column, (place + height - 36. - scrolled).min(0.)));
            }
        }
        for column in columns.iter().filter(|column| !column.issues.is_empty()) {
            let mut rows = div().flex().flex_col().gap(px(1.)).pt(px(4.));
            for issue in &column.issues {
                rows = rows.child(self.render_issue_row(issue, &column.status, read_only, cx));
            }
            list = list.child(
                div()
                    .flex()
                    .flex_col()
                    .flex_none()
                    .child(
                        self.column_header(column, read_only, "list", cx)
                            .h(px(36.))
                            .rounded(px(10.))
                            .bg(theme::muted_bg()),
                    )
                    .child(rows),
            );
        }
        div()
            .relative()
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .overflow_hidden()
            .child(list)
            .when_some(stuck, |el, (column, y)| {
                el.child(
                    div().absolute().top(px(y)).left_0().right(px(32.)).child(
                        self.column_header(column, read_only, "stuck", cx)
                            .h(px(36.))
                            .rounded(px(10.))
                            .bg(theme::muted_bg()),
                    ),
                )
            })
    }

    /// `.issue-row`: the row opens the issue; its priority and status buttons open their menus.
    fn render_issue_row(&self, issue: &Todo, status: &BoardStatus, read_only: bool, cx: &mut Context<Self>) -> impl IntoElement {
        let priority = issue.priority.unwrap_or(0);
        let group = SharedString::from(format!("issue-row-{}", issue.id));
        let assignees = self.assignees_of(issue);
        let open = issue.id.clone();
        let icon = |id: SharedString| {
            div()
                .id(id)
                .relative()
                .flex()
                .flex_none()
                .items_center()
                .justify_center()
                .size(px(24.))
                .rounded(theme::RADIUS_SM)
                .when(!read_only, |el| {
                    el.cursor_pointer()
                        .hover(|el| el.bg(theme::with_alpha(theme::foreground(), 0.1)))
                })
        };
        let priority_key = SharedString::from(format!("row-priority-{}", issue.id));
        let status_key = SharedString::from(format!("row-status-{}", issue.id));
        let priority_open = self.menu.as_ref().is_some_and(|menu| menu.anchor == priority_key);
        let priority_target = Target::Issue(issue.id.clone());
        let status_target = Target::Issue(issue.id.clone());
        let (priority_anchor, status_anchor) = (priority_key.clone(), status_key.clone());
        div()
            .id(SharedString::from(format!("issue-{}", issue.id)))
            .group(group.clone())
            .flex()
            .flex_none()
            .items_center()
            .gap(px(6.))
            .min_h(px(40.))
            .pl(px(6.))
            .pr(px(8.))
            .rounded(px(10.))
            .cursor_pointer()
            .hover(|el| el.bg(theme::with_alpha(theme::muted_bg(), 0.7)))
            .child(
                icon(priority_key.clone())
                    .child(kit::track(&self.tracked, priority_key))
                    .child(kit::priority_icon(priority))
                    // "No priority" stays quiet until the row is in use.
                    .when(priority == 0 && !priority_open, |el| {
                        el.invisible().group_hover(group, |el| el.visible())
                    })
                    .when(!read_only, |el| {
                        el.on_click(cx.listener(move |this, _, window, cx| {
                            cx.stop_propagation();
                            this.open_menu(MenuKind::Priority(priority_target.clone()), priority_anchor.clone(), window, cx)
                        }))
                    }),
            )
            .child(
                div()
                    .flex_none()
                    .text_size(px(12.))
                    .text_color(theme::muted())
                    .child(format!("#{}", issue.number.unwrap_or(0))),
            )
            .child(
                icon(status_key.clone())
                    .child(kit::track(&self.tracked, status_key))
                    .child(kit::status_icon(Some(status.category), Some(&status.color), 14.))
                    .when(!read_only, |el| {
                        el.on_click(cx.listener(move |this, _, window, cx| {
                            cx.stop_propagation();
                            this.open_menu(MenuKind::Status(status_target.clone()), status_anchor.clone(), window, cx)
                        }))
                    }),
            )
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .truncate()
                    .text_size(px(13.5))
                    .when(issue.completed, |el| el.text_color(theme::muted()))
                    .child(issue.title.clone()),
            )
            .child(div().flex().flex_none().gap(px(4.)).children(self.issue_chips(issue, true)))
            .children(kit::avatar_stack(&assignees, 20., 3))
            .on_click(cx.listener(move |this, _, window, cx| this.open_issue(&open, window, cx)))
    }

    // ─── The new issue dialog (`NewIssueDialog`) ────────────────────────────

    pub(super) fn new_issue(&mut self, status_id: Option<String>, window: &mut Window, cx: &mut Context<Self>) {
        let Some(list) = self.selected() else { return };
        let title = cx.new(|cx| {
            TextareaState::new(window, cx)
                .auto_grow(1, 6)
                .submit_on_enter(true)
                .placeholder(t("Issue title", "Titel van het issue"))
        });
        let description = cx.new(|cx| {
            TextareaState::new(window, cx)
                .auto_grow(3, 14)
                .placeholder(t("Add a description…", "Voeg een beschrijving toe…"))
        });
        let submit = |this: &mut Self, _: &Entity<TextareaState>, event: &InputEvent, window: &mut Window, cx: &mut Context<Self>| {
            match event {
                // ⌘↵ creates; a plain Enter in the title does nothing, as on the web.
                InputEvent::PressEnter { secondary: true, .. } => this.submit_issue(window, cx),
                InputEvent::Change => cx.notify(),
                _ => {}
            }
        };
        let events = vec![
            cx.subscribe_in(&title, window, submit),
            cx.subscribe_in(&description, window, submit),
        ];
        title.update(cx, |title, cx| title.focus(window, cx));
        let project_id = match &self.board.project {
            ProjectFilter::Project(id) => Some(id.clone()),
            _ => None,
        };
        let status_id = status_id.or_else(|| default_status(&self.data.statuses).map(|status| status.id));
        self.menu = None;
        self.dialog = Some(dialogs::Dialog::NewIssue(NewIssue {
            list_id: list.id,
            title,
            description,
            status_id,
            priority: 0,
            assignee_ids: Vec::new(),
            project_id,
            files: Vec::new(),
            expanded: false,
            more: false,
            _events: events,
        }));
        cx.notify();
    }

    pub(super) fn draft_issue(&mut self) -> Option<&mut NewIssue> {
        match &mut self.dialog {
            Some(dialogs::Dialog::NewIssue(issue)) => Some(issue),
            _ => None,
        }
    }

    pub(super) fn draft(&self) -> Option<&NewIssue> {
        match &self.dialog {
            Some(dialogs::Dialog::NewIssue(issue)) => Some(issue),
            _ => None,
        }
    }

    fn submit_issue(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(draft) = self.draft() else { return };
        let title = crate::workspace::clip(draft.title.read(cx).value().replace('\n', " ").trim(), 500);
        if title.is_empty() {
            return;
        }
        let description = draft.description.read(cx).value().trim().to_string();
        let id = api::new_id();
        let files = draft.files.clone();
        let more = draft.more;
        let command = Command::CreateIssue {
            id: id.clone(),
            list_id: draft.list_id.clone(),
            title,
            description: (!description.is_empty()).then_some(description),
            status_id: draft.status_id.clone(),
            project_id: draft.project_id.clone(),
            priority: Some(draft.priority),
            parent_id: None,
            assignee_ids: Some(draft.assignee_ids.clone()),
        };
        // Files need the issue on the server first.
        let after: Option<After> = (!files.is_empty()).then(|| {
            Box::new(move |this: &mut Self, saved: bool, window: &mut Window, cx: &mut Context<Self>| {
                if saved {
                    this.upload_files(id, files, false, window, cx);
                }
            }) as After
        });
        self.run_then(command, after, window, cx);
        if !more {
            self.close_dialog(window, cx);
            return;
        }
        // "Create more": keep the properties, start a fresh title.
        if let Some(draft) = self.draft_issue() {
            draft.files.clear();
            let (title, description) = (draft.title.clone(), draft.description.clone());
            description.update(cx, |input, cx| input.set_value("", window, cx));
            title.update(cx, |input, cx| {
                input.set_value("", window, cx);
                input.focus(window, cx);
            });
        }
        cx.notify();
    }

    /// The system's file dialog, then `then` with what was picked.
    pub(super) fn pick_files(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
        then: impl FnOnce(&mut Self, Vec<PathBuf>, &mut Window, &mut Context<Self>) + 'static,
    ) {
        let picked = cx.prompt_for_paths(PathPromptOptions {
            files: true,
            directories: false,
            multiple: true,
            prompt: None,
        });
        cx.spawn_in(window, async move |this, cx| {
            if let Ok(Ok(Some(paths))) = picked.await {
                let _ = this.update_in(cx, |this, window, cx| then(this, paths, window, cx));
            }
        })
        .detach();
    }

    fn render_chip(
        &self,
        key: &'static str,
        icon: AnyElement,
        label: SharedString,
        empty: bool,
        kind: MenuKind,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let open = self.menu.as_ref().is_some_and(|menu| menu.anchor.as_ref() == key);
        div()
            .id(key)
            .relative()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(6.))
            .h(px(26.))
            .px(px(9.))
            .rounded(theme::RADIUS_MD)
            .border_1()
            .border_color(theme::border())
            .text_size(px(12.5))
            .font_weight(FontWeight::MEDIUM)
            .cursor_pointer()
            .when(empty, |el| el.text_color(theme::muted()))
            .when(open, |el| el.bg(theme::muted_bg()))
            .hover(|el| el.bg(theme::muted_bg()).border_color(blend(theme::foreground(), 16., theme::border())))
            .child(kit::track(&self.tracked, key))
            .child(icon)
            .child(div().max_w(px(160.)).truncate().child(label))
            .on_click(cx.listener(move |this, _, window, cx| this.open_menu(kind.clone(), key, window, cx)))
    }

    pub(super) fn render_new_issue(&self, draft: &NewIssue, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let list_name = self
            .data
            .lists
            .iter()
            .find(|list| list.id == draft.list_id)
            .map(|list| list.name.clone())
            .unwrap_or_default();
        let status = self.data.statuses.iter().find(|status| Some(&status.id) == draft.status_id.as_ref());
        let project = self.data.projects.iter().find(|project| Some(&project.id) == draft.project_id.as_ref());
        let assignees: Vec<&BoardMember> = self
            .data
            .members
            .iter()
            .filter(|member| draft.assignee_ids.contains(&member.id))
            .collect();
        let blocked = draft.title.read(cx).value().trim().is_empty();
        let expanded = draft.expanded;

        let mut chips = div().flex().flex_wrap().gap(px(6.)).mt(px(14.)).child(self.render_chip(
            "new-issue-status",
            kit::status_icon(status.map(|status| status.category), status.map(|status| status.color.as_str()), 14.)
                .into_any_element(),
            status.map(|status| status.name.clone()).unwrap_or_default().into(),
            false,
            MenuKind::Status(Target::Draft),
            cx,
        ));
        chips = chips.child(self.render_chip(
            "new-issue-priority",
            kit::priority_icon(draft.priority).into_any_element(),
            if draft.priority > 0 {
                priority_name(draft.priority).into()
            } else {
                t("Priority", "Prioriteit").into()
            },
            draft.priority == 0,
            MenuKind::Priority(Target::Draft),
            cx,
        ));
        if !self.data.members.is_empty() {
            let icon = match kit::avatar_stack(&assignees, 16., 3) {
                Some(stack) => stack.into_any_element(),
                None => theme::hi("user").size(px(14.)).text_color(theme::muted()).into_any_element(),
            };
            let label: SharedString = match assignees.len() {
                0 => t("Assignee", "Toewijzen").into(),
                1 => assignees[0].label().to_string().into(),
                count => t(format!("{count} people"), format!("{count} personen")).into(),
            };
            chips = chips.child(self.render_chip(
                "new-issue-assignees",
                icon,
                label,
                assignees.is_empty(),
                MenuKind::Assignees(Target::Draft),
                cx,
            ));
        }
        chips = chips.child(self.render_chip(
            "new-issue-project",
            kit::project_dot(project.map(|project| project.color.as_str()), 14.),
            project.map(|project| project.name.clone()).unwrap_or_else(|| "Project".into()).into(),
            project.is_none(),
            MenuKind::Project(Target::Draft),
            cx,
        ));

        let mut body = div()
            .flex()
            .flex_col()
            .px(px(20.))
            .pt(px(4.))
            .pb(px(12.))
            .child(
                div()
                    .mx(px(-10.))
                    .min_h(px(28.))
                    .text_size(px(18.))
                    .font_weight(FontWeight::SEMIBOLD)
                    .line_height(relative(1.4))
                    .child(
                        Textarea::new(&draft.title)
                            .appearance(false)
                            .text_size(px(18.))
                            .line_height(relative(1.4))
                            .font_weight(FontWeight::SEMIBOLD),
                    ),
            )
            .child(
                div()
                    .mx(px(-10.))
                    .mt(px(6.))
                    .min_h(px(if expanded { 260. } else { 72. }))
                    .text_size(px(14.))
                    .line_height(relative(1.6))
                    .child(Textarea::new(&draft.description).appearance(false).text_size(px(14.)).line_height(relative(1.6))),
            )
            .child(chips);
        if !draft.files.is_empty() {
            let mut files = div().flex().flex_wrap().gap(px(6.)).mt(px(10.));
            for (index, path) in draft.files.iter().enumerate() {
                let name = path
                    .file_name()
                    .map(|name| name.to_string_lossy().to_string())
                    .unwrap_or_default();
                files = files.child(
                    div()
                        .flex()
                        .flex_none()
                        .items_center()
                        .gap(px(6.))
                        .max_w(px(240.))
                        .h(px(26.))
                        .pl(px(9.))
                        .pr(px(4.))
                        .rounded(theme::RADIUS_MD)
                        .bg(theme::muted_bg())
                        .text_size(px(12.))
                        .text_color(theme::muted())
                        .child(theme::hi("attachment-01").size(px(14.)).text_color(theme::muted()))
                        .child(div().min_w_0().truncate().child(name))
                        .child(
                            div()
                                .id(("new-issue-file", index))
                                .flex()
                                .flex_none()
                                .items_center()
                                .justify_center()
                                .size(px(18.))
                                .rounded(px(5.))
                                .cursor_pointer()
                                .hover(|el| el.bg(theme::with_alpha(theme::foreground(), 0.1)))
                                .child(theme::hi("cancel-01").size(px(12.)).text_color(theme::muted()))
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    if let Some(draft) = this.draft_issue() {
                                        if index < draft.files.len() {
                                            draft.files.remove(index);
                                        }
                                        cx.notify();
                                    }
                                })),
                        ),
                );
            }
            body = body.child(files);
        }

        let width = (window.viewport_size().width - px(32.)).min(px(if expanded { 920. } else { 680. }));
        let panel = div()
            .id("new-issue-dialog")
            .occlude()
            .key_context("TodoOverlay TodoNewIssue")
            .on_action(cx.listener(|this, _: &SubmitIssue, window, cx| this.submit_issue(window, cx)))
            .flex()
            .flex_col()
            .w(width)
            .rounded(theme::RADIUS_XL)
            .bg(theme::popover())
            .border_1()
            .border_color(theme::with_alpha(theme::foreground(), if theme::is_dark() { 0.1 } else { 0.05 }))
            .shadow_xl()
            .overflow_hidden()
            .font_family(theme::FONT)
            .text_size(px(14.))
            .text_color(theme::foreground())
            .child(
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(px(8.))
                    .h(px(48.))
                    .pl(px(16.))
                    .pr(px(10.))
                    .text_size(px(13.))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(6.))
                            .max_w(px(220.))
                            .h(px(24.))
                            .px(px(8.))
                            .rounded(theme::RADIUS_MD)
                            .border_1()
                            .border_color(theme::border())
                            .text_size(px(12.))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(theme::muted())
                            .child(theme::hi("kanban").size(px(14.)).text_color(theme::muted()))
                            .child(div().min_w_0().truncate().child(list_name)),
                    )
                    .child(div().text_color(theme::muted()).child("›"))
                    .child(div().font_weight(FontWeight::MEDIUM).child(t("New issue", "Nieuw issue")))
                    .child(
                        div()
                            .ml_auto()
                            .flex()
                            .items_center()
                            .gap(px(2.))
                            .child(
                                kit::icon_button(
                                    "new-issue-expand",
                                    if expanded { "arrow-shrink" } else { "arrow-expand" },
                                    28.,
                                )
                                .tooltip(ui::tip(if expanded {
                                    t("Collapse", "Kleiner maken")
                                } else {
                                    t("Expand", "Groter maken")
                                }))
                                .on_click(cx.listener(|this, _, _, cx| {
                                    if let Some(draft) = this.draft_issue() {
                                        draft.expanded = !draft.expanded;
                                        cx.notify();
                                    }
                                })),
                            )
                            .child(
                                kit::icon_button("new-issue-close", "cancel-01", 28.)
                                    .on_click(cx.listener(|this, _, window, cx| this.close_dialog(window, cx))),
                            ),
                    ),
            )
            .child(body)
            .child(
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(px(12.))
                    .py(px(10.))
                    .pl(px(14.))
                    .pr(px(12.))
                    .border_t_1()
                    .border_color(theme::border())
                    .child(
                        kit::icon_button("new-issue-attach", "attachment-01", 28.)
                            .tooltip(ui::tip(t("Add files", "Bestanden toevoegen")))
                            .on_click(cx.listener(|this, _, window, cx| {
                                this.pick_files(window, cx, |this, paths, _, cx| {
                                    if let Some(draft) = this.draft_issue() {
                                        draft.files.extend(paths);
                                        cx.notify();
                                    }
                                })
                            })),
                    )
                    .child(
                        div()
                            .id("new-issue-more")
                            .ml_auto()
                            .flex()
                            .items_center()
                            .gap(px(8.))
                            .text_size(px(12.5))
                            .text_color(theme::muted())
                            .cursor_pointer()
                            .child(kit::switch_sm("new-issue-more-switch", draft.more))
                            .child(t("Create more", "Meer maken"))
                            .on_click(cx.listener(|this, _, _, cx| {
                                if let Some(draft) = this.draft_issue() {
                                    draft.more = !draft.more;
                                    cx.notify();
                                }
                            })),
                    )
                    .child(
                        ui::button_sm("new-issue-create", t("Create issue", "Issue maken"), ui::Variant::Primary)
                            .when(blocked, ui::disabled)
                            .when(!blocked, |el| {
                                el.tooltip(ui::tip("⌘↵"))
                                    .on_click(cx.listener(|this, _, window, cx| this.submit_issue(window, cx)))
                            }),
                    ),
            );
        let panel = on_escape(panel, cx, |this, window, cx| this.close_dialog(window, cx));
        modal(
            1,
            Some(window.viewport_size().height * 0.14),
            window,
            panel,
            cx.listener(|this, _, window, cx| this.close_dialog(window, cx)),
        )
    }
}

/// How tall a status takes in the board's list view (`.issue-list section`):
/// its header (36), the room under it (4) and its rows (40 each, 1 apart).
fn section_height(rows: usize) -> f32 {
    36. + 4. + rows as f32 * 40. + rows.saturating_sub(1) as f32
}
