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
    pub attachments: Vec<String>,
}

pub enum Body {
    /// Sanitized HTML; `paper` when the mail paints its own backgrounds.
    Html { html: String, paper: bool },
    Text(String),
}

fn sanitizer() -> ammonia::Builder<'static> {
    let mut builder = ammonia::Builder::default();
    builder
        .add_tags(["style", "font", "center"])
        .clean_content_tags(HashSet::from(["script", "noscript", "iframe", "object", "embed", "template"]))
        .rm_tags(["form", "input", "button", "textarea", "select", "option"])
        .add_generic_attributes([
            "style", "class", "align", "valign", "bgcolor", "width", "height", "border", "cellpadding",
            "cellspacing", "color", "face", "size", "dir",
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
static BACKGROUND: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?i)background(?:-color)?\s*:\s*([^;"'}]+)"#).unwrap());
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

const STYLE: &str = r#"
:root{color-scheme:dark}
html,body{margin:0!important;background:#0f0f0f!important;color:#fafafa;height:auto!important}
body{padding:4px 24px 40px;font:14px/1.5 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
h1.even-subject{font-size:20px;font-weight:600;line-height:1.3;margin:4px 0 16px;color:#fafafa}
section.even-message{border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:16px;margin:0 0 12px}
.even-head{display:flex;justify-content:space-between;gap:16px;margin-bottom:12px}
.even-from{font-weight:600;font-size:14px;color:#fafafa}
.even-to{font-size:12px;color:#a1a1a1;margin-top:2px}
.even-date{flex:none;font-size:12px;color:#a1a1a1}
.even-body{overflow-x:auto;overflow-wrap:anywhere}
.even-body img{max-width:100%;height:auto}
.even-text{white-space:pre-wrap}
.even-text a,.even-plain a,.even-plain a *{color:#8fb3ff!important}
.even-plain,.even-plain *{color:#e4e4e1!important;background-color:transparent!important;border-color:rgba(255,255,255,.14)!important}
.even-paper{background:#fff;color:#111;border-radius:8px;padding:12px}
.even-files{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.even-file{font-size:12px;color:#a1a1a1;background:#262626;border-radius:6px;padding:4px 8px}
.even-images{font-size:12px;color:#a1a1a1;margin:0 0 12px}
"#;

/// Sends the app's shortcuts on, so J and K keep working after a click in the mail.
const KEYS: &str = r#"
document.addEventListener('keydown', function (e) {
  var t = e.target;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  var key = null;
  if (e.metaKey && !e.ctrlKey && !e.altKey && e.key === 'r') key = 'cmd-r';
  else if (!e.metaKey && !e.ctrlKey && !e.altKey) {
    if (e.shiftKey && (e.key === 'U' || e.key === 'u')) key = 'shift-u';
    else if (['j', 'k', 'e', 's', '#', 'Escape'].indexOf(e.key) >= 0) key = e.key;
  }
  if (key) { e.preventDefault(); window.ipc.postMessage(key); }
});
"#;

/// The conversation as one document: our own header per message, the mail below it.
pub fn document(subject: &str, parts: &[Part], allow_images: bool, nonce: &str) -> String {
    let policy = format!(
        "default-src 'none'; style-src 'unsafe-inline'; img-src data:{}; font-src data:; script-src 'nonce-{nonce}'; form-action 'none'; base-uri 'none'",
        if allow_images { " https:" } else { "" }
    );
    let mut out = String::with_capacity(parts.iter().map(|p| match &p.body {
        Body::Html { html, .. } => html.len(),
        Body::Text(text) => text.len(),
    }).sum::<usize>() + 4096);
    out.push_str(r#"<!doctype html><html><head><meta charset="utf-8">"#);
    out.push_str(&format!(r#"<meta http-equiv="Content-Security-Policy" content="{policy}">"#));
    out.push_str(r#"<meta name="referrer" content="no-referrer"><style>"#);
    out.push_str(STYLE);
    out.push_str("</style></head><body>");
    out.push_str(&format!(r#"<h1 class="even-subject">{}</h1>"#, escape(subject)));
    for part in parts {
        out.push_str(r#"<section class="even-message"><div class="even-head"><div>"#);
        out.push_str(&format!(r#"<div class="even-from">{}</div>"#, escape(&part.from)));
        if !part.to.is_empty() {
            out.push_str(&format!(r#"<div class="even-to">{}</div>"#, escape(&part.to)));
        }
        out.push_str(&format!(r#"</div><div class="even-date">{}</div></div>"#, escape(&part.date)));
        match &part.body {
            Body::Html { html, paper } => {
                let look = if *paper { "even-paper" } else { "even-plain" };
                out.push_str(&format!(r#"<div class="even-body {look}">{html}</div>"#));
            }
            Body::Text(text) => {
                out.push_str(&format!(r#"<div class="even-body even-text">{}</div>"#, text_to_html(text)));
            }
        }
        if !part.attachments.is_empty() {
            out.push_str(r#"<div class="even-files">"#);
            for name in &part.attachments {
                out.push_str(&format!(r#"<span class="even-file">{}</span>"#, escape(name)));
            }
            out.push_str("</div>");
        }
        out.push_str("</section>");
    }
    out.push_str(&format!(r#"<script nonce="{nonce}">{KEYS}</script></body></html>"#));
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
    fn the_policy_follows_the_image_choice() {
        let parts = [Part { from: "A".into(), to: String::new(), date: "1".into(), body: Body::Text("x".into()), attachments: vec![] }];
        assert!(document("S", &parts, false, "n").contains("img-src data:;"));
        assert!(document("S", &parts, true, "n").contains("img-src data: https:;"));
        assert!(document("S", &parts, false, "n").contains("script-src 'nonce-n'"));
    }
}
