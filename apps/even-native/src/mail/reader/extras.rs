//! What the reader shows around the mail, each asked from the API when a
//! conversation opens and kept for this visit, as the web's queries are: a
//! sign-in code or summary (components/mail-summary.tsx), the parcel and the
//! invoice it is about (parcels.tsx, invoices.tsx) with Moneybird's button
//! (moneybird-button.tsx), the tasks made from it (todo-from-mail.tsx),
//! replies to start from (reply-suggestions.tsx) and translations
//! (message-translation.tsx). Each is drawn as HTML for a slot in the page.

use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::Instant;

use regex::Regex;
use serde::Deserialize;

use crate::api::{conversation_path, Thread};
use crate::email::escape;

use super::super::api::{Invoice, Shipment};
use super::super::conversation::Conversation;
use super::super::format;
use super::super::overlays::Recognition;
use super::page::{icon, icon_with, Slots};
use super::*;

/// Something asked from the API for the open conversation.
pub(super) enum Got<T> {
    /// Not asked yet.
    No,
    Pending,
    Here(T),
    Failed,
}

impl<T> Default for Got<T> {
    fn default() -> Self {
        Got::No
    }
}

impl<T> Got<T> {
    pub(super) fn here(&self) -> Option<&T> {
        match self {
            Got::Here(value) => Some(value),
            _ => None,
        }
    }

    fn of(result: anyhow::Result<T>) -> Self {
        match result {
            Ok(value) => Got::Here(value),
            Err(_) => Got::Failed,
        }
    }
}

/// `MailSummary`.
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub(super) enum Summary {
    Code { code: String },
    Summary { summary: String },
    /// Too short to be worth summing up, or no summary service.
    None,
}

/// `MailTranslation`.
#[derive(Clone, Deserialize)]
pub(super) struct Translation {
    #[serde(default)]
    same: bool,
    #[serde(default)]
    from: String,
    #[serde(default)]
    text: String,
}

/// `MailReplySuggestion`.
#[derive(Deserialize)]
pub(super) struct Suggestion {
    label: String,
    text: String,
}

/// `MailTodoList`.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TodoList {
    pub(super) id: String,
    pub(super) name: String,
    pub(super) workspace_id: String,
    pub(super) workspace_name: String,
}

/// `MailTodoView`.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Todo {
    title: String,
    #[serde(default)]
    completed: bool,
    #[serde(default)]
    in_progress: bool,
    pub(super) list_name: String,
    pub(super) url: String,
}

/// `MoneybirdAdministration`: one company's books.
#[derive(Clone, Deserialize)]
pub(super) struct Administration {
    id: String,
    name: String,
}

/// Moneybird as it is connected (`ConnectionView`).
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Connection {
    provider: String,
    status: String,
    default_target: Option<Administration>,
    #[serde(default)]
    administrations: Vec<Administration>,
}

/// `MoneybirdExportView`: a file from a conversation that went to Moneybird.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Export {
    attachment_key: String,
    administration_id: String,
    administration_name: String,
    url: String,
}

/// `MoneybirdThreadView`.
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct MoneybirdThread {
    #[serde(default)]
    exports: Vec<Export>,
    /// The administration the last mail from this sender went to, if any.
    suggested_administration_id: Option<String>,
}

/// A file Moneybird can take, and the message it came with (`MoneybirdFile`).
#[derive(Clone)]
struct BookFile {
    message_id: String,
    attachment_id: String,
    name: String,
    content_type: String,
    size: u64,
}

impl BookFile {
    /// Name and size, the same for the same file however often it is read (`attachmentKey`).
    fn key(&self) -> String {
        format!("{}:{}", self.size, self.name)
    }
}

/// Everything asked about one conversation.
#[derive(Default)]
pub(super) struct Extras {
    summary: Got<Summary>,
    shipment: Got<Option<Shipment>>,
    invoice: Got<Option<Invoice>>,
    todos: Got<Vec<Todo>>,
    /// With the newest message they answer: a new message asks again.
    replies: Got<(String, Vec<Suggestion>)>,
    moneybird: Got<MoneybirdThread>,
    /// The file picked for Moneybird, by its key, when it isn't the likeliest.
    chosen_file: Option<String>,
    sending: bool,
    /// The Moneybird menu stays open while a file is picked.
    menu_open: bool,
    /// By message.
    translations: HashMap<String, Got<Translation>>,
}

/// A slot in the page.
#[derive(Clone, Copy)]
pub(super) enum Slot {
    Shipment,
    Invoice,
    Todos,
    Summary,
    Replies,
}

impl Slot {
    fn id(self) -> &'static str {
        match self {
            Slot::Shipment => "shipment",
            Slot::Invoice => "invoice",
            Slot::Todos => "todos",
            Slot::Summary => "summary",
            Slot::Replies => "replies",
        }
    }
}

/// How long the connections are trusted before they are asked again (`staleTime`).
const CONNECTIONS_FRESH: Duration = Duration::from_secs(10 * 60);
/// Moneybird reads PDFs and pictures of receipts up to this size (`MONEYBIRD_MAX_BYTES`).
const MONEYBIRD_MAX_BYTES: u64 = 25 * 1024 * 1024;

fn regex(pattern: &str) -> Regex {
    Regex::new(pattern).expect("a pattern that compiles")
}

/// Senders that are carriers (`CARRIER_DOMAINS` in packages/mail-core/src/shipments.ts,
/// without Amazon, which also mails about everything else).
static CARRIER_DOMAIN: LazyLock<Regex> = LazyLock::new(|| {
    regex(
        r"(^|\.)(postnl\.(nl|com|be|post)|dhl\.[a-z.]+|dhlparcel\.[a-z]+|dhlecommerce\.[a-z]+|dpd\.[a-z.]+|dpdgroup\.com|gls-[a-z-]+\.[a-z]+|gls\.[a-z]+|ups\.com|budbee\.com|trunkrs\.(nl|com)|dragonflyinternational\.com)$",
    )
});
static SHIPPING_SUBJECT: LazyLock<Regex> = LazyLock::new(|| {
    regex(
        r"(?i)pakket|pakje|zending|bezorg|verzonden|verstuurd|onderweg|afhaalpunt|track\s*(&|en|and)?\s*trace|parcel|package|shipment|shipped|shipping|on its way|out for delivery|delivered|delivery|paket|sendung|zugestellt|versandt|unterwegs",
    )
});
/// Senders that only ever mail about money (`BILLING_DOMAINS` in invoices.ts).
static BILLING_DOMAIN: LazyLock<Regex> = LazyLock::new(|| {
    regex(
        r"(^|\.)(stripe\.com|mollie\.com|paddle\.com|paypal\.(com|nl)|tikkie\.me|abnamro\.nl|moneybird\.(nl|com)|exactonline\.nl|e-boekhouden\.nl|sumup\.com|adyen\.com|lemonsqueezy\.com|chargebee\.com|invoice\.(stripe|chargebee)\.com)$",
    )
});
static MONEY_SUBJECT: LazyLock<Regex> = LazyLock::new(|| {
    regex(
        r"(?i)factuur|facturen|invoice|receipt|bon\b|kassabon|ontvangstbewijs|betaalbewijs|betaalverzoek|betaling|payment|tikkie|nota\b|rekening\b|aanmaning|herinnering.*(betaling|factuur)|incasso|afschrijving|charge|billing|subscription renew|abonnement.*(verlengd|vernieuwd)|order confirmation|bestelbevestiging|rechnung|zahlung|quittung",
    )
});
static INVOICE_NAME: LazyLock<Regex> =
    LazyLock::new(|| regex(r"(?i)factuur|invoice|receipt|nota|bon|rekening|rechnung|credit"));
static NOT_INVOICE_NAME: LazyLock<Regex> = LazyLock::new(|| {
    regex(r"(?i)voorwaarden|terms|conditions|privacy|algemene|brochure|flyer|nieuwsbrief|newsletter")
});
static PICTURE_TYPE: LazyLock<Regex> = LazyLock::new(|| regex(r"(?i)^image/(jpe?g|png|heic|heif|webp)$"));
static PICTURE_NAME: LazyLock<Regex> = LazyLock::new(|| regex(r"(?i)\.(jpe?g|png|heic)$"));

fn domain_of(email: Option<&str>) -> String {
    email.and_then(|email| email.split('@').nth(1)).unwrap_or_default().to_lowercase()
}

/// From the list alone (sender and subject): might this be shipping mail?
/// Only these are asked about (`looksLikeShipment`).
fn looks_like_shipment(thread: &Thread) -> bool {
    CARRIER_DOMAIN.is_match(&domain_of(thread.from_email.as_deref())) || SHIPPING_SUBJECT.is_match(&thread.subject)
}

/// Might this be about money (`looksLikeInvoice`)?
fn looks_like_invoice(thread: &Thread) -> bool {
    BILLING_DOMAIN.is_match(&domain_of(thread.from_email.as_deref())) || MONEY_SUBJECT.is_match(&thread.subject)
}

/// Files worth booking, newest message first: PDFs; pictures only when there
/// is no PDF, since mail is full of logos (`filesIn` and `bookableFiles`).
fn book_files(conversation: &Conversation) -> Vec<BookFile> {
    let fits: Vec<BookFile> = conversation
        .parts
        .iter()
        .rev()
        .flat_map(|part| {
            part.attachments.iter().map(|file| BookFile {
                message_id: part.message_id.clone(),
                attachment_id: file.id.clone(),
                name: file.name.clone(),
                content_type: file.content_type.clone(),
                size: file.size,
            })
        })
        .filter(|file| file.size > 0 && file.size <= MONEYBIRD_MAX_BYTES)
        .collect();
    let is_pdf =
        |file: &BookFile| file.content_type.to_lowercase().contains("pdf") || file.name.to_lowercase().ends_with(".pdf");
    let pdfs: Vec<BookFile> = fits.iter().filter(|file| is_pdf(file)).cloned().collect();
    if !pdfs.is_empty() {
        return pdfs;
    }
    // A picture under 20 KB is a logo or an icon, not a receipt.
    fits.into_iter()
        .filter(|file| (PICTURE_TYPE.is_match(&file.content_type) || PICTURE_NAME.is_match(&file.name)) && file.size > 20_000)
        .collect()
}

/// The file most likely to be the invoice: named like one, not like terms and conditions.
fn likeliest_invoice(files: &[BookFile]) -> Option<&BookFile> {
    let score =
        |file: &BookFile| 2 * INVOICE_NAME.is_match(&file.name) as i32 - 3 * NOT_INVOICE_NAME.is_match(&file.name) as i32;
    files.iter().fold(None, |best: Option<&BookFile>, file| match best {
        Some(best) if score(file) <= score(best) => Some(best),
        _ => Some(file),
    })
}

/// A conversation's path with a query after it, whether it has one already or not.
fn with_query(path: String, query: &str) -> String {
    if query.is_empty() {
        return path;
    }
    let joint = if path.contains('?') { '&' } else { '?' };
    format!("{path}{joint}{query}")
}

/// A link the API gave, when it is one a browser should open.
fn web_link(url: &str) -> Option<String> {
    (url.starts_with("https://") || url.starts_with("http://")).then(|| escape(url))
}

fn copy_button(what: usize, label: &str, size: &str) -> String {
    format!(
        r#"<button type="button" class="btn {size} copy" data-act="copy" data-arg="{what}" aria-label="{label}">{}{}</button>"#,
        icon_with("copy-01", "plain"),
        icon_with("tick-02", "tick")
    )
}

/// The flag on a card above the mail (`ReportRecognitionButton`). Only
/// synced conversations can be reported.
fn report_button(kind: usize, thread_id: &str) -> String {
    if thread_id.starts_with(crate::api::REMOTE) {
        return String::new();
    }
    let label = t("Not recognised well", "Niet goed herkend");
    format!(
        r#"<button type="button" class="btn ghost icon-sm" data-act="report" data-arg="{kind}" data-tip="{label}" aria-label="{label}">{}</button>"#,
        icon("flag-02")
    )
}

fn carrier_name(carrier: &str) -> Option<&'static str> {
    Some(match carrier {
        "postnl" => "PostNL",
        "dhl" => "DHL",
        "dpd" => "DPD",
        "gls" => "GLS",
        "ups" => "UPS",
        "budbee" => "Budbee",
        "trunkrs" => "Trunkrs",
        "dragonfly" => "Dragonfly",
        "amazon" => "Amazon",
        _ => return None,
    })
}

/// `ShipmentCard`: where the parcel is, its code and the way to its track & trace page.
fn shipment_card(shipment: &Shipment, thread_id: &str) -> String {
    let carrier = shipment
        .carrier
        .as_deref()
        .and_then(carrier_name)
        .unwrap_or(t("Parcel", "Pakket"));
    let from: Vec<&str> = [Some(carrier), shipment.merchant.as_deref()]
        .into_iter()
        .flatten()
        .filter(|name| !name.is_empty())
        .collect();
    let (tone, status) = match shipment.status.as_deref().unwrap_or("unknown") {
        "announced" => ("quiet", t("Announced", "Aangemeld")),
        "in_transit" => ("sky", t("On its way", "Onderweg")),
        "out_for_delivery" => ("brand", t("Arriving today", "Komt vandaag")),
        "pickup" => ("violet", t("Ready for pickup", "Ligt klaar")),
        "delivered" => ("emerald", t("Delivered", "Bezorgd")),
        "problem" => ("danger", t("Needs attention", "Let op")),
        _ => ("quiet", t("Shipped", "Verzonden")),
    };
    let track = t("Track parcel", "Pakket volgen");
    let mut out = format!(
        r#"<section class="card row" aria-label="{track}"><span class="badge">{}</span><div class="info"><span class="cut xs mu">{}</span><span class="med"><span class="status"><span class="tone {tone}"></span>{status}</span></span>"#,
        icon("package"),
        escape(&from.join(" · ")),
    );
    if let Some(code) = shipment.tracking_code.as_deref().filter(|code| !code.is_empty()) {
        out.push_str(&format!(
            r#"<span class="track mono xs mu"><span class="cut all">{}</span>{}</span>"#,
            escape(code),
            copy_button(1, t("Copy tracking code", "Trackingcode kopiëren"), "ghost icon-xs")
        ));
    }
    out.push_str("</div>");
    if let Some(url) = shipment.tracking_url.as_deref().and_then(web_link) {
        out.push_str(&format!(
            r#"<a class="btn outline sm end" href="{url}">{track}{}</a>"#,
            icon("arrow-up-right-01")
        ));
    }
    out.push_str(&report_button(0, thread_id));
    out.push_str("</section>");
    out
}

/// `InvoiceCard`: who wants how much, by when, and whether it is paid.
fn invoice_card(invoice: &Invoice, thread_id: &str, moneybird: String) -> String {
    let tone = if invoice.status == "failed" || invoice.overdue {
        "danger"
    } else {
        match invoice.status.as_str() {
            "paid" => "emerald",
            "auto" => "quiet",
            _ => "brand",
        }
    };
    let mut status = if invoice.overdue {
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
        status.push_str(&t(format!(" · due {date}"), format!(" · vóór {date}")));
    }
    let amount = match invoice.amount_cents {
        Some(cents) => format::money(cents, invoice.currency.as_deref(), false),
        None => t("Amount in the attachment", "Bedrag in de bijlage").to_string(),
    };
    let mut out = format!(
        r#"<section class="card row" aria-label="{}"><span class="badge">{}</span><div class="info"><span class="cut xs mu">{}</span><span class="amount">{}</span><span class="line xs mu"><span class="status"><span class="tone {tone}"></span><span class="cut">{}</span></span>"#,
        t("Invoices", "Facturen"),
        icon("invoice-02"),
        escape(invoice.vendor.as_deref().unwrap_or_default()),
        escape(&amount),
        escape(&status),
    );
    if let Some(number) = invoice.invoice_number.as_deref().filter(|number| !number.is_empty()) {
        out.push_str(&format!(
            r#"<span class="tight mono"><span class="cut all">#{}</span>{}</span>"#,
            escape(number),
            copy_button(2, t("Copy invoice number", "Factuurnummer kopiëren"), "ghost icon-xs")
        ));
    }
    out.push_str("</span></div>");
    out.push_str(&moneybird);
    if let Some(url) = invoice.pay_url.as_deref().and_then(web_link) {
        out.push_str(&format!(
            r#"<a class="btn primary sm end" href="{url}">{}{}</a>"#,
            t("Pay", "Betalen"),
            icon("arrow-up-right-01")
        ));
    }
    out.push_str(&report_button(1, thread_id));
    out.push_str("</section>");
    out
}

/// `MailSummaryCard`: a sign-in code ready to copy, or three lines on what the mail says.
fn summary_card(summary: &Got<Summary>, summaries: bool) -> String {
    match summary {
        // A code shows once it is found; only a summary being written is worth a placeholder.
        Got::Pending if summaries => {
            r#"<div class="card" aria-hidden="true"><div class="sk sk1"></div><div class="sk sk2"></div><div class="sk sk3"></div></div>"#
                .to_string()
        }
        Got::Here(Summary::Code { code }) => format!(
            r#"<div class="card row"><div class="info"><span class="xs mu">{}</span><span class="mono code all">{}</span></div>{}</div>"#,
            t("Verification code", "Verificatiecode"),
            escape(code),
            copy_button(0, t("Copy code", "Code kopiëren"), "outline icon")
        ),
        Got::Here(Summary::Summary { summary }) => {
            let label = t("Summary", "Samenvatting");
            format!(
                r#"<section class="card" aria-label="{label}"><p class="label xs mu">{}{label}</p><p class="said">{}</p></section>"#,
                icon("sparkles"),
                escape(summary)
            )
        }
        // Without a summary the conversation reads as before; a failure isn't worth a warning.
        _ => String::new(),
    }
}

/// `LinkedTodos`: the tasks made from the mail, where they stand, each opening in Even doen.
fn todos_card(todos: &[Todo]) -> String {
    if todos.is_empty() {
        return String::new();
    }
    let mut out = format!(r#"<section class="tasks" aria-label="{}">"#, t("Tasks from this mail", "Taken van deze mail"));
    for todo in todos {
        let (sign, state) = if todo.completed {
            ("checkmark-square-02", t("Done", "Klaar").to_string())
        } else if todo.in_progress {
            ("task-done-01", t("Busy", "Bezig").to_string())
        } else {
            ("square", todo.list_name.clone())
        };
        out.push_str(&format!(
            r#"<a class="task{}" href="{}" aria-label="{}">{}<span class="cut name">{}</span><span class="xs mu">{}</span>{}</a>"#,
            if todo.completed { " done" } else { "" },
            web_link(&todo.url).unwrap_or_default(),
            t("Open in Even doen", "Openen in Even doen"),
            icon(sign),
            escape(&todo.title),
            escape(&state),
            icon_with("arrow-up-right-01", "go"),
        ));
    }
    out.push_str("</section>");
    out
}

/// `ReplySuggestions`: three replies to start from, when the newest message asks for an answer.
fn replies_list(replies: &[Suggestion]) -> String {
    replies
        .iter()
        .enumerate()
        .map(|(index, reply)| {
            format!(
                r#"<li><button type="button" class="btn outline sm start" data-act="suggest" data-arg="{index}">{}<span class="cut">{}</span></button></li>"#,
                icon("sparkles"),
                escape(&reply.label)
            )
        })
        .collect()
}

/// What the reader keeps about the open conversations.
impl State {
    fn moneybird(&self) -> Option<&Connection> {
        self.connections.here().and_then(|connection| connection.as_ref())
    }

    /// Whether the models may be asked. While looking at states for a
    /// picture (`EVEN_MAIL_DEBUG`) they aren't, unless `ai` says so: a
    /// summary costs money each time.
    fn ai(&self) -> bool {
        !self.debug.on || self.debug.ai
    }
}

impl MailView {
    /// Asks what the open conversation still misses. Runs with every draw:
    /// each thing is asked once, and what depends on another follows it.
    pub(super) fn load_extras(&mut self, thread: &Thread, cx: &mut Context<Self>) {
        let id = thread.id.clone();
        let newest = match self.reading.get(&id) {
            Some(Reading::Ready(conversation)) => conversation.last.as_ref().map(|last| last.message_id.clone()),
            _ => None,
        };
        let files = match self.reading.get(&id) {
            Some(Reading::Ready(conversation)) => !book_files(conversation).is_empty(),
            _ => false,
        };
        let ai = self.reader.ai();
        let moneybird = self.reader.moneybird().is_some();
        let stale = self.reader.connections_at.is_none_or(|at| at.elapsed() > CONNECTIONS_FRESH);
        let extras = self.reader.extras.entry(id.clone()).or_default();

        // Each feature can be off on its own; with both off nothing is asked at all.
        let (summaries, codes) = (Feature::Summaries.on() && ai, Feature::Codes.on());
        if matches!(extras.summary, Got::No) && (summaries || codes) {
            extras.summary = Got::Pending;
            let off: Vec<&str> =
                [(!summaries).then_some("ai=0"), (!codes).then_some("codes=0")].into_iter().flatten().collect();
            let path = with_query(conversation_path(&id, "/summary"), &off.join("&"));
            let thread_id = id.clone();
            self.fetch(
                cx,
                move |client| client.get_json::<Summary>(&path),
                move |this, result, cx| {
                    this.extras(&thread_id).summary = Got::of(result);
                    this.push_slot(&thread_id, Slot::Summary, cx);
                },
            );
        }
        let extras = self.reader.extras.entry(id.clone()).or_default();
        if matches!(extras.shipment, Got::No) && Feature::Parcels.on() && looks_like_shipment(thread) {
            extras.shipment = Got::Pending;
            self.load_shipment(id.clone(), cx);
        }
        let extras = self.reader.extras.entry(id.clone()).or_default();
        if matches!(extras.invoice, Got::No) && Feature::Invoices.on() && looks_like_invoice(thread) {
            extras.invoice = Got::Pending;
            self.load_invoice(id.clone(), cx);
        }
        let extras = self.reader.extras.entry(id.clone()).or_default();
        if matches!(extras.todos, Got::No) && Feature::Todos.on() {
            extras.todos = Got::Pending;
            let path = conversation_path(&id, "/todos");
            let thread_id = id.clone();
            self.fetch(
                cx,
                move |client| {
                    #[derive(Deserialize)]
                    struct Answer {
                        todos: Vec<Todo>,
                    }
                    Ok(client.get_json::<Answer>(&path)?.todos)
                },
                move |this, result, cx| {
                    this.extras(&thread_id).todos = Got::of(result);
                    this.push_slot(&thread_id, Slot::Todos, cx);
                },
            );
        }
        // A new message asks again.
        let extras = self.reader.extras.entry(id.clone()).or_default();
        let asked = match &extras.replies {
            Got::No => false,
            Got::Here((for_message, _)) => Some(for_message) == newest.as_ref(),
            _ => true,
        };
        if let Some(newest) = newest.filter(|_| !asked && ai && Feature::ReplySuggestions.on()) {
            extras.replies = Got::Pending;
            let path = conversation_path(&id, "/replies");
            let thread_id = id.clone();
            self.fetch(
                cx,
                move |client| {
                    #[derive(Deserialize)]
                    struct Answer {
                        replies: Vec<Suggestion>,
                    }
                    Ok(client.get_json::<Answer>(&path)?.replies)
                },
                move |this, result, cx| {
                    this.extras(&thread_id).replies = match result {
                        Ok(replies) => Got::Here((newest, replies)),
                        Err(_) => Got::Failed,
                    };
                    this.push_slot(&thread_id, Slot::Replies, cx);
                },
            );
        }
        // Moneybird, for mail about money with a file to book.
        let extras = self.reader.extras.entry(id.clone()).or_default();
        let invoice = extras.invoice.here().is_some_and(|invoice| invoice.is_some());
        if invoice && files && stale && !matches!(self.reader.connections, Got::Pending) {
            if self.reader.connections.here().is_none() {
                self.reader.connections = Got::Pending;
            }
            self.reader.connections_at = Some(Instant::now());
            let thread_id = id.clone();
            self.fetch(
                cx,
                |client| {
                    #[derive(Deserialize)]
                    struct Answer {
                        connections: Vec<Connection>,
                    }
                    let answer: Answer = client.get_json("/api/connections")?;
                    Ok(answer
                        .connections
                        .into_iter()
                        .find(|connection| connection.provider == "moneybird" && connection.status == "active"))
                },
                move |this, result, cx| {
                    this.reader.connections = Got::of(result);
                    this.push_slot(&thread_id, Slot::Invoice, cx);
                },
            );
        }
        let extras = self.reader.extras.entry(id.clone()).or_default();
        if invoice && files && moneybird && matches!(extras.moneybird, Got::No) {
            extras.moneybird = Got::Pending;
            let path = conversation_path(&id, "/moneybird");
            let thread_id = id.clone();
            self.fetch(
                cx,
                move |client| client.get_json::<MoneybirdThread>(&path),
                move |this, result, cx| {
                    this.extras(&thread_id).moneybird = Got::of(result);
                    this.push_slot(&thread_id, Slot::Invoice, cx);
                },
            );
        }
    }

    fn extras(&mut self, thread_id: &str) -> &mut Extras {
        self.reader.extras.entry(thread_id.to_string()).or_default()
    }

    fn load_shipment(&mut self, id: String, cx: &mut Context<Self>) {
        let path = conversation_path(&id, "/shipment");
        self.fetch(
            cx,
            move |client| {
                #[derive(Deserialize)]
                struct Answer {
                    shipment: Option<Shipment>,
                }
                Ok(client.get_json::<Answer>(&path)?.shipment)
            },
            move |this, result, cx| {
                this.extras(&id).shipment = Got::of(result);
                this.push_slot(&id, Slot::Shipment, cx);
            },
        );
    }

    fn load_invoice(&mut self, id: String, cx: &mut Context<Self>) {
        let path = conversation_path(&id, "/invoice");
        self.fetch(
            cx,
            move |client| {
                #[derive(Deserialize)]
                struct Answer {
                    invoice: Option<Invoice>,
                }
                Ok(client.get_json::<Answer>(&path)?.invoice)
            },
            move |this, result, cx| {
                this.extras(&id).invoice = Got::of(result);
                this.push_slot(&id, Slot::Invoice, cx);
            },
        );
    }

    /// After "Not recognised well": the card is asked for again, and goes.
    pub(super) fn recheck_card(&mut self, thread_id: String, kind: Recognition, cx: &mut Context<Self>) {
        match kind {
            Recognition::Parcel => self.load_shipment(thread_id, cx),
            Recognition::Invoice => self.load_invoice(thread_id, cx),
        }
    }

    /// What fills the page's slots now.
    pub(super) fn slots(&self, thread_id: &str) -> Slots {
        Slots {
            shipment: self.slot_html(thread_id, Slot::Shipment),
            invoice: self.slot_html(thread_id, Slot::Invoice),
            todos: self.slot_html(thread_id, Slot::Todos),
            summary: self.slot_html(thread_id, Slot::Summary),
            replies: self.slot_html(thread_id, Slot::Replies),
        }
    }

    fn slot_html(&self, thread_id: &str, slot: Slot) -> String {
        if let Some(html) = self.reader.debug.sample(slot, thread_id) {
            return html;
        }
        let Some(extras) = self.reader.extras.get(thread_id) else {
            return String::new();
        };
        match slot {
            Slot::Shipment => match extras.shipment.here() {
                Some(Some(shipment)) if Feature::Parcels.on() => shipment_card(shipment, thread_id),
                _ => String::new(),
            },
            Slot::Invoice => match extras.invoice.here() {
                Some(Some(invoice)) if Feature::Invoices.on() => {
                    invoice_card(invoice, thread_id, self.moneybird_button(thread_id, extras))
                }
                _ => String::new(),
            },
            Slot::Todos => match extras.todos.here() {
                Some(todos) if Feature::Todos.on() => todos_card(todos),
                _ => String::new(),
            },
            Slot::Summary => summary_card(&extras.summary, Feature::Summaries.on() && self.reader.ai()),
            Slot::Replies => match extras.replies.here() {
                Some((_, replies)) if Feature::ReplySuggestions.on() => replies_list(replies),
                _ => String::new(),
            },
        }
    }

    /// Puts a slot's new content in the page, when the page shows this conversation.
    pub(super) fn push_slot(&mut self, thread_id: &str, slot: Slot, cx: &mut Context<Self>) {
        if self.page_shows(thread_id) {
            let html = self.slot_html(thread_id, slot);
            self.tell_page(&format!("even.slot({},{})", js(slot.id()), js(&html)), cx);
        }
    }

    /// Every slot again: what arrived while the page was loading.
    pub(super) fn push_slots(&mut self, thread_id: &str, cx: &mut Context<Self>) {
        for slot in [Slot::Shipment, Slot::Invoice, Slot::Todos, Slot::Summary, Slot::Replies] {
            self.push_slot(thread_id, slot, cx);
        }
    }

    /// `MoneybirdButton`: puts the invoice's PDF in Moneybird's inbox in one
    /// click, to the administration this sender's mail went to before, or the
    /// default one. The arrow picks another file or administration.
    fn moneybird_button(&self, thread_id: &str, extras: &Extras) -> String {
        let Some((files, file, connection)) = self.moneybird_choice(thread_id, extras) else {
            return String::new();
        };
        let administrations = &connection.administrations;
        let target = moneybird_target(connection, extras);
        let key = file.key();
        let sent = extras
            .moneybird
            .here()
            .and_then(|thread| thread.exports.iter().find(|export| export.attachment_key == key));
        let menu = files.len() > 1 || administrations.len() > 1;
        let main = match (sent, target) {
            (Some(sent), _) => {
                let name = escape(&sent.administration_name);
                format!(
                    r#"<a class="btn outline sm start" href="{}" data-tip="{}">{}{}</a>"#,
                    web_link(&sent.url).unwrap_or_default(),
                    t(format!("In the inbox of {name}"), format!("In de inbox van {name}")),
                    icon_with("tick-02", "tickmark"),
                    t("In Moneybird", "In Moneybird")
                )
            }
            (None, target) => {
                let tip = match target {
                    Some(target) => {
                        let (file, name) = (escape(&file.name), escape(&target.name));
                        t(format!("Put {file} in {name}"), format!("{file} in {name} zetten"))
                    }
                    None => t("Choose an administration", "Kies een administratie").to_string(),
                };
                format!(
                    r#"<button type="button" class="btn outline sm{}" data-act="{}" data-tip="{tip}"{}>{}{}</button>"#,
                    if extras.sending { " start" } else { "" },
                    if target.is_some() { "mbsend" } else { "menu" },
                    if extras.sending { " disabled" } else { "" },
                    if extras.sending { icon_with("loading-03", "spin") } else { String::new() },
                    t("To Moneybird", "Naar Moneybird")
                )
            }
        };
        if !menu && (sent.is_some() || target.is_some()) {
            return main;
        }
        let mut out = format!(
            r#"<div class="mb{}" role="group">{main}<span class="sep"></span><button type="button" class="btn outline icon-sm arrow" data-act="menu" aria-label="{}"{}>{}</button><div class="menu" role="menu">"#,
            if extras.menu_open { " open" } else { "" },
            t("Other file or administration", "Ander bestand of andere administratie"),
            if extras.sending { " disabled" } else { "" },
            icon("arrow-down-01"),
        );
        if files.len() > 1 {
            out.push_str(&format!(r#"<p class="mlabel xs mu">{}</p>"#, t("File", "Bestand")));
            for (index, item) in files.iter().enumerate() {
                out.push_str(&format!(
                    r#"<button type="button" class="item radio" role="menuitemradio" data-act="mbfile" data-arg="{index}"><span class="cut">{}</span>{}</button>"#,
                    escape(&item.name),
                    if item.key() == key { icon_with("tick-02", "on mu") } else { String::new() },
                ));
            }
            out.push_str(r#"<div class="rule"></div>"#);
        }
        out.push_str(&format!(r#"<p class="mlabel xs mu">{}</p>"#, t("Put in", "Zetten in")));
        for (index, administration) in administrations.iter().enumerate() {
            out.push_str(&format!(
                r#"<button type="button" class="item" role="menuitem" data-act="mbsend" data-arg="{index}"><span class="cut">{}</span></button>"#,
                escape(&administration.name)
            ));
        }
        out.push_str("</div></div>");
        out
    }

    /// The files Moneybird could take, the one that goes, and the connection.
    fn moneybird_choice(&self, thread_id: &str, extras: &Extras) -> Option<(Vec<BookFile>, BookFile, &Connection)> {
        let connection = self.reader.moneybird()?;
        let Some(Reading::Ready(conversation)) = self.reading.get(thread_id) else {
            return None;
        };
        let files = book_files(conversation);
        let file = files
            .iter()
            .find(|file| Some(file.key()) == extras.chosen_file)
            .or_else(|| likeliest_invoice(&files))?
            .clone();
        Some((files, file, connection))
    }

    /// Another file for Moneybird. The menu stays open, to pick where it goes next.
    pub(super) fn moneybird_pick_file(&mut self, thread_id: &str, index: usize, cx: &mut Context<Self>) {
        let Some(extras) = self.reader.extras.get(thread_id) else { return };
        let Some((files, ..)) = self.moneybird_choice(thread_id, extras) else {
            return;
        };
        let Some(key) = files.get(index).map(BookFile::key) else { return };
        let extras = self.extras(thread_id);
        extras.chosen_file = Some(key);
        extras.menu_open = true;
        self.push_slot(thread_id, Slot::Invoice, cx);
        self.extras(thread_id).menu_open = false;
    }

    /// To Moneybird: to the administration picked in the menu, or else the usual one.
    pub(super) fn moneybird_send(&mut self, thread: &Thread, to: Option<usize>, cx: &mut Context<Self>) {
        let thread_id = thread.id.clone();
        let Some(extras) = self.reader.extras.get(&thread_id) else { return };
        if extras.sending {
            return;
        }
        let Some((_, file, connection)) = self.moneybird_choice(&thread_id, extras) else {
            return;
        };
        let administration = match to {
            Some(index) => connection.administrations.get(index),
            None => moneybird_target(connection, extras),
        };
        let Some(administration) = administration.cloned() else { return };
        self.extras(&thread_id).sending = true;
        self.push_slot(&thread_id, Slot::Invoice, cx);
        let path = conversation_path(&thread_id, "/moneybird");
        let body = serde_json::json!({
            "messageId": file.message_id,
            "attachmentId": file.attachment_id,
            "name": file.name,
            "contentType": file.content_type,
            "size": file.size,
            "administrationId": administration.id,
            "subject": thread.subject,
        });
        self.fetch(
            cx,
            move |client| {
                #[derive(Deserialize)]
                struct Answer {
                    export: Export,
                }
                Ok(client.post_json::<Answer>(&path, &body)?.export)
            },
            move |this, result, cx| {
                let extras = this.extras(&thread_id);
                extras.sending = false;
                match result {
                    Ok(sent) => {
                        let name = sent.administration_name.clone();
                        let url = sent.url.clone();
                        let mut thread = match std::mem::take(&mut extras.moneybird) {
                            Got::Here(thread) => thread,
                            _ => MoneybirdThread::default(),
                        };
                        thread.exports.retain(|export| {
                            export.attachment_key != sent.attachment_key || export.administration_id != sent.administration_id
                        });
                        thread.suggested_administration_id = Some(sent.administration_id.clone());
                        thread.exports.insert(0, sent);
                        extras.moneybird = Got::Here(thread);
                        this.toast(
                            t(
                                format!("In Moneybird, in the inbox of {name}"),
                                format!("In Moneybird gezet, in de inbox van {name}"),
                            ),
                            ToastKind::Success,
                            Some((t("Open", "Openen").into(), ToastAction::Open(url))),
                            false,
                            cx,
                        );
                    }
                    Err(error) => this.toast_error(error, cx),
                }
                this.push_slot(&thread_id, Slot::Invoice, cx);
            },
        );
    }

    /// A copy button on a card: 0 the sign-in code, 1 the tracking code, 2 the invoice number.
    pub(super) fn copy_from_card(&mut self, thread_id: &str, what: usize, cx: &mut Context<Self>) {
        let Some(extras) = self.reader.extras.get(thread_id) else { return };
        let found = match what {
            0 => match extras.summary.here() {
                // Spaces and dashes are for reading; sites want the bare code.
                Some(Summary::Code { code }) => Some((
                    code.chars().filter(|c| !c.is_whitespace() && *c != '-').collect::<String>(),
                    t("Code copied", "Code gekopieerd"),
                )),
                _ => None,
            },
            1 => extras
                .shipment
                .here()
                .and_then(|shipment| shipment.as_ref()?.tracking_code.clone())
                .map(|code| (code, t("Tracking code copied", "Trackingcode gekopieerd"))),
            2 => extras
                .invoice
                .here()
                .and_then(|invoice| invoice.as_ref()?.invoice_number.clone())
                .map(|number| (number, t("Invoice number copied", "Factuurnummer gekopieerd"))),
            _ => None,
        };
        let found = found.or_else(|| self.reader.debug.on.then(|| (String::new(), t("Code copied", "Code gekopieerd"))));
        if let Some((text, said)) = found {
            if !text.is_empty() {
                cx.write_to_clipboard(ClipboardItem::new_string(text));
            }
            self.toast(said, ToastKind::Success, None, false, cx);
        }
    }

    /// The suggested reply with this number, to start an answer from.
    pub(super) fn suggestion(&self, thread_id: &str, index: usize) -> Option<String> {
        let (_, replies) = self.reader.extras.get(thread_id)?.replies.here()?;
        replies.get(index).map(|reply| reply.text.clone())
    }

    /// A task was made from the conversation: it shows above the mail at once.
    pub(super) fn add_todo(&mut self, thread_id: &str, todo: Todo, cx: &mut Context<Self>) {
        let extras = self.extras(thread_id);
        match &mut extras.todos {
            Got::Here(todos) => todos.push(todo),
            other => *other = Got::Here(vec![todo]),
        }
        self.push_slot(thread_id, Slot::Todos, cx);
    }

    /// Translate was pressed on a message: its translation, asked once and kept for this visit.
    pub(super) fn translate(&mut self, thread_id: &str, part: usize, message_id: String, cx: &mut Context<Self>) {
        self.reader.translated.insert(message_id.clone());
        let extras = self.extras(thread_id);
        match extras.translations.get(&message_id) {
            Some(Got::Here(_)) => return self.show_translation(thread_id, part, &message_id, cx),
            Some(Got::Pending) => return,
            _ => {}
        }
        extras.translations.insert(message_id.clone(), Got::Pending);
        let query = format!(
            "message={}",
            url::form_urlencoded::byte_serialize(message_id.as_bytes()).collect::<String>()
        );
        let path = with_query(conversation_path(thread_id, "/translation"), &query);
        let thread_id = thread_id.to_string();
        self.fetch(
            cx,
            move |client| client.get_json::<Translation>(&path),
            move |this, result, cx| {
                let wanted = this.reader.translated.contains(&message_id);
                match result {
                    Ok(translation) => {
                        this.extras(&thread_id).translations.insert(message_id.clone(), Got::Here(translation));
                        if wanted {
                            this.show_translation(&thread_id, part, &message_id, cx);
                        }
                    }
                    // A failed translation turns back to the original, with a note why.
                    Err(error) => {
                        this.extras(&thread_id).translations.remove(&message_id);
                        if wanted {
                            this.toast_error(error, cx);
                            this.show_original(&thread_id, part, &message_id, cx);
                        }
                    }
                }
            },
        );
    }

    fn show_translation(&mut self, thread_id: &str, part: usize, message_id: &str, cx: &mut Context<Self>) {
        match self.translation_html(thread_id, message_id) {
            Some(html) => {
                if self.page_shows(thread_id) {
                    self.tell_page(&format!("even.translation({part},{})", js(&html)), cx);
                }
            }
            // Mail already in the reader's language turns back to the original.
            None => {
                self.toast(
                    t("This mail is already in English.", "Deze mail is al in het Nederlands."),
                    ToastKind::Plain,
                    None,
                    false,
                    cx,
                );
                self.show_original(thread_id, part, message_id, cx);
            }
        }
    }

    fn show_original(&mut self, thread_id: &str, part: usize, message_id: &str, cx: &mut Context<Self>) {
        self.reader.translated.remove(message_id);
        if self.page_shows(thread_id) {
            self.tell_page(&format!("even.translation({part},null)"), cx);
        }
    }

    /// A message's translation as it shows in its place (`MessageTranslation`),
    /// or none when there is none to show.
    pub(super) fn translation_html(&self, thread_id: &str, message_id: &str) -> Option<String> {
        let translation = self.reader.extras.get(thread_id)?.translations.get(message_id)?.here()?;
        if translation.same {
            return None;
        }
        let from = if translation.from.is_empty() {
            t("Translated", "Vertaald").to_string()
        } else {
            let language = escape(&translation.from);
            t(format!("Translated from {language}"), format!("Vertaald uit het {language}"))
        };
        Some(format!(
            r#"<p class="from xs mu">{}{from}</p><p class="text">{}</p>"#,
            icon("translate"),
            escape(&translation.text)
        ))
    }
}

/// Where the file goes unless another is picked: where this sender's mail
/// went before, the default, or the only administration there is.
fn moneybird_target<'a>(connection: &'a Connection, extras: &Extras) -> Option<&'a Administration> {
    let administrations = &connection.administrations;
    let known = |id: Option<&str>| id.and_then(|id| administrations.iter().find(|item| item.id == id));
    let suggested = extras.moneybird.here().and_then(|thread| thread.suggested_administration_id.as_deref());
    known(suggested)
        .or_else(|| known(connection.default_target.as_ref().map(|target| target.id.as_str())))
        .or_else(|| (administrations.len() == 1).then(|| &administrations[0]))
}

/// A string as JavaScript reads it.
pub(super) fn js(text: &str) -> String {
    serde_json::to_string(text).unwrap_or_else(|_| "\"\"".into())
}

/// The cards with made-up content, to look at without a mail that has them
/// (`EVEN_MAIL_DEBUG=cards`). Nothing is asked from anywhere.
pub(super) fn sample(slot: Slot, thread_id: &str) -> String {
    let at = Utc::now();
    match slot {
        Slot::Shipment => shipment_card(
            &Shipment {
                carrier: Some("postnl".into()),
                tracking_code: Some("3SABCD1234567890".into()),
                tracking_url: Some("https://jouw.postnl.nl/track-and-trace/3SABCD1234567890".into()),
                merchant: Some("Coolblue".into()),
                status: Some("out_for_delivery".into()),
                subject: String::new(),
                received_at: at,
                thread: None,
            },
            thread_id,
        ),
        Slot::Invoice => invoice_card(
            &Invoice {
                vendor: Some("Moneybird B.V.".into()),
                amount_cents: Some(12100),
                currency: Some("EUR".into()),
                due_date: Some("2026-11-20".into()),
                invoice_number: Some("2026-0042".into()),
                pay_url: Some("https://example.com/pay".into()),
                status: "due".into(),
                overdue: false,
                subject: String::new(),
                received_at: at,
                thread: None,
            },
            thread_id,
            format!(
                r#"<div class="mb open" role="group"><button type="button" class="btn outline sm" data-tip="{}">{}</button><span class="sep"></span><button type="button" class="btn outline icon-sm arrow" data-act="menu">{}</button><div class="menu"><p class="mlabel xs mu">{}</p><button type="button" class="item radio"><span class="cut">factuur-2026-0042.pdf</span>{}</button><button type="button" class="item radio"><span class="cut">algemene-voorwaarden.pdf</span></button><div class="rule"></div><p class="mlabel xs mu">{}</p><button type="button" class="item"><span class="cut">Bijvoorbeeld Zo</span></button><button type="button" class="item"><span class="cut">Daize</span></button></div></div>"#,
                t("Choose an administration", "Kies een administratie"),
                t("To Moneybird", "Naar Moneybird"),
                icon("arrow-down-01"),
                t("File", "Bestand"),
                icon_with("tick-02", "on mu"),
                t("Put in", "Zetten in"),
            ),
        ),
        Slot::Todos => todos_card(&[
            Todo {
                title: "Offerte nakijken en terugsturen".into(),
                completed: false,
                in_progress: false,
                list_name: "Werk".into(),
                url: "https://example.com".into(),
            },
            Todo {
                title: "Bellen over de levering".into(),
                completed: false,
                in_progress: true,
                list_name: "Werk".into(),
                url: "https://example.com".into(),
            },
            Todo {
                title: "Factuur betalen".into(),
                completed: true,
                in_progress: false,
                list_name: "Thuis".into(),
                url: "https://example.com".into(),
            },
        ]),
        Slot::Summary => [
            summary_card(&Got::Here(Summary::Code { code: "482 913".into() }), true),
            summary_card(
                &Got::Here(Summary::Summary {
                    summary: "The parcel arrives today between 14:00 and 16:00. The invoice of € 121,00 is due on 20 November; paying goes through the link in the mail.".into(),
                }),
                true,
            ),
            summary_card(&Got::Pending, true),
        ]
        .concat(),
        Slot::Replies => replies_list(&[
            Suggestion {
                label: "Yes, that works".into(),
                text: String::new(),
            },
            Suggestion {
                label: "Can we move it to Friday?".into(),
                text: String::new(),
            },
            Suggestion {
                label: "No, thanks".into(),
                text: String::new(),
            },
        ]),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        book_files, likeliest_invoice, looks_like_invoice, looks_like_shipment, todos_card, with_query, Conversation,
        MoneybirdThread, Summary, Thread, Todo,
    };
    use crate::api::{Address, Attachment};
    use chrono::Utc;
    use crate::email::Body;

    fn thread(from: &str, subject: &str) -> Thread {
        Thread {
            id: "m1".into(),
            account_id: "a1".into(),
            subject: subject.into(),
            snippet: String::new(),
            from_name: None,
            from_email: Some(from.into()),
            received_at: Utc::now(),
            is_read: true,
            is_starred: false,
            has_attachments: false,
            message_count: 1,
            to: None,
        }
    }

    #[test]
    fn only_shipping_and_money_mail_is_asked_about() {
        assert!(looks_like_shipment(&thread("noreply@edm.postnl.nl", "Hallo")));
        assert!(looks_like_shipment(&thread("shop@example.nl", "Je pakket is onderweg")));
        assert!(!looks_like_shipment(&thread("order@amazon.nl", "Your account")));
        assert!(!looks_like_shipment(&thread("jan@example.nl", "Lunch?")));
        assert!(looks_like_invoice(&thread("receipts@stripe.com", "Hallo")));
        assert!(looks_like_invoice(&thread("jan@example.nl", "Factuur 2026-01")));
        assert!(!looks_like_invoice(&thread("jan@example.nl", "Bonus")));
    }

    fn file(name: &str, content_type: &str, size: u64) -> Attachment {
        Attachment {
            id: name.into(),
            name: name.into(),
            size,
            content_type: content_type.into(),
        }
    }

    fn conversation(attachments: Vec<Vec<Attachment>>) -> Conversation {
        Conversation {
            subject: String::new(),
            parts: attachments
                .into_iter()
                .enumerate()
                .map(|(index, attachments)| super::super::super::conversation::Part {
                    message_id: format!("m{index}"),
                    from: None::<Address>,
                    to: vec![],
                    cc: vec![],
                    received_at: Utc::now(),
                    preview: String::new(),
                    body: Body::Empty,
                    translatable: false,
                    unsubscribe: None,
                    attachments,
                })
                .collect(),
            remote_images: false,
            last: None,
        }
    }

    #[test]
    fn moneybird_takes_pdfs_first_and_the_likeliest_invoice() {
        let both = conversation(vec![
            vec![file("logo.png", "image/png", 90_000), file("algemene-voorwaarden.pdf", "application/pdf", 5_000)],
            vec![file("Factuur 12.PDF", "application/octet-stream", 80_000), file("leeg.pdf", "application/pdf", 0)],
        ]);
        let files = book_files(&both);
        // Newest message first, PDFs only, nothing empty.
        assert_eq!(files.iter().map(|file| file.name.as_str()).collect::<Vec<_>>(), ["Factuur 12.PDF", "algemene-voorwaarden.pdf"]);
        assert_eq!(likeliest_invoice(&files).unwrap().name, "Factuur 12.PDF");
        assert_eq!(files[0].key(), "80000:Factuur 12.PDF");
        let pictures = conversation(vec![vec![file("bon.jpg", "image/jpeg", 300_000), file("icon.png", "image/png", 4_000)]]);
        assert_eq!(book_files(&pictures).len(), 1);
    }

    #[test]
    fn reads_what_the_api_says() {
        assert!(matches!(serde_json::from_str(r#"{"kind":"code","code":"123 456"}"#), Ok(Summary::Code { .. })));
        assert!(matches!(serde_json::from_str(r#"{"kind":"summary","summary":"x"}"#), Ok(Summary::Summary { .. })));
        assert!(matches!(serde_json::from_str(r#"{"kind":"none"}"#), Ok(Summary::None)));
        let thread: MoneybirdThread =
            serde_json::from_str(r#"{"exports":[{"messageId":"m","attachmentName":"a","attachmentKey":"1:a","administrationId":"x","administrationName":"X","url":"https://m","createdAt":"2026"}],"suggestedAdministrationId":null}"#)
                .unwrap();
        assert_eq!(thread.exports[0].attachment_key, "1:a");
    }

    #[test]
    fn cards_escape_what_mail_says_and_only_link_to_the_web() {
        let card = todos_card(&[Todo {
            title: "<b>x</b>".into(),
            completed: true,
            in_progress: false,
            list_name: "L".into(),
            url: "javascript:alert(1)".into(),
        }]);
        assert!(card.contains("&lt;b&gt;x&lt;/b&gt;"));
        assert!(card.contains(r#"href="""#));
        assert_eq!(with_query("/a".into(), "x=1"), "/a?x=1");
        assert_eq!(with_query("/a?t=1".into(), "x=1"), "/a?t=1&x=1");
        assert_eq!(with_query("/a".into(), ""), "/a");
    }
}
