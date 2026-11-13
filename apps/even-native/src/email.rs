//! Untrusted mail HTML, made safe to show: the same rules as the web app
//! (apps/mail-web/src/lib/email-html.ts). The page around it is built in
//! `mail::reader::page`.
//!
//! Three walls: ammonia removes scripts, handlers and forms; the policy in the
//! page blocks every script but ours and all remote loading unless images
//! are allowed; and links never navigate the view, they open in the browser.
//! Each mail sits in its own shadow root, so its styles stay with it, and
//! what our script may ask the app is read here, strictly.

use std::collections::HashSet;
use std::sync::LazyLock;

use regex::Regex;

/// What a message says, ready for the page.
pub enum Body {
    /// Sanitized HTML; `paper` when the mail paints its own backgrounds.
    /// `quote` is the earlier mail it quotes, sanitized too, shown folded away.
    Html {
        html: String,
        quote: Option<String>,
        paper: bool,
    },
    /// A message without HTML, as it was written.
    Text(String),
    Empty,
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

static STYLE_BLOCK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?is)(<style[^>]*>)(.*?)(</style>)").unwrap());
static HTML_BODY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\bhtml\s*>?\s*body\b").unwrap());
static PAGE_SELECTOR: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(^|[\s,}>+~])(?:html|body)([\s,{.:#\[>+~])").unwrap());

/// Mail styles its `body`; here the mail is a part of our page, so those
/// rules are pointed at the element the mail sits in instead. On the web the
/// mail has a frame of its own and they simply apply.
pub fn scope_styles(sanitized: &str) -> String {
    if !sanitized.contains("<style") {
        return sanitized.to_string();
    }
    STYLE_BLOCK
        .replace_all(sanitized, |captures: &regex::Captures| {
            let css = HTML_BODY.replace_all(&captures[2], "body");
            // Twice: a match takes the separator the next selector starts with.
            let css = PAGE_SELECTOR.replace_all(&css, "${1}#evido-mail${2}");
            let css = PAGE_SELECTOR.replace_all(&css, "${1}#evido-mail${2}");
            format!("{}{css}{}", &captures[1], &captures[3])
        })
        .into_owned()
}

/// Inside every mail's shadow root: `FRAME_STYLE` of the web's frame. The
/// mail is contained, so nothing in it can be drawn over the app's controls.
const MAIL_STYLE: &str = ":host{display:block;contain:content;padding:12px;font:14px/1.5 system-ui,sans-serif;color:#111;overflow-wrap:anywhere}\
#evido-mail{overflow-x:auto;overflow-y:hidden}img{max-width:100%;height:auto}";

/// Plain mail has no paper and lines up with the sender above it (`flush`).
const PLAIN_STYLE: &str = ":host{padding:12px 0}";

/// Plain mail in the dark theme (`DARK_STYLE`): no paper, light text, links
/// that read on dark. Its own colours were chosen for white, so they give way.
const DARK_STYLE: &str = ":host{color:#e4e4e1!important;color-scheme:dark}\
#evido-mail *{color:inherit!important;background-color:transparent!important;border-color:rgba(255,255,255,.14)!important}\
#evido-mail a,#evido-mail a *{color:#8fb3ff!important}#evido-mail hr{border-color:rgba(255,255,255,.14)!important}";

/// A sanitized mail in its own shadow root (declarative, so no script is
/// needed), with the earlier mail it quotes folded away below it. The quote
/// stays in the same root: it keeps the mail's styles and not ours.
pub fn frame(html: &str, quote: Option<&str>, paper: bool, dark: bool) -> String {
    let look = if paper { "paper" } else { "plain" };
    let extra = match (paper, dark) {
        (true, _) => String::new(),
        (false, false) => PLAIN_STYLE.to_string(),
        (false, true) => [PLAIN_STYLE, DARK_STYLE].concat(),
    };
    let quote = quote
        .map(|quote| format!(r#"<div id="even-quote" style="display:none!important">{quote}</div>"#))
        .unwrap_or_default();
    format!(
        r#"<div class="mail {look}"><template shadowrootmode="open"><style>{MAIL_STYLE}{extra}</style><div id="evido-mail">{html}{quote}</div></template></div>"#
    )
}

/// What our script in the page asks the app.
#[derive(Debug, PartialEq, Eq)]
pub enum Message {
    /// A shortcut pressed while the mail had focus.
    Key(String),
    /// An attachment chip clicked: the page it was in, the message and the file.
    Download { view: u64, part: usize, file: usize },
    /// The page is there: what arrived meanwhile can be put in it.
    Ready { view: u64 },
    /// Something else clicked, with the number it carries (a message, a choice).
    Act { view: u64, act: Act, arg: Option<usize> },
    /// How the page stands before another takes its place: how far it was
    /// scrolled, and which messages and quotes were unfolded (`f` or `u` for
    /// the long thread, then a 0 or 1 per message, twice).
    Keep { view: u64, scroll: usize, state: String },
}

/// What a page may say of its folds: nothing else is ever written back into a page.
pub fn is_fold_state(state: &str) -> bool {
    let mut parts = state.split('.');
    let bits = |part: Option<&str>| part.is_some_and(|part| part.bytes().all(|bit| bit == b'0' || bit == b'1'));
    matches!(parts.next(), Some("f" | "u")) && bits(parts.next()) && bits(parts.next()) && parts.next().is_none()
}

/// The clicks the page passes on (assets/reader/reader.js).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Act {
    /// Show remote images; the number is how far the page was scrolled.
    Images,
    Translate,
    Original,
    Unsubscribe,
    /// 0 the sign-in code, 1 the tracking code, 2 the invoice number.
    Copy,
    /// "Not recognised well": 0 the parcel card, 1 the invoice card.
    Report,
    /// 0 reply, 1 reply all, 2 forward.
    Reply,
    /// A suggested reply picked.
    Suggest,
    /// To Moneybird: the administration picked, or none for the usual one.
    MoneybirdSend,
    /// Another file for Moneybird.
    MoneybirdFile,
}

impl Act {
    fn named(name: &str) -> Option<Act> {
        Some(match name {
            "images" => Act::Images,
            "translate" => Act::Translate,
            "original" => Act::Original,
            "unsubscribe" => Act::Unsubscribe,
            "copy" => Act::Copy,
            "report" => Act::Report,
            "reply" => Act::Reply,
            "suggest" => Act::Suggest,
            "mbsend" => Act::MoneybirdSend,
            "mbfile" => Act::MoneybirdFile,
            _ => return None,
        })
    }
}

/// Reads a message from the webview. Anything else is dropped; the app still
/// checks the numbers against the conversation it shows.
pub fn parse_message(raw: &str) -> Option<Message> {
    // A long thread's folds take two characters a message.
    if raw.len() > if raw.starts_with("keep:") { 1200 } else { 64 } {
        return None;
    }
    if let Some(key) = raw.strip_prefix("key:") {
        return Some(Message::Key(key.to_string()));
    }
    let mut fields = raw.split(':');
    let name = fields.next()?;
    let view = fields.next()?.parse().ok()?;
    let message = match name {
        "download" => Message::Download {
            view,
            part: fields.next()?.parse().ok()?,
            file: fields.next()?.parse().ok()?,
        },
        "ready" => Message::Ready { view },
        "keep" => Message::Keep {
            view,
            scroll: fields.next()?.parse().ok()?,
            state: fields.next().filter(|state| is_fold_state(state))?.to_string(),
        },
        name => Message::Act {
            view,
            act: Act::named(name)?,
            arg: match fields.next() {
                Some(arg) => Some(arg.parse().ok()?),
                None => None,
            },
        },
    };
    fields.next().is_none().then_some(message)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_page_says_how_it_stands_and_nothing_else() {
        assert_eq!(
            parse_message("keep:7:320:u.101.010"),
            Some(Message::Keep { view: 7, scroll: 320, state: "u.101.010".into() })
        );
        assert_eq!(parse_message("keep:7:0:f.."), Some(Message::Keep { view: 7, scroll: 0, state: "f..".into() }));
        // Only folds: nothing else is ever written into the next page.
        assert_eq!(parse_message("keep:7:0:u.1\";alert(1)//.0"), None);
        assert_eq!(parse_message("keep:7:0:x.1.0"), None);
        assert_eq!(parse_message("keep:7:0:u.1"), None);
        assert!(is_fold_state("f.0011.0000") && !is_fold_state("") && !is_fold_state("u.1.0.1"));
    }

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
    fn escapes_what_html_reads() {
        assert_eq!(escape(r#"<b a="1">&'"#), "&lt;b a=&quot;1&quot;&gt;&amp;&#39;");
    }

    #[test]
    fn mail_html_gets_its_own_shadow_root() {
        let doc = frame("<style>p{color:red}</style><p>x</p>", Some("<p>earlier</p>"), false, true);
        let shadow = doc.find(r#"<template shadowrootmode="open">"#).unwrap();
        assert!(doc.starts_with(r#"<div class="mail plain">"#));
        assert!(doc.find("p{color:red}").unwrap() > shadow);
        assert!(doc.contains("contain:content"));
        // The quote stays in the mail's own root, folded away.
        let quote = doc.find(r#"<div id="even-quote" style="display:none!important">"#).unwrap();
        assert!(quote > shadow && doc.find("<p>earlier</p>").unwrap() > quote);
        assert!(doc.find("</template>").unwrap() > quote);
        // Dark rules only for plain mail in the dark theme.
        assert!(doc.contains("#8fb3ff"));
        assert!(!frame("<p>x</p>", None, true, true).contains("#8fb3ff"));
        assert!(!frame("<p>x</p>", None, false, false).contains("#8fb3ff"));
        assert!(frame("<p>x</p>", None, true, false).starts_with(r#"<div class="mail paper">"#));
    }

    #[test]
    fn page_rules_follow_the_mail_into_its_root() {
        let scoped = scope_styles("<style>html,body{margin:0}body .x,BODY>p{color:red}\n.body{top:0}html body{a:b}</style><p>body</p>");
        assert!(scoped.contains("#evido-mail,#evido-mail{margin:0}"));
        assert!(scoped.contains("#evido-mail .x,#evido-mail>p{color:red}"));
        assert!(scoped.contains(".body{top:0}"));
        assert!(scoped.contains("#evido-mail{a:b}"));
        assert!(scoped.ends_with("<p>body</p>"));
        assert_eq!(scope_styles("<p>body {}</p>"), "<p>body {}</p>");
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
        assert_eq!(parse_message("ready:4"), Some(Message::Ready { view: 4 }));
        assert_eq!(
            parse_message("translate:4:2"),
            Some(Message::Act {
                view: 4,
                act: Act::Translate,
                arg: Some(2)
            })
        );
        assert_eq!(
            parse_message("mbsend:4"),
            Some(Message::Act {
                view: 4,
                act: Act::MoneybirdSend,
                arg: None
            })
        );
        assert_eq!(parse_message("j"), None);
        assert_eq!(parse_message("download:3:1"), None);
        assert_eq!(parse_message("download:3:1:0:9"), None);
        assert_eq!(parse_message("download:3:-1:0"), None);
        assert_eq!(parse_message("download:x:1:0"), None);
        assert_eq!(parse_message("ready:4:1"), None);
        assert_eq!(parse_message("delete:4:1"), None);
        assert_eq!(parse_message("translate:4:x"), None);
        assert_eq!(parse_message("translate:4:1:2"), None);
        assert_eq!(parse_message(&format!("key:{}", "j".repeat(100))), None);
    }
}
