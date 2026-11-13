//! The reading pane, the floating panel beside the list (the second section
//! of apps/mail-web/src/pages/inbox.tsx): the open conversation, a new
//! message, one sender while tidying up, or the day when nothing is open.
//! GPUI draws the toolbar, a system webview the mail itself. The conversation
//! and the composer as the web has them are a later pass.

use gpui_webview::WebView;

use crate::email::{self};
use crate::ui;

use super::api::{can_report_spam, move_actions};
use super::list::{is_destructive, move_icon, move_label};
use super::overlays::SnoozeTarget;
use super::*;

/// The panel's colour as the webview's own background, so nothing flashes
/// while a mail loads: `--sidebar`, dark and light.
fn backdrop(dark: bool) -> (u8, u8, u8, u8) {
    if dark {
        (0x17, 0x17, 0x17, 255)
    } else {
        (0xfa, 0xfa, 0xfa, 255)
    }
}

impl MailView {
    /// The webview, built the first time a conversation shows.
    fn webview(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Option<Entity<WebView>> {
        if self.webview.is_none() {
            let ipc = self.ipc.clone();
            let dark = theme::is_dark();
            let builder = wry::WebViewBuilder::new()
                .with_background_color(backdrop(dark))
                .with_html(format!(
                    "<html><body style=\"background:{}\"></body></html>",
                    if dark { "#171717" } else { "#fafafa" }
                ))
                // Only our nonce'd script can post here; the view still parses and checks each message.
                .with_ipc_handler(move |request| {
                    let _ = ipc.unbounded_send(request.body().clone());
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
                    eprintln!("The mail view doesn't start: {error}");
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
        // `.floating-panel … md:m-2`.
        let shell = ui::floating_panel().flex().flex_col().flex_1().min_w_0().m(px(8.));
        // A new message takes the reader's place.
        if self.composing() {
            self.hide_webview(cx);
            return shell.children(self.render_composer(cx));
        }
        let Some(thread) = self.open.clone() else {
            self.hide_webview(cx);
            return match self.pane_sender().cloned() {
                Some(sender) => shell.child(self.render_sender_pane(&sender, cx)),
                None if self.view == View::Senders => shell.child(
                    div().flex().flex_1().items_center().justify_center().child(
                        div()
                            .max_w(px(320.))
                            .px(px(24.))
                            .text_center()
                            .text_size(px(14.))
                            .text_color(theme::muted())
                            .child(t(
                                "Choose a sender to see their mail and tidy it up.",
                                "Kies een afzender om hun mail te zien en op te ruimen.",
                            )),
                    ),
                ),
                None => shell.child(self.render_empty_pane()),
            };
        };
        let id = thread.id.clone();
        let conversation = match self.reading.get(&id) {
            Some(Reading::Ready(conversation)) => Some(conversation.clone()),
            _ => None,
        };
        let images_allowed = self.images.contains(&id) || Feature::RemoteImages.on();
        let images_hidden = conversation.as_ref().is_some_and(|c| c.remote_images) && !images_allowed;
        let toolbar = self.render_toolbar(&thread, images_hidden, cx);
        let Some(conversation) = conversation else {
            self.hide_webview(cx);
            let message = match self.reading.get(&id) {
                Some(Reading::Failed(error)) => div()
                    .p(px(24.))
                    .text_size(px(14.))
                    .text_color(theme::danger())
                    .child(error.clone()),
                _ => div()
                    .p(px(24.))
                    .text_size(px(14.))
                    .text_color(theme::muted())
                    .child(t("Opening…", "Openen…")),
            };
            return shell.child(toolbar).child(message);
        };
        let Some(webview) = self.webview(window, cx) else {
            return shell.child(toolbar);
        };
        let dark = theme::is_dark();
        let wanted = (id.clone(), images_allowed, dark);
        if self.shown.as_ref() != Some(&wanted) {
            self.document += 1;
            let document = email::themed_document(
                &conversation.subject,
                &conversation.parts,
                images_allowed,
                &self.nonce,
                self.document,
                dark,
            );
            let _ = webview.read(cx).raw().set_background_color(backdrop(dark));
            let _ = webview.read(cx).load_html(&document);
            self.shown = Some(wanted);
        }
        let veiled = self.veiled();
        webview.update(cx, |webview, _| {
            if veiled {
                webview.hide();
            } else if !webview.visible() {
                webview.show();
            }
        });
        let composer = self.render_composer(cx);
        shell
            .child(toolbar)
            // The webview lies above everything GPUI draws: it leaves room for the
            // toasts, and stays clear of the panel's round corners.
            .child(
                div()
                    .flex_1()
                    .min_h_0()
                    .pb(px(self.toast_room().max(10.)))
                    .child(webview),
            )
            .children(composer)
    }

    /// What can be done with the open conversation. A tool names itself at
    /// the toolbar's end while pointed at: the mail's webview draws over GPUI
    /// overlays, so a tooltip would vanish under it.
    fn render_toolbar(&self, thread: &crate::api::Thread, images_hidden: bool, cx: &mut Context<Self>) -> Div {
        let folder = self.view.folder();
        let can_delete = self.mailbox(&thread.account_id).is_some_and(Mailbox::can_delete_forever);
        let starred = thread.is_starred;
        let snoozed = self.is_snoozed(&thread.id);
        let pinned = self.is_pinned(&thread.id);
        let id = thread.id.clone();
        let mut tools: Vec<AnyElement> = Vec::new();
        for action in move_actions(folder, can_delete) {
            let key = match action {
                ThreadAction::Archive => "E",
                ThreadAction::Trash => "#",
                ThreadAction::Inbox => "I",
                _ => "",
            };
            tools.push(
                tool(
                    ("move", action as usize),
                    move_icon(action),
                    move_label(action, folder),
                    key,
                    is_destructive(action),
                    cx,
                )
                .on_click(cx.listener(move |this, _, _, cx| this.leave(action, None, cx)))
                .into_any_element(),
            );
        }
        if can_report_spam(folder) {
            tools.push(
                tool("spam", "spam", t("Report spam", "Spam melden"), "!", false, cx)
                    .on_click(cx.listener(|this, _, _, cx| this.leave(ThreadAction::Spam, None, cx)))
                    .into_any_element(),
            );
        }
        tools.push(if snoozed {
            let id = id.clone();
            tool("unsnooze", "alarm-clock-off", t("Unsnooze", "Niet meer snoozen"), "B", false, cx)
                .on_click(cx.listener(move |this, _, _, cx| this.unsnooze(id.clone(), cx)))
                .into_any_element()
        } else {
            tool("snooze", "alarm-clock", t("Snooze", "Snoozen"), "B", false, cx)
                .on_click(cx.listener(|this, _, window, cx| this.open_when(SnoozeTarget::Open, window, cx)))
                .into_any_element()
        });
        tools.push(
            tool(
                "star",
                if starred { "star-filled" } else { "star" },
                if starred { t("Remove star", "Ster verwijderen") } else { t("Star", "Ster toevoegen") },
                "S",
                false,
                cx,
            )
            .on_click(cx.listener(move |this, _, _, cx| {
                this.leave(if starred { ThreadAction::Unstar } else { ThreadAction::Star }, None, cx)
            }))
            .into_any_element(),
        );
        if self.can_pin(thread) {
            let target = thread.clone();
            tools.push(
                tool(
                    "pin",
                    if pinned { "pin-off" } else { "pin" },
                    if pinned { t("Unpin", "Losmaken") } else { t("Pin to top", "Bovenaan vastpinnen") },
                    "P",
                    false,
                    cx,
                )
                .on_click(cx.listener(move |this, _, _, cx| this.set_pinned(target.clone(), !pinned, cx)))
                .into_any_element(),
            );
        }
        tools.push(
            tool("unread", "mail-01", t("Mark as unread", "Markeren als ongelezen"), "U", false, cx)
                .on_click(cx.listener(|this, _, _, cx| this.leave(ThreadAction::Unread, None, cx)))
                .into_any_element(),
        );
        div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(2.))
            .h(px(HEADER))
            .px(px(12.))
            .children(tools)
            .child(div().flex_1())
            .map(|el| match (&self.tool_hint, &self.status) {
                (Some(hint), _) => el.child(
                    div()
                        .flex_none()
                        .text_size(px(12.))
                        .text_color(theme::muted())
                        .child(hint.clone()),
                ),
                (None, Some((status, failed))) => el.child(
                    div()
                        .min_w_0()
                        .truncate()
                        .text_size(px(12.))
                        .text_color(if *failed { theme::danger() } else { theme::muted() })
                        .child(status.clone()),
                ),
                (None, None) if images_hidden => el
                    .child(
                        div()
                            .min_w_0()
                            .truncate()
                            .text_size(px(12.))
                            .text_color(theme::muted())
                            .child(t(
                                "Images are hidden to stop senders tracking you.",
                                "Afbeeldingen zijn verborgen zodat afzenders je niet kunnen volgen.",
                            )),
                    )
                    .child(
                        ui::button_sm("show-images", t("Show images", "Afbeeldingen tonen"), ui::Variant::Ghost)
                            .ml(px(6.))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.images.insert(id.clone());
                                cx.notify();
                            })),
                    ),
                _ => el,
            })
    }
}

/// A toolbar action: its sign. Its name and key show at the toolbar's end while it is pointed at.
fn tool(
    id: impl Into<ElementId>,
    icon: &'static str,
    label: &'static str,
    key: &'static str,
    destructive: bool,
    cx: &mut Context<MailView>,
) -> Stateful<Div> {
    let hint: SharedString = if key.is_empty() {
        label.into()
    } else {
        format!("{label}  {key}").into()
    };
    let group = SharedString::from(format!("tool-{icon}"));
    let color = if icon == "star-filled" { list::amber() } else { theme::muted() };
    let hover = if icon == "star-filled" {
        list::amber()
    } else if destructive {
        theme::danger()
    } else {
        theme::foreground()
    };
    div()
        .id(id)
        .group(group.clone())
        .flex()
        .flex_none()
        .items_center()
        .justify_center()
        .size(px(28.))
        .rounded(theme::RADIUS_MD)
        .cursor_pointer()
        .hover(|el| el.bg(theme::muted_bg()))
        .child(
            theme::hi(icon)
                .text_color(color)
                .group_hover(group, move |el| el.text_color(hover)),
        )
        .on_hover(cx.listener(move |this, hovering: &bool, _, cx| {
            if *hovering {
                this.tool_hint = Some(hint.clone());
            } else if this.tool_hint.as_ref() == Some(&hint) {
                this.tool_hint = None;
            }
            cx.notify();
        }))
}

/// Links in the mail leave for the browser or the mail app; nothing else may leave the page.
fn is_outside(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    ["http:", "https:", "mailto:", "tel:"]
        .iter()
        .any(|scheme| lower.starts_with(scheme))
}
