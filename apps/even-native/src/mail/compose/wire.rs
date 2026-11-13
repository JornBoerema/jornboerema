//! What writing mail asks of the API, as apps/mail-web/src/lib uses it
//! (drafts.ts, uploads.ts, later.ts, addresses.ts, the composer's own calls)
//! with the types of packages/mail-core/src/types.ts. Blocking, like the
//! client: call on the background executor.

use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::api::{conversation_path, Address, Client};
use crate::editor::InlineImage;

/// Inline pictures still travel in the request itself, so together they stay this small (`MAX_UPLOAD_BYTES`).
pub(super) const MAX_UPLOAD_BYTES: u64 = 3 * 1024 * 1024;
/// All files on one message, as Gmail allows (`MAX_ATTACHMENTS_BYTES`).
pub(super) const MAX_ATTACHMENTS_BYTES: u64 = 25 * 1024 * 1024;
/// The API gives a request 30 seconds (apps/api/vercel.json); a message that
/// goes out is waited for longer than that, so the answer is always the
/// server's own. Giving up first would show "failed" for mail that was sent,
/// and trying again would send it twice.
const SEND_PATIENCE: std::time::Duration = std::time::Duration::from_secs(60);
/// One chunk per request (`UPLOAD_CHUNK_BYTES`).
pub(super) const UPLOAD_CHUNK_BYTES: usize = 2 * 1024 * 1024;

/// A file already uploaded in chunks, as a message refers to it (`MailAttachmentRef`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AttachmentRef {
    pub upload_id: String,
    pub name: String,
    #[serde(default)]
    pub content_type: String,
    #[serde(default)]
    pub size: u64,
}

/// A picture in the body, which refers to it as `cid:<contentId>` (`MailInlineUpload`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct InlineUpload {
    pub content_id: String,
    pub name: String,
    pub content_type: String,
    /// Standard base64.
    pub data: String,
}

impl InlineUpload {
    pub(super) fn of(image: &InlineImage) -> Self {
        Self {
            content_id: image.content_id.clone(),
            name: image.name.clone(),
            content_type: image.content_type.clone(),
            data: image.data.clone(),
        }
    }

    pub(super) fn image(&self) -> InlineImage {
        InlineImage {
            content_id: self.content_id.clone(),
            name: self.name.clone(),
            content_type: self.content_type.clone(),
            data: self.data.clone(),
        }
    }
}

/// How many bytes the pictures are once decoded (`uploadBytes`).
pub(super) fn upload_bytes(inline: &[InlineUpload]) -> u64 {
    inline.iter().map(|image| image.data.len() as u64).sum::<u64>() * 3 / 4
}

/// A saved draft, by the mailbox it lives in (`DraftRef`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct DraftRef {
    pub account: String,
    pub id: String,
}

/// An opened draft, its files already copied into uploads (`MailDraftOpened`).
#[derive(Clone, Debug, Default, Deserialize)]
pub(super) struct DraftOpened {
    #[serde(default)]
    pub to: Vec<Address>,
    #[serde(default)]
    pub cc: Vec<Address>,
    #[serde(default)]
    pub bcc: Vec<Address>,
    #[serde(default)]
    pub subject: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub html: Option<String>,
    #[serde(default)]
    pub attachments: Vec<AttachmentRef>,
    #[serde(default)]
    pub inline: Vec<InlineUpload>,
    /// Keeps a draft that answers a conversation in that conversation. Opaque here.
    #[serde(default)]
    pub reply: Option<Value>,
}

/// A message as it is written (`WithAttachmentRefs<MailOutgoing>` and, with
/// `reply`, `MailDraftRequest`).
#[derive(Clone, Debug, Default)]
pub(super) struct Outgoing {
    pub to: Vec<Address>,
    pub cc: Vec<Address>,
    pub bcc: Vec<Address>,
    pub subject: String,
    pub text: String,
    /// Empty when nothing is formatted or written.
    pub html: String,
    pub attachments: Vec<AttachmentRef>,
    pub inline: Vec<InlineUpload>,
    pub reply: Option<Value>,
}

impl Outgoing {
    /// As the web builds it: `html`, `inline` and `reply` only when there are any.
    pub(super) fn json(&self) -> Value {
        let mut body = json!({
            "to": self.to,
            "cc": self.cc,
            "bcc": self.bcc,
            "subject": self.subject,
            "text": self.text,
            "attachments": self.attachments,
        });
        if !self.html.is_empty() {
            body["html"] = json!(self.html);
        }
        if !self.inline.is_empty() {
            body["inline"] = json!(self.inline);
        }
        if let Some(reply) = &self.reply {
            body["reply"] = reply.clone();
        }
        body
    }

    /// Everything but the files and pictures, to tell whether a draft changed
    /// (`keyOf` in lib/drafts.ts). Pictures show in the HTML by content id.
    pub(super) fn key(&self, account: &str) -> String {
        json!([account, self.to, self.cc, self.bcc, self.subject, self.text, self.html, self.reply]).to_string()
    }

    pub(super) fn files_key(&self) -> String {
        serde_json::to_string(&self.attachments).unwrap_or_default()
    }

    pub(super) fn pictures_key(&self) -> String {
        self.inline.iter().map(|image| image.content_id.as_str()).collect::<Vec<_>>().join(",")
    }

    /// The provider conversation a draft answers, when it is a reply.
    pub(super) fn reply_thread(&self) -> Option<&str> {
        self.reply.as_ref()?.get("threadId")?.as_str()
    }
}

/// Someone who wrote to this user, for the address fields.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub(super) struct Contact {
    pub name: Option<String>,
    pub email: String,
}

/// As `encodeURIComponent`: a space is `%20`, which a path reads as a space
/// too (the `+` of form encoding only means one in a query).
// The JSON of each call, apart from sending it, so the tests can hold it
// against what the API accepts (the zod schemas in apps/api/src/mail/routes.ts).

/// A new message (`sendBody`): never a reply, also when the draft it started as was.
pub(super) fn send_body(content: &Outgoing) -> Value {
    let mut body = content.json();
    if let Some(fields) = body.as_object_mut() {
        fields.remove("reply");
    }
    body
}

/// A draft to save, or to send as itself (`draftBody`).
pub(super) fn draft_body(content: &Outgoing, draft: Option<&str>, attachments_changed: bool) -> Value {
    let mut body = content.json();
    body["draftId"] = json!(draft);
    body["attachmentsChanged"] = json!(attachments_changed);
    body
}

/// Send later (`draftBody` with `sendAt`).
pub(super) fn schedule_body(content: &Outgoing, draft: Option<&str>, attachments_changed: bool, at: DateTime<Utc>) -> Value {
    let mut body = draft_body(content, draft, attachments_changed);
    body["sendAt"] = json!(moment(at));
    body
}

/// A moment as the API reads it (`Date.toISOString()`).
pub(in crate::mail) fn moment(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// `replyBody`: no subject and no blind copies; the API takes those from the message answered.
pub(super) fn reply_body(message: &str, to: &[Address], cc: &[Address], content: &Outgoing) -> Value {
    let mut body = json!({
        "messageId": message,
        "to": to,
        "cc": cc,
        "text": content.text,
        "attachments": content.attachments,
    });
    if !content.html.is_empty() {
        body["html"] = json!(content.html);
    }
    if !content.inline.is_empty() {
        body["inline"] = json!(content.inline);
    }
    body
}

/// `forwardBody`: the message's own files go along at the server, so none are named here.
pub(super) fn forward_body(message: &str, to: &[Address], content: &Outgoing) -> Value {
    let mut body = json!({
        "messageId": message,
        "to": to,
        "cc": [],
        "text": content.text,
    });
    if !content.html.is_empty() {
        body["html"] = json!(content.html);
    }
    if !content.inline.is_empty() {
        body["inline"] = json!(content.inline);
    }
    body
}

/// `uploadBody`. A file without a known kind is `application/octet-stream`, as the web names it.
pub(super) fn upload_body(name: &str, content_type: &str, size: u64) -> Value {
    let content_type = if content_type.is_empty() { "application/octet-stream" } else { content_type };
    json!({ "name": name, "contentType": content_type, "size": size })
}

fn encode(segment: &str) -> String {
    url::form_urlencoded::byte_serialize(segment.as_bytes()).collect::<String>().replace('+', "%20")
}

fn draft_path(draft: &DraftRef) -> String {
    format!("/api/mail/accounts/{}/drafts/{}", encode(&draft.account), encode(&draft.id))
}

fn done(result: Result<Value>) -> Result<()> {
    result.map(|_| ())
}

pub(super) fn contacts(client: &Client, typed: &str) -> Result<Vec<Contact>> {
    #[derive(Deserialize)]
    struct Answer {
        contacts: Vec<Contact>,
    }
    Ok(client.get_query::<Answer>("/api/mail/contacts", &[("q", typed)])?.contacts)
}

/// Always read fresh: the draft may have changed in another client since.
pub(super) fn open_draft(client: &Client, draft: &DraftRef) -> Result<DraftOpened> {
    client.get_json(&draft_path(draft))
}

pub(super) fn delete_draft(client: &Client, draft: &DraftRef) -> Result<()> {
    client.delete(&draft_path(draft))
}

/// Saves the message as a draft in `account`, as `draft` when it is one there already.
pub(super) fn save_draft(
    client: &Client,
    account: &str,
    content: &Outgoing,
    draft: Option<&str>,
    attachments_changed: bool,
) -> Result<String> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Answer {
        draft_id: String,
    }
    let body = draft_body(content, draft, attachments_changed);
    let answer: Answer =
        client.post_json_within(&format!("/api/mail/accounts/{}/drafts", encode(account)), &body, SEND_PATIENCE)?;
    Ok(answer.draft_id)
}

/// One round of `useDraftAutosave`, as what it asks of the API.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum Keep {
    /// Nothing worth keeping: the draft it was, if any, goes.
    Drop(Option<DraftRef>),
    /// Saved in `account` as the draft `id` (none: a new one), and the draft
    /// it was in another mailbox goes after it.
    Save {
        id: Option<String>,
        attachments_changed: bool,
        then_delete: Option<DraftRef>,
    },
}

pub(super) fn plan_keep(account: &str, worth_keeping: bool, previous: Option<DraftRef>, files_changed: bool) -> Keep {
    if !worth_keeping {
        return Keep::Drop(previous);
    }
    // A draft lives in one mailbox, so switching the sender moves it.
    match previous {
        Some(draft) if draft.account == account => Keep::Save {
            id: Some(draft.id),
            attachments_changed: files_changed,
            then_delete: None,
        },
        // A new draft has no files at the provider yet: they all go along.
        other => Keep::Save {
            id: None,
            attachments_changed: true,
            then_delete: other,
        },
    }
}

/// Keeps the open message as a draft, or drops the draft once nothing is
/// worth keeping: one round of `useDraftAutosave`. The draft it now is.
pub(super) fn keep_draft(
    client: &Client,
    account: &str,
    content: &Outgoing,
    worth_keeping: bool,
    previous: Option<DraftRef>,
    files_changed: bool,
) -> Result<Option<DraftRef>> {
    match plan_keep(account, worth_keeping, previous, files_changed) {
        Keep::Drop(previous) => {
            if let Some(previous) = &previous {
                delete_draft(client, previous)?;
            }
            Ok(None)
        }
        Keep::Save {
            id,
            attachments_changed,
            then_delete,
        } => {
            let id = save_draft(client, account, content, id.as_deref(), attachments_changed)?;
            if let Some(previous) = &then_delete {
                let _ = delete_draft(client, previous);
            }
            Ok(Some(DraftRef {
                account: account.to_string(),
                id,
            }))
        }
    }
}

/// A POST and what follows it: where, what, and the draft in another mailbox
/// that goes once it worked.
pub(super) struct Request {
    pub path: String,
    pub body: Value,
    pub then_delete: Option<DraftRef>,
}

impl Request {
    fn run(self, client: &Client) -> Result<()> {
        done(client.post_json_within(&self.path, &self.body, SEND_PATIENCE))?;
        if let Some(draft) = &self.then_delete {
            let _ = delete_draft(client, draft);
        }
        Ok(())
    }
}

/// Sending (`send` in pages/compose.tsx). A saved draft is sent as itself, so
/// it leaves the drafts folder at the provider too; one in another mailbox
/// can't be, so the message goes as new and that draft is deleted.
pub(super) fn send_request(account: &str, content: &Outgoing, draft: Option<DraftRef>, attachments_changed: bool) -> Request {
    match draft {
        Some(draft) if draft.account == account => Request {
            path: format!("{}/send", draft_path(&draft)),
            body: draft_body(content, Some(&draft.id), attachments_changed),
            then_delete: None,
        },
        other => Request {
            path: format!("/api/mail/accounts/{}/send", encode(account)),
            body: send_body(content),
            then_delete: other,
        },
    }
}

pub(super) fn send(
    client: &Client,
    account: &str,
    content: &Outgoing,
    draft: Option<DraftRef>,
    attachments_changed: bool,
) -> Result<()> {
    send_request(account, content, draft, attachments_changed).run(client)
}

/// Send later (`schedule` in pages/compose.tsx): saved as the draft it
/// already is, so it leaves the drafts for Scheduled until its moment.
pub(super) fn schedule_request(
    account: &str,
    content: &Outgoing,
    draft: Option<DraftRef>,
    attachments_changed: bool,
    at: DateTime<Utc>,
) -> Request {
    let here = draft.as_ref().filter(|draft| draft.account == account).map(|draft| draft.id.clone());
    Request {
        path: format!("/api/mail/accounts/{}/scheduled", encode(account)),
        body: schedule_body(content, here.as_deref(), attachments_changed, at),
        then_delete: draft.filter(|draft| draft.account != account),
    }
}

pub(super) fn schedule(
    client: &Client,
    account: &str,
    content: &Outgoing,
    draft: Option<DraftRef>,
    attachments_changed: bool,
    at: DateTime<Utc>,
) -> Result<()> {
    schedule_request(account, content, draft, attachments_changed, at).run(client)
}

/// Keeps a scheduled message as a draft instead, and says which draft.
pub(super) fn cancel_scheduled(client: &Client, id: &str) -> Result<DraftRef> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Answer {
        account_id: String,
        draft_id: String,
    }
    let answer: Answer = client.delete_json(&format!("/api/mail/scheduled/{}", encode(id)))?;
    Ok(DraftRef {
        account: answer.account_id,
        id: answer.draft_id,
    })
}

/// Answers a conversation below `message` (`MailReply`).
pub(super) fn reply(
    client: &Client,
    thread: &str,
    message: &str,
    to: &[Address],
    cc: &[Address],
    content: &Outgoing,
) -> Result<()> {
    let body = reply_body(message, to, cc, content);
    done(client.post_json_within(&conversation_path(thread, "/reply"), &body, SEND_PATIENCE))
}

/// Sends `message` on, its files included, under a note (`MailForward`).
pub(super) fn forward(client: &Client, thread: &str, message: &str, to: &[Address], content: &Outgoing) -> Result<()> {
    let body = forward_body(message, to, content);
    done(client.post_json_within(&conversation_path(thread, "/forward"), &body, SEND_PATIENCE))
}

/// Starts an upload and says its id (`uploadFile` in lib/uploads.ts).
pub(super) fn create_upload(client: &Client, name: &str, content_type: &str, size: u64) -> Result<String> {
    #[derive(Deserialize)]
    struct Answer {
        id: String,
    }
    let answer: Answer = client.post_json("/api/mail/uploads", &upload_body(name, content_type, size))?;
    Ok(answer.id)
}

pub(super) fn put_chunk(client: &Client, upload: &str, index: usize, bytes: &[u8]) -> Result<()> {
    client.put_bytes(
        &format!("/api/mail/uploads/{}/chunks/{index}", encode(upload)),
        "application/octet-stream",
        bytes,
    )
}

pub(super) fn delete_upload(client: &Client, upload: &str) {
    let _ = client.delete(&format!("/api/mail/uploads/{}", encode(upload)));
}

#[cfg(test)]
mod tests {
    use super::{upload_bytes, AttachmentRef, DraftOpened, InlineUpload, Outgoing};
    use crate::api::Address;

    #[test]
    fn a_message_goes_out_as_the_web_sends_it() {
        let mut message = Outgoing {
            to: vec![Address {
                name: None,
                email: "jan@even.nl".into(),
            }],
            subject: "Hi".into(),
            text: "Hello".into(),
            ..Default::default()
        };
        let body = message.json();
        assert_eq!(body["to"][0]["email"], "jan@even.nl");
        assert!(body["to"][0]["name"].is_null());
        assert_eq!(body["attachments"], serde_json::json!([]));
        assert_eq!(body["bcc"], serde_json::json!([]));
        // Nothing formatted, no pictures: neither field is there.
        assert!(body.get("html").is_none() && body.get("inline").is_none());
        message.html = "<p>Hello</p>".into();
        message.attachments.push(AttachmentRef {
            upload_id: "u1".into(),
            name: "a.pdf".into(),
            content_type: "application/pdf".into(),
            size: 12,
        });
        message.inline.push(InlineUpload {
            content_id: "x@evido".into(),
            name: "image-x.png".into(),
            content_type: "image/png".into(),
            data: "AAAA".into(),
        });
        let body = message.json();
        assert_eq!(body["html"], "<p>Hello</p>");
        assert_eq!(body["attachments"][0]["uploadId"], "u1");
        assert_eq!(body["attachments"][0]["contentType"], "application/pdf");
        assert_eq!(body["inline"][0]["contentId"], "x@evido");
        assert!(body.get("reply").is_none());
        assert_eq!(upload_bytes(&message.inline), 3);
    }

    use super::{
        draft_body, forward_body, plan_keep, reply_body, schedule_request, send_body, send_request, upload_body, DraftRef,
        Keep,
    };
    use crate::mail::schema;
    use serde_json::json;

    fn address(name: Option<&str>, email: &str) -> Address {
        Address {
            name: name.map(String::from),
            email: email.into(),
        }
    }

    /// A message with everything on it: formatted, a file, a picture, and the
    /// conversation it answers.
    fn full() -> Outgoing {
        Outgoing {
            to: vec![address(None, "jan@even.nl")],
            cc: vec![address(None, "kees@even.nl")],
            bcc: vec![address(None, "piet@even.nl")],
            subject: "Lunch".into(),
            text: "Hello".into(),
            html: r#"<div><p style="margin:0">Hello</p><img src="cid:1x2y.9a@evido"></div>"#.into(),
            attachments: vec![AttachmentRef {
                upload_id: "3f2b6c1e-8a4d-4c57-9b1a-0d2e4f6a8c10".into(),
                name: "a.pdf".into(),
                content_type: "application/pdf".into(),
                size: 12,
            }],
            inline: vec![InlineUpload {
                content_id: "1x2y.9a@evido".into(),
                name: "image-1x2y.png".into(),
                content_type: "image/png".into(),
                data: "AAAA".into(),
            }],
            reply: Some(json!({ "threadId": "t1", "inReplyTo": "<m@x>", "references": "<a@x> <m@x>" })),
        }
    }

    fn draft(account: &str, id: &str) -> DraftRef {
        DraftRef {
            account: account.into(),
            id: id.into(),
        }
    }

    #[test]
    fn a_new_message_is_what_the_send_route_takes() {
        // POST /api/mail/accounts/:id/send with `sendBody`: exactly these fields.
        let body = send_body(&full());
        assert_eq!(schema::send(&body), Ok(()));
        assert_eq!(
            body,
            json!({
                "to": [{ "name": null, "email": "jan@even.nl" }],
                "cc": [{ "name": null, "email": "kees@even.nl" }],
                "bcc": [{ "name": null, "email": "piet@even.nl" }],
                "subject": "Lunch",
                "text": "Hello",
                "html": r#"<div><p style="margin:0">Hello</p><img src="cid:1x2y.9a@evido"></div>"#,
                "attachments": [{
                    "uploadId": "3f2b6c1e-8a4d-4c57-9b1a-0d2e4f6a8c10", "name": "a.pdf",
                    "contentType": "application/pdf", "size": 12,
                }],
                "inline": [{
                    "contentId": "1x2y.9a@evido", "name": "image-1x2y.png", "contentType": "image/png", "data": "AAAA",
                }],
            })
        );
        // Plain text and nothing else: html and inline are left out, never null.
        let plain = Outgoing {
            to: vec![address(None, "jan@even.nl")],
            text: "Hi".into(),
            ..Default::default()
        };
        let body = send_body(&plain);
        assert_eq!(schema::send(&body), Ok(()));
        assert_eq!(
            body,
            json!({ "to": [{ "name": null, "email": "jan@even.nl" }], "cc": [], "bcc": [], "subject": "", "text": "Hi", "attachments": [] })
        );
    }

    #[test]
    fn sending_picks_the_route_the_web_picks() {
        let message = full();
        // Saved in the mailbox it goes from: sent as that draft, reply and all.
        let request = send_request("a1", &message, Some(draft("a1", "d 1")), false);
        assert_eq!(request.path, "/api/mail/accounts/a1/drafts/d%201/send");
        assert_eq!(schema::send_draft(&request.body), Ok(()));
        assert_eq!(request.body["draftId"], "d 1");
        assert_eq!(request.body["attachmentsChanged"], false);
        assert_eq!(request.body["reply"]["inReplyTo"], "<m@x>");
        assert_eq!(request.then_delete, None);
        // Saved in another mailbox: sent as new from this one, no reply, and that draft goes after it.
        let request = send_request("a2", &message, Some(draft("a1", "d1")), true);
        assert_eq!(request.path, "/api/mail/accounts/a2/send");
        assert_eq!(schema::send(&request.body), Ok(()));
        assert_eq!(request.then_delete, Some(draft("a1", "d1")));
        // Never saved: sent as new, nothing to delete.
        let request = send_request("a1", &message, None, true);
        assert_eq!(request.path, "/api/mail/accounts/a1/send");
        assert_eq!(schema::send(&request.body), Ok(()));
        assert_eq!(request.then_delete, None);
    }

    #[test]
    fn a_draft_is_saved_as_the_draft_route_takes_it() {
        // A new one: `draftId` is null (the key must be there), its files go along.
        let body = draft_body(&full(), None, true);
        assert_eq!(schema::save_draft(&body), Ok(()));
        assert!(body["draftId"].is_null() && body.as_object().unwrap().contains_key("draftId"));
        assert_eq!(body["attachmentsChanged"], true);
        assert_eq!(body["reply"], json!({ "threadId": "t1", "inReplyTo": "<m@x>", "references": "<a@x> <m@x>" }));
        // Saved again: by its id.
        let body = draft_body(&full(), Some("d1"), false);
        assert_eq!(schema::save_draft(&body), Ok(()));
        assert_eq!((&body["draftId"], &body["attachmentsChanged"]), (&json!("d1"), &json!(false)));
        // Half an address in a field isn't one yet: a draft may have nobody on it.
        let nobody = Outgoing {
            subject: "Later".into(),
            ..Default::default()
        };
        assert_eq!(schema::save_draft(&draft_body(&nobody, None, true)), Ok(()));
        // Nothing but recipients is no draft: the API refuses it, and `plan_keep` never sends it.
        let empty = Outgoing {
            to: vec![address(None, "jan@even.nl")],
            ..Default::default()
        };
        assert!(schema::save_draft(&draft_body(&empty, None, true)).is_err());
    }

    #[test]
    fn saving_while_writing_makes_updates_moves_and_deletes() {
        // First save: a new draft, with its files.
        assert_eq!(
            plan_keep("a1", true, None, false),
            Keep::Save { id: None, attachments_changed: true, then_delete: None }
        );
        // Again: the same draft, files only when they changed.
        assert_eq!(
            plan_keep("a1", true, Some(draft("a1", "d1")), false),
            Keep::Save { id: Some("d1".into()), attachments_changed: false, then_delete: None }
        );
        assert_eq!(
            plan_keep("a1", true, Some(draft("a1", "d1")), true),
            Keep::Save { id: Some("d1".into()), attachments_changed: true, then_delete: None }
        );
        // Another sender: a new draft there, the old one goes after it.
        assert_eq!(
            plan_keep("a2", true, Some(draft("a1", "d1")), false),
            Keep::Save { id: None, attachments_changed: true, then_delete: Some(draft("a1", "d1")) }
        );
        // Emptied again: the draft goes; one never saved needs nothing.
        assert_eq!(plan_keep("a1", false, Some(draft("a1", "d1")), true), Keep::Drop(Some(draft("a1", "d1"))));
        assert_eq!(plan_keep("a1", false, None, false), Keep::Drop(None));
    }

    #[test]
    fn send_later_is_a_draft_with_its_moment() {
        let now = chrono::Utc::now();
        let at = now + chrono::Duration::hours(20);
        let request = schedule_request("a1", &full(), Some(draft("a1", "d1")), false, at);
        assert_eq!(request.path, "/api/mail/accounts/a1/scheduled");
        assert_eq!(schema::schedule(&request.body, now), Ok(()));
        assert_eq!(request.body["draftId"], "d1");
        assert_eq!(request.then_delete, None);
        // As `Date.toISOString()`: milliseconds and Z.
        let fixed = chrono::DateTime::parse_from_rfc3339("2026-11-14T08:00:00+01:00").unwrap().with_timezone(&chrono::Utc);
        assert_eq!(super::moment(fixed), "2026-11-14T07:00:00.000Z");
        // From another mailbox, or never saved: a new draft here (`draftId: null`).
        let request = schedule_request("a2", &full(), Some(draft("a1", "d1")), false, at);
        assert!(request.body["draftId"].is_null());
        assert_eq!(request.then_delete, Some(draft("a1", "d1")));
        assert_eq!(schema::schedule(&request.body, now), Ok(()));
        let request = schedule_request("a1", &full(), None, true, at);
        assert!(request.body["draftId"].is_null() && request.then_delete.is_none());
        // A moment that passed is refused, as the API does.
        let late = schedule_request("a1", &full(), None, true, now - chrono::Duration::hours(1));
        assert!(schema::schedule(&late.body, now).is_err());
    }

    #[test]
    fn an_answer_is_what_the_reply_route_takes() {
        let to = [address(Some("Jan de Vries"), "jan@even.nl")];
        let cc = [address(None, "kees@even.nl")];
        let body = reply_body("m1", &to, &cc, &full());
        assert_eq!(schema::reply(&body), Ok(()));
        // The message answered, its people as shown, and no subject, blind
        // copies or reply headers: the API takes those from the message itself.
        assert_eq!(body["messageId"], "m1");
        assert_eq!(body["to"], json!([{ "name": "Jan de Vries", "email": "jan@even.nl" }]));
        assert_eq!(body["cc"], json!([{ "name": null, "email": "kees@even.nl" }]));
        assert_eq!(body["attachments"][0]["uploadId"], "3f2b6c1e-8a4d-4c57-9b1a-0d2e4f6a8c10");
        assert_eq!(body["inline"][0]["contentId"], "1x2y.9a@evido");
        for key in ["subject", "bcc", "reply", "draftId"] {
            assert!(body.get(key).is_none(), "{key}");
        }
        // Plain: html and inline are left out.
        let plain = Outgoing {
            text: "Fine".into(),
            ..Default::default()
        };
        let body = reply_body("m1", &to, &[], &plain);
        assert_eq!(schema::reply(&body), Ok(()));
        assert_eq!(
            body,
            json!({ "messageId": "m1", "to": [{ "name": "Jan de Vries", "email": "jan@even.nl" }], "cc": [], "text": "Fine", "attachments": [] })
        );
        // The API refuses an answer without text or without anyone to answer.
        assert!(schema::reply(&reply_body("m1", &to, &[], &Outgoing::default())).is_err());
        assert!(schema::reply(&reply_body("m1", &[], &[], &plain)).is_err());
    }

    #[test]
    fn a_forward_is_what_the_forward_route_takes() {
        let to = [address(None, "sanne@even.nl")];
        let body = forward_body("m1", &to, &full());
        assert_eq!(schema::forward(&body), Ok(()));
        assert_eq!(body["cc"], json!([]));
        assert_eq!(body["inline"][0]["contentId"], "1x2y.9a@evido");
        // The message's own files go along at the server: none are named here.
        assert!(body.get("attachments").is_none());
        // A note is optional.
        let body = forward_body("m1", &to, &Outgoing::default());
        assert_eq!(schema::forward(&body), Ok(()));
        assert_eq!(body, json!({ "messageId": "m1", "to": [{ "name": null, "email": "sanne@even.nl" }], "cc": [], "text": "" }));
    }

    #[test]
    fn an_upload_names_its_file() {
        let body = upload_body("a.pdf", "application/pdf", 12);
        assert_eq!(schema::upload(&body), Ok(()));
        assert_eq!(body, json!({ "name": "a.pdf", "contentType": "application/pdf", "size": 12 }));
        assert_eq!(upload_body("x", "", 0)["contentType"], "application/octet-stream");
        assert!(schema::upload(&upload_body("big", "", 26 * 1024 * 1024)).is_err());
    }

    #[test]
    fn pictures_from_the_editor_are_what_the_api_takes() {
        // A data: picture in the editor's HTML becomes an inline file with an id the API accepts.
        let html = r#"<p>Hi</p><img src="data:image/png;base64,iVBORw0KGgo=">"#;
        let (html, pictures) = crate::editor::to_inline_images(html);
        let message = Outgoing {
            to: vec![address(None, "jan@even.nl")],
            text: "Hi".into(),
            html: html.clone(),
            inline: pictures.iter().map(InlineUpload::of).collect(),
            ..Default::default()
        };
        assert_eq!(schema::send(&send_body(&message)), Ok(()));
        let id = &message.inline[0].content_id;
        assert!(html.contains(&format!(r#"src="cid:{id}""#)) && !html.contains("data:"));
        assert_eq!(message.inline[0].data, "iVBORw0KGgo=");
        // And back, for a draft opened again.
        let back = crate::editor::from_inline_images(&html, &pictures);
        assert!(back.contains("data:image/png;base64,iVBORw0KGgo="));
    }

    #[test]
    fn files_and_pictures_stay_out_of_the_key() {
        let mut message = Outgoing::default();
        let key = message.key("a1");
        message.attachments.push(AttachmentRef {
            upload_id: "u1".into(),
            name: "a".into(),
            content_type: String::new(),
            size: 1,
        });
        assert_eq!(message.key("a1"), key);
        assert_ne!(message.key("a2"), key);
        message.subject = "Hi".into();
        assert_ne!(message.key("a1"), key);
        assert_ne!(message.files_key(), Outgoing::default().files_key());
    }

    #[test]
    fn reads_an_opened_draft() {
        let json = r#"{"id":"d1","to":[{"name":"Jan","email":"jan@even.nl"}],"cc":[],"bcc":[],"subject":"Hi",
            "text":"Hello","html":"<p>Hello</p>","attachments":[{"uploadId":"u1","name":"a.pdf","contentType":"application/pdf","size":3}],
            "inline":[{"contentId":"x@evido","name":"i.png","contentType":"image/png","data":"AAAA"}],
            "reply":{"threadId":"t1","inReplyTo":"<m@x>"}}"#;
        let draft: DraftOpened = serde_json::from_str(json).unwrap();
        assert_eq!(draft.to[0].email, "jan@even.nl");
        assert_eq!(draft.attachments[0].upload_id, "u1");
        assert_eq!(draft.inline[0].content_id, "x@evido");
        let message = Outgoing {
            reply: draft.reply,
            ..Default::default()
        };
        assert_eq!(message.reply_thread(), Some("t1"));
        // A plain text draft has no HTML, files or pictures.
        let plain: DraftOpened = serde_json::from_str(r#"{"id":"d2","subject":"","text":"x"}"#).unwrap();
        assert!(plain.html.is_none() && plain.attachments.is_empty());
    }
}
