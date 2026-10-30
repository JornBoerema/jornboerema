//! Updates from GitHub Releases. A new version downloads in the background;
//! it installs only when you choose "Restart to update" (tray or settings),
//! so the app never quits in the middle of a screenshot.

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

/// How often a running app looks for a new version.
const CHECK_EVERY: Duration = Duration::from_secs(6 * 60 * 60);

/// A downloaded update, waiting to be installed.
#[derive(Default)]
pub struct UpdateState(Mutex<Option<(Update, Vec<u8>)>>);

impl UpdateState {
    pub fn ready_version(&self) -> Option<String> {
        self.0.lock().unwrap().as_ref().map(|(update, _)| update.version.clone())
    }
}

/// Checks for a new version and downloads it. Returns the version that is
/// ready to install, if any (also when it was downloaded earlier).
pub async fn check(app: &AppHandle) -> Result<Option<String>, String> {
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
    crate::refresh_tray(app);
    Ok(Some(version))
}

/// Installs the downloaded update and restarts into it.
pub fn install(app: &AppHandle) -> Result<(), String> {
    let Some((update, bytes)) = app.state::<UpdateState>().0.lock().unwrap().take() else {
        return Err("No update ready".into());
    };
    update.install(bytes).map_err(|e| e.to_string())?;
    app.restart()
}

/// Looks for updates shortly after launch and then every few hours.
/// Development builds don't, they are never older than the release.
pub fn watch(app: &AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio_sleep(Duration::from_secs(10)).await;
        loop {
            if let Err(error) = check(&app).await {
                eprintln!("Update check failed: {error}");
            }
            tokio_sleep(CHECK_EVERY).await;
        }
    });
}

async fn tokio_sleep(duration: Duration) {
    // Sleep on a blocking thread: keeps us independent of the async runtime's timer feature.
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(duration)).await;
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    current: String,
    ready: Option<String>,
}

#[tauri::command]
pub fn update_status(app: AppHandle) -> UpdateStatus {
    UpdateStatus {
        current: app.package_info().version.to_string(),
        ready: app.state::<UpdateState>().ready_version(),
    }
}

#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> Result<Option<String>, String> {
    check(&app).await
}

#[tauri::command]
pub fn install_update(app: AppHandle) -> Result<(), String> {
    install(&app)
}
