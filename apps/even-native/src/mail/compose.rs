//! Writing: an answer below the open conversation (R, A) or a new mail in the
//! reader's place (C). Plain text for now; signatures and attachments come later.

use gpui_kit::component::input::{Escape, Input, InputState, Textarea, TextareaState};
use gpui_kit::component::Sizable as _;

use crate::api::{Account, Address};
use crate::theme;

use super::conversation::ReplyTarget;
use super::*;

pub(super) enum Kind {
    New,
    Reply { thread_id: String, message_id: String },
}

pub(super) struct Composer {
    kind: Kind,
    /// The mailbox a new mail goes from; an answer goes from the conversation's own.
    account: Option<String>,
    to: Entity<InputState>,
    cc: Entity<InputState>,
    subject: Entity<InputState>,
    body: Entity<TextareaState>,
    sending: bool,
    error: Option<SharedString>,
    /// Escape with text in the body asks once more before throwing it away.
    discard_armed: bool,
}

impl Composer {
    pub(super) fn is_new(&self) -> bool {
        matches!(self.kind, Kind::New)
    }
}

impl MailView {
    /// C: a new mail, from the mailbox of the open conversation or else the first.
    pub(super) fn compose_new(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.composer.as_ref().is_some_and(|c| c.is_new()) {
            return;
        }
        let account = Some(self.filter.clone())
            .filter(|id| !id.is_empty())
            .or_else(|| self.accounts.first().map(|a| a.id.clone()));
        let composer = Composer {
            kind: Kind::New,
            account,
            to: field("Aan", "", window, cx),
            cc: field("Cc", "", window, cx),
            subject: field("Onderwerp", "", window, cx),
            body: cx.new(|cx| TextareaState::new(window, cx).placeholder("Schrijf je mail")),
            sending: false,
            error: None,
            discard_armed: false,
        };
        composer.to.update(cx, |input, cx| input.focus(window, cx));
        self.composer = Some(composer);
        cx.notify();
    }

    /// R answers the sender, A everyone on the newest message.
    pub(super) fn compose_reply(&mut self, all: bool, window: &mut Window, cx: &mut Context<Self>) {
        let Some(thread_id) = self.open_id().map(str::to_string) else { return };
        let Some(Reading::Ready(conversation)) = self.reading.get(&thread_id) else {
            return;
        };
        let Some(target) = conversation.last.as_ref() else {
            return;
        };
        let own: Vec<String> = self.accounts.iter().map(|a| a.email.to_lowercase()).collect();
        let (to, cc) = reply_recipients(target, &own, all);
        let message_id = target.message_id.clone();
        let composer = Composer {
            kind: Kind::Reply { thread_id, message_id },
            account: None,
            to: field("Aan", &format_addresses(&to), window, cx),
            cc: field("Cc", &format_addresses(&cc), window, cx),
            subject: field("Onderwerp", "", window, cx),
            body: cx.new(|cx| {
                TextareaState::new(window, cx)
                    .auto_grow(5, 14)
                    .placeholder("Schrijf je antwoord")
            }),
            sending: false,
            error: None,
            discard_armed: false,
        };
        if let Some(webview) = &self.webview {
            let _ = webview.read(cx).raw().focus_parent();
        }
        composer.body.update(cx, |input, cx| input.focus(window, cx));
        self.composer = Some(composer);
        cx.notify();
    }

    /// An answer belongs to its conversation: opening another one closes it.
    pub(super) fn drop_reply_elsewhere(&mut self) {
        let open = self.open_id().map(str::to_string);
        if let Some(Composer {
            kind: Kind::Reply { thread_id, .. },
            ..
        }) = &self.composer
        {
            if open.as_deref() != Some(thread_id.as_str()) {
                self.composer = None;
            }
        }
    }

    fn cancel_compose(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(composer) = &mut self.composer else { return };
        if composer.sending {
            return;
        }
        let written = !composer.body.read(cx).value().trim().is_empty();
        if written && !composer.discard_armed {
            composer.discard_armed = true;
            composer.error = Some("Nog een keer Esc om dit concept weg te gooien.".into());
            cx.notify();
            return;
        }
        self.composer = None;
        window.focus(&self.focus, cx);
        cx.notify();
    }

    fn send_composed(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(composer) = &mut self.composer else { return };
        if composer.sending {
            return;
        }
        let read = |input: &Entity<InputState>, cx: &App| input.read(cx).value().to_string();
        let checked = parse_addresses(&read(&composer.to, cx))
            .and_then(|to| parse_addresses(&read(&composer.cc, cx)).map(|cc| (to, cc)));
        let (to, cc) = match checked {
            Ok(found) => found,
            Err(bad) => {
                composer.error = Some(format!("Dit is geen mailadres: {bad}").into());
                cx.notify();
                return;
            }
        };
        let text = composer.body.read(cx).value().to_string();
        let subject = read(&composer.subject, cx);
        let problem = if to.is_empty() {
            Some("Vul in naar wie het gaat.")
        } else if text.trim().is_empty() {
            Some("Er staat nog niets in je mail.")
        } else if composer.is_new() && composer.account.is_none() {
            Some("Er is geen mailbox om vanaf te versturen.")
        } else {
            None
        };
        if let Some(problem) = problem {
            composer.error = Some(problem.into());
            cx.notify();
            return;
        }
        composer.sending = true;
        composer.error = None;
        let client = self.client.clone();
        let (reply, account) = match &composer.kind {
            Kind::Reply { thread_id, message_id } => (Some((thread_id.clone(), message_id.clone())), None),
            Kind::New => (None, composer.account.clone()),
        };
        let replied = reply.as_ref().map(|(thread_id, _)| thread_id.clone());
        let task = cx.background_executor().spawn(async move {
            match (&reply, &account) {
                (Some((thread_id, message_id)), _) => client.reply(thread_id, message_id, &to, &cc, &text),
                (None, Some(account)) => client.send(account, &to, &cc, &subject, &text),
                (None, None) => Err(anyhow::anyhow!("no mailbox")),
            }
        });
        cx.spawn_in(window, async move |this, cx| {
            let result = task.await;
            let _ = this.update_in(cx, |this, window, cx| {
                match result {
                    Ok(()) => {
                        this.composer = None;
                        window.focus(&this.focus, cx);
                        this.set_status("Verstuurd".into(), false, cx);
                        // The sent answer shows in the conversation once the mailbox has it.
                        if let Some(thread_id) = replied {
                            let subject = this.open.as_ref().map(|thread| thread.subject.clone()).unwrap_or_default();
                            this.read(thread_id, subject, cx);
                        }
                    }
                    Err(error) => {
                        if let Some(composer) = &mut this.composer {
                            composer.sending = false;
                            composer.error = Some(format!("Versturen is niet gelukt: {error}").into());
                        }
                    }
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }

    /// A new mail goes from the next mailbox on each click; there are few of them.
    fn next_account(&mut self, cx: &mut Context<Self>) {
        let Some(composer) = &mut self.composer else { return };
        let ids: Vec<&str> = self.accounts.iter().map(|a| a.id.as_str()).collect();
        let at = composer
            .account
            .as_deref()
            .and_then(|id| ids.iter().position(|other| *other == id));
        composer.account = ids.get(at.map_or(0, |i| (i + 1) % ids.len())).map(|id| id.to_string());
        cx.notify();
    }

    pub(super) fn render_composer(&mut self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let composer = self.composer.as_ref()?;
        let new = composer.is_new();
        let from = composer
            .account
            .as_deref()
            .and_then(|id| self.accounts.iter().find(|a| a.id == id))
            .cloned();
        let several = self.accounts.len() > 1;
        let row = |label: &'static str, input: AnyElement| {
            div()
                .flex()
                .items_center()
                .gap_3()
                .child(
                    div()
                        .w(px(70.))
                        .flex_none()
                        .text_xs()
                        .text_color(theme::muted())
                        .child(label),
                )
                .child(div().flex_1().min_w_0().child(input))
        };
        let sending = composer.sending;
        let footer = div()
            .flex()
            .items_center()
            .gap_2()
            .child(div().flex_1().min_w_0().map(|el| match &composer.error {
                Some(error) => el.text_xs().text_color(theme::danger()).child(error.clone()),
                None => el,
            }))
            .child(
                button("cancel-compose", "Annuleren", "Esc", false)
                    .on_click(cx.listener(|this, _, window, cx| this.cancel_compose(window, cx))),
            )
            .child(
                button("send", if sending { "Versturen…" } else { "Versturen" }, "⌘↵", true)
                    .on_click(cx.listener(|this, _, window, cx| this.send_composed(window, cx))),
            );
        let body = if new {
            Textarea::new(&composer.body).h_full().into_any_element()
        } else {
            Textarea::new(&composer.body).into_any_element()
        };
        let element = div()
            .key_context("Composer")
            .on_action(cx.listener(|this, _: &SendMail, window, cx| this.send_composed(window, cx)))
            // The fields' own Escape bubbles up here when they have nothing else to undo.
            .on_action(cx.listener(|this, _: &Escape, window, cx| this.cancel_compose(window, cx)))
            .flex()
            .flex_col()
            .gap_2()
            .p_4()
            .when(new, |el| el.flex_1().min_h_0())
            .when(!new, |el| {
                el.flex_none()
                    .border_t_1()
                    .border_color(theme::border())
                    .bg(theme::sidebar())
            })
            .when(new, |el| {
                el.child(
                    div()
                        .pb_2()
                        .text_lg()
                        .font_weight(FontWeight::SEMIBOLD)
                        .child("Nieuwe mail"),
                )
                .child(row(
                    "Van",
                    account_picker(from.as_ref(), several)
                        .on_click(cx.listener(|this, _, _, cx| this.next_account(cx)))
                        .into_any_element(),
                ))
            })
            .child(row("Aan", Input::new(&composer.to).small().into_any_element()))
            .child(row("Cc", Input::new(&composer.cc).small().into_any_element()))
            .when(new, |el| {
                el.child(row(
                    "Onderwerp",
                    Input::new(&composer.subject).small().into_any_element(),
                ))
            })
            .child(div().when(new, |el| el.flex_1().min_h_0()).child(body))
            .child(footer);
        Some(element.into_any_element())
    }
}

fn field(
    placeholder: &'static str,
    value: &str,
    window: &mut Window,
    cx: &mut Context<MailView>,
) -> Entity<InputState> {
    let value = value.to_string();
    cx.new(|cx| {
        InputState::new(window, cx)
            .placeholder(placeholder)
            .default_value(value)
    })
}

fn account_picker(account: Option<&Account>, several: bool) -> Stateful<Div> {
    div()
        .id("from")
        .flex()
        .items_center()
        .gap_2()
        .h(px(28.))
        .px_2()
        .rounded_md()
        .text_sm()
        .when(several, |el| el.hover(|el| el.bg(theme::muted_bg())))
        .map(|el| match account {
            Some(account) => el
                .child(div().size(px(7.)).rounded_full().bg(theme::account(account.color)))
                .child(account.email.clone()),
            None => el.text_color(theme::muted()).child("Geen mailbox"),
        })
        .when(several, |el| {
            el.child(div().text_xs().text_color(theme::muted()).child("wisselen"))
        })
}

fn button(id: &'static str, label: &'static str, key: &'static str, primary: bool) -> Stateful<Div> {
    div()
        .id(id)
        .flex()
        .items_center()
        .gap_1p5()
        .h(px(30.))
        .px_3()
        .rounded_md()
        .text_xs()
        .font_weight(FontWeight::MEDIUM)
        .when(primary, |el| {
            el.bg(theme::primary())
                .text_color(rgb(0xffffff))
                .hover(|el| el.opacity(0.9))
        })
        .when(!primary, |el| {
            el.text_color(theme::muted())
                .hover(|el| el.bg(theme::muted_bg()).text_color(theme::foreground()))
        })
        .child(label)
        .child(div().opacity(0.7).child(key))
}

/// Who an answer goes to. R: whoever the newest message asks answers to go to, or
/// for a message we sent ourselves, its recipients again. A adds everyone else on
/// it to Cc. Our own mailboxes are never added, and nobody twice.
pub(super) fn reply_recipients(target: &ReplyTarget, own: &[String], all: bool) -> (Vec<Address>, Vec<Address>) {
    let is_own = |address: &Address| own.contains(&address.email.to_lowercase());
    let from_us = target.from.as_ref().is_some_and(is_own);
    let mut to: Vec<Address> = if from_us {
        target.to.clone()
    } else if !target.reply_to.is_empty() {
        target.reply_to.clone()
    } else {
        target.from.iter().cloned().collect()
    };
    to.retain(|address| !is_own(address));
    let mut seen: Vec<String> = to.iter().map(|a| a.email.to_lowercase()).collect();
    let mut cc = Vec::new();
    if all {
        // For our own message the To is already the answer's To.
        let extra: &[Address] = if from_us { &[] } else { &target.to };
        for address in extra.iter().chain(&target.cc) {
            let email = address.email.to_lowercase();
            if !is_own(address) && !seen.contains(&email) {
                seen.push(email);
                cc.push(address.clone());
            }
        }
    }
    (to, cc)
}

pub(super) fn format_addresses(addresses: &[Address]) -> String {
    addresses
        .iter()
        .map(
            |address| match address.name.as_deref().filter(|name| !name.is_empty()) {
                Some(name) => format!("{} <{}>", name.replace(['<', '>', ',', ';'], ""), address.email),
                None => address.email.clone(),
            },
        )
        .collect::<Vec<_>>()
        .join(", ")
}

/// "Naam <adres>" or a bare address, separated by commas or semicolons.
/// Gives back the first piece that is not an address.
pub(super) fn parse_addresses(text: &str) -> Result<Vec<Address>, String> {
    let mut out = Vec::new();
    for piece in text.split([',', ';']).map(str::trim).filter(|piece| !piece.is_empty()) {
        let (name, email) = match (piece.rfind('<'), piece.ends_with('>')) {
            (Some(open), true) => {
                let name = piece[..open].trim().trim_matches('"').trim();
                (
                    Some(name.to_string()).filter(|n| !n.is_empty()),
                    piece[open + 1..piece.len() - 1].trim(),
                )
            }
            _ => (None, piece),
        };
        let valid = email.len() <= 320
            && !email.contains(char::is_whitespace)
            && email
                .split_once('@')
                .is_some_and(|(local, domain)| !local.is_empty() && domain.contains('.') && !domain.starts_with('.'));
        if !valid {
            return Err(piece.to_string());
        }
        out.push(Address {
            name,
            email: email.to_string(),
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::{format_addresses, parse_addresses, reply_recipients, ReplyTarget};
    use crate::api::Address;

    fn a(name: Option<&str>, email: &str) -> Address {
        Address {
            name: name.map(String::from),
            email: email.into(),
        }
    }

    #[test]
    fn reads_addresses() {
        let parsed = parse_addresses(r#"Jan <jan@even.nl>; "Piet K" <piet@even.nl>, kees@even.nl"#).unwrap();
        assert_eq!(parsed.len(), 3);
        assert_eq!(parsed[0].name.as_deref(), Some("Jan"));
        assert_eq!(parsed[1].name.as_deref(), Some("Piet K"));
        assert_eq!(parsed[2].email, "kees@even.nl");
        assert_eq!(parse_addresses("jan@even.nl, nope").unwrap_err(), "nope");
        assert!(parse_addresses("  ").unwrap().is_empty());
    }

    #[test]
    fn formats_what_it_reads() {
        let list = vec![a(Some("Jan"), "jan@even.nl"), a(None, "kees@even.nl")];
        let text = format_addresses(&list);
        assert_eq!(text, "Jan <jan@even.nl>, kees@even.nl");
        assert_eq!(parse_addresses(&text).unwrap()[0].email, "jan@even.nl");
    }

    fn target(from: Address, reply_to: Vec<Address>, to: Vec<Address>, cc: Vec<Address>) -> ReplyTarget {
        ReplyTarget {
            message_id: "m".into(),
            from: Some(from),
            reply_to,
            to,
            cc,
        }
    }

    #[test]
    fn answers_go_where_they_should() {
        let own = vec!["me@even.nl".to_string()];
        let mail = target(
            a(Some("Jan"), "jan@even.nl"),
            vec![],
            vec![a(None, "ME@even.nl"), a(None, "piet@even.nl")],
            vec![a(None, "kees@even.nl"), a(None, "jan@even.nl")],
        );
        let (to, cc) = reply_recipients(&mail, &own, false);
        assert_eq!(to.iter().map(|a| a.email.as_str()).collect::<Vec<_>>(), ["jan@even.nl"]);
        assert!(cc.is_empty());
        let (to, cc) = reply_recipients(&mail, &own, true);
        assert_eq!(to.len(), 1);
        assert_eq!(
            cc.iter().map(|a| a.email.as_str()).collect::<Vec<_>>(),
            ["piet@even.nl", "kees@even.nl"]
        );
    }

    #[test]
    fn reply_to_wins_and_our_own_mail_goes_back_to_its_recipients() {
        let own = vec!["me@even.nl".to_string()];
        let list = target(a(None, "news@shop.nl"), vec![a(None, "help@shop.nl")], vec![], vec![]);
        assert_eq!(reply_recipients(&list, &own, false).0[0].email, "help@shop.nl");
        let sent = target(a(None, "me@even.nl"), vec![], vec![a(None, "jan@even.nl")], vec![]);
        assert_eq!(reply_recipients(&sent, &own, false).0[0].email, "jan@even.nl");
    }
}
