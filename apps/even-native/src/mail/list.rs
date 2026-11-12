//! The conversation list: one fixed height per row, so only what shows is laid out.

use std::collections::HashMap;
use std::ops::Range;

use crate::api::Thread;
use crate::theme;

use super::*;

impl MailView {
    pub(super) fn render_rows(
        &mut self,
        range: Range<usize>,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) -> Vec<AnyElement> {
        // Nearly at the end of what is loaded: fetch the next page. Results come in one go.
        if self.search.is_none() && range.end + 20 >= self.threads.len() {
            self.load(false, cx);
        }
        let several = self.accounts.len() > 1;
        let colors: HashMap<&str, usize> = self.accounts.iter().map(|a| (a.id.as_str(), a.color)).collect();
        range
            .filter_map(|index| {
                let thread = self.rows().get(index)?;
                let open = self.open.as_deref() == Some(thread.id.as_str());
                let color = several
                    .then(|| colors.get(thread.account_id.as_str()).copied())
                    .flatten();
                Some(row(index, thread, open, color, cx).into_any_element())
            })
            .collect()
    }

    pub(super) fn render_list(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let field = self.render_search_field(window, cx);
        if let Some(search) = &self.search {
            return pane()
                .child(self.render_search_header(search, cx))
                .child(field)
                .child(self.render_results(search, cx));
        }
        let count = self.threads.len();
        let header = div()
            .flex()
            .items_center()
            .justify_between()
            .h(px(TITLE_BAR))
            .flex_none()
            .px_4()
            .child(
                div()
                    .text_sm()
                    .font_weight(FontWeight::MEDIUM)
                    .child(folder_name(self.folder)),
            )
            .child(
                div().flex().items_center().gap_2().child(
                    div()
                        .id("refresh")
                        .flex()
                        .items_center()
                        .justify_center()
                        .size(px(28.))
                        .rounded_md()
                        .text_color(theme::muted())
                        .hover(|el| el.bg(theme::hover()).text_color(theme::foreground()))
                        .map(|el| {
                            if self.loading {
                                // Turns while a page loads.
                                el.child(
                                    theme::icon("loader-circle")
                                        .size(px(15.))
                                        .text_color(theme::faint())
                                        .with_animation(
                                            "loading",
                                            Animation::new(std::time::Duration::from_millis(900)).repeat(),
                                            |icon, delta| {
                                                icon.with_transformation(Transformation::rotate(percentage(delta)))
                                            },
                                        ),
                                )
                            } else {
                                el.child(theme::icon("refresh-cw").size(px(15.)).text_color(theme::muted()))
                            }
                        })
                        .on_click(cx.listener(|this, _, _, cx| this.load(true, cx))),
                ),
            );
        let body = if let Some(error) = self.error.clone().filter(|_| count == 0) {
            div()
                .p_4()
                .text_sm()
                .text_color(theme::danger())
                .child(error)
                .into_any_element()
        } else if count == 0 && !self.loading {
            div()
                .p_4()
                .text_sm()
                .text_color(theme::muted())
                .child("Niets hier.")
                .into_any_element()
        } else {
            uniform_list("threads", count, cx.processor(Self::render_rows))
                .track_scroll(&self.list)
                .flex_1()
                .px_2()
                .into_any_element()
        };
        pane().child(header).child(field).child(body)
    }
}

/// The list's column, whether it shows a folder or search results.
fn pane() -> Div {
    div()
        .flex()
        .flex_col()
        .w(px(380.))
        .flex_none()
        .h_full()
        .border_r_1()
        .border_color(theme::border())
}

fn row(
    index: usize,
    thread: &Thread,
    open: bool,
    account_color: Option<usize>,
    cx: &mut Context<MailView>,
) -> impl IntoElement {
    let unread = !thread.is_read;
    let who: String = match &thread.to {
        Some(to) => format!("Aan: {}", to.iter().map(|a| a.label()).collect::<Vec<_>>().join(", ")),
        None => thread
            .from_name
            .clone()
            .filter(|name| !name.is_empty())
            .or_else(|| thread.from_email.clone())
            .unwrap_or_else(|| "Onbekend".into()),
    };
    let who = if thread.message_count > 1 {
        format!("{who}  {}", thread.message_count)
    } else {
        who
    };
    let subject = if thread.subject.is_empty() {
        "(geen onderwerp)"
    } else {
        &thread.subject
    };
    div()
        .id(index)
        .h(px(ROW_HEIGHT))
        .py(px(2.))
        .child(
            div()
                .relative()
                .flex()
                .flex_col()
                .justify_center()
                .gap_0p5()
                .size_full()
                .pl(px(26.))
                .pr_2p5()
                .rounded_lg()
                .text_sm()
                .when(open, |el| el.bg(theme::accent()))
                .when(!open, |el| el.hover(|el| el.bg(theme::hover())))
                .when(unread, |el| {
                    el.child(
                        div()
                            .absolute()
                            .left(px(11.))
                            .top(px(15.))
                            .size(px(6.))
                            .rounded_full()
                            .bg(theme::primary()),
                    )
                })
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .truncate()
                                .when(unread, |el| el.font_weight(FontWeight::SEMIBOLD))
                                .when(!unread, |el| el.text_color(theme::muted()))
                                .child(who),
                        )
                        .when(thread.is_starred, |el| {
                            el.child(theme::icon("star").size(px(13.)).text_color(theme::starred()))
                        })
                        .when(thread.has_attachments, |el| {
                            el.child(theme::icon("paperclip").size(px(13.)).text_color(theme::faint()))
                        })
                        .child(
                            div()
                                .flex_none()
                                .text_xs()
                                .text_color(theme::muted())
                                .child(short_date(thread.received_at)),
                        ),
                )
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .child(
                            div().flex_1().min_w_0().truncate().text_color(theme::muted()).child(
                                StyledText::new(if thread.snippet.is_empty() {
                                    subject.to_string()
                                } else {
                                    format!("{subject} · {}", thread.snippet)
                                })
                                .with_highlights(subject_highlight(subject, unread)),
                            ),
                        )
                        .when_some(account_color, |el, color| {
                            el.child(div().flex_none().size(px(7.)).rounded_full().bg(theme::account(color)))
                        }),
                ),
        )
        .on_click(cx.listener(move |this, _, _, cx| this.open_at(index, cx)))
}

/// The subject stands out from the snippet behind it, more so when unread.
fn subject_highlight(subject: &str, unread: bool) -> Vec<(Range<usize>, HighlightStyle)> {
    vec![(
        0..subject.len(),
        HighlightStyle {
            color: Some(theme::foreground().into()),
            font_weight: unread.then_some(FontWeight::MEDIUM),
            ..Default::default()
        },
    )]
}
