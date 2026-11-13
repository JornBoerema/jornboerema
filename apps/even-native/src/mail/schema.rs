//! What the API accepts, for the tests: the zod schemas of
//! apps/api/src/mail/routes.ts written out by hand, each next to the name it
//! has there. A body the app builds is held against these, so a field that
//! is misnamed, missing or of the wrong kind fails a test instead of a mail.
//!
//! Stricter than zod in one way, on purpose: a key the schema doesn't know is
//! an error here. Zod drops it silently, which is how a misspelt field (a
//! reply that loses its `inReplyTo`) would go unnoticed.

use std::sync::LazyLock;

use regex::Regex;
use serde_json::{Map, Value};

pub(crate) type Check = Result<(), String>;

const MAX_UPLOAD_BYTES: f64 = 3. * 1024. * 1024.;
const MAX_ATTACHMENTS_BYTES: u64 = 25 * 1024 * 1024;
/// `NAV_ITEMS` in packages/mail-core/src/sidebar.ts.
const NAV_ITEMS: [&str; 12] = [
    "inbox", "starred", "parcels", "invoices", "snoozed", "drafts", "scheduled", "sent", "senders", "archive", "spam",
    "trash",
];
/// `MAIL_THREAD_ACTIONS` in packages/mail-core/src/types.ts.
const ACTIONS: [&str; 9] = ["read", "unread", "archive", "trash", "star", "unstar", "inbox", "spam", "delete"];
/// The keys of `preferencesBody`, apart from `sidebar`.
pub(crate) const PREFERENCES: [&str; 11] = [
    "summaries",
    "codes",
    "aiWriting",
    "remoteImages",
    "parcels",
    "unsubscribe",
    "senders",
    "invoices",
    "todos",
    "pins",
    "replySuggestions",
];

static UUID: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$").unwrap()
});
/// `INLINE_CONTENT_ID`.
static CONTENT_ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z0-9._-]{1,100}@[A-Za-z0-9.-]{1,100}$").unwrap());
static IMAGE_TYPE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^image/[\w.+-]+$").unwrap());
/// `z.base64()`.
static BASE64: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(?:[0-9a-zA-Z+/]{4})*(?:[0-9a-zA-Z+/]{2}==|[0-9a-zA-Z+/]{3}=)?$").unwrap()
});
/// `z.email()`, without its look-aheads (checked by hand below).
static EMAIL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z0-9_'+\-.]*[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$").unwrap());
/// `z.iso.datetime({ offset: true })`.
static MOMENT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$").unwrap()
});

fn fail<T>(what: impl Into<String>) -> Result<T, String> {
    Err(what.into())
}

/// An object with no other keys than these.
fn object<'a>(value: &'a Value, keys: &[&str]) -> Result<&'a Map<String, Value>, String> {
    let Some(map) = value.as_object() else {
        return fail(format!("not an object: {value}"));
    };
    match map.keys().find(|key| !keys.contains(&key.as_str())) {
        Some(unknown) => fail(format!("a key the API doesn't read: {unknown}")),
        None => Ok(map),
    }
}

/// A string of `min..=max` characters. A missing key is `Err`: say `optional` for those.
fn string(map: &Map<String, Value>, key: &str, min: usize, max: usize) -> Result<String, String> {
    match map.get(key) {
        Some(Value::String(text)) if (min..=max).contains(&text.chars().count()) => Ok(text.clone()),
        Some(other) => fail(format!("{key}: not a string of {min} to {max}: {other}")),
        None => fail(format!("{key} is missing")),
    }
}

/// `.optional()`: absent, never null.
fn optional(map: &Map<String, Value>, key: &str, max: usize) -> Check {
    if map.contains_key(key) {
        string(map, key, 0, max)?;
    }
    Ok(())
}

fn boolean(map: &Map<String, Value>, key: &str) -> Check {
    match map.get(key) {
        Some(Value::Bool(_)) => Ok(()),
        other => fail(format!("{key}: not a boolean: {other:?}")),
    }
}

fn list<'a>(map: &'a Map<String, Value>, key: &str, max: usize) -> Result<&'a Vec<Value>, String> {
    match map.get(key) {
        Some(Value::Array(items)) if items.len() <= max => Ok(items),
        other => fail(format!("{key}: not a list of at most {max}: {other:?}")),
    }
}

fn email(value: &str) -> Check {
    let fine = value.chars().count() <= 320 && !value.starts_with('.') && !value.contains("..") && EMAIL.is_match(value);
    if fine {
        Ok(())
    } else {
        fail(format!("not an address the API takes: {value}"))
    }
}

/// `address`: the name is there, as a string or null.
fn address(value: &Value) -> Check {
    let map = object(value, &["name", "email"])?;
    match map.get("name") {
        Some(Value::Null) => {}
        Some(Value::String(name)) if name.chars().count() <= 200 => {}
        other => return fail(format!("name: {other:?}")),
    }
    email(&string(map, "email", 1, 320)?)
}

/// `recipients`, with at least `min` of them.
fn recipients(map: &Map<String, Value>, key: &str, min: usize) -> Result<usize, String> {
    let items = list(map, key, 100)?;
    if items.len() < min {
        return fail(format!("{key}: fewer than {min}"));
    }
    items.iter().try_for_each(address)?;
    Ok(items.len())
}

/// `attachments`: uploaded files by id; `[]` when left out.
fn attachments(map: &Map<String, Value>) -> Result<u64, String> {
    if !map.contains_key("attachments") {
        return Ok(0);
    }
    let mut total = 0;
    for file in list(map, "attachments", 20)? {
        let file = object(file, &["uploadId", "name", "contentType", "size"])?;
        if !UUID.is_match(&string(file, "uploadId", 1, 100)?) {
            return fail("uploadId: not a uuid");
        }
        string(file, "name", 1, 255)?;
        string(file, "contentType", 0, 200)?;
        match file.get("size").and_then(Value::as_u64) {
            Some(size) if size <= MAX_ATTACHMENTS_BYTES => total += size,
            other => return fail(format!("size: {other:?}")),
        }
    }
    Ok(total)
}

/// `inline`: pictures in the request itself; absent when there are none.
fn inline(map: &Map<String, Value>) -> Result<usize, String> {
    if !map.contains_key("inline") {
        return Ok(0);
    }
    let mut length = 0;
    for image in list(map, "inline", 50)? {
        let image = object(image, &["contentId", "name", "contentType", "data"])?;
        if !CONTENT_ID.is_match(&string(image, "contentId", 1, 300)?) {
            return fail("contentId: not as INLINE_CONTENT_ID");
        }
        string(image, "name", 1, 255)?;
        if !IMAGE_TYPE.is_match(&string(image, "contentType", 1, 200)?) {
            return fail("contentType: not an image");
        }
        let data = string(image, "data", 0, usize::MAX)?;
        if !BASE64.is_match(&data) {
            return fail("data: not base64");
        }
        length += data.len();
    }
    Ok(length)
}

/// `fitsUpload`.
fn fits_upload(map: &Map<String, Value>) -> Check {
    if inline(map)? as f64 * 0.75 > MAX_UPLOAD_BYTES {
        return fail("the pictures are too large together");
    }
    if attachments(map)? > MAX_ATTACHMENTS_BYTES {
        return fail("the files are too large together");
    }
    Ok(())
}

const SEND_FIELDS: [&str; 8] = ["to", "cc", "bcc", "subject", "text", "html", "attachments", "inline"];

/// `sendFields`, and how many recipients it names.
fn send_fields(map: &Map<String, Value>) -> Result<usize, String> {
    let count = recipients(map, "to", 0)? + recipients(map, "cc", 0)? + recipients(map, "bcc", 0)?;
    string(map, "subject", 0, 900)?;
    string(map, "text", 0, 100_000)?;
    optional(map, "html", 500_000)?;
    fits_upload(map)?;
    Ok(count)
}

fn someone(count: usize) -> Check {
    if count == 0 {
        fail("nobody to send it to")
    } else {
        Ok(())
    }
}

/// POST /accounts/:id/send (`sendBody`).
pub(crate) fn send(body: &Value) -> Check {
    someone(send_fields(object(body, &SEND_FIELDS)?)?)
}

/// `draftBody`, and how many recipients it names.
fn draft_fields(body: &Value, more: &[&str]) -> Result<usize, String> {
    let keys: Vec<&str> = SEND_FIELDS.into_iter().chain(["draftId", "attachmentsChanged", "reply"]).chain(more.iter().copied()).collect();
    let map = object(body, &keys)?;
    let count = send_fields(map)?;
    // `providerId.nullable()`: the key is there, null for a new draft.
    match map.get("draftId") {
        Some(Value::Null) => {}
        Some(Value::String(id)) if (1..=1000).contains(&id.chars().count()) => {}
        other => return fail(format!("draftId: {other:?}")),
    }
    boolean(map, "attachmentsChanged")?;
    if let Some(reply) = map.get("reply") {
        let reply = object(reply, &["threadId", "inReplyTo", "references"])?;
        string(reply, "threadId", 1, 1000)?;
        optional(reply, "inReplyTo", 2000)?;
        optional(reply, "references", 20_000)?;
    }
    Ok(count)
}

/// POST /accounts/:id/drafts: `draftBody`, and worth keeping (`isDraftWorthKeeping`).
pub(crate) fn save_draft(body: &Value) -> Check {
    draft_fields(body, &[])?;
    let filled = |key: &str| body[key].as_str().is_some_and(|text| !text.trim().is_empty());
    if filled("subject") || filled("text") {
        Ok(())
    } else {
        fail("not worth keeping: no subject and no text")
    }
}

/// POST /accounts/:id/drafts/:draftId/send.
pub(crate) fn send_draft(body: &Value) -> Check {
    someone(draft_fields(body, &[])?)
}

/// `moment`: with its offset, ahead of `now`, within two years.
fn moment(value: Option<&Value>, now: chrono::DateTime<chrono::Utc>) -> Check {
    let Some(text) = value.and_then(Value::as_str).filter(|text| MOMENT.is_match(text)) else {
        return fail(format!("not a moment with an offset: {value:?}"));
    };
    let at = chrono::DateTime::parse_from_rfc3339(text).map_err(|error| error.to_string())?;
    let ahead = at.signed_duration_since(now);
    if ahead > chrono::Duration::seconds(-60) && ahead < chrono::Duration::days(2 * 365) {
        Ok(())
    } else {
        fail("the moment doesn't lie ahead")
    }
}

/// POST /accounts/:id/scheduled (`draftBody` with `sendAt`).
pub(crate) fn schedule(body: &Value, now: chrono::DateTime<chrono::Utc>) -> Check {
    someone(draft_fields(body, &["sendAt"])?)?;
    moment(body.get("sendAt"), now)
}

/// POST /threads/:id/reply (`replyBody`).
pub(crate) fn reply(body: &Value) -> Check {
    let map = object(body, &["messageId", "to", "cc", "text", "html", "attachments", "inline"])?;
    string(map, "messageId", 1, 1000)?;
    recipients(map, "to", 1)?;
    recipients(map, "cc", 0)?;
    string(map, "text", 1, 100_000)?;
    optional(map, "html", 500_000)?;
    fits_upload(map)
}

/// POST /threads/:id/forward (`forwardBody`): no files of its own.
pub(crate) fn forward(body: &Value) -> Check {
    let map = object(body, &["messageId", "to", "cc", "text", "html", "inline"])?;
    string(map, "messageId", 1, 1000)?;
    recipients(map, "to", 1)?;
    recipients(map, "cc", 0)?;
    string(map, "text", 0, 100_000)?;
    optional(map, "html", 500_000)?;
    fits_upload(map)
}

/// POST /uploads (`uploadBody`).
pub(crate) fn upload(body: &Value) -> Check {
    let map = object(body, &["name", "contentType", "size"])?;
    string(map, "name", 1, 255)?;
    string(map, "contentType", 0, 200)?;
    match map.get("size").and_then(Value::as_u64) {
        Some(size) if size <= MAX_ATTACHMENTS_BYTES => Ok(()),
        other => fail(format!("size: {other:?}")),
    }
}

/// POST /threads/:id/actions (`actionBody`).
pub(crate) fn action(body: &Value) -> Check {
    let action = string(object(body, &["action"])?, "action", 1, 20)?;
    if ACTIONS.contains(&action.as_str()) {
        Ok(())
    } else {
        fail(format!("not an action: {action}"))
    }
}

/// POST /threads/:id/snooze (`snoozeBody`).
pub(crate) fn snooze(body: &Value, now: chrono::DateTime<chrono::Utc>) -> Check {
    moment(object(body, &["until"])?.get("until"), now)
}

/// POST /threads/:id/pin (`pinBody`).
pub(crate) fn pin(body: &Value) -> Check {
    boolean(object(body, &["pinned"])?, "pinned")
}

/// POST /senders/action (`senderBody`).
pub(crate) fn sender(body: &Value) -> Check {
    let map = object(body, &["email", "action", "account"])?;
    email(&string(map, "email", 1, 320)?)?;
    if !["archive", "read", "trash"].contains(&string(map, "action", 1, 20)?.as_str()) {
        return fail("action: not archive, read or trash");
    }
    if map.contains_key("account") {
        string(map, "account", 1, 100)?;
    }
    Ok(())
}

/// POST /threads/:id/unsubscribe (`unsubscribeBody`).
pub(crate) fn unsubscribe(body: &Value) -> Check {
    string(object(body, &["messageId"])?, "messageId", 1, 1000).map(|_| ())
}

/// PATCH /preferences (`preferencesBody`): any of them, at least one.
pub(crate) fn preferences(body: &Value) -> Check {
    let keys: Vec<&str> = PREFERENCES.into_iter().chain(["sidebar"]).collect();
    let map = object(body, &keys)?;
    if map.is_empty() {
        return fail("no change");
    }
    for key in PREFERENCES.into_iter().filter(|key| map.contains_key(*key)) {
        boolean(map, key)?;
    }
    match map.get("sidebar") {
        None | Some(Value::Null) => Ok(()),
        Some(sidebar) => {
            let sidebar = object(sidebar, &["main", "more", "hidden"])?;
            for section in ["main", "more", "hidden"] {
                for place in list(sidebar, section, 20)? {
                    if !place.as_str().is_some_and(|place| NAV_ITEMS.contains(&place)) {
                        return fail(format!("{section}: not a place: {place}"));
                    }
                }
            }
            Ok(())
        }
    }
}

/// POST /threads/:id/todo (`todoBody`).
pub(crate) fn todo(body: &Value) -> Check {
    let map = object(body, &["listId", "title"])?;
    if !UUID.is_match(&string(map, "listId", 1, 100)?) {
        return fail("listId: not a uuid");
    }
    match string(map, "title", 1, 500)?.trim().is_empty() {
        true => fail("title: empty"),
        false => Ok(()),
    }
}

/// POST /threads/:id/recognition/report (`reportBody`).
pub(crate) fn report(body: &Value) -> Check {
    let map = object(body, &["kind", "reason"])?;
    let (kind, reason) = (string(map, "kind", 1, 20)?, string(map, "reason", 1, 20)?);
    if ["parcel", "invoice"].contains(&kind.as_str()) && ["not_one", "amount", "status", "other"].contains(&reason.as_str()) {
        Ok(())
    } else {
        fail(format!("not a report: {kind}, {reason}"))
    }
}

/// POST /write and /threads/:id/write (`writeBody`).
pub(crate) fn write(body: &Value) -> Check {
    let map = object(body, &["instruction", "draft", "subject", "hasSignature", "forward"])?;
    if string(map, "instruction", 1, 2000)?.trim().is_empty() {
        return fail("instruction: empty");
    }
    optional(map, "draft", 20_000)?;
    optional(map, "subject", 500)?;
    for key in ["hasSignature", "forward"] {
        if map.contains_key(key) {
            boolean(map, key)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    /// The checker itself: it takes what the web sends and refuses what zod refuses.
    #[test]
    fn the_schemas_refuse_what_the_api_refuses() {
        let message = json!({
            "to": [{ "name": null, "email": "jan@even.nl" }], "cc": [], "bcc": [],
            "subject": "Hi", "text": "Hello", "attachments": [],
        });
        assert_eq!(send(&message), Ok(()));
        // A name left out, an html of null, a key nobody reads, nobody to send to.
        let mut wrong = message.clone();
        wrong["to"] = json!([{ "email": "jan@even.nl" }]);
        assert!(send(&wrong).is_err());
        let mut wrong = message.clone();
        wrong["html"] = Value::Null;
        assert!(send(&wrong).is_err());
        let mut wrong = message.clone();
        wrong["draftId"] = Value::Null;
        assert!(send(&wrong).is_err());
        let mut wrong = message.clone();
        wrong["to"] = json!([]);
        assert!(send(&wrong).is_err());
        // A draft needs its two fields; a reply's thread is named.
        assert!(send_draft(&message).is_err());
        let mut draft = message.clone();
        draft["draftId"] = Value::Null;
        draft["attachmentsChanged"] = json!(true);
        assert_eq!(save_draft(&draft), Ok(()));
        draft["reply"] = json!({ "inReplyTo": "<m@x>" });
        assert!(save_draft(&draft).is_err());
        assert!(email("a@b").is_err() && email(".a@b.nl").is_err() && email("a@b.nl").is_ok());
        assert!(action(&json!({ "action": "snooze" })).is_err());
        assert!(pin(&json!({ "pinned": "yes" })).is_err());
    }
}
