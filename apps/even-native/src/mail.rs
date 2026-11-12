//! Even mailen: folders, the conversation list and the open conversation.

use std::collections::{HashMap, HashSet};
use std::ops::Range;
use std::sync::Arc;

use base64::Engine as _;
use chrono::{Datelike, Local};
use futures::channel::mpsc::{unbounded, UnboundedSender};
use futures::StreamExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;
use gpui_webview::WebView;

use crate::api::{Account, Action, Client, Folder, Message, Thread, ThreadDetail, Unauthorized};
use crate::email::{self, Body, Part};
use crate::theme;

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
const ROW_HEIGHT: f32 = 62.;
/// Room for the window buttons above the sidebar and the panes.
const TITLE_BAR: f32 = 52.;

/// The mail view tells the app when the session lapsed.
pub struct SignedOut;
impl EventEmitter<SignedOut> for MailView {}

/// A conversation as the reader shows it, prepared off the UI thread:
/// sanitized, with its inline images in place.
struct Conversation {
    subject: String,
    parts: Vec<Part>,
    remote_images: bool,
}

enum Reading {
    Loading,
    Ready(Arc<Conversation>),
    Failed(SharedString),
}

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
    _poll: Task<()>,
    _keys: Task<()>,
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
        let keys_task = cx.spawn(async move |this, cx| {
            while let Some(key) = pressed.next().await {
                if this.update(cx, |this, cx| this.key(&key, cx)).is_err() {
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
            nonce: random_nonce(),
            keys,
            _poll: poll,
            _keys: keys_task,
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
        let task = cx.background_executor().spawn(async move { client.threads(folder, None) });
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
            client.thread(&fetch_id).map(|detail| prepare(&client, &fetch_id, subject, detail))
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

    fn render_rows(&mut self, range: Range<usize>, _: &mut Window, cx: &mut Context<Self>) -> Vec<AnyElement> {
        // Nearly at the end of what is loaded: fetch the next page.
        if range.end + 20 >= self.threads.len() {
            self.load(false, cx);
        }
        let several = self.accounts.len() > 1;
        let colors: HashMap<&str, usize> = self.accounts.iter().map(|a| (a.id.as_str(), a.color)).collect();
        range
            .filter_map(|index| {
                let thread = self.threads.get(index)?;
                let open = self.open.as_deref() == Some(thread.id.as_str());
                let color = several.then(|| colors.get(thread.account_id.as_str()).copied()).flatten();
                Some(row(index, thread, open, color, cx).into_any_element())
            })
            .collect()
    }

    fn render_sidebar(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let folders = Folder::ALL.into_iter().map(|folder| {
            let active = folder == self.folder;
            div()
                .id(SharedString::from(format!("folder-{folder:?}")))
                .flex()
                .items_center()
                .h(px(30.))
                .px_2p5()
                .rounded_md()
                .text_sm()
                .when(active, |el| el.bg(theme::accent()).text_color(theme::foreground()))
                .when(!active, |el| el.text_color(theme::muted()).hover(|el| el.bg(theme::hover())))
                .child(folder_name(folder))
                .on_click(cx.listener(move |this, _, _, cx| this.show_folder(folder, cx)))
        });
        let accounts = self.accounts.iter().map(|account| {
            div()
                .flex()
                .items_center()
                .gap_2()
                .text_xs()
                .text_color(theme::muted())
                .child(div().size(px(7.)).rounded_full().bg(theme::account(account.color)))
                .child(div().truncate().child(account.email.clone()))
        });
        div()
            .flex()
            .flex_col()
            .w(px(220.))
            .flex_none()
            .h_full()
            .bg(theme::sidebar())
            .border_r_1()
            .border_color(theme::border())
            .child(div().h(px(TITLE_BAR)).flex_none())
            .child(
                div()
                    .px_4()
                    .pb_3()
                    .text_sm()
                    .font_weight(FontWeight::SEMIBOLD)
                    .child("Even mailen"),
            )
            .child(div().flex().flex_col().gap_0p5().px_2().children(folders))
            .child(div().flex_1())
            .child(div().flex().flex_col().gap_1p5().p_4().children(accounts))
    }

    fn render_list(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        let count = self.threads.len();
        let header = div()
            .flex()
            .items_center()
            .justify_between()
            .h(px(TITLE_BAR))
            .flex_none()
            .px_4()
            .child(div().text_sm().font_weight(FontWeight::MEDIUM).child(folder_name(self.folder)))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .when(self.loading, |el| el.child(div().text_xs().text_color(theme::faint()).child("Laden…")))
                    .child(
                        div()
                            .id("refresh")
                            .text_xs()
                            .px_2()
                            .py_1()
                            .rounded_md()
                            .text_color(theme::muted())
                            .hover(|el| el.bg(theme::hover()).text_color(theme::foreground()))
                            .child("Vernieuwen")
                            .on_click(cx.listener(|this, _, _, cx| this.load(true, cx))),
                    ),
            );
        let body = if let Some(error) = self.error.clone().filter(|_| count == 0) {
            div().p_4().text_sm().text_color(theme::danger()).child(error).into_any_element()
        } else if count == 0 && !self.loading {
            div().p_4().text_sm().text_color(theme::muted()).child("Niets hier.").into_any_element()
        } else {
            uniform_list("threads", count, cx.processor(Self::render_rows))
                .track_scroll(&self.list)
                .flex_1()
                .px_2()
                .into_any_element()
        };
        div()
            .flex()
            .flex_col()
            .w(px(380.))
            .flex_none()
            .h_full()
            .border_r_1()
            .border_color(theme::border())
            .child(header)
            .child(body)
    }

    /// The webview, built the first time a conversation shows.
    fn webview(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Option<Entity<WebView>> {
        if self.webview.is_none() {
            let keys = self.keys.clone();
            let builder = wry::WebViewBuilder::new()
                .with_background_color((15, 15, 15, 255))
                .with_html("<html><body style=\"background:#0f0f0f\"></body></html>")
                .with_ipc_handler(move |request| {
                    let _ = keys.unbounded_send(request.body().clone());
                })
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
                    self.error = Some(format!("De mailweergave start niet: {error}").into());
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

    fn render_reader(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let shell = div().flex().flex_col().flex_1().min_w_0().h_full().bg(theme::panel());
        let Some(index) = self.position() else {
            self.hide_webview(cx);
            return shell.child(
                div()
                    .flex()
                    .flex_1()
                    .items_center()
                    .justify_center()
                    .text_sm()
                    .text_color(theme::faint())
                    .child("Kies een gesprek"),
            );
        };
        let thread = &self.threads[index];
        let id = thread.id.clone();
        let starred = thread.is_starred;
        let conversation = match self.reading.get(&id) {
            Some(Reading::Ready(conversation)) => Some(conversation.clone()),
            _ => None,
        };
        let images_allowed = self.images.contains(&id);
        let images_hidden = conversation.as_ref().is_some_and(|c| c.remote_images) && !images_allowed;
        let toolbar = div()
            .flex()
            .items_center()
            .gap_1()
            .h(px(TITLE_BAR))
            .flex_none()
            .px_4()
            .when(self.folder != Folder::Archive, |el| {
                el.child(tool("archive", "Archiveren", "E", cx.listener(|this, _, _, cx| this.act(Action::Archive, cx))))
            })
            .child(tool(
                "star",
                if starred { "Ster weg" } else { "Ster" },
                "S",
                cx.listener(move |this, _, _, cx| this.act(if starred { Action::Unstar } else { Action::Star }, cx)),
            ))
            .child(tool("unread", "Ongelezen", "⇧U", cx.listener(|this, _, _, cx| this.act(Action::Unread, cx))))
            .when(self.folder != Folder::Trash, |el| {
                el.child(tool("trash", "Prullenbak", "#", cx.listener(|this, _, _, cx| this.act(Action::Trash, cx))))
            })
            .when(matches!(self.folder, Folder::Archive | Folder::Spam | Folder::Trash), |el| {
                el.child(tool("inbox", "Naar inbox", "", cx.listener(|this, _, _, cx| this.act(Action::Inbox, cx))))
            })
            .child(div().flex_1())
            .when(images_hidden, |el| {
                let id = id.clone();
                el.child(
                    div()
                        .text_xs()
                        .text_color(theme::faint())
                        .child("Afbeeldingen verborgen, zodat afzenders je niet volgen."),
                )
                .child(tool(
                    "images",
                    "Tonen",
                    "",
                    cx.listener(move |this, _, _, cx| {
                        this.images.insert(id.clone());
                        cx.notify();
                    }),
                ))
            });
        let Some(conversation) = conversation else {
            self.hide_webview(cx);
            let message: AnyElement = match self.reading.get(&id) {
                Some(Reading::Failed(error)) => div()
                    .p_6()
                    .text_sm()
                    .text_color(theme::danger())
                    .child(error.clone())
                    .into_any_element(),
                _ => div().p_6().text_sm().text_color(theme::faint()).child("Laden…").into_any_element(),
            };
            return shell.child(toolbar).child(message);
        };
        let Some(webview) = self.webview(window, cx) else {
            return shell.child(toolbar);
        };
        let wanted = (id.clone(), images_allowed);
        if self.shown.as_ref() != Some(&wanted) {
            let document = email::document(&conversation.subject, &conversation.parts, images_allowed, &self.nonce);
            let _ = webview.read(cx).load_html(&document);
            self.shown = Some(wanted);
        }
        webview.update(cx, |webview, _| {
            if !webview.visible() {
                webview.show();
            }
        });
        shell.child(toolbar).child(div().flex_1().min_h_0().child(webview))
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

fn row(index: usize, thread: &Thread, open: bool, account_color: Option<usize>, cx: &mut Context<MailView>) -> impl IntoElement {
    let unread = !thread.is_read;
    let who: String = match &thread.to {
        Some(to) => format!("Aan: {}", to.iter().map(|a| a.label()).collect::<Vec<_>>().join(", ")),
        None => thread
            .from_name
            .clone()
            .filter(|name| !name.is_empty())
            .or_else(|| thread.from_email.clone())
            .unwrap_or_else(|| "Onbekend".into()),
    };
    let who = if thread.message_count > 1 { format!("{who}  {}", thread.message_count) } else { who };
    let subject = if thread.subject.is_empty() { "(geen onderwerp)" } else { &thread.subject };
    div()
        .id(index)
        .h(px(ROW_HEIGHT))
        .py(px(2.))
        .child(
            div()
                .relative()
                .flex()
                .flex_col()
                .justify_center()
                .gap_0p5()
                .size_full()
                .pl(px(26.))
                .pr_2p5()
                .rounded_lg()
                .text_sm()
                .when(open, |el| el.bg(theme::accent()))
                .when(!open, |el| el.hover(|el| el.bg(theme::hover())))
                .when(unread, |el| {
                    el.child(div().absolute().left(px(11.)).top(px(15.)).size(px(6.)).rounded_full().bg(theme::primary()))
                })
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .truncate()
                                .when(unread, |el| el.font_weight(FontWeight::SEMIBOLD))
                                .when(!unread, |el| el.text_color(theme::muted()))
                                .child(who),
                        )
                        .when(thread.is_starred, |el| el.child(div().text_xs().text_color(theme::starred()).child("★")))
                        .when(thread.has_attachments, |el| el.child(div().text_xs().text_color(theme::faint()).child("📎")))
                        .child(div().flex_none().text_xs().text_color(theme::muted()).child(short_date(thread.received_at))),
                )
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .truncate()
                                .text_color(theme::muted())
                                .child(
                                    StyledText::new(if thread.snippet.is_empty() {
                                        subject.to_string()
                                    } else {
                                        format!("{subject} · {}", thread.snippet)
                                    })
                                    .with_highlights(subject_highlight(subject, unread)),
                                ),
                        )
                        .when_some(account_color, |el, color| {
                            el.child(div().flex_none().size(px(7.)).rounded_full().bg(theme::account(color)))
                        }),
                ),
        )
        .on_click(cx.listener(move |this, _, _, cx| this.open_at(index, cx)))
}

/// The subject stands out from the snippet behind it, more so when unread.
fn subject_highlight(subject: &str, unread: bool) -> Vec<(Range<usize>, HighlightStyle)> {
    vec![(
        0..subject.len(),
        HighlightStyle {
            color: Some(theme::foreground().into()),
            font_weight: unread.then_some(FontWeight::MEDIUM),
            ..Default::default()
        },
    )]
}

fn tool(
    id: &'static str,
    label: &'static str,
    key: &'static str,
    on_click: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
) -> impl IntoElement {
    div()
        .id(id)
        .flex()
        .items_center()
        .gap_1p5()
        .px_2()
        .py_1()
        .rounded_md()
        .text_xs()
        .text_color(theme::muted())
        .hover(|el| el.bg(theme::hover()).text_color(theme::foreground()))
        .child(label)
        .child(div().text_color(theme::faint()).child(key))
        .on_click(on_click)
}

fn folder_name(folder: Folder) -> &'static str {
    match folder {
        Folder::Inbox => "Inbox",
        Folder::Starred => "Met ster",
        Folder::Sent => "Verzonden",
        Folder::Archive => "Archief",
        Folder::Spam => "Spam",
        Folder::Trash => "Prullenbak",
    }
}

const MONTHS: [&str; 12] = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

/// Today the time, this year day and month, before that the year too, as the web app does.
fn short_date(at: chrono::DateTime<chrono::Utc>) -> String {
    let at = at.with_timezone(&Local);
    let now = Local::now();
    if at.date_naive() == now.date_naive() {
        at.format("%H:%M").to_string()
    } else if at.year() == now.year() {
        format!("{} {}", at.day(), MONTHS[at.month0() as usize])
    } else {
        format!("{} {} {}", at.day(), MONTHS[at.month0() as usize], at.year())
    }
}

fn long_date(at: chrono::DateTime<chrono::Utc>) -> String {
    let at = at.with_timezone(&Local);
    format!("{} {} {}, {}", at.day(), MONTHS[at.month0() as usize], at.year(), at.format("%H:%M"))
}

/// Images inside the mail: the kinds browsers show safely, and not too many or too big.
const SAFE_INLINE: [&str; 5] = ["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"];
const MAX_INLINE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_INLINE_IMAGES: usize = 20;

/// Runs on the background executor: sanitizes each body and puts its `cid:` images in place.
fn prepare(client: &Client, thread_id: &str, subject: String, detail: ThreadDetail) -> Conversation {
    let mut remote_images = false;
    let parts = detail
        .messages
        .iter()
        .map(|message| {
            let html = message.html.as_deref().filter(|html| !html.trim().is_empty());
            let body = match (html, message.text.as_deref()) {
                (Some(html), _) => {
                    let mut clean = email::sanitize(html);
                    clean = with_inline_images(client, thread_id, message, clean);
                    remote_images |= email::has_remote_images(&clean);
                    let paper = email::has_own_background(&clean);
                    Body::Html { html: clean, paper }
                }
                (None, Some(text)) => Body::Text(tidy(text)),
                (None, None) => Body::Text(String::new()),
            };
            let to: Vec<&str> = message.to.iter().chain(&message.cc).map(|a| a.label()).collect();
            Part {
                from: message.from.as_ref().map(|a| a.label().to_string()).unwrap_or_else(|| "Onbekend".into()),
                to: if to.is_empty() { String::new() } else { format!("Aan {}", to.join(", ")) },
                date: long_date(message.received_at),
                body,
                attachments: message.attachments.iter().map(|a| format!("{} · {}", a.name, size(a.size))).collect(),
            }
        })
        .collect();
    let subject = if subject.is_empty() { "(geen onderwerp)".to_string() } else { subject };
    Conversation { subject, parts, remote_images }
}

fn with_inline_images(client: &Client, thread_id: &str, message: &Message, mut html: String) -> String {
    let wanted = message
        .inline
        .iter()
        .filter(|image| {
            SAFE_INLINE.contains(&image.content_type.to_ascii_lowercase().as_str())
                && image.size <= MAX_INLINE_BYTES
                && html.contains(&format!("cid:{}", image.content_id))
        })
        .take(MAX_INLINE_IMAGES)
        .collect::<Vec<_>>();
    for image in wanted {
        if let Ok(bytes) = client.attachment(thread_id, &message.id, &image.id) {
            let url = format!(
                "data:{};base64,{}",
                image.content_type.to_ascii_lowercase(),
                base64::engine::general_purpose::STANDARD.encode(bytes)
            );
            html = html.replace(&format!("cid:{}", image.content_id), &url);
        }
    }
    html
}

/// Links in the mail leave for the browser or the mail app; nothing else may leave the page.
fn is_outside(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    ["http:", "https:", "mailto:", "tel:"].iter().any(|scheme| lower.starts_with(scheme))
}

fn random_nonce() -> String {
    use rand::RngCore as _;
    let mut bytes = [0u8; 18];
    rand::thread_rng().fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// No more than one empty line in a row; newsletters stack them.
fn tidy(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut blank = 0;
    for line in text.lines() {
        let line = line.trim_end();
        if line.is_empty() {
            blank += 1;
            if blank > 1 {
                continue;
            }
        } else {
            blank = 0;
        }
        out.push_str(line);
        out.push('\n');
    }
    out.trim().to_string()
}

fn size(bytes: u64) -> String {
    match bytes {
        b if b >= 1_000_000 => format!("{:.1} MB", b as f64 / 1_000_000.),
        b if b >= 1_000 => format!("{} kB", b / 1_000),
        b => format!("{b} B"),
    }
}

#[cfg(test)]
mod tests {
    use super::{size, tidy};

    #[test]
    fn tidy_keeps_one_empty_line() {
        assert_eq!(tidy("a\n\n\n\nb  \n"), "a\n\nb");
    }

    #[test]
    fn sizes_read_well() {
        assert_eq!(size(512), "512 B");
        assert_eq!(size(2_400), "2 kB");
        assert_eq!(size(3_250_000), "3.2 MB");
    }
}
