//! The description of an issue (components/board/description-editor.tsx,
//! `.note-prose.issue-prose` in app.css): the shared rich text editor
//! (src/editor.rs) in its markdown mode, as tall as its text and at least 120
//! points, saved a moment after typing stops and when it is left.
//!
//! The editor is a system webview: above everything GPUI draws, and not
//! clipped by the pane it scrolls in. So this draws only the part of it that
//! pane has in sight and tells the page how far down that part starts; the
//! page hands the wheel to the pane (`RichEditor::set_scroller`). And it is
//! taken off the screen while a menu, a dialog or the settings must show
//! where it is.

use std::cell::Cell;
use std::rc::Rc;

use gpui_kit::prelude::*;
use gpui_kit::*;

use crate::editor::{EditorEvent, Look, Mode, RichEditor};
use crate::theme;

/// `.issue-prose { min-height: 120px }`.
const MIN_HEIGHT: f32 = 120.;

pub(super) struct DescriptionEditor {
    editor: Entity<RichEditor>,
    /// What the server has, as far as this editor knows: only a difference is saved.
    saved: String,
    /// The pane the description scrolls in, with the title above it and the
    /// sub-issues and attachments below.
    scroller: ScrollHandle,
    /// Where the description's room was on screen at the last draw, and the
    /// part of the window its pane shows.
    seen: Rc<Cell<Option<(Bounds<Pixels>, Bounds<Pixels>)>>>,
    /// How far down its text the page was last told to start.
    page_top: f32,
}

impl DescriptionEditor {
    pub(super) fn new(value: &str, placeholder: &str, window: &mut Window, cx: &mut App) -> Self {
        let scroller = ScrollHandle::new();
        let editor = cx.new(|cx| RichEditor::new(Mode::Markdown, window, cx));
        editor.update(cx, |editor, cx| {
            editor.set_look(Look::ISSUE, cx);
            // The issue's dialog is drawn on the popover's colour.
            editor.set_background(theme::popover, cx);
            editor.set_placeholder(placeholder, cx);
            editor.set_scroller(scroller.clone(), cx);
            // Showing the description is not a change: only what the user does is reported.
            editor.set_content(value, cx);
        });
        Self {
            editor,
            saved: value.to_string(),
            scroller,
            seen: Rc::new(Cell::new(None)),
            page_top: 0.,
        }
    }

    /// Typing, leaving the field and growing, for whoever saves and draws: `subscribe_in` to this.
    pub(super) fn events(&self) -> &Entity<RichEditor> {
        &self.editor
    }

    /// The pane that scrolls the description: `track_scroll` it there.
    pub(super) fn scroller(&self) -> &ScrollHandle {
        &self.scroller
    }

    /// Whether `event` is one after which the text should be saved at once
    /// (`true`), a moment later (`false`), or not at all (`None`).
    pub(super) fn save_on(event: &EditorEvent) -> Option<bool> {
        match event {
            EditorEvent::Blurred => Some(true),
            EditorEvent::Changed(_) => Some(false),
            _ => None,
        }
    }

    /// The markdown to save, if it differs from what was saved last.
    pub(super) fn take_unsaved(&mut self, cx: &App) -> Option<String> {
        let markdown = self.editor.read(cx).content();
        if markdown == self.saved {
            return None;
        }
        self.saved = markdown.clone();
        Some(markdown)
    }

    /// Someone else changed it: show theirs, unless this editor is in use.
    pub(super) fn sync(&mut self, value: &str, cx: &mut App) {
        if value == self.saved || self.editor.read(cx).is_focused() {
            return;
        }
        // Not while what was typed here is still on its way.
        if self.editor.read(cx).content() != self.saved {
            return;
        }
        self.saved = value.to_string();
        self.editor.update(cx, |editor, cx| editor.set_content(value, cx));
    }

    /// Takes the editor off the screen, or puts it back (see the module's words).
    pub(super) fn set_hidden(&self, hidden: bool, cx: &mut App) {
        if self.editor.read(cx).is_hidden() != hidden {
            self.editor.update(cx, |editor, cx| editor.set_hidden(hidden, cx));
        }
    }

    /// `room`: what toasts take up at the window's foot; the editor stays out of it.
    pub(super) fn render(&mut self, editable: bool, room: f32, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let height = self
            .editor
            .read(cx)
            .content_height()
            .unwrap_or(MIN_HEIGHT)
            .max(MIN_HEIGHT);
        // The part of the description its pane shows, as measured at the last draw.
        let (top, visible) = match self.seen.get() {
            Some((slot, pane)) => {
                let foot = pane.bottom().min(window.viewport_size().height - px(room));
                let from = slot.top().max(pane.top());
                let to = (slot.top() + px(height)).min(foot);
                (f32::from(from - slot.top()), f32::from(to - from).max(0.))
            }
            // Not measured yet: no more than fits wherever the description starts.
            None => (0., height.min(MIN_HEIGHT)),
        };
        let top = top.clamp(0., height);
        let page_top = self.page_top;
        self.page_top = top;
        self.editor.update(cx, |editor, cx| {
            editor.set_editable(editable, cx);
            if top != page_top {
                editor.set_page_scroll(top, cx);
            }
        });
        let seen = self.seen.clone();
        div()
            .relative()
            // As tall as its text: the pane scrolls, it does not squeeze.
            .flex_none()
            .w_full()
            .h(px(height))
            .child(
                canvas(
                    move |bounds, window, _| {
                        let now = Some((bounds, window.content_mask().bounds));
                        if seen.get() != now {
                            seen.set(now);
                            // Drawn again with the part that is in sight now.
                            window.request_animation_frame();
                        }
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .size_full(),
            )
            .child(
                div()
                    .absolute()
                    .left_0()
                    .right_0()
                    .top(px(top))
                    .h(px(visible))
                    .child(self.editor.clone()),
            )
    }
}
