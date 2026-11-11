use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_opener::OpenerExt;

/// Pages of the app itself: the bundled files, or the Vite server in development.
fn is_app_url(url: &Url) -> bool {
    match url.scheme() {
        "tauri" => true,
        "http" | "https" => matches!(url.host_str(), Some("tauri.localhost") | Some("localhost")),
        // about:blank and the like, used by mail in its sandboxed frames.
        "about" | "data" | "blob" => true,
        _ => false,
    }
}

/// Links (in mail, notes, settings) open in the default browser or mail app.
fn open_outside(app: &AppHandle, url: &Url) {
    if let Err(error) = app.opener().open_url(url.as_str(), None::<&str>) {
        eprintln!("Could not open {url}: {error}");
    }
}

fn show(window: &WebviewWindow) {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

fn create_main_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let navigating = app.clone();
    let opening = app.clone();
    let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Even")
        .inner_size(1360.0, 860.0)
        // Narrower, Even mailen hides its sidebar, which holds the window buttons.
        .min_inner_size(1040.0, 600.0)
        .on_navigation(move |url| {
            if is_app_url(url) {
                return true;
            }
            open_outside(&navigating, url);
            false
        })
        .on_new_window(move |url, _features| {
            if !is_app_url(&url) {
                open_outside(&opening, &url);
            }
            NewWindowResponse::Deny
        });
    // The window buttons sit over the app rail instead of a title bar.
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(18.0, 28.0));
    builder.build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // A second start brings the open window forward instead.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                show(&window);
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            create_main_window(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // On macOS closing the window keeps Even running, as Mail does;
            // the Dock icon brings it back.
            #[cfg(target_os = "macos")]
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (window, event);
        })
        .build(tauri::generate_context!())
        .expect("error while building Even")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let RunEvent::Reopen { .. } = event {
                if let Some(window) = app.get_webview_window("main") {
                    show(&window);
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
