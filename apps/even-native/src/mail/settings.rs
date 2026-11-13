//! Mail's choices, as apps/mail-web/src/lib/preferences.ts keeps them: kept on
//! this Mac (`crate::prefs`, the web's localStorage) so the app starts with
//! them, and following the account to other devices through
//! `/api/mail/preferences`. Notifications and the delivered-parcels filter
//! stay per device.

use crate::api::Client;
use crate::prefs;

use super::api;
use super::places::Layout;

/// A setting that follows the account, by its name in the API.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Feature {
    Summaries,
    Codes,
    AiWriting,
    /// Off unless chosen: loading a remote image tells the sender you opened the mail.
    RemoteImages,
    Parcels,
    Unsubscribe,
    Senders,
    Invoices,
    Todos,
    Pins,
    ReplySuggestions,
}

impl Feature {
    pub const ALL: [Feature; 11] = [
        Feature::Summaries,
        Feature::Codes,
        Feature::AiWriting,
        Feature::RemoteImages,
        Feature::Parcels,
        Feature::Unsubscribe,
        Feature::Senders,
        Feature::Invoices,
        Feature::Todos,
        Feature::Pins,
        Feature::ReplySuggestions,
    ];

    /// Its name in the account's preferences.
    pub fn key(self) -> &'static str {
        match self {
            Feature::Summaries => "summaries",
            Feature::Codes => "codes",
            Feature::AiWriting => "aiWriting",
            Feature::RemoteImages => "remoteImages",
            Feature::Parcels => "parcels",
            Feature::Unsubscribe => "unsubscribe",
            Feature::Senders => "senders",
            Feature::Invoices => "invoices",
            Feature::Todos => "todos",
            Feature::Pins => "pins",
            Feature::ReplySuggestions => "replySuggestions",
        }
    }

    fn pref(self) -> String {
        format!("mail.{}", self.key())
    }

    /// What it is until the user chooses: everything on, remote images off.
    fn default(self) -> bool {
        self != Feature::RemoteImages
    }

    pub fn on(self) -> bool {
        prefs::get_bool(&self.pref()).unwrap_or(self.default())
    }

    fn keep(self, on: bool) {
        if on == self.default() {
            prefs::remove(&self.pref());
        } else {
            prefs::set_bool(&self.pref(), on);
        }
    }

    /// Keeps the choice on this Mac: the UI thread's half of [`Feature::set`],
    /// so a switch flips at once. Follow it with `api::save_preferences` in
    /// the background, so it reaches the account.
    pub fn keep_locally(self, on: bool) {
        self.keep(on);
    }

    /// Keeps the choice here and on the account. Blocking: background executor.
    #[allow(dead_code)]
    pub fn set(self, on: bool, client: &Client) -> anyhow::Result<()> {
        self.keep(on);
        api::save_preferences(client, &serde_json::json!({ self.key(): on }))
    }
}

const SIDEBAR: &str = "mail.sidebar";
const NOTIFY: &str = "mail.notifications";
const DELIVERED: &str = "mail.parcels-delivered";
const MORE: &str = "mail.sidebar.more";
const COLLAPSED: &str = "mail.sidebar.collapsed";

/// The sidebar as the user arranged it (`useSidebarLayout`).
pub fn sidebar() -> Layout {
    match prefs::get_json::<serde_json::Value>(SIDEBAR) {
        Some(raw) => Layout::normalize(&raw),
        None => Layout::default(),
    }
}

fn keep_sidebar(layout: Option<&Layout>) {
    match layout {
        Some(layout) => prefs::set_json(SIDEBAR, layout),
        None => prefs::remove(SIDEBAR),
    }
}

/// Arranges the sidebar here, or with `None` puts the default back
/// (`setSidebar`). The UI thread's half: follow it with
/// `api::save_preferences` in the background, so it reaches other devices.
pub fn keep_sidebar_locally(layout: Option<&Layout>) {
    keep_sidebar(layout);
}

/// A system notification for new mail; per device, off until turned on.
pub fn notify_new_mail() -> bool {
    prefs::get(NOTIFY).as_deref() == Some("on")
}

pub fn set_notify_new_mail(on: bool) {
    if on {
        prefs::set(NOTIFY, "on");
    } else {
        prefs::remove(NOTIFY);
    }
}

/// Parcels that arrived stay out of the list unless asked for.
pub fn show_delivered() -> bool {
    prefs::get(DELIVERED).as_deref() == Some("show")
}

pub fn set_show_delivered(show: bool) {
    if show {
        prefs::set(DELIVERED, "show");
    } else {
        prefs::remove(DELIVERED);
    }
}

/// Whether the More group in the sidebar is open.
pub fn more_open() -> bool {
    prefs::get(MORE).as_deref() == Some("open")
}

pub fn set_more_open(open: bool) {
    if open {
        prefs::set(MORE, "open");
    } else {
        prefs::remove(MORE);
    }
}

pub fn sidebar_collapsed() -> bool {
    prefs::get_bool(COLLAPSED).unwrap_or(false)
}

pub fn set_sidebar_collapsed(collapsed: bool) {
    if collapsed {
        prefs::set_bool(COLLAPSED, true);
    } else {
        prefs::remove(COLLAPSED);
    }
}

/// `usePreferencesSync`: the account's settings mirrored here, or, for an
/// account without saved settings, this Mac's sent up. Blocking: background
/// executor. True when something here changed.
pub fn sync(client: &Client) -> anyhow::Result<bool> {
    match api::preferences(client)? {
        Some(remote) => {
            let before = (Feature::ALL.map(Feature::on), sidebar());
            for feature in Feature::ALL {
                // Older accounts saved before a setting existed have its default.
                let on = remote
                    .get(feature.key())
                    .and_then(|value| value.as_bool())
                    .unwrap_or(feature.default());
                feature.keep(on);
            }
            match remote.get("sidebar").filter(|value| value.is_object()) {
                Some(raw) => prefs::set_json(SIDEBAR, raw),
                None => prefs::remove(SIDEBAR),
            }
            Ok(before != (Feature::ALL.map(Feature::on), sidebar()))
        }
        None => {
            let mut local = serde_json::Map::new();
            for feature in Feature::ALL {
                local.insert(feature.key().into(), feature.on().into());
            }
            local.insert(
                "sidebar".into(),
                prefs::get_json::<serde_json::Value>(SIDEBAR).unwrap_or(serde_json::Value::Null),
            );
            api::save_preferences(client, &serde_json::Value::Object(local))?;
            Ok(false)
        }
    }
}
