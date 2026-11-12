//! Even mailen: folders, the conversation list and the open conversation.
//! The state and what it does live here; each pane renders in its own module.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use base64::Engine as _;
use futures::channel::mpsc::{unbounded, UnboundedSender};
use futures::StreamExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use gpui_webview::WebView;

use crate::api::{Account, Action, Client, Folder, Thread, Unauthorized};
use crate::{email, theme};

mod conversation;
mod download;
mod list;
mod reader;
mod sidebar;

use conversation::{prepare, random_nonce, short_date, Reading};
use sidebar::folder_name;

actions!(
    mail,
    [Next, Previous, Archive, ToggleStar, MarkUnread, Trash, Refresh, Close]
);

pub fn bind_keys(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("j", Next, Some("Mail")),
        KeyBinding::new("down", Next, Some("Mail")),
        KeyBinding::new("k", Previous, Some("Mail")),
        KeyBinding::new("up", Previous, Some("Mail")),
        KeyBinding::new("e", Archive, Some("Mail")),
        KeyBinding::new("s", ToggleStar, Some("Mail")),
        KeyBinding::new("shift-u", MarkUnread, Some("Mail")),
        KeyBinding::new("#", Trash, Some("Mail")),
        KeyBinding::new("cmd-r", Refresh, Some("Mail")),
        KeyBinding::new("escape", Close, Some("Mail")),
    ]);
}

/// Two lines and their padding: every row is this tall, so the list only lays out what shows.
pub(crate) const ROW_HEIGHT: f32 = 62.;
/// Room for the window buttons above the sidebar and the panes.
pub(crate) const TITLE_BAR: f32 = 52.;

/// The mail view tells the app when the session lapsed.
pub struct SignedOut;
impl EventEmitter<SignedOut> for MailView {}

pub struct MailView {
    client: Client,
    focus: FocusHandle,
    accounts: Vec<Account>,
    folder: Folder,
    threads: Vec<Thread>,
    cursor: Option<String>,
    loading: bool,
    /// Bumped on every new list, so answers for an older one are dropped.
    generation: u64,
    error: Option<SharedString>,
    open: Option<String>,
    reading: HashMap<String, Reading>,
    list: UniformListScrollHandle,
    /// The mail itself, in a system webview: GPUI can't lay out mail HTML.
    webview: Option<Entity<WebView>>,
    /// Which conversation the webview holds, and whether with images.
    shown: Option<(String, bool)>,
    /// Conversations whose remote images the user asked to see.
    images: HashSet<String>,
    /// Numbers each document the webview loads, so a download asked for in
    /// one that was replaced since is dropped.
    view: u64,
    /// How a download went, for the reader's toolbar; `true` when it failed.
    status: Option<(SharedString, bool)>,
    status_serial: u64,
    /// Lets only our own script run in the mail document.
    nonce: String,
    /// Messages from that script: shortcuts pressed while the mail has focus, and downloads.
    ipc: UnboundedSender<String>,
    _poll: Task<()>,
    _ipc: Task<()>,
}

impl MailView {
    pub fn new(client: Client, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let focus = cx.focus_handle();
        window.focus(&focus, cx);
        // New mail shows without a refresh: the API syncs, this asks every minute.
        let poll = cx.spawn(async move |this, cx| loop {
            cx.background_executor().timer(std::time::Duration::from_secs(60)).await;
            if this.update(cx, |this, cx| this.refresh_quietly(cx)).is_err() {
                break;
            }
        });
        let (ipc, mut received) = unbounded::<String>();
        let ipc_task = cx.spawn(async move |this, cx| {
            while let Some(raw) = received.next().await {
                if this.update(cx, |this, cx| this.message(&raw, cx)).is_err() {
                    break;
                }
            }
        });
        let mut view = Self {
            client,
            focus,
            accounts: Vec::new(),
            folder: Folder::Inbox,
            threads: Vec::new(),
            cursor: None,
            loading: false,
            generation: 0,
            error: None,
            open: None,
            reading: HashMap::new(),
            list: UniformListScrollHandle::new(),
            webview: None,
            shown: None,
            images: HashSet::new(),
            view: 0,
            status: None,
            status_serial: 0,
            nonce: random_nonce(),
            ipc,
            _poll: poll,
            _ipc: ipc_task,
        };
        view.load_accounts(cx);
        view.load(true, cx);
        view
    }

    fn load_accounts(&mut self, cx: &mut Context<Self>) {
        let client = self.client.clone();
        let task = cx.background_executor().spawn(async move { client.accounts() });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |this, cx| match result {
                Ok(accounts) => {
                    this.accounts = accounts;
                    cx.notify();
                }
                Err(error) => this.failed(error, cx),
            });
        })
        .detach();
    }

    /// Loads the first page of the folder (`fresh`), or the next one.
    fn load(&mut self, fresh: bool, cx: &mut Context<Self>) {
        if fresh {
            self.generation += 1;
            self.cursor = None;
        } else if self.loading || self.cursor.is_none() {
            return;
        }
        self.loading = true;
        let generation = self.generation;
        let client = self.client.clone();
        let folder = self.folder;
        let cursor = self.cursor.clone();
        let task = cx
            .background_executor()
            .spawn(async move { client.threads(folder, cursor.as_deref()) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |this, cx| {
                if this.generation != generation {
                    return;
                }
                this.loading = false;
                match result {
                    Ok(page) => {
                        this.error = None;
                        if fresh {
                            this.threads = page.threads;
                        } else {
                            this.threads.extend(page.threads);
                        }
                        this.cursor = page.next_cursor;
                    }
                    Err(error) => this.failed(error, cx),
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }

    /// The minute's check: the first page again, keeping what is further down when it is the same.
    fn refresh_quietly(&mut self, cx: &mut Context<Self>) {
        if self.loading {
            return;
        }
        let generation = self.generation;
        let client = self.client.clone();
        let folder = self.folder;
        let task = cx
            .background_executor()
            .spawn(async move { client.threads(folder, None) });
        cx.spawn(async move |this, cx| {
            let Ok(page) = task.await else { return };
            let _ = this.update(cx, |this, cx| {
                if this.generation != generation || this.loading {
                    return;
                }
                let fresh: std::collections::HashSet<&str> = page.threads.iter().map(|t| t.id.as_str()).collect();
                let oldest = page.threads.last().map(|t| t.received_at);
                // Keep the pages below the first one; they are older than anything it holds.
                let older: Vec<Thread> = match oldest {
                    Some(oldest) => this
                        .threads
                        .iter()
                        .filter(|t| t.received_at < oldest && !fresh.contains(t.id.as_str()))
                        .cloned()
                        .collect(),
                    None => Vec::new(),
                };
                let keep_cursor = !older.is_empty();
                this.threads = page.threads.into_iter().chain(older).collect();
                if !keep_cursor {
                    this.cursor = page.next_cursor;
                }
                cx.notify();
            });
        })
        .detach();
    }

    fn failed(&mut self, error: anyhow::Error, cx: &mut Context<Self>) {
        if error.downcast_ref::<Unauthorized>().is_some() {
            cx.emit(SignedOut);
            return;
        }
        self.error = Some(error.to_string().into());
        cx.notify();
    }

    fn show_folder(&mut self, folder: Folder, cx: &mut Context<Self>) {
        if self.folder == folder {
            self.list.scroll_to_item(0, ScrollStrategy::Top);
            return;
        }
        self.folder = folder;
        self.threads.clear();
        self.open = None;
        self.load(true, cx);
    }

    fn position(&self) -> Option<usize> {
        let open = self.open.as_deref()?;
        self.threads.iter().position(|thread| thread.id == open)
    }

    fn open_at(&mut self, index: usize, cx: &mut Context<Self>) {
        let Some(thread) = self.threads.get(index) else { return };
        let id = thread.id.clone();
        let unread = !thread.is_read;
        self.open = Some(id.clone());
        self.list.scroll_to_item(index, ScrollStrategy::Nearest);
        if unread {
            self.threads[index].is_read = true;
            self.send(&id, Action::Read, cx);
        }
        if !matches!(self.reading.get(&id), Some(Reading::Ready(_))) {
            self.read(id, cx);
        }
        // The neighbours are where J and K go next: have them ready.
        for neighbour in [index + 1, index.wrapping_sub(1)] {
            if let Some(thread) = self.threads.get(neighbour) {
                if !self.reading.contains_key(&thread.id) {
                    self.read(thread.id.clone(), cx);
                }
            }
        }
        cx.notify();
    }

    fn read(&mut self, id: String, cx: &mut Context<Self>) {
        self.reading.insert(id.clone(), Reading::Loading);
        let client = self.client.clone();
        let fetch_id = id.clone();
        let subject = self
            .threads
            .iter()
            .find(|thread| thread.id == id)
            .map(|thread| thread.subject.clone())
            .unwrap_or_default();
        // Fetching, sanitizing and fetching inline images all stay off the UI thread.
        let task = cx.background_executor().spawn(async move {
            client
                .thread(&fetch_id)
                .map(|detail| prepare(&client, &fetch_id, subject, detail))
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |this, cx| {
                let reading = match result {
                    Ok(conversation) => Reading::Ready(Arc::new(conversation)),
                    Err(error) if error.downcast_ref::<Unauthorized>().is_some() => {
                        cx.emit(SignedOut);
                        return;
                    }
                    Err(error) => Reading::Failed(error.to_string().into()),
                };
                this.reading.insert(id, reading);
                cx.notify();
            });
        })
        .detach();
    }

    fn send(&self, id: &str, action: Action, cx: &mut Context<Self>) {
        let client = self.client.clone();
        let id = id.to_string();
        let task = cx.background_executor().spawn(async move { client.act(&id, action) });
        cx.spawn(async move |this, cx| {
            if let Err(error) = task.await {
                let _ = this.update(cx, |this, cx| this.failed(error, cx));
            }
        })
        .detach();
    }

    /// Acts on the open conversation. One that leaves the list opens the next one, as in Gmail.
    fn act(&mut self, action: Action, cx: &mut Context<Self>) {
        let Some(index) = self.position() else { return };
        let id = self.threads[index].id.clone();
        self.send(&id, action, cx);
        let thread = &mut self.threads[index];
        match action {
            Action::Star => thread.is_starred = true,
            Action::Unstar => thread.is_starred = false,
            Action::Unread => thread.is_read = false,
            Action::Read => thread.is_read = true,
            _ => {}
        }
        if action.leaves(self.folder) {
            self.threads.remove(index);
            self.open = None;
            if !self.threads.is_empty() {
                self.open_at(index.min(self.threads.len() - 1), cx);
            }
        } else if action == Action::Unread {
            // "Not now": close it, so it stays unread.
            self.open = None;
        }
        cx.notify();
    }

    /// A message from our script in the mail document.
    fn message(&mut self, raw: &str, cx: &mut Context<Self>) {
        match email::parse_message(raw) {
            Some(email::Message::Key(key)) => self.key(&key, cx),
            Some(email::Message::Download { view, part, file }) => self.download(view, part, file, cx),
            None => {}
        }
    }

    /// A shortcut pressed inside the mail document.
    fn key(&mut self, key: &str, cx: &mut Context<Self>) {
        match key {
            "j" => self.step(1, cx),
            "k" => self.step(-1, cx),
            "e" if self.folder != Folder::Archive => self.act(Action::Archive, cx),
            "s" => self.toggle_star(cx),
            "shift-u" => self.act(Action::Unread, cx),
            "#" if self.folder != Folder::Trash => self.act(Action::Trash, cx),
            "cmd-r" => self.load(true, cx),
            "Escape" => {
                self.open = None;
                cx.notify();
            }
            _ => {}
        }
    }

    fn toggle_star(&mut self, cx: &mut Context<Self>) {
        let starred = self.position().map(|i| self.threads[i].is_starred);
        if let Some(starred) = starred {
            self.act(if starred { Action::Unstar } else { Action::Star }, cx)
        }
    }

    fn step(&mut self, by: isize, cx: &mut Context<Self>) {
        let next = match self.position() {
            Some(index) => index as isize + by,
            None => 0,
        };
        if next >= 0 && (next as usize) < self.threads.len() {
            self.open_at(next as usize, cx);
        }
    }
}

impl Focusable for MailView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

impl Render for MailView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .key_context("Mail")
            .track_focus(&self.focus)
            .on_action(cx.listener(|this, _: &Next, _, cx| this.step(1, cx)))
            .on_action(cx.listener(|this, _: &Previous, _, cx| this.step(-1, cx)))
            .on_action(cx.listener(|this, _: &Archive, _, cx| {
                if this.folder != Folder::Archive {
                    this.act(Action::Archive, cx)
                }
            }))
            .on_action(cx.listener(|this, _: &ToggleStar, _, cx| this.toggle_star(cx)))
            .on_action(cx.listener(|this, _: &MarkUnread, _, cx| this.act(Action::Unread, cx)))
            .on_action(cx.listener(|this, _: &Trash, _, cx| this.act(Action::Trash, cx)))
            .on_action(cx.listener(|this, _: &Refresh, _, cx| this.load(true, cx)))
            .on_action(cx.listener(|this, _: &Close, _, cx| {
                this.open = None;
                cx.notify();
            }))
            .flex()
            .size_full()
            .bg(theme::background())
            .text_color(theme::foreground())
            .child(self.render_sidebar(cx))
            .child(self.render_list(cx))
            .child(self.render_reader(window, cx))
    }
}
