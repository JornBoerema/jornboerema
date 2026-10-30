//! Screenshot history: every capture is kept on disk (PNG plus a small
//! thumbnail) in the app's data folder, newest first, up to `MAX_ENTRIES`.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use xcap::image::imageops::FilterType;

use crate::capture::{self, Capture};

/// Older screenshots are removed beyond this.
const MAX_ENTRIES: usize = 500;
/// Thumbnail width in pixels (sharp at 2x in the history grid).
const THUMB_WIDTH: u32 = 480;
/// Sent to the windows whenever the history changes.
pub const CHANGED_EVENT: &str = "history-changed";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    /// Milliseconds since the Unix epoch.
    pub created_at: i64,
    /// Changes when the image is replaced by an annotated version (cache busting).
    pub updated_at: i64,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f32,
}

#[derive(Default)]
pub struct HistoryState(Mutex<Vec<Entry>>);

fn dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|dir| dir.join("history"))
}

fn image_path(app: &AppHandle, id: &str) -> Option<PathBuf> {
    dir(app).map(|dir| dir.join(format!("{id}.png")))
}

pub fn thumb_path(app: &AppHandle, id: &str) -> Option<PathBuf> {
    dir(app).map(|dir| dir.join(format!("{id}.thumb.png")))
}

fn now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// Ids appear in file paths and URLs: only what `new_id` makes is accepted.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric())
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

/// Reads the index at startup.
pub fn load(app: &AppHandle) -> HistoryState {
    let entries = dir(app)
        .and_then(|dir| std::fs::read_to_string(dir.join("index.json")).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();
    HistoryState(Mutex::new(entries))
}

fn store_index(app: &AppHandle, entries: &[Entry]) -> Result<(), String> {
    let dir = dir(app).ok_or("No data folder")?;
    let text = serde_json::to_string(entries).map_err(|e| e.to_string())?;
    // Write then rename, so a crash never leaves half an index.
    let temp = dir.join("index.json.tmp");
    std::fs::write(&temp, text).map_err(|e| e.to_string())?;
    std::fs::rename(temp, dir.join("index.json")).map_err(|e| e.to_string())
}

fn write_files(app: &AppHandle, id: &str, image: &xcap::image::RgbaImage, png: &[u8]) -> Result<(), String> {
    let dir = dir(app).ok_or("No data folder")?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(format!("{id}.png")), png).map_err(|e| e.to_string())?;
    let height = ((image.height() as f64 * THUMB_WIDTH as f64 / image.width().max(1) as f64).round() as u32).max(1);
    let thumb = if image.width() > THUMB_WIDTH {
        xcap::image::imageops::resize(image, THUMB_WIDTH, height, FilterType::Triangle)
    } else {
        image.clone()
    };
    std::fs::write(dir.join(format!("{id}.thumb.png")), capture::encode_png(&thumb)?).map_err(|e| e.to_string())
}

fn remove_files(app: &AppHandle, id: &str) {
    for path in [image_path(app, id), thumb_path(app, id)].into_iter().flatten() {
        let _ = std::fs::remove_file(path);
    }
}

fn changed(app: &AppHandle) {
    let _ = app.emit(CHANGED_EVENT, ());
}

/// Adds a capture under `id`. Runs on a background thread: the files take a moment.
pub fn add(app: &AppHandle, id: &str, capture: &Capture) {
    let entry = Entry {
        id: id.to_string(),
        created_at: now(),
        updated_at: now(),
        width: capture.image.width(),
        height: capture.image.height(),
        scale_factor: capture.scale_factor,
    };
    let (image, png) = (capture.image.clone(), capture.png.clone());
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(error) = write_files(&app, &entry.id, &image, &png) {
            eprintln!("History not saved: {error}");
            return;
        }
        let state = app.state::<HistoryState>();
        let mut entries = state.0.lock().unwrap();
        entries.insert(0, entry);
        let keep = MAX_ENTRIES.min(entries.len());
        for old in entries.split_off(keep) {
            remove_files(&app, &old.id);
        }
        if let Err(error) = store_index(&app, &entries) {
            eprintln!("History index not saved: {error}");
        }
        drop(entries);
        changed(&app);
    });
}

/// Replaces an entry's image with an annotated version from the editor.
pub fn replace(app: &AppHandle, id: &str, png: &[u8]) -> Result<(), String> {
    if !valid_id(id) || !app.state::<HistoryState>().0.lock().unwrap().iter().any(|e| e.id == id) {
        return Ok(());
    }
    let image = xcap::image::load_from_memory(png).map_err(|e| e.to_string())?.to_rgba8();
    write_files(app, id, &image, png)?;
    let state = app.state::<HistoryState>();
    let mut entries = state.0.lock().unwrap();
    if let Some(entry) = entries.iter_mut().find(|e| e.id == id) {
        entry.updated_at = now();
        entry.width = image.width();
        entry.height = image.height();
    }
    store_index(app, &entries)?;
    drop(entries);
    changed(app);
    Ok(())
}

pub fn list(app: &AppHandle) -> Vec<Entry> {
    app.state::<HistoryState>().0.lock().unwrap().clone()
}

/// Loads an entry back into memory (to edit or copy it).
pub fn open(app: &AppHandle, id: &str) -> Result<Capture, String> {
    if !valid_id(id) {
        return Err("Invalid id".into());
    }
    let scale_factor = app
        .state::<HistoryState>()
        .0
        .lock()
        .unwrap()
        .iter()
        .find(|e| e.id == id)
        .map(|e| e.scale_factor)
        .ok_or("Not in history")?;
    let png = std::fs::read(image_path(app, id).ok_or("No data folder")?).map_err(|e| e.to_string())?;
    let image = xcap::image::load_from_memory(&png).map_err(|e| e.to_string())?.to_rgba8();
    Ok(Capture { image, png, scale_factor })
}

pub fn file(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("Invalid id".into());
    }
    image_path(app, id).ok_or_else(|| "No data folder".into())
}

pub fn delete(app: &AppHandle, id: &str) -> Result<(), String> {
    if !valid_id(id) {
        return Err("Invalid id".into());
    }
    let state = app.state::<HistoryState>();
    let mut entries = state.0.lock().unwrap();
    entries.retain(|e| e.id != id);
    remove_files(app, id);
    store_index(app, &entries)?;
    drop(entries);
    changed(app);
    Ok(())
}

pub fn clear(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<HistoryState>();
    let mut entries = state.0.lock().unwrap();
    entries.clear();
    if let Some(dir) = dir(app) {
        let _ = std::fs::remove_dir_all(&dir);
    }
    drop(entries);
    changed(app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::valid_id;

    #[test]
    fn ids_cannot_escape_the_folder() {
        assert!(valid_id("3f2a9c0e8d7b4a1f9e6c5d4b3a2f1e0d"));
        assert!(!valid_id("../settings"));
        assert!(!valid_id("a/b"));
        assert!(!valid_id(""));
    }
}
