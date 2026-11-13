//! Even doen (apps/todo-web): the workspaces, their lists and boards. The
//! state and what changes it live here (hooks/use-workspace.ts and
//! pages/home.tsx on the web); each screen draws in its own module, named
//! after the web file it ports.

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures::channel::mpsc::unbounded;
use futures::StreamExt as _;
use gpui_kit::component::input::{InputEvent, InputState};
use gpui_kit::prelude::*;
use gpui_kit::*;

use crate::api::{ApiError, Client, Unauthorized, User};
use crate::app::{AppEvent, EvenApp, SettingsPage};
use crate::i18n::t;
use crate::{prefs, theme, ui};

mod api;
mod board;
mod core;
mod dashboard;
mod description;
mod dialogs;
mod issue;
mod kit;
mod lists;
mod menus;
mod overlay;
mod settings;
mod sidebar;

use api::{Command, ListKind, Placement, StatusCategory, Todo, TodoList, WorkspaceData, WorkspaceMembers, WorkspaceSummary};
use kit::Tracked;
use overlay::{MenuKind, OpenMenu};

actions!(
    todo,
    [
        /// ⌘K: the list spotlight.
        Spotlight,
        /// Escape, where a menu or dialog is open.
        Dismiss,
        MenuUp,
        MenuDown,
        MenuConfirm,
        /// ⌘↵ in the new issue dialog.
        SubmitIssue,
        /// ⌥↑ and ⌥↓: the open list one place up or down in the sidebar.
        MoveListUp,
        MoveListDown,
        /// ⌘R, as the sync button.
        Refresh
    ]
);

pub fn bind_keys(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("cmd-k", Spotlight, Some("Todo")),
        KeyBinding::new("cmd-r", Refresh, Some("Todo")),
        KeyBinding::new("alt-up", MoveListUp, Some("Todo && !Input")),
        KeyBinding::new("alt-down", MoveListDown, Some("Todo && !Input")),
        KeyBinding::new("escape", Dismiss, Some("TodoOverlay && !Input")),
        KeyBinding::new("up", MenuUp, Some("TodoMenu")),
        KeyBinding::new("down", MenuDown, Some("TodoMenu")),
        KeyBinding::new("enter", MenuConfirm, Some("TodoMenu")),
        KeyBinding::new("cmd-enter", SubmitIssue, Some("TodoNewIssue")),
    ]);
}

/// The web keeps the open workspace in localStorage under this name.
const WORKSPACE_PREF: &str = "evido.todo.workspace";

/// How the realtime line is doing (the web's Ably connection state).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Connection {
    Connecting,
    Connected,
    /// The API has no realtime provider: the lists reload every minute.
    Polling,
    Disconnected,
}

/// What comes off the realtime thread.
enum Live {
    Connected(bool),
    Changed,
}

/// Which window part draws an overlay: the app's own screen, or its pages in
/// the settings window. Only one of them shows a given menu or dialog.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Surface {
    App,
    Settings,
}

/// A name being edited in place (components/inline-name.tsx).
struct Rename {
    target: RenameTarget,
    input: Entity<InputState>,
    max: usize,
    error: Option<SharedString>,
    _events: Subscription,
}

#[derive(Clone, PartialEq, Eq)]
enum RenameTarget {
    List(String),
    Todo(String),
}

/// What is being dragged. The values travel with GPUI's drag.
#[derive(Clone)]
struct DragTodo {
    id: String,
    title: SharedString,
}
#[derive(Clone)]
struct DragList {
    id: String,
    name: SharedString,
}
#[derive(Clone)]
struct DragIssue {
    id: String,
    title: SharedString,
}

/// The row that follows the pointer while something is dragged.
struct DragPreview {
    label: SharedString,
    width: Pixels,
}

impl Render for DragPreview {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
            .w(self.width)
            .px(px(12.))
            .py(px(8.))
            .rounded(theme::RADIUS)
            .bg(theme::card())
            .border_1()
            .border_color(theme::border())
            .shadow_lg()
            .font_family(theme::FONT)
            .text_size(px(14.))
            .text_color(theme::foreground())
            .child(div().truncate().child(self.label.clone()))
    }
}

/// Where a dragged issue would land (board-view.tsx `Drop`).
#[derive(Clone, PartialEq, Eq)]
struct IssueDrop {
    status_id: String,
    target_id: Option<String>,
    placement: Option<Placement>,
}

type After = Box<dyn FnOnce(&mut TodoApp, bool, &mut Window, &mut Context<TodoApp>)>;

pub struct TodoApp {
    client: Client,
    user: User,
    focus: FocusHandle,
    /// The keyboard's place while a dialog without a field is open, so Escape reaches it.
    overlay_focus: FocusHandle,

    // pages/home.tsx: the workspaces, then the open one's data.
    workspaces: Option<Vec<WorkspaceSummary>>,
    load_failed: bool,
    active_id: Option<String>,
    /// The workspace as the server last gave it.
    server: Option<WorkspaceData>,
    /// Changes not saved yet, shown on top of `server` (use-workspace.ts `queued`).
    queued: VecDeque<(Command, Option<After>)>,
    /// `server` with the queue applied: what every screen reads.
    data: WorkspaceData,
    saving: bool,
    /// The last reload failed: the lists shown are the last ones loaded.
    error: bool,
    connection: Connection,
    /// Bumped when the workspace changes, so answers for the old one are dropped.
    generation: u64,
    members: Option<WorkspaceMembers>,
    members_error: Option<SharedString>,

    // components/workspace-app.tsx
    /// The open list; `None` is the overview.
    selected_id: Option<String>,
    task_input: Entity<InputState>,
    renaming: Option<Rename>,
    /// The simple list's rows while one is dragged, in the order shown.
    todo_order: sidebar::DraftOrder,
    list_order: sidebar::DraftOrder,
    dialog: Option<dialogs::Dialog>,

    // components/board
    board: board::BoardState,
    issue: Option<issue::IssueView>,
    issue_drop: Option<IssueDrop>,
    /// The card being dragged, shown faded where it came from.
    dragged_issue: Option<String>,
    card_bounds: HashMap<String, Bounds<Pixels>>,

    // Menus (overlay.rs)
    menu: Option<OpenMenu>,
    /// A menu closed by the press that is about to click its own button again.
    menu_dismissed: Option<(SharedString, Instant)>,
    tracked: Tracked,

    // components/settings
    settings: settings::SettingsState,

    stop: Arc<AtomicBool>,
    _tasks: Vec<Task<()>>,
    _subscriptions: Vec<Subscription>,
}

impl Drop for TodoApp {
    fn drop(&mut self) {
        // Lets the realtime thread end.
        self.stop.store(true, Ordering::Relaxed);
    }
}

impl TodoApp {
    pub fn new(client: Client, user: User, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let task_input = cx.new(|cx| InputState::new(window, cx).placeholder(t("What do you want to do?", "Wat wil je doen?")));
        let composer = cx.subscribe_in(&task_input, window, |this, _, event: &InputEvent, window, cx| match event {
            InputEvent::PressEnter { .. } => this.add_task(window, cx),
            // The add button follows whether there is text.
            InputEvent::Change => cx.notify(),
            _ => {}
        });
        // Back at the window: what changed meanwhile (the web's refetchOnWindowFocus).
        let activation = cx.observe_window_activation(window, |this, window, cx| {
            if window.is_window_active() {
                this.refresh_quietly(cx);
            }
        });
        // The web reloads every minute, also when realtime is on.
        let poll = cx.spawn(async move |this, cx| loop {
            cx.background_executor().timer(Duration::from_secs(60)).await;
            if this.update(cx, |this, cx| this.refresh_quietly(cx)).is_err() {
                break;
            }
        });
        let stop = Arc::new(AtomicBool::new(false));
        let live = Self::listen(&client, &user, stop.clone(), cx);
        let settings = settings::SettingsState::new(window, cx);
        let mut app = Self {
            client,
            user,
            focus: cx.focus_handle(),
            overlay_focus: cx.focus_handle(),
            workspaces: None,
            load_failed: false,
            active_id: prefs::get(WORKSPACE_PREF),
            server: None,
            queued: VecDeque::new(),
            data: WorkspaceData::default(),
            saving: false,
            error: false,
            connection: Connection::Connecting,
            generation: 0,
            members: None,
            members_error: None,
            selected_id: None,
            task_input,
            renaming: None,
            todo_order: None,
            list_order: None,
            dialog: None,
            board: board::BoardState::default(),
            issue: None,
            issue_drop: None,
            dragged_issue: None,
            card_bounds: HashMap::new(),
            menu: None,
            menu_dismissed: None,
            tracked: Tracked::default(),
            settings,
            stop,
            _tasks: vec![poll, live],
            _subscriptions: vec![composer, activation],
        };
        app.load_workspaces(window, cx);
        app
    }

    /// The user's own realtime channel, on a thread of its own: it blocks on
    /// the stream for as long as the app runs.
    fn listen(client: &Client, user: &User, stop: Arc<AtomicBool>, cx: &mut Context<Self>) -> Task<()> {
        let (send, mut received) = unbounded::<Option<Live>>();
        let client = client.clone();
        let user_id = user.id.clone();
        std::thread::spawn(move || {
            if !api::realtime_enabled(&client) {
                let _ = send.unbounded_send(None);
                return;
            }
            let connected = send.clone();
            api::listen(
                &client,
                &user_id,
                stop,
                move |up| {
                    let _ = connected.unbounded_send(Some(Live::Connected(up)));
                },
                move || {
                    let _ = send.unbounded_send(Some(Live::Changed));
                },
            );
        });
        cx.spawn(async move |this, cx| {
            while let Some(message) = received.next().await {
                let updated = this.update(cx, |this, cx| {
                    match message {
                        None => this.connection = Connection::Polling,
                        Some(Live::Connected(true)) => this.connection = Connection::Connected,
                        Some(Live::Connected(false)) => this.connection = Connection::Disconnected,
                        // Membership changes (invites, removals, renames) arrive on the same channel.
                        Some(Live::Changed) => this.refresh_quietly(cx),
                    }
                    cx.notify();
                });
                if updated.is_err() {
                    break;
                }
            }
        })
    }

    /// An API error: a lapsed session signs out, anything else is said in words.
    fn message(&mut self, error: &anyhow::Error, cx: &mut Context<Self>) -> SharedString {
        if error.is::<Unauthorized>() {
            cx.emit(AppEvent::SignedOut);
            return t("Please sign in again.", "Log opnieuw in.").into();
        }
        match error.downcast_ref::<ApiError>() {
            Some(api) => api.message.clone().into(),
            None => t("No connection. Please try again.", "Geen verbinding. Probeer het opnieuw.").into(),
        }
    }

    // ─── Loading ────────────────────────────────────────────────────────────

    fn load_workspaces(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.load_failed = false;
        let client = self.client.clone();
        let task = cx.background_executor().spawn(async move { api::workspaces(&client) });
        cx.spawn_in(window, async move |this, cx| {
            let result = task.await;
            let _ = this.update_in(cx, |this, window, cx| match result {
                Ok(workspaces) => {
                    this.set_workspaces(workspaces, cx);
                    this.load_workspace(true, window, cx);
                }
                Err(error) => {
                    this.message(&error, cx);
                    this.load_failed = true;
                    cx.notify();
                }
            });
        })
        .detach();
        cx.notify();
    }

    /// lib/workspaces.ts `useActiveWorkspace`: the remembered one, else the first.
    fn set_workspaces(&mut self, workspaces: Vec<WorkspaceSummary>, cx: &mut Context<Self>) {
        let known = self
            .active_id
            .as_ref()
            .is_some_and(|id| workspaces.iter().any(|workspace| &workspace.id == id));
        if !known {
            let first = workspaces.first().map(|workspace| workspace.id.clone());
            if first != self.active_id {
                self.active_id = first;
                self.generation += 1;
                self.server = None;
                self.members = None;
                self.queued.clear();
                self.selected_id = None;
                self.issue = None;
            }
        }
        self.workspaces = Some(workspaces);
        self.settings.sync_name = true;
        cx.notify();
    }

    fn active(&self) -> Option<&WorkspaceSummary> {
        let workspaces = self.workspaces.as_ref()?;
        workspaces
            .iter()
            .find(|workspace| Some(&workspace.id) == self.active_id.as_ref())
            .or(workspaces.first())
    }

    /// Switching goes back to the workspace's overview: lists belong to one workspace.
    fn select_workspace(&mut self, id: &str, window: &mut Window, cx: &mut Context<Self>) {
        if self.active_id.as_deref() == Some(id) {
            return;
        }
        prefs::set(WORKSPACE_PREF, id);
        self.active_id = Some(id.to_string());
        self.generation += 1;
        self.server = None;
        self.data = WorkspaceData::default();
        self.members = None;
        self.members_error = None;
        self.queued.clear();
        self.selected_id = None;
        self.issue = None;
        self.dialog = None;
        self.renaming = None;
        self.error = false;
        self.settings.sync_name = true;
        self.load_workspace(true, window, cx);
    }

    /// Reads the open workspace. `first`: nothing is on screen yet, so a
    /// failure is the whole page's (the web's PageError).
    fn load_workspace(&mut self, first: bool, window: &mut Window, cx: &mut Context<Self>) {
        let Some(id) = self.active().map(|workspace| workspace.id.clone()) else { return };
        let generation = self.generation;
        let client = self.client.clone();
        let task = cx.background_executor().spawn(async move { api::workspace(&client, &id) });
        cx.spawn_in(window, async move |this, cx| {
            let result = task.await;
            let _ = this.update_in(cx, |this, window, cx| {
                if this.generation != generation {
                    return;
                }
                match result {
                    Ok(data) => {
                        let opening = this.server.is_none();
                        this.error = false;
                        this.server = Some(data);
                        this.rebuild();
                        if opening {
                            this.debug_show(window, cx);
                        }
                    }
                    Err(error) => this.load_error(first, error, window, cx),
                }
                cx.notify();
            });
        })
        .detach();
        self.load_members(cx);
        cx.notify();
    }

    fn load_error(&mut self, first: bool, error: anyhow::Error, window: &mut Window, cx: &mut Context<Self>) {
        // Removed from this workspace: the list of workspaces falls back to another.
        let gone = error.downcast_ref::<ApiError>().is_some_and(|api| api.status == 404);
        let message = self.message(&error, cx);
        if gone {
            ui::toast_error(
                t("You no longer have access to this workspace.", "Je hebt geen toegang meer tot deze workspace."),
                window,
                cx,
            );
            self.active_id = None;
            prefs::remove(WORKSPACE_PREF);
            self.load_workspaces(window, cx);
        } else if first {
            let _ = message;
            self.load_failed = true;
        } else {
            self.error = true;
        }
    }

    /// The minute's check, the window coming back, a realtime message: reload
    /// without touching what is on screen until the answer is there.
    fn refresh_quietly(&mut self, cx: &mut Context<Self>) {
        // Earlier reloads would briefly drop changes that are still waiting to be saved.
        if self.server.is_none() || !self.queued.is_empty() {
            return;
        }
        let Some(id) = self.active().map(|workspace| workspace.id.clone()) else { return };
        let generation = self.generation;
        let client = self.client.clone();
        let task = cx.background_executor().spawn(async move {
            let workspaces = api::workspaces(&client);
            let data = api::workspace(&client, &id);
            (workspaces, data)
        });
        cx.spawn(async move |this, cx| {
            let (workspaces, data) = task.await;
            let _ = this.update(cx, |this, cx| {
                if this.generation != generation {
                    return;
                }
                if let Ok(workspaces) = workspaces {
                    this.set_workspaces(workspaces, cx);
                }
                if this.generation != generation {
                    return;
                }
                match data {
                    Ok(data) => {
                        this.error = false;
                        if this.queued.is_empty() {
                            this.server = Some(data);
                            this.rebuild();
                        }
                    }
                    Err(error) => {
                        if error.is::<Unauthorized>() {
                            cx.emit(AppEvent::SignedOut);
                        }
                        this.error = true;
                    }
                }
                cx.notify();
            });
        })
        .detach();
        self.load_members(cx);
    }

    /// The sync button: the same reload, said out loud when it fails.
    fn refresh(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.server.is_none() {
            self.load_workspaces(window, cx);
        } else {
            self.refresh_quietly(cx);
        }
    }

    /// lib/workspaces.ts `useWorkspaceMembers`: for the overview and the settings.
    fn load_members(&mut self, cx: &mut Context<Self>) {
        let Some(id) = self.active().map(|workspace| workspace.id.clone()) else { return };
        let generation = self.generation;
        let client = self.client.clone();
        let task = cx.background_executor().spawn(async move { api::members(&client, &id) });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |this, cx| {
                if this.generation != generation {
                    return;
                }
                match result {
                    Ok(members) => {
                        this.members = Some(members);
                        this.members_error = None;
                    }
                    Err(error) => this.members_error = Some(this.message(&error, cx)),
                }
                cx.notify();
            });
        })
        .detach();
    }

    // ─── Changing (hooks/use-workspace.ts `run`) ────────────────────────────

    /// `server` with every unsaved change on top.
    fn rebuild(&mut self) {
        let mut data = self.server.clone().unwrap_or_default();
        for (command, _) in &self.queued {
            core::optimistic_update(&mut data, command);
        }
        self.data = data;
    }

    /// Shows the change at once and saves it in the background. Changes reach
    /// the server one by one and in order (a new list before the tasks in it).
    fn run(&mut self, command: Command, window: &mut Window, cx: &mut Context<Self>) {
        self.run_then(command, None, window, cx);
    }

    /// As `run`; `after` hears whether the server took it.
    fn run_then(&mut self, command: Command, after: Option<After>, window: &mut Window, cx: &mut Context<Self>) {
        core::optimistic_update(&mut self.data, &command);
        self.queued.push_back((command, after));
        if !self.saving {
            self.save_next(window, cx);
        }
        cx.notify();
    }

    fn save_next(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some((command, _)) = self.queued.front() else {
            self.saving = false;
            // Reload once the queue is empty.
            self.refresh_quietly(cx);
            return;
        };
        self.saving = true;
        let generation = self.generation;
        let command = command.clone();
        let client = self.client.clone();
        let task = cx.background_executor().spawn(async move {
            let result = api::run(&client, &command);
            (command, result)
        });
        cx.spawn_in(window, async move |this, cx| {
            let (command, result) = task.await;
            let _ = this.update_in(cx, |this, window, cx| {
                if this.generation != generation {
                    this.saving = false;
                    return;
                }
                let after = this.queued.pop_front().and_then(|(_, after)| after);
                let saved = result.is_ok();
                match result {
                    // Saved: keep showing it, in the server's data now.
                    Ok(()) => {
                        if let Some(server) = &mut this.server {
                            core::optimistic_update(server, &command);
                        }
                    }
                    Err(error) => {
                        let message = this.message(&error, cx);
                        ui::toast_error(message, window, cx);
                    }
                }
                this.rebuild();
                if let Some(after) = after {
                    after(this, saved, window, cx);
                }
                this.save_next(window, cx);
                cx.notify();
            });
        })
        .detach();
    }

    // ─── What the screens ask ───────────────────────────────────────────────

    /// The lists Even doen shows: notes live in Even noteren.
    fn lists(&self) -> Vec<TodoList> {
        core::shown_lists(&self.data)
    }

    /// The open list: the chosen one, else the first (after a delete).
    fn selected(&self) -> Option<TodoList> {
        let id = self.selected_id.as_ref()?;
        let lists = self.lists();
        lists.iter().find(|list| &list.id == id).or(lists.first()).cloned()
    }

    fn show_overview(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.selected_id = None;
        self.close_issue(window, cx);
        self.renaming = None;
        self.task_input.update(cx, |input, cx| input.set_value("", window, cx));
        cx.notify();
    }

    fn select_list(&mut self, id: &str, window: &mut Window, cx: &mut Context<Self>) {
        if self.selected().map(|list| list.id).as_deref() != Some(id) || self.selected_id.is_none() {
            self.selected_id = Some(id.to_string());
            self.close_issue(window, cx);
            self.board.reset_filters();
        }
        self.renaming = None;
        self.task_input.update(cx, |input, cx| input.set_value("", window, cx));
        cx.notify();
    }

    fn todos_of(&self, list_id: &str) -> Vec<Todo> {
        self.data.todos.iter().filter(|todo| todo.list_id == list_id).cloned().collect()
    }

    /// The open tasks a sidebar row counts: not done, and no sub-issues.
    fn open_count(&self, list_id: &str) -> usize {
        self.data
            .todos
            .iter()
            .filter(|todo| todo.list_id == list_id && !todo.completed && todo.parent_id.is_none())
            .count()
    }

    // ─── components/inline-name.tsx ─────────────────────────────────────────

    fn start_rename(&mut self, target: RenameTarget, value: &str, max: usize, window: &mut Window, cx: &mut Context<Self>) {
        let input = cx.new(|cx| InputState::new(window, cx).default_value(value.to_string()));
        let events = cx.subscribe_in(&input, window, |this, _, event: &InputEvent, window, cx| match event {
            InputEvent::PressEnter { .. } | InputEvent::Blur => this.finish_rename(window, cx),
            InputEvent::Change => {
                if let Some(rename) = &mut this.renaming {
                    rename.error = None;
                    cx.notify();
                }
            }
            _ => {}
        });
        input.update(cx, |input, cx| {
            input.focus(window, cx);
            input.select_all(window, cx);
        });
        self.renaming = Some(Rename {
            target,
            input,
            max,
            error: None,
            _events: events,
        });
        cx.notify();
    }

    fn finish_rename(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(rename) = &mut self.renaming else { return };
        let text = rename.input.read(cx).value().split_whitespace().collect::<Vec<_>>().join(" ");
        if text.chars().count() > rename.max {
            rename.error = Some(t(
                format!("Use at most {} characters.", rename.max),
                format!("Gebruik maximaal {} tekens.", rename.max),
            ).into());
            cx.notify();
            return;
        }
        if text.is_empty() {
            rename.error = Some(t("Enter a name.", "Vul een naam in.").into());
            cx.notify();
            return;
        }
        let target = rename.target.clone();
        self.renaming = None;
        match target {
            RenameTarget::List(id) => {
                if self.data.lists.iter().any(|list| list.id == id && list.name != text) {
                    self.run(Command::RenameList { id, name: text }, window, cx);
                }
            }
            RenameTarget::Todo(id) => {
                if self.data.todos.iter().any(|todo| todo.id == id && todo.title != text) {
                    self.run(
                        Command::UpdateTodo {
                            id,
                            title: Some(text),
                            completed: None,
                            in_progress: None,
                        },
                        window,
                        cx,
                    );
                }
            }
        }
        window.focus(&self.focus, cx);
        cx.notify();
    }

    fn cancel_rename(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.renaming.take().is_some() {
            window.focus(&self.focus, cx);
            cx.notify();
        }
    }

    /// A run that only looks (scripts/shot.sh): `EVEN_TODO_SHOW` opens a
    /// screen without a click. Nothing here changes any data.
    fn debug_show(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Ok(show) = std::env::var("EVEN_TODO_SHOW") else { return };
        let lists = self.lists();
        let first = |kind: ListKind| lists.iter().find(|list| list.kind == kind).map(|list| list.id.clone());
        let mut parts = show.split(',');
        match parts.next().unwrap_or("") {
            "list" => {
                if let Some(id) = first(ListKind::Todo) {
                    self.select_list(&id, window, cx);
                }
            }
            "board" | "board-list" | "issue" | "new-issue" => {
                if let Some(id) = first(ListKind::Board) {
                    self.select_list(&id, window, cx);
                    self.board.open(&id);
                    if show.starts_with("board-list") {
                        self.board.view = board::View::List;
                    }
                    if show.starts_with("issue") {
                        let issue = self
                            .data
                            .todos
                            .iter()
                            .find(|todo| todo.list_id == id && todo.parent_id.is_none())
                            .map(|todo| todo.id.clone());
                        if let Some(issue) = issue {
                            self.open_issue(&issue, window, cx);
                        }
                    }
                    if show.starts_with("new-issue") {
                        self.new_issue(None, window, cx);
                    }
                }
            }
            "new-list" => self.new_list(ListKind::Todo, window, cx),
            "spotlight" => self.open_spotlight(window, cx),
            "share" => {
                if let Some(id) = first(ListKind::Todo) {
                    self.select_list(&id, window, cx);
                    self.share_list(window, cx);
                }
            }
            "settings" => cx.emit(AppEvent::OpenSettings(parts.next().and_then(|page| {
                ["workspace", "members", "statuses", "projects", "connections"]
                    .into_iter()
                    .find(|known| *known == page)
            }))),
            _ => {}
        }
        if let Some(menu) = std::env::var("EVEN_TODO_MENU").ok().as_deref() {
            let (kind, anchor) = match menu {
                "workspace" => (MenuKind::Workspace, "workspace-switcher"),
                "list" => (MenuKind::ListOptions, "list-options"),
                "filter" => (MenuKind::Filter, "board-filter"),
                _ => return,
            };
            // After the first frame, once the button's place is known.
            cx.spawn_in(window, async move |this, cx| {
                cx.background_executor().timer(Duration::from_millis(600)).await;
                let _ = this.update_in(cx, |this, window, cx| {
                    this.open_menu(kind, anchor, window, cx);
                });
            })
            .detach();
        }
    }
}

impl EventEmitter<AppEvent> for TodoApp {}

impl EvenApp for TodoApp {
    fn settings_pages(&self, _cx: &App) -> Vec<SettingsPage> {
        settings::pages()
    }

    fn render_settings(&mut self, page: &str, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        self.render_settings_page(page, window, cx)
    }

    fn activated(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        // Keep the keyboard where it is when a dialog has it.
        if self.dialog.is_none() && self.issue.is_none() && self.renaming.is_none() {
            window.focus(&self.focus, cx);
        }
        self.refresh_quietly(cx);
    }

    fn set_covered(&mut self, covered: bool, _window: &mut Window, cx: &mut Context<Self>) {
        // A menu of the screen below would float over the settings.
        if covered && self.menu.as_ref().is_some_and(|menu| menu.surface == Surface::App) {
            self.menu = None;
            cx.notify();
        }
        if !covered {
            self.settings.dialog = None;
            if self.menu.as_ref().is_some_and(|menu| menu.surface == Surface::Settings) {
                self.menu = None;
            }
        }
    }
}

impl Render for TodoApp {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        // A drag that ended anywhere but on a row leaves its draft behind.
        if !cx.has_active_drag() {
            self.todo_order = None;
            self.list_order = None;
            self.issue_drop = None;
            self.dragged_issue = None;
        }
        let root = div()
            .id("todo")
            .key_context("Todo")
            .track_focus(&self.focus)
            .on_action(cx.listener(|this, _: &Spotlight, window, cx| this.toggle_spotlight(window, cx)))
            .on_action(cx.listener(|this, _: &Refresh, window, cx| this.refresh(window, cx)))
            .on_action(cx.listener(|this, _: &MoveListUp, window, cx| this.step_list(-1, window, cx)))
            .on_action(cx.listener(|this, _: &MoveListDown, window, cx| this.step_list(1, window, cx)))
            .relative()
            .flex()
            .size_full()
            .bg(theme::background())
            .text_color(theme::foreground());
        if self.load_failed {
            return root.child(self.render_page_error(cx));
        }
        if self.server.is_none() {
            return root.child(render_page_loading());
        }
        let overlays = self.render_overlays(Surface::App, window, cx);
        root.child(self.render_sidebar(window, cx))
            .child(self.render_main(window, cx))
            .children(overlays)
    }
}

/// components/page-loading.tsx.
fn render_page_loading() -> impl IntoElement {
    div().flex().flex_1().justify_center().child(
        div()
            .flex()
            .flex_col()
            .gap(px(24.))
            .w_full()
            .max_w(px(768.))
            .p(px(32.))
            .child(kit::skeleton().h(px(32.)).w(px(160.)))
            .child(kit::skeleton().h(px(40.)).w_full())
            .child(kit::skeleton().h(px(56.)).w_full())
            .child(kit::skeleton().h(px(56.)).w_full()),
    )
}

impl TodoApp {
    /// components/page-error.tsx.
    fn render_page_error(&self, cx: &mut Context<Self>) -> impl IntoElement {
        div().flex().flex_1().justify_center().child(
            div()
                .flex()
                .flex_col()
                .gap(px(20.))
                .w_full()
                .max_w(px(512.))
                .p(px(32.))
                .child(kit::alert(
                    Some(t("Your lists could not be loaded", "Je lijsten konden niet worden geladen").into()),
                    t(
                        "Please try again in a moment. Your saved tasks are safe.",
                        "Probeer het over een moment opnieuw. Je opgeslagen taken blijven bewaard.",
                    ),
                    true,
                ))
                .child(
                    ui::button("todo-retry", t("Try again", "Opnieuw proberen"), ui::Variant::Primary)
                        .on_click(cx.listener(|this, _, window, cx| this.load_workspaces(window, cx))),
                ),
        )
    }

    /// The pane beside the sidebar (workspace-app.tsx `<main>`): the sync
    /// status in its corner, then the overview, a list or a board.
    fn render_main(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let pending = !self.queued.is_empty();
        let status: SharedString = if self.error {
            t("Sync failed", "Synchroniseren mislukt")
        } else if pending {
            t("Saving…", "Opslaan…")
        } else {
            match self.connection {
                Connection::Connected => t("Synced", "Gesynchroniseerd"),
                Connection::Connecting => t("Connecting…", "Verbinden…"),
                _ => t("Synced periodically", "Periodiek gesynchroniseerd"),
            }
        }
        .into();
        let icon = if self.error {
            theme::hi("cloud-alert").text_color(theme::muted()).into_any_element()
        } else if pending {
            kit::spinning("refresh").into_any_element()
        } else if self.connection == Connection::Connecting {
            theme::hi("refresh").text_color(theme::muted()).into_any_element()
        } else {
            theme::hi("cloud-check").text_color(theme::muted()).into_any_element()
        };
        let sync = div()
            .id("sync-status")
            .absolute()
            .top(px(16.))
            .right(px(32.))
            .flex()
            .items_center()
            .gap(px(7.))
            .text_size(px(12.))
            .text_color(theme::muted())
            .hover(|el| el.text_color(theme::foreground()))
            .cursor_pointer()
            .child(icon)
            .child(status)
            .tooltip(ui::tip(t("Sync now", "Nu synchroniseren")))
            .on_click(cx.listener(|this, _, window, cx| this.refresh(window, cx)));

        let selected = self.selected();
        let content = if self.selected_id.is_none() {
            self.render_dashboard(window, cx).into_any_element()
        } else if let Some(list) = selected {
            if list.kind == ListKind::Board {
                self.render_board_page(&list, window, cx).into_any_element()
            } else {
                self.render_list_page(&list, window, cx).into_any_element()
            }
        } else {
            self.render_no_lists(cx).into_any_element()
        };
        div()
            .relative()
            .flex()
            .flex_col()
            .flex_1()
            .min_w_0()
            .h_full()
            .overflow_hidden()
            .child(content)
            .child(sync)
    }

    /// The alert above a page while the last reload failed.
    fn render_sync_alert(&self) -> Option<Div> {
        self.error.then(|| {
            kit::alert(
                Some(t("Syncing didn't work", "Synchroniseren is niet gelukt").into()),
                t(
                    "You're seeing the last loaded lists. Try syncing again.",
                    "Je ziet de laatst geladen lijsten. Probeer opnieuw te synchroniseren.",
                ),
                false,
            )
            .mb(px(24.))
        })
    }
}

/// The status categories' names (i18n board.ts `categories`).
fn category_name(category: StatusCategory) -> &'static str {
    match category {
        StatusCategory::Backlog => "Backlog",
        StatusCategory::Unstarted => t("Unstarted", "Niet gestart"),
        StatusCategory::Started => t("Started", "Gestart"),
        StatusCategory::Completed => t("Completed", "Afgerond"),
        StatusCategory::Canceled => t("Canceled", "Geannuleerd"),
    }
}

/// i18n board.ts `priority.name`.
fn priority_name(priority: u8) -> &'static str {
    match priority {
        1 => "Urgent",
        2 => t("High", "Hoog"),
        3 => t("Medium", "Gemiddeld"),
        4 => t("Low", "Laag"),
        _ => t("No priority", "Geen prioriteit"),
    }
}
