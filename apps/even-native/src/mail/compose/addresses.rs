//! Recipients, as apps/mail-web/src/lib/addresses.ts reads them: a field's
//! value is one comma separated string, everything before the last separator
//! a finished address and the rest what is still being typed.

use std::sync::LazyLock;

use regex::Regex;

use crate::api::Address;

static EMAIL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$"#).unwrap());
static SEPARATORS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[,;\s]+").unwrap());
static DISPLAY_NAME: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?:"[^"]*"|[^,;<>"])*<([^<>\s]+)>"#).unwrap());

pub(super) fn is_email(value: &str) -> bool {
    EMAIL.is_match(value)
}

/// Finished recipients, plus the one still being typed after the last separator.
pub(super) fn split_recipients(value: &str) -> (Vec<String>, String) {
    let mut parts: Vec<&str> = SEPARATORS.split(value).collect();
    let draft = parts.pop().unwrap_or_default().to_string();
    let mut entries: Vec<String> = Vec::new();
    for part in parts {
        if !part.is_empty() && !entries.iter().any(|entry| entry == part) {
            entries.push(part.to_string());
        }
    }
    (entries, draft)
}

pub(super) fn join_recipients(entries: &[String], draft: &str) -> String {
    if entries.is_empty() {
        draft.to_string()
    } else {
        format!("{}, {draft}", entries.join(", "))
    }
}

/// Pasted "Name <address>" pairs become bare addresses, so names can't split into recipients.
pub(super) fn strip_display_names(value: &str) -> String {
    DISPLAY_NAME.replace_all(value, "$1,").into_owned()
}

/// Reads a comma separated recipient field, naming the first entry that isn't an address.
pub(super) fn parse_addresses(value: &str) -> (Vec<Address>, Option<String>) {
    let parts: Vec<&str> = value.split([',', ';']).map(str::trim).filter(|part| !part.is_empty()).collect();
    let invalid = parts.iter().find(|part| !is_email(part)).map(|part| part.to_string());
    let addresses = parts
        .into_iter()
        .map(|email| Address {
            name: None,
            email: email.to_string(),
        })
        .collect();
    (addresses, invalid)
}

/// The addresses a draft is saved with: the valid ones (`recipientList` in pages/compose.tsx).
pub(super) fn recipient_list(value: &str) -> Vec<Address> {
    parse_addresses(value).0.into_iter().filter(|address| is_email(&address.email)).collect()
}

/// Who a reply goes to (`replyRecipients` in packages/mail-core/src/types.ts).
/// The result is shown to the user and sent exactly as shown.
pub(super) fn reply_recipients(
    from: Option<&Address>,
    reply_to: &[Address],
    to: &[Address],
    cc: &[Address],
    own: &str,
    all: bool,
) -> (Vec<Address>, Vec<Address>) {
    let own = own.to_lowercase();
    let from_self = from.is_some_and(|from| from.email.to_lowercase() == own);
    let primary: Vec<Address> = if from_self {
        to.to_vec()
    } else if !reply_to.is_empty() {
        reply_to.to_vec()
    } else {
        from.into_iter().cloned().collect()
    };
    if !all {
        return (primary, Vec::new());
    }
    let mut seen = vec![own];
    let mut keep_new = |address: &Address| {
        let key = address.email.to_lowercase();
        if seen.contains(&key) {
            return false;
        }
        seen.push(key);
        true
    };
    let everyone: Vec<Address> = primary.iter().chain(to).filter(|address| keep_new(address)).cloned().collect();
    let copies: Vec<Address> = cc.iter().filter(|address| keep_new(address)).cloned().collect();
    (everyone, copies)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn a(name: Option<&str>, email: &str) -> Address {
        Address {
            name: name.map(String::from),
            email: email.into(),
        }
    }

    fn emails(list: &[Address]) -> Vec<&str> {
        list.iter().map(|address| address.email.as_str()).collect()
    }

    #[test]
    fn splits_what_is_typed() {
        assert_eq!(split_recipients(""), (vec![], String::new()));
        assert_eq!(split_recipients("jan@even.nl"), (vec![], "jan@even.nl".to_string()));
        assert_eq!(
            split_recipients("jan@even.nl, piet@even.nl;kees"),
            (vec!["jan@even.nl".to_string(), "piet@even.nl".to_string()], "kees".to_string())
        );
        // Nobody twice, and a trailing separator finishes the last one.
        assert_eq!(split_recipients("a@b.nl a@b.nl "), (vec!["a@b.nl".to_string()], String::new()));
        assert_eq!(join_recipients(&["a@b.nl".to_string()], "c"), "a@b.nl, c");
        assert_eq!(join_recipients(&[], "c"), "c");
    }

    #[test]
    fn names_are_stripped_from_pasted_pairs() {
        assert_eq!(strip_display_names(r#"Jan <jan@even.nl>"#), "jan@even.nl,");
        assert_eq!(
            strip_display_names(r#""Kok, Piet" <piet@even.nl>, kees@even.nl"#),
            "piet@even.nl,, kees@even.nl"
        );
        let (entries, draft) = split_recipients(&strip_display_names("Jan de Vries <jan@even.nl>"));
        assert_eq!((entries, draft), (vec!["jan@even.nl".to_string()], String::new()));
    }

    #[test]
    fn reads_addresses() {
        let (addresses, invalid) = parse_addresses("jan@even.nl; kees@even.nl, ");
        assert_eq!(emails(&addresses), ["jan@even.nl", "kees@even.nl"]);
        assert_eq!(invalid, None);
        assert_eq!(parse_addresses("jan@even.nl, nope").1.as_deref(), Some("nope"));
        assert!(is_email("a@b.co") && !is_email("a@b") && !is_email("a b@c.nl") && !is_email("<a@b.nl>"));
        assert_eq!(emails(&recipient_list("jan@even.nl, nope")), ["jan@even.nl"]);
    }

    #[test]
    fn answers_go_where_the_web_sends_them() {
        let from = a(Some("Jan"), "jan@even.nl");
        let to = [a(None, "ME@even.nl"), a(None, "piet@even.nl")];
        let cc = [a(None, "kees@even.nl"), a(None, "jan@even.nl")];
        let (answer, copies) = reply_recipients(Some(&from), &[], &to, &cc, "me@even.nl", false);
        assert_eq!(emails(&answer), ["jan@even.nl"]);
        assert!(copies.is_empty());
        let (answer, copies) = reply_recipients(Some(&from), &[], &to, &cc, "me@even.nl", true);
        assert_eq!(emails(&answer), ["jan@even.nl", "piet@even.nl"]);
        assert_eq!(emails(&copies), ["kees@even.nl"]);
    }

    #[test]
    fn reply_to_wins_and_our_own_mail_goes_back_to_its_recipients() {
        let list = a(None, "news@shop.nl");
        let help = [a(None, "help@shop.nl")];
        assert_eq!(emails(&reply_recipients(Some(&list), &help, &[], &[], "me@even.nl", false).0), ["help@shop.nl"]);
        let me = a(None, "me@even.nl");
        let jan = [a(None, "jan@even.nl")];
        assert_eq!(emails(&reply_recipients(Some(&me), &[], &jan, &[], "Me@even.nl", false).0), ["jan@even.nl"]);
        assert!(reply_recipients(None, &[], &[], &[], "me@even.nl", true).0.is_empty());
    }
}
