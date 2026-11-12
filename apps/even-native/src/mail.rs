//! Even mailen: folders, the conversation list and the open conversation.

use std::collections::HashMap;
use std::ops::Range;
use std::sync::Arc;

use chrono::{Datelike, Local};
use gpui_kit::prelude::*;
use gpui_kit::*;

use crate::api::{Account, Action, Client, Folder, Message, Thread, Unauthorized};
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

/// A message as the reader shows it: its body already turned into text.
struct ShownMessage {
    from: SharedString,
    to: SharedString,
    date: SharedString,
    body: SharedString,
    attachments: Vec<SharedString>,
}

enum Reading {
    Loading,
    Ready(Arc<Vec<ShownMessage>>),
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
    _poll: Task<()>,
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
            _poll: poll,
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
        // Fetching and turning HTML into text both stay off the UI thread.
        let task = cx.background_executor().spawn(async move {
            client.thread(&fetch_id).map(|detail| detail.messages.iter().map(shown).collect::<Vec<_>>())
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |this, cx| {
                let reading = match result {
                    Ok(messages) => Reading::Ready(Arc::new(messages)),
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

    fn render_reader(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let shell = div().flex().flex_col().flex_1().min_w_0().h_full().bg(theme::panel());
        let Some(index) = self.position() else {
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
        let starred = thread.is_starred;
        let leaves_with_archive = self.folder != Folder::Archive;
        let toolbar = div()
            .flex()
            .items_center()
            .gap_1()
            .h(px(TITLE_BAR))
            .flex_none()
            .px_4()
            .when(leaves_with_archive, |el| {
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
            });
        let content: AnyElement = match self.reading.get(&thread.id) {
            None | Some(Reading::Loading) => div()
                .p_6()
                .text_sm()
                .text_color(theme::faint())
                .child("Laden…")
                .into_any_element(),
            Some(Reading::Failed(error)) => div()
                .p_6()
                .text_sm()
                .text_color(theme::danger())
                .child(error.clone())
                .into_any_element(),
            Some(Reading::Ready(messages)) => div()
                .flex()
                .flex_col()
                .gap_3()
                .px_6()
                .pb_8()
                .children(messages.iter().enumerate().map(|(i, message)| message_card(i, message)))
                .into_any_element(),
        };
        shell.child(toolbar).child(
            div()
                .id(SharedString::from(format!("reader-{}", thread.id)))
                .flex_1()
                .overflow_y_scroll()
                .child(
                    div()
                        .px_6()
                        .pt_1()
                        .pb_4()
                        .text_xl()
                        .font_weight(FontWeight::SEMIBOLD)
                        .child(if thread.subject.is_empty() { "(geen onderwerp)".to_string() } else { thread.subject.clone() }),
                )
                .child(content),
        )
    }
}

impl Focusable for MailView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

impl Render for MailView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
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
            .on_action(cx.listener(|this, _: &ToggleStar, _, cx| {
                let starred = this.position().map(|i| this.threads[i].is_starred);
                if let Some(starred) = starred {
                    this.act(if starred { Action::Unstar } else { Action::Star }, cx)
                }
            }))
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
            .child(self.render_reader(cx))
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

fn message_card(index: usize, message: &ShownMessage) -> impl IntoElement {
    div()
        .id(index)
        .flex()
        .flex_col()
        .gap_3()
        .p_4()
        .rounded_lg()
        .border_1()
        .border_color(theme::border())
        .child(
            div()
                .flex()
                .items_start()
                .justify_between()
                .gap_4()
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .min_w_0()
                        .child(div().text_sm().font_weight(FontWeight::SEMIBOLD).child(message.from.clone()))
                        .child(div().text_xs().text_color(theme::muted()).truncate().child(message.to.clone())),
                )
                .child(div().flex_none().text_xs().text_color(theme::muted()).child(message.date.clone())),
        )
        .child(div().text_sm().line_height(rems(1.45)).child(message.body.clone()))
        .when(!message.attachments.is_empty(), |el| {
            el.child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap_2()
                    .children(message.attachments.iter().map(|name| {
                        div()
                            .px_2()
                            .py_1()
                            .rounded_md()
                            .bg(theme::accent())
                            .text_xs()
                            .text_color(theme::muted())
                            .child(name.clone())
                    })),
            )
        })
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

/// Plain text keeps every mail readable and fast; HTML is turned into text with its links kept.
fn shown(message: &Message) -> ShownMessage {
    let text = message.text.as_deref().map(str::trim).filter(|text| !text.is_empty());
    let body = match (text, message.html.as_deref()) {
        (Some(text), _) => text.to_string(),
        (None, Some(html)) => html2text::from_read(html.as_bytes(), 100).unwrap_or_default(),
        (None, None) => String::new(),
    };
    let to: Vec<&str> = message.to.iter().chain(&message.cc).map(|a| a.label()).collect();
    ShownMessage {
        from: message.from.as_ref().map(|a| a.label().to_string()).unwrap_or_else(|| "Onbekend".into()).into(),
        to: if to.is_empty() { SharedString::default() } else { format!("Aan {}", to.join(", ")).into() },
        date: long_date(message.received_at).into(),
        body: tidy(&body).into(),
        attachments: message.attachments.iter().map(|a| format!("{} · {}", a.name, size(a.size)).into()).collect(),
    }
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
