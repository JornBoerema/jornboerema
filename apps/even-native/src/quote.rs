//! The earlier mail a reply quotes, split off so the reader can tuck it away:
//! the same rules as `withoutQuote` in the web app (apps/mail-web/src/lib/email-html.ts).
//!
//! This works on the raw mail, before sanitizing, because ammonia drops the `id`
//! attributes Outlook marks its quote with. Both halves are sanitized afterwards,
//! each on its own, so nothing here has to be safe.

use std::sync::LazyLock;

use kuchikiki::traits::*;
use kuchikiki::NodeRef;
use regex::Regex;

/// Where mail clients start the earlier mail they quote under a reply: Gmail,
/// Apple Mail and Thunderbird, Outlook (web and desktop), Yahoo.
const QUOTE_START: &str = ".gmail_quote, blockquote[type=cite], .moz-cite-prefix, #appendonsend, #divRplyFwdMsg, #mail-editor-reference-message-container, .yahoo_quoted";

/// The reply and the quote under it, both still raw HTML, or `None` when there
/// is no quote to leave out (or nothing would be left of the reply).
/// Cuts at the first marker: it and everything after it, at its own level and at each level above.
pub fn split_html(html: &str) -> Option<(String, String)> {
    let (reply, start) = parse_at_marker(html)?;
    let path = path_from(&reply, &start);
    // Apple Mail's "On …, … wrote:" line and the quote, cut off the reply.
    let mut node = Some(start.clone());
    while let Some(current) = node.filter(|n| *n != reply) {
        while let Some(next) = current.next_sibling() {
            next.detach();
        }
        node = current.parent();
    }
    start.detach();
    // Only the quote, or only an image: then there is nothing to tuck away.
    if !has_content(&reply) {
        return None;
    }
    // The same document again, keeping what the reply left: the quote, still in
    // the wrappers around it, so it keeps the look it had.
    let quote = body_of(html)?;
    let start = follow(&quote, &path)?;
    let mut node = Some(start);
    while let Some(current) = node.filter(|n| *n != quote) {
        while let Some(previous) = current.previous_sibling() {
            previous.detach();
        }
        node = current.parent();
    }
    if !has_content(&quote) {
        return None;
    }
    Some((inner_html(&reply), inner_html(&quote)))
}

/// The mail as a body, with a `<style>` at its start kept in it, as ammonia parses it.
fn body_of(html: &str) -> Option<NodeRef> {
    let document = kuchikiki::parse_html().one(format!("<body>{html}")).document_node;
    document.select_first("body").ok().map(|body| body.as_node().clone())
}

/// The body and where its quote starts.
fn parse_at_marker(html: &str) -> Option<(NodeRef, NodeRef)> {
    let body = body_of(html)?;
    let marker = body.select_first(QUOTE_START).ok()?;
    let marker = marker.as_node().clone();
    let mut start = marker.clone();
    if is(&marker, "blockquote") {
        // Apple Mail often puts a <br> between the two.
        let before = marker
            .preceding_siblings()
            .find(|n| n.as_element().is_some() && !is(n, "br"));
        if let Some(before) = before.filter(|n| n.text_contents().trim_end().ends_with(':')) {
            start = before;
        }
    }
    Some((body, start))
}

fn is(node: &NodeRef, tag: &str) -> bool {
    node.as_element().is_some_and(|element| &*element.name.local == tag)
}

/// Child positions from the body down to the node, to find it again in a second parse.
fn path_from(body: &NodeRef, node: &NodeRef) -> Vec<usize> {
    let mut path = Vec::new();
    let mut current = node.clone();
    while current != *body {
        path.push(current.preceding_siblings().count());
        match current.parent() {
            Some(parent) => current = parent,
            None => break,
        }
    }
    path.reverse();
    path
}

fn follow(body: &NodeRef, path: &[usize]) -> Option<NodeRef> {
    let mut node = body.clone();
    for &index in path {
        node = node.children().nth(index)?;
    }
    Some(node)
}

/// Text a reader would see, or an image.
fn has_content(body: &NodeRef) -> bool {
    body.descendants().any(|node| {
        if is(&node, "img") {
            return true;
        }
        let Some(text) = node.as_text() else { return false };
        let hidden = node.ancestors().any(|a| {
            ["style", "script", "title", "template", "noscript"]
                .iter()
                .any(|t| is(&a, t))
        });
        !hidden && !text.borrow().trim().is_empty()
    })
}

fn inner_html(body: &NodeRef) -> String {
    body.children().map(|child| child.to_string()).collect()
}

/// Outlook and others put the earlier mail under a line like this, unquoted.
static SEPARATOR: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^\s*-{2,}\s*(original message|oorspronkelijk bericht|forwarded message|doorgestuurd bericht)\s*-*\s*$|^\s*_{10,}\s*$")
        .unwrap()
});

/// The same for plain text: the reply and the quote under it, or `None`.
/// The quote is the `>` lines at the end with the "On … wrote:" line before them,
/// or everything from an "Original Message" line.
pub fn split_text(text: &str) -> Option<(String, String)> {
    let lines: Vec<&str> = text.lines().collect();
    let blank = |i: usize| lines[i].trim().is_empty();
    let quoted = |i: usize| lines[i].trim_start().starts_with('>');

    let separator = lines.iter().position(|line| SEPARATOR.is_match(line));

    let mut trailing = None;
    let mut end = lines.len();
    while end > 0 && blank(end - 1) {
        end -= 1;
    }
    if end > 0 && quoted(end - 1) {
        let mut start = end - 1;
        while start > 0 && (quoted(start - 1) || blank(start - 1)) {
            start -= 1;
        }
        while blank(start) {
            start += 1;
        }
        // "On …, … wrote:", sometimes wrapped so "wrote:" stands on its own line.
        let mut before = start;
        while before > 0 && blank(before - 1) {
            before -= 1;
        }
        if before > 0 && lines[before - 1].trim_end().ends_with(':') {
            start = before - 1;
            if lines[start].split_whitespace().count() <= 2 && start > 0 && !blank(start - 1) {
                start -= 1;
            }
        }
        trailing = Some(start);
    }

    let start = match (separator, trailing) {
        (Some(a), Some(b)) => a.min(b),
        (a, b) => a.or(b)?,
    };
    let reply = lines[..start].join("\n").trim_end().to_string();
    let quote = lines[start..].join("\n").trim().to_string();
    if reply.trim().is_empty() || quote.is_empty() {
        return None;
    }
    Some((reply, quote))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gmail_quote_is_cut_with_what_follows() {
        let html = r#"<div dir="ltr">Prima, tot dan.</div><br><div class="gmail_quote"><div class="gmail_attr">Op do 12 nov 2026 schreef Jan:</div><blockquote class="gmail_quote">Zullen we morgen?</blockquote></div>"#;
        let (reply, quote) = split_html(html).unwrap();
        assert!(reply.contains("Prima, tot dan."));
        assert!(!reply.contains("Zullen we"));
        assert!(!reply.contains("gmail_quote"));
        assert!(quote.contains("Zullen we morgen?"));
        assert!(quote.contains("schreef Jan:"));
        assert!(!quote.contains("Prima"));
    }

    #[test]
    fn outlook_quote_is_found_by_id_and_keeps_its_wrapper() {
        let html = r#"<style>p{margin:0}</style><div class="WordSection1"><p>Akkoord.</p><div id="appendonsend"></div><hr><div id="divRplyFwdMsg"><b>Van:</b> Piet</div><p>Kun je tekenen?</p></div><p>Na de quote</p>"#;
        let (reply, quote) = split_html(html).unwrap();
        assert!(reply.contains("<style>p{margin:0}</style>"));
        assert!(reply.contains("Akkoord."));
        assert!(!reply.contains("Kun je tekenen"));
        assert!(!reply.contains("Na de quote"));
        assert!(quote.starts_with(r#"<div class="WordSection1"><div id="appendonsend">"#));
        assert!(quote.contains("Kun je tekenen?"));
        assert!(quote.contains("Na de quote"));
        assert!(!quote.contains("Akkoord"));
    }

    #[test]
    fn apple_mail_takes_the_wrote_line_along() {
        let html = r#"<div>Klinkt goed!</div><div><br><div>On 12 Nov 2026, at 10:00, Jan &lt;jan@x.nl&gt; wrote:</div><br><blockquote type="cite"><div>Heb je tijd?</div></blockquote></div>"#;
        let (reply, quote) = split_html(html).unwrap();
        assert!(reply.contains("Klinkt goed!"));
        assert!(!reply.contains("wrote:"));
        assert!(quote.contains("wrote:"));
        assert!(quote.contains("Heb je tijd?"));
    }

    #[test]
    fn a_full_document_keeps_its_head_style_in_the_reply() {
        let html = r#"<html><head><style>.x{color:red}</style></head><body><p>Ja</p><div class="gmail_quote">Oud</div></body></html>"#;
        let (reply, _) = split_html(html).unwrap();
        assert!(reply.contains(".x{color:red}"));
        assert!(reply.contains("<p>Ja</p>"));
    }

    #[test]
    fn nothing_to_collapse() {
        assert!(split_html("<p>Hoi</p>").is_none());
        // Only the quote: then the reply would be empty.
        assert!(split_html(r#"<style>p{}</style><div class="gmail_quote">Oud</div>"#).is_none());
        // An image is a reply too.
        assert!(split_html(r#"<img src="cid:a@b"><div class="gmail_quote">Oud</div>"#).is_some());
    }

    #[test]
    fn text_quote_with_wrote_line() {
        let text =
            "Prima.\n\nGroet, Jorn\n\nOn Thu, Nov 12, 2026 at 10:00 Jan <jan@x.nl>\nwrote:\n\n> Zullen we?\n>\n> Jan";
        let (reply, quote) = split_text(text).unwrap();
        assert_eq!(reply, "Prima.\n\nGroet, Jorn");
        assert!(quote.starts_with("On Thu"));
        assert!(quote.ends_with("> Jan"));
    }

    #[test]
    fn text_quote_from_outlook_separator() {
        let text = "Akkoord.\n\n-----Original Message-----\nFrom: Piet\nKun je tekenen?";
        let (reply, quote) = split_text(text).unwrap();
        assert_eq!(reply, "Akkoord.");
        assert!(quote.starts_with("-----Original Message-----"));
    }

    #[test]
    fn text_without_trailing_quote_stays() {
        assert!(split_text("Hoi\n> een citaat\nen mijn antwoord eronder").is_none());
        assert!(split_text("> alleen een citaat").is_none());
        assert!(split_text("Gewoon tekst").is_none());
    }
}
