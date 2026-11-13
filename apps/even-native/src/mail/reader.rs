//! The reading pane, the floating panel beside the list (the second section
//! of apps/mail-web/src/pages/inbox.tsx): the open conversation
//! (pages/conversation.tsx), a new message, one sender while tidying up, or
//! the day when nothing is open.
//!
//! GPUI draws the toolbar and the dialogs; a system webview draws everything
//! that scrolls under the toolbar (`page`): mail is HTML, and the cards and
//! the bar around it scroll with it. The webview lies above everything GPUI
//! draws, so what would overlap it lives in the page itself (tooltips, the
//! Moneybird menu), and the page makes way for dialogs (`MailView::veiled`).

use std::collections::{HashMap, HashSet};

use gpui_webview::WebView;

use crate::email::{self, Act};
use crate::i18n::{lang, Lang};
use crate::ui;

use super::api::{can_report_spam, move_actions};
use super::list::{is_destructive, move_icon, move_label};
use super::overlays::{Confirm, Recognition, SnoozeTarget};
use super::*;

mod dialogs;
mod extras;
mod page;

/// The toolbar above the conversation (`h-10`).
const TOOLBAR: f32 = 40.;
/// A tool in it (`size="icon-sm"`), and the room between two (`gap-0.5`).
const TOOL: f32 = 28.;
const TOOL_GAP: f32 = 2.;
/// The toolbar's padding at its ends (`px-2`).
const TOOLBAR_EDGE: f32 = 8.;
/// After "Not recognised well" the card is asked for again, once the report is in.
const RECHECK_AFTER: Duration = Duration::from_millis(1500);
/// A message being translated, until its translation is there (reader.js has the same).
const TRANSLATING: &str = r#"<div class="lines"><div class="sk" style="width:100%"></div><div class="sk" style="width:91.6667%"></div><div class="sk" style="width:66.6667%"></div></div>"#;

/// What the reader keeps beside the conversations themselves.
pub(crate) struct State {
    /// What was asked about each conversation opened during this visit.
    extras: HashMap<String, extras::Extras>,
    /// Moneybird, when it is connected and usable.
    connections: extras::Got<Option<extras::Connection>>,
    connections_at: Option<std::time::Instant>,
    /// The lists in Even doen a task can go to.
    todo_lists: extras::Got<Vec<extras::TodoList>>,
    /// Mailing lists left during this visit, so their button says so on every message.
    left: HashSet<String>,
    /// The messages of the open conversation that show translated.
    translated: HashSet<String>,
    dialog: Option<dialogs::Dialog>,
    /// The page that said it is there; what arrives can be put in it.
    ready: u64,
    /// Whether the page was told an answer is being written; `None` until it is there to tell.
    replying: Option<bool>,
    /// How far the page was scrolled, for the one that replaces it.
    scroll: usize,
    /// The language the page was written in.
    lang: Lang,
    /// A card was reported: it is asked for again once the question is gone.
    recheck: Option<(String, Recognition)>,
    debug: Debug,
}

/// States for `scripts/shot.sh` that otherwise need a click, from
/// `EVEN_MAIL_DEBUG` (see the README).
#[derive(Default)]
struct Debug {
    /// Any debug state is asked for: the models are left alone unless `ai`.
    on: bool,
    ai: bool,
    /// The cards above the mail, with made-up content.
    cards: bool,
    /// Opens the conversation with the most messages, or the first with a file.
    long: bool,
    files: bool,
    todo: bool,
    unsubscribe: bool,
    tip: bool,
    /// The conversation as it looks while it is being fetched.
    pending: bool,
}

impl Debug {
    fn from_env() -> Self {
        let Ok(wanted) = std::env::var("EVEN_MAIL_DEBUG") else {
            return Self::default();
        };
        let has = |name: &str| wanted.split(',').any(|state| state.trim() == name);
        Self {
            on: true,
            ai: has("ai"),
            cards: has("cards"),
            long: has("long"),
            files: has("files"),
            todo: has("todo"),
            unsubscribe: has("unsubscribe"),
            tip: has("tip"),
            pending: has("pending"),
        }
    }

    fn sample(&self, slot: extras::Slot, thread_id: &str) -> Option<String> {
        self.cards.then(|| extras::sample(slot, thread_id))
    }
}

impl Default for State {
    fn default() -> Self {
        Self {
            extras: HashMap::new(),
            connections: extras::Got::No,
            connections_at: None,
            todo_lists: extras::Got::No,
            left: HashSet::new(),
            translated: HashSet::new(),
            dialog: None,
            ready: 0,
            replying: None,
            scroll: 0,
            lang: lang(),
            recheck: None,
            debug: Debug::from_env(),
        }
    }
}

impl State {
    /// A dialog of the reader's lies over mail.
    pub(crate) fn in_dialog(&self) -> bool {
        self.dialog.is_some()
    }
}

/// What the bar under a conversation starts (`ReplyMode`).
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Answer {
    Reply,
    All,
    Forward,
}

/// How a tool in the toolbar looks.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Look {
    Plain,
    /// Red on hover, as every action that throws mail away (`DANGER`).
    Danger,
    /// The star of a starred conversation (`STARRED`).
    Starred,
}

/// The panel's colour as the webview's own background, so nothing flashes
/// while a mail loads: `--sidebar`, dark and light.
fn backdrop(dark: bool) -> (u8, u8, u8, u8) {
    if dark {
        (0x17, 0x17, 0x17, 255)
    } else {
        (0xfa, 0xfa, 0xfa, 255)
    }
}

/// Inter for the page, from the fonts the binary carries.
fn font(path: &str) -> wry::http::Response<std::borrow::Cow<'static, [u8]>> {
    let name = path.trim_start_matches('/');
    let known = name.starts_with("Inter-") && name.ends_with(".ttf") && !name.contains(['/', '\\']);
    let bytes = known
        .then(|| crate::assets::Assets.load(&format!("fonts/{name}")).ok().flatten())
        .flatten();
    let response = match bytes {
        Some(bytes) => wry::http::Response::builder()
            .header("Content-Type", "font/ttf")
            // The page has no origin of its own, and fonts are fetched with CORS.
            .header("Access-Control-Allow-Origin", "*")
            .body(bytes),
        None => wry::http::Response::builder().status(404).body(std::borrow::Cow::Borrowed(&[][..])),
    };
    response.unwrap_or_default()
}

impl MailView {
    /// The webview, built the first time a conversation shows.
    fn webview(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Option<Entity<WebView>> {
        if self.webview.is_none() {
            let ipc = self.ipc.clone();
            let dark = theme::is_dark();
            let builder = wry::WebViewBuilder::new()
                .with_background_color(backdrop(dark))
                .with_html(format!(
                    "<html><body style=\"background:{}\"></body></html>",
                    if dark { "#171717" } else { "#fafafa" }
                ))
                // Only our nonce'd script can post here; the view still parses and checks each message.
                .with_ipc_handler(move |request| {
                    let _ = ipc.unbounded_send(request.body().clone());
                })
                .with_custom_protocol("evenfont".into(), |_, request| font(request.uri().path()))
                // The mail never navigates: links open in the browser.
                .with_navigation_handler(|url| {
                    if is_outside(&url) {
                        let _ = open::that_detached(&url);
                        return false;
                    }
                    true
                })
                .with_new_window_req_handler(|url, _| {
                    if is_outside(&url) {
                        let _ = open::that_detached(&url);
                    }
                    wry::NewWindowResponse::Deny
                });
            match WebView::build(builder, window, cx) {
                Ok(webview) => self.webview = Some(cx.new(|_| webview)),
                Err(error) => {
                    eprintln!("The mail view doesn't start: {error}");
                    return None;
                }
            }
        }
        self.webview.clone()
    }

    fn hide_webview(&mut self, cx: &mut Context<Self>) {
        if let Some(webview) = &self.webview {
            webview.update(cx, |webview, _| {
                if webview.visible() {
                    webview.hide();
                }
            });
        }
    }

    /// The conversation, once it is there to read.
    fn conversation(&self, thread_id: &str) -> Option<Arc<conversation::Conversation>> {
        match self.reading.get(thread_id) {
            Some(Reading::Ready(conversation)) => Some(conversation.clone()),
            _ => None,
        }
    }

    /// Whether the page on screen is this conversation's, and there to be told things.
    fn page_shows(&self, thread_id: &str) -> bool {
        self.reader.ready == self.document && self.shown.as_ref().is_some_and(|(shown, ..)| shown == thread_id)
    }

    /// Runs a line of our own script in the page.
    fn tell_page(&self, script: &str, cx: &App) {
        if let Some(webview) = &self.webview {
            let _ = webview.read(cx).raw().evaluate_script(script);
        }
    }

    pub(super) fn render_reader(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.reader_debug(window, cx);
        // `.floating-panel … md:m-2`.
        let shell = ui::floating_panel().flex().flex_col().flex_1().min_w_0().m(px(8.));
        // A new message takes the reader's place.
        if self.composing() {
            self.hide_webview(cx);
            return shell.children(self.render_composer(cx));
        }
        let Some(thread) = self.open.clone() else {
            self.hide_webview(cx);
            return match self.pane_sender().cloned() {
                Some(sender) => shell.child(self.render_sender_pane(&sender, cx)),
                None if self.view == View::Senders => shell.child(
                    div().flex().flex_1().items_center().justify_center().child(
                        div()
                            .max_w(px(320.))
                            .px(px(24.))
                            .text_center()
                            .text_size(px(14.))
                            .text_color(theme::muted())
                            .child(t(
                                "Choose a sender to see their mail and tidy it up.",
                                "Kies een afzender om hun mail te zien en op te ruimen.",
                            )),
                    ),
                ),
                None => shell.child(self.render_empty_pane()),
            };
        };
        let id = thread.id.clone();
        self.load_extras(&thread, cx);
        self.recheck_reported(cx);
        let conversation = match self.reading.get(&id) {
            Some(Reading::Ready(conversation)) if !self.reader.debug.pending => Some(conversation.clone()),
            _ => None,
        };
        let Some(conversation) = conversation else {
            self.hide_webview(cx);
            let toolbar = self.render_toolbar(&thread, false, cx);
            let failed = match self.reading.get(&id) {
                Some(Reading::Failed(error)) => Some(error.clone()),
                _ => None,
            };
            return shell.child(toolbar).child(pending(&thread, failed));
        };
        let Some(webview) = self.webview(window, cx) else {
            return shell.child(self.render_toolbar(&thread, false, cx));
        };
        let images_allowed = self.images.contains(&id) || Feature::RemoteImages.on();
        let dark = theme::is_dark();
        // The page says its words in the language it was written in.
        if self.reader.lang != lang() {
            self.reader.lang = lang();
            self.shown = None;
        }
        // The answer under the conversation; the page's bar makes way for it.
        let composer = self.render_composer(cx);
        let replying = composer.is_some();
        let wanted = (id.clone(), images_allowed, dark);
        if self.shown.as_ref() != Some(&wanted) {
            // Another conversation starts at its top, with every message as it was written.
            if self.shown.as_ref().is_none_or(|(shown, ..)| *shown != id) {
                self.reader.translated.clear();
                self.reader.scroll = 0;
            }
            self.document += 1;
            let translated = conversation
                .parts
                .iter()
                .map(|part| {
                    self.reader.translated.contains(&part.message_id).then(|| {
                        self.translation_html(&id, &part.message_id).unwrap_or_else(|| TRANSLATING.to_string())
                    })
                })
                .collect();
            let document = page::build(&page::Page {
                conversation: &conversation,
                view: self.document,
                nonce: &self.nonce,
                dark,
                allow_images: images_allowed,
                scroll: std::mem::take(&mut self.reader.scroll),
                account: self.mailbox(&thread.account_id),
                replying,
                unsubscribe: Feature::Unsubscribe.on(),
                left: &self.reader.left,
                translated,
                slots: self.slots(&id),
            });
            let _ = webview.read(cx).raw().set_background_color(backdrop(dark));
            let _ = webview.read(cx).load_html(&document);
            self.shown = Some(wanted);
            self.reader.replying = None;
        } else if self.reader.replying != Some(replying) && self.page_shows(&id) {
            self.reader.replying = Some(replying);
            self.tell_page(&format!("even.replying({replying})"), cx);
        }
        let veiled = self.veiled();
        webview.update(cx, |webview, _| {
            if veiled {
                webview.hide();
            } else if !webview.visible() {
                webview.show();
            }
        });
        let toolbar = self.render_toolbar(&thread, !veiled && self.page_shows(&id), cx);
        shell
            .child(toolbar)
            // The webview lies above everything GPUI draws: it leaves room for the
            // toasts, and stays clear of the panel's round corners.
            .child(
                div()
                    .flex_1()
                    .min_h_0()
                    .pb(px(self.toast_room().max(10.)))
                    .child(webview),
            )
            .children(composer)
    }

    /// What can be done with the open conversation (the `<header>` of
    /// pages/conversation.tsx): icons at the pane's right end, each named in
    /// a tooltip with its key. `in_page`: the page is on screen under the
    /// toolbar, where a tooltip of GPUI's would vanish beneath it, so the
    /// page shows the tooltip itself.
    fn render_toolbar(&self, thread: &Thread, in_page: bool, cx: &mut Context<Self>) -> Div {
        let folder = self.view.folder();
        let can_delete = self.mailbox(&thread.account_id).is_some_and(Mailbox::can_delete_forever);
        let starred = thread.is_starred;
        let snoozed = self.is_snoozed(&thread.id);
        // Pinning is for the inbox: opened from there, or from a list of what is in it.
        let pinnable =
            Feature::Pins.on() && folder.is_none() && !snoozed && !thread.id.starts_with(crate::api::REMOTE);
        let pinned = pinnable && self.is_pinned(&thread.id);
        let id = thread.id.clone();
        type Run = Box<dyn Fn(&mut MailView, &mut Window, &mut Context<MailView>)>;
        let mut tools: Vec<(&'static str, &'static str, &'static str, &'static str, Look, Run)> = vec![(
            "star",
            if starred { "star-filled" } else { "star" },
            if starred { t("Remove star", "Ster verwijderen") } else { t("Star", "Ster toevoegen") },
            "S",
            if starred { Look::Starred } else { Look::Plain },
            Box::new(move |this, _, cx| {
                this.leave(if starred { ThreadAction::Unstar } else { ThreadAction::Star }, None, cx)
            }),
        )];
        if can_report_spam(folder) {
            tools.push((
                "spam",
                "spam",
                t("Report spam", "Spam melden"),
                "!",
                Look::Plain,
                Box::new(|this, _, cx| this.leave(ThreadAction::Spam, None, cx)),
            ));
        }
        for action in move_actions(folder, can_delete) {
            let (name, key) = match action {
                ThreadAction::Archive => ("archive", "E"),
                ThreadAction::Trash => ("trash", "#"),
                ThreadAction::Inbox => ("inbox", "I"),
                _ => ("delete", ""),
            };
            tools.push((
                name,
                move_icon(action),
                move_label(action, folder),
                key,
                if is_destructive(action) { Look::Danger } else { Look::Plain },
                Box::new(move |this, _, cx| this.leave(action, None, cx)),
            ));
        }
        if snoozed {
            let id = id.clone();
            tools.push((
                "unsnooze",
                "alarm-clock-off",
                t("Unsnooze", "Niet meer snoozen"),
                "B",
                Look::Plain,
                Box::new(move |this, _, cx| this.unsnooze(id.clone(), cx)),
            ));
        } else {
            tools.push((
                "snooze",
                "alarm-clock",
                t("Snooze", "Snoozen"),
                "B",
                Look::Plain,
                Box::new(|this, window, cx| this.open_when(SnoozeTarget::Open, window, cx)),
            ));
        }
        tools.push((
            "unread",
            "mail-open-01",
            t("Mark as unread", "Markeren als ongelezen"),
            "U",
            Look::Plain,
            Box::new(|this, _, cx| this.leave(ThreadAction::Unread, None, cx)),
        ));
        if pinnable {
            let target = thread.clone();
            tools.push((
                "pin",
                if pinned { "pin-off" } else { "pin" },
                if pinned { t("Unpin", "Losmaken") } else { t("Pin to top", "Bovenaan vastpinnen") },
                "P",
                Look::Plain,
                Box::new(move |this, _, cx| this.set_pinned(target.clone(), !pinned, cx)),
            ));
        }
        if Feature::Todos.on() {
            tools.push((
                "todo",
                "task-add-01",
                t("Make a task", "Taak maken"),
                "T",
                Look::Plain,
                Box::new(|this, window, cx| this.open_todo(window, cx)),
            ));
        }
        let count = tools.len();
        let tools = tools.into_iter().enumerate().map(|(index, (name, icon, label, key, look, run))| {
            // Where the tool's middle is, from the pane's right edge: the page puts its name there.
            let right = TOOLBAR_EDGE + TOOL / 2. + (count - 1 - index) as f32 * (TOOL + TOOL_GAP);
            tool(name, icon, look)
                .map(|el| {
                    if in_page {
                        el.on_hover(cx.listener(move |this, hovering: &bool, _, cx| {
                            let script = if *hovering {
                                format!("even.tip({},{},{right})", extras::js(label), extras::js(key))
                            } else {
                                "even.tip(null)".to_string()
                            };
                            this.tell_page(&script, cx);
                        }))
                    } else if key.is_empty() {
                        el.tooltip(ui::tip(label))
                    } else {
                        el.tooltip(ui::tip_with_hint(label, key))
                    }
                })
                .on_click(cx.listener(move |this, _, window, cx| {
                    this.tell_page("even.tip(null)", cx);
                    run(this, window, cx)
                }))
        });
        div()
            .flex()
            .flex_none()
            .items_center()
            .justify_end()
            .gap(px(TOOL_GAP))
            .h(px(TOOLBAR))
            .px(px(TOOLBAR_EDGE))
            .children(tools)
    }

    /// The bar under the conversation, R, A and F: an answer, or sending it on.
    /// A picked suggestion goes along as what the answer starts from.
    pub(crate) fn answer(&mut self, mode: Answer, prefill: Option<String>, window: &mut Window, cx: &mut Context<Self>) {
        if self.open.is_none() {
            return;
        }
        match (mode, prefill) {
            (Answer::Reply, Some(text)) => self.compose_reply_with(text, window, cx),
            (Answer::Reply, None) => self.compose_reply(false, window, cx),
            (Answer::All, _) => self.compose_reply(true, window, cx),
            (Answer::Forward, _) => self.compose_forward(window, cx),
        }
    }

    /// Something our script in the page says, beside keys and downloads.
    pub(super) fn page_message(&mut self, message: email::Message, window: &mut Window, cx: &mut Context<Self>) {
        match message {
            email::Message::Ready { view } if view == self.document => {
                self.reader.ready = view;
                let Some((id, ..)) = self.shown.clone() else { return };
                // What arrived while the page was loading.
                self.push_slots(&id, cx);
                if let Some(conversation) = self.conversation(&id) {
                    for (index, part) in conversation.parts.iter().enumerate() {
                        if self.reader.translated.contains(&part.message_id) {
                            if let Some(html) = self.translation_html(&id, &part.message_id) {
                                self.tell_page(&format!("even.translation({index},{})", extras::js(&html)), cx);
                            }
                        }
                    }
                }
                // Whether an answer is being written is told with the next draw.
                self.reader.replying = None;
                if std::mem::take(&mut self.reader.debug.tip) {
                    let right = TOOLBAR_EDGE + TOOL / 2. + 3. * (TOOL + TOOL_GAP);
                    self.tell_page(&format!("even.tip(\"Archive\",\"E\",{right})"), cx);
                }
                // The toolbar's tools name themselves in the page from now on.
                cx.notify();
            }
            email::Message::Act { view, act, arg } if view == self.document => self.page_act(act, arg, window, cx),
            _ => {}
        }
    }

    /// A click in the page. The numbers come from the webview, so they only
    /// count for the conversation on screen and what it really has.
    fn page_act(&mut self, act: Act, arg: Option<usize>, window: &mut Window, cx: &mut Context<Self>) {
        let Some(thread) = self.open.clone() else { return };
        let id = thread.id.clone();
        if !self.shown.as_ref().is_some_and(|(shown, ..)| *shown == id) {
            return;
        }
        let Some(conversation) = self.conversation(&id) else { return };
        let part = arg.and_then(|index| conversation.parts.get(index).map(|part| (index, part)));
        match act {
            Act::Images => {
                self.images.insert(id);
                self.reader.scroll = arg.unwrap_or(0);
                cx.notify();
            }
            Act::Translate => {
                if let Some((index, part)) = part.filter(|(_, part)| part.translatable) {
                    self.translate(&id, index, part.message_id.clone(), cx);
                }
            }
            Act::Original => {
                if let Some((_, part)) = part {
                    self.reader.translated.remove(&part.message_id);
                }
            }
            Act::Unsubscribe => {
                let Some((_, part)) = part else { return };
                let Some(unsubscribe) = part.unsubscribe.as_ref().filter(|_| Feature::Unsubscribe.on()) else {
                    return;
                };
                let sender = match &part.from {
                    Some(from) => from.label().to_string(),
                    None => t("Unknown sender", "Onbekende afzender").to_string(),
                };
                self.ask_unsubscribe(id, part.message_id.clone(), sender, unsubscribe, window, cx);
            }
            Act::Copy => self.copy_from_card(&id, arg.unwrap_or(usize::MAX), cx),
            Act::Report => {
                let kind = match arg {
                    Some(0) => Recognition::Parcel,
                    Some(1) => Recognition::Invoice,
                    _ => return,
                };
                if id.starts_with(crate::api::REMOTE) {
                    return;
                }
                self.reader.recheck = Some((id.clone(), kind));
                self.confirm(Confirm::Report { kind, thread: id }, window, cx);
            }
            Act::Reply => {
                let mode = match arg {
                    Some(0) => Answer::Reply,
                    Some(1) => Answer::All,
                    Some(2) => Answer::Forward,
                    _ => return,
                };
                self.answer(mode, None, window, cx);
            }
            Act::Suggest => {
                if let Some(text) = arg.and_then(|index| self.suggestion(&id, index)) {
                    self.answer(Answer::Reply, Some(text), window, cx);
                }
            }
            Act::MoneybirdSend => self.moneybird_send(&thread, arg, cx),
            Act::MoneybirdFile => {
                if let Some(index) = arg {
                    self.moneybird_pick_file(&id, index, cx);
                }
            }
        }
    }

    /// A card was reported as not recognised well: once the question is gone
    /// and the report has had a moment, the card is asked for again.
    fn recheck_reported(&mut self, cx: &mut Context<Self>) {
        if self.overlay.is_some() {
            return;
        }
        let Some((thread_id, kind)) = self.reader.recheck.take() else { return };
        cx.spawn(async move |this, cx| {
            cx.background_executor().timer(RECHECK_AFTER).await;
            let _ = this.update(cx, |this, cx| this.recheck_card(thread_id, kind, cx));
        })
        .detach();
    }

    /// The states `EVEN_MAIL_DEBUG` asks of the reader, once their data is there.
    fn reader_debug(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.reader.debug.on {
            return;
        }
        if (self.reader.debug.long || self.reader.debug.files) && !self.rows.is_empty() {
            let read = self.rows.iter().filter(|thread| thread.is_read);
            let pick = if std::mem::take(&mut self.reader.debug.long) {
                read.max_by_key(|thread| thread.message_count).cloned()
            } else {
                read.clone().find(|thread| thread.has_attachments).cloned()
            };
            self.reader.debug.files = false;
            if let Some(thread) = pick {
                self.open_thread(thread, cx);
            }
        }
        let Some(thread) = self.open.clone() else { return };
        if !matches!(self.reading.get(&thread.id), Some(Reading::Ready(_))) {
            return;
        }
        if std::mem::take(&mut self.reader.debug.todo) {
            self.open_todo(window, cx);
        }
        if std::mem::take(&mut self.reader.debug.unsubscribe) {
            let unsubscribe = crate::api::Unsubscribe {
                url: Some("https://www.example.com/unsubscribe".into()),
                mailto: None,
                one_click: true,
            };
            self.ask_unsubscribe(thread.id.clone(), String::new(), sender_name(&thread), &unsubscribe, window, cx);
        }
    }
}

/// What the list already knows, while the message itself comes in; or that
/// it couldn't be opened.
fn pending(thread: &Thread, failed: Option<SharedString>) -> Div {
    // `readingColumn` and the scroller's padding.
    let column = div().flex().flex_col().w_full().max_w(px(768.)).mx_auto().px(px(32.)).pt(px(8.)).child(
        div()
            .mb(px(8.))
            .text_size(px(18.))
            .line_height(px(28.))
            .font_weight(FontWeight::SEMIBOLD)
            .child(thread.subject.clone()),
    );
    let column = if let Some(error) = failed {
        column.child(div().py(px(16.)).text_size(px(14.)).text_color(theme::danger()).child(error))
    } else {
        column.child(
            div()
                .flex()
                .flex_col()
                .gap(px(12.))
                .py(px(8.))
                .text_size(px(14.))
                .line_height(px(20.))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .gap(px(12.))
                        .child(div().font_weight(FontWeight::MEDIUM).child(sender_name(thread)))
                        .child(div().child(ui::spinner())),
                )
                .child(div().text_color(theme::muted()).child(thread.snippet.clone())),
        )
    };
    div().flex_1().min_h_0().overflow_hidden().child(column)
}

/// A toolbar action: its sign (`ToolbarAction`, a ghost `icon-sm` button).
fn tool(id: &'static str, icon: &'static str, look: Look) -> Stateful<Div> {
    let group = SharedString::from(format!("tool-{id}"));
    let (color, hover) = match look {
        Look::Plain => (theme::muted(), theme::foreground()),
        Look::Danger => (theme::muted(), theme::danger()),
        Look::Starred => (list::amber(), list::amber()),
    };
    div()
        .id(id)
        .group(group.clone())
        .flex()
        .flex_none()
        .items_center()
        .justify_center()
        .size(px(TOOL))
        .rounded(theme::RADIUS_MD)
        .cursor_pointer()
        // Throwing away only colours the sign.
        .when(look != Look::Danger, |el| el.hover(|el| el.bg(theme::muted_bg())))
        .child(theme::hi(icon).text_color(color).group_hover(group, move |el| el.text_color(hover)))
}

/// Links in the mail leave for the browser or the mail app; nothing else may leave the page.
fn is_outside(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    ["http:", "https:", "mailto:", "tel:"]
        .iter()
        .any(|scheme| lower.starts_with(scheme))
}
