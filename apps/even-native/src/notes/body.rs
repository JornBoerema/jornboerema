//! The text of a note. On the web this is a tiptap editor that reads and
//! writes Markdown (apps/notes-web/src/components/note-editor.tsx, `.note-prose`
//! in app.css); here it is the shared rich text editor (src/editor.rs) in its
//! Markdown mode, with the web's placeholder and the blocks "/" offers.
//!
//! Everything else in Even noteren reaches the text only through `NoteBody`:
//! make it, read and set Markdown, hear changes, lock it for a reader, draw
//! it, and take it off the screen while something lies over it.
//!
//! On the web the title scrolls away with the text. The editor is a system
//! webview, which GPUI can't clip or scroll, so here the title stays and the
//! text scrolls under it, in the editor itself.

use gpui_kit::prelude::*;
use gpui_kit::*;

use crate::editor::{EditorEvent, Look, Mode, RichEditor};
use crate::i18n::t;

pub struct NoteBody {
    editor: Entity<RichEditor>,
}

/// `blockIds` in note-editor.tsx with the words of i18n `note.blocks`.
fn blocks() -> [(&'static str, &'static str); 10] {
    [
        ("paragraph", t("Text", "Tekst")),
        ("h1", t("Heading 1", "Kop 1")),
        ("h2", t("Heading 2", "Kop 2")),
        ("h3", t("Heading 3", "Kop 3")),
        ("bulletList", t("Bulleted list", "Opsomming")),
        ("orderedList", t("Numbered list", "Genummerde lijst")),
        ("taskList", "Checklist"),
        ("blockquote", t("Quote", "Citaat")),
        ("codeBlock", t("Code block", "Codeblok")),
        ("horizontalRule", t("Divider", "Scheidingslijn")),
    ]
}

impl NoteBody {
    pub fn new(markdown: &str, editable: bool, window: &mut Window, cx: &mut App) -> Self {
        let editor = cx.new(|cx| RichEditor::new(Mode::Markdown, window, cx));
        editor.update(cx, |editor, cx| {
            editor.set_look(Look::NOTE, cx);
            editor.set_placeholder(
                t(
                    "Write something, or type / for a block…",
                    "Schrijf iets, of typ / voor een tekstblok…",
                ),
                cx,
            );
            editor.set_slash_menu(&blocks(), t("No blocks found.", "Geen tekstblokken gevonden."), cx);
            editor.set_editable(editable, cx);
            // Showing the note is not a change: the editor reports only what the user does.
            editor.set_content(markdown, cx);
        });
        Self { editor }
    }

    /// The note as Markdown, as it stands now: what was shown, or what the
    /// user made of it.
    pub fn markdown(&self, cx: &App) -> String {
        self.editor.read(cx).content()
    }

    /// Replaces the text (a newer version from elsewhere) without reporting a change.
    pub fn set_markdown(&self, markdown: &str, cx: &mut App) {
        self.editor.update(cx, |editor, cx| editor.set_content(markdown, cx));
    }

    /// A reader may select and copy, not type.
    pub fn set_editable(&self, editable: bool, cx: &mut App) {
        self.editor.update(cx, |editor, cx| editor.set_editable(editable, cx));
    }

    /// Whether the keyboard is in the text.
    pub fn is_focused(&self, cx: &App) -> bool {
        self.editor.read(cx).is_focused()
    }

    /// Takes the text off the screen, or puts it back: the editor is a system
    /// view above everything GPUI draws, so it goes while a dialog, a menu,
    /// the settings or another app must show where it is.
    pub fn set_hidden(&self, hidden: bool, cx: &mut App) {
        if self.editor.read(cx).is_hidden() != hidden {
            self.editor.update(cx, |editor, cx| editor.set_hidden(hidden, cx));
        }
    }

    /// Calls `changed` on the view after every edit the user makes. Never for
    /// `new` or `set_markdown`.
    pub fn on_change<V: 'static>(
        &self,
        window: &mut Window,
        cx: &mut Context<V>,
        changed: impl Fn(&mut V, &mut Window, &mut Context<V>) + 'static,
    ) -> Subscription {
        cx.subscribe_in(&self.editor, window, move |view, _, event: &EditorEvent, window, cx| {
            if matches!(event, EditorEvent::Changed(_)) {
                changed(view, window, cx);
            }
        })
    }

    /// `.note-prose`: 15 points with open lines, filling what is left of the
    /// page but `room` at its foot (where toasts show: the editor would cover them).
    pub fn render(&self, room: f32) -> impl IntoElement {
        div().flex_1().min_h_0().mb(px(room)).child(self.editor.clone())
    }
}
