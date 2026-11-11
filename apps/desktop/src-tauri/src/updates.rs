//! Updates from GitHub Releases. A new version downloads in the background;
//! the window then offers "Restart to update", so Even never quits by itself
//! in the middle of a message.

use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

/// How often a running app looks for a new version.
const CHECK_EVERY: Duration = Duration::from_secs(6 * 60 * 60);

/// A downloaded update, waiting to be installed.
#[derive(Default)]
pub struct UpdateState(Mutex<Option<(Update, Vec<u8>)>>);

impl UpdateState {
    fn ready_version(&self) -> Option<String> {
        self.0.lock().unwrap().as_ref().map(|(update, _)| update.version.clone())
    }
}

/// Checks for a new version and downloads it; the window hears when one is ready.
/// Returns the version that is ready to install, if any (also one downloaded earlier).
async fn check(app: &AppHandle) -> Result<Option<String>, String> {
    let state = app.state::<UpdateState>();
    let Some(update) = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())? else {
        return Ok(state.ready_version());
    };
    if state.ready_version().as_deref() == Some(update.version.as_str()) {
        return Ok(Some(update.version));
    }
    let bytes = update.download(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    let version = update.version.clone();
    *state.0.lock().unwrap() = Some((update, bytes));
    let _ = app.emit("update-ready", version.clone());
    Ok(Some(version))
}

/// "Check for updates" in the settings.
#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> Result<Option<String>, String> {
    // A development build would "update" itself into the release.
    if cfg!(debug_assertions) {
        return Ok(None);
    }
    check(&app).await
}

/// Looks for updates shortly after launch and then every few hours.
/// Development builds don't, they are never older than the release.
pub fn watch(app: &AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        sleep(Duration::from_secs(10)).await;
        loop {
            if let Err(error) = check(&app).await {
                eprintln!("Update check failed: {error}");
            }
            sleep(CHECK_EVERY).await;
        }
    });
}

async fn sleep(duration: Duration) {
    // Sleep on a blocking thread: keeps us independent of the async runtime's timer feature.
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(duration)).await;
}

/// The version waiting to be installed, for a window that missed the event.
#[tauri::command]
pub fn ready_update(app: AppHandle) -> Option<String> {
    app.state::<UpdateState>().ready_version()
}

/// Installs the downloaded update and restarts into it.
#[tauri::command]
pub fn install_update(app: AppHandle) -> Result<(), String> {
    let Some((update, bytes)) = app.state::<UpdateState>().0.lock().unwrap().take() else {
        return Err("No update ready".into());
    };
    update.install(bytes).map_err(|e| e.to_string())?;
    app.restart()
}
