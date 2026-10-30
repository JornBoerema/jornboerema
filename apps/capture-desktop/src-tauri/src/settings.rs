//! User settings, stored as JSON in the app's config folder.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// What happens right after a screenshot is taken.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AfterCapture {
    #[default]
    Editor,
    Copy,
    Save,
}

/// Global shortcuts in Tauri's accelerator notation, e.g. "Alt+Shift+1".
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Shortcuts {
    pub fullscreen: String,
    pub area: String,
    pub window: String,
}

impl Default for Shortcuts {
    /// ⌥⇧<n> on macOS (⌘⇧3/4/5 belong to the system), Ctrl+Shift+<n> on Windows.
    fn default() -> Self {
        let modifiers = if cfg!(target_os = "macos") { "Alt+Shift" } else { "Ctrl+Shift" };
        Self {
            fullscreen: format!("{modifiers}+1"),
            area: format!("{modifiers}+2"),
            window: format!("{modifiers}+3"),
        }
    }
}

impl Shortcuts {
    pub fn all(&self) -> [&str; 3] {
        [&self.fullscreen, &self.area, &self.window]
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub shortcuts: Shortcuts,
    pub after_capture: AfterCapture,
    /// Where screenshots are saved; the Desktop when empty.
    pub save_folder: Option<String>,
    /// Save from the editor asks for a location; otherwise straight into the folder.
    pub ask_where_to_save: bool,
    /// "en" or "nl", reported by the windows (they own the language choice).
    /// Used for the tray menu; the system language until a window reports one.
    pub language: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            shortcuts: Shortcuts::default(),
            after_capture: AfterCapture::default(),
            save_folder: None,
            ask_where_to_save: true,
            language: None,
        }
    }
}

impl Settings {
    pub fn language(&self) -> &str {
        match self.language.as_deref() {
            Some(language) => language,
            None => match sys_locale::get_locale() {
                Some(locale) if locale.to_lowercase().starts_with("nl") => "nl",
                _ => "en",
            },
        }
    }

    pub fn save_folder(&self, app: &AppHandle) -> PathBuf {
        match &self.save_folder {
            Some(folder) if !folder.is_empty() => PathBuf::from(folder),
            _ => app.path().desktop_dir().or_else(|_| app.path().home_dir()).unwrap_or_default(),
        }
    }
}

pub struct SettingsState(pub Mutex<Settings>);

fn file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join("settings.json"))
}

/// The stored settings, and whether a settings file existed (false on first launch).
pub fn load(app: &AppHandle) -> (Settings, bool) {
    let Some(text) = file(app).and_then(|path| std::fs::read_to_string(path).ok()) else {
        return (Settings::default(), false);
    };
    (serde_json::from_str(&text).unwrap_or_default(), true)
}

pub fn store(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = file(app).ok_or("No config folder")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(path, text).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_fields_fall_back_to_defaults() {
        let settings: Settings = serde_json::from_str(r#"{"afterCapture":"copy"}"#).unwrap();
        assert_eq!(settings.after_capture, AfterCapture::Copy);
        assert_eq!(settings.shortcuts, Shortcuts::default());
        assert!(settings.ask_where_to_save);
    }

    #[test]
    fn default_shortcuts_parse() {
        use tauri_plugin_global_shortcut::Shortcut;
        for shortcut in Shortcuts::default().all() {
            assert!(shortcut.parse::<Shortcut>().is_ok(), "{shortcut}");
        }
    }
}
