//! Even mailen's part of the API, as apps/mail-web/src/lib uses it (mail.ts,
//! pins.ts, later.ts, senders.ts, shipments.ts, invoices.ts, drafts.ts,
//! preferences.ts) with the types of packages/mail-core/src/types.ts.
//! Blocking, like the client: call on the background executor.

use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::api::{conversation_path, Account, Address, Client, Thread, ThreadsPage};

/// A connected mailbox (`MailAccountView`).
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mailbox {
    pub id: String,
    /// "gmail" or "outlook".
    #[serde(default)]
    pub provider: String,
    pub email: String,
    /// "active" or "reauth_required".
    #[serde(default)]
    pub status: String,
    pub color: usize,
    /// Which signatures this mailbox adds.
    #[serde(default)]
    pub signatures: MailboxSignatures,
}

/// A mailbox's signature for new messages and for replies and forwards, by
/// id; none adds no signature.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailboxSignatures {
    #[serde(default)]
    pub new_id: Option<String>,
    #[serde(default)]
    pub reply_id: Option<String>,
}

impl Mailbox {
    pub fn active(&self) -> bool {
        self.status == "active"
    }

    /// Whether it can delete mail for good, rather than leaving it in the
    /// trash (`canDeleteForever`): Outlook only.
    pub fn can_delete_forever(&self) -> bool {
        self.provider == "outlook"
    }

    /// The same mailbox as the composer knows it.
    pub fn basic(&self) -> Account {
        Account {
            id: self.id.clone(),
            email: self.email.clone(),
            color: self.color,
        }
    }
}

/// The folders beside the inbox (`MAIL_FOLDERS`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum MailFolder {
    Starred,
    Sent,
    Archive,
    Spam,
    Trash,
}

impl MailFolder {
    pub const ALL: [MailFolder; 5] = [
        MailFolder::Starred,
        MailFolder::Sent,
        MailFolder::Archive,
        MailFolder::Spam,
        MailFolder::Trash,
    ];

    /// The API's name for it.
    pub fn key(self) -> &'static str {
        match self {
            MailFolder::Starred => "starred",
            MailFolder::Sent => "sent",
            MailFolder::Archive => "archive",
            MailFolder::Spam => "spam",
            MailFolder::Trash => "trash",
        }
    }
}

/// What the list shows (`MailView` in components/sidebar.tsx).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum View {
    Inbox,
    Drafts,
    Parcels,
    Invoices,
    Snoozed,
    Scheduled,
    Senders,
    Folder(MailFolder),
}

impl View {
    /// The folder whose conversations the list holds; none for the inbox and
    /// for the lists that aren't conversations.
    pub fn folder(self) -> Option<MailFolder> {
        match self {
            View::Folder(folder) => Some(folder),
            _ => None,
        }
    }

    /// Drafts, parcels, invoices, snoozed, scheduled, senders: lists of
    /// something else than the folder's conversations (`listOfOthers`).
    pub fn of_others(self) -> bool {
        !matches!(self, View::Inbox | View::Folder(_))
    }
}

/// `MAIL_THREAD_ACTIONS`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ThreadAction {
    Read,
    Unread,
    Archive,
    Trash,
    Star,
    Unstar,
    Inbox,
    Spam,
    Delete,
}

/// Whether an action takes a conversation out of the list it is shown in
/// (`leavesList` in lib/mail.ts).
pub fn leaves_list(folder: Option<MailFolder>, action: ThreadAction) -> bool {
    use ThreadAction::*;
    match folder {
        None => matches!(action, Archive | Trash | Spam),
        Some(MailFolder::Starred) => matches!(action, Unstar | Trash | Spam),
        Some(MailFolder::Sent) => matches!(action, Trash),
        Some(MailFolder::Archive) => matches!(action, Trash | Inbox | Spam),
        Some(MailFolder::Spam) => matches!(action, Trash | Inbox | Delete),
        Some(MailFolder::Trash) => matches!(action, Inbox | Delete),
    }
}

/// The actions that move a conversation on, as offered in each list
/// (`moveActions`). Deleting for good only where the mailbox allows it.
pub fn move_actions(folder: Option<MailFolder>, can_delete: bool) -> Vec<ThreadAction> {
    use ThreadAction::*;
    match folder {
        Some(MailFolder::Trash) if can_delete => vec![Inbox, Delete],
        Some(MailFolder::Trash) => vec![Inbox],
        Some(MailFolder::Spam) if can_delete => vec![Inbox, Trash, Delete],
        Some(MailFolder::Spam) => vec![Inbox, Trash],
        Some(MailFolder::Archive) => vec![Inbox, Trash],
        Some(MailFolder::Sent) => vec![Trash],
        _ => vec![Archive, Trash],
    }
}

/// Where reporting spam makes sense (`canReportSpam`).
pub fn can_report_spam(folder: Option<MailFolder>) -> bool {
    !matches!(
        folder,
        Some(MailFolder::Spam) | Some(MailFolder::Trash) | Some(MailFolder::Sent)
    )
}

/// `MailDraftView`.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    pub id: String,
    pub account_id: String,
    #[serde(default)]
    pub subject: String,
    #[serde(default)]
    pub snippet: String,
    #[serde(default)]
    pub to: Vec<Address>,
    pub updated_at: DateTime<Utc>,
    #[serde(default)]
    pub has_attachments: bool,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Drafts {
    pub drafts: Vec<Draft>,
    #[serde(default)]
    pub failed_accounts: Vec<String>,
}

/// `MailShipmentView`. The card above a conversation reads the rest.
#[allow(dead_code)]
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Shipment {
    pub carrier: Option<String>,
    pub tracking_code: Option<String>,
    pub tracking_url: Option<String>,
    pub merchant: Option<String>,
    pub status: Option<String>,
    #[serde(default)]
    pub subject: String,
    pub received_at: DateTime<Utc>,
    pub thread: Option<Thread>,
}

/// `MailInvoiceView`. The card above a conversation reads the rest.
#[allow(dead_code)]
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Invoice {
    pub vendor: Option<String>,
    pub amount_cents: Option<i64>,
    pub currency: Option<String>,
    /// yyyy-mm-dd.
    pub due_date: Option<String>,
    pub invoice_number: Option<String>,
    pub pay_url: Option<String>,
    /// "due", "paid", "auto" or "failed".
    pub status: String,
    #[serde(default)]
    pub overdue: bool,
    #[serde(default)]
    pub subject: String,
    pub received_at: DateTime<Utc>,
    pub thread: Option<Thread>,
}

impl Invoice {
    /// Waiting to be paid by you (`isOpen` in lib/invoices.ts).
    pub fn is_open(&self) -> bool {
        self.status == "due" || self.status == "failed"
    }
}

/// `MailSenderView`.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sender {
    pub email: String,
    pub name: Option<String>,
    pub messages: u64,
    pub unread: u64,
    pub conversations: u64,
    pub latest: DateTime<Utc>,
    #[serde(default)]
    pub provider_message_id: String,
    pub thread: Option<Thread>,
}

impl Sender {
    pub fn label(&self) -> &str {
        self.name.as_deref().filter(|name| !name.is_empty()).unwrap_or(&self.email)
    }
}

/// `MailSnoozedView`.
#[derive(Clone, Debug, Deserialize)]
pub struct Snoozed {
    pub thread: Thread,
    pub until: DateTime<Utc>,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct Snoozes {
    #[serde(default)]
    pub snoozed: Vec<Snoozed>,
    /// Back from snooze and not read yet: on top of the inbox.
    #[serde(default)]
    pub returned: Vec<Snoozed>,
}

/// `MailScheduledView`. Opening one as a draft reads the rest.
#[allow(dead_code)]
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scheduled {
    pub id: String,
    pub account_id: String,
    pub draft_id: String,
    #[serde(default)]
    pub subject: String,
    #[serde(default)]
    pub to: Vec<Address>,
    pub send_at: DateTime<Utc>,
    #[serde(default)]
    pub failed: bool,
}

/// `UnreadSummary`: the count for the sidebar, the newest for notifications.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct Unread {
    pub count: u64,
    #[serde(default)]
    pub latest: Vec<Thread>,
}

/// `MailSyncResult`.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub done: bool,
    #[serde(default)]
    pub busy: bool,
    #[serde(default)]
    pub rate_limited: bool,
    #[serde(default)]
    pub changed: u64,
}

/// As `encodeURIComponent`: a space is `%20`, which a path reads as a space
/// too (the `+` of form encoding only means one in a query).
fn encode(segment: &str) -> String {
    url::form_urlencoded::byte_serialize(segment.as_bytes()).collect::<String>().replace('+', "%20")
}

/// With `?account=…` when one mailbox is picked.
fn with_account(path: &str, account: &str) -> String {
    if account.is_empty() {
        path.to_string()
    } else {
        format!("{path}?account={}", encode(account))
    }
}

pub fn mailboxes(client: &Client) -> Result<Vec<Mailbox>> {
    #[derive(Deserialize)]
    struct Answer {
        accounts: Vec<Mailbox>,
    }
    Ok(client.get_json::<Answer>("/api/mail/accounts")?.accounts)
}

/// A page of a list: one mailbox or all (""), the inbox or a folder.
pub fn threads(client: &Client, account: &str, folder: Option<MailFolder>, cursor: Option<&str>) -> Result<ThreadsPage> {
    let mut query: Vec<(&str, &str)> = Vec::new();
    if !account.is_empty() {
        query.push(("account", account));
    }
    if let Some(folder) = folder {
        query.push(("folder", folder.key()));
    }
    if let Some(cursor) = cursor {
        query.push(("cursor", cursor));
    }
    client.get_query("/api/mail/threads", &query)
}

pub fn unread(client: &Client) -> Result<Unread> {
    client.get_json("/api/mail/unread")
}

/// The conversations pinned to the top of the inbox.
pub fn pins(client: &Client, account: &str) -> Result<Vec<Thread>> {
    #[derive(Deserialize)]
    struct Answer {
        threads: Vec<Thread>,
    }
    Ok(client.get_json::<Answer>(&with_account("/api/mail/pins", account))?.threads)
}

pub fn pin(client: &Client, id: &str, pinned: bool) -> Result<()> {
    let _: serde_json::Value = client.post_json(
        &format!("/api/mail/threads/{}/pin", encode(id)),
        &pin_body(pinned),
    )?;
    Ok(())
}

pub fn snoozes(client: &Client) -> Result<Snoozes> {
    client.get_json("/api/mail/snoozes")
}

pub fn scheduled(client: &Client) -> Result<Vec<Scheduled>> {
    #[derive(Deserialize)]
    struct Answer {
        scheduled: Vec<Scheduled>,
    }
    Ok(client.get_json::<Answer>("/api/mail/scheduled")?.scheduled)
}

pub fn drafts(client: &Client) -> Result<Drafts> {
    client.get_json("/api/mail/drafts")
}

pub fn delete_draft(client: &Client, account: &str, id: &str) -> Result<()> {
    client.delete(&format!("/api/mail/accounts/{}/drafts/{}", encode(account), encode(id)))
}

pub fn shipments(client: &Client) -> Result<Vec<Shipment>> {
    #[derive(Deserialize)]
    struct Answer {
        shipments: Vec<Shipment>,
    }
    Ok(client.get_json::<Answer>("/api/mail/shipments")?.shipments)
}

pub fn invoices(client: &Client) -> Result<Vec<Invoice>> {
    #[derive(Deserialize)]
    struct Answer {
        invoices: Vec<Invoice>,
    }
    Ok(client.get_json::<Answer>("/api/mail/invoices")?.invoices)
}

/// One round of reading mail not seen yet (`useBackgroundScan`): `(done, read)`.
pub fn scan(client: &Client, path: &str) -> Result<(bool, u64)> {
    #[derive(Deserialize)]
    struct Answer {
        done: bool,
        #[serde(default)]
        read: u64,
    }
    let answer: Answer = client.post_json(path, &serde_json::json!({}))?;
    Ok((answer.done, answer.read))
}

pub fn senders(client: &Client, account: &str) -> Result<Vec<Sender>> {
    #[derive(Deserialize)]
    struct Answer {
        senders: Vec<Sender>,
    }
    Ok(client.get_json::<Answer>(&with_account("/api/mail/senders", account))?.senders)
}

pub fn sender_conversations(client: &Client, email: &str, account: &str) -> Result<Vec<Thread>> {
    #[derive(Deserialize)]
    struct Answer {
        threads: Vec<Thread>,
    }
    let mut query = vec![("email", email)];
    if !account.is_empty() {
        query.push(("account", account));
    }
    Ok(client
        .get_query::<Answer>("/api/mail/senders/conversations", &query)?
        .threads)
}

/// One round of archiving, reading or trashing everything from a sender:
/// `(handled, remaining)`.
pub fn sender_action(client: &Client, email: &str, action: &str, account: &str) -> Result<(u64, u64)> {
    #[derive(Deserialize)]
    struct Answer {
        handled: u64,
        remaining: u64,
    }
    let answer: Answer = client.post_json("/api/mail/senders/action", &sender_body(email, action, account))?;
    Ok((answer.handled, answer.remaining))
}

/// Unsubscribes through a message: done, or a page to finish on.
pub fn unsubscribe(client: &Client, thread_id: &str, provider_message_id: &str) -> Result<Option<String>> {
    #[derive(Deserialize)]
    struct Answer {
        done: bool,
        url: Option<String>,
    }
    let answer: Answer = client.post_json(
        &conversation_path(thread_id, "/unsubscribe"),
        &unsubscribe_body(provider_message_id),
    )?;
    Ok(if answer.done { None } else { answer.url })
}

// The JSON of each change, apart from sending it, so the tests can hold it
// against what the API accepts (the zod schemas in apps/api/src/mail/routes.ts).

/// `actionBody`.
pub fn action_body(action: ThreadAction) -> serde_json::Value {
    serde_json::json!({ "action": action })
}

/// `snoozeBody`: a moment with its offset, as `Date.toISOString()` writes it.
pub fn snooze_body(until: DateTime<Utc>) -> serde_json::Value {
    serde_json::json!({ "until": until.to_rfc3339_opts(chrono::SecondsFormat::Millis, true) })
}

/// `pinBody`.
pub fn pin_body(pinned: bool) -> serde_json::Value {
    serde_json::json!({ "pinned": pinned })
}

/// `senderBody`: the mailbox only when one is picked.
pub fn sender_body(email: &str, action: &str, account: &str) -> serde_json::Value {
    let mut body = serde_json::json!({ "email": email, "action": action });
    if !account.is_empty() {
        body["account"] = account.into();
    }
    body
}

/// `unsubscribeBody`.
pub fn unsubscribe_body(provider_message_id: &str) -> serde_json::Value {
    serde_json::json!({ "messageId": provider_message_id })
}

/// One setting that follows the account (`preferencesBody`, partial).
pub fn feature_body(key: &str, on: bool) -> serde_json::Value {
    serde_json::json!({ key: on })
}

/// The sidebar as arranged, or null to put the default back.
pub fn sidebar_body(layout: Option<&super::places::Layout>) -> serde_json::Value {
    serde_json::json!({ "sidebar": layout })
}

/// `todoBody`: a task in Even doen from a conversation.
pub fn todo_body(list: &str, title: &str) -> serde_json::Value {
    serde_json::json!({ "listId": list, "title": title })
}

/// `reportBody`: "not recognised well".
pub fn report_body(kind: &str, reason: &str) -> serde_json::Value {
    serde_json::json!({ "kind": kind, "reason": reason })
}

/// `writeBody`: what the model is asked to write.
pub fn write_body(instruction: &str, draft: &str, subject: &str, has_signature: bool, forward: bool) -> serde_json::Value {
    serde_json::json!({
        "instruction": instruction,
        "draft": draft,
        "subject": subject,
        "hasSignature": has_signature,
        "forward": forward,
    })
}

pub fn act(client: &Client, id: &str, action: ThreadAction) -> Result<()> {
    let _: serde_json::Value = client.post_json(
        &conversation_path(id, "/actions"),
        &action_body(action),
    )?;
    Ok(())
}

/// Snoozes: the conversation leaves as if archived and comes back at `until`.
pub fn snooze(client: &Client, id: &str, until: DateTime<Utc>) -> Result<()> {
    let _: serde_json::Value = client.post_json(
        &conversation_path(id, "/snooze"),
        &snooze_body(until),
    )?;
    Ok(())
}

pub fn unsnooze(client: &Client, id: &str) -> Result<()> {
    client.delete(&format!("/api/mail/threads/{}/snooze", encode(id)))
}

pub fn send_scheduled_now(client: &Client, id: &str) -> Result<()> {
    let _: serde_json::Value =
        client.post_json(&format!("/api/mail/scheduled/{}/send", encode(id)), &serde_json::json!({}))?;
    Ok(())
}

/// Keeps a scheduled message as a draft instead.
pub fn cancel_scheduled(client: &Client, id: &str) -> Result<()> {
    client.delete(&format!("/api/mail/scheduled/{}", encode(id)))
}

pub fn sync(client: &Client, account: &str) -> Result<SyncResult> {
    client.post_json(&format!("/api/mail/accounts/{}/sync", encode(account)), &serde_json::json!({}))
}

/// One page of emptying the trash for good: `(deleted, done)`.
pub fn empty_trash(client: &Client, account: &str) -> Result<(u64, bool)> {
    #[derive(Deserialize)]
    struct Answer {
        deleted: u64,
        done: bool,
    }
    let answer: Answer = client.post_json(
        &format!("/api/mail/accounts/{}/trash/empty", encode(account)),
        &serde_json::json!({}),
    )?;
    Ok((answer.deleted, answer.done))
}

/// The settings that follow the account, or none when it never saved any.
pub fn preferences(client: &Client) -> Result<Option<serde_json::Map<String, serde_json::Value>>> {
    #[derive(Deserialize)]
    struct Answer {
        preferences: Option<serde_json::Map<String, serde_json::Value>>,
    }
    Ok(client.get_json::<Answer>("/api/mail/preferences")?.preferences)
}

pub fn save_preferences(client: &Client, change: &serde_json::Value) -> Result<()> {
    let _: serde_json::Value = client.patch_json("/api/mail/preferences", change)?;
    Ok(())
}

// Mail's pages in the settings window (pages/accounts.tsx, lib/signatures.ts,
// lib/connections.ts).

/// `InboxSummary`: how much mail a mailbox's inbox holds.
#[derive(Clone, Copy, Debug, Deserialize)]
pub struct InboxSummary {
    pub total: u64,
    pub unread: u64,
}

pub fn inbox_summary(client: &Client, account: &str) -> Result<InboxSummary> {
    client.get_json(&format!("/api/mail/accounts/{}/inbox", encode(account)))
}

/// Changes a mailbox: `{ "color": 3 }`, `{ "signatureNewId": … }`, `{ "signatureReplyId": null }`.
pub fn update_mailbox(client: &Client, account: &str, change: &serde_json::Value) -> Result<()> {
    let _: serde_json::Value = client.patch_json(&format!("/api/mail/accounts/{}", encode(account)), change)?;
    Ok(())
}

pub fn disconnect_mailbox(client: &Client, account: &str) -> Result<()> {
    client.delete(&format!("/api/mail/accounts/{}", encode(account)))
}

/// A signature the user wrote (`MailSignature`); `html` is the editor's HTML.
#[derive(Clone, Debug, Deserialize)]
pub struct Signature {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub html: String,
}

pub fn signatures(client: &Client) -> Result<Vec<Signature>> {
    #[derive(Deserialize)]
    struct Answer {
        signatures: Vec<Signature>,
    }
    Ok(client.get_json::<Answer>("/api/mail/signatures")?.signatures)
}

pub fn create_signature(client: &Client, name: &str) -> Result<Signature> {
    client.post_json("/api/mail/signatures", &serde_json::json!({ "name": name, "html": "" }))
}

/// Changes a signature: `{ "name": … }` or `{ "html": … }`.
pub fn update_signature(client: &Client, id: &str, change: &serde_json::Value) -> Result<()> {
    let _: serde_json::Value = client.patch_json(&format!("/api/mail/signatures/{}", encode(id)), change)?;
    Ok(())
}

pub fn delete_signature(client: &Client, id: &str) -> Result<()> {
    client.delete(&format!("/api/mail/signatures/{}", encode(id)))
}

/// `MoneybirdAdministration`.
#[derive(Clone, Debug, Deserialize)]
pub struct Administration {
    pub id: String,
    pub name: String,
}

/// A linked service (`ConnectionView`); Moneybird for now.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub provider: String,
    /// "active" or "reauth_required".
    #[serde(default)]
    pub status: String,
    /// Where mail goes unless another is picked; none asks each time.
    #[serde(default)]
    pub default_target: Option<Administration>,
    #[serde(default)]
    pub administrations: Vec<Administration>,
}

/// `ConnectionsView`: what is linked, and what this server can link.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct Connections {
    #[serde(default)]
    pub connections: Vec<Connection>,
    #[serde(default)]
    pub available: Vec<String>,
}

pub fn connections(client: &Client) -> Result<Connections> {
    client.get_json("/api/connections")
}

/// Where Moneybird invoices go by default; `None` asks each time.
pub fn set_moneybird_administration(client: &Client, administration: Option<&str>) -> Result<()> {
    let _: serde_json::Value =
        client.patch_json("/api/connections/moneybird", &serde_json::json!({ "administrationId": administration }))?;
    Ok(())
}

pub fn disconnect_moneybird(client: &Client) -> Result<()> {
    client.delete("/api/connections/moneybird")
}

#[cfg(test)]
mod tests {
    use super::{leaves_list, move_actions, MailFolder, ThreadAction::*};

    #[test]
    fn actions_leave_the_lists_the_web_says() {
        assert!(leaves_list(None, Archive) && leaves_list(None, Spam) && !leaves_list(None, Star));
        assert!(leaves_list(Some(MailFolder::Starred), Unstar));
        assert!(!leaves_list(Some(MailFolder::Sent), Archive));
        assert!(leaves_list(Some(MailFolder::Trash), Inbox) && !leaves_list(Some(MailFolder::Trash), Trash));
        assert_eq!(serde_json::to_string(&Unread).unwrap(), "\"unread\"");
    }

    #[test]
    fn changes_are_what_the_api_takes() {
        use super::*;
        use crate::mail::schema;
        use serde_json::json;

        // Every action by the name the API knows it.
        let actions = [Read, Unread, Archive, Trash, Star, Unstar, Inbox, Spam, Delete];
        for action in actions {
            assert_eq!(schema::action(&action_body(action)), Ok(()), "{action:?}");
        }
        assert_eq!(action_body(Unstar), json!({ "action": "unstar" }));
        // A snooze: the moment with its offset, as `Date.toISOString()`.
        let now = chrono::Utc::now();
        let body = snooze_body(now + chrono::Duration::hours(3));
        assert_eq!(schema::snooze(&body, now), Ok(()));
        let fixed = chrono::DateTime::parse_from_rfc3339("2026-11-14T08:00:00+01:00").unwrap().with_timezone(&chrono::Utc);
        assert_eq!(snooze_body(fixed), json!({ "until": "2026-11-14T07:00:00.000Z" }));
        for pinned in [true, false] {
            assert_eq!(schema::pin(&pin_body(pinned)), Ok(()));
        }
        // Tidy up: the mailbox only when one is picked.
        for action in ["archive", "read", "trash"] {
            assert_eq!(schema::sender(&sender_body("news@shop.nl", action, "")), Ok(()));
        }
        assert_eq!(sender_body("news@shop.nl", "read", ""), json!({ "email": "news@shop.nl", "action": "read" }));
        assert_eq!(sender_body("news@shop.nl", "read", "a1")["account"], "a1");
        assert_eq!(schema::sender(&sender_body("news@shop.nl", "read", "a1")), Ok(()));
        assert_eq!(schema::unsubscribe(&unsubscribe_body("m1")), Ok(()));
        // Preferences: one switch, or the sidebar (null puts the default back).
        assert_eq!(schema::preferences(&feature_body("replySuggestions", false)), Ok(()));
        assert!(schema::preferences(&feature_body("reply_suggestions", false)).is_err());
        assert_eq!(sidebar_body(None), json!({ "sidebar": null }));
        assert_eq!(schema::preferences(&sidebar_body(None)), Ok(()));
        let layout = crate::mail::places::Layout::default();
        let body = sidebar_body(Some(&layout));
        assert_eq!(schema::preferences(&body), Ok(()));
        assert_eq!(body["sidebar"]["more"], json!(["archive", "spam", "trash"]));
        // A task, a report, a request to write.
        assert_eq!(schema::todo(&todo_body("3f2b6c1e-8a4d-4c57-9b1a-0d2e4f6a8c10", "Call Jan")), Ok(()));
        for reason in ["not_one", "amount", "status", "other"] {
            assert_eq!(schema::report(&report_body("invoice", reason)), Ok(()));
        }
        assert_eq!(schema::report(&report_body("parcel", "not_one")), Ok(()));
        assert_eq!(schema::write(&write_body("shorter", "Hi", "Lunch", true, false)), Ok(()));
    }

    #[test]
    fn paths_are_encoded_as_the_web_encodes_them() {
        // `encodeURIComponent`: a space is %20 (a "+" in a path would be a plus).
        assert_eq!(super::encode("a b+c/d=e"), "a%20b%2Bc%2Fd%3De");
        assert_eq!(super::with_account("/api/mail/pins", "a 1"), "/api/mail/pins?account=a%201");
        assert_eq!(super::with_account("/api/mail/pins", ""), "/api/mail/pins");
    }

    #[test]
    fn each_list_offers_its_moves() {
        assert_eq!(move_actions(None, false), [Archive, Trash]);
        assert_eq!(move_actions(Some(MailFolder::Trash), true), [Inbox, Delete]);
        assert_eq!(move_actions(Some(MailFolder::Spam), false), [Inbox, Trash]);
        assert_eq!(move_actions(Some(MailFolder::Sent), true), [Trash]);
    }
}
