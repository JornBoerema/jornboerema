//! Even mailen's pages in the settings window, as
//! apps/mail-web/src/components/mail-settings.tsx lists them for the desktop
//! app: mailboxes (pages/accounts.tsx), signatures (settings_signatures.rs),
//! notifications, AI, the sidebar, features and privacy under the app's name,
//! and its part of the shared connections page
//! (components/connection-settings.tsx). The account, appearance and about
//! pages are the window's own (src/shell.rs).

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::menu::{DropdownMenu as _, PopupMenuItem};
use gpui_kit::component::Sizable as _;
use gpui_kit::prelude::*;
use gpui_kit::*;

use crate::api::{ApiError, Client, Unauthorized};
use crate::app::{AppEvent, SettingsPage};
use crate::i18n::t;
use crate::ui::{self, Variant};
use crate::{api as even, theme};

use super::api::{self, Mailbox};
use super::settings::{self, Feature};
use super::settings_signatures::SignatureEditor;
use super::{Loaded, MailView, SignedOut, View};

/// The pages by the web's ids, in its order.
const PAGES: [&str; 8] = [
    "mailboxes",
    "signatures",
    "notifications",
    "ai",
    "sidebar",
    "features",
    "connections",
    "privacy",
];

/// mail-settings.tsx `pages`, without the ones the window has itself. In the
/// desktop app `connections` has no group: one page for every app's part.
pub(super) fn pages() -> Vec<SettingsPage> {
    let page = |id: &'static str, label: &'static str, icon: &'static str| SettingsPage {
        id,
        label: label.into(),
        icon,
        shared: id == "connections",
        keywords: Vec::new(),
    };
    vec![
        page("mailboxes", t("Mailboxes", "Mailboxen"), "mail-01"),
        page("signatures", t("Signatures", "Handtekeningen"), "signature"),
        page("notifications", t("Notifications", "Meldingen"), "notification-03"),
        page("ai", "AI", "sparkles"),
        page("sidebar", "Sidebar", "layout-left"),
        page("features", t("Features", "Functies"), "puzzle"),
        page("connections", t("Connections", "Koppelingen"), "plug-01"),
        page("privacy", "Privacy", "security-check"),
    ]
}

/// A mailbox's inbox in a line (`InboxLine`).
#[derive(Clone, Copy)]
enum Inbox {
    Loading,
    Failed,
    Summary(api::InboxSummary),
}

/// What asks "are you sure" over the settings.
pub(super) enum Dialog {
    /// Disconnect this mailbox.
    Mailbox(String),
    /// Delete this signature.
    Signature(String),
    /// Disconnect Moneybird.
    Moneybird,
}

impl Dialog {
    /// The page it belongs to.
    fn page(&self) -> &'static str {
        match self {
            Dialog::Mailbox(_) => "mailboxes",
            Dialog::Signature(_) => "signatures",
            Dialog::Moneybird => "connections",
        }
    }
}

/// What mail's settings pages hold between two frames.
#[derive(Default)]
pub(super) struct Pages {
    /// The pages on screen, each by the element state that lives as long as
    /// it is drawn: a new one means the page just came up.
    shown: HashMap<&'static str, EntityId>,
    /// Refreshes the open page when the window comes back to the front (the
    /// web's refetch on focus): mailboxes and Moneybird are connected in the browser.
    activation: Option<Subscription>,
    mailboxes_failed: bool,
    inboxes: HashMap<String, Inbox>,
    /// Mailboxes being disconnected.
    disconnecting: Vec<String>,
    /// The mailbox whose colours are open, and where each colour button is.
    color_menu: Option<String>,
    anchors: Rc<RefCell<HashMap<String, Bounds<Pixels>>>>,
    pub(super) signatures: Loaded<Vec<api::Signature>>,
    pub(super) creating_signature: bool,
    pub(super) editing: Option<SignatureEditor>,
    connections: Loaded<api::Connections>,
    moneybird_busy: bool,
    pub(super) dialog: Option<Dialog>,
    dialog_focus: Option<FocusHandle>,
    /// Where the keyboard was before a dialog took it.
    restore: Option<FocusHandle>,
    /// `EVEN_MAIL_DEBUG` states of these pages, shown once.
    debugged: bool,
}

/// packages/ui settings-dialog.tsx `SettingsRow`, with a description that is
/// more than a line of text and a title that can warn.
pub(super) fn row(
    title: impl Into<SharedString>,
    description: Option<SharedString>,
    destructive: bool,
    control: Option<AnyElement>,
) -> AnyElement {
    div()
        .flex()
        .items_center()
        .justify_between()
        .gap(px(24.))
        .px(px(20.))
        .py(px(16.))
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(4.))
                .min_w_0()
                .flex_1()
                .child(
                    div()
                        .text_size(px(14.))
                        .font_weight(FontWeight::MEDIUM)
                        .when(destructive, |el| el.text_color(theme::danger()))
                        .child(title.into()),
                )
                .when_some(description, |el, description| {
                    el.child(div().text_size(px(14.)).text_color(theme::muted()).child(description))
                }),
        )
        .when_some(control, |el, control| {
            el.child(div().flex().flex_none().items_center().gap(px(8.)).child(control))
        })
        .into_any_element()
}

/// packages/ui switch.tsx at its default size: 32 by 20, the thumb 16.
fn switch(id: impl Into<ElementId>, checked: bool) -> Stateful<Div> {
    let dark = theme::is_dark();
    div()
        .id(id)
        .flex()
        .flex_none()
        .items_center()
        .w(px(32.))
        .h(px(20.))
        .p(px(2.))
        .rounded_full()
        .cursor_pointer()
        .bg(if checked { theme::primary() } else { theme::with_alpha(theme::input(), 0.9) })
        .when(checked, |el| el.justify_end())
        .child(div().size(px(16.)).rounded_full().shadow_sm().bg(match (dark, checked) {
            (true, true) => theme::primary_foreground(),
            (true, false) => theme::foreground(),
            (false, _) => theme::background(),
        }))
}

/// How a [`select`] looks.
pub(super) enum SelectLook {
    /// The web's SelectTrigger, this wide.
    Wide(f32),
    /// Text and chevron, a surface on hover (signature-settings.tsx); `true`
    /// when nothing is chosen, which reads quieter.
    Quiet(bool),
}

/// The web's Select (as `ui::select`, in the sizes these pages need): the
/// chosen option, and a menu of them. `on_pick` gets the option's index.
pub(super) fn select(
    id: impl Into<ElementId>,
    options: Vec<(SharedString, bool)>,
    look: SelectLook,
    on_pick: impl Fn(usize, &mut Window, &mut App) + 'static,
) -> AnyElement {
    let current = options
        .iter()
        .find(|(_, selected)| *selected)
        .map(|(label, _)| label.clone())
        .unwrap_or_default();
    let on_pick = Rc::new(on_pick);
    let button = Button::new(id).label(current).dropdown_caret(true);
    let (button, min_width) = match look {
        SelectLook::Wide(width) => (button.outline().w(px(width)).justify_between(), width),
        SelectLook::Quiet(none) => (
            button
                .ghost()
                .small()
                .max_w_full()
                .when(none, |el| el.text_color(theme::muted())),
            168.,
        ),
    };
    button
        .dropdown_menu(move |mut menu, _, _| {
            menu = menu.min_w(px(min_width));
            for (index, (label, selected)) in options.iter().enumerate() {
                let on_pick = on_pick.clone();
                menu = menu.item(
                    PopupMenuItem::new(label.clone())
                        .checked(*selected)
                        .on_click(move |_, window, cx| on_pick(index, window, cx)),
                );
            }
            menu
        })
        .into_any_element()
}

/// What the API said, or that it couldn't be reached (`errorText`).
pub(super) fn error_text(error: &anyhow::Error) -> String {
    match error.downcast_ref::<ApiError>() {
        Some(error) => error.message.clone(),
        None => t("There is no connection. Please try again.", "Er is geen verbinding. Probeer het opnieuw.").to_string(),
    }
}

/// `PROVIDER_NAMES`.
fn provider_name(provider: &str) -> &'static str {
    match provider {
        "outlook" => "Outlook",
        _ => "Gmail",
    }
}

/// `accounts.colorName`.
fn color_name(color: usize) -> &'static str {
    let names = t(
        ["Blue", "Amber", "Pink", "Green", "Purple", "Teal", "Red", "Gray"],
        ["Blauw", "Amber", "Roze", "Groen", "Paars", "Turquoise", "Rood", "Grijs"],
    );
    names.get(color).copied().unwrap_or("")
}

/// A state asked for with `EVEN_MAIL_DEBUG=settings-…`, for `scripts/shot.sh`.
pub(super) fn debug_wants(state: &str) -> bool {
    std::env::var("EVEN_MAIL_DEBUG").is_ok_and(|wanted| wanted.split(',').any(|item| item.trim() == state))
}

impl MailView {
    /// Runs `call` on the background executor and hands its answer to `done`,
    /// with the window, so what went wrong can be said in a toast above the
    /// settings. A lapsed session signs out instead.
    pub(super) fn settings_call<T: Send + 'static>(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
        call: impl FnOnce(&Client) -> anyhow::Result<T> + Send + 'static,
        done: impl FnOnce(&mut Self, anyhow::Result<T>, &mut Window, &mut Context<Self>) + 'static,
    ) {
        let client = self.client.clone();
        let task = cx.background_executor().spawn(async move { call(&client) });
        cx.spawn_in(window, async move |this, cx| {
            let result = task.await;
            let _ = this.update_in(cx, |this, window, cx| {
                if result
                    .as_ref()
                    .err()
                    .is_some_and(|error| error.downcast_ref::<Unauthorized>().is_some())
                {
                    cx.emit(SignedOut);
                    return;
                }
                done(this, result, window, cx);
                cx.notify();
            });
        })
        .detach();
    }

    /// Whether `page` came on screen with this frame. Its element state lives
    /// as long as the page is drawn, so when that goes the page was left (the
    /// settings closed, or another page shows).
    fn page_shown(&mut self, page: &'static str, window: &mut Window, cx: &mut Context<Self>) -> bool {
        let guard = window.use_keyed_state(SharedString::from(format!("mail-settings-{page}")), cx, |_, _| ());
        let id = guard.entity_id();
        if self.pages.shown.get(page) == Some(&id) {
            return false;
        }
        self.pages.shown.insert(page, id);
        cx.observe_release(&guard, move |this, _, cx| {
            if this.pages.shown.get(page) == Some(&id) {
                this.pages.shown.remove(page);
                this.page_left(page, cx);
            }
        })
        .detach();
        true
    }

    /// The page is no longer drawn: what floated over it goes with it.
    fn page_left(&mut self, page: &'static str, cx: &mut Context<Self>) {
        if self.pages.dialog.as_ref().is_some_and(|dialog| dialog.page() == page) {
            self.pages.dialog = None;
            self.pages.restore = None;
        }
        match page {
            "mailboxes" => self.pages.color_menu = None,
            // The editor is a system webview: it would stay on screen.
            "signatures" => self.close_signature(cx),
            _ => {}
        }
        cx.notify();
    }

    /// Asks the open page's data again when the window comes back to the front.
    fn watch_window(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.pages.activation.is_some() {
            return;
        }
        self.pages.activation = Some(cx.observe_window_activation(window, |this, window, cx| {
            if !window.is_window_active() {
                return;
            }
            let shown: Vec<&'static str> = this.pages.shown.keys().copied().collect();
            for page in shown {
                this.load_page(page, window, cx);
            }
        }));
    }

    fn load_page(&mut self, page: &'static str, window: &mut Window, cx: &mut Context<Self>) {
        match page {
            "mailboxes" => self.refresh_mailboxes(window, cx),
            "signatures" => {
                // Not under an open editor: it holds what is being written.
                if self.pages.editing.is_none() {
                    self.load_signatures(window, cx);
                }
                self.refresh_mailboxes(window, cx);
            }
            "connections" => self.load_connections(window, cx),
            _ => {}
        }
    }

    /// One page's content: `ui::settings_section`s in a column, with what
    /// floats over them.
    pub(super) fn render_settings_page(&mut self, page: &str, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let Some(page) = PAGES.into_iter().find(|id| *id == page) else {
            return div().into_any_element();
        };
        self.watch_window(window, cx);
        if self.page_shown(page, window, cx) {
            self.load_page(page, window, cx);
        }
        self.debug_settings(page, window, cx);
        let sections: Vec<AnyElement> = match page {
            "mailboxes" => self.render_mailboxes(cx),
            "signatures" => self.render_signatures(window, cx),
            "notifications" => vec![self.render_notifications(cx)],
            "ai" => vec![self.render_ai(cx)],
            "sidebar" => vec![self.render_sidebar_page(cx)],
            "features" => vec![self.render_features(cx)],
            "connections" => self.render_connections(cx),
            "privacy" => vec![self.render_privacy(cx)],
            _ => Vec::new(),
        };
        let floating: Vec<AnyElement> = self
            .render_color_menu(cx)
            .into_iter()
            .chain(self.render_settings_dialog(window, cx))
            .collect();
        div()
            .relative()
            .flex()
            .flex_col()
            .gap(px(32.))
            .children(sections)
            // Out of the column, so an open menu or dialog adds no gap.
            .child(div().absolute().top_0().left_0().children(floating))
            .into_any_element()
    }

    /// The states of these pages that otherwise need a click, for
    /// `scripts/shot.sh`: `EVEN_MAIL_DEBUG=settings-colors`,
    /// `settings-disconnect`, `settings-signature`, `settings-delete-signature`,
    /// `settings-moneybird`. They only look: nothing is changed.
    fn debug_settings(&mut self, page: &'static str, window: &mut Window, cx: &mut Context<Self>) {
        if self.pages.debugged {
            return;
        }
        let first_mailbox = self.mailboxes.first().map(|mailbox| mailbox.id.clone());
        let first_signature = self
            .pages
            .signatures
            .data
            .as_ref()
            .and_then(|signatures| signatures.first())
            .map(|signature| signature.id.clone());
        match page {
            "mailboxes" => {
                let Some(id) = first_mailbox else { return };
                if debug_wants("settings-colors") {
                    self.pages.color_menu = Some(id);
                } else if debug_wants("settings-disconnect") {
                    self.ask(Dialog::Mailbox(id), window, cx);
                }
            }
            "signatures" => {
                let Some(id) = first_signature else { return };
                if debug_wants("settings-signature") || debug_wants("settings-delete-signature") {
                    self.open_signature(&id, window, cx);
                }
                if debug_wants("settings-delete-signature") {
                    self.ask(Dialog::Signature(id), window, cx);
                }
            }
            "connections" => {
                if self.pages.connections.data.is_none() {
                    return;
                }
                if debug_wants("settings-moneybird") {
                    self.ask(Dialog::Moneybird, window, cx);
                }
            }
            _ => {}
        }
        self.pages.debugged = true;
    }

    // ─── Mailboxes (pages/accounts.tsx) ─────────────────────────────────────

    /// The mailboxes again, for the page and for the rest of the app.
    pub(super) fn refresh_mailboxes(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.settings_call(window, cx, api::mailboxes, |this, result, window, cx| {
            this.pages.mailboxes_failed = result.is_err();
            let Ok(mailboxes) = result else { return };
            this.loading_accounts = false;
            let active = |list: &[Mailbox]| -> Vec<String> {
                list.iter().filter(|mailbox| mailbox.active()).map(|mailbox| mailbox.id.clone()).collect()
            };
            let changed = active(&this.mailboxes) != active(&mailboxes);
            this.accounts = mailboxes.iter().map(Mailbox::basic).collect();
            this.mailboxes = mailboxes;
            // A disconnected mailbox can't stay selected.
            if !this.filter.is_empty() && !this.mailboxes.iter().any(|mailbox| mailbox.id == this.filter) {
                this.filter.clear();
                this.load(true, cx);
            }
            // A mailbox connected in the browser starts syncing, and its mail shows.
            if changed {
                this.sync_mailboxes(cx);
                this.refresh_lists(cx);
            }
            this.load_inboxes(window, cx);
        });
        self.load_inboxes(window, cx);
    }

    /// How much mail each active mailbox's inbox holds.
    fn load_inboxes(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let ids: Vec<String> = self
            .mailboxes
            .iter()
            .filter(|mailbox| mailbox.active())
            .map(|mailbox| mailbox.id.clone())
            .collect();
        self.pages.inboxes.retain(|id, _| ids.contains(id));
        for id in ids {
            self.pages.inboxes.entry(id.clone()).or_insert(Inbox::Loading);
            let account = id.clone();
            self.settings_call(
                window,
                cx,
                move |client| api::inbox_summary(client, &account),
                move |this, result, _, cx| match result {
                    Ok(summary) => {
                        this.pages.inboxes.insert(id, Inbox::Summary(summary));
                    }
                    Err(error) => {
                        // The provider took its access back: the list says so.
                        if error.downcast_ref::<ApiError>().is_some_and(|error| error.status == 409) {
                            this.load_accounts(cx);
                        }
                        this.pages.inboxes.insert(id, Inbox::Failed);
                    }
                },
            );
        }
    }

    /// `useConnect` in the desktop app: the provider sends the browser back
    /// with a cookie session, which this app doesn't have, so mailboxes are
    /// connected on the web. Back here, the window's return refreshes the list.
    fn connect_mailbox(&mut self, cx: &mut Context<Self>) {
        cx.open_url(&format!("{}/?settings=mailboxes", even::mail_web_url()));
    }

    fn set_mailbox_color(&mut self, id: String, color: usize, window: &mut Window, cx: &mut Context<Self>) {
        self.pages.color_menu = None;
        for mailbox in self.mailboxes.iter_mut().filter(|mailbox| mailbox.id == id) {
            mailbox.color = color;
        }
        for account in self.accounts.iter_mut().filter(|account| account.id == id) {
            account.color = color;
        }
        cx.notify();
        self.settings_call(
            window,
            cx,
            move |client| api::update_mailbox(client, &id, &serde_json::json!({ "color": color })),
            |this, result, window, cx| {
                if let Err(error) = result {
                    ui::toast_error(error_text(&error), window, cx);
                }
                this.refresh_mailboxes(window, cx);
            },
        );
    }

    fn disconnect_mailbox(&mut self, id: String, window: &mut Window, cx: &mut Context<Self>) {
        self.pages.disconnecting.push(id.clone());
        let account = id.clone();
        self.settings_call(
            window,
            cx,
            move |client| api::disconnect_mailbox(client, &account),
            move |this, result, window, cx| {
                this.pages.disconnecting.retain(|other| *other != id);
                match result {
                    Ok(()) => {
                        this.refresh_mailboxes(window, cx);
                        // Its mail leaves the lists.
                        this.load(true, cx);
                        this.refresh_lists(cx);
                    }
                    Err(error) => ui::toast_error(error_text(&error), window, cx),
                }
            },
        );
    }

    fn render_mailboxes(&mut self, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let mut rows = Vec::new();
        if self.pages.mailboxes_failed {
            rows.push(row(
                t("Your mailboxes couldn't be loaded.", "Je mailboxen konden niet worden geladen."),
                None,
                true,
                None,
            ));
        }
        if !self.loading_accounts && !self.pages.mailboxes_failed && self.mailboxes.is_empty() {
            rows.push(row(
                t("No mailboxes connected yet.", "Nog geen mailboxen gekoppeld."),
                None,
                false,
                None,
            ));
        }
        for mailbox in self.mailboxes.clone() {
            rows.push(self.render_mailbox(&mailbox, cx));
        }
        let providers = ["gmail", "outlook"].map(|provider| {
            row(
                provider_name(provider),
                None,
                false,
                Some(
                    ui::button_sm(SharedString::from(format!("connect-{provider}")), t("Connect", "Koppelen"), Variant::Outline)
                        .on_click(cx.listener(|this, _, _, cx| this.connect_mailbox(cx)))
                        .into_any_element(),
                ),
            )
        });
        vec![
            ui::settings_section(t("Connected mailboxes", "Gekoppelde mailboxen"), None, rows).into_any_element(),
            ui::settings_section(
                t("Connect a mailbox", "Mailbox koppelen"),
                Some(
                    t(
                        "Your mail stays with your provider. Only list details are stored here.",
                        "Je mail blijft bij je provider. Hier staan alleen lijstgegevens.",
                    )
                    .into(),
                ),
                providers.into_iter().collect(),
            )
            .into_any_element(),
        ]
    }

    /// `AccountRow`.
    fn render_mailbox(&self, mailbox: &Mailbox, cx: &mut Context<Self>) -> AnyElement {
        let active = mailbox.active();
        let line: String = if !active {
            t("Access has ended", "Toegang verlopen").into()
        } else {
            match self.pages.inboxes.get(&mailbox.id) {
                Some(Inbox::Summary(inbox)) => {
                    let (total, unread) = (inbox.total, inbox.unread);
                    t(
                        format!("Inbox: {total} messages, {unread} unread"),
                        format!("Inbox: {total} berichten, {unread} ongelezen"),
                    )
                }
                Some(Inbox::Failed) => t("Inbox unavailable", "Inbox niet beschikbaar").into(),
                _ => t("Checking inbox…", "Inbox controleren…").into(),
            }
        };
        let description = format!("{} · {line}", provider_name(&mailbox.provider));
        let id = mailbox.id.clone();
        let email = mailbox.email.clone();
        let anchors = self.pages.anchors.clone();
        let anchor_key = id.clone();
        let open = self.pages.color_menu.as_deref() == Some(id.as_str());
        // `ColorPicker`: an outlined square with the mailbox's dot.
        let color = div()
            .id(SharedString::from(format!("mailbox-color-{id}")))
            .relative()
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
            .size(px(28.))
            .rounded(theme::RADIUS_MD)
            .border_1()
            .border_color(theme::input())
            .bg(if open { theme::muted_bg() } else { theme::background() })
            .hover(|el| el.bg(theme::muted_bg()))
            .cursor_pointer()
            .child(div().size(px(12.)).rounded_full().bg(theme::account(mailbox.color)))
            .child(
                canvas(
                    move |bounds, _, _| {
                        anchors.borrow_mut().insert(anchor_key.clone(), bounds);
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .inset_0(),
            )
            .tooltip(ui::tip(t(
                format!("Change the color of {email}"),
                format!("Kleur van {email} wijzigen"),
            )))
            .on_click(cx.listener({
                let id = id.clone();
                move |this, _, _, cx| {
                    this.pages.color_menu = if this.pages.color_menu.as_deref() == Some(id.as_str()) {
                        None
                    } else {
                        Some(id.clone())
                    };
                    cx.notify();
                }
            }));
        let disconnect = ui::button_sm(
            SharedString::from(format!("mailbox-disconnect-{id}")),
            t("Disconnect", "Ontkoppelen"),
            Variant::Outline,
        );
        let disconnect = if self.pages.disconnecting.contains(&id) {
            ui::disabled(disconnect)
        } else {
            disconnect.on_click(cx.listener({
                let id = id.clone();
                move |this, _, window, cx| this.ask(Dialog::Mailbox(id.clone()), window, cx)
            }))
        };
        let control = div()
            .flex()
            .items_center()
            .gap(px(8.))
            .when(!active, |el| {
                el.child(
                    ui::button_sm(
                        SharedString::from(format!("mailbox-reconnect-{id}")),
                        t("Connect again", "Opnieuw koppelen"),
                        Variant::Primary,
                    )
                    .on_click(cx.listener(|this, _, _, cx| this.connect_mailbox(cx))),
                )
            })
            .child(color)
            .child(disconnect);
        row(mailbox.email.clone(), Some(description.into()), false, Some(control.into_any_element()))
    }

    /// The colours of `ColorPicker`: four in a row, the mailbox's own ringed.
    fn render_color_menu(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let id = self.pages.color_menu.clone()?;
        let mailbox = self.mailbox(&id)?;
        let bounds = self.pages.anchors.borrow().get(&id).copied()?;
        let current = mailbox.color;
        let swatch = |color: usize| {
            let id = id.clone();
            div()
                .id(("mailbox-color", color))
                .flex()
                .flex_none()
                .items_center()
                .justify_center()
                .size(px(32.))
                .rounded(theme::RADIUS_MD)
                .cursor_pointer()
                .hover(|el| el.bg(theme::accent()))
                .child(
                    // `ring-2 ring-foreground ring-offset-2` around the one in use.
                    div()
                        .flex()
                        .items_center()
                        .justify_center()
                        .size(px(22.))
                        .rounded_full()
                        .border_2()
                        .border_color(if color == current { theme::foreground() } else { gpui_kit::transparent_black().into() })
                        .child(div().size(px(14.)).rounded_full().bg(theme::account(color))),
                )
                .tooltip(ui::tip(color_name(color)))
                .on_click(cx.listener(move |this, _, window, cx| {
                    this.set_mailbox_color(id.clone(), color, window, cx);
                }))
        };
        let line = |colors: std::ops::Range<usize>| div().flex().gap(px(4.)).children(colors.map(&swatch));
        let panel = div()
            .id("mailbox-colors")
            .occlude()
            .flex()
            .flex_col()
            .gap(px(4.))
            .p(px(6.))
            .rounded(theme::RADIUS)
            .bg(theme::popover())
            .border_1()
            .border_color(theme::border())
            .shadow_md()
            .child(line(0..4))
            .child(line(4..8))
            // Also a press on its own button, which lies under the scrim below.
            .on_mouse_down_out(cx.listener(move |this, _: &MouseDownEvent, _, cx| {
                this.pages.color_menu = None;
                cx.notify();
            }));
        // Under the menu, over everything else: a press beside it closes the
        // menu and nothing more (not the settings, whose backdrop lies below),
        // as a dropdown on the web takes the first press outside it.
        let scrim = deferred(
            anchored().position(point(px(0.), px(0.))).child(
                div()
                    .id("mailbox-colors-scrim")
                    .w(px(20_000.))
                    .h(px(20_000.))
                    .occlude()
                    .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation()),
            ),
        )
        .with_priority(59);
        Some(
            div()
                .child(scrim)
                .child(
                    deferred(
                        anchored()
                            .position(point(bounds.right(), bounds.bottom() + px(4.)))
                            .anchor(Anchor::TopRight)
                            .snap_to_window_with_margin(px(8.))
                            .child(panel),
                    )
                    .with_priority(60),
                )
                .into_any_element(),
        )
    }

    // ─── The switches (mail-settings.tsx) ───────────────────────────────────

    /// Turns a setting that follows the account on or off: here at once, then
    /// on the account (`pushPreference`).
    fn set_feature(&mut self, feature: Feature, on: bool, window: &mut Window, cx: &mut Context<Self>) {
        feature.keep_locally(on);
        // A feature turned off takes its list away.
        let gone = !on
            && matches!(
                (feature, self.view),
                (Feature::Parcels, View::Parcels) | (Feature::Senders, View::Senders) | (Feature::Invoices, View::Invoices)
            );
        if gone {
            self.select_account(String::new(), cx);
        }
        if feature == Feature::Pins {
            self.load_pins(cx);
        }
        // The conversation open behind the settings follows at once.
        self.features_changed(cx);
        cx.notify();
        self.settings_call(
            window,
            cx,
            move |client| api::save_preferences(client, &api::feature_body(feature.key(), on)),
            |_, result, window, cx| {
                if let Err(error) = result {
                    ui::toast_error(error_text(&error), window, cx);
                }
            },
        );
    }

    fn feature_row(&self, feature: Feature, title: &'static str, help: &'static str, cx: &mut Context<Self>) -> AnyElement {
        let on = feature.on();
        row(
            title,
            Some(help.into()),
            false,
            Some(
                switch(SharedString::from(format!("mail-{}", feature.key())), on)
                    .on_click(cx.listener(move |this, _, window, cx| this.set_feature(feature, !on, window, cx)))
                    .into_any_element(),
            ),
        )
    }

    /// `NotificationSettings`, as the desktop app words it. GPUI's system
    /// notifications ask for no permission of their own, so the switch is the
    /// whole of it.
    fn render_notifications(&self, cx: &mut Context<Self>) -> AnyElement {
        let on = settings::notify_new_mail();
        ui::settings_section(
            t("New mail", "Nieuwe mail"),
            Some(t("Applies to this computer only.", "Geldt alleen voor deze computer.").into()),
            vec![row(
                t("Notify me of new mail", "Melding bij nieuwe mail"),
                Some(
                    t(
                        "A system notification when mail arrives, unless you're looking at your inbox.",
                        "Een systeemmelding als er mail binnenkomt, behalve als je naar je inbox kijkt.",
                    )
                    .into(),
                ),
                false,
                Some(
                    switch("notify-new-mail", on)
                        .on_click(cx.listener(move |_, _, _, cx| {
                            settings::set_notify_new_mail(!on);
                            cx.notify();
                        }))
                        .into_any_element(),
                ),
            )],
        )
        .into_any_element()
    }

    /// `AiSettings`.
    fn render_ai(&self, cx: &mut Context<Self>) -> AnyElement {
        ui::settings_section(
            t("Smart features", "Slimme functies"),
            Some(t("Saved to your account, on every device.", "Opgeslagen op je account, op al je apparaten.").into()),
            vec![
                self.feature_row(
                    Feature::Summaries,
                    t("Summaries", "Samenvattingen"),
                    t(
                        "Three lines on what a conversation says. It is sent to a language model through OpenRouter, only to providers that don't keep or train on it.",
                        "Drie regels over wat er in een gesprek staat. Het gesprek gaat via OpenRouter naar een taalmodel, alleen naar providers die het niet bewaren of erop trainen.",
                    ),
                    cx,
                ),
                self.feature_row(
                    Feature::ReplySuggestions,
                    t("Reply suggestions", "Antwoordsuggesties"),
                    t(
                        "Three ready replies under mail that asks you for an answer, none under the rest. Written by a language model through OpenRouter, like summaries.",
                        "Drie kant-en-klare antwoorden onder mail die om een antwoord vraagt, niet onder de rest. Geschreven door een taalmodel via OpenRouter, net als samenvattingen.",
                    ),
                    cx,
                ),
                self.feature_row(
                    Feature::AiWriting,
                    t("Write with AI", "Schrijven met AI"),
                    t(
                        "A button in the composer that writes or rewrites your message from a short description. What you wrote, and for a reply the conversation, is sent to a language model through OpenRouter, only when you ask.",
                        "Een knop in het opstelscherm die je bericht schrijft of herschrijft vanuit een korte omschrijving. Wat je schreef, en bij een antwoord het gesprek, gaat via OpenRouter naar een taalmodel, alleen als je erom vraagt.",
                    ),
                    cx,
                ),
                self.feature_row(
                    Feature::Codes,
                    t("Sign-in codes", "Inlogcodes"),
                    t(
                        "A verification code in a mail shown above it, ready to copy. Found by the app itself; nothing is sent anywhere for it.",
                        "Een verificatiecode uit een mail bovenaan, klaar om te kopiëren. De app vindt die zelf; er wordt niets voor verstuurd.",
                    ),
                    cx,
                ),
            ],
        )
        .into_any_element()
    }

    /// `SidebarSettings`: the sidebar is arranged in place; this only starts it.
    fn render_sidebar_page(&self, cx: &mut Context<Self>) -> AnyElement {
        ui::settings_section(
            "Sidebar",
            None,
            vec![row(
                t("Arrange sidebar", "Sidebar indelen"),
                Some(
                    t(
                        "Put the places in the order you like, tuck some under More, or hide them. On a wider screen, in the sidebar itself.",
                        "Zet de onderdelen in de volgorde die jij fijn vindt, stop er een paar onder Meer of verberg ze. Op een breder scherm, in de sidebar zelf.",
                    )
                    .into(),
                ),
                false,
                Some(
                    ui::button("arrange-sidebar", t("Arrange", "Indelen"), Variant::Outline)
                        .on_click(cx.listener(|this, _, _, cx| {
                            // The settings close and Even mailen comes to the front first.
                            cx.emit(AppEvent::Show);
                            this.customize_sidebar(cx);
                        }))
                        .into_any_element(),
                ),
            )],
        )
        .into_any_element()
    }

    /// `FeatureSettings`: extras that can each be turned off.
    fn render_features(&self, cx: &mut Context<Self>) -> AnyElement {
        ui::settings_section(
            t("Features", "Functies"),
            Some(
                t(
                    "Extras on top of your mail. Saved to your account, so they apply on every device.",
                    "Extra's bovenop je mail. Opgeslagen bij je account, dus ze gelden op elk apparaat.",
                )
                .into(),
            ),
            vec![
                self.feature_row(
                    Feature::Parcels,
                    t("Parcels", "Pakketjes"),
                    t(
                        "Track & trace from shipping mail, in a list of its own and on top of the mail. Turned off, shipping mail isn't read and what was found is removed.",
                        "Track & trace uit verzendmail, in een eigen lijst en bovenaan de mail. Uitgezet wordt verzendmail niet meer gelezen en wordt wat gevonden was verwijderd.",
                    ),
                    cx,
                ),
                self.feature_row(
                    Feature::Invoices,
                    t("Invoices", "Facturen"),
                    t(
                        "Invoices, receipts and payment requests from your mail, in a list of their own and on top of the mail. Turned off, that mail isn't read and what was found is removed.",
                        "Facturen, bonnetjes en betaalverzoeken uit je mail, in een eigen lijst en bovenaan de mail. Uitgezet wordt die mail niet meer gelezen en wordt wat gevonden was verwijderd.",
                    ),
                    cx,
                ),
                self.feature_row(
                    Feature::Pins,
                    t("Pin to top", "Vastpinnen"),
                    t(
                        "Pin a conversation to the top of the inbox (P) until you unpin, archive or delete it.",
                        "Pin een gesprek bovenaan de inbox (P), tot je hem losmaakt, archiveert of verwijdert.",
                    ),
                    cx,
                ),
                self.feature_row(
                    Feature::Todos,
                    t("Tasks from mail", "Taken uit mail"),
                    t(
                        "Make a task in Even doen from a mail (T), linked to it, and see its tasks above the mail.",
                        "Maak vanuit een mail een taak in Even doen (T), eraan gekoppeld, en zie de taken boven de mail.",
                    ),
                    cx,
                ),
                self.feature_row(
                    Feature::Senders,
                    t("Tidy up", "Opruimen"),
                    t(
                        "Your inbox per sender, to archive, mark read or unsubscribe from all their mail at once.",
                        "Je inbox per afzender, om al hun mail in één keer te archiveren, gelezen te maken of je uit te schrijven.",
                    ),
                    cx,
                ),
                self.feature_row(
                    Feature::Unsubscribe,
                    t("Unsubscribe button", "Uitschrijfknop"),
                    t(
                        "Beside mail from a mailing list, a button to leave the list in one go.",
                        "Bij mail van een mailinglijst een knop om je in één keer af te melden.",
                    ),
                    cx,
                ),
            ],
        )
        .into_any_element()
    }

    /// `PrivacySettings`.
    fn render_privacy(&self, cx: &mut Context<Self>) -> AnyElement {
        ui::settings_section(
            t("Images in email", "Afbeeldingen in e-mails"),
            Some(t("Saved to your account, on every device.", "Opgeslagen op je account, op al je apparaten.").into()),
            vec![self.feature_row(
                Feature::RemoteImages,
                t("Always show images", "Afbeeldingen altijd tonen"),
                t(
                    "Senders can then see when you open a mail, and your IP address.",
                    "Afzenders kunnen dan zien wanneer je een mail opent, en je IP-adres.",
                ),
                cx,
            )],
        )
        .into_any_element()
    }

    // ─── Connections (components/connection-settings.tsx) ───────────────────

    fn load_connections(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.settings_call(window, cx, api::connections, |this, result, _, _| {
            // What was shown stays when asking again fails, as the web's cache does.
            this.pages.connections.set(result);
        });
    }

    /// `useConnectMoneybird` in the desktop app: connected on the web, as mailboxes are.
    fn connect_moneybird(&mut self, cx: &mut Context<Self>) {
        cx.open_url(&format!("{}/?settings=connections", even::mail_web_url()));
    }

    fn disconnect_moneybird(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.pages.moneybird_busy = true;
        self.settings_call(window, cx, api::disconnect_moneybird, |this, result, window, cx| {
            this.pages.moneybird_busy = false;
            match result {
                Ok(()) => this.load_connections(window, cx),
                Err(error) => ui::toast_error(error_text(&error), window, cx),
            }
        });
    }

    /// `AdministrationPicker`: where invoices go, or `None` to ask each time.
    fn set_administration(&mut self, id: Option<String>, window: &mut Window, cx: &mut Context<Self>) {
        // The choice shows at once.
        if let Some(connections) = &mut self.pages.connections.data {
            for connection in connections.connections.iter_mut().filter(|item| item.provider == "moneybird") {
                connection.default_target = id
                    .as_ref()
                    .and_then(|id| connection.administrations.iter().find(|item| item.id == *id).cloned());
            }
        }
        cx.notify();
        self.settings_call(
            window,
            cx,
            move |client| api::set_moneybird_administration(client, id.as_deref()),
            |this, result, window, cx| {
                if let Err(error) = result {
                    ui::toast_error(error_text(&error), window, cx);
                }
                this.load_connections(window, cx);
            },
        );
    }

    /// Mail's part of the shared page: services linked once, so mail goes
    /// there in one click. Moneybird for now. Its title names the app.
    fn render_connections(&self, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let loaded = self.pages.connections.data.as_ref();
        let moneybird = loaded.and_then(|data| data.connections.iter().find(|item| item.provider == "moneybird"));
        let available = loaded.is_some_and(|data| data.available.iter().any(|provider| provider == "moneybird"));
        let active = moneybird.is_some_and(|connection| connection.status == "active");
        let mut rows = Vec::new();
        if self.pages.connections.failed {
            rows.push(row(
                t("The connections couldn't be loaded.", "De koppelingen konden niet worden geladen."),
                None,
                true,
                None,
            ));
        }
        if loaded.is_some() {
            let description: String = match moneybird {
                None if available => t(
                    "Put invoices from your mail into Moneybird in one click.",
                    "Zet facturen uit je mail met één klik in Moneybird.",
                )
                .into(),
                None => t("Not available yet.", "Nog niet beschikbaar.").into(),
                Some(_) if !active => t(
                    "Moneybird no longer accepts this connection.",
                    "Moneybird accepteert deze koppeling niet meer.",
                )
                .into(),
                Some(connection) => match &connection.default_target {
                    Some(target) => {
                        let name = &target.name;
                        t(
                            format!("Connected · invoices go to {name}"),
                            format!("Gekoppeld · facturen gaan naar {name}"),
                        )
                    }
                    None => {
                        let count = connection.administrations.len();
                        if count > 1 {
                            t(
                                format!("Connected · {count} administrations, you pick one per sender"),
                                format!("Gekoppeld · {count} administraties, je kiest er één per afzender"),
                            )
                        } else {
                            t("Connected", "Gekoppeld").into()
                        }
                    }
                },
            };
            let connect = (moneybird.is_none() || !active).then(|| {
                let button = ui::button_sm(
                    "moneybird-connect",
                    if moneybird.is_some() {
                        t("Connect again", "Opnieuw koppelen")
                    } else {
                        t("Connect", "Koppelen")
                    },
                    if moneybird.is_some() { Variant::Primary } else { Variant::Outline },
                );
                if available {
                    button.on_click(cx.listener(|this, _, _, cx| this.connect_moneybird(cx)))
                } else {
                    ui::disabled(button)
                }
            });
            let disconnect = moneybird.is_some().then(|| {
                let button = ui::button_sm("moneybird-disconnect", t("Disconnect", "Ontkoppelen"), Variant::Outline);
                if self.pages.moneybird_busy {
                    ui::disabled(button)
                } else {
                    button.on_click(cx.listener(|this, _, window, cx| this.ask(Dialog::Moneybird, window, cx)))
                }
            });
            rows.push(row(
                "Moneybird",
                Some(description.into()),
                false,
                Some(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .children(connect)
                        .children(disconnect)
                        .into_any_element(),
                ),
            ));
        }
        let mut sections = vec![ui::settings_section(
            "Even mailen",
            Some(
                t(
                    "Link a service once, then send mail to it in one click.",
                    "Koppel een dienst één keer en stuur er daarna mail heen met één klik.",
                )
                .into(),
            ),
            rows,
        )
        .into_any_element()];
        if let Some(connection) = moneybird.filter(|connection| active && connection.administrations.len() > 1) {
            let chosen = connection.default_target.as_ref().map(|target| target.id.clone());
            let ids: Vec<Option<String>> = std::iter::once(None)
                .chain(connection.administrations.iter().map(|item| Some(item.id.clone())))
                .collect();
            let options: Vec<(SharedString, bool)> = std::iter::once((t("Ask each time", "Elke keer vragen").into(), chosen.is_none()))
                .chain(
                    connection
                        .administrations
                        .iter()
                        .map(|item| (item.name.clone().into(), chosen.as_deref() == Some(item.id.as_str()))),
                )
                .collect();
            let this = cx.weak_entity();
            let picker = select("moneybird-administration", options, SelectLook::Wide(208.), move |index, window, cx| {
                let id = ids[index].clone();
                let _ = this.update(cx, |this, cx| this.set_administration(id, window, cx));
            });
            sections.push(
                ui::settings_section(
                    "Moneybird",
                    None,
                    vec![row(
                        t("Administration", "Administratie"),
                        Some(
                            t(
                                "Where invoices go. Per sender, your last choice is remembered.",
                                "Waar facturen heen gaan. Per afzender onthouden we je laatste keuze.",
                            )
                            .into(),
                        ),
                        false,
                        Some(picker),
                    )],
                )
                .into_any_element(),
            );
        }
        sections
    }

    // ─── Are you sure (packages/ui alert-dialog.tsx) ────────────────────────

    /// Opens a confirmation over the settings and gives it the keyboard.
    pub(super) fn ask(&mut self, dialog: Dialog, window: &mut Window, cx: &mut Context<Self>) {
        let focus = self.pages.dialog_focus.get_or_insert_with(|| cx.focus_handle()).clone();
        if self.pages.dialog.is_none() {
            self.pages.restore = window.focused(cx);
        }
        self.pages.color_menu = None;
        self.pages.dialog = Some(dialog);
        // The signature's editor is a system webview: it would lie over the dialog.
        self.veil_signature(true, cx);
        window.focus(&focus, cx);
        cx.notify();
    }

    fn close_settings_dialog(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.pages.dialog = None;
        self.veil_signature(false, cx);
        // The keyboard goes back to where it was in the settings window.
        if let Some(restore) = self.pages.restore.take() {
            window.focus(&restore, cx);
        }
        cx.notify();
    }

    fn confirm_settings_dialog(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(dialog) = self.pages.dialog.take() else { return };
        self.close_settings_dialog(window, cx);
        match dialog {
            Dialog::Mailbox(id) => self.disconnect_mailbox(id, window, cx),
            Dialog::Signature(id) => self.delete_signature(id, window, cx),
            Dialog::Moneybird => self.disconnect_moneybird(window, cx),
        }
    }

    fn render_settings_dialog(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Option<AnyElement> {
        let focus = self.pages.dialog_focus.clone()?;
        let (title, body, confirm): (String, &'static str, &'static str) = match self.pages.dialog.as_ref()? {
            Dialog::Mailbox(id) => {
                let email = self.mailbox(id).map(|mailbox| mailbox.email.clone()).unwrap_or_default();
                (
                    t(format!("Disconnect {email}?"), format!("{email} ontkoppelen?")),
                    t(
                        "Its messages disappear from this app. Your mailbox itself doesn't change.",
                        "De berichten verdwijnen uit deze app. Je mailbox zelf verandert niet.",
                    ),
                    t("Disconnect", "Ontkoppelen"),
                )
            }
            Dialog::Signature(id) => {
                let name = self.signature_label(id, cx);
                (
                    t(format!("Delete \"{name}\"?"), format!("\"{name}\" verwijderen?")),
                    t(
                        "Mailboxes that use it will stop adding a signature.",
                        "Mailboxen die hem gebruiken voegen dan geen handtekening meer toe.",
                    ),
                    t("Delete", "Verwijderen"),
                )
            }
            Dialog::Moneybird => (
                t("Disconnect Moneybird?", "Moneybird ontkoppelen?").into(),
                t(
                    "Invoices already in Moneybird stay there. You can connect again any time.",
                    "Facturen die al in Moneybird staan, blijven daar. Je kunt altijd opnieuw koppelen.",
                ),
                t("Disconnect", "Ontkoppelen"),
            ),
        };
        let size = window.viewport_size();
        // `AlertDialogContent`: 448 wide, its words left, its buttons right.
        let panel = div()
            .id("mail-settings-dialog")
            .track_focus(&focus)
            // Escape closes the question, not the settings under it.
            .on_action(cx.listener(|this, _: &crate::shell::CloseSettings, window, cx| {
                this.close_settings_dialog(window, cx)
            }))
            .occlude()
            .flex()
            .flex_col()
            .gap(px(24.))
            .w((size.width - px(32.)).min(px(448.)))
            .p(px(24.))
            .rounded(theme::RADIUS_XL)
            .bg(theme::popover())
            .border_1()
            .border_color(theme::with_alpha(theme::foreground(), if theme::is_dark() { 0.1 } else { 0.05 }))
            .shadow_xl()
            .font_family(theme::FONT)
            .text_size(px(14.))
            .text_color(theme::foreground())
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(6.))
                    .child(div().text_size(px(18.)).font_weight(FontWeight::MEDIUM).child(title))
                    .child(div().text_size(px(14.)).text_color(theme::muted()).child(body)),
            )
            .child(
                div()
                    .flex()
                    .justify_end()
                    .gap(px(8.))
                    .child(
                        ui::button("mail-settings-cancel", t("Cancel", "Annuleren"), Variant::Outline)
                            .on_click(cx.listener(|this, _, window, cx| this.close_settings_dialog(window, cx))),
                    )
                    .child(
                        ui::button("mail-settings-confirm", confirm, Variant::Destructive)
                            .on_click(cx.listener(|this, _, window, cx| this.confirm_settings_dialog(window, cx))),
                    ),
            );
        Some(
            deferred(
                anchored().position(point(px(0.), px(0.))).child(
                    div()
                        .id("mail-settings-backdrop")
                        .occlude()
                        .w(size.width)
                        .h(size.height)
                        .flex()
                        .items_center()
                        .justify_center()
                        .bg(rgba(0x0000004d))
                        .on_mouse_down(
                            MouseButton::Left,
                            cx.listener(|this, _, window, cx| this.close_settings_dialog(window, cx)),
                        )
                        .child(panel),
                ),
            )
            .with_priority(70)
            .into_any_element(),
        )
    }
}
