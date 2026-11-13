//! Untrusted mail HTML, made safe to show: the same rules as the web app
//! (apps/mail-web/src/lib/email-html.ts), in one document per conversation.
//!
//! Three walls: ammonia removes scripts, handlers and forms; the policy in the
//! document blocks every script but ours and all remote loading unless images
//! are allowed; and links never navigate the view, they open in the browser.

use std::collections::HashSet;
use std::sync::LazyLock;

use regex::Regex;

/// A message, ready to place in the conversation document.
pub struct Part {
    pub from: String,
    pub to: String,
    pub date: String,
    pub body: Body,
    pub attachments: Vec<File>,
}

/// An attachment chip. Only ones the API gave an id can be downloaded.
pub struct File {
    pub label: String,
    pub downloadable: bool,
}

pub enum Body {
    /// Sanitized HTML; `paper` when the mail paints its own backgrounds.
    /// `quote` is the earlier mail it quotes, sanitized too, shown folded away.
    Html {
        html: String,
        quote: Option<String>,
        paper: bool,
    },
    Text {
        text: String,
        quote: Option<String>,
    },
}

fn sanitizer() -> ammonia::Builder<'static> {
    let mut builder = ammonia::Builder::default();
    builder
        .add_tags(["style", "font", "center"])
        .clean_content_tags(HashSet::from([
            "script", "noscript", "iframe", "object", "embed", "template",
        ]))
        .rm_tags(["form", "input", "button", "textarea", "select", "option"])
        .add_generic_attributes([
            "style",
            "class",
            "align",
            "valign",
            "bgcolor",
            "width",
            "height",
            "border",
            "cellpadding",
            "cellspacing",
            "color",
            "face",
            "size",
            "dir",
        ])
        .add_url_schemes(["cid", "data"])
        .link_rel(Some("noopener noreferrer"));
    builder
}

static SANITIZER: LazyLock<ammonia::Builder<'static>> = LazyLock::new(sanitizer);

pub fn sanitize(html: &str) -> String {
    SANITIZER.clean(html).to_string()
}

static REMOTE_IMAGE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?i)<img[^>]+src=["']?https?:|url\(\s*["']?https?:"#).unwrap());

pub fn has_remote_images(sanitized: &str) -> bool {
    REMOTE_IMAGE.is_match(sanitized)
}

static BGCOLOR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?i)\bbgcolor\s*=\s*["']?([^"'\s>]+)"#).unwrap());
static BACKGROUND: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?i)background(?:-color)?\s*:\s*([^;"'}]+)"#).unwrap());
static PLAIN_BACKGROUND: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(none|transparent|inherit|initial|unset|white|#fff|#ffffff|rgba?\(\s*255\s*,\s*255\s*,\s*255\s*(,\s*1(\.0*)?\s*)?\))$")
        .unwrap()
});

/// Whether the mail paints its own backgrounds (a newsletter, an invoice with
/// coloured blocks). Those keep their look on white paper; plain mail follows
/// the dark theme.
pub fn has_own_background(sanitized: &str) -> bool {
    if sanitized.to_ascii_lowercase().contains("background-image") {
        return true;
    }
    BGCOLOR
        .captures_iter(sanitized)
        .chain(BACKGROUND.captures_iter(sanitized))
        .map(|captures| captures[1].replace("!important", "").trim().to_string())
        .any(|value| !PLAIN_BACKGROUND.is_match(&value))
}

pub fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            c => out.push(c),
        }
    }
    out
}

static LINK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"https?://[^\s<>"']+[^\s<>"'.,;:!?)\]]"#).unwrap());

/// Plain text, escaped, with its web addresses made into links.
fn text_to_html(text: &str) -> String {
    let escaped = escape(text);
    LINK.replace_all(&escaped, |captures: &regex::Captures| {
        let url = &captures[0];
        format!(r#"<a href="{url}" rel="noopener noreferrer">{url}</a>"#)
    })
    .into_owned()
}

/// The app's own look around the mail. Each mail body sits in its own shadow
/// root, so its styles can't reach this, nor another message in the thread.
const STYLE: &str = r#"
:root{color-scheme:dark}
html,body{margin:0;background:#171717;color:#fafafa}
body{padding:4px 24px 40px;font:14px/1.5 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
h1.even-subject{font-size:20px;font-weight:600;line-height:1.3;margin:4px 0 16px}
section.even-message{border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:16px;margin:0 0 12px}
.even-head{display:flex;justify-content:space-between;gap:16px;margin-bottom:12px}
.even-from{font-weight:600}
.even-to,.even-date{font-size:12px;color:#a1a1a1}
.even-to{margin-top:2px}
.even-date{flex:none}
.even-body{overflow-x:auto;overflow-wrap:anywhere}
.even-text{white-space:pre-wrap;color:#e4e4e1}
.even-text a{color:#8fb3ff}
.even-paper{background:#fff;color:#111;border-radius:8px;padding:12px}
.even-plain{color:#e4e4e1}
.even-files{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.even-file{font:inherit;font-size:12px;color:#a1a1a1;background:#262626;border:0;border-radius:6px;padding:4px 8px}
button.even-file{cursor:pointer}
button.even-file:hover{color:#fafafa;background:#333}
details.even-quote>summary{display:inline-block;list-style:none;cursor:pointer;margin-top:8px;padding:0 6px;border-radius:4px;font-size:12px;line-height:16px;letter-spacing:1px;color:#a1a1a1;background:#262626}
details.even-quote>summary::-webkit-details-marker{display:none}
details.even-quote>summary:hover{color:#fafafa}
details.even-quote>.even-text{margin-top:8px;color:#a1a1a1}
"#;

/// The same look on the light theme's panel (`--sidebar`), after [`STYLE`].
const LIGHT_STYLE: &str = r#"
:root{color-scheme:light}
html,body{background:#fafafa;color:#0a0a0a}
section.even-message{border-color:#e5e5e5}
.even-to,.even-date{color:#737373}
.even-text,.even-plain{color:#0a0a0a}
.even-text a{color:#bb4d00}
.even-file{color:#737373;background:#f5f5f5}
button.even-file:hover{color:#0a0a0a;background:#e5e5e5}
details.even-quote>summary{color:#737373;background:#f5f5f5}
details.even-quote>summary:hover{color:#0a0a0a}
details.even-quote>.even-text{color:#737373}
"#;

/// Inside every mail's shadow root. The quote's toggle is ours, so it keeps its
/// look against the mail's CSS and the dark theme's rules for plain mail.
const MAIL_STYLE: &str = ":host{display:block}img{max-width:100%;height:auto}\
details.even-quote>summary{display:inline-block!important;list-style:none!important;cursor:pointer;margin:8px 0 0!important;padding:0 6px!important;border:0!important;border-radius:4px!important;font:12px/16px -apple-system,system-ui,sans-serif!important;letter-spacing:1px!important;color:#888!important;background-color:rgba(128,128,128,.2)!important}\
details.even-quote>summary::-webkit-details-marker{display:none}\
details.even-quote[open]>summary{margin-bottom:8px!important}";

/// The toggle for quoted earlier mail: three dots, as in the web app.
const QUOTE_TOGGLE: &str =
    r#"<summary title="Geciteerde tekst tonen" aria-label="Geciteerde tekst tonen">&bull;&bull;&bull;</summary>"#;

/// Plain mail in the dark theme: its colours were chosen for white paper, so they give way.
const PLAIN_STYLE: &str = "*{color:inherit!important;background-color:transparent!important;border-color:rgba(255,255,255,.14)!important}a,a *{color:#8fb3ff!important}";

/// Our script: sends the app's shortcuts on, so J and K keep working after a
/// click in the mail, and asks for an attachment when its chip is clicked.
/// The mail can't post messages itself: its scripts are stripped and blocked,
/// and the chips sit outside its shadow root, where its markup can't reach.
/// `VIEW` says which document asked, so a click in one being replaced is dropped.
const SCRIPT: &str = r#"
document.querySelectorAll('button.even-file').forEach(function (b) {
  b.addEventListener('click', function () {
    window.ipc.postMessage('download:' + VIEW + ':' + b.dataset.part + ':' + b.dataset.file);
  });
});
document.addEventListener('keydown', function (e) {
  var t = e.target;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  var key = null;
  if (e.metaKey && !e.ctrlKey && !e.altKey && ['r', 'f', 'k', 'b'].indexOf(e.key) >= 0) key = 'cmd-' + e.key;
  else if (!e.metaKey && !e.ctrlKey && !e.altKey) {
    if (e.shiftKey && (e.key === 'U' || e.key === 'u')) key = 'shift-u';
    else if (['j', 'k', 'x', 'e', 's', '#', 'i', '!', 'b', 'u', 'p', '?', '/', 'r', 'a', 'c', 'Escape'].indexOf(e.key) >= 0) key = e.key;
  }
  if (key) { e.preventDefault(); window.ipc.postMessage('key:' + key); }
});
"#;

/// What our script in the document asks the app.
#[derive(Debug, PartialEq, Eq)]
pub enum Message {
    /// A shortcut pressed while the mail had focus.
    Key(String),
    /// An attachment chip clicked: the document it was in, the message and the file.
    Download { view: u64, part: usize, file: usize },
}

/// Reads a message from the webview. Anything else is dropped; the app still
/// checks the numbers against the conversation it shows.
pub fn parse_message(raw: &str) -> Option<Message> {
    if raw.len() > 64 {
        return None;
    }
    if let Some(key) = raw.strip_prefix("key:") {
        return Some(Message::Key(key.to_string()));
    }
    let mut fields = raw.strip_prefix("download:")?.split(':');
    let message = Message::Download {
        view: fields.next()?.parse().ok()?,
        part: fields.next()?.parse().ok()?,
        file: fields.next()?.parse().ok()?,
    };
    fields.next().is_none().then_some(message)
}

/// The conversation as one document: our own header per message, the mail below it.
/// `view` numbers the document, so the app knows which one a download came from.
#[cfg(test)]
pub fn document(subject: &str, parts: &[Part], allow_images: bool, nonce: &str, view: u64) -> String {
    themed_document(subject, parts, allow_images, nonce, view, true)
}

/// [`document`] in the app's theme: `dark` as the first screens drew it, or
/// light, where mail keeps the colours it was written with.
pub fn themed_document(
    subject: &str,
    parts: &[Part],
    allow_images: bool,
    nonce: &str,
    view: u64,
    dark: bool,
) -> String {
    let policy = format!(
        "default-src 'none'; style-src 'unsafe-inline'; img-src data:{}; font-src data:; script-src 'nonce-{nonce}'; form-action 'none'; base-uri 'none'",
        if allow_images { " https:" } else { "" }
    );
    let mut out = String::with_capacity(
        parts
            .iter()
            .map(|p| match &p.body {
                Body::Html { html: body, quote, .. } | Body::Text { text: body, quote } => {
                    body.len() + quote.as_ref().map_or(0, |quote| quote.len())
                }
            })
            .sum::<usize>()
            + 4096,
    );
    out.push_str(r#"<!doctype html><html><head><meta charset="utf-8">"#);
    out.push_str(&format!(
        r#"<meta http-equiv="Content-Security-Policy" content="{policy}">"#
    ));
    out.push_str(r#"<meta name="referrer" content="no-referrer"><style>"#);
    out.push_str(STYLE);
    if !dark {
        out.push_str(LIGHT_STYLE);
    }
    out.push_str("</style></head><body>");
    out.push_str(&format!(r#"<h1 class="even-subject">{}</h1>"#, escape(subject)));
    for (index, part) in parts.iter().enumerate() {
        out.push_str(r#"<section class="even-message"><div class="even-head"><div>"#);
        out.push_str(&format!(r#"<div class="even-from">{}</div>"#, escape(&part.from)));
        if !part.to.is_empty() {
            out.push_str(&format!(r#"<div class="even-to">{}</div>"#, escape(&part.to)));
        }
        out.push_str(&format!(
            r#"</div><div class="even-date">{}</div></div>"#,
            escape(&part.date)
        ));
        match &part.body {
            Body::Html { html, quote, paper } => {
                let (look, extra) = if *paper {
                    ("even-paper", "")
                } else {
                    ("even-plain", if dark { PLAIN_STYLE } else { "" })
                };
                // Declarative shadow DOM: no script needed, and the mail's CSS stays inside.
                // The quote sits in the same root, so it keeps the mail's styles and not ours.
                let quote = quote
                    .as_ref()
                    .map(|quote| format!(r#"<details class="even-quote">{QUOTE_TOGGLE}{quote}</details>"#))
                    .unwrap_or_default();
                out.push_str(&format!(
                    r#"<div class="even-body {look}"><template shadowrootmode="open"><style>{MAIL_STYLE}{extra}</style>{html}{quote}</template></div>"#
                ));
            }
            Body::Text { text, quote } => {
                out.push_str(&format!(
                    r#"<div class="even-body even-text">{}</div>"#,
                    text_to_html(text)
                ));
                if let Some(quote) = quote {
                    out.push_str(&format!(
                        r#"<details class="even-quote">{QUOTE_TOGGLE}<div class="even-body even-text">{}</div></details>"#,
                        text_to_html(quote)
                    ));
                }
            }
        }
        if !part.attachments.is_empty() {
            out.push_str(r#"<div class="even-files">"#);
            for (file, attachment) in part.attachments.iter().enumerate() {
                let label = escape(&attachment.label);
                if attachment.downloadable {
                    out.push_str(&format!(
                        r#"<button type="button" class="even-file" title="Downloaden" data-part="{index}" data-file="{file}">{label}</button>"#
                    ));
                } else {
                    out.push_str(&format!(r#"<span class="even-file">{label}</span>"#));
                }
            }
            out.push_str("</div>");
        }
        out.push_str("</section>");
    }
    out.push_str(&format!(
        r#"<script nonce="{nonce}">var VIEW = {view};{SCRIPT}</script></body></html>"#
    ));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizing_removes_what_could_run() {
        let clean = sanitize(
            r#"<style>p{color:red}</style><p onclick="x()" style="color:blue">Hi</p><script>alert(1)</script>
               <a href="javascript:alert(1)">bad</a><a href="https://example.nl">good</a><form><input></form><img src="cid:a@b">"#,
        );
        assert!(clean.contains("<style>p{color:red}</style>"));
        assert!(clean.contains(r#"style="color:blue""#));
        assert!(!clean.contains("onclick"));
        assert!(!clean.contains("<script"));
        assert!(!clean.contains("alert(1)</script"));
        assert!(!clean.contains("javascript:"));
        assert!(clean.contains(r#"href="https://example.nl""#));
        assert!(!clean.contains("<form") && !clean.contains("<input"));
        assert!(clean.contains(r#"src="cid:a@b""#));
    }

    #[test]
    fn tells_designed_mail_from_plain() {
        assert!(has_own_background(r##"<table bgcolor="#003366">"##));
        assert!(has_own_background(r#"<div style="background-color: #f4f4f4">"#));
        assert!(!has_own_background(r#"<div style="background:#ffffff">x</div>"#));
        assert!(!has_own_background("<p>Hoi</p>"));
    }

    #[test]
    fn spots_remote_images() {
        assert!(has_remote_images(r#"<img src="https://t.example/pixel.gif">"#));
        assert!(!has_remote_images(r#"<img src="data:image/png;base64,AAA">"#));
    }

    #[test]
    fn text_gets_links_and_stays_escaped() {
        let html = text_to_html("See https://even.nl/x. <b>");
        assert!(html.contains(r#"<a href="https://even.nl/x""#));
        assert!(html.contains("&lt;b&gt;"));
    }

    #[test]
    fn mail_html_gets_its_own_shadow_root() {
        let parts = [Part {
            from: "A".into(),
            to: String::new(),
            date: "1".into(),
            body: Body::Html {
                html: "<style>body{background:#fff}</style><p>x</p>".into(),
                quote: Some("<p>earlier</p>".into()),
                paper: false,
            },
            attachments: vec![],
        }];
        let doc = document("S", &parts, false, "n", 1);
        let shadow = doc.find(r#"<template shadowrootmode="open">"#).unwrap();
        assert!(doc.find("body{background:#fff}").unwrap() > shadow);
        // The quote stays in the mail's own root, folded away.
        let quote = doc.find(r#"<details class="even-quote"><summary"#).unwrap();
        assert!(quote > shadow && doc.find("<p>earlier</p>").unwrap() > quote);
        assert!(doc.find("</template>").unwrap() > doc.find("</details>").unwrap());
    }

    #[test]
    fn only_files_with_an_id_are_buttons() {
        let parts = [Part {
            from: "A".into(),
            to: String::new(),
            date: "1".into(),
            body: Body::Text {
                text: "x".into(),
                quote: None,
            },
            attachments: vec![
                File {
                    label: "a.pdf".into(),
                    downloadable: true,
                },
                File {
                    label: "<b>.txt".into(),
                    downloadable: false,
                },
            ],
        }];
        let doc = document("S", &parts, false, "n", 7);
        assert!(doc.contains(r#"data-part="0" data-file="0">a.pdf</button>"#));
        assert!(doc.contains(r#"<span class="even-file">&lt;b&gt;.txt</span>"#));
        assert!(doc.contains(r#"<script nonce="n">var VIEW = 7;"#));
    }

    #[test]
    fn reads_only_our_messages() {
        assert_eq!(parse_message("key:j"), Some(Message::Key("j".into())));
        assert_eq!(
            parse_message("download:3:1:0"),
            Some(Message::Download {
                view: 3,
                part: 1,
                file: 0
            })
        );
        assert_eq!(parse_message("j"), None);
        assert_eq!(parse_message("download:3:1"), None);
        assert_eq!(parse_message("download:3:1:0:9"), None);
        assert_eq!(parse_message("download:3:-1:0"), None);
        assert_eq!(parse_message("download:x:1:0"), None);
        assert_eq!(parse_message(&format!("key:{}", "j".repeat(100))), None);
    }

    #[test]
    fn the_policy_follows_the_image_choice() {
        let parts = [Part {
            from: "A".into(),
            to: String::new(),
            date: "1".into(),
            body: Body::Text {
                text: "x".into(),
                quote: None,
            },
            attachments: vec![],
        }];
        assert!(document("S", &parts, false, "n", 0).contains("img-src data:;"));
        assert!(document("S", &parts, true, "n", 0).contains("img-src data: https:;"));
        assert!(document("S", &parts, false, "n", 0).contains("script-src 'nonce-n'"));
    }
}
