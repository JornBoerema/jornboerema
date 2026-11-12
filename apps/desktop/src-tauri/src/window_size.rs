//! The main window's size, kept in logical points rather than pixels.
//!
//! The window-state plugin stores pixels and sets them back while the new window
//! still sits on the built-in Retina screen. A window last used on a 1x external
//! screen then opens at half its size. Points mean the same on every screen, so
//! the size is ours and the plugin only restores where the window was and
//! whether it was maximized.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, LogicalSize, Manager, Runtime, WebviewWindow};

pub const DEFAULT: Size = Size { width: 1360.0, height: 860.0 };
/// Narrower, Even mailen hides its sidebar, which holds the window buttons.
pub const MINIMUM: Size = Size { width: 1040.0, height: 600.0 };

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Size {
    pub width: f64,
    pub height: f64,
}

fn file<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|dir| dir.join("window-size.json"))
}

/// The size to open at: the saved one, never under the minimum.
pub fn load<R: Runtime>(app: &AppHandle<R>) -> Size {
    let saved = file(app)
        .and_then(|path| fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice::<Size>(&bytes).ok())
        .filter(|size| size.width.is_finite() && size.height.is_finite());
    let size = saved.unwrap_or(DEFAULT);
    Size {
        width: size.width.max(MINIMUM.width),
        height: size.height.max(MINIMUM.height),
    }
}

/// Writes the window's size to disk, unless it is maximized, full screen or minimized.
/// Read now rather than on every resize: by now the window has settled on its
/// screen, so its pixels and scale belong together.
pub fn save<R: Runtime>(window: &WebviewWindow<R>) {
    let special = window.is_maximized().unwrap_or(false)
        || window.is_fullscreen().unwrap_or(false)
        || window.is_minimized().unwrap_or(false);
    let (Ok(size), Ok(scale)) = (window.inner_size(), window.scale_factor()) else { return };
    if special || size.width == 0 || size.height == 0 {
        return;
    }
    let logical: LogicalSize<f64> = size.to_logical(scale);
    let size = Size { width: logical.width.round(), height: logical.height.round() };
    let Some(path) = file(window.app_handle()) else { return };
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_vec(&size) {
        if let Err(error) = fs::write(&path, json) {
            eprintln!("Could not save the window size: {error}");
        }
    }
}
