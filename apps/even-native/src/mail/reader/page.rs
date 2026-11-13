//! The open conversation as one page for the reader's webview: everything
//! that scrolls in apps/mail-web/src/pages/conversation.tsx (the subject, the
//! cards above the mail, each message, the bar to answer with), in the web's
//! own HTML and CSS (assets/reader/reader.css) so it looks the same to the
//! pixel. The mail itself comes from `crate::email`, each in its shadow root.
//! The page runs one script (assets/reader/reader.js), which tells the app
//! what was clicked; the app answers by filling the page's slots.

use std::collections::HashSet;

use crate::api::Unsubscribe;
use crate::email::{self, escape, Body};

use super::super::api::Mailbox;
use super::super::conversation::{size, Conversation, Part};
use super::super::format;
use super::*;

const STYLE: &str = include_str!("../../../assets/reader/reader.css");
const SCRIPT: &str = include_str!("../../../assets/reader/reader.js");

/// From this many messages a thread folds away the ones in the middle (`LONG_THREAD`).
const LONG_THREAD: usize = 5;

/// The mailbox colours, as components/account-dot.tsx has them.
const ACCOUNT_COLORS: [&str; 8] = [
    "oklch(0.66 0.15 250)",
    "oklch(0.76 0.16 75)",
    "oklch(0.68 0.19 355)",
    "oklch(0.69 0.16 155)",
    "oklch(0.64 0.17 300)",
    "oklch(0.72 0.12 200)",
    "oklch(0.63 0.2 28)",
    "oklch(0.65 0.02 260)",
];

/// What the page shows beside the conversation itself.
pub(super) struct Page<'a> {
    pub(super) conversation: &'a Conversation,
    /// Numbers the page, so the app knows which one a click came from.
    pub(super) view: u64,
    pub(super) nonce: &'a str,
    pub(super) dark: bool,
    pub(super) allow_images: bool,
    /// Where the page it replaces was scrolled to.
    pub(super) scroll: usize,
    /// The mailbox the conversation is in.
    pub(super) account: Option<&'a Mailbox>,
    /// An answer is being written: the bar makes way.
    pub(super) replying: bool,
    /// Unsubscribing is on in the settings.
    pub(super) unsubscribe: bool,
    /// The lists left during this visit.
    pub(super) left: &'a HashSet<String>,
    /// Per message: its translation, while that shows in its place.
    pub(super) translated: Vec<Option<String>>,
    pub(super) slots: Slots,
}

/// What fills the page's slots, as HTML: the cards above the mail and the
/// suggested replies. They arrive after the page, and change.
#[derive(Default)]
pub(super) struct Slots {
    pub(super) shipment: String,
    pub(super) invoice: String,
    pub(super) todos: String,
    pub(super) summary: String,
    pub(super) replies: String,
}

/// A Hugeicon as inline SVG, in the text's colour; its size comes from the CSS.
pub(super) fn icon(name: &str) -> String {
    icon_with(name, "")
}

pub(super) fn icon_with(name: &str, class: &str) -> String {
    let Some(file) = crate::assets::Assets.load(&format!("hi/{name}.svg")).ok().flatten() else {
        return String::new();
    };
    let svg = String::from_utf8_lossy(&file);
    svg.replacen(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24""#,
        &format!(r#"<svg class="{class}" width="16" height="16" aria-hidden="true""#),
        1,
    )
}

/// What names a mailing list, so every message of it knows it was left
/// (`unsubscribe.url ?? unsubscribe.mailto?.address`).
pub(super) fn unsubscribe_key(unsubscribe: &Unsubscribe) -> String {
    unsubscribe
        .url
        .clone()
        .or_else(|| unsubscribe.mailto.as_ref().map(|mailto| mailto.address.clone()))
        .unwrap_or_default()
}

/// "13 Nov 2026, 14:05": `toLocaleString` with a medium date and a short time.
fn received(part: &Part) -> String {
    let at = part.received_at.with_timezone(&Local);
    format!("{}, {}", format::day_month(at.date_naive(), true), at.format("%H:%M"))
}

fn names(addresses: &[crate::api::Address]) -> String {
    addresses.iter().map(|address| address.label()).collect::<Vec<_>>().join(", ")
}

/// One message (`Message` and `MessageBody`).
fn message(page: &Page, index: usize, part: &Part, latest: bool, middle: bool, out: &mut String) {
    let sender = match &part.from {
        Some(from) => from.label().to_string(),
        None => t("Unknown sender", "Onbekende afzender").to_string(),
    };
    let translation = page.translated.get(index).and_then(|html| html.as_deref());
    let mut classes = Vec::new();
    if latest {
        classes.push("open");
    }
    if middle {
        classes.push("mid");
    }
    if translation.is_some() {
        classes.push("translated");
    }
    out.push_str(&format!(
        r#"<article class="{}" data-part="{index}"><button type="button" class="head" data-act="toggle" aria-expanded="{latest}"{}><span class="cut"><span class="name">{}</span>"#,
        classes.join(" "),
        if latest { " disabled" } else { "" },
        escape(&sender),
    ));
    if let Some(from) = part.from.as_ref().filter(|from| from.name.as_deref().is_some_and(|name| !name.is_empty())) {
        out.push_str(&format!(r#"<span class="addr xs mu"> {}</span>"#, escape(&from.email)));
    }
    if !part.preview.is_empty() {
        out.push_str(&format!(r#"<span class="snip mu"> · {}</span>"#, escape(&part.preview)));
    }
    out.push_str(&format!(
        r#"</span><time class="xs mu">{}</time></button><div class="rest">"#,
        escape(&received(part))
    ));

    if !part.to.is_empty() || !part.cc.is_empty() || part.unsubscribe.is_some() || part.translatable {
        let mut line = String::new();
        if !part.to.is_empty() {
            line.push_str(&format!("{}: {}", t("To", "Aan"), names(&part.to)));
        }
        if !part.cc.is_empty() {
            line.push_str(&format!(" · {}: {}", t("Cc", "Cc"), names(&part.cc)));
        }
        out.push_str(&format!(r#"<div class="meta"><p class="cut xs mu">{}</p>"#, escape(&line)));
        if part.translatable {
            let (on, off) = (t("Show original", "Origineel tonen"), t("Translate", "Vertalen"));
            out.push_str(&format!(
                r#"<button type="button" class="btn ghost xs start" data-act="translate" aria-pressed="{}" data-on="{on}" data-off="{off}">{}<span>{}</span></button>"#,
                translation.is_some(),
                icon("translate"),
                if translation.is_some() { on } else { off },
            ));
        }
        // A mailbox only works from a connected account; without one, only a link can.
        let usable = part
            .unsubscribe
            .as_ref()
            .filter(|unsubscribe| unsubscribe.url.is_some() || (unsubscribe.mailto.is_some() && page.account.is_some()));
        if let Some(unsubscribe) = usable.filter(|_| page.unsubscribe) {
            let done = page.left.contains(&unsubscribe_key(unsubscribe));
            let (button, gone) = (t("Unsubscribe", "Uitschrijven"), t("Unsubscribed", "Uitgeschreven"));
            out.push_str(&format!(
                r#"<button type="button" class="unsub xs mu" data-act="unsubscribe" data-done="{gone}"{}>{}</button>"#,
                if done { " disabled" } else { "" },
                if done { gone } else { button },
            ));
        }
        out.push_str("</div>");
    }

    out.push_str(&format!(r#"<div class="tr">{}</div>"#, translation.unwrap_or_default()));
    match &part.body {
        Body::Html { html, quote, paper } => {
            out.push_str(r#"<div class="body orig">"#);
            // Designed mail keeps its white paper; plain mail follows the theme.
            out.push_str(&email::frame(html, quote.as_deref(), *paper, page.dark));
            if quote.is_some() {
                let (show, hide) =
                    (t("Show quoted text", "Geciteerde tekst tonen"), t("Hide quoted text", "Geciteerde tekst verbergen"));
                out.push_str(&format!(
                    r#"<button type="button" class="btn secondary xs quote" data-act="quote" aria-expanded="false" aria-label="{show}" data-tip="{show}" data-show="{show}" data-hide="{hide}">{}</button>"#,
                    icon("more-horizontal")
                ));
            }
            out.push_str("</div>");
        }
        Body::Text(text) => out.push_str(&format!(r#"<p class="text orig">{}</p>"#, escape(text))),
        Body::Empty => out.push_str(&format!(
            r#"<p class="mu orig">{}</p>"#,
            t("This message has no text.", "Dit bericht heeft geen tekst.")
        )),
    }

    if !part.attachments.is_empty() {
        out.push_str(&format!(r#"<ul class="files" aria-label="{}">"#, t("Attachments", "Bijlagen")));
        for (file, attachment) in part.attachments.iter().enumerate() {
            let name = escape(&attachment.name);
            let content = format!(
                r#"{}{}<span class="cut">{name}</span><span class="size">{}</span>"#,
                icon_with("attachment-01", "clip"),
                icon_with("loading-03", "spin"),
                size(attachment.size)
            );
            // Only the ones the API gave an id can be downloaded.
            if attachment.id.is_empty() {
                out.push_str(&format!(r#"<li><span class="chip">{content}</span></li>"#));
            } else {
                let title = t(format!("Download {name}"), format!("{name} downloaden"));
                out.push_str(&format!(
                    r#"<li><button type="button" class="chip" data-act="download" data-arg="{file}" title="{title}" aria-label="{title}">{content}</button></li>"#
                ));
            }
        }
        out.push_str("</ul>");
    }
    out.push_str("</div></article>");
}

/// The bar the conversation ends with, and the suggested replies above it.
fn reply_bar(page: &Page, out: &mut String) {
    let count = page.conversation.parts.len();
    out.push_str(&format!(
        r#"<div class="reply"><ul class="suggest" id="slot-replies" aria-label="{}">{}</ul><div class="bar"><p class="count"><span class="mu">{} ·</span>"#,
        t("Suggested replies", "Voorgestelde antwoorden"),
        page.slots.replies,
        match count {
            1 => t("1 message", "1 bericht").to_string(),
            count => t(format!("{count} messages"), format!("{count} berichten")),
        }
    ));
    if let Some(account) = page.account {
        out.push_str(&format!(
            r#"<span class="dot" style="background:{}"></span><span class="cut med">{}</span>"#,
            ACCOUNT_COLORS[account.color % ACCOUNT_COLORS.len()],
            escape(&account.email)
        ));
    }
    out.push_str(r#"</p><div class="acts">"#);
    let actions = [
        (1, t("Reply all", "Allen beantwoorden"), "mail-reply-all-01", "A", "ghost"),
        (2, t("Forward", "Doorsturen"), "mail-send-01", "F", "ghost"),
        (0, t("Reply", "Beantwoorden"), "mail-reply-01", "R", "outline"),
    ];
    for (mode, label, sign, key, variant) in actions {
        out.push_str(&format!(
            r#"<button type="button" class="btn {variant} start" data-act="reply" data-arg="{mode}" data-tip="{label}" data-kbd="{key}" aria-label="{label}">{}<span class="lbl">{label}</span></button>"#,
            icon(sign)
        ));
    }
    out.push_str("</div></div></div>");
}

/// The whole page, behind a policy that loads nothing from anywhere (but
/// images, once allowed) and runs only our script.
pub(super) fn build(page: &Page) -> String {
    let parts = &page.conversation.parts;
    let policy = format!(
        "default-src 'none'; style-src 'unsafe-inline'; img-src data:{}; font-src data: evenfont:; script-src 'nonce-{}'; form-action 'none'; base-uri 'none'",
        if page.allow_images { " https:" } else { "" },
        page.nonce
    );
    let bodies: usize = parts
        .iter()
        .map(|part| match &part.body {
            Body::Html { html, quote, .. } => html.len() + quote.as_ref().map_or(0, |quote| quote.len()),
            Body::Text(text) => text.len(),
            Body::Empty => 0,
        })
        .sum();
    let mut out = String::with_capacity(bodies + STYLE.len() + SCRIPT.len() + 16 * 1024);
    out.push_str(&format!(
        r#"<!doctype html><html lang="{}"{}><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="{policy}"><meta name="referrer" content="no-referrer"><style>{STYLE}</style></head><body{}><div class="col">"#,
        crate::i18n::lang().code(),
        if page.dark { r#" class="dark""# } else { "" },
        if page.replying { r#" class="replying""# } else { "" },
    ));
    out.push_str(&format!(r#"<h2 class="subject">{}</h2>"#, escape(&page.conversation.subject)));
    for (id, html) in [
        ("shipment", &page.slots.shipment),
        ("invoice", &page.slots.invoice),
        ("todos", &page.slots.todos),
        ("summary", &page.slots.summary),
    ] {
        out.push_str(&format!(r#"<div id="slot-{id}">{html}</div>"#));
    }
    if page.conversation.remote_images && !page.allow_images {
        out.push_str(&format!(
            r#"<div class="images xs mu"><p>{}</p><button type="button" class="btn ghost xs" data-act="images">{}</button></div>"#,
            t(
                "Images are hidden to stop senders tracking you.",
                "Afbeeldingen zijn verborgen zodat afzenders je niet kunnen volgen."
            ),
            t("Show images", "Afbeeldingen tonen")
        ));
    }

    // Newest first, each apart from the next. A long thread shows the two
    // newest and the one that started it; those between wait behind a count,
    // as in Gmail.
    let count = parts.len();
    let long = count >= LONG_THREAD;
    out.push_str(&format!(r#"<div class="messages{}">"#, if long { " folded" } else { "" }));
    for (position, (index, part)) in parts.iter().enumerate().rev().enumerate() {
        let oldest = position + 1 == count;
        if long && oldest {
            let hidden = count - 3;
            out.push_str(&format!(
                r#"<div class="more"><button type="button" data-act="unfold">{}</button></div>"#,
                t(format!("{hidden} more messages"), format!("Nog {hidden} berichten"))
            ));
        }
        message(page, index, part, position == 0, long && position >= 2 && !oldest, &mut out);
    }
    out.push_str("</div>");
    if count > 0 {
        reply_bar(page, &mut out);
    }
    out.push_str(&format!(
        r#"</div><div id="tip" role="tooltip"></div><script nonce="{}">var VIEW = {}, SCROLL = {};{SCRIPT}</script></body></html>"#,
        page.nonce, page.view, page.scroll
    ));
    out
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::{build, Body, Conversation, Page, Part, Slots, Unsubscribe};
    use crate::api::{Address, Attachment};

    fn part(id: &str, body: Body) -> Part {
        Part {
            message_id: id.into(),
            from: Some(Address {
                name: Some("Jan <b>".into()),
                email: "jan@even.nl".into(),
            }),
            to: vec![Address {
                name: None,
                email: "me@even.nl".into(),
            }],
            cc: vec![],
            received_at: "2026-11-12T13:56:00Z".parse().unwrap(),
            preview: "Hoi".into(),
            body,
            translatable: true,
            unsubscribe: None,
            attachments: vec![],
        }
    }

    fn page_of(conversation: &Conversation, left: &HashSet<String>, allow_images: bool) -> String {
        build(&Page {
            conversation,
            view: 7,
            nonce: "n",
            dark: true,
            allow_images,
            scroll: 0,
            account: None,
            replying: false,
            unsubscribe: true,
            left,
            translated: Vec::new(),
            slots: Slots::default(),
        })
    }

    fn conversation(parts: Vec<Part>) -> Conversation {
        Conversation {
            subject: "S & <i>".into(),
            parts,
            remote_images: true,
            last: None,
        }
    }

    #[test]
    fn the_policy_follows_the_image_choice() {
        let conversation = conversation(vec![part("m1", Body::Text("x".into()))]);
        let left = HashSet::new();
        let blocked = page_of(&conversation, &left, false);
        assert!(blocked.contains("img-src data:;"));
        assert!(blocked.contains(r#"data-act="images""#));
        assert!(blocked.contains("script-src 'nonce-n'"));
        assert!(blocked.contains(r#"<script nonce="n">var VIEW = 7, SCROLL = 0;"#));
        let allowed = page_of(&conversation, &left, true);
        assert!(allowed.contains("img-src data: https:;"));
        assert!(!allowed.contains(r#"data-act="images""#));
    }

    #[test]
    fn what_the_mail_says_is_escaped() {
        let conversation = conversation(vec![part("m1", Body::Text("<script>x</script>".into()))]);
        let page = page_of(&conversation, &HashSet::new(), false);
        assert!(page.contains(r#"<h2 class="subject">S &amp; &lt;i&gt;</h2>"#));
        assert!(page.contains(r#"<span class="name">Jan &lt;b&gt;</span>"#));
        assert!(page.contains(r#"<p class="text orig">&lt;script&gt;x&lt;/script&gt;</p>"#));
    }

    #[test]
    fn only_files_with_an_id_are_buttons() {
        let mut first = part("m1", Body::Empty);
        first.attachments = vec![
            Attachment {
                id: "a1".into(),
                name: "a.pdf".into(),
                size: 2048,
                content_type: String::new(),
            },
            Attachment {
                id: String::new(),
                name: "<b>.txt".into(),
                size: 10,
                content_type: String::new(),
            },
        ];
        let page = page_of(&conversation(vec![first]), &HashSet::new(), false);
        assert!(page.contains(r#"<button type="button" class="chip" data-act="download" data-arg="0""#));
        assert!(page.contains(r#"<span class="cut">a.pdf</span><span class="size">2 KB</span>"#));
        assert!(page.contains(r#"<span class="cut">&lt;b&gt;.txt</span>"#));
        assert_eq!(page.matches(r#"data-act="download""#).count(), 1);
    }

    #[test]
    fn a_long_thread_folds_its_middle() {
        let parts: Vec<Part> = (0..6).map(|index| part(&format!("m{index}"), Body::Empty)).collect();
        let page = page_of(&conversation(parts), &HashSet::new(), false);
        assert!(page.contains(r#"<div class="messages folded">"#));
        // Newest first: the two newest, three behind the count, then the first.
        let newest = page.find(r#"<article class="open" data-part="5">"#).unwrap();
        let second = page.find(r#"<article class="" data-part="4">"#).unwrap();
        let middle = page.find(r#"<article class="mid" data-part="3">"#).unwrap();
        let more = page.find(r#"data-act="unfold">"#).unwrap();
        let first = page.find(r#"<article class="" data-part="0">"#).unwrap();
        assert!(newest < second && second < middle && middle < more && more < first);
        assert_eq!(page.matches(r#"class="mid""#).count(), 3);
        assert!(page.contains("3 more messages") || page.contains("Nog 3 berichten"));
        let short: Vec<Part> = (0..4).map(|index| part(&format!("m{index}"), Body::Empty)).collect();
        assert!(!page_of(&conversation(short), &HashSet::new(), false).contains(r#"class="messages folded""#));
    }

    #[test]
    fn a_left_list_says_so_on_every_message() {
        let mut first = part("m1", Body::Empty);
        first.unsubscribe = Some(Unsubscribe {
            url: Some("https://list.example/u".into()),
            mailto: None,
            one_click: true,
        });
        let conversation = conversation(vec![first]);
        // The newest message's own line can't fold, so one button is always off.
        let before = page_of(&conversation, &HashSet::new(), false);
        assert!(before.contains(r#"data-act="unsubscribe""#));
        assert_eq!(before.matches(" disabled>").count(), 1);
        let left = HashSet::from(["https://list.example/u".to_string()]);
        assert_eq!(page_of(&conversation, &left, false).matches(" disabled>").count(), 2);
    }
}
