//! A conversation made ready to read, off the UI thread, and the small formats it uses.

use std::sync::Arc;

use chrono::{Datelike, Local};

use crate::api::{Client, Message, ThreadDetail};
use crate::email::{self, Body, Part};

use super::*;

/// A conversation as the reader shows it, prepared off the UI thread:
/// sanitized, with its inline images in place.
pub(super) struct Conversation {
    pub(super) subject: String,
    pub(super) parts: Vec<Part>,
    pub(super) remote_images: bool,
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

/// Runs on the background executor: sanitizes each body and puts its `cid:` images in place.
pub(super) fn prepare(client: &Client, thread_id: &str, subject: String, detail: ThreadDetail) -> Conversation {
    let mut remote_images = false;
    let parts = detail
        .messages
        .iter()
        .map(|message| {
            let html = message.html.as_deref().filter(|html| !html.trim().is_empty());
            let body = match (html, message.text.as_deref()) {
                (Some(html), _) => {
                    let mut clean = email::sanitize(html);
                    clean = with_inline_images(client, thread_id, message, clean);
                    remote_images |= email::has_remote_images(&clean);
                    let paper = email::has_own_background(&clean);
                    Body::Html { html: clean, paper }
                }
                (None, Some(text)) => Body::Text(tidy(text)),
                (None, None) => Body::Text(String::new()),
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
                    .map(|a| format!("{} · {}", a.name, size(a.size)))
                    .collect(),
            }
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
        remote_images,
    }
}

fn with_inline_images(client: &Client, thread_id: &str, message: &Message, mut html: String) -> String {
    let wanted = message
        .inline
        .iter()
        .filter(|image| {
            SAFE_INLINE.contains(&image.content_type.to_ascii_lowercase().as_str())
                && image.size <= MAX_INLINE_BYTES
                && html.contains(&format!("cid:{}", image.content_id))
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
            html = html.replace(&format!("cid:{}", image.content_id), &url);
        }
    }
    html
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
