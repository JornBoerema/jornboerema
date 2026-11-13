//! The places in the mail sidebar a user can order, tuck under More, or hide
//! (packages/mail-core/src/sidebar.ts), with each one's sign and name
//! (`PLACE_ICONS` and `usePlaceLabels` in components/sidebar.tsx).

use serde::{Deserialize, Serialize};

use crate::i18n::t;

use super::api::{MailFolder, View};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Place {
    Inbox,
    Starred,
    Parcels,
    Invoices,
    Snoozed,
    Drafts,
    Scheduled,
    Sent,
    Senders,
    Archive,
    Spam,
    Trash,
}

impl Place {
    /// The list it opens.
    pub fn view(self) -> View {
        match self {
            Place::Inbox => View::Inbox,
            Place::Starred => View::Folder(MailFolder::Starred),
            Place::Parcels => View::Parcels,
            Place::Invoices => View::Invoices,
            Place::Snoozed => View::Snoozed,
            Place::Drafts => View::Drafts,
            Place::Scheduled => View::Scheduled,
            Place::Sent => View::Folder(MailFolder::Sent),
            Place::Senders => View::Senders,
            Place::Archive => View::Folder(MailFolder::Archive),
            Place::Spam => View::Folder(MailFolder::Spam),
            Place::Trash => View::Folder(MailFolder::Trash),
        }
    }

    /// The Hugeicon (`theme::hi`).
    pub fn icon(self) -> &'static str {
        match self {
            Place::Inbox => "inbox",
            Place::Starred => "star",
            Place::Parcels => "package",
            Place::Invoices => "invoice-02",
            Place::Snoozed => "alarm-clock",
            Place::Drafts => "file-01",
            Place::Scheduled => "mail-send-01",
            Place::Sent => "sent",
            Place::Senders => "clean",
            Place::Archive => "archive",
            Place::Spam => "spam",
            Place::Trash => "delete-02",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Place::Inbox => "Inbox",
            Place::Starred => t("Starred", "Met ster"),
            Place::Parcels => t("Parcels", "Pakketjes"),
            Place::Invoices => t("Invoices", "Facturen"),
            Place::Snoozed => t("Snoozed", "Gesnoozed"),
            Place::Drafts => t("Drafts", "Concepten"),
            Place::Scheduled => t("Scheduled", "Gepland"),
            Place::Sent => t("Sent", "Verzonden"),
            Place::Senders => t("Tidy up", "Opruimen"),
            Place::Archive => t("Archive", "Archief"),
            Place::Spam => "Spam",
            Place::Trash => t("Trash", "Prullenbak"),
        }
    }
}

/// A folder's sign and name (`FOLDER_ICONS`, `strings.folders`).
pub fn folder_place(folder: MailFolder) -> Place {
    match folder {
        MailFolder::Starred => Place::Starred,
        MailFolder::Sent => Place::Sent,
        MailFolder::Archive => Place::Archive,
        MailFolder::Spam => Place::Spam,
        MailFolder::Trash => Place::Trash,
    }
}

/// `SidebarLayout`: which places, in what order, under More or hidden.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Layout {
    pub main: Vec<Place>,
    pub more: Vec<Place>,
    pub hidden: Vec<Place>,
}

impl Default for Layout {
    /// `DEFAULT_SIDEBAR`.
    fn default() -> Self {
        use Place::*;
        Self {
            main: vec![Inbox, Starred, Parcels, Invoices, Snoozed, Drafts, Scheduled, Sent, Senders],
            more: vec![Archive, Spam, Trash],
            hidden: Vec::new(),
        }
    }
}

impl Layout {
    /// A saved layout made whole (`normalizeSidebar`): unknown places dropped,
    /// each place once, places added since in their default section, and the
    /// inbox never hidden, so there is always a way home.
    pub fn normalize(raw: &serde_json::Value) -> Layout {
        if !raw.is_object() {
            return Layout::default();
        }
        let mut seen: Vec<Place> = Vec::new();
        let mut section = |key: &str| -> Vec<Place> {
            let Some(list) = raw.get(key).and_then(|list| list.as_array()) else {
                return Vec::new();
            };
            list.iter()
                .filter_map(|item| serde_json::from_value::<Place>(item.clone()).ok())
                .filter(|place| {
                    if seen.contains(place) {
                        return false;
                    }
                    seen.push(*place);
                    true
                })
                .collect()
        };
        let mut layout = Layout {
            main: section("main"),
            more: section("more"),
            hidden: section("hidden"),
        };
        let default = Layout::default();
        for (into, from) in [
            (&mut layout.main, &default.main),
            (&mut layout.more, &default.more),
            (&mut layout.hidden, &default.hidden),
        ] {
            for place in from {
                if !seen.contains(place) {
                    seen.push(*place);
                    into.push(*place);
                }
            }
        }
        if layout.hidden.contains(&Place::Inbox) {
            layout.hidden.retain(|place| *place != Place::Inbox);
            layout.main.insert(0, Place::Inbox);
        }
        layout
    }
}

#[cfg(test)]
mod tests {
    use super::{Layout, Place::*};

    #[test]
    fn a_saved_layout_is_made_whole() {
        assert_eq!(Layout::normalize(&serde_json::Value::Null), Layout::default());
        let raw = serde_json::json!({
            "main": ["sent", "nonsense", "sent", "starred"],
            "more": ["trash"],
            "hidden": ["inbox", "parcels"],
        });
        let layout = Layout::normalize(&raw);
        assert_eq!(
            layout.main,
            [Inbox, Sent, Starred, Invoices, Snoozed, Drafts, Scheduled, Senders]
        );
        assert_eq!(layout.more, [Trash, Archive, Spam]);
        assert_eq!(layout.hidden, [Parcels]);
        // What it writes, it reads back the same.
        let again = Layout::normalize(&serde_json::to_value(&layout).unwrap());
        assert_eq!(again, layout);
    }
}
