mod capture;

use std::collections::HashMap;
use std::sync::Mutex;

use capture::Capture;
use serde::Serialize;
use tauri::http::{header, Response, StatusCode};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, RunEvent, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Captures waiting in an editor window, by id. Removed when that window closes.
#[derive(Default)]
struct Captures(Mutex<HashMap<String, Capture>>);

/// A pickable window, relative to one overlay, in its CSS pixels.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowTarget {
    id: u32,
    title: String,
    app: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// Window targets per overlay (window mode only), front to back.
#[derive(Default)]
struct OverlayTargets(Mutex<HashMap<String, Vec<WindowTarget>>>);

#[derive(Clone, Copy, PartialEq)]
enum OverlayMode {
    Area,
    Window,
}

/// ⌥⇧<n> on macOS (⌘⇧3/4/5 belong to the system), Ctrl+Shift+<n> on Windows.
fn shortcut(key: Code) -> Shortcut {
    #[cfg(target_os = "macos")]
    let modifiers = Modifiers::ALT | Modifiers::SHIFT;
    #[cfg(not(target_os = "macos"))]
    let modifiers = Modifiers::CONTROL | Modifiers::SHIFT;
    Shortcut::new(Some(modifiers), key)
}
fn fullscreen_shortcut() -> Shortcut {
    shortcut(Code::Digit1)
}
fn area_shortcut() -> Shortcut {
    shortcut(Code::Digit2)
}
fn window_shortcut() -> Shortcut {
    shortcut(Code::Digit3)
}

/// Checks the macOS permission; returns false (and explains) when missing.
fn ensure_permission(app: &AppHandle) -> bool {
    if capture::permission::granted() {
        return true;
    }
    // First time: the system prompt. Afterwards: our explanation window.
    if !capture::permission::request() {
        show_permission_window(app);
    }
    false
}

fn show_permission_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("permission") {
        let _ = window.set_focus();
        return;
    }
    let _ = WebviewWindowBuilder::new(app, "permission", WebviewUrl::App("index.html".into()))
        .title("Even vastleggen")
        .inner_size(460.0, 260.0)
        .resizable(false)
        .center()
        .focused(true)
        .title_bar_style_overlay()
        .build();
}

fn capture_fullscreen(app: &AppHandle) {
    if !ensure_permission(app) {
        return;
    }
    let cursor = app.cursor_position().map(|p| (p.x, p.y)).unwrap_or((0.0, 0.0));
    let app = app.clone();
    // Capturing and PNG encoding take a moment; keep the shortcut handler free.
    std::thread::spawn(move || match capture::fullscreen(cursor) {
        Ok(capture) => open_editor(&app, capture),
        Err(error) => eprintln!("Capture failed: {error}"),
    });
}

fn open_editor(app: &AppHandle, capture: Capture) {
    let id = uuid::Uuid::new_v4().simple().to_string();
    // The window is exactly the image (at most its real size, scaled down to
    // fit comfortably) plus the toolbar, so the image fills it edge to edge.
    const TOOLBAR: f64 = 48.0;
    const MIN_WIDTH: f64 = 300.0;
    let scale = capture.scale_factor.max(1.0) as f64;
    let (width, height) = (capture.image.width() as f64 / scale, capture.image.height() as f64 / scale);
    let fit = (1100.0 / width).min(760.0 / height).min(1.0);
    app.state::<Captures>().0.lock().unwrap().insert(id.clone(), capture);

    let label = format!("editor-{id}");
    let app_for_window = app.clone();
    let _ = app.run_on_main_thread(move || {
        let built = WebviewWindowBuilder::new(&app_for_window, &label, WebviewUrl::App(format!("index.html?capture={id}").into()))
            .title("Even vastleggen")
            .inner_size((width * fit).max(MIN_WIDTH), height * fit + TOOLBAR)
            .min_inner_size(MIN_WIDTH, TOOLBAR + 80.0)
            .center()
            .focused(true)
            .title_bar_style_overlay()
            .build();
        if let Ok(window) = built {
            let _ = window.set_focus();
            let app = app_for_window.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::Destroyed = event {
                    app.state::<Captures>().0.lock().unwrap().remove(&id);
                }
            });
        }
    });
}

const OVERLAY_PREFIX: &str = "overlay-";

/// Area and window selection: freeze every monitor first (and list the windows
/// before our overlays cover them), then show one borderless window per monitor
/// with that frozen image, so nothing moves while selecting.
fn start_overlay(app: &AppHandle, mode: OverlayMode) {
    if !ensure_permission(app) {
        return;
    }
    // A new selection replaces any overlay that is still around.
    close_overlay_windows(app);
    let monitors = app.available_monitors().unwrap_or_default();
    let cursor = app.cursor_position().ok();
    let app = app.clone();
    std::thread::spawn(move || {
        let windows = if mode == OverlayMode::Window { capture::list_windows() } else { Vec::new() };
        let mut frozen = Vec::new();
        for monitor in monitors {
            let (pos, size, scale) = (monitor.position(), monitor.size(), monitor.scale_factor());
            let centre = (pos.x as f64 + size.width as f64 / 2.0, pos.y as f64 + size.height as f64 / 2.0);
            match capture::monitor_containing(centre.0, centre.1) {
                Ok(capture) => frozen.push((capture, *pos, *size, scale)),
                Err(error) => eprintln!("Capture failed: {error}"),
            }
        }
        let app_for_windows = app.clone();
        let _ = app.run_on_main_thread(move || {
            for (capture, pos, size, scale) in frozen {
                let id = uuid::Uuid::new_v4().simple().to_string();
                app_for_windows.state::<Captures>().0.lock().unwrap().insert(id.clone(), capture);
                if mode == OverlayMode::Window {
                    let targets = window_targets(&windows, pos, size, scale);
                    app_for_windows.state::<OverlayTargets>().0.lock().unwrap().insert(id.clone(), targets);
                }
                let mode_param = if mode == OverlayMode::Window { "&mode=window" } else { "" };
                let under_cursor = cursor.is_some_and(|c| {
                    c.x >= pos.x as f64 && c.y >= pos.y as f64
                        && c.x < pos.x as f64 + size.width as f64 && c.y < pos.y as f64 + size.height as f64
                });
                let label = format!("{OVERLAY_PREFIX}{id}");
                let built = WebviewWindowBuilder::new(&app_for_windows, &label, WebviewUrl::App(format!("index.html?overlay={id}{mode_param}").into()))
                    .title("Even vastleggen")
                    .position(pos.x as f64 / scale, pos.y as f64 / scale)
                    .inner_size(size.width as f64 / scale, size.height as f64 / scale)
                    .decorations(false)
                    .resizable(false)
                    .shadow(false)
                    .always_on_top(true)
                    .skip_taskbar(true)
                    .visible_on_all_workspaces(true)
                    // Shown by the page once the frozen image has loaded (no flash).
                    .visible(false)
                    .focused(under_cursor)
                    .build();
                match built {
                    Ok(window) => {
                        raise_above_menu_bar(&window);
                        let app = app_for_windows.clone();
                        window.on_window_event(move |event| {
                            if let tauri::WindowEvent::Destroyed = event {
                                app.state::<Captures>().0.lock().unwrap().remove(&id);
                                app.state::<OverlayTargets>().0.lock().unwrap().remove(&id);
                            }
                        });
                    }
                    Err(error) => eprintln!("Overlay failed: {error}"),
                }
            }
        });
    });
}

/// Windows on one monitor, converted to that overlay's CSS pixels.
/// Window positions are logical points on macOS and physical pixels on Windows.
fn window_targets(
    windows: &[capture::WindowInfo],
    pos: tauri::PhysicalPosition<i32>,
    size: tauri::PhysicalSize<u32>,
    scale: f64,
) -> Vec<WindowTarget> {
    let (width, height) = (size.width as f64 / scale, size.height as f64 / scale);
    windows
        .iter()
        .map(|w| {
            #[cfg(target_os = "macos")]
            let (x, y, w_, h_) = (w.x - pos.x as f64 / scale, w.y - pos.y as f64 / scale, w.width, w.height);
            #[cfg(not(target_os = "macos"))]
            let (x, y, w_, h_) = ((w.x - pos.x as f64) / scale, (w.y - pos.y as f64) / scale, w.width / scale, w.height / scale);
            WindowTarget { id: w.id, title: w.title.clone(), app: w.app.clone(), x, y, width: w_, height: h_ }
        })
        .filter(|t| t.x < width && t.y < height && t.x + t.width > 0.0 && t.y + t.height > 0.0)
        .collect()
}

/// Overlays must cover the menu bar and the Dock on macOS.
#[cfg(target_os = "macos")]
fn raise_above_menu_bar(window: &tauri::WebviewWindow) {
    use objc2::{msg_send, runtime::AnyObject};
    const SCREEN_SAVER_LEVEL: isize = 1000;
    if let Ok(ns_window) = window.ns_window() {
        let ns_window = ns_window as *mut AnyObject;
        unsafe {
            let _: () = msg_send![ns_window, setLevel: SCREEN_SAVER_LEVEL];
        }
    }
}
#[cfg(not(target_os = "macos"))]
fn raise_above_menu_bar(_window: &tauri::WebviewWindow) {}

fn close_overlay_windows(app: &AppHandle) {
    for (label, window) in app.webview_windows() {
        if label.starts_with(OVERLAY_PREFIX) {
            let _ = window.close();
        }
    }
}

/// macOS-only overlay title bar (traffic lights over our own toolbar).
trait TitleBarStyle {
    fn title_bar_style_overlay(self) -> Self;
}
impl<'a, R: tauri::Runtime, M: Manager<R>> TitleBarStyle for WebviewWindowBuilder<'a, R, M> {
    fn title_bar_style_overlay(self) -> Self {
        // Traffic lights vertically centred in our 48px toolbar with equal space above, below and to the left.
        #[cfg(target_os = "macos")]
        return self
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .traffic_light_position(tauri::LogicalPosition::new(19.0, 27.0));
        #[cfg(not(target_os = "macos"))]
        return self;
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CaptureInfo {
    width: u32,
    height: u32,
    scale_factor: f32,
}

#[tauri::command]
fn capture_info(id: String, captures: State<Captures>) -> Result<CaptureInfo, String> {
    let captures = captures.0.lock().unwrap();
    let capture = captures.get(&id).ok_or("Capture not found")?;
    Ok(CaptureInfo { width: capture.image.width(), height: capture.image.height(), scale_factor: capture.scale_factor })
}

#[tauri::command]
fn copy_capture(id: String, app: AppHandle, captures: State<Captures>) -> Result<(), String> {
    let captures = captures.0.lock().unwrap();
    let capture = captures.get(&id).ok_or("Capture not found")?;
    let image = tauri::image::Image::new(capture.image.as_raw(), capture.image.width(), capture.image.height());
    app.clipboard().write_image(&image).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_capture(id: String, path: String, captures: State<Captures>) -> Result<(), String> {
    let captures = captures.0.lock().unwrap();
    let capture = captures.get(&id).ok_or("Capture not found")?;
    std::fs::write(path, &capture.png).map_err(|e| e.to_string())
}

/// Cuts a selection (in CSS pixels of an overlay) out of that overlay's frozen capture.
fn crop_frozen(captures: &Captures, id: &str, x: f64, y: f64, width: f64, height: f64, viewport_width: f64) -> Result<Capture, String> {
    let captures = captures.0.lock().unwrap();
    let capture = captures.get(id).ok_or("Capture not found")?;
    // The overlay shows the whole image across its width: CSS px → image px.
    let scale = capture.image.width() as f64 / viewport_width.max(1.0);
    let px = |value: f64| (value * scale).round().max(0.0) as u32;
    capture::crop(capture, px(x), px(y), px(width), px(height))
}

/// Crops the selection and opens it in the editor. Overlays always close.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn crop_capture(
    id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    viewport_width: f64,
    app: AppHandle,
    captures: State<Captures>,
) -> Result<(), String> {
    let cropped = crop_frozen(&captures, &id, x, y, width, height, viewport_width);
    close_overlay_windows(&app);
    open_editor(&app, cropped?);
    Ok(())
}

#[tauri::command]
fn overlay_targets(id: String, targets: State<OverlayTargets>) -> Vec<WindowTarget> {
    targets.0.lock().unwrap().get(&id).cloned().unwrap_or_default()
}

/// Captures a picked window and opens the editor. Overlays always close.
///
/// On macOS the window is cut out of the frozen screen: the old per-window API
/// (CGWindowListCreateImage) no longer works on recent macOS. On Windows the
/// window itself is captured (including hidden parts), with the same fallback.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn capture_window(
    overlay_id: String,
    window_id: u32,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    viewport_width: f64,
    app: AppHandle,
) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    let direct = tauri::async_runtime::spawn_blocking(move || capture::window(window_id)).await.ok().and_then(Result::ok);
    #[cfg(target_os = "macos")]
    let direct: Option<Capture> = {
        let _ = window_id;
        None
    };
    let result = match direct {
        Some(capture) => Ok(capture),
        None => crop_frozen(&app.state::<Captures>(), &overlay_id, x, y, width, height, viewport_width),
    };
    close_overlay_windows(&app);
    let capture = result.inspect_err(|error| eprintln!("Window capture failed: {error}"))?;
    open_editor(&app, capture);
    Ok(())
}

#[tauri::command]
fn close_overlays(app: AppHandle) {
    close_overlay_windows(&app);
}

#[tauri::command]
fn open_screen_recording_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|_, _, _| {}))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    if shortcut == &fullscreen_shortcut() {
                        capture_fullscreen(app);
                    } else if shortcut == &area_shortcut() {
                        start_overlay(app, OverlayMode::Area);
                    } else if shortcut == &window_shortcut() {
                        start_overlay(app, OverlayMode::Window);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Captures::default())
        .manage(OverlayTargets::default())
        // capture://localhost/<id> (macOS) or http://capture.localhost/<id> (Windows):
        // serves the PNG straight to the editor, without base64 over IPC.
        .register_uri_scheme_protocol("capture", |ctx, request| {
            let id = request.uri().path().trim_start_matches('/').to_string();
            let captures = ctx.app_handle().state::<Captures>();
            let captures = captures.0.lock().unwrap();
            match captures.get(&id) {
                Some(capture) => Response::builder()
                    .header(header::CONTENT_TYPE, "image/png")
                    .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                    .body(capture.png.clone())
                    .unwrap(),
                None => Response::builder().status(StatusCode::NOT_FOUND).body(Vec::new()).unwrap(),
            }
        })
        .invoke_handler(tauri::generate_handler![capture_info, copy_capture, save_capture, crop_capture, overlay_targets, capture_window, close_overlays, open_screen_recording_settings])
        .setup(|app| {
            // A menu bar / tray app: no Dock icon on macOS.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            app.global_shortcut().register(fullscreen_shortcut())?;
            app.global_shortcut().register(area_shortcut())?;
            app.global_shortcut().register(window_shortcut())?;

            // Menu accelerators in Tauri's notation; shown next to the items.
            #[cfg(target_os = "macos")]
            let (screen_key, area_key, window_key) = ("Alt+Shift+1", "Alt+Shift+2", "Alt+Shift+3");
            #[cfg(not(target_os = "macos"))]
            let (screen_key, area_key, window_key) = ("Ctrl+Shift+1", "Ctrl+Shift+2", "Ctrl+Shift+3");
            let fullscreen = MenuItem::with_id(app, "fullscreen", "Capture screen", true, Some(screen_key))?;
            let area = MenuItem::with_id(app, "area", "Capture area", true, Some(area_key))?;
            let window = MenuItem::with_id(app, "window", "Capture window", true, Some(window_key))?;
            let quit = MenuItem::with_id(app, "quit", "Quit Even vastleggen", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&fullscreen, &area, &window, &PredefinedMenuItem::separator(app)?, &quit])?;
            TrayIconBuilder::with_id("main")
                .icon(tauri::include_image!("icons/tray.png"))
                .icon_as_template(true)
                .tooltip("Even vastleggen")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "fullscreen" => capture_fullscreen(app),
                    "area" => start_overlay(app, OverlayMode::Area),
                    "window" => start_overlay(app, OverlayMode::Window),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Even vastleggen");

    app.run(|_app, event| {
        // Stay running in the menu bar when the last editor window closes.
        if let RunEvent::ExitRequested { api, code, .. } = event {
            if code.is_none() {
                api.prevent_exit();
            }
        }
    });
}
