//! What lies over mail for a moment: the ⌘K spotlight that searches every
//! mailbox and jumps to places (components/mail-spotlight.tsx), every shortcut
//! on ? (components/shortcuts-spotlight.tsx), when to snooze to
//! (components/when-picker.tsx), and the questions asked before something
//! that can't be undone. They share `.list-spotlight` of
//! packages/ui/src/styles/spotlight.css and the web's dialogs. The open mail's
//! webview makes way while one shows (`MailView::veiled`).

use chrono::{Local, NaiveDateTime};
use gpui_kit::component::input::{Input, InputEvent, InputState};

use crate::api::{rank_hits, SearchHit};
use crate::ui;

use super::api::Sender;
use super::places::{folder_place, Place};
use super::when::{parse_when, quick_picks, Pick, Purpose};
use super::*;

/// Searching goes to every mailbox, so it waits for a pause in typing.
const SEARCH_DELAY: Duration = Duration::from_millis(300);
/// Matching what's already synced is cheap, so it can follow typing closely.
const QUICK_DELAY: Duration = Duration::from_millis(120);
const MIN_QUERY: usize = 2;
/// The API turns away longer queries (`MAX_SEARCH_LENGTH`).
const MAX_QUERY: usize = 500;

pub(crate) enum Overlay {
    Spotlight(Spotlight),
    Shortcuts(Filtered),
    When(WhenPicker),
    Confirm(Confirm),
}

pub(crate) struct Spotlight {
    input: Entity<InputState>,
    query: String,
    selected: usize,
    /// Synced matches show at once; the providers' results join them when they arrive.
    quick: Vec<SearchHit>,
    full: Vec<SearchHit>,
    /// The query the mailboxes answered, or are answering.
    settled: String,
    fetching: bool,
    failed: bool,
    some_failed: bool,
    generation: u64,
    scroll: ScrollHandle,
    /// The selection moved by key: bring it into view.
    reveal: bool,
    _events: Subscription,
}

/// A list filtered by what is typed, with one row chosen: the shortcuts.
pub(crate) struct Filtered {
    input: Entity<InputState>,
    query: String,
    selected: usize,
    scroll: ScrollHandle,
    reveal: bool,
    _events: Subscription,
}

/// What a picked moment snoozes.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum SnoozeTarget {
    /// The open conversation, which then moves on.
    Open,
    /// The selected conversations.
    Selection,
    /// Nothing: only to look at the picker (`EVEN_MAIL_DEBUG=snooze`).
    Debug,
}

pub(crate) struct WhenPicker {
    input: Entity<InputState>,
    text: String,
    active: usize,
    /// "Now" as the picker opened, so the picks don't shift while it is open.
    now: NaiveDateTime,
    purpose: Purpose,
    target: SnoozeTarget,
    _events: Subscription,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Recognition {
    Parcel,
    Invoice,
}

/// A question before something happens.
pub(crate) enum Confirm {
    EmptyTrash,
    /// Everything from one sender: "archive" or "trash".
    Sender { sender: Sender, action: &'static str },
    /// "Not recognised well?": what was wrong, in one click.
    Report { kind: Recognition, thread: String },
}

/// One row of the spotlight.
enum SpotItem {
    Compose,
    AllMailboxes,
    Drafts,
    Folder(MailFolder),
    Mailbox(Mailbox),
    Settings,
    Hit(SearchHit),
}

/// Lowercase and without accents, so "cafe" finds "Café".
fn normalize(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .map(|c| match c {
            'á' | 'à' | 'ä' | 'â' | 'ã' => 'a',
            'é' | 'è' | 'ë' | 'ê' => 'e',
            'í' | 'ì' | 'ï' | 'î' => 'i',
            'ó' | 'ò' | 'ö' | 'ô' | 'õ' => 'o',
            'ú' | 'ù' | 'ü' | 'û' => 'u',
            'ç' => 'c',
            'ñ' => 'n',
            other => other,
        })
        .collect()
}

fn matches(label: &str, words: &[String]) -> bool {
    let label = normalize(label);
    words.iter().all(|word| label.contains(word.as_str()))
}

/// A key as the shortcuts list shows it.
struct Shortcut {
    group: &'static str,
    keys: Vec<&'static str>,
    label: &'static str,
    run: Option<fn(&mut MailView, &mut Window, &mut Context<MailView>)>,
}

/// Every key the app knows, in the web's groups.
fn shortcuts() -> Vec<Shortcut> {
    let general = t("General", "Algemeen");
    let list = t("List", "Lijst");
    let conversation = t("Conversation", "Gesprek");
    let writing = t("Writing", "Schrijven");
    let space = t("Space", "Spatie");
    let key = |group, keys: &[&'static str], label| Shortcut {
        group,
        keys: keys.to_vec(),
        label,
        run: None,
    };
    let search: fn(&mut MailView, &mut Window, &mut Context<MailView>) = |this, window, cx| this.open_spotlight(window, cx);
    vec![
        Shortcut { run: Some(search), ..key(general, &["⌘", "K"], t("Search", "Zoeken")) },
        Shortcut { run: Some(search), ..key(general, &["/"], t("Search", "Zoeken")) },
        Shortcut {
            run: Some(|this, window, cx| this.compose(window, cx)),
            ..key(general, &["C"], t("New message", "Nieuw bericht"))
        },
        Shortcut {
            run: Some(|this, _, cx| this.open_settings(None, cx)),
            ..key(general, &["⌘", ","], t("Settings", "Instellingen"))
        },
        key(general, &["⌘", "B"], t("Collapse or expand the sidebar", "Sidebar in- of uitklappen")),
        key(general, &["?"], t("Keyboard shortcuts", "Sneltoetsen")),
        key(general, &["Esc"], t("Close, clear the selection or go back", "Sluiten, selectie wissen of terug")),
        key(list, &["J"], t("Next conversation", "Volgend gesprek")),
        key(list, &["K"], t("Previous conversation", "Vorig gesprek")),
        key(list, &["X"], t("Select the open conversation", "Open gesprek selecteren")),
        key(list, &[space], t("Select the conversation under the pointer", "Gesprek onder de muis selecteren")),
        key(list, &["Shift", space], t("Select a range", "Reeks selecteren")),
        key(list, &["⌘", "A"], t("Select all", "Alles selecteren")),
        key(conversation, &["R"], t("Reply", "Beantwoorden")),
        key(conversation, &["A"], t("Reply all", "Allen beantwoorden")),
        key(conversation, &["F"], t("Forward", "Doorsturen")),
        key(conversation, &["E"], t("Archive", "Archiveren")),
        key(conversation, &["#"], t("Move to trash", "Naar prullenbak")),
        key(conversation, &["I"], t("Move to inbox", "Terug naar inbox")),
        key(conversation, &["!"], t("Report spam", "Spam melden")),
        key(conversation, &["S"], t("Star or unstar", "Ster aan of uit")),
        key(conversation, &["B"], t("Snooze, or unsnooze", "Snoozen, of niet meer snoozen")),
        key(conversation, &["U"], t("Mark as unread", "Markeren als ongelezen")),
        key(conversation, &["P"], t("Pin or unpin", "Vastpinnen of losmaken")),
        key(conversation, &["T"], t("Make a task in Even doen", "Taak maken in Even doen")),
        key(writing, &["⌘", "Enter"], t("Send", "Versturen")),
        key(writing, &["⌘", "J"], t("Write with AI", "Schrijven met AI")),
        key(writing, &["⌘", "B"], t("Bold", "Vet")),
        key(writing, &["⌘", "I"], t("Italic", "Cursief")),
        key(writing, &["⌘", "U"], t("Underline", "Onderstrepen")),
        key(writing, &["⌘", "K"], t("Link the selected text", "Link maken van de selectie")),
        key(writing, &["Esc"], t("Put the message aside", "Bericht wegzetten")),
    ]
}

fn shown_shortcuts(query: &str) -> Vec<Shortcut> {
    let words: Vec<String> = normalize(query).split_whitespace().map(str::to_string).collect();
    shortcuts()
        .into_iter()
        .filter(|item| matches(&format!("{} {} {}", item.group, item.label, item.keys.join(" ")), &words))
        .collect()
}

impl MailView {
    /// The keyboard comes back from the mail document, which holds it natively.
    fn take_keyboard(&self, cx: &App) {
        if let Some(webview) = &self.webview {
            let _ = webview.read(cx).raw().focus_parent();
        }
    }

    /// A field for an overlay, with the keyboard in it, that says when its text changes.
    fn overlay_input(
        &mut self,
        placeholder: &'static str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> (Entity<InputState>, Subscription) {
        self.take_keyboard(cx);
        let input = cx.new(|cx| InputState::new(window, cx).placeholder(placeholder));
        input.update(cx, |input, cx| input.focus(window, cx));
        let events = cx.subscribe_in(&input, window, |this, input, event: &InputEvent, _, cx| {
            if matches!(event, InputEvent::Change) {
                let text = input.read(cx).value().to_string();
                this.overlay_typed(text, cx);
            }
        });
        (input, events)
    }

    /// ⌘K and /: search every mailbox, or jump somewhere.
    pub(crate) fn open_spotlight(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let (input, events) = self.overlay_input(t("Search mail or jump to…", "Zoek in mail of ga naar…"), window, cx);
        self.overlay = Some(Overlay::Spotlight(Spotlight {
            input,
            query: String::new(),
            selected: 0,
            quick: Vec::new(),
            full: Vec::new(),
            settled: String::new(),
            fetching: false,
            failed: false,
            some_failed: false,
            generation: 0,
            scroll: ScrollHandle::new(),
            reveal: false,
            _events: events,
        }));
        cx.notify();
    }

    /// ?: every key the app knows, searchable.
    pub(crate) fn open_shortcuts(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let (input, events) = self.overlay_input(t("Keyboard shortcuts…", "Sneltoetsen…"), window, cx);
        self.overlay = Some(Overlay::Shortcuts(Filtered {
            input,
            query: String::new(),
            selected: 0,
            scroll: ScrollHandle::new(),
            reveal: false,
            _events: events,
        }));
        cx.notify();
    }

    /// When to snooze to: type a moment, or pick one of the usual ones.
    pub(crate) fn open_when(&mut self, target: SnoozeTarget, window: &mut Window, cx: &mut Context<Self>) {
        let (input, events) = self.overlay_input(
            t("Tomorrow 10am, in 2 weeks, Friday 9…", "Morgen 10 uur, over 2 weken, vrijdag 9…"),
            window,
            cx,
        );
        self.overlay = Some(Overlay::When(WhenPicker {
            input,
            text: String::new(),
            active: 0,
            now: Local::now().naive_local(),
            purpose: Purpose::Snooze,
            target,
            _events: events,
        }));
        cx.notify();
    }

    pub(crate) fn confirm(&mut self, confirm: Confirm, window: &mut Window, cx: &mut Context<Self>) {
        self.take_keyboard(cx);
        window.focus(&self.focus, cx);
        self.overlay = Some(Overlay::Confirm(confirm));
        cx.notify();
    }

    pub(crate) fn close_overlay(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.overlay = None;
        window.focus(&self.focus, cx);
        cx.notify();
    }

    /// The text in the open overlay's field changed.
    fn overlay_typed(&mut self, text: String, cx: &mut Context<Self>) {
        match &mut self.overlay {
            Some(Overlay::Spotlight(spot)) => {
                let query: String = text.trim().chars().take(MAX_QUERY).collect();
                if query == spot.query {
                    return;
                }
                spot.query = query.clone();
                // A new query starts at the first item.
                spot.selected = 0;
                spot.reveal = true;
                spot.generation += 1;
                // Unlike the quick matches, an older answer would linger for seconds under a new query.
                spot.full.clear();
                spot.some_failed = false;
                spot.failed = false;
                if query.chars().count() < MIN_QUERY {
                    spot.quick.clear();
                } else {
                    let generation = spot.generation;
                    for (delay, full) in [(QUICK_DELAY, false), (SEARCH_DELAY, true)] {
                        let query = query.clone();
                        cx.spawn(async move |this, cx| {
                            cx.background_executor().timer(delay).await;
                            let _ = this.update(cx, |this, cx| this.search(query, generation, full, cx));
                        })
                        .detach();
                    }
                }
            }
            Some(Overlay::Shortcuts(list)) => {
                list.query = text;
                list.selected = 0;
                list.reveal = true;
            }
            Some(Overlay::When(picker)) => {
                picker.text = text;
                picker.active = 0;
            }
            _ => {}
        }
        cx.notify();
    }

    /// Asks for matches, once typing paused: the synced ones (`full` false) or every mailbox's.
    fn search(&mut self, query: String, generation: u64, full: bool, cx: &mut Context<Self>) {
        let Some(Overlay::Spotlight(spot)) = &mut self.overlay else { return };
        if spot.generation != generation {
            return;
        }
        if full {
            spot.settled = query.clone();
            spot.fetching = true;
        }
        self.fetch(
            cx,
            move |client| {
                if full {
                    client.search(&query).map(|results| (results.hits, !results.failed_accounts.is_empty()))
                } else {
                    client.quick_search(&query).map(|hits| (hits, false))
                }
            },
            move |this, result, _| {
                let Some(Overlay::Spotlight(spot)) = &mut this.overlay else { return };
                if spot.generation != generation {
                    return;
                }
                let before = spot_values(spot);
                match (result, full) {
                    (Ok((hits, some_failed)), true) => {
                        spot.fetching = false;
                        spot.full = hits;
                        spot.some_failed = some_failed;
                    }
                    (Ok((hits, _)), false) => spot.quick = hits,
                    (Err(_), true) => {
                        spot.fetching = false;
                        spot.failed = true;
                    }
                    // The mailboxes' own search still answers.
                    (Err(_), false) => {}
                }
                // Arriving results keep a choice made with the arrow keys, if it is still there.
                let chosen = before.get(spot.selected).cloned();
                let after = spot_values(spot);
                spot.selected = chosen
                    .and_then(|value| after.iter().position(|item| *item == value))
                    .unwrap_or(0);
            },
        );
        cx.notify();
    }

    /// What the spotlight lists: the places that match the words, then the mail found.
    fn spot_items(&self, spot: &Spotlight) -> Vec<SpotItem> {
        let words: Vec<String> = normalize(&spot.query).split_whitespace().map(str::to_string).collect();
        let mut items = Vec::new();
        let mut command = |label: &str, item: SpotItem| {
            if matches(label, &words) {
                items.push(item);
            }
        };
        command(t("New message", "Nieuw bericht"), SpotItem::Compose);
        command("Inbox", SpotItem::AllMailboxes);
        command(Place::Drafts.label(), SpotItem::Drafts);
        for folder in MailFolder::ALL {
            command(folder_place(folder).label(), SpotItem::Folder(folder));
        }
        for mailbox in &self.mailboxes {
            command(&mailbox.email, SpotItem::Mailbox(mailbox.clone()));
        }
        command(t("Settings", "Instellingen"), SpotItem::Settings);
        items.extend(spot_hits(spot).into_iter().map(SpotItem::Hit));
        items
    }

    fn spot_choose(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) {
        let Some(Overlay::Spotlight(spot)) = &self.overlay else { return };
        let mut items = self.spot_items(spot);
        if index >= items.len() {
            return;
        }
        let item = items.swap_remove(index);
        self.close_overlay(window, cx);
        match item {
            SpotItem::Compose => self.compose(window, cx),
            SpotItem::AllMailboxes => self.select_account(String::new(), cx),
            SpotItem::Drafts => self.select_view(View::Drafts, cx),
            SpotItem::Folder(folder) => self.select_view(View::Folder(folder), cx),
            SpotItem::Mailbox(mailbox) => self.select_account(mailbox.id, cx),
            SpotItem::Settings => self.open_settings(None, cx),
            SpotItem::Hit(hit) => self.open_thread(hit.into_thread(), cx),
        }
    }

    fn shortcut_choose(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) {
        let Some(Overlay::Shortcuts(list)) = &self.overlay else { return };
        let Some(run) = shown_shortcuts(&list.query).get(index).and_then(|item| item.run) else {
            return;
        };
        self.close_overlay(window, cx);
        run(self, window, cx);
    }

    /// The picker's options: what was typed, understood, then the usual moments.
    fn when_options(picker: &WhenPicker) -> (Option<NaiveDateTime>, Vec<Pick>) {
        let typed = (!picker.text.trim().is_empty())
            .then(|| parse_when(&picker.text, Local::now().naive_local()))
            .flatten();
        (typed, quick_picks(picker.purpose, picker.now))
    }

    fn when_choose(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) {
        let Some(Overlay::When(picker)) = &self.overlay else { return };
        let (typed, picks) = Self::when_options(picker);
        let moments: Vec<NaiveDateTime> = typed.into_iter().chain(picks.into_iter().map(|pick| pick.at)).collect();
        let Some(at) = moments.get(index).copied() else { return };
        let target = picker.target;
        self.close_overlay(window, cx);
        let Some(until) = to_utc(at) else { return };
        match target {
            SnoozeTarget::Open => self.leave(ThreadAction::Archive, Some(until), cx),
            SnoozeTarget::Selection => self.bulk(ThreadAction::Archive, Some(until), cx),
            SnoozeTarget::Debug => {}
        }
    }

    fn confirmed(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(Overlay::Confirm(confirm)) = self.overlay.take() else { return };
        window.focus(&self.focus, cx);
        match confirm {
            Confirm::EmptyTrash => self.empty_trash(cx),
            Confirm::Sender { sender, action } => self.tidy(sender, action, cx),
            Confirm::Report { .. } => {}
        }
        cx.notify();
    }

    /// The arrow keys, Enter and Escape of the open overlay, before its field sees them.
    fn overlay_key(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        let key = event.keystroke.key.as_str();
        if key == "escape" {
            cx.stop_propagation();
            self.close_overlay(window, cx);
            return;
        }
        // ⌘K again closes the spotlight.
        if key == "k" && event.keystroke.modifiers.platform && matches!(self.overlay, Some(Overlay::Spotlight(_))) {
            cx.stop_propagation();
            self.close_overlay(window, cx);
            return;
        }
        let step: isize = match key {
            "down" => 1,
            "up" => -1,
            "enter" => 0,
            _ => return,
        };
        cx.stop_propagation();
        let count = match &self.overlay {
            Some(Overlay::Spotlight(spot)) => self.spot_items(spot).len(),
            Some(Overlay::Shortcuts(list)) => shown_shortcuts(&list.query).len(),
            Some(Overlay::When(picker)) => {
                let (typed, picks) = Self::when_options(picker);
                picks.len() + typed.is_some() as usize
            }
            _ => 0,
        };
        // The lists go round (`loop`); the picker stops at its ends.
        let moved = |selected: usize, wrap: bool| -> usize {
            if count == 0 {
                return 0;
            }
            let next = selected as isize + step;
            if wrap {
                next.rem_euclid(count as isize) as usize
            } else {
                next.clamp(0, count as isize - 1) as usize
            }
        };
        match &mut self.overlay {
            Some(Overlay::Spotlight(spot)) if step != 0 => {
                spot.selected = moved(spot.selected, true);
                spot.reveal = true;
            }
            Some(Overlay::Shortcuts(list)) if step != 0 => {
                list.selected = moved(list.selected, true);
                list.reveal = true;
            }
            Some(Overlay::When(picker)) if step != 0 => picker.active = moved(picker.active, false),
            Some(Overlay::Spotlight(spot)) => {
                let index = spot.selected;
                self.spot_choose(index, window, cx);
            }
            Some(Overlay::Shortcuts(list)) => {
                let index = list.selected;
                self.shortcut_choose(index, window, cx);
            }
            Some(Overlay::When(picker)) => {
                let index = picker.active;
                self.when_choose(index, window, cx);
            }
            _ => {}
        }
        cx.notify();
    }

    pub(super) fn render_overlay(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Option<AnyElement> {
        // A selection moved by key comes into view once, so the wheel stays free after it.
        let reveal = match &mut self.overlay {
            Some(Overlay::Spotlight(spot)) => std::mem::take(&mut spot.reveal),
            Some(Overlay::Shortcuts(list)) => std::mem::take(&mut list.reveal),
            _ => false,
        };
        let overlay = self.overlay.as_ref()?;
        let confirm = matches!(overlay, Overlay::Confirm(_));
        let panel = match overlay {
            Overlay::Spotlight(spot) => self.render_spotlight(spot, reveal, window, cx),
            Overlay::Shortcuts(list) => self.render_shortcuts(list, reveal, window, cx),
            Overlay::When(picker) => self.render_when(picker, window, cx),
            Overlay::Confirm(confirm) => self.render_confirm(confirm, cx),
        };
        // The web's dialog overlay: everything behind steps back.
        Some(
            div()
                .id("mail-overlay")
                .absolute()
                .inset_0()
                .flex()
                .flex_col()
                .items_center()
                .when(confirm, |el| el.justify_center())
                // A spotlight sits near the top (`top: min(20dvh, 160px)`).
                .when(!confirm, |el| el.pt(window.viewport_size().height.min(px(800.)) * 0.2))
                .px(px(16.))
                // The rail is beside mail, not under it: this far left centres the panel in the window.
                .pr(px(16. + 80.))
                .bg(rgba(0x0000004d))
                .occlude()
                .capture_key_down(cx.listener(Self::overlay_key))
                .on_click(cx.listener(|this, _, window, cx| this.close_overlay(window, cx)))
                .child(panel)
                .into_any_element(),
        )
    }

    fn render_spotlight(&self, spot: &Spotlight, reveal: bool, window: &Window, cx: &mut Context<Self>) -> AnyElement {
        let items = self.spot_items(spot);
        let searching = spot.query.chars().count() >= MIN_QUERY;
        let pending = searching && (spot.fetching || spot.settled != spot.query);
        let typed = !spot.query.is_empty();
        let several = self.mailboxes.len() > 1;
        let commands = items.iter().filter(|item| !matches!(item, SpotItem::Hit(_))).count();
        let mut children: Vec<AnyElement> = Vec::new();
        let mut selected_child = None;
        if !pending && items.is_empty() && typed {
            children.push(
                div()
                    .py(px(24.))
                    .text_center()
                    .text_size(px(14.))
                    .child(if spot.failed {
                        t("Searching failed. Try again.", "Zoeken mislukt. Probeer het opnieuw.")
                    } else {
                        t("Nothing found.", "Niets gevonden.")
                    })
                    .into_any_element(),
            );
        }
        if commands > 0 {
            children.push(group_heading(t("Go to", "Ga naar"), false).into_any_element());
        }
        for (index, item) in items.iter().enumerate() {
            if index == commands && searching {
                children.push(group_heading(t("Mail", "Mail"), pending).into_any_element());
            }
            let selected = index == spot.selected;
            if selected {
                selected_child = Some(children.len());
            }
            let row = spot_row(("spot", index), selected)
                .on_hover(cx.listener(move |this, hovering: &bool, _, cx| {
                    if let (true, Some(Overlay::Spotlight(spot))) = (*hovering, &mut this.overlay) {
                        if spot.selected != index {
                            spot.selected = index;
                            cx.notify();
                        }
                    }
                }))
                .on_click(cx.listener(move |this, _, window, cx| {
                    cx.stop_propagation();
                    this.spot_choose(index, window, cx)
                }));
            let icon = |name: &str| theme::hi(name).text_color(theme::foreground());
            let name = |label: String| div().min_w_0().truncate().child(label);
            children.push(match item {
                SpotItem::Compose => row
                    .child(icon("pencil-edit-02"))
                    .child(name(t("New message", "Nieuw bericht").into())),
                SpotItem::AllMailboxes => row.child(icon("inbox")).child(name("Inbox".into())),
                SpotItem::Drafts => row.child(icon("file-01")).child(name(Place::Drafts.label().into())),
                SpotItem::Folder(folder) => {
                    let place = folder_place(*folder);
                    row.child(icon(place.icon())).child(name(place.label().into()))
                }
                SpotItem::Mailbox(mailbox) => row
                    .child(
                        div()
                            .flex()
                            .flex_none()
                            .size(px(16.))
                            .items_center()
                            .justify_center()
                            .child(div().size(px(8.)).rounded_full().bg(theme::account(mailbox.color))),
                    )
                    .child(name(mailbox.email.clone())),
                SpotItem::Settings => row.child(icon("settings-01")).child(name(t("Settings", "Instellingen").into())),
                SpotItem::Hit(hit) => {
                    let color = several
                        .then(|| self.mailbox(&hit.account_id).map(|mailbox| mailbox.color))
                        .flatten();
                    let subject = subject_or_none(&hit.subject);
                    let text = if hit.snippet.is_empty() {
                        subject.clone()
                    } else {
                        format!("{subject} · {}", hit.snippet)
                    };
                    let text = StyledText::new(text).with_highlights([(
                        0..subject.len(),
                        HighlightStyle {
                            color: Some(theme::foreground().into()),
                            ..Default::default()
                        },
                    )]);
                    let from = hit
                        .from_name
                        .clone()
                        .filter(|name| !name.is_empty())
                        .or_else(|| hit.from_email.clone())
                        .unwrap_or_else(|| t("Unknown sender", "Onbekende afzender").to_string());
                    row.items_start()
                        .py(px(8.))
                        .child(theme::hi("mail-01").mt(px(2.)).text_color(theme::muted()))
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .flex_1()
                                .min_w_0()
                                .gap(px(2.))
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap(px(8.))
                                        .child(
                                            div()
                                                .flex_1()
                                                .min_w_0()
                                                .truncate()
                                                .when(!hit.is_read, |el| el.font_weight(FontWeight::SEMIBOLD))
                                                .child(from),
                                        )
                                        .when(hit.has_attachments, |el| {
                                            el.child(theme::hi("attachment-01").size(px(14.)).text_color(theme::muted()))
                                        })
                                        .child(
                                            div()
                                                .flex_none()
                                                .text_size(px(12.))
                                                .text_color(theme::muted())
                                                .child(format::short_date(hit.received_at)),
                                        ),
                                )
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap(px(8.))
                                        .child(
                                            div()
                                                .flex_1()
                                                .min_w_0()
                                                .truncate()
                                                .text_color(theme::muted())
                                                .child(text),
                                        )
                                        .when_some(color, |el, color| {
                                            el.child(div().flex_none().size(px(8.)).rounded_full().bg(theme::account(color)))
                                        }),
                                ),
                        )
                }
            }
            .into_any_element());
        }
        if searching && items.len() == commands && commands > 0 {
            // The mail group shows its heading while the mailboxes still search.
            children.push(group_heading(t("Mail", "Mail"), pending).into_any_element());
        }
        if reveal {
            if let Some(child) = selected_child {
                spot.scroll.scroll_to_item(child);
            }
        }
        let help = if searching || typed {
            vec![
                t("↑↓ to choose", "↑↓ kiezen"),
                t("↵ to open", "↵ openen"),
                t("esc to close", "esc sluiten"),
            ]
        } else {
            vec![t(
                "Type to search every mailbox. Gmail's from:, to: and has:attachment work too.",
                "Typ om in alle mailboxen te zoeken. Gmail's from:, to: en has:attachment werken ook.",
            )]
        };
        spotlight_panel(672.)
            .child(command_input(&spot.input))
            .child(
                div()
                    .id("spot-list")
                    .flex()
                    .flex_col()
                    .p(px(4.))
                    .max_h(px(460.).min(window.viewport_size().height * 0.55))
                    .overflow_y_scroll()
                    .track_scroll(&spot.scroll)
                    .children(children),
            )
            .when(searching && spot.some_failed, |el| {
                el.child(
                    div()
                        .px(px(12.))
                        .pt(px(8.))
                        .text_size(px(12.))
                        .text_color(theme::muted())
                        .child(t(
                            "Some mailboxes couldn't be searched.",
                            "Sommige mailboxen konden niet worden doorzocht.",
                        )),
                )
            })
            .child(spotlight_help(help))
            .into_any_element()
    }

    fn render_shortcuts(&self, list: &Filtered, reveal: bool, window: &Window, cx: &mut Context<Self>) -> AnyElement {
        let items = shown_shortcuts(&list.query);
        let mut children: Vec<AnyElement> = Vec::new();
        let mut selected_child = None;
        if items.is_empty() {
            children.push(
                div()
                    .py(px(24.))
                    .text_center()
                    .text_size(px(14.))
                    .child(t("No shortcut for that.", "Daar is geen sneltoets voor."))
                    .into_any_element(),
            );
        }
        let mut group = "";
        for (index, item) in items.iter().enumerate() {
            if item.group != group {
                group = item.group;
                children.push(group_heading(group, false).into_any_element());
            }
            let selected = index == list.selected;
            if selected {
                selected_child = Some(children.len());
            }
            let keys = item.keys.iter().enumerate().map(|(position, key)| {
                div()
                    .flex()
                    .items_center()
                    .gap(px(4.))
                    .when(position > 0, |el| el.child(div().text_color(theme::muted()).child("+")))
                    .child(
                        div()
                            .px(px(6.))
                            .py(px(2.))
                            .rounded(theme::RADIUS_SM)
                            .border_1()
                            .border_color(theme::border())
                            .bg(theme::background())
                            .text_size(px(11.))
                            .line_height(px(16.))
                            .text_color(theme::foreground())
                            .child(key.to_uppercase()),
                    )
            });
            children.push(
                spot_row(("shortcut", index), selected)
                    .when(item.run.is_none(), |el| el.cursor_default())
                    .on_hover(cx.listener(move |this, hovering: &bool, _, cx| {
                        if let (true, Some(Overlay::Shortcuts(list))) = (*hovering, &mut this.overlay) {
                            if list.selected != index {
                                list.selected = index;
                                cx.notify();
                            }
                        }
                    }))
                    .on_click(cx.listener(move |this, _, window, cx| {
                        cx.stop_propagation();
                        this.shortcut_choose(index, window, cx)
                    }))
                    .child(
                        div()
                            .flex()
                            .flex_none()
                            .items_center()
                            .gap(px(4.))
                            .w(px(160.))
                            .font_family("Menlo")
                            .children(keys),
                    )
                    .child(div().text_color(theme::muted()).child("→"))
                    .child(div().min_w_0().child(item.label))
                    .into_any_element(),
            );
        }
        if reveal {
            if let Some(child) = selected_child {
                list.scroll.scroll_to_item(child);
            }
        }
        spotlight_panel(672.)
            .child(command_input(&list.input))
            .child(
                div()
                    .id("shortcut-list")
                    .flex()
                    .flex_col()
                    .p(px(4.))
                    .max_h(px(520.).min(window.viewport_size().height * 0.6))
                    .overflow_y_scroll()
                    .track_scroll(&list.scroll)
                    .children(children),
            )
            .into_any_element()
    }

    fn render_when(&self, picker: &WhenPicker, window: &Window, cx: &mut Context<Self>) -> AnyElement {
        let (typed, picks) = Self::when_options(picker);
        let now = picker.now;
        // A day within the week by its name, a later one by its date.
        let day = |at: NaiveDateTime| {
            if (at - now).num_seconds() < 6 * 86_400 {
                format::short_weekday(at.date())
            } else {
                format::day_month(at.date(), false)
            }
        };
        let option = |index: usize, typed: bool| {
            let active = index == picker.active;
            div()
                .id(("when", index))
                .flex()
                .items_center()
                .gap(px(10.))
                .w_full()
                .min_h(px(if typed { 48. } else { 40. }))
                .px(px(10.))
                .rounded(theme::RADIUS_MD)
                .text_size(px(14.))
                .cursor_pointer()
                .text_color(if typed { theme::primary_mark() } else { theme::muted() })
                .when(active, |el| {
                    el.bg(if typed { theme::mix(theme::primary_mark(), 12.) } else { theme::accent() })
                })
                .on_hover(cx.listener(move |this, hovering: &bool, _, cx| {
                    if let (true, Some(Overlay::When(picker))) = (*hovering, &mut this.overlay) {
                        if picker.active != index {
                            picker.active = index;
                            cx.notify();
                        }
                    }
                }))
                .on_click(cx.listener(move |this, _, window, cx| {
                    cx.stop_propagation();
                    this.when_choose(index, window, cx)
                }))
        };
        let enter = |active: bool| {
            div()
                .ml(px(2.))
                .text_size(px(11.))
                .text_color(theme::muted())
                .when(!active, |el| el.invisible())
                .child("↵")
        };
        let mut options: Vec<AnyElement> = Vec::new();
        let mut index = 0;
        if let Some(at) = typed {
            // What was typed, understood: the moment itself, in the accent colour.
            options.push(
                option(index, true)
                    .child(theme::hi("calendar-03").text_color(theme::primary_mark()))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .truncate()
                            .font_weight(FontWeight::MEDIUM)
                            .child(format::long_day(at.date())),
                    )
                    .child(
                        div()
                            .text_size(px(14.))
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(at.format("%H:%M").to_string()),
                    )
                    .child(enter(index == picker.active))
                    .into_any_element(),
            );
            options.push(
                div()
                    .px(px(12.))
                    .pt(px(8.))
                    .pb(px(4.))
                    .text_size(px(12.))
                    .text_color(theme::muted())
                    .child(t("Quick picks", "Snel kiezen"))
                    .into_any_element(),
            );
            index += 1;
        }
        for pick in picks {
            options.push(
                option(index, false)
                    .child(theme::hi(pick.icon).text_color(theme::muted()))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .truncate()
                            .text_color(theme::foreground())
                            .child(pick.label),
                    )
                    .child(div().text_size(px(13.)).child(day(pick.at)))
                    .child(div().text_size(px(13.)).child(pick.at.format("%H:%M").to_string()))
                    .child(enter(index == picker.active))
                    .into_any_element(),
            );
            index += 1;
        }
        let snooze = picker.purpose == Purpose::Snooze;
        let focused = picker.input.read(cx).focus_handle(cx).is_focused(window);
        spotlight_panel(440.)
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .px(px(8.))
                    .pt(px(4.))
                    .pb(px(8.))
                    .text_size(px(12.))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(theme::muted())
                    .child(
                        theme::hi(if snooze { "alarm-clock" } else { "mail-send-01" })
                            .size(px(14.))
                            .text_color(theme::muted()),
                    )
                    .child(if snooze {
                        t("Snooze until…", "Snoozen tot…")
                    } else {
                        t("Send at…", "Versturen op…")
                    }),
            )
            // `.when-picker-field`.
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(10.))
                    .h(px(48.))
                    .px(px(14.))
                    .rounded(theme::RADIUS)
                    .bg(theme::mix(theme::foreground(), 5.))
                    .border_1()
                    .border_color(if focused { theme::mix(theme::primary_mark(), 55.) } else { theme::border() })
                    .child(theme::hi("calendar-03").size(px(18.)).text_color(theme::muted()))
                    .child(div().flex_1().min_w_0().text_size(px(15.)).child(Input::new(&picker.input).appearance(false))),
            )
            .when(!picker.text.trim().is_empty() && typed.is_none(), |el| {
                el.child(
                    div()
                        .px(px(12.))
                        .pt(px(12.))
                        .pb(px(4.))
                        .text_size(px(14.))
                        .text_color(theme::muted())
                        .child(t(
                            "Not a moment I understand yet. Try “Friday 9am” or “in 3 days”.",
                            "Dat moment begrijp ik nog niet. Probeer „vrijdag 9 uur” of „over 3 dagen”.",
                        )),
                )
            })
            .child(div().flex().flex_col().gap(px(2.)).pt(px(8.)).children(options))
            .child(spotlight_help(vec!["↑↓", t("↵ Choose", "↵ Kiezen"), "esc"]))
            .into_any_element()
    }

    fn render_confirm(&self, confirm: &Confirm, cx: &mut Context<Self>) -> AnyElement {
        if let Confirm::Report { kind, thread } = confirm {
            return self.render_report(*kind, thread.clone(), cx);
        }
        let (title, body, ok, destructive): (String, &str, &str, bool) = match confirm {
            Confirm::EmptyTrash => (
                t("Empty the trash for good?", "Prullenbak definitief legen?").into(),
                t(
                    "Everything in the trash of your Outlook mailboxes is deleted and can't be brought back.",
                    "Alles in de prullenbak van je Outlook-mailboxen wordt verwijderd en is niet terug te halen.",
                ),
                t("Empty trash", "Prullenbak legen"),
                true,
            ),
            Confirm::Sender { sender, action } => {
                let count = format::number(sender.conversations);
                let name = sender.label();
                if *action == "trash" {
                    (
                        t(
                            format!("Move {count} conversations from {name} to the trash?"),
                            format!("{count} gesprekken van {name} naar de prullenbak?"),
                        ),
                        t(
                            "They go to the trash, at Gmail or Outlook too, where they can still be brought back for a while.",
                            "Ze gaan naar de prullenbak, ook bij Gmail of Outlook, waar je ze nog een tijdje terug kunt halen.",
                        ),
                        t("Delete all", "Alles verwijderen"),
                        true,
                    )
                } else {
                    (
                        t(
                            format!("Archive {count} conversations from {name}?"),
                            format!("{count} gesprekken van {name} archiveren?"),
                        ),
                        t(
                            "They leave your inbox and stay in your archive, at Gmail or Outlook too.",
                            "Ze verdwijnen uit je inbox en blijven in je archief staan, ook bij Gmail of Outlook.",
                        ),
                        t("Archive all", "Alles archiveren"),
                        false,
                    )
                }
            }
            Confirm::Report { .. } => unreachable!("handled above"),
        };
        dialog_panel(448.)
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(6.))
                    .child(div().text_size(px(16.)).font_weight(FontWeight::MEDIUM).child(title))
                    .child(div().text_size(px(14.)).text_color(theme::muted()).child(body)),
            )
            .child(
                div()
                    .flex()
                    .justify_end()
                    .gap(px(8.))
                    .child(
                        ui::button("confirm-cancel", t("Cancel", "Annuleren"), ui::Variant::Outline).on_click(
                            cx.listener(|this, _, window, cx| {
                                cx.stop_propagation();
                                this.close_overlay(window, cx)
                            }),
                        ),
                    )
                    .child(
                        ui::button(
                            "confirm-ok",
                            ok,
                            if destructive { ui::Variant::Destructive } else { ui::Variant::Primary },
                        )
                        .on_click(cx.listener(|this, _, window, cx| {
                            cx.stop_propagation();
                            this.confirmed(window, cx)
                        })),
                    ),
            )
            .into_any_element()
    }

    /// "Not recognised well?" (components/report-recognition.tsx).
    fn render_report(&self, kind: Recognition, thread: String, cx: &mut Context<Self>) -> AnyElement {
        let mut reasons: Vec<(&'static str, &'static str)> = vec![(
            "not_one",
            match kind {
                Recognition::Parcel => t("This isn't a parcel", "Dit is geen pakket"),
                Recognition::Invoice => t("This isn't an invoice or payment", "Dit is geen factuur of betaling"),
            },
        )];
        if kind == Recognition::Invoice {
            reasons.push(("amount", t("The amount is wrong", "Het bedrag klopt niet")));
        }
        reasons.push(("status", t("The status is wrong", "De status klopt niet")));
        reasons.push(("other", t("Something else", "Iets anders")));
        dialog_panel(384.)
            .relative()
            .child(
                ui::icon_button("report-close", "cancel-01")
                    .absolute()
                    .top(px(16.))
                    .right(px(16.))
                    .bg(theme::secondary())
                    .on_click(cx.listener(|this, _, window, cx| {
                        cx.stop_propagation();
                        this.close_overlay(window, cx)
                    })),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(6.))
                    .child(
                        div()
                            .text_size(px(16.))
                            .font_weight(FontWeight::MEDIUM)
                            .child(t("Not recognised well?", "Niet goed herkend?")),
                    )
                    .child(div().text_size(px(14.)).text_color(theme::muted()).child(t(
                        "It leaves the list. What you pick helps read mail like this better next time.",
                        "Hij gaat uit de lijst. Wat je kiest helpt om mail als deze de volgende keer beter te lezen.",
                    ))),
            )
            .child(div().flex().flex_col().gap(px(6.)).pt(px(4.)).children(reasons.into_iter().map(
                |(reason, label)| {
                    let thread = thread.clone();
                    ui::button(reason, label, ui::Variant::Outline)
                        .w_full()
                        .justify_start()
                        .on_click(cx.listener(move |this, _, window, cx| {
                            cx.stop_propagation();
                            this.close_overlay(window, cx);
                            this.report_recognition(kind, thread.clone(), reason, cx);
                        }))
                },
            )))
            .into_any_element()
    }
}

/// The hits as the list ranks them, synced matches first so they keep their row id.
fn spot_hits(spot: &Spotlight) -> Vec<SearchHit> {
    if spot.query.chars().count() < MIN_QUERY {
        return Vec::new();
    }
    rank_hits(&spot.query, spot.quick.iter().chain(&spot.full).cloned().collect())
}

/// The hits by what names them, to keep a choice when more arrive.
fn spot_values(spot: &Spotlight) -> Vec<String> {
    spot_hits(spot)
        .iter()
        .map(|hit| format!("{}:{}", hit.account_id, hit.thread_id))
        .collect()
}

/// `.list-spotlight`: the panel of a command palette.
fn spotlight_panel(width: f32) -> Stateful<Div> {
    div()
        .id("spotlight")
        .flex()
        .flex_col()
        .flex_none()
        .w(px(width))
        .max_w_full()
        .p(px(8.))
        .rounded(px(12.))
        .bg(theme::popover())
        .border_1()
        .border_color(theme::border())
        .shadow_xl()
        .text_size(px(14.))
        // A click inside is not a click beside it.
        .on_click(|_, _, cx| cx.stop_propagation())
}

/// The web's (alert) dialog: centred, with room around its words.
fn dialog_panel(width: f32) -> Stateful<Div> {
    div()
        .id("dialog")
        .flex()
        .flex_col()
        .flex_none()
        .gap(px(24.))
        .w(px(width))
        .max_w_full()
        .p(px(24.))
        .rounded(theme::RADIUS_XL)
        .bg(theme::popover())
        .border_1()
        .border_color(theme::border())
        .shadow_xl()
        .on_click(|_, _, cx| cx.stop_propagation())
}

/// The palette's field (`CommandInput` inside `.list-spotlight`).
fn command_input(input: &Entity<InputState>) -> Div {
    div().px(px(4.)).pt(px(4.)).pb(px(8.)).child(
        div()
            .flex()
            .items_center()
            .gap(px(4.))
            .h(px(42.))
            .px(px(10.))
            .rounded(theme::RADIUS_MD)
            .bg(theme::mix(theme::input(), 50.))
            .child(theme::hi("search").text_color(theme::muted()).opacity(0.5))
            .child(div().flex_1().min_w_0().child(Input::new(input).appearance(false))),
    )
}

/// A group's heading in a palette, with a spinner while its results are on their way.
fn group_heading(label: &'static str, pending: bool) -> Div {
    div()
        .flex()
        .flex_none()
        .items_center()
        .gap(px(8.))
        .px(px(8.))
        .py(px(6.))
        .text_size(px(12.))
        .line_height(px(16.))
        .font_weight(FontWeight::MEDIUM)
        .text_color(theme::muted())
        .child(label)
        .when(pending, |el| el.child(div().child(crate::ui::spinner())))
}

/// A row in a palette (`CommandItem` inside `.list-spotlight`).
fn spot_row(id: impl Into<ElementId>, selected: bool) -> Stateful<Div> {
    div()
        .id(id)
        .flex()
        .flex_none()
        .items_center()
        .gap(px(8.))
        .min_h(px(42.))
        .px(px(8.))
        .py(px(6.))
        .rounded(theme::RADIUS_SM)
        .line_height(px(20.))
        .cursor_pointer()
        .when(selected, |el| el.bg(theme::muted_bg()))
}

/// `.spotlight-help`: the keys, in a quiet line under the list.
fn spotlight_help(parts: Vec<&'static str>) -> Div {
    div()
        .flex()
        .gap(px(16.))
        .px(px(12.))
        .pt(px(12.))
        .pb(px(4.))
        .text_size(px(11.))
        .text_color(theme::muted())
        .children(parts.into_iter().map(|part| div().child(part)))
}

#[cfg(test)]
mod tests {
    use super::{matches, normalize, shown_shortcuts};

    #[test]
    fn places_and_shortcuts_are_found_by_their_words() {
        assert_eq!(normalize("Café Ünder"), "cafe under");
        let words = vec!["concept".to_string()];
        assert!(matches("Concepten", &words));
        assert!(!matches("Inbox", &words));
        assert!(matches("Anything", &[]));
        assert_eq!(shown_shortcuts("").len(), 32);
        assert!(shown_shortcuts("zzzz").is_empty());
        // By their keys too.
        assert!(!shown_shortcuts("esc").is_empty());
    }
}
