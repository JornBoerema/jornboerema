//! Even, native: the mail part of the Even desktop app, drawn by GPUI instead
//! of a webview. An experiment next to apps/desktop, which it does not replace.

mod api;
mod assets;
mod auth;
mod email;
mod mail;
mod quote;
mod theme;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use gpui_kit::prelude::*;
use gpui_kit::*;

use crate::mail::{MailView, SignedOut};

actions!(even, [Quit, SignOut]);

enum Screen {
    SignIn { waiting: bool, error: Option<SharedString> },
    Mail(Entity<MailView>),
}

struct Even {
    screen: Screen,
    /// Ends the sign-in that is waiting for the browser.
    cancel: Arc<AtomicBool>,
    _signed_out: Option<Subscription>,
}

impl Even {
    fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let mut even = Self {
            screen: Screen::SignIn {
                waiting: false,
                error: None,
            },
            cancel: Arc::new(AtomicBool::new(false)),
            _signed_out: None,
        };
        if let Some(token) = auth::stored_token() {
            even.show_mail(token, window, cx);
        }
        even
    }

    fn show_mail(&mut self, token: String, window: &mut Window, cx: &mut Context<Self>) {
        let client = api::Client::new(token);
        let view = cx.new(|cx| MailView::new(client, window, cx));
        self._signed_out = Some(cx.subscribe(&view, |this, _, _: &SignedOut, cx| this.sign_out(cx)));
        self.screen = Screen::Mail(view);
        cx.notify();
    }

    fn sign_out(&mut self, cx: &mut Context<Self>) {
        auth::forget_token();
        self._signed_out = None;
        self.screen = Screen::SignIn {
            waiting: false,
            error: None,
        };
        cx.notify();
    }

    fn start_sign_in(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let attempt = match auth::Attempt::start() {
            Ok(attempt) => attempt,
            Err(error) => {
                self.screen = Screen::SignIn {
                    waiting: false,
                    error: Some(error.to_string().into()),
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
            waiting: true,
            error: None,
        };
        cx.notify();
        let task = cx.background_executor().spawn(async move { attempt.finish(cancel) });
        cx.spawn_in(window, async move |this, cx| {
            let result = task.await;
            let _ = this.update_in(cx, |this, window, cx| {
                if !matches!(this.screen, Screen::SignIn { waiting: true, .. }) {
                    return;
                }
                match result {
                    Ok(token) => {
                        auth::store_token(&token);
                        this.show_mail(token, window, cx);
                    }
                    Err(error) if error.to_string() == "cancelled" => {}
                    Err(error) => {
                        this.screen = Screen::SignIn {
                            waiting: false,
                            error: Some(error.to_string().into()),
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
            waiting: false,
            error: None,
        };
        cx.notify();
    }

    fn render_sign_in(&self, waiting: bool, error: Option<SharedString>, cx: &mut Context<Self>) -> impl IntoElement {
        let button = |id: &'static str, label: &'static str, primary: bool| {
            div()
                .id(id)
                .flex()
                .justify_center()
                .px_4()
                .py_2()
                .rounded_md()
                .text_sm()
                .font_weight(FontWeight::MEDIUM)
                .when(primary, |el| {
                    el.bg(theme::primary())
                        .text_color(rgb(0xffffff))
                        .hover(|el| el.opacity(0.9))
                })
                .when(!primary, |el| {
                    el.text_color(theme::muted()).hover(|el| el.bg(theme::hover()))
                })
                .child(label)
        };
        div()
            .size_full()
            .flex()
            .items_center()
            .justify_center()
            .bg(theme::background())
            .text_color(theme::foreground())
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_4()
                    .w(px(340.))
                    .child(
                        div()
                            .text_2xl()
                            .font_weight(FontWeight::SEMIBOLD)
                            .child("Welkom bij Even"),
                    )
                    .child(div().text_sm().text_color(theme::muted()).child(if waiting {
                        "Rond het inloggen af in je browser."
                    } else {
                        "Log in met je Even-account. Dat gaat via je browser."
                    }))
                    .when_some(error, |el, error| {
                        el.child(
                            div()
                                .text_sm()
                                .text_color(theme::danger())
                                .child(format!("Inloggen is niet gelukt: {error}")),
                        )
                    })
                    .map(|el| {
                        if waiting {
                            el.child(
                                button("again", "Browser opnieuw openen", true)
                                    .on_click(cx.listener(|this, _, window, cx| this.start_sign_in(window, cx))),
                            )
                            .child(
                                button("cancel", "Annuleren", false)
                                    .on_click(cx.listener(|this, _, _, cx| this.cancel_sign_in(cx))),
                            )
                        } else {
                            el.child(
                                button("sign-in", "Inloggen via je browser", true)
                                    .on_click(cx.listener(|this, _, window, cx| this.start_sign_in(window, cx))),
                            )
                        }
                    }),
            )
    }
}

impl Render for Even {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let content = match &self.screen {
            Screen::SignIn { waiting, error } => self.render_sign_in(*waiting, error.clone(), cx).into_any_element(),
            Screen::Mail(view) => view.clone().into_any_element(),
        };
        div()
            .size_full()
            .font_family(".SystemUIFont")
            .on_action(cx.listener(|this, _: &SignOut, _, cx| this.sign_out(cx)))
            .child(content)
    }
}

fn main() {
    gpui_kit::application().with_assets(assets::Assets).run(|cx| {
        gpui_kit::init(cx);
        mail::bind_keys(cx);
        cx.bind_keys([KeyBinding::new("cmd-q", Quit, None)]);
        cx.on_action(|_: &Quit, cx| cx.quit());
        cx.set_menus(vec![Menu {
            name: "Even".into(),
            items: vec![
                MenuItem::action("Uitloggen", SignOut),
                MenuItem::separator(),
                MenuItem::action("Stop Even", Quit),
            ],
            disabled: false,
        }]);
        let bounds = Bounds::centered(None, size(px(1360.), px(860.)), cx);
        let options = WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(bounds)),
            titlebar: Some(TitlebarOptions {
                title: Some("Even".into()),
                appears_transparent: true,
                traffic_light_position: Some(point(px(16.), px(18.))),
            }),
            window_min_size: Some(size(px(980.), px(560.))),
            ..Default::default()
        };
        gpui_kit::open_window(options, cx, |window, cx| cx.new(|cx| Even::new(window, cx)))
            .expect("could not open the window");
        cx.activate(true);
    });
}
