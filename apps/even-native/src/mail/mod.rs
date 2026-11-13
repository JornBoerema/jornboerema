//! Even mailen (apps/mail-web): the sidebar, the list in view and the open
//! conversation. The state and what it does live here, as `MailApp` in
//! app.tsx and `InboxPage` in pages/inbox.tsx hold them on the web; each part
//! of the screen renders in its own module.

use std::collections::{HashMap, HashSet};
use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;

use base64::Engine as _;
use chrono::{DateTime, Local, Utc};
use futures::channel::mpsc::{unbounded, UnboundedSender};
use futures::StreamExt as _;
use gpui_kit::component::VirtualListScrollHandle;
use gpui_kit::prelude::*;
use gpui_kit::*;
use gpui_webview::WebView;

use crate::api::{Account, Client, Thread, Unauthorized};
use crate::i18n::t;
use crate::store::Store;
use crate::{email, theme};

mod api;
mod compose;
mod conversation;
mod download;
mod format;
mod list;
mod lists;
mod overlays;
mod places;
mod reader;
mod settings;
mod settings_pages;
mod settings_signatures;
mod sidebar;
mod toast;
mod when;

use api::{leaves_list, MailFolder, Mailbox, ThreadAction, View};
use conversation::{prepare, random_nonce, Reading};
use overlays::Overlay;
use places::Layout;
use settings::Feature;
use toast::{ToastAction, ToastKind};

actions!(
    mail,
    [
        Next,
        Previous,
        Archive,
        ToggleStar,
        MarkUnread,
        Trash,
        MoveToInbox,
        ReportSpam,
        Snooze,
        TogglePin,
        Refresh,
        Close,
        Search,
        Shortcuts,
        ToggleSidebar,
        SelectOpen,
        SelectHovered,
        SelectRange,
        SelectAll,
        Reply,
        ReplyAll,
        Forward,
        MakeTask,
        Compose,
        SendMail
    ]
);

/// Single keys would otherwise fire while typing in a field (lib/hotkeys.ts).
const NOT_TYPING: &str = "Mail && !Input";

pub fn bind_keys(cx: &mut App) {
    cx.bind_keys([
        // The list (pages/inbox.tsx).
        KeyBinding::new("j", Next, Some(NOT_TYPING)),
        KeyBinding::new("down", Next, Some(NOT_TYPING)),
        KeyBinding::new("k", Previous, Some(NOT_TYPING)),
        KeyBinding::new("up", Previous, Some(NOT_TYPING)),
        KeyBinding::new("x", SelectOpen, Some(NOT_TYPING)),
        KeyBinding::new("space", SelectHovered, Some(NOT_TYPING)),
        KeyBinding::new("shift-space", SelectRange, Some(NOT_TYPING)),
        KeyBinding::new("cmd-a", SelectAll, Some(NOT_TYPING)),
        KeyBinding::new("c", Compose, Some(NOT_TYPING)),
        KeyBinding::new("/", Search, Some(NOT_TYPING)),
        KeyBinding::new("escape", Close, Some(NOT_TYPING)),
        // The app (app.tsx).
        KeyBinding::new("cmd-k", Search, Some("Mail")),
        KeyBinding::new("cmd-f", Search, Some("Mail")),
        KeyBinding::new("?", Shortcuts, Some(NOT_TYPING)),
        KeyBinding::new("cmd-b", ToggleSidebar, Some(NOT_TYPING)),
        KeyBinding::new("cmd-r", Refresh, Some("Mail")),
        // The open conversation (pages/conversation.tsx).
        KeyBinding::new("e", Archive, Some(NOT_TYPING)),
        KeyBinding::new("#", Trash, Some(NOT_TYPING)),
        KeyBinding::new("i", MoveToInbox, Some(NOT_TYPING)),
        KeyBinding::new("!", ReportSpam, Some(NOT_TYPING)),
        KeyBinding::new("s", ToggleStar, Some(NOT_TYPING)),
        KeyBinding::new("b", Snooze, Some(NOT_TYPING)),
        KeyBinding::new("u", MarkUnread, Some(NOT_TYPING)),
        KeyBinding::new("shift-u", MarkUnread, Some(NOT_TYPING)),
        KeyBinding::new("p", TogglePin, Some(NOT_TYPING)),
        KeyBinding::new("r", Reply, Some(NOT_TYPING)),
        KeyBinding::new("a", ReplyAll, Some(NOT_TYPING)),
        KeyBinding::new("f", Forward, Some(NOT_TYPING)),
        KeyBinding::new("t", MakeTask, Some(NOT_TYPING)),
        KeyBinding::new("cmd-enter", SendMail, Some("Composer")),
    ]);
    compose::bind_keys(cx);
}

/// A mail line: two lines of text and their padding (`ROW_ESTIMATE`).
pub(crate) const ROW_HEIGHT: f32 = 58.;
/// The list's header and the reader's toolbar (`h-14`).
pub(crate) const HEADER: f32 = 56.;
/// How long a change can still be taken back (`UNDO_MS` in lib/undo.ts).
const UNDO: Duration = Duration::from_secs(5);
/// New mail normally arrives on the web through a realtime signal; here the
/// lists are asked again this often instead.
const POLL: Duration = Duration::from_secs(60);
/// Only a safety net on the web too (`SYNC_INTERVAL_MS`).
const SYNC_EVERY: Duration = Duration::from_secs(5 * 60);
const SYNC_RETRY: Duration = Duration::from_secs(30);
/// More new mail than this at once is one summary notification instead.
const MAX_SEPARATE: usize = 3;

/// The mail view tells the app when the session lapsed.
pub struct SignedOut;
impl EventEmitter<SignedOut> for MailView {}
impl EventEmitter<crate::app::AppEvent> for MailView {}

impl crate::app::EvenApp for MailView {
    fn settings_pages(&self, _cx: &App) -> Vec<crate::app::SettingsPage> {
        settings_pages::pages()
    }

    fn render_settings(&mut self, page: &str, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        self.render_settings_page(page, window, cx)
    }

    fn activated(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.focus(window, cx);
    }

    fn set_covered(&mut self, covered: bool, _: &mut Window, cx: &mut Context<Self>) {
        MailView::set_covered(self, covered, cx);
    }
}

/// Something asked from the API: not there yet, there, or failed.
pub(crate) struct Loaded<T> {
    pub(crate) data: Option<T>,
    pub(crate) failed: bool,
}

impl<T> Default for Loaded<T> {
    fn default() -> Self {
        Self {
            data: None,
            failed: false,
        }
    }
}

impl<T> Loaded<T> {
    fn set(&mut self, result: anyhow::Result<T>) {
        match result {
            Ok(data) => {
                self.data = Some(data);
                self.failed = false;
            }
            // What was shown stays; only an empty list says it failed.
            Err(_) => self.failed = self.data.is_none(),
        }
    }
}

/// `SyncStatus` in lib/mail.ts.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum SyncStatus {
    Idle,
    Syncing,
    Failed,
}

/// A move that can still be taken back: it goes to the API when its toast
/// runs out (lib/undo.ts).
struct Pending {
    serial: u64,
    toast: u64,
    ids: Vec<String>,
    action: ThreadAction,
    until: Option<DateTime<Utc>>,
}

pub struct MailView {
    client: Client,
    /// What was seen last, shown while the network catches up.
    store: Arc<Store>,
    focus: FocusHandle,
    mailboxes: Vec<Mailbox>,
    /// The same mailboxes as the composer knows them.
    accounts: Vec<Account>,
    loading_accounts: bool,
    view: View,
    /// One mailbox's id, or empty for every mailbox.
    filter: String,
    /// The folder's conversations, as far as they are loaded.
    listed: Vec<Thread>,
    cursor: Option<String>,
    loading: bool,
    /// The first page arrived (the web's `list.isSuccess`).
    list_ready: bool,
    list_failed: bool,
    /// Bumped on every new list, so answers for an older one are dropped.
    generation: u64,
    pinned: Vec<Thread>,
    snoozes: Loaded<api::Snoozes>,
    scheduled: Loaded<Vec<api::Scheduled>>,
    drafts: Loaded<api::Drafts>,
    shipments: Loaded<Vec<api::Shipment>>,
    /// Every shipping mail is read; until then more may follow.
    shipments_complete: bool,
    invoices: Loaded<Vec<api::Invoice>>,
    invoices_complete: bool,
    invoice_filter: lists::InvoiceFilter,
    senders: Loaded<Vec<api::Sender>>,
    /// The sender whose pane shows, by address, with their conversations.
    picked_sender: Option<String>,
    sender_threads: Loaded<Vec<Thread>>,
    unread: Option<api::Unread>,
    /// Unread conversations already seen, so only new ones notify.
    known_unread: Option<HashSet<String>>,
    /// What the list shows: back from snooze, pinned, then the rest. Rebuilt
    /// before every render.
    rows: Vec<Thread>,
    row_sizes: Rc<Vec<Size<Pixels>>>,
    /// How many rows are back from snooze, and how many pinned after them.
    returned_count: usize,
    pinned_count: usize,
    open: Option<Thread>,
    /// The selection, plus where a Shift range starts and the row under the pointer.
    picked: HashSet<String>,
    anchor: Option<String>,
    hovered: Option<String>,
    /// Conversations on their way out of the list: moved, and still undoable
    /// or not yet confirmed by the API.
    leaving: HashSet<String>,
    pending: Vec<Pending>,
    /// Moves on their way to the API.
    in_flight: usize,
    /// Left for good once the list is fresh again.
    settled: Vec<String>,
    serial: u64,
    sync: SyncStatus,
    failed_rounds: u32,
    layout: Layout,
    collapsed: bool,
    more_open: bool,
    /// The sidebar while it is being arranged.
    editor: Option<Layout>,
    overlay: Option<Overlay>,
    toasts: Vec<toast::Toast>,
    emptying_trash: bool,
    scroll: VirtualListScrollHandle,
    reading: HashMap<String, Reading>,
    /// The mail itself, in a system webview: GPUI can't lay out mail HTML.
    webview: Option<Entity<WebView>>,
    /// Which conversation the webview holds, with images or not, dark or light.
    shown: Option<(String, bool, bool)>,
    /// Conversations whose remote images the user asked to see.
    images: HashSet<String>,
    /// Numbers each document the webview loads, so a download asked for in
    /// one that was replaced since is dropped.
    document: u64,
    /// The mail being written, if any.
    composer: Option<compose::Composer>,
    /// The reply under the open conversation, and what writing keeps beside the composers (compose.rs).
    writing: compose::Writing,
    /// Lets only our own script run in the mail document.
    nonce: String,
    /// Messages from that script: shortcuts pressed while the mail has focus, and downloads.
    ipc: UnboundedSender<String>,
    /// Something lies over the mail (the settings) or another app shows: the
    /// webview is a system view above everything GPUI draws, so it must go.
    covered: bool,
    /// What the reader shows around the open mail, and its dialogs (reader.rs).
    reader: reader::State,
    /// States asked for with `EVEN_MAIL_DEBUG`, set once their data is there.
    debug_select: usize,
    debug_open: bool,
    debug_first_sender: bool,
    /// Mail's pages in the settings window (settings_pages.rs).
    pages: settings_pages::Pages,
    _tasks: Vec<Task<()>>,
    _quit: Subscription,
}

impl MailView {
    pub fn new(client: Client, store: Arc<Store>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let focus = cx.focus_handle();
        window.focus(&focus, cx);
        // New mail shows without a refresh: the lists and the unread count are asked again.
        let poll = cx.spawn_in(window, async move |this, cx| loop {
            cx.background_executor().timer(POLL).await;
            if this.update_in(cx, |this, window, cx| this.poll(window, cx)).is_err() {
                break;
            }
        });
        let sync = cx.spawn(async move |this, cx| loop {
            cx.background_executor().timer(SYNC_EVERY).await;
            if this.update(cx, |this, cx| this.sync_mailboxes(cx)).is_err() {
                break;
            }
        });
        let (ipc, mut received) = unbounded::<String>();
        let ipc_task = cx.spawn_in(window, async move |this, cx| {
            while let Some(raw) = received.next().await {
                if this
                    .update_in(cx, |this, window, cx| this.message(&raw, window, cx))
                    .is_err()
                {
                    break;
                }
            }
        });
        // Quitting doesn't take anything back: what was waiting goes now (lib/undo.ts).
        let quit = cx.on_app_quit(|this, cx| {
            let waiting: Vec<Pending> = this.pending.drain(..).collect();
            let client = this.client.clone();
            cx.background_executor().spawn(async move {
                for pending in waiting {
                    post_action(&client, &pending.ids, pending.action, pending.until);
                }
            })
        });
        let mut view = Self {
            client,
            store,
            focus,
            mailboxes: Vec::new(),
            accounts: Vec::new(),
            loading_accounts: true,
            view: View::Inbox,
            filter: String::new(),
            listed: Vec::new(),
            cursor: None,
            loading: false,
            list_ready: false,
            list_failed: false,
            generation: 0,
            pinned: Vec::new(),
            snoozes: Loaded::default(),
            scheduled: Loaded::default(),
            drafts: Loaded::default(),
            shipments: Loaded::default(),
            shipments_complete: false,
            invoices: Loaded::default(),
            invoices_complete: false,
            invoice_filter: lists::InvoiceFilter::All,
            senders: Loaded::default(),
            picked_sender: None,
            sender_threads: Loaded::default(),
            unread: None,
            known_unread: None,
            rows: Vec::new(),
            row_sizes: Rc::new(Vec::new()),
            returned_count: 0,
            pinned_count: 0,
            open: None,
            picked: HashSet::new(),
            anchor: None,
            hovered: None,
            leaving: HashSet::new(),
            pending: Vec::new(),
            in_flight: 0,
            settled: Vec::new(),
            serial: 0,
            sync: SyncStatus::Idle,
            failed_rounds: 0,
            layout: settings::sidebar(),
            collapsed: settings::sidebar_collapsed(),
            more_open: settings::more_open(),
            editor: None,
            overlay: None,
            toasts: Vec::new(),
            emptying_trash: false,
            scroll: VirtualListScrollHandle::new(),
            reading: HashMap::new(),
            webview: None,
            shown: None,
            images: HashSet::new(),
            document: 0,
            composer: None,
            writing: compose::Writing::default(),
            nonce: random_nonce(),
            ipc,
            covered: false,
            reader: reader::State::default(),
            debug_select: 0,
            debug_open: false,
            debug_first_sender: false,
            pages: settings_pages::Pages::default(),
            _tasks: vec![poll, sync, ipc_task],
            _quit: quit,
        };
        view.load_accounts(cx);
        view.load(true, cx);
        view.load_pins(cx);
        view.load_later(cx);
        view.load_unread(window, cx);
        view.load_drafts(cx);
        view.sync_preferences(cx);
        view.debug(window, cx);
        view
    }

    /// States that can't be reached without clicking, for `scripts/shot.sh`:
    /// `EVEN_MAIL_DEBUG=spotlight,collapsed` (see the README).
    fn debug(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Ok(wanted) = std::env::var("EVEN_MAIL_DEBUG") else { return };
        for state in wanted.split(',') {
            match state.trim() {
                "collapsed" => self.collapsed = true,
                "expanded" => self.collapsed = false,
                "more" => self.more_open = true,
                "editor" => self.editor = Some(self.layout.clone()),
                "spotlight" => self.open_spotlight(window, cx),
                "shortcuts" => self.open_shortcuts(window, cx),
                "snooze" => self.open_when(overlays::SnoozeTarget::Debug, window, cx),
                "confirm" => self.overlay = Some(Overlay::Confirm(overlays::Confirm::EmptyTrash)),
                "toast" => {
                    let undo = Some((t("Undo", "Ongedaan maken").into(), ToastAction::Dismiss));
                    self.toast(t("Archived", "Gearchiveerd"), ToastKind::Plain, undo, true, cx);
                }
                "drafts" => self.select_view(View::Drafts, cx),
                "parcels" => self.select_view(View::Parcels, cx),
                "invoices" => self.select_view(View::Invoices, cx),
                "snoozed" => self.select_view(View::Snoozed, cx),
                "scheduled" => self.select_view(View::Scheduled, cx),
                "senders" => self.select_view(View::Senders, cx),
                "sender" => self.debug_first_sender = true,
                "starred" => self.select_view(View::Folder(MailFolder::Starred), cx),
                "sent" => self.select_view(View::Folder(MailFolder::Sent), cx),
                "archive" => self.select_view(View::Folder(MailFolder::Archive), cx),
                "spam" => self.select_view(View::Folder(MailFolder::Spam), cx),
                "trash" => self.select_view(View::Folder(MailFolder::Trash), cx),
                "select" => self.debug_select = 3,
                "open" => self.debug_open = true,
                // Writing's own states (compose.rs).
                other => self.debug_compose(other, window, cx),
            }
        }
    }

    /// The debug states that need data: rows to select, a conversation to
    /// open (one already read, so looking changes nothing), a sender to pick.
    fn debug_states(&mut self, cx: &mut Context<Self>) {
        if self.debug_select > 0 && self.rows.len() > self.debug_select {
            self.picked = self.rows[1..=self.debug_select].iter().map(|thread| thread.id.clone()).collect();
            self.debug_select = 0;
        }
        if self.debug_open {
            if let Some(thread) = self.rows.iter().find(|thread| thread.is_read).cloned() {
                self.debug_open = false;
                self.open_thread(thread, cx);
            }
        }
        if self.debug_first_sender {
            let first = self.senders.data.as_ref().and_then(|senders| senders.first()).map(|sender| sender.email.clone());
            if let Some(email) = first {
                self.debug_first_sender = false;
                self.pick_sender(email, cx);
            }
        }
    }

    /// Hides the mail's system webview while something must show above it, or
    /// while another app has the window.
    pub fn set_covered(&mut self, covered: bool, cx: &mut Context<Self>) {
        if self.covered == covered {
            return;
        }
        self.covered = covered;
        if covered {
            if let Some(webview) = &self.webview {
                webview.update(cx, |webview, _| webview.hide());
            }
        }
        // The editors of what is being written are system views too.
        self.cover_writing(covered, cx);
        cx.notify();
    }

    /// Takes the keyboard: the shortcuts work once the app shows.
    pub fn focus(&self, window: &mut Window, cx: &mut App) {
        window.focus(&self.focus, cx);
    }

    /// Whether the webview must make way: for the settings or another app,
    /// for a spotlight or dialog of our own, or while the sidebar is arranged.
    pub(crate) fn veiled(&self) -> bool {
        self.covered || self.overlay.is_some() || self.editor.is_some() || self.reader.in_dialog() || self.writing_veils()
    }

    /// Runs `call` on the background executor and hands its answer to `done`.
    /// A lapsed session signs out instead.
    fn fetch<T: Send + 'static>(
        &mut self,
        cx: &mut Context<Self>,
        call: impl FnOnce(&Client) -> anyhow::Result<T> + Send + 'static,
        done: impl FnOnce(&mut Self, anyhow::Result<T>, &mut Context<Self>) + 'static,
    ) {
        let client = self.client.clone();
        let task = cx.background_executor().spawn(async move { call(&client) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |this, cx| {
                if result
                    .as_ref()
                    .err()
                    .is_some_and(|error| error.downcast_ref::<Unauthorized>().is_some())
                {
                    cx.emit(SignedOut);
                    return;
                }
                done(this, result, cx);
                cx.notify();
            });
        })
        .detach();
    }

    fn load_accounts(&mut self, cx: &mut Context<Self>) {
        self.fetch(cx, api::mailboxes, |this, result, cx| {
            this.loading_accounts = false;
            match result {
                Ok(mailboxes) => {
                    let first = this.mailboxes.is_empty();
                    this.accounts = mailboxes.iter().map(Mailbox::basic).collect();
                    this.mailboxes = mailboxes;
                    // A disconnected mailbox can't stay selected.
                    if !this.filter.is_empty() && !this.mailboxes.iter().any(|m| m.id == this.filter) {
                        this.filter.clear();
                        this.load(true, cx);
                    }
                    if first {
                        this.sync_mailboxes(cx);
                    }
                }
                Err(error) => this.toast_error(error, cx),
            }
        });
    }

    fn has_active(&self) -> bool {
        self.mailboxes.iter().any(Mailbox::active)
    }

    pub(crate) fn mailbox(&self, id: &str) -> Option<&Mailbox> {
        self.mailboxes.iter().find(|mailbox| mailbox.id == id)
    }

    /// The cache's name for the list in view.
    fn list_key(&self) -> String {
        let folder = self.view.folder().map_or("inbox", MailFolder::key);
        if self.filter.is_empty() {
            folder.to_string()
        } else {
            format!("{}:{folder}", self.filter)
        }
    }

    /// Loads the first page of the list in view (`fresh`), or the next one.
    fn load(&mut self, fresh: bool, cx: &mut Context<Self>) {
        if fresh {
            self.generation += 1;
            self.cursor = None;
        } else if self.loading || self.cursor.is_none() {
            return;
        }
        self.loading = true;
        let generation = self.generation;
        let folder = self.view.folder();
        let account = self.filter.clone();
        let cursor = self.cursor.clone();
        let key = self.list_key();
        if fresh && self.listed.is_empty() {
            self.show_cached(key.clone(), generation, cx);
        }
        self.fetch(
            cx,
            move |client| api::threads(client, &account, folder, cursor.as_deref()),
            move |this, result, cx| {
                if this.generation != generation {
                    return;
                }
                this.loading = false;
                match result {
                    Ok(page) => {
                        this.list_failed = false;
                        this.list_ready = true;
                        if fresh {
                            this.cache_threads(key, page.threads.clone(), cx);
                            this.listed = page.threads;
                            this.forget_settled();
                        } else {
                            this.listed.extend(page.threads);
                        }
                        this.cursor = page.next_cursor;
                    }
                    Err(_) => this.list_failed = this.listed.is_empty(),
                }
            },
        );
        cx.notify();
    }

    /// The list as last seen, until the network answers. Only into an empty
    /// list: it never replaces what the network already gave.
    fn show_cached(&mut self, key: String, generation: u64, cx: &mut Context<Self>) {
        let store = self.store.clone();
        let task = cx.background_executor().spawn(async move { store.threads(&key) });
        cx.spawn(async move |this, cx| {
            let Some(threads) = task.await else { return };
            let _ = this.update(cx, |this, cx| {
                if this.generation == generation && this.loading && this.listed.is_empty() {
                    this.listed = threads;
                    this.list_ready = true;
                    cx.notify();
                }
            });
        })
        .detach();
    }

    fn cache_threads(&self, key: String, threads: Vec<Thread>, cx: &mut Context<Self>) {
        let store = self.store.clone();
        cx.background_executor()
            .spawn(async move { store.put_threads(&key, &threads) })
            .detach();
    }

    /// The first page again, keeping what is further down when it is the same.
    fn refresh_quietly(&mut self, cx: &mut Context<Self>) {
        if self.loading || self.view.of_others() {
            return;
        }
        let generation = self.generation;
        let folder = self.view.folder();
        let account = self.filter.clone();
        let key = self.list_key();
        self.fetch(
            cx,
            move |client| api::threads(client, &account, folder, None),
            move |this, result, cx| {
                let Ok(page) = result else {
                    this.forget_settled();
                    return;
                };
                if this.generation != generation || this.loading {
                    return;
                }
                this.cache_threads(key, page.threads.clone(), cx);
                let fresh: HashSet<&str> = page.threads.iter().map(|t| t.id.as_str()).collect();
                let oldest = page.threads.last().map(|t| t.received_at);
                // Keep the pages below the first one; they are older than anything it holds.
                let older: Vec<Thread> = match oldest {
                    Some(oldest) => this
                        .listed
                        .iter()
                        .filter(|t| t.received_at < oldest && !fresh.contains(t.id.as_str()))
                        .cloned()
                        .collect(),
                    None => Vec::new(),
                };
                let keep_cursor = !older.is_empty();
                this.listed = page.threads.into_iter().chain(older).collect();
                if !keep_cursor {
                    this.cursor = page.next_cursor;
                }
                this.list_ready = true;
                this.list_failed = false;
                this.forget_settled();
            },
        );
    }

    /// The list is fresh: what the API confirmed as moved needs no hiding anymore.
    fn forget_settled(&mut self) {
        for id in self.settled.drain(..) {
            self.leaving.remove(&id);
        }
    }

    fn load_pins(&mut self, cx: &mut Context<Self>) {
        if !Feature::Pins.on() {
            self.pinned.clear();
            return;
        }
        let account = self.filter.clone();
        self.fetch(
            cx,
            move |client| api::pins(client, &account).map(|pins| (account, pins)),
            |this, result, _| {
                if let Ok((account, pins)) = result {
                    if account == this.filter {
                        this.pinned = pins;
                    }
                }
            },
        );
    }

    /// Snoozed and scheduled: their lists, their counts in the sidebar and
    /// what is back on top of the inbox.
    fn load_later(&mut self, cx: &mut Context<Self>) {
        self.fetch(cx, api::snoozes, |this, result, _| this.snoozes.set(result));
        self.fetch(cx, api::scheduled, |this, result, _| this.scheduled.set(result));
    }

    fn load_drafts(&mut self, cx: &mut Context<Self>) {
        self.fetch(cx, api::drafts, |this, result, _| this.drafts.set(result));
    }

    fn load_unread(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let client = self.client.clone();
        let task = cx.background_executor().spawn(async move { api::unread(&client) });
        cx.spawn_in(window, async move |this, cx| {
            let result = task.await;
            let _ = this.update_in(cx, |this, window, cx| match result {
                Ok(unread) => {
                    this.notify_new_mail(&unread.latest, window, cx);
                    this.unread = Some(unread);
                    cx.notify();
                }
                Err(error) if error.downcast_ref::<Unauthorized>().is_some() => cx.emit(SignedOut),
                Err(_) => {}
            });
        })
        .detach();
    }

    /// The unread count without a window at hand: no notifications from it.
    fn refresh_unread(&mut self, cx: &mut Context<Self>) {
        self.fetch(cx, api::unread, |this, result, _| {
            if let Ok(unread) = result {
                if let Some(known) = &mut this.known_unread {
                    known.extend(unread.latest.iter().map(|thread| thread.id.clone()));
                }
                this.unread = Some(unread);
            }
        });
    }

    /// A system notification for each conversation that newly turns up
    /// unread, unless the inbox is being looked at (lib/notifications.ts and
    /// components/background-notifications.tsx).
    fn notify_new_mail(&mut self, latest: &[Thread], window: &mut Window, cx: &mut Context<Self>) {
        use gpui_kit::component::notification::Notification;
        use gpui_kit::component::WindowExt as _;

        let Some(known) = &mut self.known_unread else {
            // What was unread when the app opened is known.
            self.known_unread = Some(latest.iter().map(|thread| thread.id.clone()).collect());
            return;
        };
        let fresh: Vec<Thread> = latest.iter().filter(|thread| !known.contains(&thread.id)).cloned().collect();
        known.extend(latest.iter().map(|thread| thread.id.clone()));
        let watching = window.is_window_active() && !self.covered;
        if !settings::notify_new_mail() || watching || fresh.is_empty() {
            return;
        }
        if fresh.len() > MAX_SEPARATE {
            let count = fresh.len();
            let title = t(format!("{count} new messages"), format!("{count} nieuwe berichten"));
            window.push_notification(Notification::new().title(title).message("").system(), cx);
            return;
        }
        for thread in fresh {
            let title = sender_name(&thread);
            let body = subject_of(&thread);
            let this = cx.weak_entity();
            let notification = Notification::new()
                .id1::<MailView>(SharedString::from(thread.id.clone()))
                .title(title)
                .message(body)
                .system()
                .on_click(move |_, window, cx| {
                    let thread = thread.clone();
                    let _ = this.update(cx, |this, cx| {
                        this.select_account(String::new(), cx);
                        this.open_thread(thread, cx);
                        this.focus(window, cx);
                    });
                });
            window.push_notification(notification, cx);
        }
    }

    /// The minute's round, in place of the web's realtime signal.
    fn poll(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.refresh_quietly(cx);
        if self.view == View::Inbox {
            self.load_pins(cx);
        }
        self.load_later(cx);
        self.load_unread(window, cx);
        self.sync_preferences(cx);
    }

    /// After something changed on the server: the lists that may differ now
    /// (the web's invalidations of messages, unread and snoozes).
    fn refresh_lists(&mut self, cx: &mut Context<Self>) {
        self.refresh_quietly(cx);
        if self.view == View::Inbox {
            self.load_pins(cx);
        }
        self.load_later(cx);
        self.refresh_unread(cx);
    }

    /// `usePreferencesSync`: a change on another device shows here too.
    fn sync_preferences(&mut self, cx: &mut Context<Self>) {
        self.fetch(cx, settings::sync, |this, result, cx| {
            if matches!(result, Ok(true)) {
                this.layout = settings::sidebar();
                // A feature turned off elsewhere takes its list away.
                let gone = match this.view {
                    View::Parcels => !Feature::Parcels.on(),
                    View::Senders => !Feature::Senders.on(),
                    View::Invoices => !Feature::Invoices.on(),
                    _ => false,
                };
                if gone {
                    this.select_account(String::new(), cx);
                }
                this.load_pins(cx);
            }
        });
    }

    /// Keeps every active mailbox in sync (`useMailSync`): each is asked to
    /// sync until it has caught up. One failed round is often a hiccup, so
    /// only a second in a row shows the warning.
    fn sync_mailboxes(&mut self, cx: &mut Context<Self>) {
        let ids: Vec<String> = self.mailboxes.iter().filter(|m| m.active()).map(|m| m.id.clone()).collect();
        if ids.is_empty() || self.sync == SyncStatus::Syncing {
            return;
        }
        self.sync = SyncStatus::Syncing;
        cx.notify();
        self.fetch(
            cx,
            move |client| {
                let rounds: Vec<anyhow::Result<u64>> = std::thread::scope(|scope| {
                    let handles: Vec<_> = ids
                        .iter()
                        .map(|id| {
                            scope.spawn(move || {
                                let mut changed = 0;
                                loop {
                                    let result = api::sync(client, id)?;
                                    changed += result.changed;
                                    if result.done || result.rate_limited {
                                        return Ok(changed);
                                    }
                                    if result.busy {
                                        std::thread::sleep(Duration::from_secs(3));
                                    }
                                }
                            })
                        })
                        .collect();
                    handles
                        .into_iter()
                        .map(|handle| handle.join().unwrap_or_else(|_| Err(anyhow::anyhow!("sync stopped"))))
                        .collect()
                });
                let failures = rounds.iter().filter(|round| round.is_err()).count();
                let conflict = rounds.iter().any(|round| {
                    round
                        .as_ref()
                        .err()
                        .and_then(|error| error.downcast_ref::<crate::api::ApiError>())
                        .is_some_and(|error| error.status == 409)
                });
                let changed: u64 = rounds.iter().filter_map(|round| round.as_ref().ok()).sum();
                Ok((changed, failures, conflict))
            },
            |this, result, cx| {
                let (changed, failures, conflict) = result.unwrap_or((0, 1, false));
                if conflict {
                    this.load_accounts(cx);
                }
                if changed > 0 {
                    this.refresh_lists(cx);
                }
                this.failed_rounds = if failures > 0 { this.failed_rounds + 1 } else { 0 };
                this.sync = if this.failed_rounds >= 2 { SyncStatus::Failed } else { SyncStatus::Idle };
                // A lasting fault (a mailbox to reconnect) waits for the normal rounds again.
                if this.failed_rounds > 0 && this.failed_rounds < 3 {
                    cx.spawn(async move |this, cx| {
                        cx.background_executor().timer(SYNC_RETRY).await;
                        let _ = this.update(cx, |this, cx| this.sync_mailboxes(cx));
                    })
                    .detach();
                }
            },
        );
    }

    // Going somewhere (the `navigation` of app.tsx).

    /// Whether the composer fills the reading pane: New message is then the
    /// current place in the sidebar.
    pub(crate) fn composing(&self) -> bool {
        self.message_showing()
    }

    /// Going somewhere from the sidebar puts a new message away.
    fn hide_composer(&mut self) {
        // An empty one closes; one with something in it waits as a draft to resume.
        self.put_message_away();
    }

    fn show(&mut self, view: View, filter: String, cx: &mut Context<Self>) {
        self.picked.clear();
        self.anchor = None;
        self.picked_sender = None;
        let changed = self.view != view || self.filter != filter;
        let mailbox_changed = self.filter != filter;
        self.view = view;
        self.filter = filter;
        if changed {
            self.listed.clear();
            self.list_ready = false;
            self.list_failed = false;
            self.scroll.scroll_to_item(0, ScrollStrategy::Top);
            if !view.of_others() {
                self.load(true, cx);
            }
            if mailbox_changed {
                // Another mailbox closes what was open.
                self.open = None;
                self.pinned.clear();
            }
            if view == View::Inbox {
                self.load_pins(cx);
            }
        } else {
            self.scroll.scroll_to_item(0, ScrollStrategy::Top);
        }
        match view {
            View::Drafts => self.load_drafts(cx),
            View::Parcels => self.load_shipments(cx),
            View::Invoices => self.load_invoices(cx),
            View::Snoozed | View::Scheduled => self.load_later(cx),
            View::Senders => self.load_senders(cx),
            _ => {}
        }
        cx.notify();
    }

    /// The inbox of one mailbox, or of all ("") (`onSelectAccount`).
    pub(crate) fn select_account(&mut self, id: String, cx: &mut Context<Self>) {
        self.hide_composer();
        self.show(View::Inbox, id, cx);
    }

    /// One mailbox for the list in view, or every one, without leaving it (`onFilterAccount`).
    pub(crate) fn filter_account(&mut self, id: String, cx: &mut Context<Self>) {
        self.open = None;
        let view = self.view;
        self.show(view, id, cx);
    }

    /// A place from the sidebar (`onSelectFolder` and its siblings).
    pub(crate) fn select_view(&mut self, view: View, cx: &mut Context<Self>) {
        if view == View::Inbox {
            return self.select_account(String::new(), cx);
        }
        self.hide_composer();
        // Drafts keep the open conversation; the other places close it.
        if view != View::Drafts {
            self.open = None;
        }
        // Tidy up keeps the chosen mailbox: tidying one at a time is common.
        let filter = if view == View::Senders { self.filter.clone() } else { String::new() };
        self.show(view, filter, cx);
    }

    // The rows.

    /// Works out what the list shows: back from snooze and pinned on top of
    /// the inbox, then the rest, without what is on its way out.
    fn rebuild_rows(&mut self) {
        let here = |thread: &Thread| self.filter.is_empty() || thread.account_id == self.filter;
        let staying = |thread: &&Thread| !self.leaving.contains(&thread.id);
        let mut rows: Vec<Thread> = Vec::new();
        let mut on_top: HashSet<&str> = HashSet::new();
        let (mut returned_count, mut pinned_count) = (0, 0);
        if self.view == View::Inbox {
            // Back from snooze and not read yet: on top, as Gmail brings them back.
            if let Some(snoozes) = &self.snoozes.data {
                for thread in snoozes.returned.iter().map(|item| &item.thread).filter(|t| here(t)).filter(staying) {
                    if on_top.insert(thread.id.as_str()) {
                        rows.push(thread.clone());
                        returned_count += 1;
                    }
                }
            }
            if Feature::Pins.on() {
                for thread in self.pinned.iter().filter(staying) {
                    if on_top.insert(thread.id.as_str()) {
                        rows.push(thread.clone());
                        pinned_count += 1;
                    }
                }
            }
        }
        if !self.view.of_others() {
            rows.extend(
                self.listed
                    .iter()
                    .filter(staying)
                    .filter(|thread| !on_top.contains(thread.id.as_str()))
                    .cloned(),
            );
        }
        // A quiet line below the pinned ones, between them and the rest of the inbox.
        let top = returned_count + pinned_count;
        let divider = (pinned_count > 0 && top < rows.len()).then(|| top - 1);
        let last = rows.len().saturating_sub(1);
        let sizes = (0..rows.len())
            .map(|index| {
                let mut height = ROW_HEIGHT + list::ROW_GAP;
                if divider == Some(index) {
                    height += list::DIVIDER;
                }
                if index == last {
                    height += list::LIST_BOTTOM;
                }
                size(px(0.), px(height))
            })
            .collect();
        self.rows = rows;
        self.row_sizes = Rc::new(sizes);
        self.returned_count = returned_count;
        self.pinned_count = pinned_count;
    }

    pub(crate) fn open_id(&self) -> Option<&str> {
        self.open.as_ref().map(|thread| thread.id.as_str())
    }

    fn position(&self) -> Option<usize> {
        let open = self.open_id()?;
        self.rows.iter().position(|thread| thread.id == open)
    }

    /// Changes a conversation wherever it is listed.
    fn each_copy(&mut self, id: &str, change: impl Fn(&mut Thread)) {
        let lists = [&mut self.listed, &mut self.pinned, &mut self.rows];
        for thread in lists.into_iter().flatten().filter(|thread| thread.id == id) {
            change(thread);
        }
        if let Some(snoozes) = &mut self.snoozes.data {
            for item in snoozes.returned.iter_mut().chain(&mut snoozes.snoozed).filter(|i| i.thread.id == id) {
                change(&mut item.thread);
            }
        }
        if let Some(threads) = &mut self.sender_threads.data {
            for thread in threads.iter_mut().filter(|thread| thread.id == id) {
                change(thread);
            }
        }
        if let Some(open) = self.open.as_mut().filter(|open| open.id == id) {
            change(open);
        }
    }

    /// Opens a conversation, from this list or from anywhere else (search, a
    /// parcel, a sender's pane).
    pub(crate) fn open_thread(&mut self, thread: Thread, cx: &mut Context<Self>) {
        let id = thread.id.clone();
        let unread = !thread.is_read;
        let subject = thread.subject.clone();
        self.open = Some(thread);
        self.drop_reply_elsewhere();
        self.rebuild_rows();
        let index = self.position();
        if let Some(index) = index {
            self.scroll.scroll_to_item(index, ScrollStrategy::Nearest);
        }
        if unread {
            self.each_copy(&id, |thread| thread.is_read = true);
            self.post(vec![id.clone()], ThreadAction::Read, None, cx);
            if let Some(unread) = &mut self.unread {
                unread.count = unread.count.saturating_sub(1);
            }
        }
        if !matches!(self.reading.get(&id), Some(Reading::Ready(_))) {
            self.read(id, subject, cx);
        }
        // The neighbours are where J, K and archive go next: have them ready.
        if let Some(index) = index {
            for neighbour in [index + 1, index.wrapping_sub(1)] {
                if let Some(thread) = self.rows.get(neighbour) {
                    if !self.reading.contains_key(&thread.id) {
                        self.read(thread.id.clone(), thread.subject.clone(), cx);
                    }
                }
            }
        }
        cx.notify();
    }

    fn read(&mut self, id: String, subject: String, cx: &mut Context<Self>) {
        self.reading.insert(id.clone(), Reading::Loading);
        let client = self.client.clone();
        let fetch_id = id.clone();
        let store = self.store.clone();
        // Fetching, sanitizing and fetching inline images all stay off the UI thread.
        // First the conversation as last seen, if it was, then the network's; that
        // one is prepared again only when it differs.
        cx.spawn(async move |this, cx| {
            let cached = {
                let (client, store, id, subject) = (client.clone(), store.clone(), fetch_id.clone(), subject.clone());
                cx.background_executor()
                    .spawn(async move {
                        let detail = store.detail(&id)?;
                        Some(prepare(&client, &id, subject, detail))
                    })
                    .await
            };
            let had_cached = cached.is_some();
            if let Some(conversation) = cached {
                let shown = this.update(cx, |this, cx| {
                    if matches!(this.reading.get(&id), Some(Reading::Loading)) {
                        this.reading.insert(id.clone(), Reading::Ready(Arc::new(conversation)));
                        cx.notify();
                    }
                });
                if shown.is_err() {
                    return;
                }
            }
            let result = cx
                .background_executor()
                .spawn(async move {
                    let detail = client.thread(&fetch_id)?;
                    let changed = store.put_detail(&fetch_id, &detail);
                    anyhow::Ok((changed || !had_cached).then(|| prepare(&client, &fetch_id, subject, detail)))
                })
                .await;
            let _ = this.update(cx, |this, cx| {
                let reading = match result {
                    Ok(Some(conversation)) => Reading::Ready(Arc::new(conversation)),
                    Ok(None) => return,
                    Err(error) if error.downcast_ref::<Unauthorized>().is_some() => {
                        cx.emit(SignedOut);
                        return;
                    }
                    // Offline, the conversation as last seen beats an error.
                    Err(_) if had_cached => return,
                    Err(_) => Reading::Failed(
                        t("This conversation couldn't be opened.", "Dit gesprek kon niet worden geopend.").into(),
                    ),
                };
                // The webview holds the old version; have it load the new one.
                if this.shown.as_ref().is_some_and(|(shown, ..)| *shown == id) {
                    this.shown = None;
                }
                this.reading.insert(id, reading);
                cx.notify();
            });
        })
        .detach();
    }

    // Acting on conversations (`useThreadAction` in lib/mail.ts).

    /// One conversation or a selection: the screen first, the API after it.
    /// Moves wait a moment so they can be taken back; marks and stars go at once.
    /// `until` snoozes: the conversation leaves as if archived and comes back then.
    pub(crate) fn run_action(
        &mut self,
        ids: Vec<String>,
        action: ThreadAction,
        until: Option<DateTime<Utc>>,
        cx: &mut Context<Self>,
    ) {
        if ids.is_empty() {
            return;
        }
        let folder = self.view.folder();
        for id in &ids {
            if leaves_list(folder, action) {
                self.leaving.insert(id.clone());
            } else {
                self.each_copy(id, |thread| match action {
                    ThreadAction::Read => thread.is_read = true,
                    ThreadAction::Unread => thread.is_read = false,
                    ThreadAction::Star => thread.is_starred = true,
                    ThreadAction::Unstar => thread.is_starred = false,
                    _ => {}
                });
            }
        }
        let count = ids.len();
        let message = match (until, action) {
            (Some(until), _) => {
                let when = format::moment_of(until);
                Some(if count == 1 {
                    t(format!("Snoozed until {when}"), format!("Gesnoozed tot {when}"))
                } else {
                    t(
                        format!("{count} conversations snoozed until {when}"),
                        format!("{count} gesprekken gesnoozed tot {when}"),
                    )
                })
            }
            (None, action) => done_message(action, count),
        };
        match message {
            // One undo for the whole selection, not one per conversation.
            Some(message) => {
                self.serial += 1;
                let serial = self.serial;
                let toast = self.toast(
                    message,
                    ToastKind::Plain,
                    Some((t("Undo", "Ongedaan maken").into(), ToastAction::Undo(serial))),
                    true,
                    cx,
                );
                self.pending.push(Pending {
                    serial,
                    toast,
                    ids,
                    action,
                    until,
                });
                cx.spawn(async move |this, cx| {
                    cx.background_executor().timer(UNDO).await;
                    let _ = this.update(cx, |this, cx| this.let_go(serial, cx));
                })
                .detach();
            }
            None => self.post(ids, action, None, cx),
        }
        cx.notify();
    }

    /// The moment to undo passed: the move goes to the API.
    fn let_go(&mut self, serial: u64, cx: &mut Context<Self>) {
        let Some(index) = self.pending.iter().position(|pending| pending.serial == serial) else {
            return;
        };
        let pending = self.pending.remove(index);
        self.dismiss_toast(pending.toast, cx);
        self.post(pending.ids, pending.action, pending.until, cx);
    }

    /// Taken back: nothing happened, and the conversations show again.
    pub(crate) fn undo(&mut self, serial: u64, cx: &mut Context<Self>) {
        let Some(index) = self.pending.iter().position(|pending| pending.serial == serial) else {
            return;
        };
        let pending = self.pending.remove(index);
        self.dismiss_toast(pending.toast, cx);
        for id in &pending.ids {
            self.leaving.remove(id);
        }
        cx.notify();
    }

    fn post(&mut self, ids: Vec<String>, action: ThreadAction, until: Option<DateTime<Utc>>, cx: &mut Context<Self>) {
        self.in_flight += 1;
        let sent = ids.clone();
        self.fetch(
            cx,
            move |client| post_action(client, &ids, action, until).map_or(Ok(()), Err),
            move |this, result, cx| {
                this.in_flight -= 1;
                let moved = sent.iter().any(|id| this.leaving.contains(id));
                match result {
                    Ok(()) => this.settled.extend(sent),
                    Err(error) => {
                        // It didn't happen: the conversations come back.
                        for id in &sent {
                            this.leaving.remove(id);
                        }
                        this.toast_error(error, cx);
                    }
                }
                // A refresh while another move runs would briefly bring its conversation back.
                if this.in_flight == 0 && (moved || matches!(action, ThreadAction::Read | ThreadAction::Unread)) {
                    this.refresh_lists(cx);
                }
            },
        );
    }

    /// Acts on the open conversation (`leave` in pages/inbox.tsx). One that
    /// leaves the list opens the next one, as in Gmail.
    pub(crate) fn leave(&mut self, action: ThreadAction, until: Option<DateTime<Utc>>, cx: &mut Context<Self>) {
        let Some(thread) = self.open.clone() else { return };
        // A star or a read mark keeps the conversation where it is.
        let stays = until.is_none() && action != ThreadAction::Unread && !leaves_list(self.view.folder(), action);
        if !stays {
            self.open = match self.position() {
                // Marking unread means "not now", so the next mail shouldn't open by itself.
                Some(index) if action != ThreadAction::Unread => {
                    let next = self.rows.get(index + 1).or_else(|| index.checked_sub(1).and_then(|i| self.rows.get(i)));
                    next.cloned()
                }
                // Opened from search and not in this list: there's no next one to move to.
                _ => None,
            };
            if let Some(next) = self.open.clone() {
                self.open_thread(next, cx);
            }
            self.drop_reply_elsewhere();
        }
        self.run_action(vec![thread.id], action, until, cx);
    }

    /// From a row's quick actions: the open one moves on, another just goes.
    pub(crate) fn act_on(&mut self, id: String, action: ThreadAction, cx: &mut Context<Self>) {
        if self.open_id() == Some(id.as_str()) {
            self.leave(action, None, cx);
        } else {
            self.run_action(vec![id], action, None, cx);
        }
    }

    /// The selected conversations, in list order.
    pub(crate) fn selection(&self) -> Vec<&Thread> {
        if self.view.of_others() {
            return Vec::new();
        }
        self.rows.iter().filter(|thread| self.picked.contains(&thread.id)).collect()
    }

    /// Acts on the whole selection (`bulk`).
    pub(crate) fn bulk(&mut self, action: ThreadAction, until: Option<DateTime<Utc>>, cx: &mut Context<Self>) {
        let ids: Vec<String> = self.selection().into_iter().map(|thread| thread.id.clone()).collect();
        if self.open_id().is_some_and(|open| ids.iter().any(|id| id == open))
            && (until.is_some() || leaves_list(self.view.folder(), action))
        {
            self.open = None;
        }
        self.clear_selection();
        self.run_action(ids, action, until, cx);
    }

    /// Selects or deselects; `range` extends from the last one picked, as with Shift.
    pub(crate) fn toggle(&mut self, id: &str, range: bool, cx: &mut Context<Self>) {
        let from = self.anchor.as_deref().and_then(|anchor| self.rows.iter().position(|t| t.id == anchor));
        let to = self.rows.iter().position(|thread| thread.id == id);
        match (range, from, to) {
            (true, Some(from), Some(to)) => {
                let (low, high) = if from < to { (from, to) } else { (to, from) };
                self.picked.extend(self.rows[low..=high].iter().map(|thread| thread.id.clone()));
            }
            _ => {
                if !self.picked.remove(id) {
                    self.picked.insert(id.to_string());
                }
            }
        }
        self.anchor = Some(id.to_string());
        cx.notify();
    }

    pub(crate) fn clear_selection(&mut self) {
        self.picked.clear();
        self.anchor = None;
    }

    pub(crate) fn select_all(&mut self, cx: &mut Context<Self>) {
        if self.view.of_others() {
            return;
        }
        self.picked = self.rows.iter().map(|thread| thread.id.clone()).collect();
        cx.notify();
    }

    /// Pins or unpins, moving the line at once (`usePin` in lib/pins.ts).
    pub(crate) fn set_pinned(&mut self, thread: Thread, pinned: bool, cx: &mut Context<Self>) {
        self.pinned.retain(|item| item.id != thread.id);
        let id = thread.id.clone();
        if pinned {
            self.pinned.push(thread);
            self.pinned.sort_by(|a, b| b.received_at.cmp(&a.received_at));
        }
        self.fetch(
            cx,
            move |client| api::pin(client, &id, pinned),
            |this, result, cx| {
                if let Err(error) = result {
                    this.toast_error(error, cx);
                }
                this.load_pins(cx);
            },
        );
        cx.notify();
    }

    /// Whether pinning applies to a conversation here: in the inbox, for what is synced.
    pub(crate) fn can_pin(&self, thread: &Thread) -> bool {
        Feature::Pins.on() && self.view == View::Inbox && !thread.id.starts_with(crate::api::REMOTE)
    }

    pub(crate) fn is_pinned(&self, id: &str) -> bool {
        self.pinned.iter().any(|thread| thread.id == id)
    }

    pub(crate) fn is_snoozed(&self, id: &str) -> bool {
        self.snoozes
            .data
            .as_ref()
            .is_some_and(|snoozes| snoozes.snoozed.iter().any(|item| item.thread.id == id))
    }

    /// Back to the inbox now (`useUnsnooze`).
    pub(crate) fn unsnooze(&mut self, id: String, cx: &mut Context<Self>) {
        if self.open_id() == Some(id.as_str()) {
            self.open = None;
        }
        if let Some(snoozes) = &mut self.snoozes.data {
            snoozes.snoozed.retain(|item| item.thread.id != id);
        }
        self.fetch(
            cx,
            move |client| api::unsnooze(client, &id),
            |this, result, cx| {
                match result {
                    Ok(()) => {
                        this.toast(t("Back in your inbox", "Terug in je inbox"), ToastKind::Success, None, false, cx);
                    }
                    Err(error) => this.toast_error(error, cx),
                }
                this.refresh_lists(cx);
            },
        );
        cx.notify();
    }

    pub(crate) fn toast_error(&mut self, error: anyhow::Error, cx: &mut Context<Self>) {
        let text = match error.downcast_ref::<crate::api::ApiError>() {
            Some(error) => error.message.clone(),
            None => t("There is no connection. Please try again.", "Er is geen verbinding. Probeer het opnieuw.").to_string(),
        };
        self.toast(text, ToastKind::Error, None, false, cx);
    }

    /// A message from our script in the mail document.
    fn message(&mut self, raw: &str, window: &mut Window, cx: &mut Context<Self>) {
        match email::parse_message(raw) {
            Some(email::Message::Key(key)) => self.key(&key, window, cx),
            Some(email::Message::Download { view, part, file }) => self.download(view, part, file, cx),
            Some(other) => self.page_message(other, window, cx),
            None => {}
        }
    }

    /// A shortcut pressed inside the mail document, which holds the keyboard natively.
    fn key(&mut self, key: &str, window: &mut Window, cx: &mut Context<Self>) {
        match key {
            "j" => self.step(1, cx),
            "k" => self.step(-1, cx),
            "x" => self.select_open(cx),
            "e" => self.move_open(ThreadAction::Archive, cx),
            "#" => self.move_open(ThreadAction::Trash, cx),
            "i" => self.move_open(ThreadAction::Inbox, cx),
            "!" => self.report_spam(cx),
            "s" => self.toggle_star(cx),
            "b" => self.snooze_open(window, cx),
            "u" | "shift-u" => self.leave(ThreadAction::Unread, None, cx),
            "p" => self.toggle_pin(cx),
            "cmd-r" => self.refresh(cx),
            "/" | "cmd-f" | "cmd-k" => self.open_spotlight(window, cx),
            "?" => self.open_shortcuts(window, cx),
            "cmd-b" => self.toggle_sidebar(cx),
            "r" => self.compose_reply(false, window, cx),
            "a" => self.compose_reply(true, window, cx),
            "f" => self.answer(reader::Answer::Forward, None, window, cx),
            "t" => self.open_todo(window, cx),
            "c" => self.compose(window, cx),
            "Escape" => self.close(window, cx),
            _ => {}
        }
    }

    /// E, #, I: a move, where the list in view offers it.
    fn move_open(&mut self, action: ThreadAction, cx: &mut Context<Self>) {
        let Some(open) = &self.open else { return };
        let can_delete = self.mailbox(&open.account_id).is_some_and(Mailbox::can_delete_forever);
        if api::move_actions(self.view.folder(), can_delete).contains(&action) {
            self.leave(action, None, cx);
        }
    }

    fn report_spam(&mut self, cx: &mut Context<Self>) {
        if self.open.is_some() && api::can_report_spam(self.view.folder()) {
            self.leave(ThreadAction::Spam, None, cx);
        }
    }

    fn toggle_star(&mut self, cx: &mut Context<Self>) {
        if let Some(open) = &self.open {
            let action = if open.is_starred { ThreadAction::Unstar } else { ThreadAction::Star };
            self.leave(action, None, cx);
        }
    }

    fn toggle_pin(&mut self, cx: &mut Context<Self>) {
        let Some(open) = self.open.clone() else { return };
        if self.can_pin(&open) {
            let pinned = self.is_pinned(&open.id);
            self.set_pinned(open, !pinned, cx);
        }
    }

    /// B: snooze the open conversation, or bring a snoozed one back.
    fn snooze_open(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(open) = &self.open else { return };
        if self.is_snoozed(&open.id) {
            self.unsnooze(open.id.clone(), cx);
        } else {
            self.open_when(overlays::SnoozeTarget::Open, window, cx);
        }
    }

    fn select_open(&mut self, cx: &mut Context<Self>) {
        if self.view.of_others() {
            return;
        }
        if let Some(id) = self.open_id().map(str::to_string) {
            self.toggle(&id, false, cx);
        }
    }

    /// Space selects the row under the pointer, or the open one; Shift takes a range.
    fn select_hovered(&mut self, range: bool, cx: &mut Context<Self>) {
        let id = self.hovered.clone().or_else(|| self.open_id().map(str::to_string));
        if let Some(id) = id.filter(|id| !self.view.of_others() && self.rows.iter().any(|t| t.id == *id)) {
            self.toggle(&id, range, cx);
        }
    }

    fn step(&mut self, by: isize, cx: &mut Context<Self>) {
        if self.view.of_others() {
            return;
        }
        let next = match self.position() {
            Some(index) => (index as isize + by).max(0),
            None => 0,
        };
        if let Some(thread) = self.rows.get(next as usize).cloned() {
            self.open_thread(thread, cx);
        }
    }

    /// C, and New message in the sidebar (`onCompose`).
    pub(crate) fn compose(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.has_active() {
            return;
        }
        self.open = None;
        self.compose_new(window, cx);
    }

    /// Cmd+R: everything in view again.
    fn refresh(&mut self, cx: &mut Context<Self>) {
        if self.view.of_others() {
            let view = self.view;
            let filter = self.filter.clone();
            self.show(view, filter, cx);
        } else {
            self.load(true, cx);
        }
        self.refresh_lists(cx);
        self.sync_mailboxes(cx);
    }

    /// Esc: clearing a selection comes before closing the conversation.
    fn close(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.close_reader_dialog(window, cx) {
            return;
        }
        if self.overlay.is_some() {
            self.close_overlay(window, cx);
        } else if self.editor.is_some() {
            self.editor = None;
        } else if !self.selection().is_empty() {
            self.clear_selection();
        } else if self.open.is_some() {
            self.open = None;
            self.drop_reply_elsewhere();
        } else {
            self.picked_sender = None;
        }
        cx.notify();
    }

    pub(crate) fn toggle_sidebar(&mut self, cx: &mut Context<Self>) {
        // It stays open while it is being arranged.
        if self.editor.is_some() {
            return;
        }
        self.collapsed = !self.collapsed;
        settings::set_sidebar_collapsed(self.collapsed);
        cx.notify();
    }

    pub(crate) fn open_settings(&mut self, page: Option<&'static str>, cx: &mut Context<Self>) {
        cx.emit(crate::app::AppEvent::OpenSettings(page));
    }

    /// Single keys do nothing while a spotlight or dialog of ours is open
    /// (`isBlocked` in lib/hotkeys.ts).
    fn free(&self) -> bool {
        self.overlay.is_none() && self.editor.is_none() && !self.reader.in_dialog()
    }
}

/// What a move says once it is done; marks and stars say nothing.
fn done_message(action: ThreadAction, count: usize) -> Option<String> {
    let one = count == 1;
    Some(match action {
        ThreadAction::Archive if one => t("Archived", "Gearchiveerd").to_string(),
        ThreadAction::Archive => t(
            format!("{count} conversations archived"),
            format!("{count} gesprekken gearchiveerd"),
        ),
        ThreadAction::Trash if one => t("Moved to trash", "Naar prullenbak verplaatst").to_string(),
        ThreadAction::Trash => t(
            format!("{count} conversations moved to trash"),
            format!("{count} gesprekken naar prullenbak"),
        ),
        ThreadAction::Inbox if one => t("Moved to inbox", "Terug in inbox").to_string(),
        ThreadAction::Inbox => t(
            format!("{count} conversations moved to inbox"),
            format!("{count} gesprekken terug in inbox"),
        ),
        ThreadAction::Spam if one => t("Reported as spam", "Gemeld als spam").to_string(),
        ThreadAction::Spam => t(
            format!("{count} conversations reported as spam"),
            format!("{count} gesprekken gemeld als spam"),
        ),
        ThreadAction::Delete if one => t("Deleted for good", "Definitief verwijderd").to_string(),
        ThreadAction::Delete => t(
            format!("{count} conversations deleted for good"),
            format!("{count} gesprekken definitief verwijderd"),
        ),
        _ => return None,
    })
}

/// Sends a move or a snooze for each conversation, three at a time
/// (`ACTION_CONCURRENCY`). The first error, if any.
fn post_action(
    client: &Client,
    ids: &[String],
    action: ThreadAction,
    until: Option<DateTime<Utc>>,
) -> Option<anyhow::Error> {
    let mut first = None;
    for chunk in ids.chunks(3) {
        let results: Vec<anyhow::Result<()>> = std::thread::scope(|scope| {
            let handles: Vec<_> = chunk
                .iter()
                .map(|id| {
                    scope.spawn(move || match until {
                        Some(until) => api::snooze(client, id, until),
                        None => api::act(client, id, action),
                    })
                })
                .collect();
            handles
                .into_iter()
                .map(|handle| handle.join().unwrap_or_else(|_| Err(anyhow::anyhow!("stopped"))))
                .collect()
        });
        for result in results {
            if let Err(error) = result {
                first.get_or_insert(error);
            }
        }
    }
    first
}

/// Who a line is from, as the list and the notifications name them.
pub(crate) fn sender_name(thread: &Thread) -> String {
    thread
        .from_name
        .clone()
        .filter(|name| !name.is_empty())
        .or_else(|| thread.from_email.clone())
        .unwrap_or_else(|| t("Unknown sender", "Onbekende afzender").to_string())
}

pub(crate) fn subject_of(thread: &Thread) -> String {
    subject_or_none(&thread.subject)
}

pub(crate) fn subject_or_none(subject: &str) -> String {
    if subject.is_empty() {
        t("(no subject)", "(geen onderwerp)").to_string()
    } else {
        subject.to_string()
    }
}

/// A moment picked in local time, as the API takes it.
pub(crate) fn to_utc(local: chrono::NaiveDateTime) -> Option<DateTime<Utc>> {
    local.and_local_timezone(Local).earliest().map(|at| at.with_timezone(&Utc))
}

impl Focusable for MailView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

impl Render for MailView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.rebuild_rows();
        self.debug_states(cx);
        self.compose_frame(window, cx);
        let overlay = self.render_overlay(window, cx);
        let editor_bar = self.render_editor_bar(cx);
        let toasts = self.render_toasts(cx);
        let reader_dialog = self.render_reader_dialog(window, cx);
        div()
            .id("mail")
            .key_context("Mail")
            .track_focus(&self.focus)
            .on_action(cx.listener(|this, _: &Next, _, cx| if this.free() { this.step(1, cx) }))
            .on_action(cx.listener(|this, _: &Previous, _, cx| if this.free() { this.step(-1, cx) }))
            .on_action(cx.listener(|this, _: &SelectOpen, _, cx| if this.free() { this.select_open(cx) }))
            .on_action(cx.listener(|this, _: &SelectHovered, _, cx| if this.free() { this.select_hovered(false, cx) }))
            .on_action(cx.listener(|this, _: &SelectRange, _, cx| if this.free() { this.select_hovered(true, cx) }))
            .on_action(cx.listener(|this, _: &SelectAll, _, cx| if this.free() { this.select_all(cx) }))
            .on_action(cx.listener(|this, _: &Archive, _, cx| if this.free() { this.move_open(ThreadAction::Archive, cx) }))
            .on_action(cx.listener(|this, _: &Trash, _, cx| if this.free() { this.move_open(ThreadAction::Trash, cx) }))
            .on_action(cx.listener(|this, _: &MoveToInbox, _, cx| if this.free() { this.move_open(ThreadAction::Inbox, cx) }))
            .on_action(cx.listener(|this, _: &ReportSpam, _, cx| if this.free() { this.report_spam(cx) }))
            .on_action(cx.listener(|this, _: &ToggleStar, _, cx| if this.free() { this.toggle_star(cx) }))
            .on_action(cx.listener(|this, _: &Snooze, window, cx| if this.free() { this.snooze_open(window, cx) }))
            .on_action(cx.listener(|this, _: &MarkUnread, _, cx| if this.free() { this.leave(ThreadAction::Unread, None, cx) }))
            .on_action(cx.listener(|this, _: &TogglePin, _, cx| if this.free() { this.toggle_pin(cx) }))
            .on_action(cx.listener(|this, _: &Refresh, _, cx| this.refresh(cx)))
            .on_action(cx.listener(|this, _: &Close, window, cx| this.close(window, cx)))
            .on_action(cx.listener(|this, _: &Search, window, cx| {
                // ⌘K again closes it, as on the web.
                if matches!(this.overlay, Some(Overlay::Spotlight(_))) {
                    this.close_overlay(window, cx)
                } else if this.overlay.is_none() {
                    this.open_spotlight(window, cx)
                }
            }))
            .on_action(cx.listener(|this, _: &Shortcuts, window, cx| if this.free() { this.open_shortcuts(window, cx) }))
            .on_action(cx.listener(|this, _: &ToggleSidebar, _, cx| if this.overlay.is_none() { this.toggle_sidebar(cx) }))
            .on_action(cx.listener(|this, _: &Reply, window, cx| if this.free() { this.compose_reply(false, window, cx) }))
            .on_action(cx.listener(|this, _: &ReplyAll, window, cx| if this.free() { this.compose_reply(true, window, cx) }))
            .on_action(cx.listener(|this, _: &Forward, window, cx| if this.free() { this.answer(reader::Answer::Forward, None, window, cx) }))
            .on_action(cx.listener(|this, _: &MakeTask, window, cx| if this.free() { this.open_todo(window, cx) }))
            .on_action(cx.listener(|this, _: &Compose, window, cx| if this.free() { this.compose(window, cx) }))
            .relative()
            .flex()
            .size_full()
            .bg(theme::background())
            .text_color(theme::foreground())
            .child(self.render_sidebar(window, cx))
            .child(self.render_list(window, cx))
            .child(self.render_reader(window, cx))
            // While the sidebar is arranged everything else steps back, dimmed and out of reach.
            .when(self.editor.is_some(), |el| {
                el.child(
                    div()
                        .id("editor-veil")
                        .absolute()
                        .top_0()
                        .bottom_0()
                        .right_0()
                        .left(px(sidebar::COLUMN))
                        .bg(rgba(0x00000066))
                        .occlude(),
                )
            })
            .children(editor_bar)
            .children(overlay)
            .children(reader_dialog)
            .children(toasts)
    }
}
