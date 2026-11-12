//! Searching every mailbox: the field above the list and the results that replace the folder.
//! The synced matches show at once; the mailboxes' own search, through the text too, joins them.

use std::collections::HashSet;

use gpui_kit::component::input::{Escape, Input, InputEvent, InputState};
use gpui_kit::component::Sizable as _;

use crate::api::{rank_hits, SearchHit, Thread};
use crate::theme;

use super::*;

pub(super) struct Search {
    pub(super) query: String,
    /// What the list shows: both answers merged, ranked and changed as the user acts on them.
    pub(super) hits: Vec<Thread>,
    quick: Vec<SearchHit>,
    full: Vec<SearchHit>,
    /// The mailboxes are still searching.
    pub(super) pending: bool,
    /// Some mailbox could not search; the rest still answered.
    pub(super) incomplete: bool,
    pub(super) error: Option<SharedString>,
    /// Hits acted out of the results, e.g. archived: a later answer doesn't bring them back.
    gone: HashSet<String>,
}

impl Search {
    fn new(query: String) -> Self {
        Self {
            query,
            hits: Vec::new(),
            quick: Vec::new(),
            full: Vec::new(),
            pending: true,
            incomplete: false,
            error: None,
            gone: HashSet::new(),
        }
    }

    fn merge(&mut self) {
        self.hits = merge(&self.query, &self.quick, &self.full, &self.hits, &self.gone);
    }

    pub(super) fn remove(&mut self, index: usize) {
        let thread = self.hits.remove(index);
        self.gone.insert(thread.id);
    }
}

/// Synced matches first, so a conversation found by both keeps its row id. One already
/// shown keeps how it is now (read, starred), not how the answer saw it.
fn merge(
    query: &str,
    quick: &[SearchHit],
    full: &[SearchHit],
    shown: &[Thread],
    gone: &HashSet<String>,
) -> Vec<Thread> {
    rank_hits(query, quick.iter().chain(full).cloned().collect())
        .into_iter()
        .map(SearchHit::into_thread)
        .filter(|thread| !gone.contains(&thread.id))
        .map(|thread| {
            shown
                .iter()
                .find(|shown| shown.id == thread.id)
                .cloned()
                .unwrap_or(thread)
        })
        .collect()
}

/// The API turns away longer queries.
const MAX_QUERY: usize = 500;

impl MailView {
    pub(super) fn search_field(window: &mut Window, cx: &mut Context<Self>) -> (Entity<InputState>, Subscription) {
        let input = cx.new(|cx| InputState::new(window, cx).placeholder("Zoeken in alle mail"));
        let subscription = cx.subscribe_in(&input, window, |this, _, event: &InputEvent, window, cx| {
            if let InputEvent::PressEnter { .. } = event {
                this.run_search(window, cx);
            }
        });
        (input, subscription)
    }

    /// `/` and Cmd+F: into the field, also from inside the mail, which holds the keyboard natively.
    pub(super) fn focus_search(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(webview) = &self.webview {
            let _ = webview.read(cx).raw().focus_parent();
        }
        self.search_input.update(cx, |input, cx| input.focus(window, cx));
    }

    fn run_search(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let query: String = self
            .search_input
            .read(cx)
            .value()
            .trim()
            .chars()
            .take(MAX_QUERY)
            .collect();
        if query.is_empty() {
            self.end_search(window, cx);
        } else {
            self.search_for(query, window, cx);
        }
    }

    pub(super) fn search_for(&mut self, query: String, window: &mut Window, cx: &mut Context<Self>) {
        self.search_generation += 1;
        let generation = self.search_generation;
        self.search = Some(Search::new(query.clone()));
        self.open = None;
        self.found.scroll_to_item(0, ScrollStrategy::Top);
        // J and K walk the results straight away; `/` goes back to the field.
        window.focus(&self.focus, cx);

        let client = self.client.clone();
        let words = query.clone();
        let quick = cx
            .background_executor()
            .spawn(async move { client.quick_search(&words) });
        cx.spawn(async move |this, cx| {
            let result = quick.await;
            let _ = this.update(cx, |this, cx| {
                if this.search_generation != generation {
                    return;
                }
                match result {
                    Ok(hits) => {
                        if let Some(search) = &mut this.search {
                            search.quick = hits;
                            search.merge();
                        }
                    }
                    Err(error) if error.downcast_ref::<Unauthorized>().is_some() => cx.emit(SignedOut),
                    // The mailboxes' own search still answers.
                    Err(_) => {}
                }
                cx.notify();
            });
        })
        .detach();

        let client = self.client.clone();
        let full = cx.background_executor().spawn(async move { client.search(&query) });
        cx.spawn(async move |this, cx| {
            let result = full.await;
            let _ = this.update(cx, |this, cx| {
                if this.search_generation != generation {
                    return;
                }
                let Some(search) = &mut this.search else { return };
                search.pending = false;
                match result {
                    Ok(results) => {
                        search.incomplete = !results.failed_accounts.is_empty();
                        search.full = results.hits;
                        search.merge();
                    }
                    Err(error) if error.downcast_ref::<Unauthorized>().is_some() => cx.emit(SignedOut),
                    Err(error) => search.error = Some(format!("Zoeken is niet gelukt: {error}").into()),
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }

    /// Back to the folder, with the keyboard back on the mail so J and K work.
    pub(super) fn end_search(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.search_generation += 1;
        if self.search.take().is_some() && self.position().is_none() {
            self.open = None;
        }
        self.search_input
            .update(cx, |input, cx| input.set_value("", window, cx));
        window.focus(&self.focus, cx);
        cx.notify();
    }

    pub(super) fn render_search_field(&self, window: &Window, cx: &mut Context<Self>) -> impl IntoElement {
        let focused = self.search_input.read(cx).focus_handle(cx).is_focused(window);
        div()
            .flex_none()
            .px_3()
            .pb_2()
            // The field's own Escape bubbles up here when it has nothing else to undo.
            .on_action(cx.listener(|this, _: &Escape, window, cx| this.end_search(window, cx)))
            .child(
                div()
                    .flex()
                    .items_center()
                    .h(px(32.))
                    .px_1()
                    .rounded_md()
                    .bg(theme::sidebar())
                    .border_1()
                    .border_color(if focused { theme::faint() } else { theme::border() })
                    .text_sm()
                    .child(
                        Input::new(&self.search_input)
                            .appearance(false)
                            .small()
                            .prefix(theme::icon("search").size(px(14.)).text_color(theme::faint())),
                    ),
            )
    }

    /// Above the results: what this is, whether more is coming, and the way back.
    pub(super) fn render_search_header(&self, search: &Search, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .flex()
            .items_center()
            .justify_between()
            .h(px(TITLE_BAR))
            .flex_none()
            .px_4()
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .min_w_0()
                    .child(
                        div()
                            .flex_none()
                            .text_sm()
                            .font_weight(FontWeight::MEDIUM)
                            .child("Zoekresultaten"),
                    )
                    .when(search.pending, |el| el.child(spinner()))
                    .when(!search.pending, |el| {
                        el.child(
                            div()
                                .text_xs()
                                .text_color(theme::faint())
                                .child(search.hits.len().to_string()),
                        )
                    }),
            )
            .child(
                div()
                    .id("end-search")
                    .flex()
                    .items_center()
                    .gap_1p5()
                    .h(px(28.))
                    .px_2()
                    .rounded_md()
                    .text_xs()
                    .text_color(theme::muted())
                    .hover(|el| el.bg(theme::hover()).text_color(theme::foreground()))
                    .child(theme::icon("x").size(px(15.)).text_color(theme::muted()))
                    .child(folder_name(self.folder))
                    .on_click(cx.listener(|this, _, window, cx| this.end_search(window, cx))),
            )
    }
}

impl MailView {
    /// The hits as rows like a folder's, or why there are none.
    pub(super) fn render_results(&self, search: &Search, cx: &mut Context<Self>) -> AnyElement {
        let count = search.hits.len();
        let note = |text: SharedString, color: Rgba| div().p_4().text_sm().text_color(color).child(text);
        if count == 0 {
            return match (&search.error, search.pending) {
                (_, true) => note("Zoeken…".into(), theme::muted()),
                (Some(error), false) => note(error.clone(), theme::danger()),
                (None, false) => note("Niets gevonden.".into(), theme::muted()),
            }
            .into_any_element();
        }
        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .child(
                uniform_list("found", count, cx.processor(Self::render_rows))
                    .track_scroll(&self.found)
                    .flex_1()
                    .px_2(),
            )
            // Only the synced matches, or not every mailbox: say so under them.
            .when_some(
                search
                    .error
                    .clone()
                    .or_else(|| search.incomplete.then(|| "Niet elke mailbox kon zoeken.".into())),
                |el, text| {
                    el.child(
                        div()
                            .flex_none()
                            .px_4()
                            .py_2()
                            .text_xs()
                            .text_color(theme::faint())
                            .child(text),
                    )
                },
            )
            .into_any_element()
    }
}

/// Turns while something loads.
pub(super) fn spinner() -> impl IntoElement {
    theme::icon("loader-circle")
        .size(px(15.))
        .text_color(theme::faint())
        .with_animation(
            "loading",
            Animation::new(std::time::Duration::from_millis(900)).repeat(),
            |icon, delta| icon.with_transformation(Transformation::rotate(percentage(delta))),
        )
}

#[cfg(test)]
mod tests {
    // Named, not `super::*`: GPUI's own `test` macro would shadow Rust's.
    use super::{merge, HashSet, SearchHit};

    fn hit(thread: &str, subject: &str, message: Option<&str>) -> SearchHit {
        SearchHit {
            account_id: "a".into(),
            thread_id: thread.into(),
            subject: subject.into(),
            snippet: String::new(),
            from_name: None,
            from_email: None,
            received_at: "2026-11-12T10:00:00Z".parse().unwrap(),
            is_read: false,
            has_attachments: false,
            is_starred: false,
            message_id: message.map(str::to_string),
        }
    }

    #[test]
    fn merging_keeps_synced_ids_what_was_done_and_what_left() {
        let quick = [hit("t1", "Factuur", Some("m1"))];
        let full = [
            hit("t1", "Factuur", None),
            hit("t2", "Factuur oud", None),
            hit("t3", "Factuur", None),
        ];
        let mut shown = merge("factuur", &quick, &[], &[], &HashSet::new());
        assert_eq!(shown.len(), 1);
        shown[0].is_read = true;
        let gone = HashSet::from(["remote:a:-:t3".to_string()]);
        let merged = merge("factuur", &quick, &full, &shown, &gone);
        let ids: Vec<&str> = merged.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids, ["m1", "remote:a:-:t2"]);
        assert!(merged[0].is_read);
        assert!(!merged[1].is_read);
    }
}
