mod mail_cache;
mod sign_in;
mod updates;
mod window_size;

use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_window_state::StateFlags;

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

pub(crate) fn show(window: &WebviewWindow) {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

fn create_main_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let navigating = app.clone();
    let opening = app.clone();
    let size = window_size::load(app);
    let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Even")
        .inner_size(size.width, size.height)
        .min_inner_size(window_size::MINIMUM.width, window_size::MINIMUM.height)
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
        .traffic_light_position(tauri::LogicalPosition::new(12.0, 21.0));
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
        // Where the window was, not how big: see window_size for why.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() - StateFlags::SIZE)
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updates::UpdateState::default())
        .invoke_handler(tauri::generate_handler![
            updates::ready_update,
            updates::check_for_update,
            updates::install_update,
            sign_in::listen_for_sign_in,
            sign_in::cancel_sign_in,
            mail_cache::mail_cache_get,
            mail_cache::mail_cache_set,
            mail_cache::mail_cache_remove,
            mail_cache::mail_cache_thread,
            mail_cache::mail_cache_put_thread,
            mail_cache::mail_cache_clear
        ])
        .setup(|app| {
            // Before the window, so the mail's first reads find it.
            app.manage(mail_cache::MailCache::open(app.handle()));
            create_main_window(app.handle())?;
            updates::watch(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| {
            // On macOS closing the window keeps Even running, as Mail does;
            // the Dock icon brings it back.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if let Some(webview) = window.app_handle().get_webview_window(window.label()) {
                    window_size::save(&webview);
                }
                #[cfg(target_os = "macos")]
                {
                    api.prevent_close();
                    let _ = window.hide();
                }
                #[cfg(not(target_os = "macos"))]
                let _ = api;
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Even")
        .run(|app, event| {
            // Quitting (Cmd+Q, or the Dock) skips the window's close.
            if let RunEvent::ExitRequested { .. } = event {
                if let Some(window) = app.get_webview_window("main") {
                    window_size::save(&window);
                }
            }
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
