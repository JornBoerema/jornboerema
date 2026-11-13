//! What Even doen (src/todo) and Even noteren (src/notes) share. Both show the
//! same workspaces, so both hear the same realtime channel and draw the same
//! pieces of packages/ui where `ui` has none yet: the Dialog, the
//! DropdownMenu's panel, the Alert, the Input and the brand in the sidebar.
//! One implementation here; each app reaches it through its own module
//! (`todo::overlay`, `todo::kit`, `notes::parts`).

use gpui_kit::component::input::{Input, InputState};
use gpui_kit::component::WindowExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;

use crate::{theme, ui};

pub mod realtime;

/// For a run that only looks (scripts/shot.sh, debug builds): with
/// `EVEN_LOG_WRITES` set, every change an app is about to send to
/// /api/workspace is named on stderr, and with `EVEN_LOG_WRITES=block` it is
/// refused instead of sent. Opening a note or an issue must name none.
pub fn before_write(app: &str, command: &impl serde::Serialize) -> anyhow::Result<()> {
    if cfg!(debug_assertions) {
        if let Ok(mode) = std::env::var("EVEN_LOG_WRITES") {
            let kind = serde_json::to_value(command)
                .ok()
                .and_then(|value| value.get("type").and_then(|kind| kind.as_str()).map(str::to_string))
                .unwrap_or_default();
            eprintln!("[{app}] write: {kind}");
            if mode == "block" {
                anyhow::bail!("writes are blocked for this run");
            }
        }
    }
    Ok(())
}

/// components/brand.tsx of each web app: the sign, the name and the dot.
pub fn brand(icon: &str, name: impl Into<SharedString>) -> Div {
    div()
        .flex()
        .items_center()
        .gap(px(10.))
        .text_size(px(20.))
        .font_weight(FontWeight(650.))
        .child(theme::hi(icon).size(px(20.)).text_color(theme::primary_mark()))
        .child(
            div()
                .flex()
                .child(name.into())
                .child(div().text_color(theme::primary_mark()).child(".")),
        )
}

/// The ring the web draws round popovers and dialogs (`ring-foreground/5`, 10 in the dark).
pub fn ring() -> Rgba {
    theme::mix(theme::foreground(), if theme::is_dark() { 10. } else { 5. })
}

/// How much of the window's foot toasts take up right now (`ui::toast`, at
/// the bottom right). The rich text editor is a system view above everything
/// GPUI draws, toasts too: whoever shows one keeps it out of this room.
pub fn toast_room(window: &mut Window, cx: &mut App) -> f32 {
    match window.notifications(cx).len() {
        0 => 0.,
        toasts => 24. + 72. * toasts.min(3) as f32,
    }
}

// ─── Dialog (packages/ui dialog.tsx, alert-dialog.tsx) ──────────────────────

/// `DialogContent`: the raised box, 448 wide, 24 of room, 24 between its parts.
pub fn dialog_panel(id: impl Into<ElementId>, window: &Window) -> Stateful<Div> {
    let width = (window.viewport_size().width - px(32.)).min(px(448.));
    div()
        .id(id)
        .occlude()
        .relative()
        .flex()
        .flex_col()
        .gap(px(24.))
        .w(width)
        .p(px(24.))
        .rounded(theme::RADIUS_XL)
        .bg(theme::popover())
        .border_1()
        .border_color(ring())
        .shadow_xl()
        .font_family(theme::FONT)
        .text_size(px(14.))
        .text_color(theme::foreground())
}

/// `DialogHeader` with its title and the quieter line under it. `large`: an
/// alert dialog's 18-point title.
pub fn dialog_header(title: impl Into<SharedString>, description: Option<SharedString>, large: bool) -> Div {
    div()
        .flex()
        .flex_col()
        .gap(px(6.))
        .child(
            div()
                .text_size(px(if large { 18. } else { 16. }))
                .font_weight(FontWeight::MEDIUM)
                .child(title.into()),
        )
        .when_some(description, |el, description| {
            el.child(div().text_size(px(14.)).text_color(theme::muted()).child(description))
        })
}

/// `DialogFooter`: the buttons, at the right.
pub fn dialog_footer() -> Div {
    div().flex().justify_end().gap(px(8.))
}

/// The cross in a dialog's corner (`absolute top-4 right-4 bg-secondary`).
pub fn dialog_close(id: impl Into<ElementId>) -> Stateful<Div> {
    ui::icon_button(id, "cancel-01")
        .absolute()
        .top(px(16.))
        .right(px(16.))
        .bg(theme::secondary())
}

/// A `FieldLabel` above its control (field.tsx): 14 points, medium, 12 apart.
pub fn labeled(label: impl Into<SharedString>, control: impl IntoElement) -> Div {
    div()
        .flex()
        .flex_col()
        .gap(px(12.))
        .child(div().text_size(px(14.)).font_weight(FontWeight::MEDIUM).child(label.into()))
        .child(control)
}

// ─── Input (input.tsx) ──────────────────────────────────────────────────────

/// A gpui-component field as the web's Input: 32 tall, the quiet fill, no
/// edge until it has the keyboard.
pub fn field(input: &Entity<InputState>, window: &Window, cx: &App) -> Div {
    field_with(input, false, window, cx)
}

/// As [`field`]; `readonly` for text to select and copy only.
pub fn field_with(input: &Entity<InputState>, readonly: bool, window: &Window, cx: &App) -> Div {
    let focused = input.read(cx).focus_handle(cx).is_focused(window);
    div()
        .flex()
        .items_center()
        .h(px(32.))
        .w_full()
        .min_w_0()
        .rounded(theme::RADIUS_MD)
        .border_1()
        .border_color(if focused {
            theme::ring()
        } else {
            theme::with_alpha(theme::ring(), 0.)
        })
        .bg(theme::mix(theme::input(), 50.))
        .text_size(px(14.))
        .child(Input::new(input).appearance(false).readonly(readonly))
}

// ─── Alert (alert.tsx) ──────────────────────────────────────────────────────

/// A bordered card with a title and what to do about it; all in the danger
/// colour for what went wrong.
pub fn alert(title: Option<SharedString>, body: impl IntoElement, destructive: bool) -> Div {
    div()
        .flex()
        .flex_col()
        .flex_none()
        .gap(px(2.))
        .w_full()
        .rounded(theme::RADIUS)
        .border_1()
        .border_color(theme::border())
        .bg(theme::card())
        .px(px(16.))
        .py(px(12.))
        .text_size(px(14.))
        .when(destructive, |el| el.text_color(theme::danger()))
        .when_some(title, |el, title| {
            el.child(div().font_weight(FontWeight::MEDIUM).child(title))
        })
        .child(
            div()
                .text_color(if destructive {
                    theme::with_alpha(theme::danger(), 0.9)
                } else {
                    theme::muted()
                })
                .child(body),
        )
}

// ─── DropdownMenu (dropdown-menu.tsx) ───────────────────────────────────────

/// `DropdownMenuContent`: the raised list a menu opens.
pub fn menu_panel() -> Div {
    div()
        .flex()
        .flex_col()
        .p(px(4.))
        .rounded(theme::RADIUS)
        .bg(theme::popover())
        .border_1()
        .border_color(ring())
        .shadow_lg()
        .font_family(theme::FONT)
        .text_size(px(14.))
        .text_color(theme::foreground())
        .font_weight(FontWeight::NORMAL)
}

/// The fill under the pointer on a menu's row: the accent, or the danger
/// colour thinned for a row that deletes.
pub fn menu_hover(destructive: bool) -> Rgba {
    if destructive {
        theme::mix(theme::danger(), if theme::is_dark() { 20. } else { 10. })
    } else {
        theme::accent()
    }
}

/// `DropdownMenuItem`: a row in a menu. Put its sign and words in.
pub fn menu_item(id: impl Into<ElementId>, destructive: bool) -> Stateful<Div> {
    div()
        .id(id)
        .flex()
        .flex_none()
        .items_center()
        .gap(px(8.))
        .min_h(px(28.))
        .px(px(8.))
        .py(px(6.))
        .rounded(theme::RADIUS_SM)
        .cursor_pointer()
        .when(destructive, |el| el.text_color(theme::danger()))
        .hover(move |el| el.bg(menu_hover(destructive)))
}

/// `DropdownMenuLabel`: a quiet title above a group of rows.
pub fn menu_label(label: impl Into<SharedString>) -> Div {
    div()
        .px(px(8.))
        .py(px(4.))
        .text_size(px(12.))
        .text_color(theme::muted())
        .child(label.into())
}
