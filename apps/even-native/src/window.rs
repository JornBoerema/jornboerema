//! The Even window itself, as apps/desktop/src-tauri gives it: its size and
//! where it was (window_size.rs and the window-state plugin), the window
//! buttons over the rail (lib.rs), the top strip that drags it
//! (apps/desktop/src/window.ts), closing that only hides it, and the menu
//! bar (Tauri's default app menu).

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use gpui_kit::*;
use serde::{Deserialize, Serialize};

use crate::i18n::t;
use crate::{auth, editor, shell};

/// window_size.rs: DEFAULT and MINIMUM. Narrower, Even mailen hides its
/// sidebar, which holds the window buttons.
pub const DEFAULT: (f32, f32) = (1360., 860.);
pub const MINIMUM: (f32, f32) = (1040., 600.);

/// lib.rs asks Tauri for `traffic_light_position(12, 21)`. Tauri makes the
/// title bar as tall as a button plus 21 and leaves the buttons 9 points above
/// its lower edge, which puts their top 12 points under the window's. GPUI
/// takes the top itself.
const TRAFFIC_LIGHTS: (f32, f32) = (12., 12.);

/// window.ts: the strip along the top of the window that works as its title bar.
const TITLE_BAR_HEIGHT: f32 = 52.;

actions!(
    even,
    [
        About,
        Hide,
        HideOthers,
        ShowAll,
        Quit,
        CloseWindow,
        Minimize,
        Zoom,
        ToggleFullScreen
    ]
);

// Size and place.

/// What is kept between launches, in points: they mean the same on every
/// screen (see window_size.rs for why not pixels).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
struct Saved {
    width: f32,
    height: f32,
    /// Where the window was; without it (the first launch) it opens centred.
    #[serde(default)]
    x: Option<f32>,
    #[serde(default)]
    y: Option<f32>,
    #[serde(default)]
    maximized: bool,
    #[serde(default)]
    fullscreen: bool,
}

impl Default for Saved {
    fn default() -> Self {
        Self {
            width: DEFAULT.0,
            height: DEFAULT.1,
            x: None,
            y: None,
            maximized: false,
            fullscreen: false,
        }
    }
}

impl Saved {
    fn parse(bytes: &[u8]) -> Self {
        let saved = serde_json::from_slice::<Saved>(bytes)
            .ok()
            .filter(|saved| saved.width.is_finite() && saved.height.is_finite())
            .unwrap_or_default();
        Self {
            // Never under the minimum.
            width: saved.width.max(MINIMUM.0),
            height: saved.height.max(MINIMUM.1),
            x: saved.x.filter(|x| x.is_finite()),
            y: saved.y.filter(|y| y.is_finite()),
            ..saved
        }
    }
}

fn file() -> Option<PathBuf> {
    Some(auth::data_dir()?.join("window.json"))
}

fn load() -> Saved {
    file()
        .and_then(|path| std::fs::read(path).ok())
        .map(|bytes| Saved::parse(&bytes))
        .unwrap_or_default()
}

/// What the window is now and what was last written.
static CURRENT: Mutex<Option<Saved>> = Mutex::new(None);
static WRITTEN: Mutex<Option<Saved>> = Mutex::new(None);

/// A run that only looks (scripts/shot.sh) leaves the user's window alone.
fn looking_only() -> bool {
    std::env::var_os("EVEN_BACKGROUND").is_some()
}

/// Writes the window's size and place, when they changed.
pub fn save() {
    if looking_only() {
        return;
    }
    let Some(current) = *CURRENT.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) else {
        return;
    };
    let mut written = WRITTEN.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if *written == Some(current) {
        return;
    }
    let Some(path) = file() else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    match serde_json::to_vec(&current) {
        Ok(json) => match std::fs::write(&path, json) {
            Ok(()) => *written = Some(current),
            Err(error) => eprintln!("Could not save the window size: {error}"),
        },
        Err(error) => eprintln!("Could not save the window size: {error}"),
    }
}

/// Notes where the window is; the file follows a moment after the last change.
/// Maximized or full screen, the size kept is the one to come back to.
pub fn remember(window: &mut Window, cx: &mut App) {
    let (bounds, maximized, fullscreen) = match window.window_bounds() {
        WindowBounds::Windowed(bounds) => (bounds, false, false),
        WindowBounds::Maximized(bounds) => (bounds, true, false),
        WindowBounds::Fullscreen(bounds) => (bounds, false, true),
    };
    let (width, height) = (f32::from(bounds.size.width).round(), f32::from(bounds.size.height).round());
    if width <= 0. || height <= 0. {
        return;
    }
    let now = Saved {
        width,
        height,
        x: Some(f32::from(bounds.origin.x).round()),
        y: Some(f32::from(bounds.origin.y).round()),
        maximized,
        fullscreen,
    };
    let changed = {
        let mut current = CURRENT.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        std::mem::replace(&mut *current, Some(now)) != Some(now)
    };
    if !changed || looking_only() {
        return;
    }
    // Not on every step of a drag: once it has been still for a moment.
    cx.spawn(async move |cx| {
        cx.background_executor().timer(Duration::from_millis(600)).await;
        let settled = *CURRENT.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) == Some(now);
        if settled {
            save();
        }
    })
    .detach();
}

/// The window as lib.rs builds it: "Even", the saved size (never under the
/// minimum) where it was, the window buttons over the rail and no title bar.
pub fn options(cx: &App) -> WindowOptions {
    let saved = load();
    let size = size(px(saved.width), px(saved.height));
    let bounds = match (saved.x, saved.y) {
        (Some(x), Some(y)) => Some(Bounds::new(point(px(x), px(y)), size)),
        _ => None,
    }
    // A screen that is gone (the external one, unplugged) must not keep the
    // window: its top strip, which moves it, has to be on one that is there.
    .filter(|bounds| {
        let grip = point(bounds.center().x, bounds.origin.y + px(TITLE_BAR_HEIGHT / 2.));
        cx.displays().iter().any(|display| display.bounds().contains(&grip))
    })
    .unwrap_or_else(|| Bounds::centered(None, size, cx));
    let window_bounds = if saved.fullscreen {
        WindowBounds::Fullscreen(bounds)
    } else if saved.maximized {
        WindowBounds::Maximized(bounds)
    } else {
        WindowBounds::Windowed(bounds)
    };
    WindowOptions {
        window_bounds: Some(window_bounds),
        titlebar: Some(TitlebarOptions {
            title: Some("Even".into()),
            appears_transparent: true,
            traffic_light_position: Some(point(px(TRAFFIC_LIGHTS.0), px(TRAFFIC_LIGHTS.1))),
        }),
        window_min_size: Some(gpui_kit::size(px(MINIMUM.0), px(MINIMUM.1))),
        // The top strip moves the window itself (see `title_bar`): macOS then
        // neither drags it from its own, lower title bar nor holds clicks there
        // back to see whether a second one follows.
        app_owns_titlebar_drag: true,
        ..Default::default()
    }
}

/// lib.rs, `CloseRequested` on macOS: closing the window keeps Even running,
/// as Mail does; the Dock icon brings it back.
pub fn keep_running_when_closed(window: &mut Window, cx: &mut App) {
    window.on_window_should_close(cx, |_, cx| {
        save();
        cx.hide();
        false
    });
}

// The strip that drags.

/// A press in the top strip that may still turn into a drag.
static PRESSED: AtomicBool = AtomicBool::new(false);

/// window.ts keeps the clicks of controls in the strip (`INTERACTIVE`). Here a
/// control is what turns the pointer into a hand or a text cursor: every
/// button and field of ours does.
fn over_a_control() -> bool {
    #[cfg(target_os = "macos")]
    {
        use objc2::runtime::AnyObject;
        use objc2::{class, msg_send};
        // SAFETY: mouse events arrive on the main thread, where AppKit's
        // cursors may be asked for; both calls return objects AppKit owns.
        unsafe {
            let current: *mut AnyObject = msg_send![class!(NSCursor), currentCursor];
            let arrow: *mut AnyObject = msg_send![class!(NSCursor), arrowCursor];
            !current.is_null() && current != arrow
        }
    }
    #[cfg(not(target_os = "macos"))]
    false
}

/// window.ts, `useWindowDragging`: the window has no title bar (its buttons sit
/// over the rail), so its top 52 points drag it and a double-click there zooms
/// it, as a title bar would. Put on the element that fills the window: under a
/// dialog or the settings it hears nothing, as the web checks for `[role=dialog]`.
pub fn title_bar(root: Div) -> Div {
    let on_strip = |position: Point<Pixels>, window: &Window| {
        position.y <= px(TITLE_BAR_HEIGHT) && !window.is_fullscreen() && !over_a_control()
    };
    root.on_mouse_down(MouseButton::Left, move |event, window, _| {
        let pressed = on_strip(event.position, window);
        if pressed && event.click_count == 2 {
            PRESSED.store(false, Ordering::Relaxed);
            window.zoom_window();
            return;
        }
        PRESSED.store(pressed && event.click_count == 1, Ordering::Relaxed);
    })
    .on_mouse_up(MouseButton::Left, |_, _, _| PRESSED.store(false, Ordering::Relaxed))
    // Moving with the button down, not the press itself: a click stays a click.
    .on_mouse_move(|event, window, _| {
        if event.pressed_button != Some(MouseButton::Left) {
            PRESSED.store(false, Ordering::Relaxed);
        } else if PRESSED.swap(false, Ordering::Relaxed) {
            window.start_window_move();
        }
    })
}

// The menu bar.

/// Tauri's default app menu, which lib.rs leaves as it is, in the app's
/// language, with the settings (⌘,) the web opens by key added to the first.
pub fn menus() -> Vec<Menu> {
    vec![
        Menu {
            name: "Even".into(),
            items: vec![
                MenuItem::action(t("About Even", "Over Even"), About),
                MenuItem::separator(),
                MenuItem::action(t("Settings…", "Instellingen…"), shell::OpenSettings),
                MenuItem::separator(),
                MenuItem::os_submenu(t("Services", "Voorzieningen"), SystemMenuType::Services),
                MenuItem::separator(),
                MenuItem::action(t("Hide Even", "Verberg Even"), Hide),
                MenuItem::action(t("Hide Others", "Verberg andere"), HideOthers),
                MenuItem::action(t("Show All", "Toon alles"), ShowAll),
                MenuItem::separator(),
                MenuItem::action(t("Quit Even", "Stop Even"), Quit),
            ],
            disabled: false,
        },
        Menu {
            name: t("File", "Archief").into(),
            items: vec![MenuItem::action(t("Close Window", "Sluit venster"), CloseWindow)],
            disabled: false,
        },
        editor::edit_menu(),
        Menu {
            name: t("View", "Weergave").into(),
            items: vec![MenuItem::action(
                t("Toggle Full Screen", "Schermvullende weergave"),
                ToggleFullScreen,
            )],
            disabled: false,
        },
        Menu {
            name: window_menu_name().into(),
            items: vec![
                MenuItem::action(t("Minimize", "Minimaliseer"), Minimize),
                MenuItem::action(t("Zoom", "Vergroot/verklein"), Zoom),
                MenuItem::separator(),
                MenuItem::action(t("Close Window", "Sluit venster"), CloseWindow),
            ],
            disabled: false,
        },
        Menu {
            name: "Help".into(),
            items: Vec::new(),
            disabled: false,
        },
    ]
}

fn window_menu_name() -> &'static str {
    t("Window", "Venster")
}

/// The menu bar and the keys macOS gives every app: ⌘Q, ⌘W, ⌘M, ⌘H, ⌥⌘H, ⌃⌘F.
pub fn init(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("cmd-q", Quit, None),
        KeyBinding::new("cmd-w", CloseWindow, None),
        KeyBinding::new("cmd-m", Minimize, None),
        KeyBinding::new("cmd-h", Hide, None),
        KeyBinding::new("alt-cmd-h", HideOthers, None),
        KeyBinding::new("ctrl-cmd-f", ToggleFullScreen, None),
    ]);
    cx.on_action(|_: &Quit, cx| {
        save();
        cx.quit();
    });
    cx.on_action(|_: &About, _| about());
    cx.on_action(|_: &Hide, cx| cx.hide());
    cx.on_action(|_: &HideOthers, cx| cx.hide_other_apps());
    cx.on_action(|_: &ShowAll, cx| cx.unhide_other_apps());
    // Closing hides (see `keep_running_when_closed`).
    cx.on_action(|_: &CloseWindow, cx| {
        save();
        cx.hide();
    });
    cx.on_action(|_: &Minimize, cx| in_window(cx, |window| window.minimize_window()));
    cx.on_action(|_: &Zoom, cx| in_window(cx, |window| window.zoom_window()));
    cx.on_action(|_: &ToggleFullScreen, cx| in_window(cx, |window| window.toggle_fullscreen()));
    set_menus(cx);
}

/// Sets the menu bar; again after the language changed.
pub fn set_menus(cx: &mut App) {
    cx.set_menus(menus());
    name_system_menus();
}

fn in_window(cx: &mut App, f: impl FnOnce(&mut Window)) {
    let Some(window) = cx.active_window().or_else(|| cx.windows().first().copied()) else {
        return;
    };
    let _ = window.update(cx, |_, window, _| f(window));
}

/// Tauri's About item: the system's panel with the name, the version and the icon.
fn about() {
    #[cfg(target_os = "macos")]
    {
        use objc2::runtime::AnyObject;
        use objc2::{class, msg_send};
        // SAFETY: menu actions run on the main thread; the panel takes no sender.
        unsafe {
            let app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
            let _: () = msg_send![app, activateIgnoringOtherApps: true];
            let _: () = msg_send![app, orderFrontStandardAboutPanel: std::ptr::null::<AnyObject>()];
        }
    }
}

/// GPUI knows the Window menu by its English name only. Tells macOS which
/// menus are the Window and Help ones in any language, so it adds its own
/// items there (the window list, tiling; the search field).
fn name_system_menus() {
    #[cfg(target_os = "macos")]
    {
        use objc2::runtime::AnyObject;
        use objc2::{class, msg_send};
        let titled = |title: &str| -> *mut AnyObject {
            // SAFETY: the menu bar is built and read on the main thread; a
            // missing item answers nil, and messages to nil answer nil.
            unsafe {
                let app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
                let bar: *mut AnyObject = msg_send![app, mainMenu];
                let text: *mut AnyObject = msg_send![class!(NSString), alloc];
                let text: *mut AnyObject = msg_send![text, initWithBytes: title.as_ptr().cast::<std::ffi::c_void>(), length: title.len(), encoding: 4usize];
                let item: *mut AnyObject = msg_send![bar, itemWithTitle: text];
                let _: () = msg_send![text, release];
                msg_send![item, submenu]
            }
        };
        // SAFETY: as above; both setters take a menu or nil.
        unsafe {
            let app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
            let window_menu = titled(window_menu_name());
            if !window_menu.is_null() {
                let _: () = msg_send![app, setWindowsMenu: window_menu];
            }
            let help_menu = titled("Help");
            if !help_menu.is_null() {
                let _: () = msg_send![app, setHelpMenu: help_menu];
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Saved, DEFAULT, MINIMUM};

    #[test]
    fn opens_at_the_default_size_without_a_file() {
        let saved = Saved::parse(b"not json");
        assert_eq!((saved.width, saved.height), DEFAULT);
        assert_eq!((saved.x, saved.y), (None, None));
        assert!(!saved.maximized && !saved.fullscreen);
    }

    #[test]
    fn never_opens_under_the_minimum() {
        let saved = Saved::parse(br#"{"width":400,"height":300,"x":10,"y":20}"#);
        assert_eq!((saved.width, saved.height), MINIMUM);
        assert_eq!((saved.x, saved.y), (Some(10.), Some(20.)));
    }

    #[test]
    fn reads_the_tauri_shape_too() {
        // window-size.json of the Tauri app: only a size.
        let saved = Saved::parse(br#"{"width":1500.0,"height":900.0}"#);
        assert_eq!((saved.width, saved.height), (1500., 900.));
        assert_eq!(saved.x, None);
    }

    #[test]
    fn keeps_what_it_wrote() {
        let saved = Saved {
            width: 1400.,
            height: 880.,
            x: Some(-1200.),
            y: Some(40.),
            maximized: true,
            fullscreen: false,
        };
        assert_eq!(Saved::parse(&serde_json::to_vec(&saved).unwrap()), saved);
    }
}
