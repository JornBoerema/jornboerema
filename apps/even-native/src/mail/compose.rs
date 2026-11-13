//! Writing mail, as apps/mail-web writes it: a new message or an opened
//! draft in the reader's place (pages/compose.tsx), and a reply, reply all or
//! forward under the open conversation (components/reply-forms.tsx). The
//! body is the shared rich text editor in mail mode (src/editor.rs), which is
//! a system webview: it is hidden while a menu, a dialog or the list of
//! suggested addresses must show over it, and the text stands in for it.
//!
//! - `recipients.rs`: the To, Cc and Bcc rows (components/address-row.tsx),
//!   on `addresses.rs` (lib/addresses.ts).
//! - `files.rs`: attachments (components/attachment-picker.tsx, lib/uploads.ts).
//! - `ai.rs`: writing with AI (components/ai-writer.tsx).
//! - `drafts.rs`: saving while writing (lib/drafts.ts), and replies kept on
//!   this Mac (lib/reply-drafts.ts).
//! - `form.rs`: how it looks.
//! - `wire.rs`: what it asks of the API.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::time::Instant;

use gpui_kit::component::input::{InputEvent, InputState};

use crate::api::Address;
use crate::ui;
use crate::editor::{from_inline_images, to_inline_images, Command, ContentRead, EditorEvent, InlineImage, Mode, RichEditor};

use super::*;

mod addresses;
mod ai;
mod drafts;
mod files;
mod form;
mod recipients;
mod wire;

use addresses::{is_email, parse_addresses, recipient_list, reply_recipients};
use ai::{text_to_editor_html, Ai};
use drafts::{Autosave, ReplyMode};
use files::ComposerFile;
use recipients::{AddressField, Which};
use wire::{DraftRef, InlineUpload, Outgoing};

actions!(mail_compose, [AiWrite]);

/// What is being written.
pub(super) enum Kind {
    /// A new message, or a draft opened again: it fills the reading pane.
    New,
    /// An answer to the sender (R) or to everyone (A), under its conversation.
    Reply {
        thread_id: String,
        message_id: String,
        all: bool,
    },
    /// The conversation's newest message sent on, with its files.
    Forward {
        thread_id: String,
        message_id: String,
        /// How many files go along.
        files: usize,
    },
}

/// An opened draft is read from its mailbox first.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Stage {
    Opening,
    Failed,
    Ready,
}

/// The body as the editor last told it (`RichTextValue`).
#[derive(Clone, Default)]
struct Body {
    text: String,
    html: String,
    /// The pictures `html` refers to as `cid:` links.
    inline: Vec<InlineUpload>,
    /// Something besides the signature has been written.
    written: bool,
}

/// The small menus of a composer. One at a time.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Menu {
    From,
    Signature,
    Later,
}

pub(super) struct Composer {
    kind: Kind,
    /// Tells this composer from the one before it, for what comes back later.
    key: u64,
    /// The mailbox it goes from.
    account: Option<String>,
    stage: Stage,
    /// The draft it was opened from: the page is then titled "Draft".
    opened: Option<DraftRef>,
    /// Keeps a draft that answers a conversation in that conversation. Opaque here.
    reply: Option<serde_json::Value>,
    to: AddressField,
    cc: AddressField,
    bcc: AddressField,
    /// Cc and Bcc show.
    copies: bool,
    /// Who a reply goes to: shown, and sent exactly as shown.
    reply_to: Vec<Address>,
    reply_cc: Vec<Address>,
    subject: Entity<InputState>,
    subject_text: String,
    subject_focused: bool,
    editor: Entity<RichEditor>,
    body: Body,
    /// A signature picked in this message, for the mailbox it was picked in.
    picked_signature: Option<(Option<String>, Option<String>)>,
    /// The signature the editor holds; none until the signatures are known.
    applied_signature: Option<String>,
    /// It started from content (a draft): that is assumed to have the right signature already.
    started_with_content: bool,
    files: Vec<ComposerFile>,
    ai: Ai,
    autosave: Autosave,
    /// A new message out of view for now: it waits as a draft to resume.
    hidden: bool,
    /// Sending, scheduling or discarding.
    busy: bool,
    menu: Option<Menu>,
    /// Only to look at (`EVEN_MAIL_DEBUG`): nothing is saved, uploaded, asked or sent.
    dry: bool,
    /// The editor was drawn this frame; one that wasn't is taken off the screen.
    shown: bool,
    /// Numbers the local saves of a reply, so only the last one is written.
    kept: u64,
    _subscriptions: Vec<Subscription>,
}

impl Composer {
    pub(super) fn is_new(&self) -> bool {
        matches!(self.kind, Kind::New)
    }

    /// The conversation an answer belongs to.
    fn thread(&self) -> Option<&str> {
        match &self.kind {
            Kind::New => None,
            Kind::Reply { thread_id, .. } | Kind::Forward { thread_id, .. } => Some(thread_id),
        }
    }

    fn mode(&self) -> Option<ReplyMode> {
        match &self.kind {
            Kind::New => None,
            Kind::Reply { all: false, .. } => Some(ReplyMode::Reply),
            Kind::Reply { all: true, .. } => Some(ReplyMode::All),
            Kind::Forward { .. } => Some(ReplyMode::Forward),
        }
    }

    /// A forward takes the message's own files along and no others.
    fn takes_files(&self) -> bool {
        !matches!(self.kind, Kind::Forward { .. })
    }

    /// Something worth coming back to (`hasDraft`).
    fn has_draft(&self) -> bool {
        !self.to.value().is_empty()
            || !self.cc.value().is_empty()
            || !self.bcc.value().is_empty()
            || !self.subject_text.is_empty()
            || self.body.written
            || !self.files.is_empty()
    }

    /// The message as it stands, as a draft is saved (`content` in pages/compose.tsx).
    fn content(&self) -> Outgoing {
        Outgoing {
            to: recipient_list(&self.to.value()),
            cc: recipient_list(&self.cc.value()),
            bcc: recipient_list(&self.bcc.value()),
            subject: self.subject_text.clone(),
            text: self.body.text.clone(),
            html: self.body.html.clone(),
            attachments: files::refs(&self.files),
            inline: self.body.inline.clone(),
            reply: self.reply.clone(),
        }
    }

    /// Where the AI writes for this message; a reply's carries its conversation.
    fn write_path(&self) -> String {
        let encode = |segment: &str| url::form_urlencoded::byte_serialize(segment.as_bytes()).collect::<String>();
        match &self.kind {
            Kind::Reply { thread_id, .. } | Kind::Forward { thread_id, .. } => {
                crate::api::conversation_path(thread_id, "/write")
            }
            // A saved reply opened as a message still answers its conversation.
            Kind::New => match (&self.account, self.content().reply_thread()) {
                (Some(account), Some(thread)) => format!(
                    "/api/mail/accounts/{}/conversation/write?thread={}",
                    encode(account),
                    encode(thread)
                ),
                _ => "/api/mail/write".into(),
            },
        }
    }

    fn field(&mut self, which: Which) -> &mut AddressField {
        match which {
            Which::To => &mut self.to,
            Which::Cc => &mut self.cc,
            Which::Bcc => &mut self.bcc,
        }
    }

    /// The addresses someone could pick from show under a row.
    fn suggesting(&self) -> bool {
        [&self.to, &self.cc, &self.bcc].into_iter().any(AddressField::open)
    }

    /// Whether a reply can go (`canSend` in reply-forms.tsx).
    fn can_send(&self) -> bool {
        match self.kind {
            Kind::New => !self.busy && self.account.is_some() && self.stage == Stage::Ready,
            Kind::Reply { .. } => {
                !self.busy && self.body.written && !self.reply_to.is_empty() && !files::is_uploading(&self.files)
            }
            Kind::Forward { .. } => !self.busy,
        }
    }
}

/// A message on its way out while it can still be taken back (lib/undo.ts).
struct Outbox {
    serial: u64,
    /// The "Sending…" toast, with Undo on it.
    toast: u64,
    key: u64,
    account: String,
    message: Outgoing,
    draft: Option<DraftRef>,
    files_changed: bool,
}

/// What writing keeps beside the composers themselves.
#[derive(Default)]
pub(super) struct Writing {
    /// The reply or forward under the open conversation.
    answer: Option<Composer>,
    serial: u64,
    /// The user's signatures, once asked for.
    signatures: Option<Vec<api::Signature>>,
    signatures_asked: Option<Instant>,
    /// Addresses the API suggested, by what was typed.
    contacts: HashMap<String, Vec<wire::Contact>>,
    outbox: Option<Outbox>,
    /// A message closed while it was being saved: saved once more when that is done.
    parting: HashMap<u64, drafts::Parting>,
    /// Where the menus hang from.
    anchors: Rc<RefCell<HashMap<&'static str, Bounds<Pixels>>>>,
    /// The conversation whose saved reply was looked for.
    restored: Option<String>,
    /// A draft to open once there is a window at hand.
    open_next: Option<DraftRef>,
    viewport: f32,
    /// The keyboard goes back to the list once nothing is written anymore.
    refocus: bool,
    /// `EVEN_MAIL_DEBUG` states that wait for a conversation to be open.
    debug: Vec<String>,
    _quit: Option<Subscription>,
}

/// What a composer starts with.
#[derive(Default)]
struct Start {
    to: Vec<String>,
    subject: String,
    /// Editor HTML to start from.
    content: Option<String>,
    /// That content is a saved message, with its signature in it.
    saved: bool,
    dry: bool,
}

impl MailView {
    /// The composer a key belongs to, if it is still there.
    pub(super) fn writer(&mut self, key: u64) -> Option<&mut Composer> {
        [self.composer.as_mut(), self.writing.answer.as_mut()]
            .into_iter()
            .flatten()
            .find(|composer| composer.key == key)
    }

    /// An error in a line, as the web's `toast.error`.
    pub(super) fn complain(&mut self, text: impl Into<SharedString>, cx: &mut Context<Self>) {
        self.toast(text, ToastKind::Error, None, false, cx);
    }

    fn active_mailbox(&self, id: &str) -> bool {
        self.mailbox(id).is_some_and(Mailbox::active)
    }

    /// A composer with its fields and editor, listening to them.
    fn build(
        &mut self,
        kind: Kind,
        account: Option<String>,
        start: Start,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Composer {
        self.writing.serial += 1;
        let key = self.writing.serial;
        let new = matches!(kind, Kind::New);
        let placeholder = match &kind {
            Kind::New => t("Message", "Bericht"),
            Kind::Reply { .. } => t("Write your reply", "Schrijf je antwoord"),
            Kind::Forward { .. } => t("Add a note (optional)", "Voeg een notitie toe (optioneel)"),
        };
        let editor = cx.new(|cx| RichEditor::new(Mode::Html, window, cx));
        editor.update(cx, |editor, cx| {
            // A signature may show a logo from the web, as it does in the mail itself.
            editor.set_remote_images(true, cx);
            // The page is on the reader's panel; a reply is a card of its own (`bg-background`).
            editor.set_background(if new { theme::sidebar } else { theme::background }, cx);
            editor.set_placeholder(placeholder, cx);
            editor.set_format_menu(true, cx);
            if let Some(content) = &start.content {
                editor.set_content(content, cx);
            }
        });
        let subject = cx.new(|cx| InputState::new(window, cx).default_value(start.subject.clone()));
        let ai_input = cx.new(|cx| InputState::new(window, cx));
        let hint = t("Separate addresses with commas", "Scheid adressen met komma's");
        let to = AddressField::new(start.to, if new { hint } else { "" }, window, cx);
        let cc = AddressField::new(Vec::new(), "", window, cx);
        let bcc = AddressField::new(Vec::new(), "", window, cx);
        let mut subscriptions = vec![
            cx.subscribe_in(&editor, window, move |this, _, event: &EditorEvent, _, cx| match event {
                EditorEvent::Changed(_) => this.body_changed(key, cx),
                EditorEvent::Focused => {
                    // Typing again puts the menus away.
                    if let Some(composer) = this.writer(key) {
                        composer.menu = None;
                    }
                    cx.notify();
                }
                EditorEvent::ContentHeight(_) => cx.notify(),
                _ => {}
            }),
            cx.subscribe_in(&editor, window, move |this, _, _: &ContentRead, _, cx| this.content_read(key, cx)),
            cx.subscribe_in(&subject, window, move |this, input, event: &InputEvent, window, cx| match event {
                InputEvent::Change => {
                    let text = input.read(cx).value().to_string();
                    if let Some(composer) = this.writer(key) {
                        composer.subject_text = text;
                    }
                    this.draft_changed(key, cx);
                }
                InputEvent::PressEnter { secondary: true, .. } => this.submit(key, window, cx),
                InputEvent::Focus | InputEvent::Blur => {
                    if let Some(composer) = this.writer(key) {
                        composer.subject_focused = matches!(event, InputEvent::Focus);
                    }
                    cx.notify();
                }
                _ => {}
            }),
            cx.subscribe_in(&ai_input, window, move |this, _, event: &InputEvent, window, cx| match event {
                // Not the composer's own Enter handling, which would send.
                InputEvent::PressEnter { .. } => this.submit_ai(key, window, cx),
                InputEvent::Change => cx.notify(),
                _ => {}
            }),
        ];
        for (which, field) in [(Which::To, &to), (Which::Cc, &cc), (Which::Bcc, &bcc)] {
            subscriptions.push(cx.subscribe_in(
                &field.input,
                window,
                move |this, _, event: &InputEvent, window, cx| this.address_event(key, which, event, window, cx),
            ));
        }
        let mut composer = Composer {
            kind,
            key,
            account,
            stage: Stage::Ready,
            opened: None,
            reply: None,
            to,
            cc,
            bcc,
            copies: false,
            reply_to: Vec::new(),
            reply_cc: Vec::new(),
            subject,
            subject_text: start.subject,
            subject_focused: false,
            editor,
            body: Body::default(),
            picked_signature: None,
            applied_signature: None,
            started_with_content: start.saved,
            files: Vec::new(),
            ai: Ai::new(ai_input),
            autosave: Autosave::default(),
            hidden: false,
            busy: false,
            menu: None,
            dry: start.dry,
            shown: false,
            kept: 0,
            _subscriptions: subscriptions,
        };
        // A new message is saved from here on; an opened draft once the editor read it.
        if new && !start.saved {
            let content = composer.content();
            composer.autosave.start(composer.account.as_deref().unwrap_or_default(), &content);
        }
        self.load_writing_signatures(cx);
        composer
    }

    // Starting to write (`startCompose` in app.tsx, the reply bar in pages/conversation.tsx).

    /// C, and New message in the sidebar: a new mail, or the one that was
    /// waiting out of view ("Resume draft").
    pub(super) fn compose_new(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.open = None;
        if let Some(composer) = &mut self.composer {
            composer.hidden = false;
            if composer.stage == Stage::Ready {
                composer.editor.update(cx, |editor, cx| editor.focus(window, cx));
            }
            cx.notify();
            return;
        }
        // The mailbox being viewed, if one is and it can send.
        let account = Some(self.filter.clone())
            .filter(|id| self.active_mailbox(id))
            .or_else(|| self.mailboxes.iter().find(|mailbox| mailbox.active()).map(|mailbox| mailbox.id.clone()));
        let composer = self.build(Kind::New, account, Start::default(), window, cx);
        composer.to.input.update(cx, |input, cx| input.focus(window, cx));
        let key = composer.key;
        self.composer = Some(composer);
        self.apply_signature(key, cx);
        cx.notify();
    }

    /// Opens a saved draft in the composer (`onOpenDraft`).
    pub(super) fn open_draft(&mut self, account: String, id: String, window: &mut Window, cx: &mut Context<Self>) {
        self.open = None;
        // The draft being written is already open; bring it back instead of reloading it.
        if let Some(composer) = &mut self.composer {
            let same = [&composer.opened, &composer.autosave.saved]
                .into_iter()
                .flatten()
                .any(|draft| draft.id == id);
            if same {
                composer.hidden = false;
                cx.notify();
                return;
            }
        }
        // Opening another draft keeps what was written in this one.
        self.close_message(true, cx);
        let draft = DraftRef { account, id };
        let start = Start {
            saved: true,
            ..Default::default()
        };
        let mut composer = self.build(Kind::New, Some(draft.account.clone()), start, window, cx);
        composer.stage = Stage::Opening;
        composer.opened = Some(draft.clone());
        composer.autosave.saved = Some(draft.clone());
        let key = composer.key;
        self.composer = Some(composer);
        let client = self.client.clone();
        let task = cx.background_executor().spawn(async move { wire::open_draft(&client, &draft) });
        cx.spawn_in(window, async move |this, cx| {
            let result = task.await;
            let _ = this.update_in(cx, |this, window, cx| {
                match result {
                    Ok(opened) => this.fill_draft(key, opened, window, cx),
                    Err(error) if error.downcast_ref::<Unauthorized>().is_some() => cx.emit(SignedOut),
                    Err(_) => {
                        if let Some(composer) = this.writer(key) {
                            composer.stage = Stage::Failed;
                        }
                    }
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }

    /// The opened draft's words in the composer's fields.
    fn fill_draft(&mut self, key: u64, draft: wire::DraftOpened, window: &mut Window, cx: &mut Context<Self>) {
        let Some(composer) = self.writer(key) else { return };
        let emails = |list: &[Address]| list.iter().map(|address| address.email.clone()).collect::<Vec<_>>();
        composer.to.set_entries(emails(&draft.to), window, cx);
        composer.cc.set_entries(emails(&draft.cc), window, cx);
        composer.bcc.set_entries(emails(&draft.bcc), window, cx);
        composer.copies = !draft.cc.is_empty() || !draft.bcc.is_empty();
        composer.subject_text = draft.subject.clone();
        composer.subject.update(cx, |input, cx| input.set_value(draft.subject.clone(), window, cx));
        composer.reply = draft.reply;
        let mut next = composer.key << 20;
        composer.files = draft
            .attachments
            .into_iter()
            .map(|file| {
                next += 1;
                ComposerFile::of(file, next)
            })
            .collect();
        let pictures: Vec<InlineImage> = draft.inline.iter().map(InlineUpload::image).collect();
        let content = match draft.html.as_deref().filter(|html| !html.is_empty()) {
            Some(html) => from_inline_images(html, &pictures),
            None => text_to_editor_html(&draft.text),
        };
        composer.editor.update(cx, |editor, cx| {
            editor.set_content(&content, cx);
            editor.focus_start(window, cx);
        });
        composer.stage = Stage::Ready;
    }

    /// R answers the sender, A everyone on the newest message.
    pub(super) fn compose_reply(&mut self, all: bool, window: &mut Window, cx: &mut Context<Self>) {
        let mode = if all { ReplyMode::All } else { ReplyMode::Reply };
        self.start_answer(mode, None, true, false, window, cx);
    }

    /// A suggested reply to start from, as plain text (`ReplySuggestions`' `onPick`).
    #[allow(dead_code)]
    pub(super) fn compose_reply_with(&mut self, text: String, window: &mut Window, cx: &mut Context<Self>) {
        // A form already open starts over from the suggestion.
        self.writing.answer = None;
        self.start_answer(ReplyMode::Reply, Some(text), true, false, window, cx);
    }

    /// F: the newest message sent on to someone else.
    #[allow(dead_code)]
    pub(super) fn compose_forward(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.start_answer(ReplyMode::Forward, None, true, false, window, cx);
    }

    fn start_answer(
        &mut self,
        mode: ReplyMode,
        prefill: Option<String>,
        focus: bool,
        dry: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(thread) = self.open.clone() else { return };
        let Some(Reading::Ready(conversation)) = self.reading.get(&thread.id) else {
            return;
        };
        let Some(target) = conversation.last.as_ref() else { return };
        // The form is open already: the keyboard goes to it.
        if let Some(answer) = &self.writing.answer {
            if answer.thread() == Some(thread.id.as_str()) && answer.mode() == Some(mode) {
                if focus {
                    answer.editor.update(cx, |editor, cx| editor.focus(window, cx));
                }
                return;
            }
        }
        let own = self.mailbox(&thread.account_id).map(|mailbox| mailbox.email.clone()).unwrap_or_default();
        let (reply_to, reply_cc) = reply_recipients(
            target.from.as_ref(),
            &target.reply_to,
            &target.to,
            &target.cc,
            &own,
            mode == ReplyMode::All,
        );
        let message_id = target.message_id.clone();
        let files = conversation.parts.last().map_or(0, |part| part.attachments.len());
        let kind = match mode {
            ReplyMode::Forward => Kind::Forward {
                thread_id: thread.id.clone(),
                message_id,
                files,
            },
            _ => Kind::Reply {
                thread_id: thread.id.clone(),
                message_id,
                all: mode == ReplyMode::All,
            },
        };
        // A reply started earlier on this conversation, kept on this Mac.
        let saved = (!dry).then(|| drafts::read_reply_draft(&thread.id)).flatten().filter(|saved| saved.mode == mode);
        let start = match (&saved, prefill) {
            (Some(saved), _) => {
                let pictures: Vec<InlineImage> = saved.inline.iter().map(InlineUpload::image).collect();
                let recipients = saved.to.as_deref().unwrap_or_default();
                Start {
                    to: addresses::split_recipients(&format!("{recipients},")).0,
                    content: Some(from_inline_images(&saved.html, &pictures)),
                    saved: true,
                    ..Default::default()
                }
            }
            (None, Some(text)) => Start {
                content: Some(text_to_editor_html(&text)),
                dry,
                ..Default::default()
            },
            (None, None) => Start {
                dry,
                ..Default::default()
            },
        };
        let mut composer = self.build(kind, Some(thread.account_id.clone()), start, window, cx);
        composer.reply_to = reply_to;
        composer.reply_cc = reply_cc;
        if focus {
            match mode {
                ReplyMode::Forward => composer.to.input.update(cx, |input, cx| input.focus(window, cx)),
                // The start, so typing goes above a signature.
                _ => composer.editor.update(cx, |editor, cx| editor.focus_start(window, cx)),
            }
        }
        let key = composer.key;
        self.writing.answer = Some(composer);
        self.apply_signature(key, cx);
        cx.notify();
    }

    /// An answer belongs to its conversation: opening another one puts it
    /// away. What was written stays on this Mac for when the conversation is back.
    pub(super) fn drop_reply_elsewhere(&mut self) {
        let open = self.open.as_ref().map(|thread| thread.id.as_str());
        if self.writing.answer.as_ref().is_some_and(|answer| answer.thread() != open) {
            self.writing.answer = None;
        }
    }

    /// Cancel on a reply: throws it away. Leaving the conversation keeps it.
    fn cancel_answer(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(answer) = self.writing.answer.take() {
            if let (Some(thread), false) = (answer.thread(), answer.dry) {
                drafts::clear_reply_draft(thread);
            }
        }
        window.focus(&self.focus, cx);
        cx.notify();
    }

    // Where the new message is (`composing`, `draftWaiting` in app.tsx).

    /// The new message fills the reading pane.
    pub(super) fn message_showing(&self) -> bool {
        self.open.is_none() && self.composer.as_ref().is_some_and(|composer| !composer.hidden)
    }

    /// A message waits out of view: New message is then "Resume draft".
    pub(crate) fn draft_waiting(&self) -> bool {
        self.composer.as_ref().is_some_and(|composer| composer.hidden || self.open.is_some())
    }

    /// Going somewhere from the sidebar puts the composer away: an empty one
    /// closes at the next frame, one with something in it waits.
    pub(super) fn put_message_away(&mut self) {
        if let Some(composer) = &mut self.composer {
            composer.hidden = true;
        }
    }

    /// The draft open in the composer, for the drafts list's selected row.
    pub(super) fn open_draft_id(&self) -> Option<&str> {
        let composer = self.composer.as_ref()?;
        composer.autosave.saved.as_ref().or(composer.opened.as_ref()).map(|draft| draft.id.as_str())
    }

    /// Closes the new message. With `keep`, what was written is saved as a draft once more.
    fn close_message(&mut self, keep: bool, cx: &mut Context<Self>) {
        let Some(composer) = self.composer.take() else { return };
        if keep {
            self.keep_parting(&composer, cx);
        }
        self.writing.refocus = true;
        cx.notify();
    }

    /// Escape in a composer: an open line or menu first; then a new message
    /// goes out of view, and a reply stays (the web's `useEscapeToHide`).
    fn escape_composer(&mut self, key: u64, window: &mut Window, cx: &mut Context<Self>) {
        let Some(composer) = self.writer(key) else { return };
        if composer.menu.take().is_some() {
            return cx.notify();
        }
        if composer.ai.open {
            return self.close_ai(key, window, cx);
        }
        if composer.is_new() {
            composer.hidden = true;
            window.focus(&self.focus, cx);
            cx.notify();
        }
    }

    // What changes while writing.

    /// The editor told what the body is now.
    fn read_body(&mut self, key: u64, cx: &mut Context<Self>) {
        let Some(composer) = self.writer(key) else { return };
        let editor = composer.editor.read(cx);
        let (html, pictures) = to_inline_images(editor.html());
        composer.body = Body {
            text: editor.plain_text().to_string(),
            html,
            inline: pictures.iter().map(InlineUpload::of).collect(),
            written: editor.is_written(),
        };
    }

    fn body_changed(&mut self, key: u64, cx: &mut Context<Self>) {
        self.read_body(key, cx);
        self.draft_changed(key, cx);
        cx.notify();
    }

    /// The editor read the content it started with: an opened draft is now
    /// complete, and counts as saved the way it reads.
    fn content_read(&mut self, key: u64, cx: &mut Context<Self>) {
        self.read_body(key, cx);
        let Some(composer) = self.writer(key) else { return };
        if composer.is_new() && composer.stage == Stage::Ready && !composer.autosave.started() {
            let content = composer.content();
            composer.autosave.start(composer.account.as_deref().unwrap_or_default(), &content);
        }
        self.apply_signature(key, cx);
        self.keep_reply(key, cx);
        cx.notify();
    }

    /// Puts a subject in the field: the AI's, or the one from before it.
    pub(super) fn set_subject(&mut self, key: u64, subject: String, window: &mut Window, cx: &mut Context<Self>) {
        let Some(composer) = self.writer(key) else { return };
        composer.subject_text = subject.clone();
        composer.subject.update(cx, |input, cx| input.set_value(subject, window, cx));
        self.draft_changed(key, cx);
    }

    /// The mailbox a new message goes from. A draft lives in one mailbox, so
    /// it moves along; the signature becomes that mailbox's own.
    fn set_from(&mut self, key: u64, account: String, cx: &mut Context<Self>) {
        let Some(composer) = self.writer(key) else { return };
        composer.menu = None;
        composer.account = Some(account);
        self.apply_signature(key, cx);
        self.draft_changed(key, cx);
        cx.notify();
    }

    // Signatures (lib/signatures.ts).

    fn load_writing_signatures(&mut self, cx: &mut Context<Self>) {
        // Asked again for each message: they may have changed in the settings.
        if self.writing.signatures_asked.is_some_and(|asked| asked.elapsed().as_secs() < 5) {
            return;
        }
        self.writing.signatures_asked = Some(Instant::now());
        self.fetch(cx, api::signatures, |this, result, cx| {
            if let Ok(signatures) = result {
                this.writing.signatures = Some(signatures);
                let keys: Vec<u64> = [&this.composer, &this.writing.answer]
                    .into_iter()
                    .flatten()
                    .map(|composer| composer.key)
                    .collect();
                for key in keys {
                    this.apply_signature(key, cx);
                }
            }
        });
    }

    /// The signature a message uses: the mailbox's default for its kind, until
    /// one is picked in the composer (`useSignatureChoice`). `None`: not known yet.
    fn signature_of(&self, composer: &Composer) -> Option<Option<&api::Signature>> {
        let signatures = self.writing.signatures.as_ref()?;
        let fallback = composer.account.as_deref().and_then(|id| self.mailbox(id)).and_then(|mailbox| {
            if composer.is_new() && composer.reply.is_none() {
                mailbox.signatures.new_id.clone()
            } else {
                mailbox.signatures.reply_id.clone()
            }
        });
        let id = match &composer.picked_signature {
            Some((account, id)) if *account == composer.account => id.clone(),
            _ => fallback,
        };
        Some(id.and_then(|id| signatures.iter().find(|signature| signature.id == id)))
    }

    /// Keeps the chosen signature at the end of the message. Starting content
    /// is assumed to have the right one already; a later change swaps it.
    fn apply_signature(&mut self, key: u64, cx: &mut Context<Self>) {
        let Some(composer) = [self.composer.as_ref(), self.writing.answer.as_ref()]
            .into_iter()
            .flatten()
            .find(|composer| composer.key == key)
        else {
            return;
        };
        let Some(signature) = self.signature_of(composer) else { return };
        let html = signature.map(|signature| signature.html.clone()).unwrap_or_default();
        let Some(composer) = self.writer(key) else { return };
        if composer.stage != Stage::Ready {
            return;
        }
        match &composer.applied_signature {
            None if composer.started_with_content => composer.applied_signature = Some(html),
            Some(applied) if *applied == html => {}
            _ => {
                composer.editor.update(cx, |editor, cx| editor.exec(Command::SetSignature(html.clone()), cx));
                composer.applied_signature = Some(html);
            }
        }
    }

    fn pick_signature(&mut self, key: u64, id: Option<String>, cx: &mut Context<Self>) {
        let Some(composer) = self.writer(key) else { return };
        composer.menu = None;
        composer.picked_signature = Some((composer.account.clone(), id));
        self.apply_signature(key, cx);
        cx.notify();
    }

    fn toggle_menu(&mut self, key: u64, menu: Menu, cx: &mut Context<Self>) {
        let Some(composer) = self.writer(key) else { return };
        composer.menu = if composer.menu == Some(menu) { None } else { Some(menu) };
        cx.notify();
    }

    // Sending (`send`, `schedule` and `discard` in pages/compose.tsx; reply-forms.tsx).

    /// ⌘Enter and Send: the form goes.
    pub(super) fn submit(&mut self, key: u64, window: &mut Window, cx: &mut Context<Self>) {
        let Some(composer) = self.writer(key) else { return };
        composer.menu = None;
        match composer.mode() {
            None => self.send_message(None, cx),
            Some(ReplyMode::Forward) => self.send_forward(window, cx),
            Some(_) => self.send_reply(window, cx),
        }
    }

    /// The new message as written, or nothing after saying what's missing (`message`).
    fn checked_message(&mut self, cx: &mut Context<Self>) -> Option<Outgoing> {
        let composer = self.composer.as_ref()?;
        let values = [composer.to.value(), composer.cc.value(), composer.bcc.value()];
        let mut lists = Vec::new();
        for value in &values {
            let (addresses, invalid) = parse_addresses(value);
            if let Some(invalid) = invalid {
                self.complain(invalid_address(&invalid), cx);
                return None;
            }
            lists.push(addresses);
        }
        if lists.iter().all(Vec::is_empty) {
            self.complain(t("Add at least one recipient.", "Voeg minstens één ontvanger toe."), cx);
            return None;
        }
        if files::is_uploading(&composer.files) {
            self.complain(
                t("Wait until the attachments have uploaded.", "Wacht tot de bijlagen zijn geüpload."),
                cx,
            );
            return None;
        }
        if wire::upload_bytes(&composer.body.inline) > wire::MAX_UPLOAD_BYTES {
            let limit = format!("{} MB", wire::MAX_UPLOAD_BYTES / (1024 * 1024));
            let text = t(
                format!("Attachments can be {limit} in total."),
                format!("Bijlagen mogen samen {limit} zijn."),
            );
            self.complain(text, cx);
            return None;
        }
        let mut content = composer.content();
        let mut lists = lists.into_iter();
        content.to = lists.next().unwrap_or_default();
        content.cc = lists.next().unwrap_or_default();
        content.bcc = lists.next().unwrap_or_default();
        Some(content)
    }

    /// Sends the new message, now or at `at` (Send later).
    fn send_message(&mut self, at: Option<DateTime<Utc>>, cx: &mut Context<Self>) {
        let Some(composer) = &self.composer else { return };
        if !composer.can_send() {
            return;
        }
        let key = composer.key;
        let dry = composer.dry;
        let Some(message) = self.checked_message(cx) else { return };
        if dry {
            // Only looked at: a debug composer sends nothing.
            return self.complain("EVEN_MAIL_DEBUG: nothing is sent.", cx);
        }
        if let Some(composer) = &mut self.composer {
            composer.busy = true;
        }
        self.pause_autosave(key, cx, move |this, cx| this.send_paused(key, message, at, cx));
        cx.notify();
    }

    /// The draft is at rest: the message goes, after a moment in which it can be taken back.
    fn send_paused(&mut self, key: u64, message: Outgoing, at: Option<DateTime<Utc>>, cx: &mut Context<Self>) {
        let Some(composer) = self.composer.as_mut().filter(|composer| composer.key == key) else {
            return;
        };
        let Some(account) = composer.account.clone() else { return };
        let draft = composer.autosave.saved.clone();
        let files_changed = composer.autosave.files_changed(&message);
        let Some(at) = at else {
            // Out of the way while it can still be taken back, like Gmail's undo send.
            composer.hidden = true;
            self.writing.refocus = true;
            self.writing.serial += 1;
            let serial = self.writing.serial;
            let toast = self.toast(
                t("Sending…", "Bericht wordt verzonden…"),
                ToastKind::Plain,
                Some((t("Undo", "Ongedaan maken").into(), ToastAction::UndoSend(serial))),
                true,
                cx,
            );
            self.writing.outbox = Some(Outbox {
                serial,
                toast,
                key,
                account,
                message,
                draft,
                files_changed,
            });
            cx.spawn(async move |this, cx| {
                cx.background_executor().timer(UNDO).await;
                let _ = this.update(cx, |this, cx| this.send_now(serial, cx));
            })
            .detach();
            return cx.notify();
        };
        self.fetch(
            cx,
            move |client| wire::schedule(client, &account, &message, draft, files_changed, at),
            move |this, result, cx| match result {
                Ok(()) => {
                    let when = format::moment_of(at);
                    this.toast(
                        t(format!("Sending {when}"), format!("Wordt verstuurd {when}")),
                        ToastKind::Success,
                        None,
                        false,
                        cx,
                    );
                    this.load_later(cx);
                    this.finished(key, cx);
                }
                Err(error) => {
                    this.came_back(key, cx);
                    this.toast_error(error, cx);
                }
            },
        );
    }

    /// The moment to take it back passed: the message goes.
    fn send_now(&mut self, serial: u64, cx: &mut Context<Self>) {
        if self.writing.outbox.as_ref().is_none_or(|outbox| outbox.serial != serial) {
            return;
        }
        let Some(outbox) = self.writing.outbox.take() else { return };
        self.dismiss_toast(outbox.toast, cx);
        let key = outbox.key;
        self.fetch(
            cx,
            move |client| wire::send(client, &outbox.account, &outbox.message, outbox.draft, outbox.files_changed),
            move |this, result, cx| match result {
                Ok(()) => {
                    this.toast(t("Message sent.", "Bericht verstuurd."), ToastKind::Success, None, false, cx);
                    // The sent mail shows once its mailbox, and any of ours it went to, has it.
                    this.sync_mailboxes(cx);
                    this.finished(key, cx);
                }
                Err(error) => {
                    // Failed: the message comes back as it was, to change or try again.
                    this.came_back(key, cx);
                    this.toast_error(error, cx);
                }
            },
        );
    }

    /// Undo on the "Sending…" toast: nothing happened.
    pub(crate) fn undo_send(&mut self, serial: u64, cx: &mut Context<Self>) {
        if self.writing.outbox.as_ref().is_none_or(|outbox| outbox.serial != serial) {
            return;
        }
        if let Some(outbox) = self.writing.outbox.take() {
            self.dismiss_toast(outbox.toast, cx);
            self.came_back(outbox.key, cx);
        }
    }

    /// Undone, or failed: the message is back in view, and saved again as it changes.
    fn came_back(&mut self, key: u64, cx: &mut Context<Self>) {
        if let Some(composer) = self.composer.as_mut().filter(|composer| composer.key == key) {
            composer.busy = false;
            composer.hidden = false;
            self.open = None;
            self.resume_autosave(key, cx);
        }
        cx.notify();
    }

    /// Sent, scheduled or discarded: the composer closes and the drafts are asked again.
    fn finished(&mut self, key: u64, cx: &mut Context<Self>) {
        self.load_drafts(cx);
        if self.composer.as_ref().is_some_and(|composer| composer.key == key) {
            self.close_message(false, cx);
        }
    }

    /// Send later, with the moment picked in the when-picker.
    pub(super) fn send_later(&mut self, at: DateTime<Utc>, cx: &mut Context<Self>) {
        self.send_message(Some(at), cx);
    }

    /// The bin: the message goes, and its draft with it.
    fn discard_message(&mut self, cx: &mut Context<Self>) {
        let Some(composer) = &mut self.composer else { return };
        if composer.busy {
            return;
        }
        let key = composer.key;
        if composer.dry {
            return self.close_message(false, cx);
        }
        composer.busy = true;
        self.pause_autosave(key, cx, move |this, cx| {
            let Some(composer) = this.composer.as_ref().filter(|composer| composer.key == key) else {
                return;
            };
            let Some(draft) = composer.autosave.saved.clone() else {
                return this.finished(key, cx);
            };
            this.fetch(
                cx,
                move |client| wire::delete_draft(client, &draft),
                move |this, result, cx| match result {
                    Ok(()) => this.finished(key, cx),
                    Err(error) => {
                        this.came_back(key, cx);
                        this.toast_error(error, cx);
                    }
                },
            );
        });
        cx.notify();
    }

    /// A scheduled message opened to change it: it is a draft again, in the
    /// composer (`scheduledActions.cancel` then `onOpenDraft`).
    pub(super) fn edit_scheduled(&mut self, id: String, cx: &mut Context<Self>) {
        self.fetch(
            cx,
            move |client| wire::cancel_scheduled(client, &id),
            |this, result, cx| {
                match result {
                    Ok(draft) => {
                        this.toast(t("Kept as a draft", "Bewaard als concept"), ToastKind::Success, None, false, cx);
                        // Opened at the next frame, which has the window its fields need.
                        this.writing.open_next = Some(draft);
                    }
                    Err(error) => this.toast_error(error, cx),
                }
                this.load_later(cx);
                this.load_drafts(cx);
            },
        );
    }

    /// A draft deleted from the list while it is open here goes through the
    /// composer, so saving can't bring it back (`discardRequest`). True when it was.
    pub(super) fn discard_open_draft(&mut self, id: &str, cx: &mut Context<Self>) -> bool {
        if self.open_draft_id() != Some(id) {
            return false;
        }
        self.discard_message(cx);
        true
    }

    fn send_reply(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(answer) = &mut self.writing.answer else { return };
        let Kind::Reply {
            thread_id, message_id, ..
        } = &answer.kind
        else {
            return;
        };
        if !answer.can_send() {
            return;
        }
        if answer.dry {
            return self.complain("EVEN_MAIL_DEBUG: nothing is sent.", cx);
        }
        answer.busy = true;
        let key = answer.key;
        let (thread, message) = (thread_id.clone(), message_id.clone());
        let (to, cc) = (answer.reply_to.clone(), answer.reply_cc.clone());
        let content = answer.content();
        let account = answer.account.clone();
        let sent = thread.clone();
        let task = {
            let client = self.client.clone();
            cx.background_executor().spawn(async move { wire::reply(&client, &thread, &message, &to, &cc, &content) })
        };
        self.after_answer(key, sent, account, task, window, cx);
    }

    fn send_forward(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(answer) = &mut self.writing.answer else { return };
        let Kind::Forward {
            thread_id, message_id, ..
        } = &answer.kind
        else {
            return;
        };
        if answer.busy {
            return;
        }
        let (thread, message) = (thread_id.clone(), message_id.clone());
        let key = answer.key;
        let dry = answer.dry;
        let content = answer.content();
        let (recipients, invalid) = parse_addresses(&answer.to.value());
        if let Some(invalid) = invalid {
            return self.complain(invalid_address(&invalid), cx);
        }
        if recipients.is_empty() {
            return self.complain(t("Add at least one recipient.", "Voeg minstens één ontvanger toe."), cx);
        }
        if dry {
            return self.complain("EVEN_MAIL_DEBUG: nothing is sent.", cx);
        }
        if let Some(answer) = &mut self.writing.answer {
            answer.busy = true;
        }
        let sent = thread.clone();
        let task = {
            let client = self.client.clone();
            cx.background_executor().spawn(async move { wire::forward(&client, &thread, &message, &recipients, &content) })
        };
        self.after_answer(key, sent, None, task, window, cx);
    }

    /// A reply or forward went, or didn't.
    fn after_answer(
        &mut self,
        key: u64,
        thread: String,
        account: Option<String>,
        task: Task<anyhow::Result<()>>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        cx.spawn_in(window, async move |this, cx| {
            let result = task.await;
            let _ = this.update_in(cx, |this, window, cx| {
                match result {
                    Ok(()) => {
                        this.toast(t("Message sent.", "Bericht verstuurd."), ToastKind::Success, None, false, cx);
                        drafts::clear_reply_draft(&thread);
                        if this.writing.answer.as_ref().is_some_and(|answer| answer.key == key) {
                            this.writing.answer = None;
                            window.focus(&this.focus, cx);
                        }
                        // A reply shows in its conversation once the mailbox has it.
                        if account.is_some() {
                            let subject = this.open.as_ref().map(|open| open.subject.clone()).unwrap_or_default();
                            this.read(thread.clone(), subject, cx);
                            this.sync_mailboxes(cx);
                        }
                    }
                    Err(error) if error.downcast_ref::<Unauthorized>().is_some() => cx.emit(SignedOut),
                    Err(error) => {
                        if let Some(answer) = this.writer(key) {
                            answer.busy = false;
                        }
                        this.toast_error(error, cx);
                    }
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }

    // Every frame, and when the app is covered.

    /// Runs before each frame is drawn: what writing needs to keep right
    /// without a click, and the editors that are no longer drawn.
    pub(super) fn compose_frame(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.writing.viewport = f32::from(window.viewport_size().height);
        if self.writing._quit.is_none() {
            // Quitting takes nothing back: what was waiting goes now, and the draft is kept.
            self.writing._quit = Some(cx.on_app_quit(|this, cx| {
                let outbox = this.writing.outbox.take();
                let parting = this.composer.as_ref().and_then(|composer| drafts::Parting::of(composer));
                let client = this.client.clone();
                cx.background_executor().spawn(async move {
                    if let Some(outbox) = outbox {
                        let _ = wire::send(&client, &outbox.account, &outbox.message, outbox.draft, outbox.files_changed);
                    } else if let Some(parting) = parting {
                        let _ = parting.keep(&client);
                    }
                })
            }));
        }
        // Written before the mailboxes were known: it goes from the first that can send.
        if let Some(composer) = self.composer.as_mut().filter(|composer| composer.is_new() && composer.opened.is_none()) {
            let known = composer.account.as_deref().is_some_and(|id| self.mailboxes.iter().any(|mailbox| mailbox.id == id));
            if !known {
                if let Some(first) = self.mailboxes.iter().find(|mailbox| mailbox.active()) {
                    composer.account = Some(first.id.clone());
                    let key = composer.key;
                    self.apply_signature(key, cx);
                }
            }
        }
        // Only something worth coming back to stays around while out of view.
        let idle = self.composer.as_ref().is_some_and(|composer| {
            (composer.hidden || self.open.is_some()) && !composer.busy && composer.stage == Stage::Ready && !composer.has_draft()
        });
        if idle || self.composer.as_ref().is_some_and(|composer| composer.hidden && composer.stage != Stage::Ready) {
            self.close_message(true, cx);
        }
        if let Some(draft) = self.writing.open_next.take() {
            self.open_draft(draft.account, draft.id, window, cx);
        }
        // The subject from before the AI filled it in, after Undo.
        for key in [self.composer.as_ref(), self.writing.answer.as_ref()].into_iter().flatten().map(|composer| composer.key).collect::<Vec<_>>() {
            let subject = self.writer(key).and_then(|composer| composer.ai.restore_subject.take());
            if let Some(subject) = subject {
                self.set_subject(key, subject, window, cx);
            }
        }
        self.restore_reply(window, cx);
        self.debug_answer(window, cx);
        // The list has the keyboard again once the message is out of view.
        if std::mem::take(&mut self.writing.refocus) && !self.message_showing() {
            window.focus(&self.focus, cx);
        }
        // The editors drawn this frame say so; the others leave the screen after it.
        for composer in [self.composer.as_mut(), self.writing.answer.as_mut()].into_iter().flatten() {
            composer.shown = false;
        }
        let this = cx.entity();
        window.defer(cx, move |_, cx| {
            this.update(cx, |this, cx| {
                for composer in [this.composer.as_ref(), this.writing.answer.as_ref()].into_iter().flatten() {
                    if !composer.shown {
                        composer.editor.update(cx, |editor, cx| editor.set_hidden(true, cx));
                    }
                }
            });
        });
    }

    /// A reply kept on this Mac comes back with its conversation.
    fn restore_reply(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(open) = self.open_id().map(str::to_string) else {
            self.writing.restored = None;
            return;
        };
        if self.writing.restored.as_deref() == Some(open.as_str()) || !matches!(self.reading.get(&open), Some(Reading::Ready(_))) {
            return;
        }
        self.writing.restored = Some(open.clone());
        if self.writing.answer.is_some() {
            return;
        }
        if let Some(saved) = drafts::read_reply_draft(&open) {
            // Without taking the keyboard: J and K keep walking the list.
            self.start_answer(saved.mode, None, false, false, window, cx);
        }
    }

    /// Another app shows, or the settings lie over mail: the editors are
    /// system views above everything drawn, so they go at once.
    pub(super) fn cover_writing(&mut self, covered: bool, cx: &mut Context<Self>) {
        if !covered {
            return;
        }
        for composer in [self.composer.as_ref(), self.writing.answer.as_ref()].into_iter().flatten() {
            composer.editor.update(cx, |editor, cx| editor.set_hidden(true, cx));
        }
    }

    /// A menu of a composer is open: the mail's webview makes way for it too.
    pub(super) fn writing_veils(&self) -> bool {
        [self.composer.as_ref(), self.writing.answer.as_ref()]
            .into_iter()
            .flatten()
            .any(|composer| composer.menu.is_some() || composer.suggesting())
    }

    // States to look at (`EVEN_MAIL_DEBUG`, see the README): prefilled with
    // harmless words, and `dry`, so nothing is saved, uploaded, asked or sent.

    pub(super) fn debug_compose(&mut self, state: &str, window: &mut Window, cx: &mut Context<Self>) {
        const SAMPLE: &str = "<p>Hi Sanne,</p><p></p><p>Thursday works for me. Shall we say <strong>12:30</strong> at the usual place? I'll bring the <a href=\"https://example.com\">drawings</a>.</p><p></p><ul><li>the plan</li><li>the budget</li></ul><p></p><div data-signature><p>Kind regards,</p><p>Jorn</p></div>";
        let message = |this: &mut Self, content: Option<&str>, window: &mut Window, cx: &mut Context<Self>| {
            let start = Start {
                to: if content.is_some() { vec!["sanne@example.com".into(), "piet@example".into()] } else { Vec::new() },
                subject: if content.is_some() { "Lunch on Thursday".into() } else { String::new() },
                content: content.map(String::from),
                saved: content.is_some(),
                dry: true,
            };
            let account = this.mailboxes.first().map(|mailbox| mailbox.id.clone());
            let mut composer = this.build(Kind::New, account.or(Some("debug".into())), start, window, cx);
            composer.applied_signature = Some(String::new());
            this.open = None;
            this.composer = Some(composer);
        };
        match state {
            "compose" => message(self, Some(SAMPLE), window, cx),
            "compose-empty" => message(self, None, window, cx),
            "draft-opening" | "draft-failed" => {
                message(self, None, window, cx);
                if let Some(composer) = &mut self.composer {
                    composer.stage = if state == "draft-opening" { Stage::Opening } else { Stage::Failed };
                    composer.opened = Some(DraftRef {
                        account: String::new(),
                        id: "debug".into(),
                    });
                }
            }
            "copies" | "suggest" | "attachments" | "ai-line" | "ai-writing" | "send-later" | "signature" | "from" | "saved" => {
                message(self, Some(SAMPLE), window, cx);
                let Some(composer) = &mut self.composer else { return };
                match state {
                    "copies" => {
                        composer.copies = true;
                        composer.cc.set_entries(vec!["kees@example.com".into()], window, cx);
                    }
                    "suggest" => composer.to.debug_suggest(window, cx),
                    "attachments" => {
                        composer.files = vec![
                            ComposerFile::sample(1, "Offerte 2026-014.pdf", "application/pdf", 482_113, 1., false),
                            ComposerFile::sample(2, "Plattegrond.png", "image/png", 2_411_724, 0.4, false),
                            ComposerFile::sample(3, "Begroting.xlsx", "application/x", 38_912, 0.2, true),
                        ];
                    }
                    "ai-line" | "ai-writing" => {
                        composer.ai.open = true;
                        composer.ai.editing = true;
                        composer.ai.pending = state == "ai-writing";
                        composer
                            .ai
                            .input
                            .update(cx, |input, cx| input.set_value("shorter, and ask whether 13:00 also works", window, cx));
                    }
                    "send-later" => composer.menu = Some(Menu::Later),
                    "signature" => composer.menu = Some(Menu::Signature),
                    "from" => composer.menu = Some(Menu::From),
                    _ => composer.autosave.status = drafts::SaveStatus::Saved,
                }
                if state == "signature" && self.writing.signatures.as_ref().is_none_or(Vec::is_empty) {
                    self.writing.signatures = Some(
                        [("s1", "Personal"), ("s2", "Work")]
                            .into_iter()
                            .map(|(id, name)| api::Signature {
                                id: id.into(),
                                name: name.into(),
                                html: String::new(),
                            })
                            .collect(),
                    );
                    // The sample ones stay: asking again would put the real (perhaps no) ones back.
                    self.writing.signatures_asked = Some(Instant::now() + std::time::Duration::from_secs(3600));
                }
            }
            "when-send" => {
                message(self, Some(SAMPLE), window, cx);
                self.open_send_when(window, cx);
            }
            "reply" | "reply-all" | "forward" | "reply-ai" => {
                // Needs a conversation: one already read, so looking changes nothing.
                self.debug_open = true;
                self.writing.debug.push(state.to_string());
            }
            _ => {}
        }
    }

    /// The debug states that need an open conversation.
    fn debug_answer(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.writing.debug.is_empty() {
            return;
        }
        let ready = self.open_id().is_some_and(|open| matches!(self.reading.get(open), Some(Reading::Ready(_))));
        if !ready {
            return;
        }
        for state in std::mem::take(&mut self.writing.debug) {
            let mode = match state.as_str() {
                "reply-all" => ReplyMode::All,
                "forward" => ReplyMode::Forward,
                _ => ReplyMode::Reply,
            };
            let text = (mode != ReplyMode::Forward).then(|| "Hi,\n\nThanks, that works for me.\n\nSee you Thursday".to_string());
            self.start_answer(mode, text, false, true, window, cx);
            let Some(answer) = &mut self.writing.answer else { continue };
            answer.applied_signature = Some(String::new());
            match state.as_str() {
                "forward" => answer.to.set_entries(vec!["sanne@example.com".into()], window, cx),
                "reply-ai" => {
                    answer.ai.open = true;
                    answer.ai.editing = true;
                    answer.ai.input.update(cx, |input, cx| input.set_placeholder(Ai::hint(true), window, cx));
                }
                _ => {}
            }
        }
    }
}

fn invalid_address(address: &str) -> String {
    t(
        format!("\"{address}\" isn't a valid email address."),
        format!("\"{address}\" is geen geldig e-mailadres."),
    )
}

pub(super) fn bind_keys(cx: &mut App) {
    cx.bind_keys([KeyBinding::new("cmd-j", AiWrite, Some("Composer"))]);
}
