//! A simple list (components/workspace-app.tsx, the part beside the sidebar,
//! and apps/todo-web/src/app.css): its name, the field for a new task and the
//! tasks in three groups: in progress, to do, done.

use gpui_kit::component::input::{Escape, Input};

use super::core::{sort_todos, task_status, TaskStatus};
use super::dialogs::Deletion;
use super::kit::Check;
use super::sidebar::{drag_over, finished_move};
use super::*;

impl TodoApp {
    /// The composer's Enter and its button.
    pub(super) fn add_task(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(list) = self.selected() else { return };
        let title: String = self.task_input.read(cx).value().trim().chars().take(500).collect();
        if title.is_empty() || list.role == api::ListRole::Viewer || list.kind != ListKind::Todo {
            return;
        }
        self.run(
            Command::CreateTodo {
                id: api::new_id(),
                list_id: list.id,
                title,
            },
            window,
            cx,
        );
        self.task_input.update(cx, |input, cx| {
            input.set_value("", window, cx);
            input.focus(window, cx);
        });
    }

    /// The checkbox's cycle: to do → in progress → done → to do.
    pub(super) fn toggle_task(&mut self, id: &str, window: &mut Window, cx: &mut Context<Self>) {
        let Some(todo) = self.data.todos.iter().find(|todo| todo.id == id) else { return };
        let command = Command::UpdateTodo {
            id: id.to_string(),
            title: None,
            completed: Some(!todo.completed && todo.in_progress),
            in_progress: Some(!todo.completed && !todo.in_progress),
        };
        self.run(command, window, cx);
    }

    /// The open list's tasks, in the order shown.
    fn list_items(&self, list_id: &str) -> Vec<Todo> {
        sort_todos(self.todos_of(list_id))
    }

    fn drag_todo_over(&mut self, dragged: &str, over: &str, cx: &mut Context<Self>) {
        let Some(list) = self.selected() else { return };
        let items = self.list_items(&list.id);
        let Some(status) = items.iter().find(|todo| todo.id == dragged).map(task_status) else { return };
        // A task moves within its own group only.
        let current: Vec<String> = items
            .iter()
            .filter(|todo| task_status(todo) == status)
            .map(|todo| todo.id.clone())
            .collect();
        if !current.iter().any(|id| id == over) {
            return;
        }
        if drag_over(&mut self.todo_order, current, dragged, over) {
            cx.notify();
        }
    }

    fn drop_todo(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some((id, order)) = self.todo_order.take() else { return };
        let Some(list) = self.selected() else { return };
        let items = self.list_items(&list.id);
        let Some(status) = items.iter().find(|todo| todo.id == id).map(task_status) else { return };
        let before: Vec<String> = items
            .iter()
            .filter(|todo| task_status(todo) == status)
            .map(|todo| todo.id.clone())
            .collect();
        if let Some((target_id, placement)) = finished_move(&order, &before, &id) {
            self.run(
                Command::MoveTodo {
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

    /// `.task-heading`: the list's name (double-click to rename), what is
    /// below it, and the share and options buttons at the right.
    pub(super) fn render_list_heading(
        &self,
        list: &TodoList,
        summary: Option<SharedString>,
        cx: &mut Context<Self>,
    ) -> Div {
        let owner = list.role == api::ListRole::Owner;
        let is_board = list.kind == ListKind::Board;
        let done = self
            .data
            .todos
            .iter()
            .filter(|todo| todo.list_id == list.id && todo.completed)
            .count();
        let can_clear = list.kind == ListKind::Todo && list.role != api::ListRole::Viewer && done > 0;
        let renaming = self
            .renaming
            .as_ref()
            .filter(|rename| rename.target == RenameTarget::List(list.id.clone()));

        let title = div()
            .id("list-title")
            .text_size(px(28.))
            .font_weight(FontWeight::SEMIBOLD)
            .line_height(relative(1.3));
        let title = match renaming {
            Some(rename) => title
                .on_action(cx.listener(|this, _: &Escape, window, cx| this.cancel_rename(window, cx)))
                .child(Input::new(&rename.input).appearance(false).text_size(px(28.)))
                .when_some(rename.error.clone(), |el, error| {
                    el.child(
                        div()
                            .text_size(px(14.))
                            .font_weight(FontWeight::NORMAL)
                            .text_color(theme::danger())
                            .child(error),
                    )
                }),
            None => {
                let id = list.id.clone();
                let name = list.name.clone();
                title
                    .child(list.name.clone())
                    .when(owner, |el| {
                        el.tooltip(ui::tip(t("Double-click to edit", "Dubbelklik om te bewerken")))
                            .on_click(cx.listener(move |this, event: &ClickEvent, window, cx| {
                                if event.click_count() == 2 {
                                    this.start_rename(RenameTarget::List(id.clone()), &name, 80, window, cx);
                                }
                            }))
                    })
            }
        };
        let quiet = |text: SharedString| div().mt(px(8.)).text_size(px(13.)).text_color(theme::muted()).child(text);
        let mut buttons = div().flex().flex_none().items_center().gap(px(4.));
        if owner {
            buttons = buttons.child(
                kit::icon_button("list-share", "share-08", 32.)
                    .tooltip(ui::tip(if is_board {
                        t("Share board", "Bord delen")
                    } else {
                        t("Share list", "Lijst delen")
                    }))
                    .on_click(cx.listener(|this, _, window, cx| this.share_list(window, cx))),
            );
        }
        if can_clear || owner {
            let open = self.menu.as_ref().is_some_and(|menu| menu.kind == MenuKind::ListOptions);
            buttons = buttons.child(
                kit::icon_button("list-options", "more-horizontal", 32.)
                    .relative()
                    .when(open, |el| el.bg(theme::muted_bg()))
                    .child(kit::track(&self.tracked, "list-options"))
                    .tooltip(ui::tip(t("List options", "Lijstopties")))
                    .on_click(cx.listener(|this, _, window, cx| {
                        this.open_menu(MenuKind::ListOptions, "list-options", window, cx)
                    })),
            );
        }
        div()
            .flex()
            .flex_none()
            .justify_between()
            .items_start()
            .gap(px(16.))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .child(title)
                    .when(list.role == api::ListRole::Viewer, |el| {
                        el.child(quiet(t("Read only", "Alleen lezen").into()))
                    })
                    .when_some(summary, |el, summary| el.child(quiet(summary))),
            )
            .child(buttons)
    }

    pub(super) fn render_list_page(&mut self, list: &TodoList, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let mut items = self.list_items(&list.id);
        // While a row is dragged its group shows in the dragged order.
        if let Some((_, order)) = &self.todo_order {
            let slots: Vec<usize> = (0..items.len()).filter(|index| order.contains(&items[*index].id)).collect();
            let mut group: Vec<Todo> = slots.iter().map(|index| items[*index].clone()).collect();
            group.sort_by_key(|todo| order.iter().position(|id| id == &todo.id));
            for (slot, todo) in slots.into_iter().zip(group) {
                items[slot] = todo;
            }
        }
        let can_edit = list.role != api::ListRole::Viewer;
        let remaining = items.iter().filter(|todo| !todo.completed).count();
        let summary: SharedString = if remaining == 0 && !items.is_empty() {
            t("All done. Nice work.", "Alles afgevinkt. Lekker gedaan.").into()
        } else {
            t(
                format!("{remaining} {} to do", if remaining == 1 { "task" } else { "tasks" }),
                format!("{remaining} {} te doen", if remaining == 1 { "taak" } else { "taken" }),
            )
            .into()
        };

        let mut page = div()
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .w_full()
            .max_w(px(800.))
            .px(px(36.))
            .pt(px(48.))
            .children(self.render_sync_alert())
            .child(self.render_list_heading(list, Some(summary), cx).mb(px(28.)));

        if can_edit {
            page = page.child(self.render_composer(window, cx));
        }
        if items.is_empty() {
            page = page.child(
                kit::empty(
                    Some(theme::hi("task-01").size(px(28.)).text_color(theme::muted()).into_any_element()),
                    t("An empty list, a fresh start", "Een lege lijst, een frisse start"),
                    if can_edit {
                        t("Add your first task above.", "Voeg hierboven je eerste taak toe.")
                    } else {
                        t("This list has no tasks yet.", "Deze lijst heeft nog geen taken.")
                    },
                    None,
                )
                .py(px(64.)),
            );
        } else {
            let any_busy = items.iter().any(|todo| task_status(todo) == TaskStatus::Busy);
            let dragged = self.todo_order.as_ref().map(|(id, _)| id.clone());
            let mut rows = div()
                .id("todo-list")
                .flex()
                .flex_col()
                .flex_1()
                .min_h_0()
                .overflow_y_scroll()
                .pb(px(24.))
                .on_drop(cx.listener(|this, _: &DragTodo, window, cx| this.drop_todo(window, cx)));
            for status in TaskStatus::ALL {
                let group: Vec<&Todo> = items.iter().filter(|todo| task_status(todo) == status).collect();
                if group.is_empty() {
                    continue;
                }
                if status != TaskStatus::Open || any_busy {
                    let name = match status {
                        TaskStatus::Busy => t("In progress", "Mee bezig"),
                        TaskStatus::Open => t("To do", "Te doen"),
                        TaskStatus::Done => t("Done", "Klaar"),
                    };
                    rows = rows.child(
                        div()
                            .flex()
                            .flex_none()
                            .items_center()
                            .gap(px(5.))
                            .px(px(4.))
                            .pt(px(28.))
                            .pb(px(8.))
                            .text_size(px(12.))
                            .text_color(theme::muted())
                            .child(name)
                            .child(group.len().to_string()),
                    );
                }
                for todo in group {
                    rows = rows.child(self.render_todo_row(todo, can_edit, dragged.as_deref() == Some(&todo.id), cx));
                }
            }
            page = page.child(rows);
        }
        div().flex().flex_1().min_h_0().justify_center().child(page)
    }

    /// `.task-composer`: the 48-point field with the add button at its end.
    fn render_composer(&self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let empty = self.task_input.read(cx).value().trim().is_empty();
        let focused = self.task_input.read(cx).focus_handle(cx).is_focused(window);
        div()
            .flex()
            .flex_none()
            .items_center()
            .h(px(48.))
            .mb(px(24.))
            .pr(px(8.))
            .rounded(theme::RADIUS_MD)
            .border_1()
            .border_color(if focused { theme::ring() } else { gpui_kit::transparent_black().into() })
            .bg(theme::with_alpha(theme::input(), 0.5))
            .text_size(px(14.))
            .child(div().flex_1().min_w_0().child(Input::new(&self.task_input).appearance(false)))
            .child(
                div()
                    .id("task-add")
                    .flex()
                    .flex_none()
                    .items_center()
                    .justify_center()
                    .size(px(32.))
                    .rounded(theme::RADIUS_MD)
                    .bg(theme::primary())
                    .child(theme::hi("add-01").text_color(theme::primary_foreground()))
                    .map(|el| {
                        if empty {
                            el.opacity(0.5)
                        } else {
                            el.cursor_pointer()
                                .hover(|el| el.bg(theme::with_alpha(theme::primary(), 0.9)))
                                .tooltip(ui::tip(t("Add task", "Taak toevoegen")))
                                .on_click(cx.listener(|this, _, window, cx| this.add_task(window, cx)))
                        }
                    }),
            )
    }

    /// `.todo-row`: the checkbox, the title (and the mail it came from), and
    /// the options that show while the pointer is on the row.
    fn render_todo_row(&self, todo: &Todo, can_edit: bool, dragged: bool, cx: &mut Context<Self>) -> impl IntoElement {
        let state = match task_status(todo) {
            TaskStatus::Done => Check::On,
            TaskStatus::Busy => Check::Busy,
            TaskStatus::Open => Check::Off,
        };
        let group = SharedString::from(format!("todo-row-{}", todo.id));
        let menu_key = SharedString::from(format!("task-{}", todo.id));
        let menu_open = self
            .menu
            .as_ref()
            .is_some_and(|menu| menu.kind == MenuKind::Task(todo.id.clone()));
        let renaming = self
            .renaming
            .as_ref()
            .filter(|rename| rename.target == RenameTarget::Todo(todo.id.clone()));

        let title = div()
            .id(SharedString::from(format!("todo-title-{}", todo.id)))
            .text_size(px(14.))
            .line_height(relative(1.6));
        let title = match renaming {
            Some(rename) => title
                .on_action(cx.listener(|this, _: &Escape, window, cx| this.cancel_rename(window, cx)))
                .child(Input::new(&rename.input).appearance(false))
                .when_some(rename.error.clone(), |el, error| {
                    el.child(div().text_size(px(14.)).text_color(theme::danger()).child(error))
                }),
            None => {
                let id = todo.id.clone();
                let text = todo.title.clone();
                title
                    .child(todo.title.clone())
                    .when(todo.completed, |el| {
                        el.text_color(theme::muted())
                            .line_through()
                            .text_decoration_color(theme::input())
                    })
                    .when(can_edit, |el| {
                        el.cursor_pointer()
                            .tooltip(ui::tip(t("Double-click to edit", "Dubbelklik om te bewerken")))
                            .on_click(cx.listener(move |this, event: &ClickEvent, window, cx| {
                                if event.click_count() == 2 {
                                    this.start_rename(RenameTarget::Todo(id.clone()), &text, 500, window, cx);
                                }
                            }))
                    })
            }
        };
        let mut body = div().flex().flex_col().flex_1().min_w_0().gap(px(2.)).child(title);
        if let Some(mail) = &todo.mail {
            // The mail a task was made from: one quiet line under its title.
            let subject = if mail.subject.is_empty() {
                t("(no subject)", "(geen onderwerp)").to_string()
            } else {
                mail.subject.clone()
            };
            let url = mail.url.clone();
            body = body.child(
                div()
                    .id(SharedString::from(format!("todo-mail-{}", todo.id)))
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .max_w_full()
                    .text_size(px(12.))
                    .line_height(relative(1.5))
                    .text_color(theme::muted())
                    .child(theme::hi("mail-01").size(px(13.)).text_color(theme::muted()))
                    .child(div().min_w_0().truncate().child(subject))
                    .when_some(mail.from.clone(), |el, from| {
                        el.child(div().min_w_0().max_w(relative(0.4)).truncate().child(format!("· {from}")))
                    })
                    .when_some(url, |el, url| {
                        el.cursor_pointer()
                            .hover(|el| el.text_color(theme::foreground()))
                            .on_click(cx.listener(move |_, _, _, cx| cx.open_url(&url)))
                    }),
            );
        }
        let toggle = todo.id.clone();
        let over = todo.id.clone();
        let menu_id = todo.id.clone();
        let anchor = menu_key.clone();
        let drag = DragTodo {
            id: todo.id.clone(),
            title: todo.title.clone().into(),
        };
        div()
            .id(SharedString::from(format!("todo-{}", todo.id)))
            .group(group.clone())
            .flex()
            .flex_none()
            .items_center()
            .min_h(px(56.))
            .gap(px(14.))
            .px(px(4.))
            .py(px(10.))
            .border_b_1()
            .border_color(theme::border())
            .when(dragged, |el| el.opacity(0.4))
            .child(
                kit::checkbox(SharedString::from(format!("check-{}", todo.id)), state, 18.)
                    .ml(px(4.))
                    .when(!can_edit, |el| el.opacity(0.5).cursor_default())
                    .when(can_edit, |el| {
                        el.on_click(cx.listener(move |this, _, window, cx| this.toggle_task(&toggle, window, cx)))
                    }),
            )
            .child(body)
            .when(can_edit, |el| {
                el.child(
                    kit::icon_button(menu_key.clone(), "more-horizontal", 32.)
                        .relative()
                        .child(kit::track(&self.tracked, menu_key))
                        .map(|el| {
                            if menu_open {
                                el.bg(theme::muted_bg())
                            } else {
                                el.invisible().group_hover(group, |el| el.visible())
                            }
                        })
                        .on_click(cx.listener(move |this, _, window, cx| {
                            this.open_menu(MenuKind::Task(menu_id.clone()), anchor.clone(), window, cx)
                        })),
                )
                .on_drag(drag, |drag, _, _, cx| {
                    cx.new(|_| DragPreview {
                        label: drag.title.clone(),
                        width: px(420.),
                    })
                })
                .on_drag_move(cx.listener(move |this, event: &DragMoveEvent<DragTodo>, _, cx| {
                    if event.bounds.contains(&event.event.position) {
                        let dragged = event.drag(cx).id.clone();
                        this.drag_todo_over(&dragged, &over, cx);
                    }
                }))
                .on_drop(cx.listener(|this, _: &DragTodo, window, cx| this.drop_todo(window, cx)))
            })
    }

    /// The page when there is no list at all (after the last one was deleted).
    pub(super) fn render_no_lists(&self, cx: &mut Context<Self>) -> impl IntoElement {
        div().flex().flex_1().min_h_0().justify_center().child(
            div()
                .flex()
                .flex_col()
                .w_full()
                .max_w(px(800.))
                .px(px(36.))
                .pt(px(48.))
                .children(self.render_sync_alert())
                .child(
                    kit::empty(
                        Some(theme::hi("task-01").size(px(32.)).text_color(theme::primary_mark()).into_any_element()),
                        t("Start with your first list", "Begin met je eerste lijst"),
                        t(
                            "For work, home or anything else you still want to do.",
                            "Voor werk, thuis of alles wat je nog wilt doen.",
                        ),
                        Some(
                            ui::button_with_icon(
                                "no-lists-create",
                                "add-01",
                                t("Create a new list", "Nieuwe lijst maken"),
                                ui::Variant::Primary,
                            )
                            .on_click(cx.listener(|this, _, window, cx| this.new_list(ListKind::Todo, window, cx)))
                            .into_any_element(),
                        ),
                    )
                    .py(px(80.)),
                ),
        )
    }

    /// The task's options menu asks before it deletes.
    pub(super) fn ask_delete_task(&mut self, id: &str, window: &mut Window, cx: &mut Context<Self>) {
        let Some(todo) = self.data.todos.iter().find(|todo| todo.id == id) else { return };
        let deletion = Deletion::Todo {
            id: todo.id.clone(),
            title: todo.title.clone(),
        };
        self.ask_delete(deletion, window, cx);
    }
}
