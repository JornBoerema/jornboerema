//! The Even window, as apps/desktop draws it: the sign-in screen until there
//! is a session, then the app rail on the left with the chosen app beside it
//! and one settings window for all of them.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use gpui_kit::component::input::{Input, InputState};
use gpui_kit::prelude::*;
use gpui_kit::*;

use crate::api::{self, Client, Unauthorized, User};
use crate::app::{AppEvent, EvenApp, SettingsPage};
use crate::i18n::{self, t, Lang};
use crate::mail::{MailView, SignedOut};
use crate::notes::NotesApp;
use crate::todo::TodoApp;
use crate::ui::{self, Variant};
use crate::updates::{self, Updates};
use crate::{auth, prefs, store, theme, window as even_window};

actions!(
    even,
    [
        OpenSettings,
        CloseSettings,
        ShowMail,
        ShowTodo,
        ShowNotes,
        SignOut
    ]
);

pub fn bind_keys(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("cmd-,", OpenSettings, None),
        KeyBinding::new("cmd-1", ShowMail, None),
        KeyBinding::new("cmd-2", ShowTodo, None),
        KeyBinding::new("cmd-3", ShowNotes, None),
        KeyBinding::new("escape", CloseSettings, Some("Settings")),
    ]);
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum AppId {
    Mail,
    Todo,
    Notes,
}

impl AppId {
    /// In rail order; ⌘1, ⌘2, … follow it.
    const ALL: [AppId; 3] = [AppId::Mail, AppId::Todo, AppId::Notes];

    fn key(self) -> &'static str {
        match self {
            AppId::Mail => "mail",
            AppId::Todo => "todo",
            AppId::Notes => "notes",
        }
    }

    fn name(self) -> &'static str {
        match self {
            AppId::Mail => "Even mailen",
            AppId::Todo => "Even doen",
            AppId::Notes => "Even noteren",
        }
    }

    fn icon(self) -> &'static str {
        match self {
            AppId::Mail => "mail-01",
            AppId::Todo => "checkmark-square-02",
            AppId::Notes => "note-01",
        }
    }

    fn shortcut(self) -> &'static str {
        match self {
            AppId::Mail => "⌘1",
            AppId::Todo => "⌘2",
            AppId::Notes => "⌘3",
        }
    }
}

/// Shown in the rail, greyed out, until they are built.
const UPCOMING: [(&str, &str); 3] = [
    ("Even plannen", "calendar-03"),
    ("Even uren", "clock-01"),
    ("Even chatten", "bubble-chat"),
];

const APP_PREF: &str = "even.desktop.app";

/// The rail's width and how far the apps' panels start past it (`--stage-inset`).
const RAIL_WIDTH: f32 = 80.;
const STAGE_INSET: f32 = 4.;

/// rail.tsx: a rail tooltip shows after 300 ms, at once when another was
/// showing up to 400 ms ago, and 10 points right of its button.
const TIP_DELAY: Duration = Duration::from_millis(300);
const TIP_SKIP_DELAY: Duration = Duration::from_millis(400);
const TIP_OFFSET: f32 = 10.;
/// desktop.css: the rail's buttons, the gap between them and the room around.
const RAIL_BUTTON: f32 = 40.;
const RAIL_GAP: f32 = 6.;
const RAIL_TOP: f32 = 52.;
const RAIL_BOTTOM: f32 = 18.;
/// `.app-rail-button::before`: the selected bar grows to this in 180 ms.
const BAR_HEIGHT: f32 = 18.;
const BAR_TIME: Duration = Duration::from_millis(180);

/// A button of the rail, for its tooltip: counted from the top, or from the foot.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum RailSpot {
    Top(usize),
    Foot(usize),
}

struct RailTip {
    spot: RailSpot,
    label: SharedString,
    hint: SharedString,
    shown: bool,
}

/// The pages the window itself has, before the apps' own.
const ACCOUNT: &str = "account";
const APPEARANCE: &str = "appearance";
const ABOUT: &str = "about";

/// Which settings page shows: a shared one by its id, or an app's own.
#[derive(Clone, PartialEq, Eq, Debug)]
enum PageKey {
    Shared(SharedString),
    Own(AppId, SharedString),
}

struct NavPage {
    key: PageKey,
    label: SharedString,
    icon: &'static str,
    /// The app's name for its own pages; none for the shared ones.
    group: Option<&'static str>,
    keywords: Vec<SharedString>,
}

struct Settings {
    page: Option<PageKey>,
    search: Entity<InputState>,
    focus: FocusHandle,
    signing_out: bool,
}

struct Apps {
    client: Client,
    user: Option<User>,
    active: AppId,
    mail: Entity<MailView>,
    /// These two start the first time they are opened, and then stay.
    todo: Option<Entity<TodoApp>>,
    notes: Option<Entity<NotesApp>>,
    settings: Option<Settings>,
    _subscriptions: Vec<Subscription>,
}

enum Screen {
    SignIn { waiting: Option<String>, error: bool },
    Apps(Box<Apps>),
}

pub struct Shell {
    screen: Screen,
    /// Ends the sign-in that is waiting for the browser.
    cancel: Arc<AtomicBool>,
    /// The mail cache, kept here so signing out can close and delete it.
    store: Option<Arc<store::Store>>,
    /// A downloaded version and looking for one: the rail and the About page.
    updates: Entity<Updates>,
    /// The rail tooltip that waits or shows, and when the last one left.
    rail_tip: Option<RailTip>,
    rail_tip_left: Option<Instant>,
    /// Counts hovers, so a tooltip's wait knows whether it is still wanted.
    rail_hovers: usize,
    /// The app that was open before this one, and how many switches there
    /// were: the selected bar moves from the one to the other.
    left_app: Option<AppId>,
    switches: usize,
    _subscriptions: Vec<Subscription>,
}

/// What signing out leaves on this computer besides the session and the mail
/// cache with its reply drafts (store.rs): notes that were not saved yet
/// (src/notes/note.rs keeps them per user in `note-drafts`).
fn forget_drafts() {
    if let Some(dir) = auth::data_dir() {
        let _ = std::fs::remove_dir_all(dir.join("note-drafts"));
    }
}

fn stored_app() -> AppId {
    // `EVEN_APP=todo` opens that app without touching what the user had open.
    let stored = std::env::var("EVEN_APP").ok().or_else(|| prefs::get(APP_PREF));
    AppId::ALL
        .into_iter()
        .find(|app| Some(app.key()) == stored.as_deref())
        .unwrap_or(AppId::Mail)
}

impl Shell {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        // "System" follows the Mac when it turns light or dark.
        let appearance = cx.observe_window_appearance(window, |_, _, cx| theme::apply(cx));
        let updates = cx.new(Updates::new);
        // Where the window is and how big, for the next launch.
        even_window::remember(window, cx);
        let bounds = cx.observe_window_bounds(window, |_, window, cx| even_window::remember(window, cx));
        let ready = cx.observe(&updates, |_, _, cx| cx.notify());
        let mut shell = Self {
            screen: Screen::SignIn {
                waiting: None,
                error: false,
            },
            cancel: Arc::new(AtomicBool::new(false)),
            store: None,
            updates,
            rail_tip: None,
            rail_tip_left: None,
            rail_hovers: 0,
            left_app: None,
            switches: 0,
            _subscriptions: vec![appearance, bounds, ready],
        };
        // `EVEN_SHELL_DEBUG=tip` (or `update-tip`, with EVEN_UPDATE_DEBUG=ready)
        // shows a rail tooltip without the pointer, for scripts/shot.sh.
        match std::env::var("EVEN_SHELL_DEBUG").as_deref() {
            Ok("tip") => {
                shell.rail_tip = Some(RailTip {
                    spot: RailSpot::Top(1),
                    label: AppId::Todo.name().into(),
                    hint: AppId::Todo.shortcut().into(),
                    shown: true,
                })
            }
            Ok("update-tip") => {
                shell.rail_tip = Some(RailTip {
                    spot: RailSpot::Foot(1),
                    label: t("Restart to update", "Herstart om bij te werken").into(),
                    hint: "9.9.9".into(),
                    shown: true,
                })
            }
            _ => {}
        }
        match auth::stored_token() {
            Some(token) => shell.show_apps(token, window, cx),
            // desktop.tsx, Gate: signed out, the mail of whoever used Even
            // last leaves this computer, also when that was found at launch.
            None => {
                store::forget();
                forget_drafts();
            }
        }
        shell
    }

    fn show_apps(&mut self, token: String, window: &mut Window, cx: &mut Context<Self>) {
        let client = Client::new(token);
        let store = store::Store::open();
        self.store = Some(store.clone());
        let mail = cx.new(|cx| MailView::new(client.clone(), store, window, cx));
        let subscriptions = vec![
            cx.subscribe(&mail, |this, _, _: &SignedOut, cx| this.signed_out(cx)),
            cx.subscribe_in(&mail, window, |this, _, event: &AppEvent, window, cx| {
                this.app_event(AppId::Mail, event, window, cx)
            }),
        ];
        self.screen = Screen::Apps(Box::new(Apps {
            client: client.clone(),
            user: None,
            active: AppId::Mail,
            mail,
            todo: None,
            notes: None,
            settings: None,
            _subscriptions: subscriptions,
        }));
        self.select(stored_app(), window, cx);
        // Opening at the app of last time is no switch: its bar is just there.
        self.left_app = None;
        self.switches = 0;
        self.load_user(client, cx);
        // `EVEN_SETTINGS=connections` or `EVEN_SETTINGS=mail:signatures` opens
        // the settings at that page (`<page>` for a shared one, `<app>:<page>`
        // for an app's own), to look at with scripts/shot.sh.
        if let Ok(wanted) = std::env::var("EVEN_SETTINGS") {
            let page = match wanted.split_once(':') {
                Some((app, page)) => AppId::ALL
                    .into_iter()
                    .find(|id| id.key() == app)
                    .map(|app| PageKey::Own(app, page.to_string().into())),
                None => Some(PageKey::Shared(wanted.into())),
            };
            self.open_settings(page, window, cx);
        }
        cx.notify();
    }

    /// Who is signed in, for the account page and the apps that need a name.
    fn load_user(&mut self, client: Client, cx: &mut Context<Self>) {
        let task = cx.background_executor().spawn(async move { client.session() });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |this, cx| match result {
                Ok(user) => {
                    if let Screen::Apps(apps) = &mut this.screen {
                        apps.user = Some(user);
                        cx.notify();
                    }
                }
                // Only when the API says there is no session; offline, the cache is what shows.
                Err(error) if error.downcast_ref::<Unauthorized>().is_some() => this.signed_out(cx),
                Err(_) => {}
            });
        })
        .detach();
    }

    fn app_event(&mut self, app: AppId, event: &AppEvent, window: &mut Window, cx: &mut Context<Self>) {
        match event {
            AppEvent::SignedOut => self.signed_out(cx),
            AppEvent::OpenSettings(page) => {
                let page = page.map(|page| PageKey::Own(app, page.into()));
                self.open_settings(page, window, cx);
            }
            AppEvent::Show => {
                self.close_settings(window, cx);
                self.select(app, window, cx);
            }
        }
    }

    /// Shows `app`, starting it when this is its first time.
    fn select(&mut self, app: AppId, window: &mut Window, cx: &mut Context<Self>) {
        let Screen::Apps(apps) = &mut self.screen else { return };
        if apps.active != app {
            self.left_app = Some(apps.active);
            self.switches += 1;
        }
        apps.active = app;
        if std::env::var_os("EVEN_APP").is_none() {
            prefs::set(APP_PREF, app.key());
        }
        self.ensure(app, window, cx);
        self.sync_covered(window, cx);
        let Screen::Apps(apps) = &mut self.screen else { return };
        if apps.settings.is_none() {
            match app {
                AppId::Mail => apps.mail.update(cx, |mail, cx| mail.activated(window, cx)),
                AppId::Todo => {
                    if let Some(todo) = &apps.todo {
                        todo.update(cx, |todo, cx| todo.activated(window, cx));
                    }
                }
                AppId::Notes => {
                    if let Some(notes) = &apps.notes {
                        notes.update(cx, |notes, cx| notes.activated(window, cx));
                    }
                }
            }
        }
        cx.notify();
    }

    /// Starts an app that has not run yet. Needs the user, so it waits for it.
    fn ensure(&mut self, app: AppId, window: &mut Window, cx: &mut Context<Self>) {
        let Screen::Apps(apps) = &mut self.screen else { return };
        let Some(user) = apps.user.clone() else {
            // The session is still being read: come back once it is.
            if app != AppId::Mail {
                let client = apps.client.clone();
                let task = cx.background_executor().spawn(async move { client.session() });
                cx.spawn_in(window, async move |this, cx| {
                    if let Ok(user) = task.await {
                        let _ = this.update_in(cx, |this, window, cx| {
                            if let Screen::Apps(apps) = &mut this.screen {
                                apps.user.get_or_insert(user);
                            }
                            this.ensure(app, window, cx);
                            cx.notify();
                        });
                    }
                })
                .detach();
            }
            return;
        };
        match app {
            AppId::Mail => {}
            AppId::Todo if apps.todo.is_none() => {
                let client = apps.client.clone();
                let todo = cx.new(|cx| TodoApp::new(client, user, window, cx));
                apps._subscriptions
                    .push(cx.subscribe_in(&todo, window, |this, _, event: &AppEvent, window, cx| {
                        this.app_event(AppId::Todo, event, window, cx)
                    }));
                if apps.active == AppId::Todo && apps.settings.is_none() {
                    todo.update(cx, |todo, cx| todo.activated(window, cx));
                }
                apps.todo = Some(todo);
            }
            AppId::Notes if apps.notes.is_none() => {
                let client = apps.client.clone();
                let notes = cx.new(|cx| NotesApp::new(client, user, window, cx));
                apps._subscriptions
                    .push(cx.subscribe_in(&notes, window, |this, _, event: &AppEvent, window, cx| {
                        this.app_event(AppId::Notes, event, window, cx)
                    }));
                if apps.active == AppId::Notes && apps.settings.is_none() {
                    notes.update(cx, |notes, cx| notes.activated(window, cx));
                }
                apps.notes = Some(notes);
            }
            _ => {}
        }
    }

    /// Tells each app whether it is on screen with nothing over it.
    fn sync_covered(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Screen::Apps(apps) = &self.screen else { return };
        let settings = apps.settings.is_some();
        let active = apps.active;
        apps.mail.update(cx, |mail, cx| {
            EvenApp::set_covered(mail, settings || active != AppId::Mail, window, cx)
        });
        if let Some(todo) = &apps.todo {
            todo.update(cx, |todo, cx| todo.set_covered(settings || active != AppId::Todo, window, cx));
        }
        if let Some(notes) = &apps.notes {
            notes.update(cx, |notes, cx| notes.set_covered(settings || active != AppId::Notes, window, cx));
        }
    }

    // Signing in and out.

    /// The session is gone (signed out here, or the API said so): forget
    /// everything of it on this computer and show the sign-in screen.
    fn signed_out(&mut self, cx: &mut Context<Self>) {
        auth::forget_token();
        // The cache holds mail: it goes with the session.
        match self.store.take() {
            Some(store) => store.forget(),
            None => store::forget(),
        }
        forget_drafts();
        self.rail_tip = None;
        self.left_app = None;
        self.screen = Screen::SignIn {
            waiting: None,
            error: false,
        };
        cx.notify();
    }

    /// Signs out on the server too, then here.
    fn sign_out(&mut self, cx: &mut Context<Self>) {
        let Screen::Apps(apps) = &mut self.screen else { return };
        if let Some(settings) = &mut apps.settings {
            settings.signing_out = true;
        }
        let client = apps.client.clone();
        let task = cx.background_executor().spawn(async move { client.sign_out() });
        cx.spawn(async move |this, cx| {
            // Offline or not: this computer forgets the session.
            let _ = task.await;
            let _ = this.update(cx, |this, cx| this.signed_out(cx));
        })
        .detach();
        cx.notify();
    }

    fn start_sign_in(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let attempt = match auth::Attempt::start() {
            Ok(attempt) => attempt,
            Err(_) => {
                self.screen = Screen::SignIn {
                    waiting: None,
                    error: true,
                };
                cx.notify();
                return;
            }
        };
        self.cancel.store(true, Ordering::SeqCst);
        let cancel = Arc::new(AtomicBool::new(false));
        self.cancel = cancel.clone();
        cx.open_url(&attempt.url);
        self.screen = Screen::SignIn {
            waiting: Some(attempt.url.clone()),
            error: false,
        };
        cx.notify();
        let task = cx.background_executor().spawn(async move { attempt.finish(cancel) });
        cx.spawn_in(window, async move |this, cx| {
            let result = task.await;
            let _ = this.update_in(cx, |this, window, cx| {
                if !matches!(this.screen, Screen::SignIn { waiting: Some(_), .. }) {
                    return;
                }
                match result {
                    Ok(token) => {
                        auth::store_token(&token);
                        this.show_apps(token, window, cx);
                        cx.activate(true);
                    }
                    Err(error) if error.to_string() == "cancelled" => {}
                    Err(_) => {
                        this.screen = Screen::SignIn {
                            waiting: None,
                            error: true,
                        };
                        cx.notify();
                    }
                }
            });
        })
        .detach();
    }

    fn cancel_sign_in(&mut self, cx: &mut Context<Self>) {
        self.cancel.store(true, Ordering::SeqCst);
        self.screen = Screen::SignIn {
            waiting: None,
            error: false,
        };
        cx.notify();
    }

    /// apps/desktop/src/sign-in.tsx: the brand at the top, the form in the middle.
    fn render_sign_in(&self, waiting: Option<String>, error: bool, cx: &mut Context<Self>) -> impl IntoElement {
        let tall = |button: Stateful<Div>| button.h(px(42.));
        let form = div()
            .flex()
            .flex_col()
            .gap(px(28.))
            .w(px(380.))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(8.))
                    .child(
                        div()
                            .text_size(px(28.))
                            .line_height(px(35.))
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(t("Welcome to Even", "Welkom bij Even")),
                    )
                    .child(
                        div()
                            .text_size(px(14.))
                            .line_height(px(24.))
                            .text_color(theme::muted())
                            .child(if waiting.is_some() {
                                t("Finish signing in in your browser.", "Rond het inloggen af in je browser.")
                            } else {
                                t(
                                    "Sign in with your Even account. That happens in your browser, so you sign in once for every Even app.",
                                    "Log in met je Even-account. Dat gaat via je browser, zo log je in één keer in voor alle Even-apps.",
                                )
                            }),
                    ),
            )
            .when(error, |el| {
                el.child(
                    div()
                        .px(px(12.))
                        .py(px(10.))
                        .rounded(theme::RADIUS)
                        .border_1()
                        .border_color(theme::mix(theme::danger(), 40.))
                        .bg(theme::mix(theme::danger(), 8.))
                        .text_size(px(14.))
                        .text_color(theme::danger())
                        .child(t(
                            "Signing in didn't work. Try again.",
                            "Inloggen is niet gelukt. Probeer het opnieuw.",
                        )),
                )
            })
            .map(|el| match waiting {
                Some(url) => el.child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(12.))
                        .child(ui::disabled(tall(
                            ui::button(
                                "signing-in",
                                t("Sign in with your browser", "Inloggen via je browser"),
                                Variant::Primary,
                            )
                            .child(ui::spinner()),
                        )))
                        .child(
                            div()
                                .flex()
                                .gap(px(12.))
                                .child(
                                    tall(ui::button(
                                        "again",
                                        t("Open the browser again", "Browser opnieuw openen"),
                                        Variant::Outline,
                                    ))
                                    .flex_1()
                                    .on_click(move |_, _, cx| cx.open_url(&url)),
                                )
                                .child(
                                    tall(ui::button("cancel", t("Cancel", "Annuleren"), Variant::Ghost))
                                        .on_click(cx.listener(|this, _, _, cx| this.cancel_sign_in(cx))),
                                ),
                        ),
                ),
                None => el.child(
                    tall(ui::button(
                        "sign-in",
                        t("Sign in with your browser", "Inloggen via je browser"),
                        Variant::Primary,
                    ))
                    .child(theme::hi("arrow-up-right-01").text_color(theme::primary_foreground()))
                    .on_click(cx.listener(|this, _, window, cx| this.start_sign_in(window, cx))),
                ),
            })
            .child(
                div()
                    .flex()
                    .justify_center()
                    .gap(px(5.))
                    .text_size(px(14.))
                    .text_color(theme::muted())
                    .child(t("No account yet?", "Nog geen account?"))
                    .child(
                        div()
                            .id("create-account")
                            .text_size(px(13.))
                            .text_color(theme::foreground())
                            .underline()
                            .cursor_pointer()
                            .hover(|el| el.text_color(theme::primary_mark()))
                            .child(t("Create one", "Maak er een"))
                            .on_click(|_, _, cx| cx.open_url(&format!("{}/signup", api::auth_url()))),
                    ),
            );
        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(theme::sidebar())
            .text_color(theme::foreground())
            .child(
                // The window buttons sit above the brand; the strip drags the window.
                div()
                    .window_control_area(WindowControlArea::Drag)
                    .pt(px(44.))
                    .pb(px(28.))
                    .px(px(36.))
                    .child(brand()),
            )
            .child(
                div()
                    .flex()
                    .flex_1()
                    .items_center()
                    .justify_center()
                    .pt(px(32.))
                    .px(px(24.))
                    .pb(px(72.))
                    .child(form),
            )
    }

    // The rail.

    /// The pointer came over a rail button or left it: its tooltip waits
    /// 300 ms, or shows at once when another one was just showing.
    fn rail_hover(&mut self, spot: RailSpot, label: SharedString, hint: SharedString, hovered: bool, cx: &mut Context<Self>) {
        if hovered {
            self.rail_hovers += 1;
            let hover = self.rail_hovers;
            let at_once = self.rail_tip.as_ref().is_some_and(|tip| tip.shown)
                || self.rail_tip_left.is_some_and(|left| left.elapsed() <= TIP_SKIP_DELAY);
            self.rail_tip = Some(RailTip {
                spot,
                label,
                hint,
                shown: at_once,
            });
            if !at_once {
                cx.spawn(async move |this, cx| {
                    cx.background_executor().timer(TIP_DELAY).await;
                    let _ = this.update(cx, |this, cx| {
                        if this.rail_hovers != hover {
                            return;
                        }
                        if let Some(tip) = &mut this.rail_tip {
                            tip.shown = true;
                            cx.notify();
                        }
                    });
                })
                .detach();
            }
        } else if self.rail_tip.as_ref().is_some_and(|tip| tip.spot == spot) {
            self.rail_hovers += 1;
            if self.rail_tip.take().is_some_and(|tip| tip.shown) {
                self.rail_tip_left = Some(Instant::now());
            }
        }
        cx.notify();
    }

    fn rail_hovers(
        spot: RailSpot,
        label: SharedString,
        hint: SharedString,
        cx: &mut Context<Self>,
    ) -> impl Fn(&bool, &mut Window, &mut App) + 'static {
        let this = cx.weak_entity();
        move |hovered: &bool, _: &mut Window, cx: &mut App| {
            let _ = this.update(cx, |this, cx| this.rail_hover(spot, label.clone(), hint.clone(), *hovered, cx));
        }
    }

    /// A press takes the tooltip away, as on the web.
    fn rail_pressed(&mut self) {
        self.rail_hovers += 1;
        self.rail_tip = None;
    }

    /// The web's TooltipContent, `side="right" sideOffset={10}`: beside its
    /// button, over whatever the app shows there.
    fn render_rail_tip(&self) -> Option<impl IntoElement> {
        const HEIGHT: f32 = 28.;
        let tip = self.rail_tip.as_ref().filter(|tip| tip.shown)?;
        let along = |index: usize| px(index as f32 * (RAIL_BUTTON + RAIL_GAP) + (RAIL_BUTTON - HEIGHT) / 2.);
        // The button sits midway between the window's edge and the panels.
        let button_right = STAGE_INSET + (RAIL_WIDTH - STAGE_INSET + RAIL_BUTTON) / 2.;
        let bubble = div()
            .absolute()
            .left(px(button_right + TIP_OFFSET))
            .map(|el| match tip.spot {
                RailSpot::Top(index) => el.top(px(RAIL_TOP) + along(index)),
                RailSpot::Foot(index) => el.bottom(px(RAIL_BOTTOM) + along(index)),
            })
            .h(px(HEIGHT))
            .flex()
            .items_center()
            .gap(px(6.))
            .px(px(12.))
            .rounded(theme::RADIUS_MD)
            .bg(theme::foreground())
            .text_size(px(12.))
            .line_height(px(16.))
            .text_color(theme::background())
            .whitespace_nowrap()
            .child(tip.label.clone())
            .when(!tip.hint.is_empty(), |el| el.child(div().opacity(0.6).child(tip.hint.clone())));
        Some(deferred(bubble).with_priority(1))
    }

    fn render_rail(&self, apps: &Apps, cx: &mut Context<Self>) -> impl IntoElement {
        let active = apps.active;
        let edge = -(RAIL_WIDTH + STAGE_INSET - RAIL_BUTTON) / 2.;
        // `.app-rail-button::before`: a short bar on the window's edge, centred on the button.
        let bar = |height: f32| {
            div()
                .absolute()
                .left(px(edge))
                .top(px((RAIL_BUTTON - height) / 2.))
                .w(px(3.))
                .h(px(height))
                .rounded_r(px(3.))
                .bg(theme::primary_mark())
        };
        let moving = |id: (&'static str, usize), grows: bool| {
            bar(BAR_HEIGHT).with_animation(
                id,
                Animation::new(BAR_TIME).with_easing(ease_in_out),
                move |el, delta| {
                    let height = BAR_HEIGHT * if grows { delta } else { 1. - delta };
                    el.top(px((RAIL_BUTTON - height) / 2.)).h(px(height))
                },
            )
        };
        let switches = self.switches;
        let left = self.left_app;
        // `.app-rail-button`: 40 square, round corners, its sign 20 in the quiet colour.
        let rail_button = |id: SharedString, icon: &'static str, selected: bool, label: SharedString| {
            let group = SharedString::from(format!("rail-{id}"));
            div()
                .id(id)
                .group(group.clone())
                .role(Role::Button)
                .aria_label(label)
                .relative()
                .flex()
                .flex_none()
                .items_center()
                .justify_center()
                .size(px(RAIL_BUTTON))
                .rounded(px(12.))
                .when(selected, |el| {
                    // The open app looks like the panels: raised, with the accent on its sign.
                    el.bg(theme::sidebar()).shadow(vec![
                        BoxShadow {
                            color: theme::border().into(),
                            offset: point(px(0.), px(0.)),
                            blur_radius: px(0.),
                            spread_radius: px(1.),
                            inset: false,
                        },
                        BoxShadow {
                            color: theme::mix(theme::foreground(), 10.).into(),
                            offset: point(px(0.), px(1.)),
                            blur_radius: px(3.),
                            spread_radius: px(0.),
                            inset: false,
                        },
                    ])
                })
                .child(
                    theme::hi(icon)
                        .size(px(20.))
                        .text_color(if selected {
                            theme::primary_mark()
                        } else {
                            theme::muted()
                        })
                        .when(!selected, |el| el.group_hover(group, |el| el.text_color(theme::foreground()))),
                )
        };
        let hovers = Self::rail_hovers;
        let app_buttons = AppId::ALL
            .into_iter()
            .enumerate()
            .map(|(index, app)| {
                let selected = app == active;
                rail_button(app.key().into(), app.icon(), selected, app.name().into())
                    .aria_keyshortcuts(app.shortcut())
                    .cursor_pointer()
                    .when(!selected, |el| el.hover(|el| el.bg(theme::mix(theme::foreground(), 6.))))
                    // The bar moves from the app that was open to this one.
                    .when(selected && switches == 0, |el| el.child(bar(BAR_HEIGHT)))
                    .when(selected && switches > 0, |el| el.child(moving(("rail-bar-in", switches), true)))
                    .when(!selected && left == Some(app), |el| {
                        el.child(moving(("rail-bar-out", switches), false))
                    })
                    .on_hover(hovers(RailSpot::Top(index), app.name().into(), app.shortcut().into(), cx))
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.rail_pressed();
                        this.select(app, window, cx)
                    }))
                    .into_any_element()
            })
            .collect::<Vec<_>>();
        let soon: SharedString = t("Coming soon", "Binnenkort").into();
        let upcoming = UPCOMING
            .into_iter()
            .enumerate()
            .map(|(index, (name, icon))| {
                // `.is-upcoming`: greyed out, a little less on hover, and the
                // tooltip still says what is coming.
                div()
                    .id(SharedString::from(format!("rail-upcoming-{index}")))
                    .role(Role::Button)
                    .aria_label(format!("{name}, {}", soon.to_lowercase()))
                    .flex()
                    .flex_none()
                    .items_center()
                    .justify_center()
                    .size(px(RAIL_BUTTON))
                    .rounded(px(12.))
                    .opacity(0.38)
                    .hover(|el| el.opacity(0.55))
                    .child(theme::hi(icon).size(px(20.)).text_color(theme::muted()))
                    .on_hover(hovers(RailSpot::Top(AppId::ALL.len() + index), name.into(), soon.clone(), cx))
                    .into_any_element()
            })
            .collect::<Vec<_>>();
        let settings_label: SharedString = t("Settings", "Instellingen").into();
        // packages/ui desktop-app.tsx, UpdateButton: once a new version is
        // ready, in the accent, so it is seen without shouting.
        let update = self.updates.read(cx);
        let (ready, restarting) = (update.ready().map(str::to_string), update.restarting());
        let update_button = ready.map(|version| {
            let label: SharedString = if restarting {
                t("Restarting…", "Herstarten…")
            } else {
                t("Restart to update", "Herstart om bij te werken")
            }
            .into();
            let version = SharedString::from(version);
            let updates = self.updates.clone();
            div()
                .id("rail-update")
                .role(Role::Button)
                .aria_label(format!("{label}, {version}"))
                .flex()
                .flex_none()
                .items_center()
                .justify_center()
                .size(px(RAIL_BUTTON))
                .rounded(px(12.))
                .bg(theme::mix(theme::primary_mark(), 14.))
                .child(theme::hi("refresh").size(px(20.)).text_color(theme::primary_mark()))
                .on_hover(hovers(RailSpot::Foot(1), label, version, cx))
                .map(|el| {
                    if restarting {
                        el.opacity(0.6)
                    } else {
                        el.cursor_pointer()
                            .hover(|el| el.bg(theme::mix(theme::primary_mark(), 22.)))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.rail_pressed();
                                updates.update(cx, |updates, cx| updates.install(cx));
                            }))
                    }
                })
        });
        div()
            .w(px(RAIL_WIDTH))
            .h_full()
            .flex_none()
            .relative()
            .flex()
            .flex_col()
            .items_center()
            .justify_between()
            .pl(px(STAGE_INSET))
            .pb(px(RAIL_BOTTOM))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .items_center()
                    .w_full()
                    // On macOS the window buttons sit across its top; that strip drags the window.
                    .child(
                        div()
                            .w_full()
                            .h(px(RAIL_TOP))
                            .window_control_area(WindowControlArea::Drag),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .items_center()
                            .gap(px(RAIL_GAP))
                            .children(app_buttons)
                            .children(upcoming),
                    ),
            )
            .child(
                // `.app-rail-foot`: "restart to update", then the settings of every app.
                div()
                    .flex()
                    .flex_col()
                    .items_center()
                    .gap(px(RAIL_GAP))
                    .children(update_button)
                    .child(
                        rail_button("settings".into(), "settings-01", false, settings_label.clone())
                            .aria_keyshortcuts("⌘,")
                            .cursor_pointer()
                            .hover(|el| el.bg(theme::mix(theme::foreground(), 6.)))
                            .on_hover(hovers(RailSpot::Foot(0), settings_label, "⌘,".into(), cx))
                            .on_click(cx.listener(|this, _, window, cx| {
                                this.rail_pressed();
                                this.open_settings(None, window, cx)
                            })),
                    ),
            )
            .children(self.render_rail_tip())
    }

    // The settings window.

    fn open_settings(&mut self, page: Option<PageKey>, window: &mut Window, cx: &mut Context<Self>) {
        let Screen::Apps(apps) = &mut self.screen else { return };
        match &mut apps.settings {
            // ⌘, while it is open leaves the page as it is.
            Some(settings) => {
                if page.is_some() {
                    settings.page = page;
                }
            }
            None => {
                let search = cx.new(|cx| InputState::new(window, cx).placeholder(t("Search", "Zoeken")));
                cx.observe(&search, |_, _, cx| cx.notify()).detach();
                let focus = cx.focus_handle();
                window.focus(&focus, cx);
                apps.settings = Some(Settings {
                    page,
                    search,
                    focus,
                    signing_out: false,
                });
                // The settings hold every app's pages, so while they are open every app runs.
                for app in AppId::ALL {
                    self.ensure(app, window, cx);
                }
            }
        }
        self.sync_covered(window, cx);
        cx.notify();
    }

    fn close_settings(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Screen::Apps(apps) = &mut self.screen else { return };
        if apps.settings.take().is_none() {
            return;
        }
        let active = apps.active;
        self.select(active, window, cx);
    }

    fn app_pages(apps: &Apps, app: AppId, cx: &App) -> Vec<SettingsPage> {
        match app {
            AppId::Mail => apps.mail.read(cx).settings_pages(cx),
            AppId::Todo => apps
                .todo
                .as_ref()
                .map(|todo| todo.read(cx).settings_pages(cx))
                .unwrap_or_default(),
            AppId::Notes => apps
                .notes
                .as_ref()
                .map(|notes| notes.read(cx).settings_pages(cx))
                .unwrap_or_default(),
        }
    }

    /// The nav: shared pages first, merged by id, then each app's own under its name.
    fn nav_pages(apps: &Apps, cx: &App) -> Vec<NavPage> {
        let words = |list: &str| list.split(" | ").map(SharedString::new).collect::<Vec<_>>();
        let mut shared = vec![
            NavPage {
                key: PageKey::Shared(ACCOUNT.into()),
                label: "Account".into(),
                icon: "user-circle",
                group: None,
                keywords: words("profiel | naam | e-mail | wachtwoord | uitloggen | profile | name | email | password | sign out"),
            },
            NavPage {
                key: PageKey::Shared(APPEARANCE.into()),
                label: t("Appearance", "Weergave").into(),
                icon: "paint-board",
                group: None,
                keywords: words("thema | donker | dark mode | licht | kleur | taal | appearance | theme | language"),
            },
        ];
        let mut own = Vec::new();
        for app in AppId::ALL {
            for page in Self::app_pages(apps, app, cx) {
                if page.shared {
                    let key = PageKey::Shared(page.id.into());
                    match shared.iter_mut().find(|item| item.key == key) {
                        Some(existing) => existing.keywords.extend(page.keywords),
                        None => shared.push(NavPage {
                            key,
                            label: page.label,
                            icon: page.icon,
                            group: None,
                            keywords: page.keywords,
                        }),
                    }
                } else {
                    own.push(NavPage {
                        key: PageKey::Own(app, page.id.into()),
                        label: page.label,
                        icon: page.icon,
                        group: Some(app.name()),
                        keywords: page.keywords,
                    });
                }
            }
        }
        shared.push(NavPage {
            key: PageKey::Shared(ABOUT.into()),
            label: t("About", "Over").into(),
            icon: "information-circle",
            group: None,
            keywords: words("versie | update | version | privacy | broncode | source"),
        });
        shared.extend(own);
        shared
    }

    /// The open page's content: the window's own pages, or each app's part.
    fn render_page(&mut self, key: &PageKey, window: &mut Window, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let Screen::Apps(apps) = &self.screen else {
            return Vec::new();
        };
        match key {
            PageKey::Shared(id) if id.as_ref() == ACCOUNT => vec![self.render_account(apps, cx).into_any_element()],
            PageKey::Shared(id) if id.as_ref() == APPEARANCE => vec![self.render_appearance(cx).into_any_element()],
            PageKey::Shared(id) if id.as_ref() == ABOUT => self.render_about(cx),
            PageKey::Shared(id) => {
                // Every app that has a part in the page, in rail order.
                let mail = apps.mail.clone();
                let todo = apps.todo.clone();
                let notes = apps.notes.clone();
                let has = |pages: Vec<SettingsPage>| pages.iter().any(|page| page.shared && page.id == id.as_ref());
                let mut parts = Vec::new();
                if has(mail.read(cx).settings_pages(cx)) {
                    parts.push(mail.update(cx, |mail, cx| mail.render_settings(id, window, cx)));
                }
                if let Some(todo) = todo {
                    if has(todo.read(cx).settings_pages(cx)) {
                        parts.push(todo.update(cx, |todo, cx| todo.render_settings(id, window, cx)));
                    }
                }
                if let Some(notes) = notes {
                    if has(notes.read(cx).settings_pages(cx)) {
                        parts.push(notes.update(cx, |notes, cx| notes.render_settings(id, window, cx)));
                    }
                }
                parts
            }
            PageKey::Own(app, id) => {
                let part = match app {
                    AppId::Mail => Some(apps.mail.clone().update(cx, |mail, cx| mail.render_settings(id, window, cx))),
                    AppId::Todo => apps
                        .todo
                        .clone()
                        .map(|todo| todo.update(cx, |todo, cx| todo.render_settings(id, window, cx))),
                    AppId::Notes => apps
                        .notes
                        .clone()
                        .map(|notes| notes.update(cx, |notes, cx| notes.render_settings(id, window, cx))),
                };
                part.into_iter().collect()
            }
        }
    }

    /// packages/ui/src/components/account-site.tsx.
    fn render_account(&self, apps: &Apps, cx: &mut Context<Self>) -> impl IntoElement {
        let (name, email) = match &apps.user {
            Some(user) if !user.name.is_empty() => (user.name.clone(), Some(SharedString::from(user.email.clone()))),
            Some(user) => (user.email.clone(), None),
            None => (String::new(), None),
        };
        let signing_out = apps.settings.as_ref().is_some_and(|settings| settings.signing_out);
        let sign_out = ui::button(
            "sign-out",
            if signing_out {
                t("Signing out…", "Uitloggen…")
            } else {
                t("Sign out", "Uitloggen")
            },
            Variant::Outline,
        );
        ui::settings_section(
            t("Your Even account", "Je Even-account"),
            Some(
                t(
                    "Name, email address, password and signed-in devices, for every Even app.",
                    "Naam, e-mailadres, wachtwoord en ingelogde apparaten, voor alle Even-apps.",
                )
                .into(),
            ),
            vec![
                ui::settings_row(
                    name,
                    email,
                    ui::button("manage-account", t("Manage account", "Account beheren"), Variant::Outline)
                        .child(theme::hi("arrow-up-right-01"))
                        .on_click(|_, _, cx| cx.open_url(&format!("{}/", api::auth_url()))),
                )
                .into_any_element(),
                ui::settings_row(
                    t("Sign out", "Uitloggen"),
                    Some(t("Of this app on this device.", "Uit deze app op dit apparaat.").into()),
                    if signing_out {
                        ui::disabled(sign_out)
                    } else {
                        sign_out.on_click(cx.listener(|this, _, _, cx| this.sign_out(cx)))
                    },
                )
                .into_any_element(),
            ],
        )
    }

    /// apps/todo-web/src/components/settings/appearance-settings.tsx.
    fn render_appearance(&self, _cx: &mut Context<Self>) -> impl IntoElement {
        let choice = theme::choice();
        let themes = [
            (theme::Choice::Light, t("Light", "Licht"), "sun-03"),
            (theme::Choice::Dark, t("Dark", "Donker"), "moon-02"),
            (theme::Choice::System, t("System", "Systeem"), "computer"),
        ];
        let theme_select = ui::select(
            "theme-select",
            themes
                .iter()
                .map(|(value, label, icon)| ui::SelectOption::new(*label).icon(icon).selected(*value == choice))
                .collect(),
            move |index, _, cx| theme::set_choice(themes[index].0, cx),
        );
        let preference = i18n::preference();
        let languages = [None, Some(Lang::En), Some(Lang::Nl)];
        let language_select = ui::select(
            "language-select",
            languages
                .iter()
                .map(|language| {
                    // Language names stay in their own language.
                    let label = language.map_or(t("Automatic", "Automatisch"), Lang::name);
                    ui::SelectOption::new(label).selected(*language == preference)
                })
                .collect(),
            move |index, _, cx| {
                i18n::set_preference(languages[index]);
                even_window::set_menus(cx);
                cx.refresh_windows();
            },
        );
        ui::settings_section(
            t("Theme", "Thema"),
            Some(t("Applies to this device.", "Geldt voor dit apparaat.").into()),
            vec![
                ui::settings_row(
                    t("Colour scheme", "Kleurenschema"),
                    Some(
                        t(
                            "System follows your device’s light or dark mode automatically.",
                            "Systeem volgt automatisch de licht- of donkermodus van je apparaat.",
                        )
                        .into(),
                    ),
                    theme_select,
                )
                .into_any_element(),
                ui::settings_row(
                    t("Language", "Taal"),
                    Some(
                        t(
                            "Automatic follows your computer’s language.",
                            "Automatisch volgt de taal van je computer.",
                        )
                        .into(),
                    ),
                    language_select,
                )
                .into_any_element(),
            ],
        )
    }

    /// packages/ui/src/components/desktop-app.tsx, AboutSettings.
    fn render_about(&self, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let link = |id: &'static str, label: &'static str, url: &'static str| {
            ui::button_sm(id, label, Variant::Outline).on_click(move |_, _, cx| cx.open_url(url))
        };
        // The version row: what is installed, and looking for or installing a newer one.
        let update = self.updates.read(cx);
        let ready = update.ready().map(str::to_string);
        let status = update.status();
        let restarting = update.restarting();
        let updates = self.updates.clone();
        let version_help: SharedString = match &ready {
            Some(version) => t(
                format!("Version {version} is downloaded and installs when Even restarts."),
                format!("Versie {version} is gedownload en wordt geïnstalleerd als Even herstart."),
            )
            .into(),
            None if status == updates::Status::Failed => t(
                "Couldn't check for updates. Try again in a moment.",
                "Zoeken naar updates lukte niet. Probeer het zo nog eens.",
            )
            .into(),
            None => t(
                "The version of Even on this computer.",
                "De versie van Even op deze computer.",
            )
            .into(),
        };
        let update_button = if ready.is_some() {
            let button = ui::button_sm(
                "update-restart",
                if restarting {
                    t("Restarting…", "Herstarten…")
                } else {
                    t("Restart to update", "Herstart om bij te werken")
                },
                Variant::Primary,
            );
            if restarting {
                ui::disabled(button)
            } else {
                button.on_click(move |_, _, cx| updates.update(cx, |updates, cx| updates.install(cx)))
            }
        } else {
            let button = ui::button_sm(
                "update-check",
                match status {
                    updates::Status::Checking => t("Checking…", "Zoeken…"),
                    updates::Status::Current => t("Up to date", "Bijgewerkt"),
                    _ => t("Check for updates", "Zoek naar updates"),
                },
                Variant::Outline,
            );
            if status == updates::Status::Checking {
                ui::disabled(button)
            } else {
                button.on_click(move |_, _, cx| updates.update(cx, |updates, cx| updates.check(cx)))
            }
        };
        vec![
            ui::settings_section(
                "App",
                None,
                vec![
                    ui::settings_row(
                        t("Version", "Versie"),
                        Some(version_help),
                        div()
                            .flex()
                            .items_center()
                            .gap(px(8.))
                            .child(
                                div()
                                    .font_family("Menlo")
                                    .text_size(px(12.))
                                    .text_color(theme::muted())
                                    .child(env!("CARGO_PKG_VERSION")),
                            )
                            .child(update_button),
                    )
                    .into_any_element(),
                    ui::settings_row(
                        t("Download page", "Downloadpagina"),
                        Some(
                            t(
                                "Even for your other computers, on Mac and Windows.",
                                "Even voor je andere computers, op Mac en Windows.",
                            )
                            .into(),
                        ),
                        link("download", t("Open", "Openen"), "https://jornboerema.nl/download"),
                    )
                    .into_any_element(),
                ],
            )
            .into_any_element(),
            ui::settings_section(
                t("Legal", "Juridisch"),
                None,
                vec![
                    ui::settings_row(
                        t("Privacy policy", "Privacybeleid"),
                        Some(
                            t(
                                "How Even mailen handles your mail and data.",
                                "Hoe Even mailen met je mail en gegevens omgaat.",
                            )
                            .into(),
                        ),
                        link("privacy", t("View", "Bekijken"), "https://jornboerema.nl/privacy"),
                    )
                    .into_any_element(),
                    ui::settings_row(
                        t("Source code", "Broncode"),
                        Some(
                            t(
                                "Every Even app is open source on GitHub.",
                                "Elke Even-app is open source op GitHub.",
                            )
                            .into(),
                        ),
                        link("source", t("View", "Bekijken"), "https://github.com/JornBoerema/jornboerema"),
                    )
                    .into_any_element(),
                ],
            )
            .into_any_element(),
        ]
    }

    /// packages/ui/src/components/settings-dialog.tsx.
    fn render_settings(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Option<AnyElement> {
        let Screen::Apps(apps) = &self.screen else { return None };
        let settings = apps.settings.as_ref()?;
        let pages = Self::nav_pages(apps, cx);
        let active = settings
            .page
            .as_ref()
            .filter(|key| pages.iter().any(|page| &page.key == *key))
            .cloned()
            .or_else(|| pages.first().map(|page| page.key.clone()))?;
        let active_label = pages
            .iter()
            .find(|page| page.key == active)
            .map(|page| page.label.clone())
            .unwrap_or_default();
        let needle = settings.search.read(cx).value().trim().to_lowercase();
        let search = settings.search.clone();
        let focus = settings.focus.clone();
        let title = t("Settings", "Instellingen");

        let mut nav = div().flex().flex_col().gap(px(16.));
        let mut group: Option<Option<&'static str>> = None;
        let mut column = div().flex().flex_col().gap(px(4.));
        let mut any = false;
        for page in pages.iter().filter(|page| {
            needle.is_empty()
                || page.label.to_lowercase().contains(&needle)
                || page.group.is_some_and(|group| group.to_lowercase().contains(&needle))
                || page.keywords.iter().any(|word| word.to_lowercase().contains(&needle))
        }) {
            if group != Some(page.group) {
                if any {
                    nav = nav.child(column);
                    column = div().flex().flex_col().gap(px(4.));
                }
                if let Some(name) = page.group {
                    column = column.child(
                        div()
                            .px(px(12.))
                            .pb(px(4.))
                            .text_size(px(12.))
                            .text_color(theme::muted())
                            .child(name),
                    );
                }
                group = Some(page.group);
            }
            any = true;
            let selected = page.key == active;
            let key = page.key.clone();
            column = column.child(
                div()
                    .id(SharedString::from(format!("settings-nav-{:?}", page.key)))
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(px(12.))
                    .px(px(12.))
                    .py(px(8.))
                    .rounded(theme::RADIUS_MD)
                    .text_size(px(14.))
                    .cursor_pointer()
                    .map(|el| {
                        if selected {
                            el.bg(theme::background())
                                .border_1()
                                .border_color(theme::border())
                                .font_weight(FontWeight::MEDIUM)
                                .shadow_xs()
                        } else {
                            // The same box as the selected row, so nothing shifts.
                            el.border_1()
                                .border_color(gpui_kit::transparent_black())
                                .text_color(theme::muted())
                                .hover(|el| el.bg(theme::muted_bg()).text_color(theme::foreground()))
                        }
                    })
                    .child(theme::hi(page.icon).text_color(if selected {
                        theme::foreground()
                    } else {
                        theme::muted()
                    }))
                    .child(page.label.clone())
                    .on_click(cx.listener(move |this, _, _, cx| {
                        if let Screen::Apps(apps) = &mut this.screen {
                            if let Some(settings) = &mut apps.settings {
                                settings.page = Some(key.clone());
                                cx.notify();
                            }
                        }
                    })),
            );
        }
        if any {
            nav = nav.child(column);
        } else {
            nav = nav.child(
                div()
                    .px(px(12.))
                    .py(px(8.))
                    .text_size(px(14.))
                    .text_color(theme::muted())
                    .child(t("No settings found.", "Geen instellingen gevonden.")),
            );
        }

        let content = self.render_page(&active, window, cx);
        let size = window.viewport_size();
        let width = (size.width - px(32.)).min(px(1024.));
        let height = (size.height - px(32.)).min(px(760.));
        let dialog = div()
            .id("settings-window")
            .key_context("Settings")
            .track_focus(&focus)
            .on_action(cx.listener(|this, _: &CloseSettings, window, cx| this.close_settings(window, cx)))
            .occlude()
            .w(width)
            .h(height)
            .flex()
            .rounded(theme::RADIUS_XL)
            .bg(theme::popover())
            .border_1()
            .border_color(theme::border())
            .shadow_lg()
            .overflow_hidden()
            .text_color(theme::foreground())
            .child(
                div()
                    .w(px(256.))
                    .flex_none()
                    .flex()
                    .flex_col()
                    .gap(px(12.))
                    .p(px(12.))
                    .bg(theme::with_alpha(theme::muted_bg(), 0.4))
                    .border_r_1()
                    .border_color(theme::border())
                    .child(
                        div()
                            .h(px(36.))
                            .flex_none()
                            .flex()
                            .items_center()
                            .rounded(theme::RADIUS_MD)
                            .bg(theme::background())
                            .border_1()
                            .border_color(theme::border())
                            .child(
                                Input::new(&search)
                                    .appearance(false)
                                    .prefix(theme::hi("search-01").text_color(theme::muted())),
                            ),
                    )
                    .child(
                        div()
                            .id("settings-nav")
                            .flex_1()
                            .min_h_0()
                            .overflow_y_scroll()
                            .child(nav),
                    ),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .min_h_0()
                    .child(
                        div()
                            .h(px(56.))
                            .flex_none()
                            .flex()
                            .items_center()
                            .justify_between()
                            .gap(px(16.))
                            .px(px(20.))
                            .border_b_1()
                            .border_color(theme::border())
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(8.))
                                    .text_size(px(14.))
                                    .child(div().text_color(theme::muted()).child(title))
                                    .child(div().text_color(theme::muted()).child("/"))
                                    .child(div().font_weight(FontWeight::MEDIUM).child(active_label)),
                            )
                            .child(
                                ui::icon_button("settings-close", "cancel-01")
                                    .tooltip(ui::tip(t("Close", "Sluiten")))
                                    .on_click(cx.listener(|this, _, window, cx| this.close_settings(window, cx))),
                            ),
                    )
                    .child(
                        div()
                            .id("settings-page")
                            .flex_1()
                            .min_h_0()
                            .overflow_y_scroll()
                            .child(
                                div().flex().justify_center().child(
                                    div()
                                        .w_full()
                                        .max_w(px(768.))
                                        .flex()
                                        .flex_col()
                                        .gap(px(32.))
                                        .p(px(32.))
                                        .children(content),
                                ),
                            ),
                    ),
            );
        Some(
            div()
                .id("settings-backdrop")
                .absolute()
                .inset_0()
                .occlude()
                .flex()
                .items_center()
                .justify_center()
                .bg(gpui_kit::rgba(if theme::is_dark() { 0x00000080 } else { 0x0000001a }))
                // A press beside the window closes it. Only a press on this
                // backdrop itself: the window and what an app draws over it
                // (a confirm dialog, a menu) occlude it, so they don't.
                .on_mouse_down(
                    MouseButton::Left,
                    cx.listener(|this, _, window, cx| this.close_settings(window, cx)),
                )
                .child(dialog)
                .into_any_element(),
        )
    }
}

/// apps/desktop/src/brand.tsx: the mark and "Even."
fn brand() -> impl IntoElement {
    div()
        .flex()
        .items_center()
        .gap(px(10.))
        .text_size(px(20.))
        .font_weight(FontWeight(650.))
        .child(img("brand/even.svg").size(px(24.)))
        .child(
            div()
                .flex()
                .child("Even")
                .child(div().text_color(theme::primary_mark()).child(".")),
        )
}

impl Render for Shell {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let root = even_window::title_bar(div())
            .size_full()
            .relative()
            .font_family(theme::FONT)
            .text_size(px(14.))
            .bg(theme::background())
            .text_color(theme::foreground())
            .on_action(cx.listener(|this, _: &SignOut, _, cx| this.sign_out(cx)))
            .on_action(cx.listener(|this, _: &OpenSettings, window, cx| this.open_settings(None, window, cx)))
            .on_action(cx.listener(|this, _: &ShowMail, window, cx| this.select(AppId::Mail, window, cx)))
            .on_action(cx.listener(|this, _: &ShowTodo, window, cx| this.select(AppId::Todo, window, cx)))
            .on_action(cx.listener(|this, _: &ShowNotes, window, cx| this.select(AppId::Notes, window, cx)));
        match &self.screen {
            Screen::SignIn { waiting, error } => root.child(self.render_sign_in(waiting.clone(), *error, cx)),
            Screen::Apps(apps) => {
                let stage: AnyElement = match apps.active {
                    AppId::Mail => apps.mail.clone().into_any_element(),
                    AppId::Todo => apps
                        .todo
                        .clone()
                        .map_or_else(|| div().into_any_element(), |todo| todo.into_any_element()),
                    AppId::Notes => apps
                        .notes
                        .clone()
                        .map_or_else(|| div().into_any_element(), |notes| notes.into_any_element()),
                };
                let rail = self.render_rail(apps, cx).into_any_element();
                let settings = self.render_settings(window, cx);
                root.child(
                    div()
                        .size_full()
                        .flex()
                        .child(rail)
                        .child(div().flex_1().min_w_0().h_full().overflow_hidden().child(stage)),
                )
                .children(settings)
            }
        }
    }
}
