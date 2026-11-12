//! The open conversation: GPUI draws the toolbar, a system webview the mail.

use gpui_webview::WebView;

use crate::api::{Action, Folder};
use crate::email::{self};
use crate::theme;

use super::*;

impl MailView {
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

    pub(super) fn render_reader(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
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
        let thread = &self.rows()[index];
        let id = thread.id.clone();
        let starred = thread.is_starred;
        let folder = self.list_folder();
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
            .when(folder != Folder::Archive, |el| {
                el.child(tool(
                    "archive",
                    "archive",
                    "Archiveren",
                    "E",
                    cx.listener(|this, _, _, cx| this.act(Action::Archive, cx)),
                ))
            })
            .child(tool(
                "star",
                if starred { "star-off" } else { "star" },
                if starred { "Ster weg" } else { "Ster" },
                "S",
                cx.listener(move |this, _, _, cx| this.act(if starred { Action::Unstar } else { Action::Star }, cx)),
            ))
            .child(tool(
                "unread",
                "mail",
                "Ongelezen",
                "⇧U",
                cx.listener(|this, _, _, cx| this.act(Action::Unread, cx)),
            ))
            .when(folder != Folder::Trash, |el| {
                el.child(tool(
                    "trash",
                    "trash",
                    "Prullenbak",
                    "#",
                    cx.listener(|this, _, _, cx| this.act(Action::Trash, cx)),
                ))
            })
            .when(matches!(folder, Folder::Archive | Folder::Spam | Folder::Trash), |el| {
                el.child(tool(
                    "inbox",
                    "archive-restore",
                    "Naar inbox",
                    "",
                    cx.listener(|this, _, _, cx| this.act(Action::Inbox, cx)),
                ))
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
                    "image",
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
                _ => div()
                    .p_6()
                    .text_sm()
                    .text_color(theme::faint())
                    .child("Laden…")
                    .into_any_element(),
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

/// A toolbar action: icon, name and shortcut. Not icon-only with a tooltip:
/// the mail's webview draws over GPUI overlays, so a tooltip would vanish under it.
fn tool(
    id: &'static str,
    icon: &'static str,
    label: &'static str,
    key: &'static str,
    on_click: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
) -> impl IntoElement {
    div()
        .id(id)
        .flex()
        .items_center()
        .gap_1p5()
        .h(px(28.))
        .px_2()
        .rounded_md()
        .text_xs()
        .text_color(theme::muted())
        .hover(|el| el.bg(theme::hover()).text_color(theme::foreground()))
        .child(theme::icon(icon).size(px(15.)).text_color(theme::muted()))
        .child(label)
        .when(!key.is_empty(), |el| {
            el.child(div().text_color(theme::faint()).child(key))
        })
        .on_click(on_click)
}

/// Links in the mail leave for the browser or the mail app; nothing else may leave the page.
fn is_outside(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    ["http:", "https:", "mailto:", "tel:"]
        .iter()
        .any(|scheme| lower.starts_with(scheme))
}
