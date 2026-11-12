//! The Even API, as the web and Tauri apps use it. Blocking calls: run them on
//! the background executor, never on the UI thread.

use std::collections::HashSet;
use std::io::Read as _;
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

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Address {
    pub name: Option<String>,
    pub email: String,
}

impl Address {
    pub fn label(&self) -> &str {
        self.name
            .as_deref()
            .filter(|name| !name.is_empty())
            .unwrap_or(&self.email)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
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

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Attachment {
    /// Empty for some providers' parts; those can't be downloaded.
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub size: u64,
}

/// An image the body refers to as `cid:<content_id>`.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InlineImage {
    pub id: String,
    pub content_id: String,
    pub size: u64,
    pub content_type: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
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
    #[serde(default)]
    pub inline: Vec<InlineImage>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ThreadDetail {
    pub messages: Vec<Message>,
}

/// A conversation search found, read live from the mailbox. It may be outside the synced inbox.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub account_id: String,
    /// The provider's conversation id.
    pub thread_id: String,
    pub subject: String,
    pub snippet: String,
    pub from_name: Option<String>,
    pub from_email: Option<String>,
    pub received_at: chrono::DateTime<chrono::Utc>,
    pub is_read: bool,
    pub has_attachments: bool,
    #[serde(default)]
    pub is_starred: bool,
    /// The newest synced message, when the conversation is in the inbox list.
    pub message_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    pub hits: Vec<SearchHit>,
    /// Mailboxes the search failed for; the others still answered.
    #[serde(default)]
    pub failed_accounts: Vec<String>,
}

/// Conversations outside the synced inbox have no row id, so they are addressed
/// by mailbox and provider thread id, as the web app does: `remote:<mailbox>:<scope>:<thread>`.
/// The scope is `h` for spam and trash, which have to be asked for, else `-`.
const REMOTE: &str = "remote:";

impl SearchHit {
    /// A hit as a list line, so it opens and acts like any other conversation.
    pub fn into_thread(self) -> Thread {
        let id = self
            .message_id
            .unwrap_or_else(|| format!("{REMOTE}{}:-:{}", self.account_id, self.thread_id));
        Thread {
            id,
            account_id: self.account_id,
            subject: self.subject,
            snippet: self.snippet,
            from_name: self.from_name,
            from_email: self.from_email,
            received_at: self.received_at,
            is_read: self.is_read,
            is_starred: self.is_starred,
            has_attachments: self.has_attachments,
            message_count: 1,
            to: None,
        }
    }
}

/// The API path of a conversation, with `suffix` (e.g. "/actions") after it.
/// Synced ones by row id; remote ones by mailbox, with the thread id in the query
/// string because Graph ids contain "/" and "=".
pub fn conversation_path(id: &str, suffix: &str) -> String {
    let Some(remote) = id.strip_prefix(REMOTE) else {
        return format!("/api/mail/threads/{}{suffix}", encode(id));
    };
    let mut parts = remote.splitn(3, ':');
    let account = parts.next().unwrap_or_default();
    let scope = parts.next().unwrap_or_default();
    let thread = parts.next().unwrap_or_default();
    let hidden = if scope == "h" { "&hidden=1" } else { "" };
    format!(
        "/api/mail/accounts/{}/conversation{suffix}?thread={}{hidden}",
        encode(account),
        encode(thread)
    )
}

/// The best matches first, as the web ranks them: every word in the sender, then in
/// the subject, then the rest; newest first within each. A conversation found twice
/// keeps its first copy, so synced matches given first keep their row id.
pub fn rank_hits(query: &str, hits: Vec<SearchHit>) -> Vec<SearchHit> {
    let query = query.to_lowercase();
    // Operators such as from:x are for the provider only.
    let words: Vec<&str> = query.split_whitespace().filter(|word| !word.contains(':')).collect();
    let covers = |value: &str| {
        let text = value.to_lowercase();
        !words.is_empty() && words.iter().all(|word| text.contains(word))
    };
    let mut seen = HashSet::new();
    let mut scored: Vec<(u8, SearchHit)> = hits
        .into_iter()
        .filter(|hit| seen.insert(format!("{}:{}", hit.account_id, hit.thread_id)))
        .map(|hit| {
            let sender = format!(
                "{} {}",
                hit.from_name.as_deref().unwrap_or_default(),
                hit.from_email.as_deref().unwrap_or_default()
            );
            let score = if covers(&sender) {
                2
            } else if covers(&hit.subject) {
                1
            } else {
                0
            };
            (score, hit)
        })
        .collect();
    scored.sort_by(|(a, x), (b, y)| b.cmp(a).then(y.received_at.cmp(&x.received_at)));
    scored.into_iter().map(|(_, hit)| hit).collect()
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
        Self {
            agent,
            base: api_url(),
            token,
        }
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

    /// A conversation, synced or remote (see `conversation_path`).
    pub fn thread(&self, id: &str) -> Result<ThreadDetail> {
        read(self.get(&conversation_path(id, "")).call())
    }

    /// Searches every mailbox live, through the text too. Takes seconds.
    pub fn search(&self, query: &str) -> Result<SearchResults> {
        read(self.get("/api/mail/search").query("q", query).call())
    }

    /// Sender and subject of what is already synced: back at once.
    pub fn quick_search(&self, query: &str) -> Result<Vec<SearchHit>> {
        let results: SearchResults = read(self.get("/api/mail/search/quick").query("q", query).call())?;
        Ok(results.hits)
    }

    /// The bytes of an attachment or inline image.
    pub fn attachment(&self, thread_id: &str, message_id: &str, attachment_id: &str) -> Result<Vec<u8>> {
        let response = self
            .post(&conversation_path(thread_id, "/attachment"))
            .send_json(serde_json::json!({ "messageId": message_id, "attachmentId": attachment_id }));
        match response {
            Ok(response) => {
                let mut bytes = Vec::new();
                response
                    .into_reader()
                    .take(MAX_ATTACHMENT_BYTES)
                    .read_to_end(&mut bytes)?;
                Ok(bytes)
            }
            Err(ureq::Error::Status(401, _)) => Err(Unauthorized.into()),
            Err(error) => Err(anyhow!(error)),
        }
    }

    pub fn act(&self, id: &str, action: Action) -> Result<()> {
        let response = self
            .post(&conversation_path(id, "/actions"))
            .send_json(serde_json::json!({ "action": action }));
        let _: serde_json::Value = read(response)?;
        Ok(())
    }
}

/// Mail allows 25 MB in all; more than that is not an attachment we asked for.
const MAX_ATTACHMENT_BYTES: u64 = 30 * 1024 * 1024;

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

    fn hit(thread: &str, from: &str, subject: &str, at: &str) -> SearchHit {
        SearchHit {
            account_id: "a".into(),
            thread_id: thread.into(),
            subject: subject.into(),
            snippet: String::new(),
            from_name: Some(from.into()),
            from_email: None,
            received_at: at.parse().unwrap(),
            is_read: true,
            has_attachments: false,
            is_starred: false,
            message_id: None,
        }
    }

    #[test]
    fn reads_search_results() {
        let json = r#"{"hits":[{"accountId":"a1","threadId":"t/1=","subject":"Factuur","snippet":"",
            "fromName":"Bol","fromEmail":"x@bol.com","receivedAt":"2026-11-12T13:56:00.000Z",
            "isRead":true,"hasAttachments":true},
            {"accountId":"a1","threadId":"t2","subject":"Hoi","snippet":"","fromName":null,"fromEmail":null,
            "receivedAt":"2026-11-11T13:56:00.000Z","isRead":false,"hasAttachments":false,"isStarred":true,
            "messageId":"m9"}],"failedAccounts":["a2"]}"#;
        let results: SearchResults = serde_json::from_str(json).unwrap();
        assert_eq!(results.failed_accounts, ["a2"]);
        let threads: Vec<Thread> = results.hits.into_iter().map(SearchHit::into_thread).collect();
        assert_eq!(threads[0].id, "remote:a1:-:t/1=");
        assert_eq!(threads[1].id, "m9");
        assert!(threads[1].is_starred);
        // The quick search answers without failed mailboxes.
        let quick: SearchResults = serde_json::from_str(r#"{"hits":[]}"#).unwrap();
        assert!(quick.failed_accounts.is_empty());
    }

    #[test]
    fn conversation_paths_follow_the_web() {
        assert_eq!(conversation_path("m 1", ""), "/api/mail/threads/m+1");
        assert_eq!(conversation_path("m1", "/actions"), "/api/mail/threads/m1/actions");
        assert_eq!(
            conversation_path("remote:a1:-:AAk/x=:y", "/actions"),
            "/api/mail/accounts/a1/conversation/actions?thread=AAk%2Fx%3D%3Ay"
        );
        assert_eq!(
            conversation_path("remote:a1:h:t1", ""),
            "/api/mail/accounts/a1/conversation?thread=t1&hidden=1"
        );
    }

    #[test]
    fn hits_rank_sender_then_subject_then_newest() {
        let hits = vec![
            hit("1", "Iemand", "Over niets", "2026-11-12T10:00:00Z"),
            hit("2", "Iemand", "Factuur bol", "2026-11-10T10:00:00Z"),
            hit("3", "Bol.com", "Je bestelling", "2026-11-01T10:00:00Z"),
            hit("2", "Iemand", "Factuur bol", "2026-11-10T10:00:00Z"),
            hit("4", "Iemand", "Nog meer", "2026-11-13T10:00:00Z"),
        ];
        let ranked: Vec<String> = rank_hits("Bol from:x", hits)
            .into_iter()
            .map(|hit| hit.thread_id)
            .collect();
        assert_eq!(ranked, ["3", "2", "4", "1"]);
    }

    #[test]
    fn actions_say_when_they_leave_the_list() {
        assert!(Action::Archive.leaves(Folder::Inbox));
        assert!(!Action::Star.leaves(Folder::Inbox));
        assert!(Action::Unstar.leaves(Folder::Starred));
        assert_eq!(serde_json::to_string(&Action::Unread).unwrap(), "\"unread\"");
    }
}
