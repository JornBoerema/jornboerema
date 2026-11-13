//! Even noteren. Still to be built natively: for now only its place in the rail.

use gpui_kit::prelude::*;
use gpui_kit::*;

use crate::api::{Client, User};
use crate::app::{AppEvent, EvenApp};
use crate::{theme, ui};

pub struct NotesApp {
    #[allow(dead_code)]
    client: Client,
    #[allow(dead_code)]
    user: User,
    focus: FocusHandle,
}

impl NotesApp {
    pub fn new(client: Client, user: User, _window: &mut Window, cx: &mut Context<Self>) -> Self {
        Self {
            client,
            user,
            focus: cx.focus_handle(),
        }
    }
}

impl EventEmitter<AppEvent> for NotesApp {}

impl EvenApp for NotesApp {
    fn activated(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        window.focus(&self.focus, cx);
    }
}

impl Render for NotesApp {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
            .track_focus(&self.focus)
            .size_full()
            .flex()
            .bg(theme::background())
            .text_color(theme::foreground())
            .child(
                div()
                    .m(px(8.))
                    .flex()
                    .child(ui::list_sidebar().child(div().pl(px(10.)).pb(px(22.)).child(ui::brand("note-01", "Even noteren")))),
            )
    }
}
