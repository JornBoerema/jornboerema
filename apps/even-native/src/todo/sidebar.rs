//! The sidebar of components/workspace-app.tsx (packages/ui/src/styles/sidebar.css):
//! the overview, the lists and the boards, each section with its add button,
//! and the workspace switcher (components/workspace-switcher.tsx) at its foot.
//! Rows can be dragged within their section (components/sortable.tsx).

use super::*;

/// The rows of a section while one is dragged: which one, and the order shown.
pub(super) type DraftOrder = Option<(String, Vec<String>)>;

/// The dragged row takes the place of the row the pointer is over, as the
/// web's Reorder.Group does. `current` is the order when the drag began.
pub(super) fn drag_over(order: &mut DraftOrder, current: Vec<String>, dragged: &str, over: &str) -> bool {
    if dragged == over {
        return false;
    }
    let (_, ids) = order.get_or_insert_with(|| (dragged.to_string(), current));
    let (Some(from), Some(to)) = (
        ids.iter().position(|id| id == dragged),
        ids.iter().position(|id| id == over),
    ) else {
        return false;
    };
    let id = ids.remove(from);
    ids.insert(to, id);
    true
}

/// sortable.tsx `finish`: the move that turns `before` into the dragged order.
pub(super) fn finished_move(order: &[String], before: &[String], id: &str) -> Option<(String, Placement)> {
    if order == before {
        return None;
    }
    let index = order.iter().position(|other| other == id)?;
    match (order.get(index + 1), index.checked_sub(1).and_then(|previous| order.get(previous))) {
        (Some(next), _) => Some((next.clone(), Placement::Before)),
        (None, Some(previous)) => Some((previous.clone(), Placement::After)),
        (None, None) => None,
    }
}

impl TodoApp {
    /// A section's lists, in the order shown: the dragged order while dragging.
    fn section(&self, kind: ListKind) -> Vec<TodoList> {
        let lists: Vec<TodoList> = self.lists().into_iter().filter(|list| list.kind == kind).collect();
        match &self.list_order {
            Some((_, order)) if lists.iter().all(|list| order.contains(&list.id)) => order
                .iter()
                .filter_map(|id| lists.iter().find(|list| &list.id == id).cloned())
                .collect(),
            _ => lists,
        }
    }

    fn drag_list_over(&mut self, dragged: &str, over: &str, cx: &mut Context<Self>) {
        let Some(kind) = self.lists().iter().find(|list| list.id == dragged).map(|list| list.kind) else { return };
        let current: Vec<String> = self
            .lists()
            .into_iter()
            .filter(|list| list.kind == kind)
            .map(|list| list.id)
            .collect();
        if !current.iter().any(|id| id == over) {
            return;
        }
        if drag_over(&mut self.list_order, current, dragged, over) {
            cx.notify();
        }
    }

    fn drop_list(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some((id, order)) = self.list_order.take() else { return };
        let Some(kind) = self.lists().iter().find(|list| list.id == id).map(|list| list.kind) else { return };
        let before: Vec<String> = self
            .lists()
            .into_iter()
            .filter(|list| list.kind == kind)
            .map(|list| list.id)
            .collect();
        if let Some((target_id, placement)) = finished_move(&order, &before, &id) {
            self.run(
                Command::MoveList {
                    id,
                    target_id,
                    placement,
                },
                window,
                cx,
            );
        }
        cx.notify();
    }

    /// ⌥↑ and ⌥↓: the open list one place up or down in its section.
    pub(super) fn step_list(&mut self, by: isize, window: &mut Window, cx: &mut Context<Self>) {
        let Some(list) = self.selected() else { return };
        let section = self.section(list.kind);
        let Some(index) = section.iter().position(|other| other.id == list.id) else { return };
        let Some(target) = index.checked_add_signed(by).and_then(|at| section.get(at)) else { return };
        self.run(
            Command::MoveList {
                id: list.id,
                target_id: target.id.clone(),
                placement: if by < 0 { Placement::Before } else { Placement::After },
            },
            window,
            cx,
        );
    }

    pub(super) fn render_sidebar(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let on_overview = self.selected_id.is_none();
        let selected = self.selected().map(|list| list.id);
        let dragged = self.list_order.as_ref().map(|(id, _)| id.clone());

        let overview = ui::list_link("nav-overview", "home-01", t("Overview", "Overzicht"), on_overview)
            .on_click(cx.listener(|this, _, window, cx| this.show_overview(window, cx)));

        let mut sections = div()
            .id("list-navigation")
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .gap(px(18.))
            .overflow_y_scroll()
            .on_drop(cx.listener(|this, _: &DragList, window, cx| this.drop_list(window, cx)))
            .child(div().flex().flex_col().flex_none().gap(px(2.)).child(overview));

        for kind in [ListKind::Todo, ListKind::Board] {
            let lists = self.section(kind);
            let (icon, heading, new_label, group) = if kind == ListKind::Board {
                ("kanban", t("Boards", "Borden"), t("New board", "Nieuw bord"), "sidebar-boards")
            } else {
                ("task-01", t("Lists", "Lijsten"), t("New list", "Nieuwe lijst"), "sidebar-lists")
            };
            // The add button appears on hover, so section headings stay calm.
            let add = ui::icon_button(SharedString::from(format!("{group}-add")), "add-01")
                .invisible()
                .group_hover(group, |el| el.visible())
                .tooltip(ui::tip(new_label))
                .on_click(cx.listener(move |this, _, window, cx| this.new_list(kind, window, cx)));
            let mut links = div().flex().flex_col().gap(px(2.));
            for list in &lists {
                let is_selected = !on_overview && selected.as_ref() == Some(&list.id);
                let open = self.open_count(&list.id);
                let id = list.id.clone();
                let over = list.id.clone();
                let drag = DragList {
                    id: list.id.clone(),
                    name: list.name.clone().into(),
                };
                links = links.child(
                    ui::list_link(SharedString::from(format!("list-{}", list.id)), icon, list.name.clone(), is_selected)
                        // Only show a count when there is something left to do.
                        .when(open > 0, |el| el.child(ui::list_count(open.to_string())))
                        .when(dragged.as_ref() == Some(&list.id), |el| el.opacity(0.4))
                        .on_click(cx.listener(move |this, _, window, cx| this.select_list(&id, window, cx)))
                        .on_drag(drag, |drag, _, _, cx| {
                            cx.new(|_| DragPreview {
                                label: drag.name.clone(),
                                width: px(216.),
                            })
                        })
                        .on_drag_move(cx.listener(move |this, event: &DragMoveEvent<DragList>, _, cx| {
                            if event.bounds.contains(&event.event.position) {
                                let dragged = event.drag(cx).id.clone();
                                this.drag_list_over(&dragged, &over, cx);
                            }
                        }))
                        .on_drop(cx.listener(|this, _: &DragList, window, cx| this.drop_list(window, cx))),
                );
            }
            if lists.is_empty() {
                links = links.child(
                    // `.list-link.is-ghost`: quiet until the pointer is on it.
                    div()
                        .id(SharedString::from(format!("{group}-new")))
                        .flex()
                        .flex_none()
                        .items_center()
                        .gap(px(10.))
                        .w_full()
                        .min_h(px(34.))
                        .px(px(10.))
                        .py(px(6.))
                        .text_size(px(14.))
                        .rounded(theme::RADIUS)
                        .cursor_pointer()
                        .text_color(theme::muted())
                        .hover(|el| el.bg(theme::muted_bg()).text_color(theme::foreground()))
                        .child(theme::hi("add-01").text_color(theme::muted()))
                        .child(new_label)
                        .on_click(cx.listener(move |this, _, window, cx| this.new_list(kind, window, cx))),
                );
            }
            sections = sections.child(
                div()
                    .group(group)
                    .flex()
                    .flex_col()
                    .flex_none()
                    .min_w_0()
                    .child(ui::sidebar_heading(heading).child(add))
                    .child(links),
            );
        }

        div().flex().flex_none().h_full().py(px(8.)).pl(px(4.)).pr(px(8.)).child(
            ui::list_sidebar()
                .h_full()
                .child(
                    div()
                        .flex_none()
                        .pl(px(10.))
                        .pb(px(22.))
                        .child(crate::workspace::brand("tick-02", "Even doen")),
                )
                .child(sections)
                .children(self.render_switcher(cx)),
        )
    }

    /// components/workspace-switcher.tsx: the open workspace and who is
    /// signed in; its menu switches workspace or makes a new one. Settings
    /// and signing out are the rail's, as in the Tauri app.
    fn render_switcher(&self, cx: &mut Context<Self>) -> Option<Div> {
        let active = self.active()?;
        let open = self.menu.as_ref().is_some_and(|menu| menu.kind == MenuKind::Workspace);
        Some(
            div().flex_none().pt(px(12.)).child(
                div()
                    .id("workspace-switcher")
                    .relative()
                    .flex()
                    .items_center()
                    .gap(px(10.))
                    .w_full()
                    .px(px(10.))
                    .py(px(8.))
                    .rounded(theme::RADIUS)
                    .text_size(px(14.))
                    .font_weight(FontWeight(550.))
                    .cursor_pointer()
                    .when(open, |el| el.bg(theme::muted_bg()))
                    .hover(|el| el.bg(theme::muted_bg()))
                    .child(kit::track(&self.tracked, "workspace-switcher"))
                    .child(workspace_avatar(&active.name, false))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .flex_1()
                            .min_w_0()
                            .child(div().truncate().child(active.name.clone()))
                            .child(
                                div()
                                    .truncate()
                                    .text_size(px(12.))
                                    .font_weight(FontWeight::NORMAL)
                                    .text_color(theme::muted())
                                    .child(self.user.name.clone()),
                            ),
                    )
                    .child(theme::hi("unfold-more").text_color(theme::muted()))
                    .on_click(cx.listener(|this, _, window, cx| {
                        this.open_menu(MenuKind::Workspace, "workspace-switcher", window, cx)
                    })),
            ),
        )
    }
}

/// `.workspace-avatar`: the workspace's first letter on the accent.
pub(super) fn workspace_avatar(name: &str, small: bool) -> Div {
    let letter: String = name.trim().chars().next().map(|c| c.to_uppercase().collect()).unwrap_or_default();
    div()
        .flex()
        .flex_none()
        .items_center()
        .justify_center()
        .size(px(if small { 20. } else { 24. }))
        .rounded(px(if small { 6. } else { 7. }))
        .bg(theme::primary())
        .text_color(theme::primary_foreground())
        .text_size(px(if small { 11. } else { 12. }))
        .font_weight(FontWeight(650.))
        .child(letter)
}

#[cfg(test)]
mod tests {
    // Not `super::*`: GPUI's own `test` macro would shadow Rust's.
    use super::{drag_over, finished_move};
    use crate::todo::api::Placement;

    fn ids(names: &[&str]) -> Vec<String> {
        names.iter().map(|name| name.to_string()).collect()
    }

    #[test]
    fn a_dragged_row_takes_the_place_it_is_over() {
        let mut order = None;
        assert!(drag_over(&mut order, ids(&["a", "b", "c"]), "a", "c"));
        assert_eq!(order.as_ref().unwrap().1, ids(&["b", "c", "a"]));
        assert!(drag_over(&mut order, ids(&["a", "b", "c"]), "a", "b"));
        assert_eq!(order.as_ref().unwrap().1, ids(&["a", "b", "c"]));
    }

    #[test]
    fn the_finished_move_names_a_neighbour() {
        let before = ids(&["a", "b", "c"]);
        assert_eq!(
            finished_move(&ids(&["b", "c", "a"]), &before, "a"),
            Some(("c".to_string(), Placement::After))
        );
        assert_eq!(
            finished_move(&ids(&["c", "a", "b"]), &before, "c"),
            Some(("a".to_string(), Placement::Before))
        );
        assert_eq!(finished_move(&before, &before, "a"), None);
    }
}
