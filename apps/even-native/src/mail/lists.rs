//! The lists that aren't a folder's conversations (apps/mail-web/src/pages/
//! inbox.tsx): drafts, parcels, invoices, snoozed, scheduled and Tidy up's
//! senders, each laid out as a mail line; and what the reading pane shows
//! with no conversation open: the day (components/empty-pane.tsx) or one
//! sender (components/sender-pane.tsx).

use super::api::{Draft, Invoice, Sender, Shipment};
use super::list::{failed, list_empty, note, row_actions, row_button, skeleton, RowAction};
use super::overlays::{Confirm, Recognition};
use super::*;

/// Invoices: All, To pay, Paid.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum InvoiceFilter {
    All,
    Due,
    Paid,
}

/// Which mail is read in the background for a list (`useBackgroundScan`).
#[derive(Clone, Copy, PartialEq, Eq)]
enum Scan {
    Shipments,
    Invoices,
}

/// The carriers by their names (`CARRIER_NAMES` in lib/shipments.ts).
fn carrier_name(carrier: &str) -> &'static str {
    match carrier {
        "postnl" => "PostNL",
        "dhl" => "DHL",
        "dpd" => "DPD",
        "gls" => "GLS",
        "ups" => "UPS",
        "budbee" => "Budbee",
        "trunkrs" => "Trunkrs",
        "dragonfly" => "Dragonfly",
        "amazon" => "Amazon",
        _ => "",
    }
}

/// Tailwind's emerald-500, sky-500 and violet-500, as the web's status dots.
const EMERALD: u32 = 0x00bc7dff;
const SKY: u32 = 0x00a6f4ff;
const VIOLET: u32 = 0x8e51ffff;

/// A coloured dot and the status in words (`Status` in components/parcels.tsx).
fn parcel_status(shipment: &Shipment) -> Div {
    let (tone, label) = match shipment.status.as_deref().unwrap_or("unknown") {
        "announced" => (theme::mix(theme::muted(), 50.), t("Announced", "Aangemeld")),
        "in_transit" => (rgba(SKY), t("On its way", "Onderweg")),
        "out_for_delivery" => (theme::primary_mark(), t("Arriving today", "Komt vandaag")),
        "pickup" => (rgba(VIOLET), t("Ready for pickup", "Ligt klaar")),
        "delivered" => (rgba(EMERALD), t("Delivered", "Bezorgd")),
        "problem" => (theme::danger(), t("Needs attention", "Let op")),
        _ => (theme::mix(theme::muted(), 50.), t("Shipped", "Verzonden")),
    };
    div()
        .flex()
        .flex_none()
        .items_center()
        .gap(px(6.))
        .child(div().flex_none().size(px(6.)).rounded_full().bg(tone))
        .child(label)
}

/// The status in words with its dot, and when it must be paid by or that it
/// is late (`InvoiceStatus` in components/invoices.tsx).
fn invoice_status(invoice: &Invoice) -> Div {
    let tone = if invoice.status == "failed" || invoice.overdue {
        theme::danger()
    } else {
        match invoice.status.as_str() {
            "paid" => rgba(EMERALD),
            "auto" => theme::mix(theme::muted(), 50.),
            _ => theme::primary_mark(),
        }
    };
    let mut label = if invoice.overdue {
        t("Overdue", "Te laat").to_string()
    } else {
        match invoice.status.as_str() {
            "paid" => t("Paid", "Betaald"),
            "auto" => t("Collected automatically", "Wordt automatisch afgeschreven"),
            "failed" => t("Payment failed", "Betaling mislukt"),
            _ => t("To pay", "Te betalen"),
        }
        .to_string()
    };
    if let Some(due) = invoice.due_date.as_deref().filter(|_| invoice.status == "due") {
        let date = format::due_label(due);
        label.push_str(&t(format!(" · due {date}"), format!(" · vóór {date}")));
    }
    div()
        .flex()
        .min_w_0()
        .items_center()
        .gap(px(6.))
        .child(div().flex_none().size(px(6.)).rounded_full().bg(tone))
        .child(div().min_w_0().truncate().child(label))
}

/// A line's first row: what it is about, and something at its end that the
/// quick actions cover on hover.
fn head(title: impl IntoElement, end: impl IntoElement, covered: bool) -> Div {
    div()
        .flex()
        .items_center()
        .gap(px(8.))
        .child(div().flex_1().min_w_0().truncate().child(title))
        .child(
            div()
                .flex_none()
                .text_size(px(12.))
                .text_color(theme::muted())
                .when(covered, |el| el.group_hover("row", |el| el.invisible()))
                .child(end),
        )
}

/// A line with its quick actions, as a row of a list.
fn line(index: usize, button: Stateful<Div>, actions: Vec<RowAction>, cx: &mut Context<MailView>) -> Div {
    div()
        .group("row")
        .relative()
        .child(button)
        .child(row_actions(index, actions, cx))
}

/// The rows of a list, inset like the conversations.
fn rows(children: Vec<AnyElement>) -> Div {
    div().flex().flex_col().gap(px(2.)).px(px(8.)).pb(px(8.)).children(children)
}

/// `oklch(0.6 0.12 hue)` in sRGB: a contact's colour (components/contact-avatar.tsx).
pub(super) fn avatar_color(email: &str) -> Rgba {
    let mut hash: u32 = 0;
    for unit in email.to_lowercase().encode_utf16() {
        hash = hash.wrapping_mul(31).wrapping_add(unit as u32);
    }
    let hue = ((hash % 360) as f32).to_radians();
    let (l, a, b) = (0.6_f32, 0.12 * hue.cos(), 0.12 * hue.sin());
    let l_ = (l + 0.396_337_78 * a + 0.215_803_76 * b).powi(3);
    let m_ = (l - 0.105_561_346 * a - 0.063_854_17 * b).powi(3);
    let s_ = (l - 0.089_484_18 * a - 1.291_485_5 * b).powi(3);
    let linear = [
        4.076_741_7 * l_ - 3.307_711_6 * m_ + 0.230_969_94 * s_,
        -1.268_438 * l_ + 2.609_757_4 * m_ - 0.341_319_38 * s_,
        -0.004_196_086_3 * l_ - 0.703_418_6 * m_ + 1.707_614_7 * s_,
    ];
    let gamma = |value: f32| {
        let value = value.clamp(0., 1.);
        if value <= 0.003_130_8 {
            12.92 * value
        } else {
            1.055 * value.powf(1. / 2.4) - 0.055
        }
    };
    Rgba {
        r: gamma(linear[0]),
        g: gamma(linear[1]),
        b: gamma(linear[2]),
        a: 1.,
    }
}

/// "Jorn Boerema" → "JB", "jorn | Daize" → "JD", no name → the address's first letter.
pub(super) fn initials_of(name: Option<&str>, email: &str) -> String {
    let words: Vec<&str> = name
        .unwrap_or_default()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .collect();
    let letters: Vec<&str> = match words.as_slice() {
        [] => vec![email],
        [only] => vec![only],
        [first, .., last] => vec![first, last],
    };
    letters
        .iter()
        .filter_map(|word| word.chars().next())
        .flat_map(char::to_uppercase)
        .collect()
}

impl MailView {
    fn in_mailbox(&self, account: Option<&str>) -> bool {
        self.filter.is_empty() || account == Some(self.filter.as_str())
    }

    pub(super) fn load_shipments(&mut self, cx: &mut Context<Self>) {
        self.fetch(cx, api::shipments, |this, result, _| this.shipments.set(result));
        self.scan(Scan::Shipments, cx);
    }

    pub(super) fn load_invoices(&mut self, cx: &mut Context<Self>) {
        self.fetch(cx, api::invoices, |this, result, _| this.invoices.set(result));
        self.scan(Scan::Invoices, cx);
    }

    /// Reads mail not seen yet, round after round, while the list shows what
    /// is already known. Each round that found something refreshes the list.
    fn scan(&mut self, scan: Scan, cx: &mut Context<Self>) {
        let path = match scan {
            Scan::Shipments => "/api/mail/shipments/scan",
            Scan::Invoices => "/api/mail/invoices/scan",
        };
        self.fetch(
            cx,
            move |client| api::scan(client, path),
            move |this, result, cx| {
                // Reading failed: the list stays as it is.
                let (done, read) = result.unwrap_or((true, 0));
                match scan {
                    Scan::Shipments => this.shipments_complete = done,
                    Scan::Invoices => this.invoices_complete = done,
                }
                if read > 0 {
                    match scan {
                        Scan::Shipments => this.fetch(cx, api::shipments, |this, result, _| this.shipments.set(result)),
                        Scan::Invoices => this.fetch(cx, api::invoices, |this, result, _| this.invoices.set(result)),
                    }
                }
                let showing = match scan {
                    Scan::Shipments => this.view == View::Parcels,
                    Scan::Invoices => this.view == View::Invoices,
                };
                if !done && showing {
                    cx.spawn(async move |this, cx| {
                        cx.background_executor().timer(Duration::from_millis(500)).await;
                        let _ = this.update(cx, |this, cx| this.scan(scan, cx));
                    })
                    .detach();
                }
            },
        );
    }

    pub(super) fn load_senders(&mut self, cx: &mut Context<Self>) {
        let account = self.filter.clone();
        self.fetch(
            cx,
            move |client| api::senders(client, &account).map(|senders| (account, senders)),
            |this, result, _| match result {
                Ok((account, senders)) if account == this.filter => this.senders.set(Ok(senders)),
                Ok(_) => {}
                Err(error) => this.senders.set(Err(error)),
            },
        );
    }

    /// A sender opens their pane, not a mail; their mail opens from there.
    pub(super) fn pick_sender(&mut self, email: String, cx: &mut Context<Self>) {
        self.open = None;
        self.sender_threads = Loaded::default();
        self.picked_sender = Some(email.clone());
        let account = self.filter.clone();
        self.fetch(
            cx,
            move |client| api::sender_conversations(client, &email, &account).map(|threads| (email, threads)),
            |this, result, _| match result {
                Ok((email, threads)) if this.picked_sender.as_deref() == Some(email.as_str()) => {
                    this.sender_threads.set(Ok(threads))
                }
                Ok(_) => {}
                Err(error) => this.sender_threads.set(Err(error)),
            },
        );
        cx.notify();
    }

    /// Archive and trash ask first, from the list or the sender pane; read goes straight away.
    fn act_on_sender(&mut self, sender: Sender, action: &'static str, window: &mut Window, cx: &mut Context<Self>) {
        if action == "read" {
            self.tidy(sender, action, cx);
        } else {
            self.confirm(Confirm::Sender { sender, action }, window, cx);
        }
    }

    /// Everything from one sender at once: archive, mark read or trash, in
    /// rounds the API can finish in time, with a toast that counts along
    /// (`useTidy` in lib/senders.ts).
    pub(super) fn tidy(&mut self, sender: Sender, action: &'static str, cx: &mut Context<Self>) {
        let total = if action == "read" { sender.unread } else { sender.conversations };
        let key = format!("tidy:{}:{action}", sender.email);
        let counting = move |done: u64| {
            let (done, total) = (format::number(done.min(total)), format::number(total));
            match action {
                "archive" => t(format!("Archiving… {done} of {total}"), format!("Archiveren… {done} van {total}")),
                "read" => t(
                    format!("Marking read… {done} of {total}"),
                    format!("Gelezen markeren… {done} van {total}"),
                ),
                _ => t(format!("Deleting… {done} of {total}"), format!("Verwijderen… {done} van {total}")),
            }
        };
        self.toast_keyed(&key, counting(0), ToastKind::Loading, None, cx);
        let client = self.client.clone();
        let account = self.filter.clone();
        cx.spawn(async move |this, cx| {
            let mut done = 0;
            let outcome = loop {
                let (client, email, account) = (client.clone(), sender.email.clone(), account.clone());
                let round = cx
                    .background_executor()
                    .spawn(async move { api::sender_action(&client, &email, action, &account) })
                    .await;
                match round {
                    Ok((handled, remaining)) => {
                        done += handled;
                        if remaining == 0 {
                            break Ok(());
                        }
                        // A round that got nowhere won't do better next time.
                        if handled == 0 {
                            break Err(None);
                        }
                        let text = counting(done);
                        let key = key.clone();
                        if this
                            .update(cx, |this, cx| {
                                this.toast_keyed(&key, text, ToastKind::Loading, None, cx);
                            })
                            .is_err()
                        {
                            return;
                        }
                    }
                    Err(error) => break Err(Some(error)),
                }
            };
            let _ = this.update(cx, |this, cx| {
                let name = sender.label().to_string();
                let count = format::number(done);
                match outcome {
                    Ok(()) => {
                        let finished = match action {
                            "archive" => t(
                                format!("{count} conversations from {name} archived"),
                                format!("{count} gesprekken van {name} gearchiveerd"),
                            ),
                            "read" => t(
                                format!("Everything from {name} marked read"),
                                format!("Alles van {name} gelezen"),
                            ),
                            _ => t(
                                format!("{count} conversations from {name} moved to the trash"),
                                format!("{count} gesprekken van {name} naar de prullenbak"),
                            ),
                        };
                        this.toast_keyed(&key, finished, ToastKind::Success, None, cx);
                    }
                    Err(None) => {
                        this.toast_keyed(
                            &key,
                            t(
                                "Stopped partway; try again for the rest.",
                                "Halverwege gestopt; probeer het nog eens voor de rest.",
                            ),
                            ToastKind::Error,
                            None,
                            cx,
                        );
                    }
                    Err(Some(error)) if error.downcast_ref::<Unauthorized>().is_some() => cx.emit(SignedOut),
                    Err(Some(error)) => {
                        let text = error
                            .downcast_ref::<crate::api::ApiError>()
                            .map(|error| error.message.clone())
                            .unwrap_or_else(|| error.to_string());
                        this.toast_keyed(&key, text, ToastKind::Error, None, cx);
                    }
                }
                this.load_senders(cx);
                this.refresh_lists(cx);
            });
        })
        .detach();
    }

    /// Unsubscribing goes through their newest message.
    fn unsubscribe(&mut self, sender: Sender, cx: &mut Context<Self>) {
        let name = sender.label().to_string();
        let none = t(format!("{name} offers no unsubscribe link."), format!("{name} biedt geen uitschrijflink."));
        let Some(thread) = sender.thread.clone() else {
            self.toast(none, ToastKind::Error, None, false, cx);
            return;
        };
        let message = sender.provider_message_id.clone();
        self.fetch(
            cx,
            move |client| api::unsubscribe(client, &thread.id, &message),
            move |this, result, cx| match result {
                // The page to finish on opens in the browser.
                Ok(Some(url)) => {
                    let _ = open::that_detached(url);
                }
                Ok(None) => {
                    this.toast(
                        t(format!("Unsubscribed from {name}"), format!("Uitgeschreven bij {name}")),
                        ToastKind::Success,
                        Some((
                            t("Archive all too", "Ook alles archiveren").into(),
                            ToastAction::AlsoArchive(sender.email.clone()),
                        )),
                        false,
                        cx,
                    );
                }
                // Nothing in their headers to unsubscribe with.
                Err(error)
                    if error
                        .downcast_ref::<crate::api::ApiError>()
                        .is_some_and(|error| error.status == 400) =>
                {
                    this.toast(none.clone(), ToastKind::Error, None, false, cx);
                }
                Err(error) => this.toast_error(error, cx),
            },
        );
    }

    /// "Not recognised well": out of the list, and a report to improve the reading.
    pub(super) fn report_recognition(&mut self, kind: Recognition, thread: String, reason: &'static str, cx: &mut Context<Self>) {
        let path = format!(
            "/api/mail/threads/{}/recognition/report",
            url::form_urlencoded::byte_serialize(thread.as_bytes()).collect::<String>()
        );
        let name = match kind {
            Recognition::Parcel => "parcel",
            Recognition::Invoice => "invoice",
        };
        self.fetch(
            cx,
            move |client| client.post_json::<serde_json::Value>(&path, &api::report_body(name, reason)),
            move |this, result, cx| match result {
                Ok(_) => {
                    this.toast(
                        t("Thanks, it's off the list", "Bedankt, hij staat niet meer in de lijst"),
                        ToastKind::Success,
                        None,
                        false,
                        cx,
                    );
                    match kind {
                        Recognition::Parcel => this.fetch(cx, api::shipments, |this, result, _| this.shipments.set(result)),
                        Recognition::Invoice => this.fetch(cx, api::invoices, |this, result, _| this.invoices.set(result)),
                    }
                }
                Err(error) => this.toast_error(error, cx),
            },
        );
    }

    fn delete_draft(&mut self, account: String, id: String, cx: &mut Context<Self>) {
        // The draft open in the composer goes through it, so saving can't bring it back.
        if self.discard_open_draft(&id, cx) {
            return;
        }
        if let Some(drafts) = &mut self.drafts.data {
            drafts.drafts.retain(|draft| draft.id != id);
        }
        self.fetch(
            cx,
            move |client| api::delete_draft(client, &account, &id),
            |this, result, cx| {
                if let Err(error) = result {
                    this.toast_error(error, cx);
                }
                this.load_drafts(cx);
            },
        );
        cx.notify();
    }

    /// All, To pay, Paid, as one small segmented control that stays put while
    /// the list scrolls under it (`.invoice-filter`).
    pub(super) fn render_invoice_filter(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        if self.view != View::Invoices {
            return None;
        }
        // What is still yours to pay, per currency.
        let mut sums: Vec<(String, i64)> = Vec::new();
        for invoice in self.invoices.data.iter().flatten() {
            let account = invoice.thread.as_ref().map(|thread| thread.account_id.as_str());
            if !self.in_mailbox(account) || !invoice.is_open() {
                continue;
            }
            let Some(cents) = invoice.amount_cents else { continue };
            let currency = invoice.currency.clone().unwrap_or_else(|| "EUR".into());
            match sums.iter_mut().find(|(name, _)| *name == currency) {
                Some((_, sum)) => *sum += cents,
                None => sums.push((currency, cents)),
            }
        }
        let to_pay = sums
            .iter()
            .map(|(currency, cents)| format::money(*cents, Some(currency), true))
            .collect::<Vec<_>>()
            .join(" + ");
        let tab = |filter: InvoiceFilter, label: &'static str, key: &'static str| {
            let selected = self.invoice_filter == filter;
            div()
                .id(key)
                .flex()
                .items_center()
                .px(px(10.))
                .py(px(3.))
                .rounded(theme::RADIUS_SM)
                .text_size(px(12.))
                .line_height(px(16.))
                .font_weight(FontWeight::MEDIUM)
                .cursor_pointer()
                .text_color(theme::muted())
                .when(selected, |el| {
                    el.bg(theme::background()).text_color(theme::foreground()).shadow_sm()
                })
                .when(!selected, |el| el.hover(|el| el.text_color(theme::foreground())))
                .child(label)
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.invoice_filter = filter;
                    cx.notify();
                }))
        };
        Some(
            div()
                .flex()
                .flex_none()
                .pr(px(16.))
                .pb(px(8.))
                .pl(px(40.))
                .child(
                    div()
                        .flex()
                        .gap(px(2.))
                        .p(px(2.))
                        .rounded(theme::RADIUS_MD)
                        .bg(theme::mix(theme::foreground(), 6.))
                        .child(tab(InvoiceFilter::All, t("All", "Alles"), "invoices-all"))
                        .child(
                            tab(InvoiceFilter::Due, t("To pay", "Te betalen"), "invoices-due").when(
                                !to_pay.is_empty(),
                                |el| el.child(div().ml(px(6.)).text_color(theme::primary_mark()).child(to_pay)),
                            ),
                        )
                        .child(tab(InvoiceFilter::Paid, t("Paid", "Betaald"), "invoices-paid")),
                )
                .into_any_element(),
        )
    }

    pub(super) fn render_other_list(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let content = match self.view {
            View::Drafts => self.render_drafts(cx),
            View::Parcels => self.render_parcels(cx),
            View::Invoices => self.render_invoices(cx),
            View::Snoozed => self.render_snoozed(cx),
            View::Scheduled => self.render_scheduled(cx),
            _ => self.render_senders(window, cx),
        };
        div()
            .id("other-list")
            .flex()
            .flex_col()
            .size_full()
            .overflow_y_scroll()
            .children(content)
            .into_any_element()
    }

    fn render_drafts(&self, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let Some(drafts) = &self.drafts.data else {
            return vec![if self.drafts.failed {
                failed(t("Your drafts couldn't be loaded.", "Je concepten konden niet worden geladen."), false)
                    .into_any_element()
            } else {
                skeleton(false).into_any_element()
            }];
        };
        let several = self.mailboxes.len() > 1;
        let shown: Vec<&Draft> = drafts
            .drafts
            .iter()
            .filter(|draft| self.in_mailbox(Some(&draft.account_id)))
            .collect();
        let mut content = Vec::new();
        if !drafts.failed_accounts.is_empty() {
            content.push(
                div()
                    .px(px(16.))
                    .pb(px(8.))
                    .text_size(px(12.))
                    .text_color(theme::muted())
                    .child(t(
                        "Drafts from some mailboxes couldn't be loaded.",
                        "Concepten van sommige mailboxen konden niet worden geladen.",
                    ))
                    .into_any_element(),
            );
        }
        if shown.is_empty() {
            content.push(
                list_empty(
                    "file-01",
                    t("No drafts", "Geen concepten"),
                    Some(
                        t(
                            "A message becomes a draft as soon as you start writing it.",
                            "Een bericht wordt een concept zodra je eraan begint.",
                        )
                        .into(),
                    ),
                )
                .into_any_element(),
            );
            return content;
        }
        let lines = shown
            .into_iter()
            .enumerate()
            .map(|(index, draft)| {
                let recipients = draft.to.iter().map(|address| address.label()).collect::<Vec<_>>().join(", ");
                let none = recipients.is_empty();
                let subject = subject_or_none(&draft.subject);
                let text = if draft.snippet.is_empty() {
                    subject.clone()
                } else {
                    format!("{subject} · {}", draft.snippet)
                };
                let text = StyledText::new(text).with_highlights([(
                    0..subject.len(),
                    HighlightStyle {
                        color: Some(theme::foreground().into()),
                        ..Default::default()
                    },
                )]);
                let color = several
                    .then(|| self.mailbox(&draft.account_id).map(|mailbox| mailbox.color))
                    .flatten();
                // Drafts sit flush: there is no unread dot or checkbox to leave room for.
                let selected = self.composing() && self.open_draft_id() == Some(draft.id.as_str());
                let button = row_button(("draft", index), selected, false)
                    .pl(px(10.))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(8.))
                            .child(
                                div()
                                    .flex_1()
                                    .min_w_0()
                                    .truncate()
                                    .when(none, |el| el.text_color(theme::muted()))
                                    .child(if none {
                                        t("No recipients", "Geen ontvangers").to_string()
                                    } else {
                                        recipients
                                    }),
                            )
                            .when(draft.has_attachments, |el| {
                                el.child(
                                    theme::hi("attachment-01")
                                        .size(px(14.))
                                        .text_color(theme::muted())
                                        .group_hover("row", |el| el.invisible()),
                                )
                            })
                            .child(
                                div()
                                    .flex_none()
                                    .text_size(px(12.))
                                    .text_color(theme::muted())
                                    .group_hover("row", |el| el.invisible())
                                    .child(format::short_date(draft.updated_at)),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(8.))
                            .child(div().flex_1().min_w_0().truncate().text_color(theme::muted()).child(text))
                            .when_some(color, |el, color| {
                                el.child(div().flex_none().mr(px(2.)).size(px(8.)).rounded_full().bg(theme::account(color)))
                            }),
                    )
                    // Opens in the composer, to go on writing (compose.rs).
                    .on_click(cx.listener({
                        let (account, id) = (draft.account_id.clone(), draft.id.clone());
                        move |this, _, window, cx| this.open_draft(account.clone(), id.clone(), window, cx)
                    }));
                let (account, id) = (draft.account_id.clone(), draft.id.clone());
                let actions = vec![RowAction::new("delete-02", t("Discard", "Weggooien"), move |this, _, cx| {
                    this.delete_draft(account.clone(), id.clone(), cx)
                })
                .destructive(true)];
                line(index, button, actions, cx).into_any_element()
            })
            .collect();
        content.push(rows(lines).into_any_element());
        content
    }

    /// A delivery, laid out as a mail line: opens its mail; tracking on hover (`ParcelRow`).
    fn parcel_row(&self, index: usize, shipment: &Shipment, compact: bool, cx: &mut Context<Self>) -> AnyElement {
        let carrier = shipment.carrier.as_deref().map(carrier_name).filter(|name| !name.is_empty());
        let title = shipment
            .merchant
            .clone()
            .or_else(|| carrier.map(str::to_string))
            .unwrap_or_else(|| t("Parcel", "Pakket").to_string());
        let via = shipment.merchant.as_ref().and(carrier);
        let selected = shipment
            .thread
            .as_ref()
            .is_some_and(|thread| self.open_id() == Some(thread.id.as_str()));
        let reportable = shipment
            .thread
            .as_ref()
            .map(|thread| thread.id.clone())
            .filter(|id| !id.starts_with(crate::api::REMOTE));
        let covered = shipment.tracking_url.is_some() || reportable.is_some();
        let title = match via.filter(|_| compact) {
            Some(via) => {
                let start = title.len();
                let text = format!("{title} · {via}");
                let end = text.len();
                StyledText::new(text).with_highlights([(
                    start..end,
                    HighlightStyle {
                        color: Some(theme::muted().into()),
                        ..Default::default()
                    },
                )])
            }
            None => StyledText::new(title),
        };
        let thread = shipment.thread.clone();
        let button = row_button(("parcel", index + if compact { 10_000 } else { 0 }), selected, false)
            .when(compact, |el| el.py(px(6.)))
            .when(thread.is_none(), |el| el.cursor_default())
            .child(head(
                div().when(!compact, |el| el.font_weight(FontWeight::MEDIUM)).child(title),
                format::short_date(shipment.received_at),
                covered,
            ))
            .when(!compact, |el| {
                el.child(
                    div()
                        .flex()
                        .min_w_0()
                        .items_center()
                        .gap(px(6.))
                        .text_color(theme::muted())
                        .child(parcel_status(shipment))
                        .when_some(via, |el, via| el.child(div().min_w_0().truncate().child(format!("· {via}")))),
                )
            })
            .on_click(cx.listener(move |this, _, _, cx| {
                if let Some(thread) = thread.clone() {
                    this.open_thread(thread, cx);
                }
            }));
        let mut actions = Vec::new();
        if let Some(url) = shipment.tracking_url.clone() {
            actions.push(RowAction::new(
                "arrow-up-right-01",
                t("Track parcel", "Pakket volgen"),
                move |_, _, _| {
                    let _ = open::that_detached(&url);
                },
            ));
        }
        if let Some(thread) = reportable {
            actions.push(RowAction::new(
                "flag-02",
                t("Not recognised well", "Niet goed herkend"),
                move |this, window, cx| {
                    this.confirm(
                        Confirm::Report {
                            kind: Recognition::Parcel,
                            thread: thread.clone(),
                        },
                        window,
                        cx,
                    )
                },
            ));
        }
        line(index, button, actions, cx)
            // Arrived parcels stay quiet; only the one under the pointer comes forward.
            .when(compact && !selected, |el| el.opacity(0.7).hover(|el| el.opacity(1.)))
            .into_any_element()
    }

    fn render_parcels(&self, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let Some(shipments) = &self.shipments.data else {
            return vec![if self.shipments.failed {
                failed(t("The parcels couldn't be loaded.", "De pakketjes konden niet geladen worden."), false)
                    .into_any_element()
            } else {
                skeleton(true).into_any_element()
            }];
        };
        let complete = self.shipments_complete;
        let all: Vec<&Shipment> = shipments
            .iter()
            .filter(|shipment| self.in_mailbox(shipment.thread.as_ref().map(|thread| thread.account_id.as_str())))
            .collect();
        let delivered = all.iter().filter(|shipment| shipment.status.as_deref() == Some("delivered")).count();
        // Arrived parcels stay out of the way unless the filter in the header shows them.
        let shown: Vec<&Shipment> = if settings::show_delivered() {
            all.clone()
        } else {
            all.iter().copied().filter(|shipment| shipment.status.as_deref() != Some("delivered")).collect()
        };
        let still_reading = t(
            "Still reading some shipping mail; more may follow.",
            "Nog bezig met wat verzendmail; er kunnen er meer bijkomen.",
        );
        let mut content = Vec::new();
        if shown.is_empty() && (delivered == 0 || !complete) {
            content.push(if complete {
                list_empty(
                    "package",
                    t("No parcels on their way", "Geen pakketjes onderweg"),
                    Some(
                        t(
                            "Shipping mail with a track & trace link shows up here.",
                            "Verzendmail met een track & trace-link komt hier te staan.",
                        )
                        .into(),
                    ),
                )
                .into_any_element()
            } else {
                note(still_reading, true).into_any_element()
            });
            return content;
        }
        if shown.is_empty() {
            // Nothing on its way: say so, and show what arrived lately instead of an empty list.
            content.push(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(2.))
                    .pt(px(8.))
                    .pr(px(16.))
                    .pb(px(16.))
                    .pl(px(40.))
                    .text_size(px(14.))
                    .child(
                        div()
                            .font_weight(FontWeight::MEDIUM)
                            .child(t("Nothing on its way", "Er is niets onderweg")),
                    )
                    .child(
                        div()
                            .text_color(theme::muted())
                            .child(t("Everything you ordered has arrived.", "Alles wat je bestelde is binnen.")),
                    )
                    .into_any_element(),
            );
            content.push(
                div()
                    .pr(px(16.))
                    .pb(px(4.))
                    .pl(px(40.))
                    .text_size(px(12.))
                    .text_color(theme::muted())
                    .child(t("Recently delivered", "Recent bezorgd"))
                    .into_any_element(),
            );
            let lines = all
                .iter()
                .enumerate()
                .map(|(index, shipment)| self.parcel_row(index, shipment, true, cx))
                .collect();
            content.push(rows(lines).into_any_element());
            return content;
        }
        let lines = shown
            .iter()
            .enumerate()
            .map(|(index, shipment)| self.parcel_row(index, shipment, false, cx))
            .collect();
        content.push(rows(lines).into_any_element());
        if !complete {
            content.push(
                div()
                    .px(px(16.))
                    .pb(px(12.))
                    .text_size(px(12.))
                    .text_color(theme::muted())
                    .child(still_reading)
                    .into_any_element(),
            );
        }
        content
    }

    fn render_invoices(&self, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let Some(invoices) = &self.invoices.data else {
            return vec![if self.invoices.failed {
                failed(t("The invoices couldn't be loaded.", "De facturen konden niet geladen worden."), true)
                    .into_any_element()
            } else {
                skeleton(true).into_any_element()
            }];
        };
        let all: Vec<&Invoice> = invoices
            .iter()
            .filter(|invoice| self.in_mailbox(invoice.thread.as_ref().map(|thread| thread.account_id.as_str())))
            .collect();
        let shown: Vec<&Invoice> = all
            .iter()
            .copied()
            .filter(|invoice| match self.invoice_filter {
                InvoiceFilter::All => true,
                InvoiceFilter::Due => invoice.is_open(),
                InvoiceFilter::Paid => !invoice.is_open(),
            })
            .collect();
        let still_reading = t(
            "Still reading some mail about money; more may follow.",
            "Nog bezig met wat mail over geld; er kunnen er meer bijkomen.",
        );
        if shown.is_empty() {
            return vec![if !self.invoices_complete {
                note(still_reading, true).into_any_element()
            } else if all.is_empty() {
                list_empty(
                    "invoice-02",
                    t("No invoices", "Geen facturen"),
                    Some(
                        t(
                            "No invoices or payments in your mail from the last months.",
                            "Geen facturen of betalingen in je mail van de laatste maanden.",
                        )
                        .into(),
                    ),
                )
                .into_any_element()
            } else {
                list_empty("invoice-02", t("Nothing here.", "Hier staat niets."), None).into_any_element()
            }];
        }
        let lines = shown
            .iter()
            .enumerate()
            .map(|(index, invoice)| {
                let selected = invoice
                    .thread
                    .as_ref()
                    .is_some_and(|thread| self.open_id() == Some(thread.id.as_str()));
                let reportable = invoice
                    .thread
                    .as_ref()
                    .map(|thread| thread.id.clone())
                    .filter(|id| !id.starts_with(crate::api::REMOTE));
                let covered = invoice.pay_url.is_some() || reportable.is_some();
                let amount = match invoice.amount_cents {
                    Some(cents) => format::money(cents, invoice.currency.as_deref(), false),
                    None => "—".to_string(),
                };
                let thread = invoice.thread.clone();
                let button = row_button(("invoice", index), selected, false)
                    .when(thread.is_none(), |el| el.cursor_default())
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(8.))
                            .child(
                                div()
                                    .flex_1()
                                    .min_w_0()
                                    .truncate()
                                    .font_weight(FontWeight::MEDIUM)
                                    .child(invoice.vendor.clone().unwrap_or_else(|| invoice.subject.clone())),
                            )
                            .child(
                                div()
                                    .flex_none()
                                    .when(covered, |el| el.group_hover("row", |el| el.invisible()))
                                    .child(amount),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .min_w_0()
                            .items_center()
                            .gap(px(8.))
                            .text_color(theme::muted())
                            .child(invoice_status(invoice))
                            .child(
                                div()
                                    .ml_auto()
                                    .flex_none()
                                    .text_size(px(12.))
                                    .child(format::short_date(invoice.received_at)),
                            ),
                    )
                    .on_click(cx.listener(move |this, _, _, cx| {
                        if let Some(thread) = thread.clone() {
                            this.open_thread(thread, cx);
                        }
                    }));
                let mut actions = Vec::new();
                if let Some(url) = invoice.pay_url.clone() {
                    actions.push(RowAction::new("arrow-up-right-01", t("Pay", "Betalen"), move |_, _, _| {
                        let _ = open::that_detached(&url);
                    }));
                }
                if let Some(thread) = reportable {
                    actions.push(RowAction::new(
                        "flag-02",
                        t("Not recognised well", "Niet goed herkend"),
                        move |this, window, cx| {
                            this.confirm(
                                Confirm::Report {
                                    kind: Recognition::Invoice,
                                    thread: thread.clone(),
                                },
                                window,
                                cx,
                            )
                        },
                    ));
                }
                line(index, button, actions, cx).into_any_element()
            })
            .collect();
        let mut content = vec![rows(lines).into_any_element()];
        if !self.invoices_complete {
            content.push(
                div()
                    .px(px(16.))
                    .pb(px(12.))
                    .pl(px(40.))
                    .text_size(px(12.))
                    .text_color(theme::muted())
                    .child(still_reading)
                    .into_any_element(),
            );
        }
        content
    }

    /// A snoozed or scheduled message, laid out as a mail line, with its moment (`LaterRow`).
    fn later_row(
        id: impl Into<ElementId>,
        title: String,
        subject: String,
        when: String,
        failed: bool,
        selected: bool,
    ) -> Stateful<Div> {
        row_button(id, selected, false)
            .child(
                head(div().font_weight(FontWeight::MEDIUM).child(title), when, true)
                    .when(failed, |el| el.text_color(theme::danger())),
            )
            .child(div().min_w_0().truncate().text_color(theme::muted()).child(subject))
    }

    fn render_snoozed(&self, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let Some(snoozes) = &self.snoozes.data else {
            return vec![skeleton(true).into_any_element()];
        };
        let shown: Vec<_> = snoozes
            .snoozed
            .iter()
            .filter(|item| self.in_mailbox(Some(&item.thread.account_id)))
            .collect();
        if shown.is_empty() {
            return vec![note(
                t(
                    "Nothing snoozed. Snooze a conversation (B) to have it back when it suits you.",
                    "Niets gesnoozed. Snooze een gesprek (B) om het terug te krijgen wanneer het jou uitkomt.",
                ),
                true,
            )
            .into_any_element()];
        }
        let lines = shown
            .into_iter()
            .enumerate()
            .map(|(index, item)| {
                let when = format::moment_of(item.until);
                let thread = item.thread.clone();
                let button = Self::later_row(
                    ("snoozed", index),
                    sender_name(&item.thread),
                    subject_of(&item.thread),
                    t(format!("Back {when}"), format!("Terug {when}")),
                    false,
                    self.open_id() == Some(item.thread.id.as_str()),
                )
                .on_click(cx.listener(move |this, _, _, cx| this.open_thread(thread.clone(), cx)));
                let id = item.thread.id.clone();
                let actions = vec![RowAction::new(
                    "inbox",
                    t("Unsnooze", "Niet meer snoozen"),
                    move |this, _, cx| this.unsnooze(id.clone(), cx),
                )];
                line(index, button, actions, cx).into_any_element()
            })
            .collect();
        vec![rows(lines).into_any_element()]
    }

    fn render_scheduled(&self, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let Some(scheduled) = &self.scheduled.data else {
            return vec![skeleton(true).into_any_element()];
        };
        let shown: Vec<_> = scheduled.iter().filter(|item| self.in_mailbox(Some(&item.account_id))).collect();
        if shown.is_empty() {
            return vec![note(
                t(
                    "Nothing scheduled. Use Send later in a message to send it at a set time.",
                    "Niets gepland. Kies Later versturen in een bericht om het op een vast moment te versturen.",
                ),
                true,
            )
            .into_any_element()];
        }
        let lines = shown
            .into_iter()
            .enumerate()
            .map(|(index, item)| {
                let names = item.to.iter().map(|address| address.label()).collect::<Vec<_>>().join(", ");
                let names = if names.is_empty() { "—".to_string() } else { names };
                let when = if item.failed {
                    t("Didn't send", "Niet verstuurd").to_string()
                } else {
                    format::moment_of(item.send_at)
                };
                // Opening it is changing it: it goes back to the drafts, as in Gmail.
                let id = item.id.clone();
                let edit = move |this: &mut MailView, cx: &mut Context<MailView>| {
                    let id = id.clone();
                    // It opens in the composer as the draft it now is (compose.rs).
                    this.edit_scheduled(id, cx);
                };
                let open = edit.clone();
                let button = Self::later_row(
                    ("scheduled", index),
                    t(format!("To: {names}"), format!("Aan: {names}")),
                    subject_or_none(&item.subject),
                    when,
                    item.failed,
                    false,
                )
                .on_click(cx.listener(move |this, _, _, cx| open(this, cx)));
                let id = item.id.clone();
                let actions = vec![
                    RowAction::new("sent", t("Send now", "Nu versturen"), move |this, _, cx| {
                        let id = id.clone();
                        this.fetch(
                            cx,
                            move |client| api::send_scheduled_now(client, &id),
                            |this, result, cx| {
                                match result {
                                    Ok(()) => {
                                        this.toast(t("Sent", "Verstuurd"), ToastKind::Success, None, false, cx);
                                    }
                                    Err(error) => this.toast_error(error, cx),
                                }
                                this.load_later(cx);
                                this.load_drafts(cx);
                            },
                        );
                    }),
                    RowAction::new(
                        "pencil-edit-02",
                        t("Don't send; keep as draft", "Niet versturen; als concept bewaren"),
                        move |this, _, cx| edit(this, cx),
                    ),
                ];
                line(index, button, actions, cx).into_any_element()
            })
            .collect();
        vec![rows(lines).into_any_element()]
    }

    /// Who fills the inbox: who, how much and how much unread, with tidying
    /// actions on hover (`SenderRow`).
    fn render_senders(&self, _: &mut Window, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let Some(senders) = &self.senders.data else {
            return vec![if self.senders.failed {
                failed(t("The senders couldn't be loaded.", "De afzenders konden niet geladen worden."), true)
                    .into_any_element()
            } else {
                skeleton(true).into_any_element()
            }];
        };
        if senders.is_empty() {
            return vec![list_empty(
                "clean",
                t("Nothing to tidy", "Niets op te ruimen"),
                Some(
                    t(
                        "No one has more than one message in your inbox.",
                        "Niemand heeft meer dan één bericht in je inbox.",
                    )
                    .into(),
                ),
            )
            .into_any_element()];
        }
        let lines = senders
            .iter()
            .enumerate()
            .map(|(index, sender)| {
                let selected = self.open.is_none() && self.picked_sender.as_deref() == Some(sender.email.as_str());
                let messages = if sender.messages == 1 {
                    t("1 message", "1 bericht").to_string()
                } else {
                    let count = format::number(sender.messages);
                    t(format!("{count} messages"), format!("{count} berichten"))
                };
                let email = sender.email.clone();
                let button = row_button(("sender", index), selected, false)
                    .child(head(
                        div().font_weight(FontWeight::MEDIUM).child(sender.label().to_string()),
                        messages,
                        true,
                    ))
                    .child(
                        div()
                            .flex()
                            .min_w_0()
                            .items_center()
                            .gap(px(6.))
                            .text_color(theme::muted())
                            .child(div().min_w_0().truncate().child(sender.email.clone()))
                            .when(sender.unread > 0, |el| {
                                let count = format::number(sender.unread);
                                el.child(
                                    div()
                                        .flex_none()
                                        .child(t(format!("· {count} unread"), format!("· {count} ongelezen"))),
                                )
                            }),
                    )
                    .on_click(cx.listener(move |this, _, _, cx| this.pick_sender(email.clone(), cx)));
                line(index, button, self.sender_actions(sender), cx).into_any_element()
            })
            .collect();
        vec![rows(lines).into_any_element()]
    }

    /// The ways to clear a sender's mail, on their line.
    fn sender_actions(&self, sender: &Sender) -> Vec<RowAction> {
        let mut actions = Vec::new();
        let target = sender.clone();
        actions.push(RowAction::new(
            "filter-mail-remove",
            t("Unsubscribe", "Uitschrijven"),
            move |this, _, cx| this.unsubscribe(target.clone(), cx),
        ));
        if sender.unread > 0 {
            let target = sender.clone();
            actions.push(RowAction::new(
                "mail-open-01",
                t("Mark all read", "Alles gelezen"),
                move |this, window, cx| this.act_on_sender(target.clone(), "read", window, cx),
            ));
        }
        let target = sender.clone();
        actions.push(RowAction::new(
            "archive",
            t("Archive all", "Alles archiveren"),
            move |this, window, cx| this.act_on_sender(target.clone(), "archive", window, cx),
        ));
        let target = sender.clone();
        actions.push(
            RowAction::new("delete-02", t("Delete all", "Alles verwijderen"), move |this, window, cx| {
                this.act_on_sender(target.clone(), "trash", window, cx)
            })
            .destructive(true),
        );
        actions
    }

    /// The sender whose pane shows, if Tidy up is in view and one is picked.
    pub(super) fn pane_sender(&self) -> Option<&Sender> {
        if self.view != View::Senders {
            return None;
        }
        let email = self.picked_sender.as_deref()?;
        self.senders.data.as_ref()?.iter().find(|sender| sender.email == email)
    }

    /// The reading pane for Tidy up: one sender, not one mail. Who they are,
    /// how much of the inbox is theirs, the ways to clear it, and their
    /// conversations, each of which opens like any mail (`SenderPane`).
    pub(super) fn render_sender_pane(&self, sender: &Sender, cx: &mut Context<Self>) -> AnyElement {
        let stat = |value: String, label: &'static str| {
            div()
                .flex()
                .flex_col()
                .flex_1()
                .gap(px(2.))
                .child(div().text_size(px(18.)).font_weight(FontWeight::SEMIBOLD).child(value))
                .child(div().text_size(px(12.)).text_color(theme::muted()).child(label))
        };
        let action = |id: &'static str, icon: &'static str, label: &'static str, destructive: bool| {
            div()
                .id(id)
                .flex()
                .flex_none()
                .items_center()
                .gap(px(6.))
                .h(px(28.))
                .pl(px(8.))
                .pr(px(10.))
                .rounded(theme::RADIUS_MD)
                .border_1()
                .border_color(theme::input())
                .text_size(px(12.5))
                .font_weight(FontWeight::MEDIUM)
                .cursor_pointer()
                .text_color(if destructive { theme::danger() } else { theme::foreground() })
                .hover(move |el| {
                    el.bg(if destructive { theme::mix(theme::danger(), 10.) } else { theme::muted_bg() })
                })
                .child(theme::hi(icon).text_color(if destructive { theme::danger() } else { theme::foreground() }))
                .child(label)
        };
        let unsubscribe = sender.clone();
        let (read, archive, trash) = (sender.clone(), sender.clone(), sender.clone());
        let conversations: Vec<AnyElement> = match &self.sender_threads.data {
            None if self.sender_threads.failed => Vec::new(),
            None => (0..5)
                .map(|_| {
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(8.))
                        .py(px(10.))
                        .child(div().h(px(14.)).w(relative(0.66)).rounded(theme::RADIUS_SM).bg(theme::muted_bg()))
                        .child(div().h(px(12.)).w(relative(0.83)).rounded(theme::RADIUS_SM).bg(theme::muted_bg()))
                        .into_any_element()
                })
                .collect(),
            Some(threads) if threads.is_empty() => vec![div()
                .text_size(px(14.))
                .text_color(theme::muted())
                .child(t(
                    "Nothing from them in the inbox anymore.",
                    "Er staat niets meer van ze in de inbox.",
                ))
                .into_any_element()],
            Some(threads) => vec![div()
                .flex()
                .flex_col()
                .gap(px(2.))
                .mx(px(-10.))
                .children(threads.iter().enumerate().map(|(index, thread)| {
                    let opened = thread.clone();
                    div()
                        .id(("sender-thread", index))
                        .flex()
                        .flex_col()
                        .gap(px(2.))
                        .px(px(10.))
                        .py(px(8.))
                        .rounded(theme::RADIUS)
                        .text_size(px(14.))
                        .line_height(px(20.))
                        .cursor_pointer()
                        .hover(|el| el.bg(theme::with_alpha(theme::accent(), 0.6)))
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(8.))
                                .child(
                                    div()
                                        .flex_1()
                                        .min_w_0()
                                        .truncate()
                                        .when(thread.is_read, |el| el.text_color(theme::muted()))
                                        .when(!thread.is_read, |el| el.font_weight(FontWeight::MEDIUM))
                                        .child(subject_of(thread)),
                                )
                                .child(
                                    div()
                                        .flex_none()
                                        .text_size(px(12.))
                                        .text_color(theme::muted())
                                        .child(format::short_date(thread.received_at)),
                                ),
                        )
                        .when(!thread.snippet.is_empty(), |el| {
                            el.child(div().truncate().text_color(theme::muted()).child(thread.snippet.clone()))
                        })
                        .on_click(cx.listener(move |this, _, _, cx| this.open_thread(opened.clone(), cx)))
                }))
                .into_any_element()],
        };
        div()
            .id("sender-pane")
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .child(
                // `readingColumn`: one column, centred, that the pane shares with the mail.
                div()
                    .flex()
                    .flex_col()
                    .gap(px(28.))
                    .w_full()
                    .max_w(px(768.))
                    .mx_auto()
                    .px(px(32.))
                    .pt(px(32.))
                    .pb(px(40.))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(16.))
                            .child(
                                div()
                                    .flex()
                                    .flex_none()
                                    .items_center()
                                    .justify_center()
                                    .size(px(48.))
                                    .rounded_full()
                                    .bg(avatar_color(&sender.email))
                                    .text_color(gpui_kit::white())
                                    .text_size(px(16.))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .child(initials_of(sender.name.as_deref(), &sender.email)),
                            )
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .min_w_0()
                                    .child(
                                        div()
                                            .truncate()
                                            .text_size(px(18.))
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .child(sender.label().to_string()),
                                    )
                                    .when(sender.name.is_some(), |el| {
                                        el.child(
                                            div()
                                                .truncate()
                                                .text_size(px(14.))
                                                .text_color(theme::muted())
                                                .child(sender.email.clone()),
                                        )
                                    }),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .gap(px(24.))
                            .py(px(16.))
                            .border_t_1()
                            .border_b_1()
                            .border_color(theme::border())
                            .child(stat(format::number(sender.messages), t("messages", "berichten")))
                            .child(stat(format::number(sender.unread), t("unread", "ongelezen")))
                            .child(stat(format::number(sender.conversations), t("conversations", "gesprekken")))
                            .child(stat(format::short_date(sender.latest), t("latest", "laatste"))),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_wrap()
                            .gap(px(8.))
                            .child(
                                action("pane-unsubscribe", "filter-mail-remove", t("Unsubscribe", "Uitschrijven"), false)
                                    .on_click(cx.listener(move |this, _, _, cx| this.unsubscribe(unsubscribe.clone(), cx))),
                            )
                            .when(sender.unread > 0, |el| {
                                el.child(
                                    action("pane-read", "mail-open-01", t("Mark all read", "Alles gelezen"), false).on_click(
                                        cx.listener(move |this, _, window, cx| {
                                            this.act_on_sender(read.clone(), "read", window, cx)
                                        }),
                                    ),
                                )
                            })
                            .child(
                                action("pane-archive", "archive", t("Archive all", "Alles archiveren"), false).on_click(
                                    cx.listener(move |this, _, window, cx| {
                                        this.act_on_sender(archive.clone(), "archive", window, cx)
                                    }),
                                ),
                            )
                            .child(
                                action("pane-trash", "delete-02", t("Delete all", "Alles verwijderen"), true).on_click(
                                    cx.listener(move |this, _, window, cx| {
                                        this.act_on_sender(trash.clone(), "trash", window, cx)
                                    }),
                                ),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(4.))
                            .child(
                                div()
                                    .mb(px(4.))
                                    .text_size(px(12.))
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(theme::muted())
                                    .child(t("Their conversations", "Hun gesprekken")),
                            )
                            .children(conversations),
                    ),
            )
            .into_any_element()
    }

    /// The reading pane with nothing open: where the day stands, and the keys
    /// that move through mail fastest (components/empty-pane.tsx).
    pub(super) fn render_empty_pane(&self) -> AnyElement {
        let today = format::long_day(chrono::Local::now().date_naive());
        let unread = match self.unread.as_ref().map(|unread| unread.count) {
            None => " ".to_string(),
            Some(0) => t("You're all caught up.", "Alles is gelezen.").to_string(),
            Some(count) => {
                let count = format::number(count);
                t(format!("{count} unread in your inbox"), format!("{count} ongelezen in je inbox"))
            }
        };
        let keys = |keys: &[&'static str]| {
            div().flex().gap(px(4.)).children(keys.iter().map(|key| {
                div()
                    .flex()
                    .items_center()
                    .justify_center()
                    .h(px(20.))
                    .min_w(px(20.))
                    .px(px(6.))
                    .rounded(theme::RADIUS_SM)
                    .border_1()
                    .border_color(theme::border())
                    .bg(theme::background())
                    .text_size(px(11.))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(theme::foreground())
                    .child(*key)
            }))
        };
        let shortcut = |label: &'static str, shown: &[&'static str]| {
            div()
                .flex()
                .items_center()
                .justify_between()
                .gap(px(16.))
                .child(label)
                .child(keys(shown))
        };
        div()
            .flex()
            .flex_col()
            .size_full()
            .items_center()
            .justify_center()
            .px(px(24.))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .w_full()
                    .max_w(px(320.))
                    .gap(px(24.))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(4.))
                            .child(div().text_size(px(20.)).font_weight(FontWeight::SEMIBOLD).child(today))
                            .child(div().text_size(px(14.)).text_color(theme::muted()).child(unread)),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(10.))
                            .pt(px(20.))
                            .border_t_1()
                            .border_color(theme::border())
                            .text_size(px(14.))
                            .text_color(theme::muted())
                            .child(shortcut(t("Go through mail", "Door je mail gaan"), &["J", "K"]))
                            .child(shortcut(t("New message", "Nieuw bericht"), &["C"]))
                            .child(shortcut(t("Search", "Zoeken"), &["⌘", "K"]))
                            .child(shortcut(t("Archive", "Archiveren"), &["E"])),
                    ),
            )
            .into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::{avatar_color, initials_of};

    #[test]
    fn contacts_get_initials_and_a_colour() {
        assert_eq!(initials_of(Some("Jorn Boerema"), "j@x.nl"), "JB");
        assert_eq!(initials_of(Some("jorn | Daize"), "j@x.nl"), "JD");
        assert_eq!(initials_of(Some("Bol"), "j@x.nl"), "B");
        assert_eq!(initials_of(None, "j@x.nl"), "J");
        let color = avatar_color("Jan@Example.nl");
        assert_eq!(color, avatar_color("jan@example.nl"));
        // Mid-light, never black or white.
        let sum = color.r + color.g + color.b;
        assert!(sum > 0.8 && sum < 2.4);
    }
}
