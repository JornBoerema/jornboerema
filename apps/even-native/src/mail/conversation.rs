//! A conversation made ready to read, off the UI thread: each message
//! sanitized, the earlier mail it quotes split off, its inline images in place.

use std::sync::Arc;

use crate::api::{Address, Attachment, Client, Message, ThreadDetail, Unsubscribe};
use crate::email::{self, Body};
use crate::quote;

use super::*;

/// A conversation as the reader shows it.
pub(super) struct Conversation {
    /// The first message's subject, or else the list's (`messages[0]?.subject || summary.subject`).
    pub(super) subject: String,
    /// Oldest first, as the API gives them.
    pub(super) parts: Vec<Part>,
    /// Some message asks for images from elsewhere.
    pub(super) remote_images: bool,
    /// The newest message: what R and A answer.
    pub(super) last: Option<ReplyTarget>,
}

/// One message, ready for the page (`SanitizedMessage`).
pub(super) struct Part {
    pub(super) message_id: String,
    pub(super) from: Option<Address>,
    pub(super) to: Vec<Address>,
    pub(super) cc: Vec<Address>,
    pub(super) received_at: DateTime<Utc>,
    /// The start of its text, for the line of a folded message.
    pub(super) preview: String,
    pub(super) body: Body,
    /// There is something to translate.
    pub(super) translatable: bool,
    pub(super) unsubscribe: Option<Unsubscribe>,
    pub(super) attachments: Vec<Attachment>,
}

/// What an answer needs from the message it answers.
pub(super) struct ReplyTarget {
    pub(super) message_id: String,
    pub(super) from: Option<Address>,
    pub(super) reply_to: Vec<Address>,
    pub(super) to: Vec<Address>,
    pub(super) cc: Vec<Address>,
}

pub(super) enum Reading {
    Loading,
    Ready(Arc<Conversation>),
    Failed(SharedString),
}

/// Images inside the mail: the kinds browsers show safely, and not too many or too big.
const SAFE_INLINE: [&str; 5] = ["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"];
const MAX_INLINE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_INLINE_IMAGES: usize = 20;
/// How much of a folded message's text its line shows (`text.slice(0, 160)`).
const PREVIEW: usize = 160;

/// Runs on the background executor: sanitizes each body, splits off the quote of
/// earlier mail and puts its `cid:` images in place.
pub(super) fn prepare(client: &Client, thread_id: &str, subject: String, detail: ThreadDetail) -> Conversation {
    let last = detail.messages.last().map(|message| ReplyTarget {
        message_id: message.id.clone(),
        from: message.from.clone(),
        reply_to: message.reply_to.clone(),
        to: message.to.clone(),
        cc: message.cc.clone(),
    });
    let subject = detail
        .messages
        .first()
        .map(|message| message.subject.clone())
        .filter(|subject| !subject.is_empty())
        .unwrap_or(subject);
    let mut remote_images = false;
    let parts = detail
        .messages
        .into_iter()
        .enumerate()
        .map(|(index, message)| {
            // The first message quotes nothing in this thread, as in the web app.
            let quoted = index > 0;
            let html = message.html.as_deref().filter(|html| !html.is_empty());
            let text = message.text.as_deref().filter(|text| !text.is_empty());
            let body = match (html, text) {
                (Some(html), _) => {
                    // Split before sanitizing, which drops the ids Outlook marks its quote with;
                    // then each half is sanitized on its own.
                    let clean = |html: &str| email::scope_styles(&email::sanitize(html));
                    let mut pieces = match quoted.then(|| quote::split_html(html)).flatten() {
                        Some((reply, quote)) => vec![clean(&reply), clean(&quote)],
                        None => vec![clean(html)],
                    };
                    pieces = with_inline_images(client, thread_id, &message, pieces);
                    remote_images |= pieces.iter().any(|piece| email::has_remote_images(piece));
                    // As shown first, without the quote: designed mail keeps its paper.
                    let paper = pieces.first().is_some_and(|piece| email::has_own_background(piece));
                    let mut pieces = pieces.into_iter();
                    Body::Html {
                        html: pieces.next().unwrap_or_default(),
                        quote: pieces.next(),
                        paper,
                    }
                }
                (None, Some(text)) => Body::Text(text.to_string()),
                (None, None) => Body::Empty,
            };
            Part {
                preview: text.map(|text| text.chars().take(PREVIEW).collect()).unwrap_or_default(),
                translatable: text.is_some_and(|text| !text.trim().is_empty()) || html.is_some(),
                body,
                message_id: message.id,
                from: message.from,
                to: message.to,
                cc: message.cc,
                received_at: message.received_at,
                unsubscribe: message.unsubscribe,
                attachments: message.attachments,
            }
        })
        .collect();
    Conversation {
        subject,
        parts,
        remote_images,
        last,
    }
}

/// The reply and its quote are separate pieces; an image either refers to is fetched once.
fn with_inline_images(client: &Client, thread_id: &str, message: &Message, mut pieces: Vec<String>) -> Vec<String> {
    let wanted = message
        .inline
        .iter()
        .filter(|image| {
            let cid = format!("cid:{}", image.content_id);
            SAFE_INLINE.contains(&image.content_type.to_ascii_lowercase().as_str())
                && image.size <= MAX_INLINE_BYTES
                && pieces.iter().any(|html| html.contains(&cid))
        })
        .take(MAX_INLINE_IMAGES)
        .collect::<Vec<_>>();
    for image in wanted {
        if let Ok(bytes) = client.attachment(thread_id, &message.id, &image.id) {
            let url = format!(
                "data:{};base64,{}",
                image.content_type.to_ascii_lowercase(),
                base64::engine::general_purpose::STANDARD.encode(bytes)
            );
            let cid = format!("cid:{}", image.content_id);
            for html in &mut pieces {
                *html = html.replace(&cid, &url);
            }
        }
    }
    pieces
}

pub(super) fn random_nonce() -> String {
    use rand::RngCore as _;
    let mut bytes = [0u8; 18];
    rand::thread_rng().fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// "12 KB", "3.4 MB" (`formatSize` in pages/conversation.tsx).
pub(super) fn size(bytes: u64) -> String {
    const MB: u64 = 1024 * 1024;
    if bytes < MB {
        format!("{} KB", bytes.div_ceil(1024))
    } else {
        format!("{:.1} MB", bytes as f64 / MB as f64)
    }
}

#[cfg(test)]
mod tests {
    use super::size;

    #[test]
    fn sizes_read_as_on_the_web() {
        assert_eq!(size(512), "1 KB");
        assert_eq!(size(2_400), "3 KB");
        assert_eq!(size(3_565_158), "3.4 MB");
    }
}
