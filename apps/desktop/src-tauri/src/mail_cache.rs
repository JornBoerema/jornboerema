//! Even mailen's cache on disk: the lists it showed last and the conversations it
//! opened, so the app opens with them at once and fetches fresh behind them.
//!
//! SQLite instead of the webview's localStorage: no 5 MB ceiling, and writes go
//! through async commands, off the thread that draws the window. When the
//! database can't open, every command quietly does nothing and the app loads
//! everything from the network, as it did before.

use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use tauri::{AppHandle, Manager, State};

/// Conversations kept per user; the least recently opened go first.
const MAX_THREADS: i64 = 500;
/// A conversation bigger than this (a huge newsletter, say) is fetched each time instead.
const MAX_THREAD_BYTES: usize = 2 * 1024 * 1024;
/// The lists live in one value; the API's pages are small, so this is generous.
const MAX_VALUE_BYTES: usize = 20 * 1024 * 1024;

pub struct MailCache {
    connection: Mutex<Option<Connection>>,
}

impl MailCache {
    pub fn open(app: &AppHandle) -> Self {
        let path = app.path().app_data_dir().ok().map(|dir| dir.join("mail-cache.sqlite"));
        let connection = path.as_deref().and_then(|path| match connect(path) {
            Ok(connection) => Some(connection),
            Err(error) => {
                eprintln!("Mail cache unavailable: {error}");
                None
            }
        });
        Self { connection: Mutex::new(connection) }
    }

    #[cfg(test)]
    fn in_memory() -> Self {
        let connection = Connection::open_in_memory().unwrap();
        prepare(&connection).unwrap();
        Self { connection: Mutex::new(Some(connection)) }
    }

    fn with<T: Default>(&self, run: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> T {
        let guard = self.connection.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(connection) = guard.as_ref() else { return T::default() };
        run(connection).unwrap_or_else(|error| {
            eprintln!("Mail cache: {error}");
            T::default()
        })
    }

    pub fn get(&self, key: &str) -> Option<String> {
        self.with(|db| {
            db.query_row("SELECT value FROM kv WHERE key = ?1", [key], |row| row.get(0))
                .optional()
        })
    }

    pub fn set(&self, key: &str, value: &str) {
        if value.len() > MAX_VALUE_BYTES {
            return self.remove(key);
        }
        self.with(|db| {
            db.execute(
                "INSERT INTO kv (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, value],
            )
            .map(|_| ())
        })
    }

    pub fn remove(&self, key: &str) {
        self.with(|db| db.execute("DELETE FROM kv WHERE key = ?1", [key]).map(|_| ()))
    }

    pub fn thread(&self, user: &str, id: &str) -> Option<String> {
        self.with(|db| {
            let value: Option<String> = db
                .query_row("SELECT value FROM threads WHERE user = ?1 AND id = ?2", params![user, id], |row| {
                    row.get(0)
                })
                .optional()?;
            if value.is_some() {
                db.execute(
                    "UPDATE threads SET used = ?3 WHERE user = ?1 AND id = ?2",
                    params![user, id, now()],
                )?;
            }
            Ok(value)
        })
    }

    pub fn put_thread(&self, user: &str, id: &str, value: &str) {
        if value.len() > MAX_THREAD_BYTES {
            return;
        }
        self.with(|db| {
            db.execute(
                "INSERT INTO threads (user, id, value, used) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(user, id) DO UPDATE SET value = excluded.value, used = excluded.used",
                params![user, id, value, now()],
            )?;
            db.execute(
                "DELETE FROM threads WHERE user = ?1 AND id NOT IN
                 (SELECT id FROM threads WHERE user = ?1 ORDER BY used DESC LIMIT ?2)",
                params![user, MAX_THREADS],
            )
            .map(|_| ())
        })
    }

    /// On signing out: no mail of anyone stays on this computer.
    pub fn clear(&self) {
        self.with(|db| {
            db.execute_batch("DELETE FROM kv; DELETE FROM threads; PRAGMA wal_checkpoint(TRUNCATE); VACUUM;")
        })
    }

    #[cfg(test)]
    fn thread_count(&self, user: &str) -> i64 {
        self.with(|db| db.query_row("SELECT COUNT(*) FROM threads WHERE user = ?1", [user], |row| row.get(0)))
    }
}

fn now() -> i64 {
    // Microseconds, so opening two conversations in one millisecond still orders them.
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_micros() as i64).unwrap_or(0)
}

fn connect(path: &Path) -> rusqlite::Result<Connection> {
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let connection = Connection::open(path)?;
    // It holds mail: only this user may read it.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    prepare(&connection)?;
    Ok(connection)
}

fn prepare(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS threads (
             user TEXT NOT NULL,
             id TEXT NOT NULL,
             value TEXT NOT NULL,
             used INTEGER NOT NULL,
             PRIMARY KEY (user, id)
         );
         CREATE INDEX IF NOT EXISTS threads_used ON threads (user, used);",
    )
}

// Async commands run on Tauri's worker threads, never on the one that draws the window.

#[tauri::command]
pub async fn mail_cache_get(cache: State<'_, MailCache>, key: String) -> Result<Option<String>, ()> {
    Ok(cache.get(&key))
}

#[tauri::command]
pub async fn mail_cache_set(cache: State<'_, MailCache>, key: String, value: String) -> Result<(), ()> {
    cache.set(&key, &value);
    Ok(())
}

#[tauri::command]
pub async fn mail_cache_remove(cache: State<'_, MailCache>, key: String) -> Result<(), ()> {
    cache.remove(&key);
    Ok(())
}

#[tauri::command]
pub async fn mail_cache_thread(cache: State<'_, MailCache>, user: String, id: String) -> Result<Option<String>, ()> {
    Ok(cache.thread(&user, &id))
}

#[tauri::command]
pub async fn mail_cache_put_thread(
    cache: State<'_, MailCache>,
    user: String,
    id: String,
    value: String,
) -> Result<(), ()> {
    cache.put_thread(&user, &id, &value);
    Ok(())
}

#[tauri::command]
pub async fn mail_cache_clear(cache: State<'_, MailCache>) -> Result<(), ()> {
    cache.clear();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_and_forgets_values() {
        let cache = MailCache::in_memory();
        assert_eq!(cache.get("lists"), None);
        cache.set("lists", "{\"a\":1}");
        cache.set("lists", "{\"a\":2}");
        assert_eq!(cache.get("lists").as_deref(), Some("{\"a\":2}"));
        cache.remove("lists");
        assert_eq!(cache.get("lists"), None);
    }

    #[test]
    fn conversations_are_per_user() {
        let cache = MailCache::in_memory();
        cache.put_thread("u1", "t1", "one");
        assert_eq!(cache.thread("u1", "t1").as_deref(), Some("one"));
        assert_eq!(cache.thread("u2", "t1"), None);
    }

    #[test]
    fn the_least_recently_opened_conversations_go_first() {
        let cache = MailCache::in_memory();
        for i in 0..MAX_THREADS {
            cache.put_thread("u", &format!("t{i}"), "x");
        }
        // Opening the oldest keeps it.
        assert!(cache.thread("u", "t0").is_some());
        cache.put_thread("u", "new", "x");
        assert_eq!(cache.thread_count("u"), MAX_THREADS);
        assert!(cache.thread("u", "t0").is_some());
        assert!(cache.thread("u", "t1").is_none());
        assert!(cache.thread("u", "new").is_some());
    }

    #[test]
    fn huge_conversations_are_not_kept() {
        let cache = MailCache::in_memory();
        cache.put_thread("u", "big", &"x".repeat(MAX_THREAD_BYTES + 1));
        assert_eq!(cache.thread("u", "big"), None);
    }

    #[test]
    fn clearing_removes_everything() {
        let cache = MailCache::in_memory();
        cache.set("lists", "v");
        cache.put_thread("u", "t", "v");
        cache.clear();
        assert_eq!(cache.get("lists"), None);
        assert_eq!(cache.thread("u", "t"), None);
    }

    #[test]
    fn without_a_database_everything_is_a_quiet_no() {
        let cache = MailCache { connection: Mutex::new(None) };
        cache.set("k", "v");
        assert_eq!(cache.get("k"), None);
        assert_eq!(cache.thread("u", "t"), None);
        cache.clear();
    }

    #[test]
    fn a_file_on_disk_is_private() {
        let dir = std::env::temp_dir().join(format!("even-mail-cache-{}", now()));
        let path = dir.join("mail-cache.sqlite");
        let connection = connect(&path).unwrap();
        connection.execute("INSERT INTO kv (key, value) VALUES ('k', 'v')", []).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }
        drop(connection);
        let _ = std::fs::remove_dir_all(dir);
    }
}
