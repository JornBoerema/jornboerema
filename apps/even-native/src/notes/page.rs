//! The pane beside the sidebar (`<main>` in components/workspace-app.tsx, with
//! apps/notes-web/src/app.css): how syncing stands in its corner, then the
//! overview (components/workspace-dashboard.tsx) or the open note. Also what
//! shows before there is anything: components/page-loading.tsx and page-error.tsx.

use gpui_kit::prelude::*;
use gpui_kit::*;

use crate::i18n::{lang, t};
use crate::{theme, ui};

use super::{parts, Connection, Nav, NotesApp};

/// page-loading.tsx: blocks where the notes will be.
pub(super) fn loading() -> impl IntoElement {
    div().flex_1().flex().justify_center().child(
        div()
            .flex()
            .flex_col()
            .gap(px(24.))
            .w_full()
            .max_w(px(768.))
            .p(px(32.))
            .child(parts::skeleton(32.).w(px(160.)))
            .child(parts::skeleton(40.))
            .child(parts::skeleton(56.))
            .child(parts::skeleton(56.)),
    )
}

/// The first meaningful lines of a note, without Markdown and without
/// repeating its title (`excerpt` in workspace-dashboard.tsx).
fn excerpt(markdown: &str, title: &str) -> String {
    let title = title.trim().to_lowercase();
    markdown
        .lines()
        .map(plain)
        .filter(|line| !line.is_empty() && line.to_lowercase() != title)
        .take(4)
        .collect::<Vec<_>>()
        .join(" ")
}

/// A line without what Markdown puts before it (#, -, 1., >, [ ]) and in it (* _ ` ~).
fn plain(line: &str) -> String {
    let line = line.trim();
    let after_space = |rest: &str| -> Option<usize> {
        let trimmed = rest.trim_start();
        (trimmed.len() < rest.len()).then_some(line.len() - trimmed.len())
    };
    let hashes = line.chars().take_while(|c| *c == '#').count();
    let digits = line.chars().take_while(char::is_ascii_digit).count();
    let start = if (1..=6).contains(&hashes) {
        after_space(&line[hashes..])
    } else if line.starts_with(['-', '*', '+']) {
        after_space(&line[1..]).map(|start| {
            // A checklist's box goes with its bullet.
            let rest = &line[start..];
            let boxed = ["[ ]", "[x]", "[X]"].iter().any(|mark| rest.starts_with(mark));
            match boxed.then(|| after_space(&rest[3..])).flatten() {
                Some(after_box) => after_box,
                None => start,
            }
        })
    } else if line.starts_with('>') {
        after_space(&line[1..])
    } else if digits > 0 && line[digits..].starts_with('.') {
        after_space(&line[digits + 1..])
    } else {
        None
    };
    line[start.unwrap_or(0)..]
        .chars()
        .filter(|c| !matches!(c, '*' | '_' | '`' | '~'))
        .collect::<String>()
        .trim()
        .to_string()
}

impl NotesApp {
    /// page-error.tsx: the notes could not be loaded at all.
    pub(super) fn render_failed(&self, cx: &mut Context<Self>) -> impl IntoElement {
        div().flex_1().flex().justify_center().child(
            div()
                .flex()
                .flex_col()
                .gap(px(20.))
                .w_full()
                .max_w(px(512.))
                .p(px(32.))
                .child(parts::alert(
                    Some(
                        t(
                            "Your notes could not be loaded",
                            "Je notities konden niet worden geladen",
                        )
                        .into(),
                    ),
                    t(
                        "Please try again in a moment. Your saved notes are safe.",
                        "Probeer het over een moment opnieuw. Je opgeslagen notities blijven bewaard.",
                    ),
                    true,
                ))
                .child(
                    ui::button("retry", t("Try again", "Opnieuw proberen"), ui::Variant::Primary)
                        .w_full()
                        .on_click(cx.listener(|this, _, window, cx| this.start(window, cx))),
                ),
        )
    }

    pub(super) fn render_main(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let overview = self.selected.is_none();
        let content = div()
            .id("notes-content")
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .w_full()
            .max_w(px(if overview { 1040. } else { 800. }))
            .mx_auto()
            .pt(px(48.))
            .px(px(36.))
            .children(self.render_sync_alert());
        let content = if overview {
            // `.dashboard-content`: the whole page scrolls.
            content
                .overflow_y_scroll()
                .track_scroll(&self.overview_scroll)
                .pb(px(48.))
                .child(self.render_dashboard(window, cx))
        } else if self.selected_note().is_some() {
            content.children(self.render_note(cx))
        } else {
            content.child(parts::empty(
                t("Start with your first note", "Begin met je eerste notitie"),
                t(
                    "For ideas, meeting notes or anything else you want to keep.",
                    "Voor ideeën, aantekeningen of alles wat je wilt bewaren.",
                ),
                Some(
                    self.new_note_button("first-note-button", t("Create a note", "Een notitie maken"), cx)
                        .into_any_element(),
                ),
                80.,
            ))
        };
        div()
            .relative()
            .flex()
            .flex_col()
            .flex_1()
            .min_w_0()
            .h_full()
            .overflow_hidden()
            .child(content)
            // `.dashboard-content.scroll-fade`.
            .when(overview, |el| {
                el.children(crate::workspace::scroll_fades(&self.overview_scroll, theme::background()))
            })
            .child(self.render_sync_status(cx))
    }

    /// `.sync-status`: how saving and syncing stand; a click asks for the notes again.
    fn render_sync_status(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let pending = !self.queue.is_empty();
        let text = if !self.online {
            "Offline"
        } else if self.sync_error {
            t("Sync failed", "Synchroniseren mislukt")
        } else if pending {
            t("Saving…", "Opslaan…")
        } else {
            match self.connection {
                Connection::Connected => t("Synced", "Gesynchroniseerd"),
                Connection::Connecting => t("Connecting…", "Verbinden…"),
                Connection::Polling => t("Synced periodically", "Periodiek gesynchroniseerd"),
            }
        };
        let sign = |name: &str| theme::hi(name).text_color(theme::muted());
        let icon: AnyElement = if !self.online || self.sync_error {
            sign("cloud-alert").into_any_element()
        } else if pending {
            sign("refresh")
                .with_animation(
                    "saving",
                    Animation::new(std::time::Duration::from_secs(1)).repeat(),
                    |icon, delta| icon.with_transformation(Transformation::rotate(percentage(delta))),
                )
                .into_any_element()
        } else if self.connection == Connection::Connecting {
            sign("refresh").into_any_element()
        } else {
            sign("cloud-check").into_any_element()
        };
        div()
            .id("sync-status")
            .absolute()
            .top(px(16.))
            .right(px(32.))
            .flex()
            .items_center()
            .gap(px(7.))
            .text_size(px(12.))
            .text_color(theme::muted())
            .cursor_pointer()
            .hover(|el| el.text_color(theme::foreground()))
            .child(icon)
            .child(text)
            .tooltip(ui::tip(t("Sync now", "Nu synchroniseren")))
            .on_click(cx.listener(|this, _, window, cx| this.fetch(window, cx)))
    }

    /// Above the page while offline, or when the last sync failed.
    fn render_sync_alert(&self) -> Option<impl IntoElement> {
        let (title, body) = if !self.online {
            (
                t("You're offline", "Je bent offline"),
                t(
                    "You can still read your notes. Once you're back online, you can carry on.",
                    "Je kunt je notities lezen. Zodra je weer verbinding hebt, kun je verder.",
                ),
            )
        } else if self.sync_error {
            (
                t("Syncing didn't work", "Synchroniseren is niet gelukt"),
                t(
                    "You're seeing the last loaded notes. Try syncing again.",
                    "Je ziet de laatst geladen notities. Probeer opnieuw te synchroniseren.",
                ),
            )
        } else {
            return None;
        };
        Some(parts::alert(Some(title.into()), body, false).mb(px(24.)))
    }

    /// The filled button with a plus that makes a note.
    fn new_note_button(&self, id: &'static str, label: &'static str, cx: &mut Context<Self>) -> Stateful<Div> {
        let disabled = self.disabled();
        ui::button_with_icon(id, "add-01", label, ui::Variant::Primary)
            .when(disabled, ui::disabled)
            .when(!disabled, |el| {
                el.on_click(cx.listener(|this, _, window, cx| this.open_new_note(window, cx)))
            })
    }

    /// The overview: a greeting, the day, and every note as a card in sidebar order.
    fn render_dashboard(&self, window: &Window, cx: &mut Context<Self>) -> impl IntoElement {
        use chrono::Timelike as _;
        let now = chrono::Local::now();
        let greeting = match now.hour() {
            0..=11 => t("Good morning", "Goedemorgen"),
            12..=17 => t("Good afternoon", "Goedemiddag"),
            _ => t("Good evening", "Goedenavond"),
        };
        let greeting = match self.user.name.split_whitespace().next() {
            Some(first) => format!("{greeting}, {first}."),
            None => format!("{greeting}."),
        };
        let date = now.format_localized("%A %-d %B", lang().locale()).to_string();
        let new_note = t("New note", "Nieuwe notitie");

        let heading = div()
            .flex()
            .flex_none()
            .items_end()
            .justify_between()
            .gap(px(16.))
            .mb(px(28.))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .child(
                        div()
                            .text_size(px(28.))
                            .font_weight(FontWeight::SEMIBOLD)
                            .line_height(relative(1.3))
                            .child(greeting),
                    )
                    .child(
                        div()
                            .mt(px(8.))
                            .text_size(px(13.))
                            .text_color(theme::muted())
                            .child(date),
                    ),
            )
            .when(!self.view.is_empty(), |el| {
                el.child(self.new_note_button("new-note", new_note, cx))
            });

        if self.view.is_empty() {
            return div().flex_none().pb(px(24.)).child(heading).child(parts::empty(
                t("What's on your mind?", "Wat wil je even noteren?"),
                t(
                    "Write down ideas, meeting notes or anything else you want to keep.",
                    "Schrijf ideeën, aantekeningen of alles wat je wilt bewaren op.",
                ),
                Some(self.new_note_button("new-note-empty", new_note, cx).into_any_element()),
                40.,
            ));
        }

        // `.note-grid`: as many columns of at least 220 as fit, 12 apart. The
        // pane is the window without the rail (80) and the sidebar's column (260).
        let pane = f32::from(window.viewport_size().width) - 80. - 260.;
        let width = pane.min(1040.) - 72.;
        let columns = (((width + 12.) / 232.).floor() as u16).max(1);
        let cards = self.view.iter().map(|note| {
            let id = note.id.clone();
            let text = excerpt(note.markdown(), &note.name);
            let text = if text.is_empty() {
                t("Empty note", "Lege notitie").to_string()
            } else {
                text
            };
            div()
                .id(SharedString::from(format!("card-{}", note.id)))
                .flex()
                .flex_col()
                .gap(px(6.))
                .h(px(132.))
                .min_w_0()
                .px(px(16.))
                .py(px(14.))
                .rounded(theme::RADIUS)
                .border_1()
                .border_color(theme::border())
                .bg(theme::card())
                .overflow_hidden()
                .cursor_pointer()
                // `.note-card:hover`: the edge a fifth of the way to the text's colour.
                .hover(|el| el.border_color(parts::blend(theme::foreground(), theme::border(), 0.22)))
                .child(
                    div()
                        .flex_none()
                        .truncate()
                        .text_size(px(14.))
                        .font_weight(FontWeight::SEMIBOLD)
                        .child(note.name.clone()),
                )
                .child(
                    div()
                        .text_size(px(13.))
                        .line_height(relative(1.5))
                        .text_color(theme::muted())
                        .line_clamp(4)
                        .child(text),
                )
                .on_click(cx.listener(move |this, _, window, cx| this.go(Nav::Note(id.clone()), window, cx)))
        });
        div().flex_none().pb(px(24.)).child(heading).child(
            div()
                .grid()
                .grid_cols(columns)
                .gap(px(12.))
                .pb(px(32.))
                .children(cards),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::{excerpt, plain};

    #[test]
    fn lines_lose_their_markdown() {
        assert_eq!(plain("## Kop"), "Kop");
        assert_eq!(plain("- [x] **Klaar**"), "Klaar");
        assert_eq!(plain("* punt"), "punt");
        assert_eq!(plain("12. stap `code`"), "stap code");
        assert_eq!(plain("> citaat"), "citaat");
        assert_eq!(plain("#geen kop"), "#geen kop");
        assert_eq!(plain("-streep"), "-streep");
    }

    #[test]
    fn an_excerpt_skips_the_title_and_empty_lines() {
        let markdown = "# Ideeën\n\nEerste\n- tweede\n\n3. derde\nvierde\nvijfde";
        assert_eq!(excerpt(markdown, " ideeën "), "Eerste tweede derde vierde");
        assert_eq!(excerpt("", "Leeg"), "");
    }
}
