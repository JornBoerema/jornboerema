//! What the web keeps in localStorage: small choices (the open app, the theme,
//! the language, a collapsed sidebar) in one JSON file next to the session.
//! Read once, kept in memory, written back on every change.

use std::collections::BTreeMap;
use std::sync::{Mutex, OnceLock};

use crate::auth::data_dir;

type Values = BTreeMap<String, String>;

fn file() -> Option<std::path::PathBuf> {
    Some(data_dir()?.join("preferences.json"))
}

fn values() -> &'static Mutex<Values> {
    static VALUES: OnceLock<Mutex<Values>> = OnceLock::new();
    VALUES.get_or_init(|| {
        let stored = file()
            .and_then(|path| std::fs::read(path).ok())
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        Mutex::new(stored)
    })
}

fn save(values: &Values) {
    let Some(path) = file() else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(bytes) = serde_json::to_vec_pretty(values) {
        let _ = std::fs::write(path, bytes);
    }
}

pub fn get(key: &str) -> Option<String> {
    values().lock().ok()?.get(key).cloned()
}

pub fn set(key: &str, value: &str) {
    let Ok(mut values) = values().lock() else { return };
    if values.get(key).map(String::as_str) == Some(value) {
        return;
    }
    values.insert(key.to_string(), value.to_string());
    save(&values);
}

pub fn remove(key: &str) {
    let Ok(mut values) = values().lock() else { return };
    if values.remove(key).is_some() {
        save(&values);
    }
}

pub fn get_bool(key: &str) -> Option<bool> {
    get(key).map(|value| value == "true")
}

pub fn set_bool(key: &str, value: bool) {
    set(key, if value { "true" } else { "false" });
}

/// A value kept as JSON: a list of pinned ids, a column order.
pub fn get_json<T: serde::de::DeserializeOwned>(key: &str) -> Option<T> {
    serde_json::from_str(&get(key)?).ok()
}

pub fn set_json<T: serde::Serialize>(key: &str, value: &T) {
    if let Ok(text) = serde_json::to_string(value) {
        set(key, &text);
    }
}
