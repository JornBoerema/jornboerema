//! The text of a note. On the web this is a tiptap editor that reads and
//! writes Markdown (apps/notes-web/src/components/note-editor.tsx, `.note-prose`
//! in app.css). Here, for now, a plain field holding that Markdown as it is.
//!
//! Everything else in Even noteren reaches the text only through `NoteBody`,
//! so the shared rich text editor (src/editor.rs) can take its place by
//! rewriting this one file: make it, read and set Markdown, hear changes,
//! lock it for a reader, draw it.

use gpui_kit::component::input::{InputEvent, Textarea, TextareaState};
use gpui_kit::prelude::*;
use gpui_kit::*;

use crate::i18n::t;

pub struct NoteBody {
    state: Entity<TextareaState>,
    /// A reader may select and copy, not type.
    editable: bool,
}

impl NoteBody {
    pub fn new(markdown: &str, editable: bool, window: &mut Window, cx: &mut App) -> Self {
        let state = cx.new(|cx| {
            // Not the web's "…or type / for a block": this field has no blocks to offer.
            TextareaState::new(window, cx)
                .placeholder(t("Write something…", "Schrijf iets…"))
                .default_value(markdown.to_string())
        });
        Self { state, editable }
    }

    /// The note as Markdown, as it stands now.
    pub fn markdown(&self, cx: &App) -> String {
        self.state.read(cx).value().to_string()
    }

    /// Replaces the text (a newer version from elsewhere) without reporting a change.
    pub fn set_markdown(&self, markdown: &str, window: &mut Window, cx: &mut App) {
        self.state
            .update(cx, |state, cx| state.set_value(markdown.to_string(), window, cx));
    }

    pub fn set_editable(&mut self, editable: bool) {
        self.editable = editable;
    }

    pub fn is_focused(&self, window: &Window, cx: &App) -> bool {
        self.state.read(cx).focus_handle(cx).is_focused(window)
    }

    /// Calls `changed` on the view after every edit the user makes.
    pub fn on_change<V: 'static>(
        &self,
        window: &mut Window,
        cx: &mut Context<V>,
        changed: impl Fn(&mut V, &mut Window, &mut Context<V>) + 'static,
    ) -> Subscription {
        cx.subscribe_in(&self.state, window, move |view, _, event: &InputEvent, window, cx| {
            if matches!(event, InputEvent::Change) {
                changed(view, window, cx);
            }
        })
    }

    /// `.note-prose`: 15 points with open lines, filling what is left of the page.
    pub fn render(&self) -> impl IntoElement {
        // The field keeps 10 beside and 8 above its text: taken back here, so
        // the text starts under the title, 10 below what is above it.
        div().flex_1().min_h_0().mx(px(-10.)).pt(px(2.)).child(
            Textarea::new(&self.state)
                .appearance(false)
                .readonly(!self.editable)
                .h_full()
                .text_size(px(15.))
                .line_height(px(27.)),
        )
    }
}
