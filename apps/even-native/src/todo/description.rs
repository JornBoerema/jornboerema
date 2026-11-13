//! The description of an issue (components/board/description-editor.tsx).
//!
//! On the web this is a tiptap editor that reads and writes markdown. Here it
//! is a multi-line field holding that markdown as text, behind this one type:
//! when the shared rich text editor (src/editor.rs) is ready, it replaces the
//! field in here and nothing outside this file changes.

use gpui_kit::component::input::{InputEvent, Textarea, TextareaState};
use gpui_kit::prelude::*;
use gpui_kit::*;

pub(super) struct DescriptionEditor {
    state: Entity<TextareaState>,
    /// What the server has, as far as this editor knows: only a difference is saved.
    saved: String,
}

impl DescriptionEditor {
    pub(super) fn new(value: &str, placeholder: &str, window: &mut Window, cx: &mut App) -> Self {
        let state = cx.new(|cx| {
            TextareaState::new(window, cx)
                .auto_grow(4, 400)
                .placeholder(placeholder.to_string())
                .default_value(value.to_string())
        });
        Self {
            state,
            saved: value.to_string(),
        }
    }

    /// Typing and leaving the field, for whoever saves: `subscribe_in` to this.
    pub(super) fn events(&self) -> &Entity<TextareaState> {
        &self.state
    }

    /// Whether `event` is one after which the text should be saved at once
    /// (`true`), a moment later (`false`), or not at all (`None`).
    pub(super) fn save_on(event: &InputEvent) -> Option<bool> {
        match event {
            InputEvent::Blur => Some(true),
            InputEvent::Change => Some(false),
            _ => None,
        }
    }

    /// The markdown to save, if it differs from what was saved last.
    pub(super) fn take_unsaved(&mut self, cx: &App) -> Option<String> {
        let markdown = self.state.read(cx).value().to_string();
        if markdown == self.saved {
            return None;
        }
        self.saved = markdown.clone();
        Some(markdown)
    }

    /// Someone else changed it: show theirs, unless this editor is in use.
    pub(super) fn sync(&mut self, value: &str, window: &mut Window, cx: &mut App) {
        if value == self.saved || self.state.read(cx).focus_handle(cx).is_focused(window) {
            return;
        }
        // Not while what was typed here is still on its way.
        if self.state.read(cx).value().as_ref() != self.saved {
            return;
        }
        self.saved = value.to_string();
        self.state.update(cx, |state, cx| state.set_value(value.to_string(), window, cx));
    }

    pub(super) fn render(&self, editable: bool) -> impl IntoElement {
        div()
            .min_h(px(120.))
            .pt(px(12.))
            .pb(px(24.))
            .text_size(px(14.5))
            .line_height(relative(1.7))
            .child(
                Textarea::new(&self.state)
                    .appearance(false)
                    .readonly(!editable)
                    .text_size(px(14.5))
                    .line_height(relative(1.7)),
            )
    }
}
