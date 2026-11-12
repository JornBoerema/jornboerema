//! A conversation made ready to read, off the UI thread, and the small formats it uses.

use std::sync::Arc;

use chrono::{Datelike, Local};

use crate::api::{Address, Attachment, Client, Message, ThreadDetail};
use crate::email::{self, Body, File, Part};
use crate::quote;

use super::*;

/// A conversation as the reader shows it, prepared off the UI thread:
/// sanitized, with its inline images in place.
pub(super) struct Conversation {
    pub(super) subject: String,
    pub(super) parts: Vec<Part>,
    /// Per part, what its attachment chips download.
    pub(super) files: Vec<Files>,
    pub(super) remote_images: bool,
    /// The newest message: what R and A answer.
    pub(super) last: Option<ReplyTarget>,
}

/// What an answer needs from the message it answers.
pub(super) struct ReplyTarget {
    pub(super) message_id: String,
    pub(super) from: Option<Address>,
    pub(super) reply_to: Vec<Address>,
    pub(super) to: Vec<Address>,
    pub(super) cc: Vec<Address>,
}

pub(super) struct Files {
    pub(super) message_id: String,
    pub(super) attachments: Vec<Attachment>,
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
    let mut remote_images = false;
    let parts = detail
        .messages
        .iter()
        .enumerate()
        .map(|(index, message)| {
            // The first message quotes nothing in this thread, as in the web app.
            let quoted = index > 0;
            let html = message.html.as_deref().filter(|html| !html.trim().is_empty());
            let body = match (html, message.text.as_deref()) {
                (Some(html), _) => {
                    // Split before sanitizing, which drops the ids Outlook marks its quote with;
                    // then each half is sanitized on its own.
                    let mut pieces = match quoted.then(|| quote::split_html(html)).flatten() {
                        Some((reply, quote)) => vec![email::sanitize(&reply), email::sanitize(&quote)],
                        None => vec![email::sanitize(html)],
                    };
                    pieces = with_inline_images(client, thread_id, message, pieces);
                    remote_images |= pieces.iter().any(|piece| email::has_remote_images(piece));
                    let paper = pieces.iter().any(|piece| email::has_own_background(piece));
                    let mut pieces = pieces.into_iter();
                    Body::Html {
                        html: pieces.next().unwrap_or_default(),
                        quote: pieces.next(),
                        paper,
                    }
                }
                (None, Some(text)) => {
                    let text = tidy(text);
                    match quoted.then(|| quote::split_text(&text)).flatten() {
                        Some((reply, quote)) => Body::Text {
                            text: reply,
                            quote: Some(quote),
                        },
                        None => Body::Text { text, quote: None },
                    }
                }
                (None, None) => Body::Text {
                    text: String::new(),
                    quote: None,
                },
            };
            let to: Vec<&str> = message.to.iter().chain(&message.cc).map(|a| a.label()).collect();
            Part {
                from: message
                    .from
                    .as_ref()
                    .map(|a| a.label().to_string())
                    .unwrap_or_else(|| "Onbekend".into()),
                to: if to.is_empty() {
                    String::new()
                } else {
                    format!("Aan {}", to.join(", "))
                },
                date: long_date(message.received_at),
                body,
                attachments: message
                    .attachments
                    .iter()
                    .map(|a| File {
                        label: format!("{} · {}", a.name, size(a.size)),
                        downloadable: !a.id.is_empty(),
                    })
                    .collect(),
            }
        })
        .collect();
    let files = detail
        .messages
        .into_iter()
        .map(|message| Files {
            message_id: message.id,
            attachments: message.attachments,
        })
        .collect();
    let subject = if subject.is_empty() {
        "(geen onderwerp)".to_string()
    } else {
        subject
    };
    Conversation {
        subject,
        parts,
        files,
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

const MONTHS: [&str; 12] = [
    "jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec",
];

/// Today the time, this year day and month, before that the year too, as the web app does.
pub(super) fn short_date(at: chrono::DateTime<chrono::Utc>) -> String {
    let at = at.with_timezone(&Local);
    let now = Local::now();
    if at.date_naive() == now.date_naive() {
        at.format("%H:%M").to_string()
    } else if at.year() == now.year() {
        format!("{} {}", at.day(), MONTHS[at.month0() as usize])
    } else {
        format!("{} {} {}", at.day(), MONTHS[at.month0() as usize], at.year())
    }
}

pub(super) fn long_date(at: chrono::DateTime<chrono::Utc>) -> String {
    let at = at.with_timezone(&Local);
    format!(
        "{} {} {}, {}",
        at.day(),
        MONTHS[at.month0() as usize],
        at.year(),
        at.format("%H:%M")
    )
}

/// No more than one empty line in a row; newsletters stack them.
pub(super) fn tidy(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut blank = 0;
    for line in text.lines() {
        let line = line.trim_end();
        if line.is_empty() {
            blank += 1;
            if blank > 1 {
                continue;
            }
        } else {
            blank = 0;
        }
        out.push_str(line);
        out.push('\n');
    }
    out.trim().to_string()
}

pub(super) fn size(bytes: u64) -> String {
    match bytes {
        b if b >= 1_000_000 => format!("{:.1} MB", b as f64 / 1_000_000.),
        b if b >= 1_000 => format!("{} kB", b / 1_000),
        b => format!("{b} B"),
    }
}

#[cfg(test)]
mod tests {
    use super::{size, tidy};

    #[test]
    fn tidy_keeps_one_empty_line() {
        assert_eq!(tidy("a\n\n\n\nb  \n"), "a\n\nb");
    }

    #[test]
    fn sizes_read_well() {
        assert_eq!(size(512), "512 B");
        assert_eq!(size(2_400), "2 kB");
        assert_eq!(size(3_250_000), "3.2 MB");
    }
}
