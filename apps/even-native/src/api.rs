//! The Even API, as the web and Tauri apps use it. Blocking calls: run them on
//! the background executor, never on the UI thread.

use std::time::Duration;

use anyhow::{anyhow, Context as _, Result};
use serde::{Deserialize, Serialize};

/// The live API, unless `EVEN_API_URL` points elsewhere (e.g. http://localhost:4000).
pub fn api_url() -> String {
    std::env::var("EVEN_API_URL")
        .unwrap_or_else(|_| "https://api.jornboerema.nl".into())
        .trim_end_matches('/')
        .to_string()
}

/// The account site, unless `EVEN_AUTH_URL` points elsewhere.
pub fn auth_url() -> String {
    std::env::var("EVEN_AUTH_URL")
        .unwrap_or_else(|_| "https://auth.jornboerema.nl".into())
        .trim_end_matches('/')
        .to_string()
}

/// Changes need a trusted origin (the API's guard against cross-site requests).
/// This app is a desktop app like the Tauri one, so it says so the same way.
const DESKTOP_ORIGIN: &str = "tauri://localhost";

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub email: String,
    pub color: usize,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Address {
    pub name: Option<String>,
    pub email: String,
}

impl Address {
    pub fn label(&self) -> &str {
        self.name.as_deref().filter(|name| !name.is_empty()).unwrap_or(&self.email)
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Thread {
    pub id: String,
    pub account_id: String,
    pub subject: String,
    pub snippet: String,
    pub from_name: Option<String>,
    pub from_email: Option<String>,
    pub received_at: chrono::DateTime<chrono::Utc>,
    pub is_read: bool,
    pub is_starred: bool,
    pub has_attachments: bool,
    pub message_count: u32,
    #[serde(default)]
    pub to: Option<Vec<Address>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadsPage {
    pub threads: Vec<Thread>,
    pub next_cursor: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Attachment {
    pub name: String,
    pub size: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub from: Option<Address>,
    #[serde(default)]
    pub to: Vec<Address>,
    #[serde(default)]
    pub cc: Vec<Address>,
    pub received_at: chrono::DateTime<chrono::Utc>,
    pub html: Option<String>,
    pub text: Option<String>,
    #[serde(default)]
    pub attachments: Vec<Attachment>,
}

#[derive(Debug, Deserialize)]
pub struct ThreadDetail {
    pub messages: Vec<Message>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Folder {
    Inbox,
    Starred,
    Sent,
    Archive,
    Spam,
    Trash,
}

impl Folder {
    pub const ALL: [Folder; 6] = [
        Folder::Inbox,
        Folder::Starred,
        Folder::Sent,
        Folder::Archive,
        Folder::Spam,
        Folder::Trash,
    ];

    /// The API's name; the inbox is the list without a folder.
    fn query(self) -> Option<&'static str> {
        match self {
            Folder::Inbox => None,
            Folder::Starred => Some("starred"),
            Folder::Sent => Some("sent"),
            Folder::Archive => Some("archive"),
            Folder::Spam => Some("spam"),
            Folder::Trash => Some("trash"),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    Read,
    Unread,
    Archive,
    Trash,
    Star,
    Unstar,
    Inbox,
}

impl Action {
    /// Whether the conversation leaves the list it is in.
    pub fn leaves(self, folder: Folder) -> bool {
        match self {
            Action::Archive | Action::Trash => folder != Folder::Trash,
            Action::Inbox => folder != Folder::Inbox,
            Action::Unstar => folder == Folder::Starred,
            _ => false,
        }
    }
}

/// An error the API answered with, kept apart so a lapsed session can sign out.
#[derive(Debug)]
pub struct Unauthorized;

impl std::fmt::Display for Unauthorized {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("signed out")
    }
}

impl std::error::Error for Unauthorized {}

#[derive(Clone)]
pub struct Client {
    agent: ureq::Agent,
    base: String,
    token: String,
}

impl Client {
    pub fn new(token: String) -> Self {
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .user_agent(concat!("Even-native/", env!("CARGO_PKG_VERSION")))
            .build();
        Self { agent, base: api_url(), token }
    }

    fn get(&self, path: &str) -> ureq::Request {
        self.agent
            .get(&format!("{}{path}", self.base))
            .set("Authorization", &format!("Bearer {}", self.token))
    }

    fn post(&self, path: &str) -> ureq::Request {
        self.agent
            .post(&format!("{}{path}", self.base))
            .set("Authorization", &format!("Bearer {}", self.token))
            .set("Origin", DESKTOP_ORIGIN)
    }

    pub fn accounts(&self) -> Result<Vec<Account>> {
        #[derive(Deserialize)]
        struct Accounts {
            accounts: Vec<Account>,
        }
        let response: Accounts = read(self.get("/api/mail/accounts").call())?;
        Ok(response.accounts)
    }

    pub fn threads(&self, folder: Folder, cursor: Option<&str>) -> Result<ThreadsPage> {
        let mut request = self.get("/api/mail/threads");
        if let Some(folder) = folder.query() {
            request = request.query("folder", folder);
        }
        if let Some(cursor) = cursor {
            request = request.query("cursor", cursor);
        }
        read(request.call())
    }

    pub fn thread(&self, id: &str) -> Result<ThreadDetail> {
        read(self.get(&format!("/api/mail/threads/{}", encode(id))).call())
    }

    pub fn act(&self, id: &str, action: Action) -> Result<()> {
        let response = self
            .post(&format!("/api/mail/threads/{}/actions", encode(id)))
            .send_json(serde_json::json!({ "action": action }));
        let _: serde_json::Value = read(response)?;
        Ok(())
    }
}

fn encode(segment: &str) -> String {
    url::form_urlencoded::byte_serialize(segment.as_bytes()).collect()
}

fn read<T: serde::de::DeserializeOwned>(response: Result<ureq::Response, ureq::Error>) -> Result<T> {
    match response {
        Ok(response) => response.into_json().context("unexpected answer"),
        Err(ureq::Error::Status(401, _)) => Err(Unauthorized.into()),
        Err(ureq::Error::Status(code, response)) => {
            let body = response.into_string().unwrap_or_default();
            Err(anyhow!("API answered {code}: {body}"))
        }
        Err(error) => Err(anyhow!(error)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_threads_page() {
        let json = r#"{"threads":[{"id":"m1","accountId":"a1","subject":"Hi","snippet":"There",
            "fromName":null,"fromEmail":"x@y.nl","receivedAt":"2026-11-12T13:56:00.000Z",
            "isRead":false,"isStarred":true,"hasAttachments":false,"messageCount":2}],"nextCursor":"c2"}"#;
        let page: ThreadsPage = serde_json::from_str(json).unwrap();
        assert_eq!(page.threads[0].from_email.as_deref(), Some("x@y.nl"));
        assert_eq!(page.next_cursor.as_deref(), Some("c2"));
    }

    #[test]
    fn actions_say_when_they_leave_the_list() {
        assert!(Action::Archive.leaves(Folder::Inbox));
        assert!(!Action::Star.leaves(Folder::Inbox));
        assert!(Action::Unstar.leaves(Folder::Starred));
        assert_eq!(serde_json::to_string(&Action::Unread).unwrap(), "\"unread\"");
    }
}
