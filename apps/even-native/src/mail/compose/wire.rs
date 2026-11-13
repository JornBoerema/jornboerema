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

fn encode(segment: &str) -> String {
    url::form_urlencoded::byte_serialize(segment.as_bytes()).collect()
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
    let mut body = content.json();
    body["draftId"] = json!(draft);
    body["attachmentsChanged"] = json!(attachments_changed);
    let answer: Answer = client.post_json(&format!("/api/mail/accounts/{}/drafts", encode(account)), &body)?;
    Ok(answer.draft_id)
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
    if !worth_keeping {
        if let Some(previous) = &previous {
            delete_draft(client, previous)?;
        }
        return Ok(None);
    }
    // A draft lives in one mailbox, so switching the sender moves it.
    let target = previous.as_ref().filter(|draft| draft.account == account);
    let id = save_draft(
        client,
        account,
        content,
        target.map(|draft| draft.id.as_str()),
        target.is_none() || files_changed,
    )?;
    if let (Some(previous), None) = (&previous, target) {
        let _ = delete_draft(client, previous);
    }
    Ok(Some(DraftRef {
        account: account.to_string(),
        id,
    }))
}

/// Sends the message. A saved draft is sent as itself, so it leaves the
/// drafts folder at the provider too.
pub(super) fn send(
    client: &Client,
    account: &str,
    content: &Outgoing,
    draft: Option<DraftRef>,
    attachments_changed: bool,
) -> Result<()> {
    match draft {
        Some(draft) if draft.account == account => {
            let mut body = content.json();
            body["draftId"] = json!(draft.id);
            body["attachmentsChanged"] = json!(attachments_changed);
            done(client.post_json(&format!("{}/send", draft_path(&draft)), &body))
        }
        other => {
            let mut body = content.json();
            // A new message is no reply, also when the draft it started as was.
            if let Some(fields) = body.as_object_mut() {
                fields.remove("reply");
            }
            done(client.post_json(&format!("/api/mail/accounts/{}/send", encode(account)), &body))?;
            if let Some(draft) = other {
                let _ = delete_draft(client, &draft);
            }
            Ok(())
        }
    }
}

/// Send later: saved as the draft it already is, so it leaves the drafts for
/// Scheduled until its moment.
pub(super) fn schedule(
    client: &Client,
    account: &str,
    content: &Outgoing,
    draft: Option<DraftRef>,
    attachments_changed: bool,
    at: DateTime<Utc>,
) -> Result<()> {
    let mut body = content.json();
    body["draftId"] = json!(draft.as_ref().filter(|draft| draft.account == account).map(|draft| &draft.id));
    body["attachmentsChanged"] = json!(attachments_changed);
    body["sendAt"] = json!(at.to_rfc3339_opts(chrono::SecondsFormat::Millis, true));
    done(client.post_json(&format!("/api/mail/accounts/{}/scheduled", encode(account)), &body))?;
    if let Some(draft) = draft.filter(|draft| draft.account != account) {
        let _ = delete_draft(client, &draft);
    }
    Ok(())
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
    done(client.post_json(&conversation_path(thread, "/reply"), &body))
}

/// Sends `message` on, its files included, under a note (`MailForward`).
pub(super) fn forward(client: &Client, thread: &str, message: &str, to: &[Address], content: &Outgoing) -> Result<()> {
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
    done(client.post_json(&conversation_path(thread, "/forward"), &body))
}

/// Starts an upload and says its id (`uploadFile` in lib/uploads.ts).
pub(super) fn create_upload(client: &Client, name: &str, content_type: &str, size: u64) -> Result<String> {
    #[derive(Deserialize)]
    struct Answer {
        id: String,
    }
    let answer: Answer = client.post_json(
        "/api/mail/uploads",
        &json!({ "name": name, "contentType": content_type, "size": size }),
    )?;
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
