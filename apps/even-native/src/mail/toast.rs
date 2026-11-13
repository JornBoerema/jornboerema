//! Mail's toasts, as the web's sonner shows them at the bottom right: what
//! happened in a line, with Undo while a move can still be taken back
//! (lib/undo.ts) and a count while a sender is tidied (lib/senders.ts).
//! Drawn here rather than through `ui::toast`: the open mail is a system
//! webview above everything GPUI draws, so the reader makes room for them.

use std::time::Duration;

use crate::ui;

use super::*;

/// How long a toast without an action stays (sonner's default).
const STAY: Duration = Duration::from_secs(4);
/// One toast's height and the gap between two, for the room the reader leaves.
const HEIGHT: f32 = 52.;
const GAP: f32 = 8.;
const EDGE: f32 = 24.;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum ToastKind {
    Plain,
    Success,
    Error,
    /// Something in progress: stays until it is replaced.
    Loading,
}

#[derive(Clone)]
pub(crate) enum ToastAction {
    /// Takes back the move with this serial.
    Undo(u64),
    /// After unsubscribing: archive everything from this sender too.
    AlsoArchive(String),
    /// Opens what the toast is about (a task, a file in Moneybird) in the browser.
    Open(String),
    /// Takes back the message that is about to be sent (compose.rs).
    UndoSend(u64),
    /// Puts back what the message said before the AI wrote it (compose/ai.rs).
    UndoAi(u64),
    /// Only closes the toast.
    Dismiss,
}

pub(crate) struct Toast {
    id: u64,
    /// A toast with a key replaces the one before it with the same key.
    key: Option<String>,
    text: SharedString,
    kind: ToastKind,
    action: Option<(SharedString, ToastAction)>,
}

impl MailView {
    /// Shows a toast and says which. `held` ones stay until dismissed (an
    /// undo's lifetime is its move's); the others go by themselves.
    pub(crate) fn toast(
        &mut self,
        text: impl Into<SharedString>,
        kind: ToastKind,
        action: Option<(SharedString, ToastAction)>,
        held: bool,
        cx: &mut Context<Self>,
    ) -> u64 {
        self.push_toast(None, text.into(), kind, action, held, cx)
    }

    /// A toast that replaces the one with the same key: progress, then how it ended.
    pub(crate) fn toast_keyed(
        &mut self,
        key: &str,
        text: impl Into<SharedString>,
        kind: ToastKind,
        action: Option<(SharedString, ToastAction)>,
        cx: &mut Context<Self>,
    ) -> u64 {
        self.toasts.retain(|toast| toast.key.as_deref() != Some(key));
        self.push_toast(Some(key.to_string()), text.into(), kind, action, kind == ToastKind::Loading, cx)
    }

    fn push_toast(
        &mut self,
        key: Option<String>,
        text: SharedString,
        kind: ToastKind,
        action: Option<(SharedString, ToastAction)>,
        held: bool,
        cx: &mut Context<Self>,
    ) -> u64 {
        self.serial += 1;
        let id = self.serial;
        // An action needs time to be read and reached.
        let stay = if action.is_some() { STAY * 2 } else { STAY };
        self.toasts.push(Toast {
            id,
            key,
            text,
            kind,
            action,
        });
        // No more than three at once, as sonner stacks them.
        if self.toasts.len() > 3 {
            let extra = self.toasts.len() - 3;
            let droppable: Vec<u64> = self
                .toasts
                .iter()
                .filter(|toast| !matches!(toast.action, Some((_, ToastAction::Undo(_)))))
                .take(extra)
                .map(|toast| toast.id)
                .collect();
            self.toasts.retain(|toast| !droppable.contains(&toast.id));
        }
        if !held {
            cx.spawn(async move |this, cx| {
                cx.background_executor().timer(stay).await;
                let _ = this.update(cx, |this, cx| this.dismiss_toast(id, cx));
            })
            .detach();
        }
        cx.notify();
        id
    }

    pub(crate) fn dismiss_toast(&mut self, id: u64, cx: &mut Context<Self>) {
        let before = self.toasts.len();
        self.toasts.retain(|toast| toast.id != id);
        if self.toasts.len() != before {
            cx.notify();
        }
    }

    fn toast_action(&mut self, id: u64, cx: &mut Context<Self>) {
        let Some(toast) = self.toasts.iter().find(|toast| toast.id == id) else { return };
        let action = toast.action.as_ref().map(|(_, action)| action.clone());
        self.dismiss_toast(id, cx);
        match action {
            Some(ToastAction::Undo(serial)) => self.undo(serial, cx),
            Some(ToastAction::AlsoArchive(email)) => {
                let sender = self
                    .senders
                    .data
                    .as_ref()
                    .and_then(|senders| senders.iter().find(|sender| sender.email == email))
                    .cloned();
                if let Some(sender) = sender {
                    self.tidy(sender, "archive", cx);
                }
            }
            Some(ToastAction::Open(url)) => {
                let _ = open::that_detached(url);
            }
            Some(ToastAction::UndoSend(serial)) => self.undo_send(serial, cx),
            Some(ToastAction::UndoAi(key)) => self.undo_ai(key, cx),
            Some(ToastAction::Dismiss) | None => {}
        }
    }

    /// The room the toasts take at the bottom of the reader, so the mail's
    /// webview doesn't lie over them.
    pub(crate) fn toast_room(&self) -> f32 {
        match self.toasts.len() {
            0 => 0.,
            count => EDGE + count as f32 * HEIGHT + (count - 1) as f32 * GAP,
        }
    }

    pub(crate) fn render_toasts(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        if self.toasts.is_empty() {
            return None;
        }
        let toasts = self.toasts.iter().map(|toast| {
            let id = toast.id;
            div()
                .id(("toast", id))
                .flex()
                .items_center()
                .gap(px(8.))
                .w(px(356.))
                .h(px(HEIGHT))
                .px(px(16.))
                .rounded(theme::RADIUS_MD)
                .bg(theme::popover())
                .border_1()
                .border_color(theme::border())
                .shadow_lg()
                .text_size(px(13.))
                .occlude()
                .map(|el| match toast.kind {
                    ToastKind::Plain => el,
                    ToastKind::Success => el.child(theme::hi("checkmark-circle-02").text_color(theme::foreground())),
                    ToastKind::Error => el.child(theme::hi("alert-02").text_color(theme::danger())),
                    ToastKind::Loading => el.child(ui::spinner()),
                })
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .truncate()
                        .font_weight(FontWeight::MEDIUM)
                        .child(toast.text.clone()),
                )
                .when_some(toast.action.as_ref(), |el, (label, _)| {
                    el.child(
                        div()
                            .id(("toast-action", id))
                            .flex()
                            .flex_none()
                            .items_center()
                            .h(px(24.))
                            .px(px(8.))
                            .rounded(px(4.))
                            .bg(theme::foreground())
                            .text_color(theme::background())
                            .text_size(px(12.))
                            .font_weight(FontWeight::MEDIUM)
                            .cursor_pointer()
                            .hover(|el| el.opacity(0.9))
                            .child(label.clone())
                            .on_click(cx.listener(move |this, _, _, cx| this.toast_action(id, cx))),
                    )
                })
        });
        Some(
            div()
                .absolute()
                .right(px(EDGE))
                .bottom(px(EDGE))
                .flex()
                .flex_col()
                .gap(px(GAP))
                .children(toasts)
                .into_any_element(),
        )
    }
}
