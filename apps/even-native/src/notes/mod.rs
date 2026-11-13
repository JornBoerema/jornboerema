//! Even noteren (apps/notes-web): the notes of a workspace. A note is one of
//! the workspace's lists, of kind "note"; the task lists and boards of the
//! same workspaces are Even doen's.
//!
//! The state and what it does live here, as the web's pages/home.tsx,
//! lib/workspaces.ts and hooks/use-workspace.ts hold them: which workspace,
//! its notes, the changes still on their way to the server, and word from the
//! server that something changed. Each part of the screen draws in its own file.

use std::time::{Duration, Instant};

use futures::StreamExt as _;
use gpui_kit::component::input::{Escape, InputState};
use gpui_kit::prelude::*;
use gpui_kit::*;

use crate::api::{Client, User};
use crate::app::{AppEvent, EvenApp};
use crate::i18n::t;
use crate::{prefs, theme, ui};

mod api;
mod body;
mod note;
mod overlays;
mod page;
mod parts;
mod realtime;
mod sidebar;

use api::{Command, Failure, List, WorkspaceSummary};
use note::{Editor, Naming};
use overlays::Overlay;

actions!(notes, [Spotlight, NoteUp, NoteDown, Dismiss]);

pub fn bind_keys(cx: &mut App) {
    cx.bind_keys([
        // list-spotlight.tsx: ⌘K jumps to a note.
        KeyBinding::new("cmd-k", Spotlight, Some("Notes")),
        // sortable.tsx: ⌥↑ and ⌥↓ move the open note in the sidebar.
        KeyBinding::new("alt-up", NoteUp, Some("Notes && !Input")),
        KeyBinding::new("alt-down", NoteDown, Some("Notes && !Input")),
        KeyBinding::new("escape", Dismiss, Some("Notes && !Input")),
    ]);
}

/// The web's localStorage key (lib/workspaces.ts). Even doen reads the same
/// one, so both apps open the workspace chosen last, as in the Tauri app.
const WORKSPACE_PREF: &str = "evido.todo.workspace";

/// pages/home.tsx: nothing shows until the workspaces and the open one's notes are in.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Load {
    Loading,
    Failed,
    Ready,
}

/// How changes from elsewhere arrive (`connection` in use-workspace.ts).
#[derive(Clone, Copy, PartialEq, Eq)]
enum Connection {
    Connecting,
    Connected,
    /// No push: the notes are asked for every minute.
    Polling,
}

/// Where the main pane goes: the overview or a note.
#[derive(Clone, PartialEq, Eq)]
enum Nav {
    Overview,
    Note(String),
}

/// A change made on screen and not yet saved.
struct Queued {
    seq: u64,
    workspace: String,
    command: Command,
}

/// The one menu that may be open.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Menu {
    Workspaces,
    NoteOptions,
    LinkRole,
}

pub struct NotesApp {
    client: Client,
    user: User,
    focus: FocusHandle,
    load: Load,
    workspaces: Vec<WorkspaceSummary>,
    active: Option<String>,
    /// The open workspace's lists as the server last gave them.
    lists: Vec<List>,
    /// Its notes with the unsaved changes on top: what the screen shows.
    view: Vec<List>,
    /// Changes reach the server one by one and in order.
    queue: Vec<Queued>,
    seq: u64,
    sending: bool,
    /// Bumped on every fetch, so an older answer never replaces a newer one.
    generation: u64,
    /// The open note; `None` is the overview.
    selected: Option<String>,
    editor: Option<Editor>,
    /// The open note's title while it is being renamed.
    naming: Option<Naming>,
    overlay: Option<Overlay>,
    menu: Option<Menu>,
    /// When a click outside closed the menu: the same click on its button must not reopen it.
    menu_closed: Instant,
    /// The API was reached the last time it was asked (the web's `navigator.onLine`).
    online: bool,
    /// The last fetch of the notes failed; what shows is the last loaded.
    sync_error: bool,
    connection: Connection,
    realtime: Option<realtime::Realtime>,
    _realtime: Option<Task<()>>,
    _poll: Task<()>,
    _activation: Subscription,
}

impl NotesApp {
    pub fn new(client: Client, user: User, window: &mut Window, cx: &mut Context<Self>) -> Self {
        // use-workspace.ts: `refetchInterval: 60000`, and once offline, often enough to notice the way back.
        let poll = cx.spawn_in(window, async move |this, cx| loop {
            let wait = this
                .update(cx, |this, _| if this.online { 60 } else { 5 })
                .unwrap_or(60);
            cx.background_executor().timer(Duration::from_secs(wait)).await;
            if this.update_in(cx, |this, window, cx| this.tick(window, cx)).is_err() {
                break;
            }
        });
        // `refetchOnWindowFocus: "always"`.
        let activation = cx.observe_window_activation(window, |this, window, cx| {
            if window.is_window_active() && this.load == Load::Ready {
                this.fetch(window, cx);
            }
        });
        let mut app = Self {
            client,
            user,
            focus: cx.focus_handle(),
            load: Load::Loading,
            workspaces: Vec::new(),
            active: None,
            lists: Vec::new(),
            view: Vec::new(),
            queue: Vec::new(),
            seq: 0,
            sending: false,
            generation: 0,
            selected: None,
            editor: None,
            naming: None,
            overlay: None,
            menu: None,
            menu_closed: Instant::now(),
            online: true,
            sync_error: false,
            connection: Connection::Polling,
            realtime: None,
            _realtime: None,
            _poll: poll,
            _activation: activation,
        };
        app.start(window, cx);
        app
    }

    // Loading.

    /// The workspaces and whether the API pushes changes; then the notes.
    fn start(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.load = Load::Loading;
        let client = self.client.clone();
        let task = cx.background_executor().spawn(async move {
            let workspaces = api::workspaces(&client)?;
            let realtime = api::realtime_enabled(&client).unwrap_or(false);
            anyhow::Ok((workspaces, realtime))
        });
        cx.spawn_in(window, async move |this, cx| {
            let result = task.await;
            let _ = this.update_in(cx, |this, window, cx| {
                match result {
                    Ok((workspaces, realtime)) => {
                        this.online = true;
                        if realtime && this.realtime.is_none() {
                            this.listen(window, cx);
                        }
                        this.set_workspaces(workspaces, window, cx);
                    }
                    Err(error) => match api::failure(&error) {
                        Failure::SignedOut => cx.emit(AppEvent::SignedOut),
                        failure => {
                            this.online = !matches!(failure, Failure::Offline);
                            this.load = Load::Failed;
                        }
                    },
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }

    /// `useActiveWorkspace`: the one remembered, else the first.
    fn set_workspaces(&mut self, workspaces: Vec<WorkspaceSummary>, window: &mut Window, cx: &mut Context<Self>) {
        self.workspaces = workspaces;
        let wanted = prefs::get(WORKSPACE_PREF);
        let active = self
            .workspaces
            .iter()
            .find(|workspace| Some(&workspace.id) == wanted.as_ref())
            .or(self.workspaces.first())
            .map(|workspace| workspace.id.clone());
        match active {
            None => self.load = Load::Failed,
            Some(id) if self.active.as_ref() != Some(&id) => self.open_workspace(id, window, cx),
            Some(_) if self.load != Load::Ready => self.fetch(window, cx),
            Some(_) => {}
        }
        cx.notify();
    }

    fn reload_workspaces(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let client = self.client.clone();
        let task = cx.background_executor().spawn(async move { api::workspaces(&client) });
        cx.spawn_in(window, async move |this, cx| {
            let result = task.await;
            let _ = this.update_in(cx, |this, window, cx| match result {
                Ok(workspaces) => this.set_workspaces(workspaces, window, cx),
                Err(error) => {
                    if matches!(api::failure(&error), Failure::SignedOut) {
                        cx.emit(AppEvent::SignedOut)
                    }
                }
            });
        })
        .detach();
    }

    /// Another workspace: its overview, once its notes are in (home.tsx keys the app by workspace).
    fn open_workspace(&mut self, id: String, window: &mut Window, cx: &mut Context<Self>) {
        self.close_editor(cx);
        self.active = Some(id);
        self.selected = None;
        self.naming = None;
        self.overlay = None;
        self.menu = None;
        self.lists.clear();
        self.sync_error = false;
        self.recompute();
        self.load = Load::Loading;
        self.fetch(window, cx);
        cx.notify();
    }

    fn select_workspace(&mut self, id: String, window: &mut Window, cx: &mut Context<Self>) {
        prefs::set(WORKSPACE_PREF, &id);
        self.menu = None;
        if self.active.as_ref() != Some(&id) {
            self.open_workspace(id, window, cx);
        }
        cx.notify();
    }

    /// Asks for the open workspace's notes again.
    fn fetch(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(workspace) = self.active.clone() else { return };
        self.generation += 1;
        let generation = self.generation;
        let client = self.client.clone();
        let id = workspace.clone();
        let task = cx
            .background_executor()
            .spawn(async move { api::workspace(&client, &id) });
        cx.spawn_in(window, async move |this, cx| {
            let result = task.await;
            let _ = this.update_in(cx, |this, window, cx| {
                if this.generation != generation || this.active.as_ref() != Some(&workspace) {
                    return;
                }
                match result {
                    Ok(data) => {
                        this.lists = data.lists;
                        this.load = Load::Ready;
                        this.online = true;
                        this.sync_error = false;
                        this.recompute();
                        this.incoming(window, cx);
                        this.settle(window, cx);
                        #[cfg(debug_assertions)]
                        this.show_for_a_picture(window, cx);
                    }
                    Err(error) => this.fetch_failed(error, window, cx),
                }
                cx.notify();
            });
        })
        .detach();
    }

    fn fetch_failed(&mut self, error: anyhow::Error, window: &mut Window, cx: &mut Context<Self>) {
        match api::failure(&error) {
            Failure::SignedOut => return cx.emit(AppEvent::SignedOut),
            Failure::Offline => self.online = false,
            // Removed from this workspace: the list again, so the app falls back to another.
            Failure::Gone(_) => {
                ui::toast_error(
                    t(
                        "You no longer have access to this workspace.",
                        "Je hebt geen toegang meer tot deze workspace.",
                    ),
                    window,
                    cx,
                );
                self.sync_error = true;
                self.reload_workspaces(window, cx);
            }
            _ => self.sync_error = true,
        }
        if self.load != Load::Ready {
            self.load = Load::Failed;
        }
    }

    /// Every minute (every few seconds while offline).
    fn tick(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.load == Load::Ready {
            self.fetch(window, cx);
        }
        // The overview's greeting follows the clock.
        cx.notify();
    }

    /// The web's realtime effect: on word of a change, and on every (re)connect,
    /// ask again for the notes and for the workspaces (members come and go on
    /// the same channel).
    fn listen(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let (handle, mut signals) = realtime::start(self.client.clone(), self.user.id.clone());
        self.connection = Connection::Connecting;
        self.realtime = Some(handle);
        self._realtime = Some(cx.spawn_in(window, async move |this, cx| {
            while let Some(signal) = signals.next().await {
                let alive = this.update_in(cx, |this, window, cx| {
                    match signal {
                        realtime::Signal::Connected => this.connection = Connection::Connected,
                        realtime::Signal::Disconnected => this.connection = Connection::Polling,
                        realtime::Signal::Changed => {}
                    }
                    if signal != realtime::Signal::Disconnected && this.load == Load::Ready {
                        this.fetch(window, cx);
                        this.reload_workspaces(window, cx);
                    }
                    cx.notify();
                });
                if alive.is_err() {
                    break;
                }
            }
        }));
    }

    // Changes.

    /// The notes as the screen shows them: the server's, with what is still unsaved on top.
    fn recompute(&mut self) {
        let mut lists = self.lists.clone();
        for queued in &self.queue {
            if Some(&queued.workspace) == self.active.as_ref() {
                api::apply(&mut lists, &queued.command);
            }
        }
        lists.retain(List::is_note);
        self.view = lists;
    }

    /// `run` in use-workspace.ts: shows the change at once and saves it in the
    /// background. Gives the change's number, to hear how it went
    /// (`command_finished`), or nothing when offline.
    fn run(&mut self, command: Command, window: &mut Window, cx: &mut Context<Self>) -> Option<u64> {
        if !self.online {
            ui::toast_error(
                t(
                    "You're offline. Connect before making changes.",
                    "Je bent offline. Maak verbinding voordat je iets wijzigt.",
                ),
                window,
                cx,
            );
            return None;
        }
        let workspace = self.active.clone()?;
        self.seq += 1;
        self.queue.push(Queued {
            seq: self.seq,
            workspace,
            command,
        });
        self.recompute();
        self.pump(window, cx);
        cx.notify();
        Some(self.seq)
    }

    fn pump(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.sending {
            return;
        }
        let Some(next) = self.queue.first() else { return };
        self.sending = true;
        let (seq, workspace, command) = (next.seq, next.workspace.clone(), next.command.clone());
        let client = self.client.clone();
        let (to, sent) = (workspace.clone(), command.clone());
        let task = cx
            .background_executor()
            .spawn(async move { api::run(&client, &to, &sent) });
        cx.spawn_in(window, async move |this, cx| {
            let result = task.await;
            let _ = this.update_in(cx, |this, window, cx| {
                this.sending = false;
                this.queue.retain(|queued| queued.seq != seq);
                let ok = result.is_ok();
                match result {
                    // Saved: keep showing it by writing it into the server's data,
                    // so it never flickers back while the fetch below runs.
                    Ok(()) => {
                        this.online = true;
                        if this.active.as_ref() == Some(&workspace) {
                            api::apply(&mut this.lists, &command);
                        }
                    }
                    Err(error) => {
                        let no_connection =
                            || t("No connection. Please try again.", "Geen verbinding. Probeer het opnieuw.").to_string();
                        let message = match api::failure(&error) {
                            Failure::SignedOut => {
                                cx.emit(AppEvent::SignedOut);
                                t("Please sign in again.", "Log opnieuw in.").to_string()
                            }
                            Failure::Offline => {
                                this.online = false;
                                no_connection()
                            }
                            Failure::Gone(message) | Failure::Conflict(message) | Failure::Other(message) => {
                                message.unwrap_or_else(no_connection)
                            }
                        };
                        ui::toast_error(message, window, cx);
                    }
                }
                this.recompute();
                this.command_finished(seq, ok, window, cx);
                // Ask again once the queue is empty; earlier would briefly drop
                // changes that are still waiting to be saved.
                if this.queue.is_empty() {
                    this.fetch(window, cx);
                } else {
                    this.pump(window, cx);
                }
                this.settle(window, cx);
                cx.notify();
            });
        })
        .detach();
    }

    // Where the main pane is.

    /// Leaves the open note only once it is saved, as the web does: a draft
    /// that can't be saved keeps its note open.
    fn go(&mut self, nav: Nav, window: &mut Window, cx: &mut Context<Self>) {
        match &mut self.editor {
            Some(editor) => {
                editor.after_save = Some(nav);
                self.save(window, cx);
            }
            None => self.show(nav, window, cx),
        }
    }

    fn show(&mut self, nav: Nav, window: &mut Window, cx: &mut Context<Self>) {
        let selected = match nav {
            Nav::Overview => None,
            Nav::Note(id) => Some(id),
        };
        if self.selected != selected {
            self.selected = selected;
            self.naming = None;
            self.menu = None;
        }
        self.settle(window, cx);
        cx.notify();
    }

    /// Keeps the open note one that exists (a deleted one gives way to the
    /// first, or the overview) and the editor the open note's.
    fn settle(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(id) = &self.selected {
            if !self.view.iter().any(|note| note.id == *id) {
                self.selected = self.view.first().map(|note| note.id.clone());
                self.naming = None;
            }
        }
        if self.editor.as_ref().map(|editor| &editor.list_id) != self.selected.as_ref() {
            self.close_editor(cx);
            if let Some(id) = self.selected.clone() {
                self.open_editor(&id, window, cx);
            }
        }
    }

    fn selected_note(&self) -> Option<&List> {
        let id = self.selected.as_ref()?;
        self.view.iter().find(|note| note.id == *id)
    }

    /// Saving happens in the background; only being offline blocks editing.
    fn disabled(&self) -> bool {
        !self.online
    }

    fn active_workspace(&self) -> Option<&WorkspaceSummary> {
        let id = self.active.as_ref()?;
        self.workspaces.iter().find(|workspace| workspace.id == *id)
    }

    // Notes.

    fn create_note(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(Overlay::NewNote { input, .. }) = &self.overlay else { return };
        let name = input.read(cx).value().trim().to_string();
        let Some(workspace_id) = self.active.clone() else { return };
        if name.is_empty() || self.disabled() {
            return;
        }
        let id = api::new_id();
        self.run(
            Command::CreateList {
                id: id.clone(),
                workspace_id,
                name,
                kind: "note",
            },
            window,
            cx,
        );
        self.close_overlay(window, cx);
        self.go(Nav::Note(id), window, cx);
    }

    fn delete_note(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(Overlay::Delete { id, .. }) = &self.overlay else { return };
        let id = id.clone();
        self.close_overlay(window, cx);
        self.run(Command::DeleteList { id }, window, cx);
    }

    /// ⌥↑ and ⌥↓: the open note one place up or down among the notes.
    fn step_note(&mut self, by: isize, window: &mut Window, cx: &mut Context<Self>) {
        if self.disabled() || self.overlay.is_some() {
            return;
        }
        let Some(index) = self
            .selected
            .as_ref()
            .and_then(|id| self.view.iter().position(|note| note.id == *id))
        else {
            return;
        };
        let Some(target) = index.checked_add_signed(by).and_then(|target| self.view.get(target)) else {
            return;
        };
        let command = Command::MoveList {
            id: self.view[index].id.clone(),
            target_id: target.id.clone(),
            placement: if by < 0 {
                api::Placement::Before
            } else {
                api::Placement::After
            },
        };
        self.run(command, window, cx);
    }

    /// A note dragged onto another takes its place: after it when it came from above, else before.
    fn drop_note(&mut self, id: &str, target_id: &str, window: &mut Window, cx: &mut Context<Self>) {
        if self.disabled() || id == target_id {
            return;
        }
        let place = |wanted: &str| self.view.iter().position(|note| note.id == wanted);
        let (Some(from), Some(to)) = (place(id), place(target_id)) else {
            return;
        };
        let command = Command::MoveList {
            id: id.to_string(),
            target_id: target_id.to_string(),
            placement: if from < to {
                api::Placement::After
            } else {
                api::Placement::Before
            },
        };
        self.run(command, window, cx);
    }

    // Menus and what lies over the app.

    fn toggle_menu(&mut self, menu: Menu, cx: &mut Context<Self>) {
        // The click that closed it by landing outside it was on its own button.
        if self.menu.is_none() && self.menu_closed.elapsed() < Duration::from_millis(250) {
            return;
        }
        self.menu = if self.menu == Some(menu) { None } else { Some(menu) };
        cx.notify();
    }

    fn close_menu(&mut self, cx: &mut Context<Self>) {
        if self.menu.take().is_some() {
            self.menu_closed = Instant::now();
            cx.notify();
        }
    }

    /// Esc: the menu first, then what lies over the app, then the title being renamed.
    fn dismiss(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.menu.is_some() {
            self.close_menu(cx);
        } else if self.overlay.is_some() {
            self.close_overlay(window, cx);
        } else if self.naming.is_some() {
            self.cancel_naming(window, cx);
        }
    }

    /// A single-line field of a dialog, with the keyboard in it.
    fn dialog_input(
        placeholder: &'static str,
        max: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Entity<InputState> {
        let input = cx.new(|cx| {
            InputState::new(window, cx)
                .placeholder(placeholder)
                // The web's `maxLength`.
                .validate(move |text, _| text.encode_utf16().count() <= max)
        });
        input.update(cx, |input, cx| input.focus(window, cx));
        input
    }

    /// Opens what the picture is to be taken of: `EVEN_NOTES_SHOW=note`, `spotlight`, … Only looks; changes nothing.
    #[cfg(debug_assertions)]
    fn show_for_a_picture(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        static ONCE: std::sync::Once = std::sync::Once::new();
        let mut what = None;
        ONCE.call_once(|| what = std::env::var("EVEN_NOTES_SHOW").ok());
        let Some(what) = what else { return };
        let first = self.view.first().map(|note| note.id.clone());
        for part in what.split(',') {
            match part {
                "note" => {
                    if let Some(id) = first.clone() {
                        self.show(Nav::Note(id), window, cx)
                    }
                }
                "options" => self.menu = Some(Menu::NoteOptions),
                "workspaces" => self.menu = Some(Menu::Workspaces),
                "spotlight" => self.open_spotlight(window, cx),
                "new" => self.open_new_note(window, cx),
                "workspace" => self.open_new_workspace(window, cx),
                "delete" => {
                    if let Some(note) = self.selected_note() {
                        self.overlay = Some(Overlay::Delete {
                            id: note.id.clone(),
                            title: note.name.clone(),
                        })
                    }
                }
                "share" => self.open_share(window, cx),
                "rename" => self.start_naming(window, cx),
                "conflict" => {
                    if let Some(editor) = &mut self.editor {
                        editor.show_conflict();
                    }
                }
                "offline" => self.online = false,
                _ => {}
            }
        }
        cx.notify();
    }
}

impl EventEmitter<AppEvent> for NotesApp {}

impl EvenApp for NotesApp {
    // In the desktop app Even noteren adds no settings pages: the window has the
    // account, appearance and about pages, and Even doen holds the workspace
    // pages for the same workspaces (components/settings/workspace-settings.tsx).

    fn activated(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.overlay.is_none() && self.naming.is_none() {
            let in_note = self
                .editor
                .as_ref()
                .is_some_and(|editor| editor.body.is_focused(window, cx));
            if !in_note {
                window.focus(&self.focus, cx);
            }
        }
        if self.load != Load::Ready {
            return;
        }
        // Even doen may have switched workspace since: follow it, as the Tauri app does.
        let wanted = prefs::get(WORKSPACE_PREF);
        match wanted {
            Some(id) if self.active.as_ref() != Some(&id) && self.workspaces.iter().any(|w| w.id == id) => {
                self.open_workspace(id, window, cx)
            }
            _ => self.fetch(window, cx),
        }
    }
}

impl Render for NotesApp {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let root = div()
            .key_context("Notes")
            .track_focus(&self.focus)
            .on_action(cx.listener(|this, _: &Spotlight, window, cx| this.toggle_spotlight(window, cx)))
            .on_action(cx.listener(|this, _: &NoteUp, window, cx| this.step_note(-1, window, cx)))
            .on_action(cx.listener(|this, _: &NoteDown, window, cx| this.step_note(1, window, cx)))
            .on_action(cx.listener(|this, _: &Dismiss, window, cx| this.dismiss(window, cx)))
            // A field's own Escape comes up here when it has nothing of its own to undo.
            .on_action(cx.listener(|this, _: &Escape, window, cx| this.dismiss(window, cx)))
            .size_full()
            .flex()
            .bg(theme::background())
            .text_color(theme::foreground());
        match self.load {
            Load::Loading => root.child(page::loading()),
            Load::Failed => root.child(self.render_failed(cx)),
            Load::Ready => root
                .child(self.render_sidebar(cx))
                .child(self.render_main(window, cx))
                .children(self.render_overlay(window, cx)),
        }
    }
}
