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
mod workspace;

use gpui_kit::*;

use crate::shell::{Shell, SignOut};

actions!(even, [Quit]);

fn main() {
    gpui_kit::application().with_assets(assets::Assets).run(|cx| {
        gpui_kit::init(cx);
        assets::load_fonts(cx);
        theme::apply(cx);
        shell::bind_keys(cx);
        mail::bind_keys(cx);
        todo::bind_keys(cx);
        notes::bind_keys(cx);
        cx.bind_keys([KeyBinding::new("cmd-q", Quit, None)]);
        cx.on_action(|_: &Quit, cx| cx.quit());
        cx.set_menus(vec![Menu {
            name: "Even".into(),
            items: vec![
                MenuItem::action(i18n::t("Settings…", "Instellingen…"), shell::OpenSettings),
                MenuItem::separator(),
                MenuItem::action(i18n::t("Sign out", "Uitloggen"), SignOut),
                MenuItem::separator(),
                MenuItem::action(i18n::t("Quit Even", "Stop Even"), Quit),
            ],
            disabled: false,
        }, editor::edit_menu()]);
        // EVEN_EDITOR_DEMO=markdown|html: the rich text editor alone, to look at.
        if editor::demo_window(cx) {
            return;
        }
        let bounds = Bounds::centered(None, size(px(1360.), px(860.)), cx);
        let options = WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(bounds)),
            titlebar: Some(TitlebarOptions {
                title: Some("Even".into()),
                appears_transparent: true,
                traffic_light_position: Some(point(px(16.), px(18.))),
            }),
            window_min_size: Some(size(px(980.), px(560.))),
            ..Default::default()
        };
        gpui_kit::open_window(options, cx, |window, cx| cx.new(|cx| Shell::new(window, cx)))
            .expect("could not open the window");
        // A run that only checks the look stays behind what the user is doing.
        if std::env::var_os("EVEN_BACKGROUND").is_none() {
            cx.activate(true);
        }
    });
}
