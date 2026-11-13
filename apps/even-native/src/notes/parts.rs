//! The pieces Even noteren's screens are built from where `ui` has none yet:
//! the web's Dialog, DropdownMenu, Alert, Empty, Skeleton and Input, with the
//! classes of packages/ui/src/components named at each.

use gpui_kit::component::input::{Input, InputState};
use gpui_kit::prelude::*;
use gpui_kit::*;

use crate::{theme, ui};

/// apps/notes-web/src/components/brand.tsx: the sign, the name and the dot.
pub fn brand() -> Div {
    div()
        .flex()
        .items_center()
        .gap(px(10.))
        .text_size(px(20.))
        .font_weight(FontWeight(650.))
        .child(theme::hi("note-01").size(px(20.)).text_color(theme::primary_mark()))
        .child(
            div()
                .flex()
                .child("Even noteren")
                .child(div().text_color(theme::primary_mark()).child(".")),
        )
}

/// The web's `variant="ghost" size="icon"`: 32 points square, quiet until hovered.
pub fn icon_button(id: impl Into<ElementId>, icon: &str) -> Stateful<Div> {
    ui::icon_button(id, icon).size(px(32.))
}

/// The web's Input (input.tsx): 32 tall, a soft fill, a ring while it has the keyboard.
pub fn field(input: &Entity<InputState>, window: &Window, cx: &App) -> Div {
    field_with(input, false, window, cx)
}

/// As [`field`]; `readonly` for text to select and copy only.
pub fn field_with(input: &Entity<InputState>, readonly: bool, window: &Window, cx: &App) -> Div {
    let focused = input.read(cx).focus_handle(cx).is_focused(window);
    div()
        .flex()
        .items_center()
        .w_full()
        .h(px(32.))
        .rounded(theme::RADIUS_MD)
        .bg(theme::mix(theme::input(), 50.))
        .border_1()
        .border_color(if focused {
            theme::ring()
        } else {
            theme::with_alpha(theme::ring(), 0.)
        })
        .text_size(px(14.))
        .child(Input::new(input).appearance(false).readonly(readonly))
}

/// The web's FieldLabel above its control (field.tsx): 14 points, medium, 12 apart.
pub fn labelled(label: impl Into<SharedString>, control: impl IntoElement) -> Div {
    div()
        .flex()
        .flex_col()
        .gap(px(12.))
        .child(
            div()
                .text_size(px(14.))
                .font_weight(FontWeight::MEDIUM)
                .child(label.into()),
        )
        .child(control)
}

/// The web's Alert (alert.tsx): a bordered card with a title and a line under
/// it; all in the danger colour for what went wrong.
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

/// The web's Empty (empty.tsx): a sign, a title, a line and what to do next,
/// centred. `pad` is the room above and below (`py-20`, `py-10`).
pub fn empty(
    title: impl Into<SharedString>,
    description: impl Into<SharedString>,
    action: Option<AnyElement>,
    pad: f32,
) -> Div {
    div()
        .flex()
        .flex_col()
        .flex_none()
        .items_center()
        .justify_center()
        .gap(px(16.))
        .w_full()
        .px(px(48.))
        .py(px(pad))
        .child(
            div()
                .flex()
                .flex_col()
                .items_center()
                .gap(px(8.))
                .max_w(px(384.))
                .child(
                    div()
                        .mb(px(8.))
                        .child(theme::hi("note-01").size(px(32.)).text_color(theme::primary_mark())),
                )
                .child(
                    div()
                        .text_size(px(18.))
                        .font_weight(FontWeight::MEDIUM)
                        .child(title.into()),
                )
                .child(
                    div()
                        .text_size(px(14.))
                        .line_height(relative(1.625))
                        .text_color(theme::muted())
                        .text_center()
                        .child(description.into()),
                ),
        )
        .when_some(action, |el, action| el.child(action))
}

/// The web's Skeleton: a quiet block where something is still loading.
pub fn skeleton(height: f32) -> Div {
    div()
        .h(px(height))
        .w_full()
        .flex_none()
        .rounded(theme::RADIUS_MD)
        .bg(theme::muted_bg())
}

/// The ring the web draws round popovers and dialogs (`ring-foreground/5`, 10 in the dark).
fn ring() -> Rgba {
    theme::mix(theme::foreground(), if theme::is_dark() { 10. } else { 5. })
}

/// The web's DropdownMenuContent (dropdown-menu.tsx): the raised list a menu opens.
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
        .text_size(px(14.))
        .text_color(theme::foreground())
        .font_weight(FontWeight::NORMAL)
}

/// The web's DropdownMenuItem: a row in a menu. Put its sign and words in.
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
        .when(destructive, |el| {
            el.text_color(theme::danger())
                .hover(|el| el.bg(theme::mix(theme::danger(), if theme::is_dark() { 20. } else { 10. })))
        })
        .when(!destructive, |el| el.hover(|el| el.bg(theme::accent())))
}

/// The web's DropdownMenuLabel: a quiet title above a group of rows.
pub fn menu_label(label: impl Into<SharedString>) -> Div {
    div()
        .px(px(8.))
        .py(px(4.))
        .text_size(px(12.))
        .text_color(theme::muted())
        .child(label.into())
}

/// What lies over the whole window behind a dialog (`bg-black/30`), with the
/// dialog in it. Drawn last and from the window's corner, so it covers the
/// rail too, as on the web.
pub fn backdrop(window: &Window, dialog: impl IntoElement) -> impl IntoElement {
    let size = window.viewport_size();
    deferred(
        anchored().position(point(px(0.), px(0.))).child(
            div()
                .w(size.width)
                .h(size.height)
                .occlude()
                .flex()
                .justify_center()
                .bg(rgba(0x0000004d))
                .font_family(theme::FONT)
                .text_size(px(14.))
                .text_color(theme::foreground())
                .child(dialog),
        ),
    )
    .with_priority(1)
}

/// The web's DialogContent (dialog.tsx): 448 wide, 24 of room, 24 between its parts.
pub fn dialog_panel(id: impl Into<ElementId>, window: &Window) -> Stateful<Div> {
    let width = (window.viewport_size().width - px(32.)).min(px(448.));
    div()
        .id(id)
        .relative()
        .occlude()
        .w(width)
        .flex()
        .flex_col()
        .gap(px(24.))
        .p(px(24.))
        .rounded(theme::RADIUS_XL)
        .bg(theme::popover())
        .border_1()
        .border_color(ring())
        .shadow_xl()
}

/// The web's DialogHeader: the title and a quieter line under it. An alert
/// dialog's title is a size larger.
pub fn dialog_header(title: impl Into<SharedString>, description: impl Into<SharedString>, alert: bool) -> Div {
    div()
        .flex()
        .flex_col()
        .gap(px(6.))
        .child(
            div()
                .text_size(px(if alert { 18. } else { 16. }))
                .font_weight(FontWeight::MEDIUM)
                .child(title.into()),
        )
        .child(
            div()
                .text_size(px(14.))
                .text_color(theme::muted())
                .child(description.into()),
        )
}

/// The web's DialogFooter: the buttons, at the right.
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
