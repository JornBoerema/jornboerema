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
use crate::theme;

mod conversation;
mod list;
mod reader;
mod search;
mod sidebar;

use conversation::{prepare, random_nonce, short_date, Reading};
use gpui_kit::component::input::InputState;
use search::Search;
use sidebar::folder_name;

actions!(
    mail,
    [
        Next,
        Previous,
        Archive,
        ToggleStar,
        MarkUnread,
        Trash,
        Refresh,
        Close,
        FocusSearch
    ]
);

/// Single keys would otherwise fire while typing in the search field.
const NOT_TYPING: &str = "Mail && !Input";

pub fn bind_keys(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("j", Next, Some(NOT_TYPING)),
        KeyBinding::new("down", Next, Some(NOT_TYPING)),
        KeyBinding::new("k", Previous, Some(NOT_TYPING)),
        KeyBinding::new("up", Previous, Some(NOT_TYPING)),
        KeyBinding::new("e", Archive, Some(NOT_TYPING)),
        KeyBinding::new("s", ToggleStar, Some(NOT_TYPING)),
        KeyBinding::new("shift-u", MarkUnread, Some(NOT_TYPING)),
        KeyBinding::new("#", Trash, Some(NOT_TYPING)),
        KeyBinding::new("cmd-r", Refresh, Some("Mail")),
        KeyBinding::new("escape", Close, Some(NOT_TYPING)),
        KeyBinding::new("/", FocusSearch, Some(NOT_TYPING)),
        KeyBinding::new("cmd-f", FocusSearch, Some("Mail")),
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
    /// Lets only our own script run in the mail document.
    nonce: String,
    /// Shortcuts pressed while the mail has focus, sent on by its script.
    keys: UnboundedSender<String>,
    search_input: Entity<InputState>,
    /// Results instead of the folder while set.
    search: Option<Search>,
    /// Bumped on every search, so a slow older answer can't replace a newer one.
    search_generation: u64,
    found: UniformListScrollHandle,
    _poll: Task<()>,
    _keys: Task<()>,
    _search_events: Subscription,
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
        let (keys, mut pressed) = unbounded::<String>();
        let keys_task = cx.spawn_in(window, async move |this, cx| {
            while let Some(key) = pressed.next().await {
                if this
                    .update_in(cx, |this, window, cx| this.key(&key, window, cx))
                    .is_err()
                {
                    break;
                }
            }
        });
        let (search_input, search_events) = Self::search_field(window, cx);
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
            nonce: random_nonce(),
            keys,
            search_input,
            search: None,
            search_generation: 0,
            found: UniformListScrollHandle::new(),
            _poll: poll,
            _keys: keys_task,
            _search_events: search_events,
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

    /// What the list shows: the search results while searching, else the folder.
    fn rows(&self) -> &[Thread] {
        match &self.search {
            Some(search) => &search.hits,
            None => &self.threads,
        }
    }

    fn rows_mut(&mut self) -> &mut Vec<Thread> {
        match &mut self.search {
            Some(search) => &mut search.hits,
            None => &mut self.threads,
        }
    }

    /// Which folder's rules apply to the list: results act as the inbox does,
    /// so archiving or trashing a hit takes it out of them.
    fn list_folder(&self) -> Folder {
        if self.search.is_some() {
            Folder::Inbox
        } else {
            self.folder
        }
    }

    fn scroll(&self) -> &UniformListScrollHandle {
        if self.search.is_some() {
            &self.found
        } else {
            &self.list
        }
    }

    fn position(&self) -> Option<usize> {
        let open = self.open.as_deref()?;
        self.rows().iter().position(|thread| thread.id == open)
    }

    fn open_at(&mut self, index: usize, cx: &mut Context<Self>) {
        let Some(thread) = self.rows().get(index) else { return };
        let id = thread.id.clone();
        let unread = !thread.is_read;
        self.open = Some(id.clone());
        self.scroll().scroll_to_item(index, ScrollStrategy::Nearest);
        if unread {
            self.rows_mut()[index].is_read = true;
            self.mirror(&id, Action::Read);
            self.send(&id, Action::Read, cx);
        }
        if !matches!(self.reading.get(&id), Some(Reading::Ready(_))) {
            self.read(id, cx);
        }
        // The neighbours are where J and K go next: have them ready.
        for neighbour in [index + 1, index.wrapping_sub(1)] {
            if let Some(thread) = self.rows().get(neighbour) {
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
            .rows()
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
        let id = self.rows()[index].id.clone();
        self.send(&id, action, cx);
        apply(&mut self.rows_mut()[index], action);
        self.mirror(&id, action);
        if action.leaves(self.list_folder()) {
            match &mut self.search {
                Some(search) => search.remove(index),
                None => {
                    self.threads.remove(index);
                }
            }
            self.open = None;
            let left = self.rows().len();
            if left > 0 {
                self.open_at(index.min(left - 1), cx);
            }
        } else if action == Action::Unread {
            // "Not now": close it, so it stays unread.
            self.open = None;
        }
        cx.notify();
    }

    /// A search hit that is also in the folder behind the results changes there too.
    fn mirror(&mut self, id: &str, action: Action) {
        if self.search.is_none() {
            return;
        }
        let Some(index) = self.threads.iter().position(|thread| thread.id == id) else {
            return;
        };
        if action.leaves(self.folder) {
            self.threads.remove(index);
        } else {
            apply(&mut self.threads[index], action);
        }
    }

    /// Cmd+R: the search again while searching, else the folder.
    fn refresh(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        match &self.search {
            Some(search) => self.search_for(search.query.clone(), window, cx),
            None => self.load(true, cx),
        }
    }

    /// Esc: closes the conversation first, then the search.
    fn close(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.open.is_none() && self.search.is_some() {
            self.end_search(window, cx);
        } else {
            self.open = None;
            cx.notify();
        }
    }

    /// A shortcut pressed inside the mail document.
    fn key(&mut self, key: &str, window: &mut Window, cx: &mut Context<Self>) {
        match key {
            "j" => self.step(1, cx),
            "k" => self.step(-1, cx),
            "e" if self.list_folder() != Folder::Archive => self.act(Action::Archive, cx),
            "s" => self.toggle_star(cx),
            "shift-u" => self.act(Action::Unread, cx),
            "#" if self.list_folder() != Folder::Trash => self.act(Action::Trash, cx),
            "cmd-r" => self.refresh(window, cx),
            "/" | "cmd-f" => self.focus_search(window, cx),
            "Escape" => self.close(window, cx),
            _ => {}
        }
    }

    fn toggle_star(&mut self, cx: &mut Context<Self>) {
        let starred = self.position().map(|i| self.rows()[i].is_starred);
        if let Some(starred) = starred {
            self.act(if starred { Action::Unstar } else { Action::Star }, cx)
        }
    }

    fn step(&mut self, by: isize, cx: &mut Context<Self>) {
        let next = match self.position() {
            Some(index) => index as isize + by,
            None => 0,
        };
        if next >= 0 && (next as usize) < self.rows().len() {
            self.open_at(next as usize, cx);
        }
    }
}

/// What an action changes on the line itself; moves are up to the list.
fn apply(thread: &mut Thread, action: Action) {
    match action {
        Action::Star => thread.is_starred = true,
        Action::Unstar => thread.is_starred = false,
        Action::Unread => thread.is_read = false,
        Action::Read => thread.is_read = true,
        _ => {}
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
                if this.list_folder() != Folder::Archive {
                    this.act(Action::Archive, cx)
                }
            }))
            .on_action(cx.listener(|this, _: &ToggleStar, _, cx| this.toggle_star(cx)))
            .on_action(cx.listener(|this, _: &MarkUnread, _, cx| this.act(Action::Unread, cx)))
            .on_action(cx.listener(|this, _: &Trash, _, cx| this.act(Action::Trash, cx)))
            .on_action(cx.listener(|this, _: &Refresh, window, cx| this.refresh(window, cx)))
            .on_action(cx.listener(|this, _: &Close, window, cx| this.close(window, cx)))
            .on_action(cx.listener(|this, _: &FocusSearch, window, cx| this.focus_search(window, cx)))
            .flex()
            .size_full()
            .bg(theme::background())
            .text_color(theme::foreground())
            .child(self.render_sidebar(cx))
            .child(self.render_list(window, cx))
            .child(self.render_reader(window, cx))
    }
}
