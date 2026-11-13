//! The overview (components/workspace-dashboard.tsx): a greeting and a grid
//! of widgets: the numbers, progress per list, what is in progress, the members.

use chrono::{Datelike as _, Timelike as _};

use super::core::sort_todos;
use super::kit::Check;
use super::*;

const MAX_AVATARS: usize = 5;

/// "Friday, November 13" or "vrijdag 13 november", as the web's
/// `Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" })`.
fn long_date(now: chrono::DateTime<chrono::Local>) -> String {
    match crate::i18n::lang() {
        crate::i18n::Lang::En => now.format_localized("%A, %B %-d", chrono::Locale::en_US).to_string(),
        crate::i18n::Lang::Nl => now.format_localized("%A %-d %B", chrono::Locale::nl_NL).to_string(),
    }
}

/// "November 13" or "13 november": the day an invitation runs out.
pub(super) fn day_and_month(date: chrono::DateTime<chrono::Utc>) -> String {
    let date = date.with_timezone(&chrono::Local);
    match crate::i18n::lang() {
        crate::i18n::Lang::En => date.format_localized("%B %-d", chrono::Locale::en_US).to_string(),
        crate::i18n::Lang::Nl => date.format_localized("%-d %B", chrono::Locale::nl_NL).to_string(),
    }
}

/// "Nov 13, 2026" or "13 nov 2026": when an issue was made.
pub(super) fn short_date(iso: &str) -> String {
    let Ok(date) = chrono::DateTime::parse_from_rfc3339(iso) else {
        return String::new();
    };
    let date = date.with_timezone(&chrono::Local);
    match crate::i18n::lang() {
        crate::i18n::Lang::En => date.format_localized("%b %-d, %Y", chrono::Locale::en_US).to_string(),
        crate::i18n::Lang::Nl => {
            let month = date.format_localized("%b", chrono::Locale::nl_NL).to_string();
            format!("{} {} {}", date.day(), month.trim_end_matches('.'), date.year())
        }
    }
}

fn widget(title: &'static str, action: Option<AnyElement>, content: impl IntoElement) -> Div {
    kit::card()
        .flex_1()
        .min_w_0()
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .gap(px(6.))
                .px(px(16.))
                .child(div().text_size(px(16.)).font_weight(FontWeight::MEDIUM).child(title))
                .when_some(action, |el, action| el.child(action)),
        )
        .child(div().px(px(16.)).child(content))
}

fn widget_empty(text: &'static str) -> Div {
    div().text_size(px(13.)).text_color(theme::muted()).child(text)
}

impl TodoApp {
    pub(super) fn render_dashboard(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let now = chrono::Local::now();
        let greeting = match now.hour() {
            0..=11 => t("Good morning", "Goedemorgen"),
            12..=17 => t("Good afternoon", "Goedemiddag"),
            _ => t("Good evening", "Goedenavond"),
        };
        let first_name = self.user.name.split_whitespace().next().unwrap_or("");
        let heading = if first_name.is_empty() {
            format!("{greeting}.")
        } else {
            format!("{greeting}, {first_name}.")
        };

        let lists = self.lists();
        let task_lists: Vec<&TodoList> = lists.iter().filter(|list| list.kind == ListKind::Todo).collect();
        let tasks: Vec<&Todo> = self
            .data
            .todos
            .iter()
            .filter(|todo| task_lists.iter().any(|list| list.id == todo.list_id))
            .collect();
        let open = tasks.iter().filter(|todo| !todo.completed).count();
        let busy = sort_todos(
            tasks
                .iter()
                .filter(|todo| !todo.completed && todo.in_progress)
                .map(|todo| (*todo).clone())
                .collect(),
        );
        let done = tasks.len() - open;

        let mut page = div()
            .flex()
            .flex_col()
            .w_full()
            .max_w(px(1040.))
            .px(px(36.))
            .pt(px(48.))
            .pb(px(72.))
            .children(self.render_sync_alert())
            .child(
                div()
                    .flex()
                    .flex_col()
                    .mb(px(28.))
                    .child(
                        div()
                            .text_size(px(28.))
                            .font_weight(FontWeight::SEMIBOLD)
                            .line_height(relative(1.3))
                            .child(heading),
                    )
                    .child(
                        div()
                            .mt(px(8.))
                            .text_size(px(13.))
                            .text_color(theme::muted())
                            .child(long_date(now)),
                    ),
            );

        if lists.is_empty() {
            page = page.child(
                kit::empty(
                    None,
                    t("What do you want to get done?", "Wat wil je even doen?"),
                    t("Create a list or a board for your tasks.", "Maak een lijst of een board voor je taken."),
                    Some(
                        ui::button_with_icon(
                            "dashboard-create",
                            "add-01",
                            t("Create a task list", "Een takenlijst maken"),
                            ui::Variant::Primary,
                        )
                        .on_click(cx.listener(|this, _, window, cx| this.new_list(ListKind::Todo, window, cx)))
                        .into_any_element(),
                    ),
                )
                .py(px(40.)),
            );
        } else {
            let stats = [
                (t("Open", "Open"), open),
                (t("In progress", "Mee bezig"), busy.len()),
                (t("Done", "Klaar"), done),
                (t("Lists", "Lijsten"), task_lists.len()),
            ];
            let stats = div().flex().gap(px(16.)).children(stats.map(|(label, value)| {
                kit::card().flex_1().min_w_0().child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(4.))
                        .px(px(16.))
                        .child(div().text_size(px(12.)).text_color(theme::muted()).child(label))
                        .child(
                            div()
                                .text_size(px(24.))
                                .font_weight(FontWeight::SEMIBOLD)
                                .line_height(relative(1.33))
                                .child(value.to_string()),
                        ),
                )
            }));

            let progress: AnyElement = if tasks.is_empty() {
                widget_empty(t(
                    "No tasks yet. Add some to a list.",
                    "Nog geen taken. Voeg er een paar toe aan een lijst.",
                ))
                .into_any_element()
            } else {
                let mut rows = div().flex().flex_col().gap(px(4.));
                for list in &task_lists {
                    let items: Vec<&&Todo> = tasks.iter().filter(|todo| todo.list_id == list.id).collect();
                    if items.is_empty() {
                        continue;
                    }
                    let finished = items.iter().filter(|todo| todo.completed).count();
                    let id = list.id.clone();
                    rows = rows.child(
                        div()
                            .id(SharedString::from(format!("progress-{}", list.id)))
                            .flex()
                            .flex_col()
                            .gap(px(8.))
                            .p(px(8.))
                            .mx(px(-8.))
                            .rounded(theme::RADIUS_MD)
                            .cursor_pointer()
                            .hover(|el| el.bg(theme::muted_bg()))
                            .child(
                                div()
                                    .flex()
                                    .items_end()
                                    .justify_between()
                                    .gap(px(12.))
                                    .child(div().min_w_0().truncate().child(list.name.clone()))
                                    .child(
                                        div()
                                            .flex_none()
                                            .text_size(px(12.))
                                            .text_color(theme::muted())
                                            .child(format!("{finished}/{}", items.len())),
                                    ),
                            )
                            .child(kit::progress(finished as f32 / items.len() as f32 * 100.))
                            .on_click(cx.listener(move |this, _, window, cx| this.select_list(&id, window, cx))),
                    );
                }
                rows.into_any_element()
            };

            let in_progress: AnyElement = if busy.is_empty() {
                widget_empty(t(
                    "Nothing in progress. Click a task's checkbox once to start it.",
                    "Nergens mee bezig. Klik één keer op het vinkje van een taak om te beginnen.",
                ))
                .into_any_element()
            } else {
                let mut rows = div().flex().flex_col();
                for todo in &busy {
                    let toggle = todo.id.clone();
                    let list_id = todo.list_id.clone();
                    let list_name = lists
                        .iter()
                        .find(|list| list.id == todo.list_id)
                        .map(|list| list.name.clone())
                        .unwrap_or_default();
                    let group = SharedString::from(format!("busy-row-{}", todo.id));
                    rows = rows.child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(12.))
                            .py(px(6.))
                            .child(
                                // Same cycle as in a list: to do → in progress → done.
                                kit::checkbox(SharedString::from(format!("busy-check-{}", todo.id)), Check::Busy, 16.)
                                    .on_click(cx.listener(move |this, _, window, cx| {
                                        this.toggle_task(&toggle, window, cx)
                                    })),
                            )
                            .child(
                                div()
                                    .id(SharedString::from(format!("busy-{}", todo.id)))
                                    .group(group.clone())
                                    .flex()
                                    .flex_col()
                                    .flex_1()
                                    .min_w_0()
                                    .cursor_pointer()
                                    .child(
                                        div()
                                            .truncate()
                                            .group_hover(group, |el| el.underline())
                                            .child(todo.title.clone()),
                                    )
                                    .child(
                                        div()
                                            .truncate()
                                            .text_size(px(12.))
                                            .text_color(theme::muted())
                                            .child(list_name),
                                    )
                                    .on_click(cx.listener(move |this, _, window, cx| {
                                        this.select_list(&list_id, window, cx)
                                    })),
                            ),
                    );
                }
                rows.into_any_element()
            };

            page = page.child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(16.))
                    .child(stats)
                    .child(
                        div()
                            .flex()
                            .gap(px(16.))
                            .child(widget(t("Progress per list", "Voortgang per lijst"), None, progress))
                            .child(widget(t("In progress", "Mee bezig"), None, in_progress)),
                    )
                    .child(
                        div()
                            .flex()
                            .gap(px(16.))
                            .child(self.render_members_widget(cx))
                            // The grid's second column stays empty beside the last widget.
                            .child(div().flex_1().min_w_0()),
                    ),
            );
        }
        div()
            .id("dashboard")
            .flex()
            .flex_1()
            .min_h_0()
            .justify_center()
            .overflow_y_scroll()
            .child(page)
    }

    fn render_members_widget(&self, cx: &mut Context<Self>) -> Div {
        let can_manage = self.active().is_some_and(|workspace| workspace.role.can_manage());
        let invite = can_manage.then(|| {
            div()
                .id("dashboard-invite")
                .flex()
                .flex_none()
                .items_center()
                .gap(px(6.))
                .h(px(28.))
                .px(px(8.))
                .rounded(theme::RADIUS_MD)
                .text_size(px(12.5))
                .font_weight(FontWeight::MEDIUM)
                .cursor_pointer()
                .hover(|el| el.bg(theme::muted_bg()))
                .child(theme::hi("user-add-01").text_color(theme::foreground()))
                .child(t("Invite", "Uitnodigen"))
                .on_click(cx.listener(|_, _, _, cx| cx.emit(AppEvent::OpenSettings(Some("members")))))
                .into_any_element()
        });
        let content: AnyElement = match &self.members {
            None => kit::skeleton().h(px(32.)).w(px(128.)).into_any_element(),
            Some(members) => {
                let list = &members.members;
                let ring = |inner: Div| {
                    // The ring that parts one avatar from the next.
                    div()
                        .flex()
                        .flex_none()
                        .items_center()
                        .justify_center()
                        .size(px(36.))
                        .m(px(-2.))
                        .rounded_full()
                        .bg(theme::card())
                        .child(
                            inner
                                .flex()
                                .items_center()
                                .justify_center()
                                .size(px(32.))
                                .rounded_full()
                                .bg(theme::muted_bg())
                                .text_size(px(14.))
                                .text_color(theme::muted()),
                        )
                };
                let mut avatars = div().flex().flex_none().items_center();
                for (index, member) in list.iter().take(MAX_AVATARS).enumerate() {
                    avatars = avatars.child(
                        ring(div().child(kit::initials(&member.name))).when(index > 0, |el| el.ml(px(-10.))),
                    );
                }
                if list.len() > MAX_AVATARS {
                    avatars = avatars.child(
                        ring(div().child(format!("+{}", list.len() - MAX_AVATARS))).ml(px(-10.)),
                    );
                }
                let count = list.len();
                div()
                    .flex()
                    .items_center()
                    .gap(px(12.))
                    .child(avatars)
                    .child(div().text_size(px(14.)).text_color(theme::muted()).child(t(
                        format!("{count} {}", if count == 1 { "member" } else { "members" }),
                        format!("{count} {}", if count == 1 { "lid" } else { "leden" }),
                    )))
                    .into_any_element()
            }
        };
        widget(t("Members", "Leden"), invite, content)
    }
}
