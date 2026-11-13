//! Writing with AI (apps/mail-web/src/components/ai-writer.tsx): a language
//! model writes the message, or rewrites what is there, from one short line.
//! The text appears as the model writes it; the result is a single undo step.

use std::io::Read as _;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::Duration;

use futures::channel::mpsc::unbounded;
use gpui_kit::component::input::InputState;
use regex::Regex;

use crate::editor::Command;

use super::*;

/// How long the model may take over one message.
const PATIENCE: Duration = Duration::from_secs(120);

/// The one line that says what to write, and how the writing goes.
pub(super) struct Ai {
    pub(super) open: bool,
    pub(super) input: Entity<InputState>,
    /// Something is written already, so the instruction says what to change.
    pub(super) editing: bool,
    pub(super) pending: bool,
    /// Stops the model; what it wrote so far stays.
    stop: Option<Arc<AtomicBool>>,
    /// The subject before the last writing filled it in, for Undo.
    filled_subject: Option<String>,
    /// Undo asked for that subject back.
    pub(super) restore_subject: Option<String>,
}

impl Ai {
    pub(super) fn new(input: Entity<InputState>) -> Self {
        Self {
            open: false,
            input,
            editing: false,
            pending: false,
            stop: None,
            filled_subject: None,
            restore_subject: None,
        }
    }

    pub(super) fn enabled() -> bool {
        Feature::AiWriting.on()
    }

    /// What the empty line says: what to write, or what to change.
    pub(super) fn hint(editing: bool) -> &'static str {
        if editing {
            t(
                "What should change? For example: shorter, more formal, add a question",
                "Wat moet er anders? Bijvoorbeeld: korter, formeler, stel een vraag",
            )
        } else {
            t(
                "What should the mail say? For example: thank Piet and say Thursday works",
                "Wat moet erin? Bijvoorbeeld: bedank Piet en zeg dat donderdag past",
            )
        }
    }
}

impl Drop for Ai {
    fn drop(&mut self) {
        // Leaving the composer stops the model.
        if let Some(stop) = &self.stop {
            stop.store(true, Ordering::Relaxed);
        }
    }
}

/// What a language model wrote for a message, as it streams in or once it's done.
#[derive(Debug, PartialEq, Eq)]
pub(super) struct Written {
    pub(super) subject: Option<String>,
    pub(super) text: String,
}

const SUBJECT: &str = "subject:";
static FENCE_START: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s*```[a-z]*\n?").unwrap());
static FENCE_END: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\n?```\s*$").unwrap());
static BOLD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\*\*(.+?)\*\*").unwrap());
static GAPS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\n{3,}").unwrap());

/// Splits model output into subject and body (`parseWritten` in
/// packages/mail-core/src/write.ts). Called again on every streamed piece:
/// while the first line might still turn out to be a subject line, the body
/// waits for it.
pub(super) fn parse_written(content: &str, done: bool) -> Written {
    let mut text = content.replace("\r\n", "\n").trim_start().to_string();
    let mut subject = None;
    let lead: String = text.chars().take(SUBJECT.len()).collect::<String>().to_lowercase();
    if !lead.is_empty() && SUBJECT.starts_with(&lead) {
        match text.find('\n') {
            None => {
                if !done {
                    return Written {
                        subject: None,
                        text: String::new(),
                    };
                }
                if lead == SUBJECT {
                    let subject = text[after_lead(&text)..].trim().to_string();
                    return Written {
                        subject: Some(subject).filter(|subject| !subject.is_empty()),
                        text: String::new(),
                    };
                }
            }
            Some(line_end) if lead == SUBJECT => {
                subject = Some(text[after_lead(&text)..line_end].trim().to_string()).filter(|subject| !subject.is_empty());
                text = text[line_end + 1..].to_string();
            }
            Some(_) => {}
        }
    }
    // Models like to fence or bold things; a mail body has neither.
    let text = FENCE_START.replace(&text, "");
    let text = FENCE_END.replace(&text, "");
    let text = BOLD.replace_all(&text, "$1");
    let text = GAPS.replace_all(&text, "\n\n");
    Written {
        subject,
        text: if done { text.trim().to_string() } else { text.trim_start().to_string() },
    }
}

/// Where the text goes on after its first letters, as many as "subject:" has.
fn after_lead(text: &str) -> usize {
    text.char_indices().nth(SUBJECT.len()).map_or(text.len(), |(at, _)| at)
}

/// Plain text as editor content: one paragraph per line, blank lines included
/// (`textToEditorHtml` in lib/email-compose.ts).
pub(super) fn text_to_editor_html(text: &str) -> String {
    text.trim()
        .split('\n')
        .map(|line| {
            let line = line.trim_end_matches('\r');
            let escaped = line.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;");
            format!("<p>{escaped}</p>")
        })
        .collect()
}

/// What arrives from the thread that reads the model's answer.
enum Piece {
    Text(String),
    Failed(anyhow::Error),
}

impl MailView {
    /// ⌘J and the sparkle: opens the one line, or puts it away again.
    pub(super) fn toggle_ai(&mut self, key: u64, window: &mut Window, cx: &mut Context<Self>) {
        if !Ai::enabled() {
            return;
        }
        let Some(composer) = self.writer(key) else { return };
        if composer.ai.pending {
            return;
        }
        if composer.ai.open {
            composer.ai.open = false;
            composer.editor.update(cx, |editor, cx| editor.focus(window, cx));
        } else {
            composer.menu = None;
            composer.ai.editing = !composer.editor.read(cx).body_text().is_empty();
            composer.ai.open = true;
            composer.editor.read(cx).release_keyboard(cx);
            let hint = Ai::hint(composer.ai.editing);
            composer.ai.input.update(cx, |input, cx| {
                input.set_placeholder(hint, window, cx);
                input.focus(window, cx)
            });
        }
        cx.notify();
    }

    /// Escape in the line, or the round button while writing: stops and keeps what is there.
    pub(super) fn close_ai(&mut self, key: u64, window: &mut Window, cx: &mut Context<Self>) {
        let Some(composer) = self.writer(key) else { return };
        if let Some(stop) = &composer.ai.stop {
            stop.store(true, Ordering::Relaxed);
        }
        composer.ai.open = false;
        composer.editor.update(cx, |editor, cx| editor.focus(window, cx));
        cx.notify();
    }

    /// Enter in the line: the model writes.
    pub(super) fn submit_ai(&mut self, key: u64, window: &mut Window, cx: &mut Context<Self>) {
        let Some(composer) = self.writer(key) else { return };
        let instruction = composer.ai.input.read(cx).value().trim().to_string();
        // A debug composer asks no model: that costs money.
        if instruction.is_empty() || composer.ai.pending || composer.dry {
            return;
        }
        let previous_subject = composer.subject_text.clone();
        let fills_subject = composer.is_new() && previous_subject.trim().is_empty();
        let path = composer.write_path();
        let body = serde_json::json!({
            "instruction": instruction,
            "draft": composer.editor.read(cx).body_text(),
            "subject": previous_subject,
            "hasSignature": composer.applied_signature.as_deref().is_some_and(|html| !html.is_empty()),
            "forward": matches!(composer.kind, Kind::Forward { .. }),
        });
        let stop = Arc::new(AtomicBool::new(false));
        composer.ai.stop = Some(stop.clone());
        composer.ai.pending = true;
        composer.ai.filled_subject = None;
        let client = self.client.clone();
        let (tell, mut told) = unbounded::<Piece>();
        let stopped = stop.clone();
        cx.background_executor()
            .spawn(async move {
                let mut reader = match client.post_stream(&path, &body, PATIENCE) {
                    Ok(reader) => reader,
                    Err(error) => {
                        let _ = tell.unbounded_send(Piece::Failed(error));
                        return;
                    }
                };
                // The answer is there: an empty piece says so, before the first words.
                let _ = tell.unbounded_send(Piece::Text(String::new()));
                let mut bytes = [0u8; 2048];
                let mut waiting: Vec<u8> = Vec::new();
                loop {
                    if stopped.load(Ordering::Relaxed) {
                        return;
                    }
                    match reader.read(&mut bytes) {
                        Ok(0) => return,
                        Ok(read) => {
                            waiting.extend_from_slice(&bytes[..read]);
                            // A letter cut in two waits for its other half.
                            let whole = match std::str::from_utf8(&waiting) {
                                Ok(text) => text.len(),
                                Err(error) => error.valid_up_to(),
                            };
                            let text = String::from_utf8_lossy(&waiting[..whole]).into_owned();
                            waiting.drain(..whole);
                            if !text.is_empty() && tell.unbounded_send(Piece::Text(text)).is_err() {
                                return;
                            }
                        }
                        Err(error) => {
                            let _ = tell.unbounded_send(Piece::Failed(error.into()));
                            return;
                        }
                    }
                }
            })
            .detach();
        cx.spawn_in(window, async move |this, cx| {
            let mut written = String::new();
            let mut started = false;
            let mut shown_subject: Option<String> = None;
            let mut failure: Option<anyhow::Error> = None;
            'reading: while let Some(piece) = told.next().await {
                let mut pieces = vec![piece];
                // Shown at most once a turn, however fast the words come in.
                while let Ok(more) = told.try_recv() {
                    pieces.push(more);
                }
                for piece in pieces {
                    match piece {
                        Piece::Text(text) => written.push_str(&text),
                        Piece::Failed(error) => {
                            failure = Some(error);
                            break 'reading;
                        }
                    }
                }
                let shown = this.update_in(cx, |this, window, cx| {
                    let Some(composer) = this.writer(key) else { return false };
                    if !started {
                        started = true;
                        composer.editor.update(cx, |editor, cx| editor.start_stream(cx));
                    }
                    let now = parse_written(&written, false);
                    composer.editor.update(cx, |editor, cx| editor.stream_body(&text_to_editor_html(&now.text), cx));
                    if let (true, Some(subject)) = (fills_subject, now.subject) {
                        if shown_subject.as_ref() != Some(&subject) {
                            shown_subject = Some(subject.clone());
                            this.set_subject(key, subject, window, cx);
                        }
                    }
                    true
                });
                if !matches!(shown, Ok(true)) {
                    stop.store(true, Ordering::Relaxed);
                    return;
                }
                // Stopped: what is there stays, and no more is shown.
                if stop.load(Ordering::Relaxed) {
                    break;
                }
            }
            let stopped = stop.load(Ordering::Relaxed);
            let _ = this.update_in(cx, |this, window, cx| {
                let Some(composer) = this.writer(key) else { return };
                composer.ai.pending = false;
                composer.ai.stop = None;
                let editor = composer.editor.clone();
                let result = parse_written(&written, true);
                // Failed, or nothing came: the message is as it was. Stopped keeps what there is.
                if (failure.is_some() && !stopped) || result.text.is_empty() {
                    if started {
                        editor.update(cx, |editor, cx| editor.cancel_stream(cx));
                    }
                    if shown_subject.is_some() {
                        this.set_subject(key, previous_subject.clone(), window, cx);
                    }
                    match failure {
                        Some(error) if error.downcast_ref::<Unauthorized>().is_some() => cx.emit(SignedOut),
                        Some(error) if !stopped => this.toast_error(error, cx),
                        None if !stopped => this.complain(
                            t(
                                "The AI wrote nothing. Try describing it differently.",
                                "De AI schreef niets. Probeer het anders te omschrijven.",
                            ),
                            cx,
                        ),
                        _ => {}
                    }
                    cx.notify();
                    return;
                }
                editor.update(cx, |editor, cx| editor.finish_stream(&text_to_editor_html(&result.text), cx));
                let new_subject = result.subject.filter(|_| fills_subject);
                if let Some(subject) = new_subject.clone() {
                    this.set_subject(key, subject, window, cx);
                }
                if let Some(composer) = this.writer(key) {
                    composer.ai.open = false;
                    composer.ai.filled_subject = new_subject.map(|_| previous_subject.clone());
                    composer.ai.input.update(cx, |input, cx| input.set_value("", window, cx));
                }
                this.toast_keyed(
                    "ai-written",
                    t("Written by AI", "Geschreven door AI"),
                    ToastKind::Plain,
                    Some((t("Undo", "Ongedaan maken").into(), ToastAction::UndoAi(key))),
                    cx,
                );
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }

    /// Undo on the "Written by AI" toast: the message as it was before.
    pub(crate) fn undo_ai(&mut self, key: u64, cx: &mut Context<Self>) {
        let Some(composer) = self.writer(key) else { return };
        composer.editor.update(cx, |editor, cx| editor.exec(Command::Undo, cx));
        // The subject it filled in goes back at the next frame, which has the window a field needs.
        composer.ai.restore_subject = composer.ai.filled_subject.take();
        cx.notify();
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_written, text_to_editor_html, Written};

    fn written(subject: Option<&str>, text: &str) -> Written {
        Written {
            subject: subject.map(String::from),
            text: text.into(),
        }
    }

    #[test]
    fn splits_subject_and_body() {
        assert_eq!(parse_written("Subject: Thursday\n\nHi Piet,\nThursday works.", true), written(Some("Thursday"), "Hi Piet,\nThursday works."));
        assert_eq!(parse_written("Hi Piet,\n\n\n\nSee you.", true), written(None, "Hi Piet,\n\nSee you."));
        assert_eq!(parse_written("SUBJECT: Only this", true), written(Some("Only this"), ""));
        assert_eq!(parse_written("subject:\nBody", true), written(None, "Body"));
        // A first line that only starts like one is the body.
        assert_eq!(parse_written("Sub", true), written(None, "Sub"));
        assert_eq!(parse_written("Subjective thoughts\nmore", true), written(None, "Subjective thoughts\nmore"));
    }

    #[test]
    fn the_body_waits_while_the_first_line_may_be_a_subject() {
        assert_eq!(parse_written("Sub", false), written(None, ""));
        assert_eq!(parse_written("Subject: Thu", false), written(None, ""));
        assert_eq!(parse_written("Subject: Thursday\nHi ", false), written(Some("Thursday"), "Hi "));
        assert_eq!(parse_written("Hi Piet, ", false), written(None, "Hi Piet, "));
    }

    #[test]
    fn fences_and_bold_go() {
        assert_eq!(parse_written("```text\nHi **Piet**,\n```", true), written(None, "Hi Piet,"));
        assert_eq!(parse_written("\r\n  Hi\r\nthere", true), written(None, "Hi\nthere"));
    }

    #[test]
    fn text_becomes_paragraphs() {
        assert_eq!(text_to_editor_html(" Hi <Piet> & \"co\"\n\nBye\r\n"), "<p>Hi &lt;Piet&gt; &amp; &quot;co&quot;</p><p></p><p>Bye</p>");
        assert_eq!(text_to_editor_html(""), "<p></p>");
    }
}
