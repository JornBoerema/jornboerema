mod capture;
mod history;
mod settings;
mod updates;

use std::collections::HashMap;
use std::sync::Mutex;

use capture::Capture;
use serde::Serialize;
use settings::{AfterCapture, Settings, SettingsState};
use tauri::http::{header, Response, StatusCode};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, RunEvent, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

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

fn current_settings(app: &AppHandle) -> Settings {
    app.state::<SettingsState>().0.lock().unwrap().clone()
}

/// Registers the three capture shortcuts, replacing whatever was registered.
/// Errors are "invalid:<shortcut>", "duplicate:<shortcut>" or "taken:<shortcut>"
/// (in use by another app); the settings window turns them into a message.
fn register_shortcuts(app: &AppHandle, shortcuts: &settings::Shortcuts) -> Result<(), String> {
    let manager = app.global_shortcut();
    let _ = manager.unregister_all();
    let mut registered: Vec<Shortcut> = Vec::new();
    for text in shortcuts.all() {
        let shortcut: Shortcut = text.parse().map_err(|_| format!("invalid:{text}"))?;
        if registered.contains(&shortcut) {
            return Err(format!("duplicate:{text}"));
        }
        manager.register(shortcut).map_err(|_| format!("taken:{text}"))?;
        registered.push(shortcut);
    }
    Ok(())
}

fn on_shortcut(app: &AppHandle, pressed: &Shortcut) {
    let shortcuts = current_settings(app).shortcuts;
    let is = |text: &str| text.parse::<Shortcut>().is_ok_and(|s| &s == pressed);
    if is(&shortcuts.fullscreen) {
        capture_fullscreen(app);
    } else if is(&shortcuts.area) {
        start_overlay(app, OverlayMode::Area);
    } else if is(&shortcuts.window) {
        start_overlay(app, OverlayMode::Window);
    }
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
        Ok(capture) => deliver(&app, capture),
        Err(error) => eprintln!("Capture failed: {error}"),
    });
}

/// "Screenshot 2026-10-30 19.45.12.png" in `folder`, numbered if it already exists.
fn new_file_path(folder: &std::path::Path) -> std::path::PathBuf {
    let stamp = chrono::Local::now().format("%Y-%m-%d %H.%M.%S");
    let mut path = folder.join(format!("Screenshot {stamp}.png"));
    let mut n = 2;
    while path.exists() {
        path = folder.join(format!("Screenshot {stamp} ({n}).png"));
        n += 1;
    }
    path
}

fn write_clipboard(app: &AppHandle, image: &xcap::image::RgbaImage) -> Result<(), String> {
    let image = tauri::image::Image::new(image.as_raw(), image.width(), image.height());
    app.clipboard().write_image(&image).map_err(|e| e.to_string())
}

/// Handles a fresh screenshot as the settings say: open the editor, or copy or
/// save it and confirm with a small preview. If copying or saving fails, the
/// editor opens so nothing is lost.
fn deliver(app: &AppHandle, capture: Capture) {
    let settings = current_settings(app);
    let history_id = settings.keep_history.then(|| {
        let id = history::new_id();
        history::add(app, &id, &capture);
        id
    });
    let result = match settings.after_capture {
        AfterCapture::Editor => return open_editor(app, capture, history_id),
        AfterCapture::Copy => write_clipboard(app, &capture.image).map(|_| None),
        AfterCapture::Save => {
            let folder = settings.save_folder(app);
            let path = new_file_path(&folder);
            std::fs::create_dir_all(&folder)
                .and_then(|_| std::fs::write(&path, &capture.png))
                .map(|_| Some(path))
                .map_err(|e| e.to_string())
        }
    };
    match result {
        Ok(saved) => show_preview(app, capture, saved, history_id),
        Err(error) => {
            eprintln!("After-capture action failed: {error}");
            open_editor(app, capture, history_id);
        }
    }
}

const PREVIEW_PREFIX: &str = "preview-";

/// A small thumbnail in the bottom-right corner of the screen under the mouse,
/// confirming a copy or save. It never takes focus (you may be about to paste),
/// closes by itself, and opens the editor when clicked.
fn show_preview(app: &AppHandle, capture: Capture, saved: Option<std::path::PathBuf>, history_id: Option<String>) {
    const WIDTH: f64 = 240.0;
    const FOOTER: f64 = 40.0;
    const MARGIN: f64 = 16.0;
    let ratio = capture.image.height() as f64 / capture.image.width().max(1) as f64;
    let height = (WIDTH * ratio).clamp(72.0, 200.0) + FOOTER;
    let id = uuid::Uuid::new_v4().simple().to_string();
    app.state::<Captures>().0.lock().unwrap().insert(id.clone(), capture);

    let mut url = format!("index.html?preview={id}");
    if let Some(history_id) = &history_id {
        url.push_str(&format!("&history={history_id}"));
    }
    if let Some(path) = &saved {
        url.push_str(&format!("&path={}", urlencoding::encode(&path.to_string_lossy())));
    }
    let cursor = app.cursor_position().ok();
    let app = app.clone();
    let _ = app.clone().run_on_main_thread(move || {
        // One preview at a time: a new capture replaces the previous one.
        for (label, window) in app.webview_windows() {
            if label.starts_with(PREVIEW_PREFIX) {
                let _ = window.close();
            }
        }
        let monitor = cursor
            .and_then(|c| app.monitor_from_point(c.x, c.y).ok().flatten())
            .or_else(|| app.primary_monitor().ok().flatten());
        let (x, y) = match monitor {
            Some(monitor) => {
                let (area, scale) = (monitor.work_area(), monitor.scale_factor());
                (
                    (area.position.x as f64 + area.size.width as f64) / scale - WIDTH - MARGIN,
                    (area.position.y as f64 + area.size.height as f64) / scale - height - MARGIN,
                )
            }
            None => (MARGIN, MARGIN),
        };
        let built = WebviewWindowBuilder::new(&app, format!("{PREVIEW_PREFIX}{id}"), WebviewUrl::App(url.into()))
            .title("Even vastleggen")
            .position(x, y)
            .inner_size(WIDTH, height)
            .decorations(false)
            .resizable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .visible_on_all_workspaces(true)
            .focused(false)
            .focusable(false)
            .accept_first_mouse(true)
            // Shown by the page once the thumbnail has loaded.
            .visible(false)
            .build();
        match built {
            Ok(window) => {
                let app = app.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::Destroyed = event {
                        app.state::<Captures>().0.lock().unwrap().remove(&id);
                    }
                });
            }
            Err(error) => eprintln!("Preview failed: {error}"),
        }
    });
}

/// Opens a capture in a new editor window. `history_id` links it to its history
/// entry, which then gets the annotated version when you copy or save.
fn open_editor(app: &AppHandle, capture: Capture, history_id: Option<String>) {
    let id = uuid::Uuid::new_v4().simple().to_string();
    let mut url = format!("index.html?capture={id}");
    if let Some(history_id) = history_id {
        url.push_str(&format!("&history={history_id}"));
    }
    // The window is exactly the image (at most its real size, scaled down to
    // fit comfortably) plus the toolbar, so the image fills it edge to edge.
    const TOOLBAR: f64 = 48.0;
    // Wide enough for the annotation toolbar; smaller images are letterboxed.
    const MIN_WIDTH: f64 = 760.0;
    let scale = capture.scale_factor.max(1.0) as f64;
    let (width, height) = (capture.image.width() as f64 / scale, capture.image.height() as f64 / scale);
    let fit = (1100.0 / width).min(760.0 / height).min(1.0);
    app.state::<Captures>().0.lock().unwrap().insert(id.clone(), capture);

    let label = format!("editor-{id}");
    let app_for_window = app.clone();
    let _ = app.run_on_main_thread(move || {
        let built = WebviewWindowBuilder::new(&app_for_window, &label, WebviewUrl::App(url.into()))
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
    write_clipboard(&app, &capture.image)
}

/// Raw request body of an invoke (a PNG exported by the editor canvas).
fn png_body(request: &tauri::ipc::Request<'_>) -> Result<Vec<u8>, String> {
    match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        _ => Err("Expected PNG bytes".into()),
    }
}

/// Copies an annotated screenshot (PNG from the editor) to the clipboard.
#[tauri::command]
fn copy_png(request: tauri::ipc::Request<'_>, app: AppHandle) -> Result<(), String> {
    let png = png_body(&request)?;
    let image = xcap::image::load_from_memory(&png).map_err(|e| e.to_string())?.to_rgba8();
    write_clipboard(&app, &image)?;
    update_history(&app, &request, &png);
    Ok(())
}

/// The history entry (header `x-history`) takes over the annotated version.
fn update_history(app: &AppHandle, request: &tauri::ipc::Request<'_>, png: &[u8]) {
    if let Some(id) = request.headers().get("x-history").and_then(|v| v.to_str().ok()) {
        if let Err(error) = history::replace(app, id, png) {
            eprintln!("History not updated: {error}");
        }
    }
}

/// Saves an annotated screenshot; the path comes URL-encoded in `x-path`.
#[tauri::command]
fn save_png(request: tauri::ipc::Request<'_>, app: AppHandle) -> Result<(), String> {
    let path = request.headers().get("x-path").and_then(|v| v.to_str().ok()).ok_or("Missing path")?;
    let path = urlencoding::decode(path).map_err(|e| e.to_string())?;
    let png = png_body(&request)?;
    std::fs::write(path.as_ref(), &png).map_err(|e| e.to_string())?;
    update_history(&app, &request, &png);
    Ok(())
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
    deliver(&app, cropped?);
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
    deliver(&app, capture);
    Ok(())
}

/// Moves the capture of a preview into a new editor window.
#[tauri::command]
fn edit_preview(id: String, history_id: Option<String>, app: AppHandle) -> Result<(), String> {
    let capture = app.state::<Captures>().0.lock().unwrap().remove(&id).ok_or("Capture not found")?;
    if let Some(window) = app.get_webview_window(&format!("{PREVIEW_PREFIX}{id}")) {
        let _ = window.close();
    }
    open_editor(&app, capture, history_id);
    Ok(())
}

#[tauri::command]
fn history_list(app: AppHandle) -> Vec<history::Entry> {
    history::list(&app)
}

#[tauri::command]
async fn history_open(id: String, app: AppHandle) -> Result<(), String> {
    let capture = history::open(&app, &id)?;
    open_editor(&app, capture, Some(id));
    Ok(())
}

#[tauri::command]
async fn history_copy(id: String, app: AppHandle) -> Result<(), String> {
    write_clipboard(&app, &history::open(&app, &id)?.image)
}

#[tauri::command]
fn history_save(id: String, path: String, app: AppHandle) -> Result<(), String> {
    std::fs::copy(history::file(&app, &id)?, path).map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn history_delete(id: String, app: AppHandle) -> Result<(), String> {
    history::delete(&app, &id)
}

#[tauri::command]
fn history_clear(app: AppHandle) -> Result<(), String> {
    history::clear(&app)
}

#[tauri::command]
fn open_history(app: AppHandle) {
    show_history_window(&app);
}

fn show_history_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("history") {
        let _ = window.unminimize();
        let _ = window.set_focus();
        return;
    }
    let _ = WebviewWindowBuilder::new(app, "history", WebviewUrl::App("index.html?history".into()))
        .title("Even vastleggen")
        .inner_size(920.0, 640.0)
        .min_inner_size(520.0, 400.0)
        .center()
        .focused(true)
        .title_bar_style_overlay()
        .build();
}

/// Shows a saved file in Finder or Explorer.
#[tauri::command]
fn reveal_file(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let child = std::process::Command::new("open").arg("-R").arg(&path).spawn();
    #[cfg(target_os = "windows")]
    let child = std::process::Command::new("explorer").arg(format!("/select,{path}")).spawn();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let child = std::process::Command::new("xdg-open")
        .arg(std::path::Path::new(&path).parent().unwrap_or(std::path::Path::new("/")))
        .spawn();
    child.map(|_| ()).map_err(|e| e.to_string())
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

/// Settings plus the things that live outside the settings file.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SettingsView {
    #[serde(flatten)]
    settings: Settings,
    launch_at_login: bool,
    /// The folder screenshots actually go to (the Desktop when none is chosen).
    save_folder_path: String,
}

fn settings_view(app: &AppHandle, settings: Settings) -> SettingsView {
    SettingsView {
        launch_at_login: app.autolaunch().is_enabled().unwrap_or(false),
        save_folder_path: settings.save_folder(app).to_string_lossy().into_owned(),
        settings,
    }
}

#[tauri::command]
fn get_settings(app: AppHandle) -> SettingsView {
    settings_view(&app, current_settings(&app))
}

/// Saves new settings. Shortcuts are registered first; if one is taken, the
/// old ones come back and nothing is saved.
#[tauri::command]
fn update_settings(settings: Settings, app: AppHandle) -> Result<SettingsView, String> {
    let previous = current_settings(&app);
    // The language is reported separately (set_language); keep it.
    let settings = Settings { language: previous.language.clone(), ..settings };
    if settings.shortcuts != previous.shortcuts {
        if let Err(error) = register_shortcuts(&app, &settings.shortcuts) {
            let _ = register_shortcuts(&app, &previous.shortcuts);
            return Err(error);
        }
    }
    settings::store(&app, &settings)?;
    *app.state::<SettingsState>().0.lock().unwrap() = settings.clone();
    refresh_tray(&app);
    Ok(settings_view(&app, settings))
}

#[tauri::command]
fn set_launch_at_login(enabled: bool, app: AppHandle) -> Result<bool, String> {
    let autolaunch = app.autolaunch();
    let result = if enabled { autolaunch.enable() } else { autolaunch.disable() };
    result.map_err(|e| e.to_string())?;
    autolaunch.is_enabled().map_err(|e| e.to_string())
}

/// The windows own the language choice; the tray menu follows it.
#[tauri::command]
fn set_language(language: String, app: AppHandle) -> Result<(), String> {
    let state = app.state::<SettingsState>();
    let settings = {
        let mut settings = state.0.lock().unwrap();
        if settings.language.as_deref() == Some(language.as_str()) {
            return Ok(());
        }
        settings.language = Some(language);
        settings.clone()
    };
    settings::store(&app, &settings)?;
    refresh_tray(&app);
    Ok(())
}

/// While a new shortcut is being recorded, the current ones must not fire.
#[tauri::command]
fn suspend_shortcuts(app: AppHandle) {
    let _ = app.global_shortcut().unregister_all();
}

#[tauri::command]
fn resume_shortcuts(app: AppHandle) -> Result<(), String> {
    register_shortcuts(&app, &current_settings(&app).shortcuts)
}

#[tauri::command]
fn open_settings(app: AppHandle) {
    show_settings_window(&app);
}

fn show_settings_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.unminimize();
        let _ = window.set_focus();
        return;
    }
    let _ = WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("index.html?settings".into()))
        .title("Even vastleggen")
        .inner_size(640.0, 680.0)
        .min_inner_size(520.0, 420.0)
        .center()
        .focused(true)
        .title_bar_style_overlay()
        .build();
}

/// Tray menu texts; the menu follows the language of the windows.
struct TrayLabels {
    fullscreen: &'static str,
    area: &'static str,
    window: &'static str,
    settings: &'static str,
    history: &'static str,
    update: fn(&str) -> String,
    quit: &'static str,
}

fn tray_labels(language: &str) -> TrayLabels {
    match language {
        "nl" => TrayLabels {
            fullscreen: "Scherm vastleggen",
            area: "Gebied vastleggen",
            window: "Venster vastleggen",
            settings: "Instellingen…",
            history: "Geschiedenis…",
            update: |version| format!("Herstarten om bij te werken naar {version}"),
            quit: "Even vastleggen afsluiten",
        },
        _ => TrayLabels {
            fullscreen: "Capture screen",
            area: "Capture area",
            window: "Capture window",
            settings: "Settings…",
            history: "History…",
            update: |version| format!("Restart to update to {version}"),
            quit: "Quit Even vastleggen",
        },
    }
}

fn tray_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let settings = current_settings(app);
    let labels = tray_labels(settings.language());
    let shortcuts = &settings.shortcuts;
    // Accelerators are only shown next to the items; the global shortcuts do the work.
    let item = |id: &str, label: &str, accelerator: Option<&str>| {
        MenuItem::with_id(app, id, label, true, accelerator)
            .or_else(|_| MenuItem::with_id(app, id, label, true, None::<&str>))
    };
    let menu = Menu::with_items(
        app,
        &[
            &item("fullscreen", labels.fullscreen, Some(&shortcuts.fullscreen))?,
            &item("area", labels.area, Some(&shortcuts.area))?,
            &item("window", labels.window, Some(&shortcuts.window))?,
            &PredefinedMenuItem::separator(app)?,
            &item("history", labels.history, None)?,
            &item("settings", labels.settings, Some("CmdOrCtrl+,"))?,
            &PredefinedMenuItem::separator(app)?,
        ],
    )?;
    if let Some(version) = app.state::<updates::UpdateState>().ready_version() {
        menu.append(&item("update", &(labels.update)(&version), None)?)?;
    }
    menu.append(&item("quit", labels.quit, None)?)?;
    Ok(menu)
}

pub(crate) fn refresh_tray(app: &AppHandle) {
    if let (Some(tray), Ok(menu)) = (app.tray_by_id("main"), tray_menu(app)) {
        let _ = tray.set_menu(Some(menu));
    }
}

pub fn run() {
    let app = tauri::Builder::default()
        // Opening the app again (it has no Dock icon) shows its settings.
        .plugin(tauri_plugin_single_instance::init(|app, _, _| show_settings_window(app)))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        on_shortcut(app, shortcut);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Captures::default())
        .manage(updates::UpdateState::default())
        .manage(OverlayTargets::default())
        // capture://localhost/<id> (macOS) or http://capture.localhost/<id> (Windows):
        // serves the PNG straight to the editor, without base64 over IPC.
        // capture://localhost/thumb/<history id> serves a history thumbnail.
        .register_uri_scheme_protocol("capture", |ctx, request| {
            let id = request.uri().path().trim_start_matches('/').to_string();
            if let Some(history_id) = id.strip_prefix("thumb/") {
                let thumb = history::valid_id(history_id)
                    .then(|| history::thumb_path(ctx.app_handle(), history_id))
                    .flatten()
                    .and_then(|path| std::fs::read(path).ok());
                return match thumb {
                    Some(png) => Response::builder()
                        .header(header::CONTENT_TYPE, "image/png")
                        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                        .body(png)
                        .unwrap(),
                    None => Response::builder().status(StatusCode::NOT_FOUND).body(Vec::new()).unwrap(),
                };
            }
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
        .invoke_handler(tauri::generate_handler![
            capture_info,
            copy_capture,
            save_capture,
            copy_png,
            save_png,
            crop_capture,
            overlay_targets,
            capture_window,
            close_overlays,
            open_screen_recording_settings,
            get_settings,
            update_settings,
            set_launch_at_login,
            set_language,
            suspend_shortcuts,
            resume_shortcuts,
            open_settings,
            edit_preview,
            reveal_file,
            history_list,
            history_open,
            history_copy,
            history_save,
            history_delete,
            history_clear,
            open_history,
            updates::update_status,
            updates::check_for_update,
            updates::install_update
        ])
        .setup(|app| {
            // A menu bar / tray app: no Dock icon on macOS.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let handle = app.handle();
            let (settings, existed) = settings::load(handle);
            app.manage(history::load(handle));
            app.manage(SettingsState(std::sync::Mutex::new(settings.clone())));
            // A shortcut taken by another app should not stop the app; the
            // settings window shows which one and lets you pick another.
            if let Err(error) = register_shortcuts(handle, &settings.shortcuts) {
                eprintln!("Shortcut not registered: {error}");
            }

            TrayIconBuilder::with_id("main")
                .icon(tauri::include_image!("icons/tray.png"))
                .icon_as_template(true)
                .tooltip("Even vastleggen")
                .menu(&tray_menu(handle)?)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "fullscreen" => capture_fullscreen(app),
                    "area" => start_overlay(app, OverlayMode::Area),
                    "window" => start_overlay(app, OverlayMode::Window),
                    "settings" => show_settings_window(app),
                    "history" => show_history_window(app),
                    "update" => {
                        if let Err(error) = updates::install(app) {
                            eprintln!("Update failed: {error}");
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            updates::watch(handle);

            // First launch: show the settings, so it is clear the app is running
            // (it lives in the menu bar) and which shortcuts to use.
            if !existed {
                let _ = settings::store(handle, &settings);
                show_settings_window(handle);
            }
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
