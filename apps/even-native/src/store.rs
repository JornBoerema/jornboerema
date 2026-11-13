//! What the app saw last, kept on disk so it opens with mail on screen while the
//! network catches up. Holds the first page of each folder and the conversations
//! read lately, as the API sent them. Blocking calls: run them on the background
//! executor, never on the UI thread.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use rusqlite::{params, Connection, OptionalExtension as _};

use crate::api::{Thread, ThreadDetail};

/// Enough for a day or two of reading; older conversations come from the network again.
const MAX_DETAILS: i64 = 300;

const SCHEMA: &str = "
    CREATE TABLE IF NOT EXISTS threads (folder TEXT PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS details (id TEXT PRIMARY KEY, json TEXT NOT NULL, used INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS details_used ON details (used);
";

/// Without a connection (it could not open, or the user signed out) every call
/// does nothing: the cache only ever saves a trip, the app works without it.
pub struct Store {
    connection: Mutex<Option<Connection>>,
    path: Option<PathBuf>,
}

fn file() -> Option<PathBuf> {
    Some(crate::auth::data_dir()?.join("cache.sqlite"))
}

impl Store {
    /// The cache in the app's data directory. Opening is quick enough for the UI thread.
    pub fn open() -> Arc<Self> {
        let Some(path) = file() else {
            return Arc::new(Self::empty());
        };
        match Self::open_at(&path) {
            Ok(store) => Arc::new(store),
            Err(error) => {
                eprintln!("Could not open the cache: {error}");
                Arc::new(Self::empty())
            }
        }
    }

    fn empty() -> Self {
        Self {
            connection: Mutex::new(None),
            path: None,
        }
    }

    fn open_at(path: &Path) -> rusqlite::Result<Self> {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let connection = Connection::open(path)?;
        // It holds mail: only this user may read it. SQLite gives its WAL files the same rights.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
        }
        let store = Self::with(connection)?;
        Ok(Self {
            path: Some(path.to_path_buf()),
            ..store
        })
    }

    #[cfg(test)]
    fn in_memory() -> Self {
        Self::with(Connection::open_in_memory().unwrap()).unwrap()
    }

    fn with(connection: Connection) -> rusqlite::Result<Self> {
        // WAL: a write of a long conversation doesn't hold up a read of the list.
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "synchronous", "NORMAL")?;
        connection.execute_batch(SCHEMA)?;
        Ok(Self {
            connection: Mutex::new(Some(connection)),
            path: None,
        })
    }

    fn run<T>(&self, f: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> Option<T> {
        let guard = self.connection.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let connection = guard.as_ref()?;
        match f(connection) {
            Ok(value) => Some(value),
            Err(error) => {
                eprintln!("Cache: {error}");
                None
            }
        }
    }

    /// The first page of a list, as last seen. `list` names it: "inbox",
    /// "sent", or with a mailbox before it when only that one shows.
    pub fn threads(&self, list: &str) -> Option<Vec<Thread>> {
        self.run(|c| read_threads(c, list)).flatten()
    }

    pub fn put_threads(&self, list: &str, threads: &[Thread]) {
        self.run(|c| write_threads(c, list, threads));
    }

    /// A conversation as last seen; marks it as used, so it is the last to go.
    pub fn detail(&self, id: &str) -> Option<ThreadDetail> {
        let json: String = self
            .run(|c| {
                let json = c
                    .query_row("SELECT json FROM details WHERE id = ?1", [id], |row| row.get(0))
                    .optional()?;
                if json.is_some() {
                    c.execute(
                        "UPDATE details SET used = (SELECT COALESCE(MAX(used), 0) + 1 FROM details) WHERE id = ?1",
                        [id],
                    )?;
                }
                Ok(json)
            })
            .flatten()?;
        serde_json::from_str(&json).ok()
    }

    /// Keeps the conversation and says whether it differs from what was kept.
    /// The least recently read ones go once there are too many.
    pub fn put_detail(&self, id: &str, detail: &ThreadDetail) -> bool {
        let Ok(json) = serde_json::to_string(detail) else {
            return true;
        };
        self.run(|c| {
            let old: Option<String> = c
                .query_row("SELECT json FROM details WHERE id = ?1", [id], |row| row.get(0))
                .optional()?;
            c.execute(
                "INSERT OR REPLACE INTO details (id, json, used)
                 VALUES (?1, ?2, (SELECT COALESCE(MAX(used), 0) + 1 FROM details))",
                params![id, json],
            )?;
            c.execute(
                "DELETE FROM details WHERE id NOT IN (SELECT id FROM details ORDER BY used DESC LIMIT ?1)",
                [MAX_DETAILS],
            )?;
            Ok(old.as_deref() != Some(json.as_str()))
        })
        .unwrap_or(true)
    }

    /// Signing out: closes the cache and deletes it, for it holds mail. Whatever
    /// is still on its way to it afterwards finds no connection and is dropped.
    pub fn forget(&self) {
        let mut guard = self.connection.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        guard.take();
        delete(self.path.clone().or_else(file));
    }
}

fn read_threads(c: &Connection, list: &str) -> rusqlite::Result<Option<Vec<Thread>>> {
    let json: Option<String> = c
        .query_row(
            "SELECT json FROM threads WHERE folder = ?1",
            [list],
            |row| row.get(0),
        )
        .optional()?;
    // An older shape of the API reads as nothing, not as an error.
    Ok(json.and_then(|json| serde_json::from_str(&json).ok()))
}

fn write_threads(c: &Connection, list: &str, threads: &[Thread]) -> rusqlite::Result<()> {
    let Ok(json) = serde_json::to_string(threads) else {
        return Ok(());
    };
    c.execute(
        "INSERT OR REPLACE INTO threads (folder, json) VALUES (?1, ?2)",
        params![list, json],
    )?;
    Ok(())
}

/// Deletes the cache file, also when no store is open.
pub fn forget() {
    delete(file());
}

fn delete(path: Option<PathBuf>) {
    let Some(path) = path else { return };
    // Replies in progress are kept beside the cache (mail/compose/drafts.rs) and go with it.
    if let Some(dir) = path.parent() {
        let _ = std::fs::remove_dir_all(dir.join("reply-drafts"));
    }
    for suffix in ["", "-wal", "-shm"] {
        let mut name = path.clone().into_os_string();
        name.push(suffix);
        let _ = std::fs::remove_file(name);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn thread(id: &str) -> Thread {
        serde_json::from_value(serde_json::json!({
            "id": id, "accountId": "a1", "subject": format!("Over {id}"), "snippet": "",
            "fromName": "Jan", "fromEmail": "jan@example.nl", "receivedAt": "2026-11-12T13:56:00Z",
            "isRead": false, "isStarred": false, "hasAttachments": false, "messageCount": 1,
            "to": [{"name": null, "email": "ik@example.nl"}]
        }))
        .unwrap()
    }

    fn detail(text: &str) -> ThreadDetail {
        serde_json::from_value(serde_json::json!({ "messages": [{
            "id": "m1", "from": {"name": "Jan", "email": "jan@example.nl"},
            "receivedAt": "2026-11-12T13:56:00Z", "html": null, "text": text,
            "inline": [{"id": "i1", "contentId": "logo", "size": 10, "contentType": "image/png"}]
        }]}))
        .unwrap()
    }

    #[test]
    fn keeps_a_page_of_threads_in_order() {
        let store = Store::in_memory();
        assert!(store.threads("inbox").is_none());
        store.put_threads("inbox", &[thread("t1"), thread("t2")]);
        store.put_threads("sent", &[thread("t3")]);
        let inbox = store.threads("inbox").unwrap();
        assert_eq!(inbox.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), ["t1", "t2"]);
        assert_eq!(inbox[0].to.as_ref().unwrap()[0].email, "ik@example.nl");
        assert_eq!(inbox[0].from_name.as_deref(), Some("Jan"));

    }

    #[test]
    fn stored_json_keeps_the_api_shape() {
        let json = serde_json::to_value(thread("t1")).unwrap();
        assert!(json.get("accountId").is_some() && json.get("receivedAt").is_some());
        let json = serde_json::to_value(detail("hoi")).unwrap();
        assert!(json["messages"][0]["inline"][0].get("contentType").is_some());
    }

    #[test]
    fn says_when_a_conversation_changed() {
        let store = Store::in_memory();
        assert!(store.put_detail("t1", &detail("hoi")));
        assert!(!store.put_detail("t1", &detail("hoi")));
        assert!(store.put_detail("t1", &detail("hallo")));
        assert_eq!(store.detail("t1").unwrap().messages[0].text.as_deref(), Some("hallo"));
    }

    #[test]
    fn forgets_the_least_recently_read() {
        let store = Store::in_memory();
        for i in 0..MAX_DETAILS {
            store.put_detail(&format!("t{i}"), &detail("hoi"));
        }
        // Reading the oldest makes it the newest; the second oldest goes instead.
        assert!(store.detail("t0").is_some());
        store.put_detail("new", &detail("hoi"));
        assert!(store.detail("t0").is_some());
        assert!(store.detail("t1").is_none());
        assert!(store.detail("new").is_some());
        let count: i64 = store
            .run(|c| c.query_row("SELECT COUNT(*) FROM details", [], |row| row.get(0)))
            .unwrap();
        assert_eq!(count, MAX_DETAILS);
    }

    #[test]
    fn signing_out_deletes_the_file() {
        let dir = std::env::temp_dir().join(format!("even-native-store-{}", std::process::id()));
        let path = dir.join("cache.sqlite");
        let store = Store::open_at(&path).unwrap();
        store.put_threads("inbox", &[thread("t1")]);
        store.put_detail("t1", &detail("hoi"));
        assert!(path.exists());
        store.forget();
        assert!(!path.exists());
        assert!(!dir.join("cache.sqlite-wal").exists());
        // Late writes go nowhere and don't bring the file back.
        store.put_threads("inbox", &[thread("t2")]);
        assert!(store.threads("inbox").is_none());
        assert!(!path.exists());
        let _ = std::fs::remove_dir_all(dir);
    }
}
