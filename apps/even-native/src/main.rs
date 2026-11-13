//! Even, native: the Even desktop app (mailen, doen, noteren in one window),
//! drawn by GPUI instead of a webview. It sits next to apps/desktop, the
//! Tauri app, and replaces nothing there.

mod api;
mod app;
mod assets;
mod auth;
mod editor;
mod email;
mod i18n;
mod mail;
mod notes;
mod prefs;
mod quote;
mod shell;
mod store;
mod theme;
mod todo;
mod ui;
mod updates;
mod window;
mod workspace;

use gpui_kit::*;

use crate::shell::Shell;

fn main() {
    let app = gpui_kit::application().with_assets(assets::Assets);
    // lib.rs, `RunEvent::Reopen`: the Dock icon brings the window back.
    app.on_reopen(|cx| cx.activate(true));
    app.run(|cx| {
        gpui_kit::init(cx);
        assets::load_fonts(cx);
        theme::apply(cx);
        shell::bind_keys(cx);
        mail::bind_keys(cx);
        todo::bind_keys(cx);
        notes::bind_keys(cx);
        window::init(cx);
        // EVEN_EDITOR_DEMO=markdown|html: the rich text editor alone, to look at.
        if editor::demo_window(cx) {
            return;
        }
        let options = window::options(cx);
        gpui_kit::open_window(options, cx, |window, cx| {
            window::keep_running_when_closed(window, cx);
            cx.new(|cx| Shell::new(window, cx))
        })
        .expect("could not open the window");
        // A run that only checks the look stays behind what the user is doing.
        if std::env::var_os("EVEN_BACKGROUND").is_none() {
            cx.activate(true);
        }
    });
}
