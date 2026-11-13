//! The pieces Even noteren's screens are built from where `ui` has none yet:
//! the web's Empty and Skeleton and the dimmed window behind a dialog here,
//! the Dialog, DropdownMenu, Alert and Input shared with Even doen
//! (src/workspace), with the classes of packages/ui/src/components named at each.

use gpui_kit::prelude::*;
use gpui_kit::*;

use crate::{theme, ui, workspace};

// The Dialog, DropdownMenu, Alert and Input are Even doen's too: src/workspace.
pub use crate::workspace::{
    alert, dialog_close, dialog_footer, dialog_header, dialog_panel, field, field_with, labeled as labelled, menu_item,
    menu_label, menu_panel,
};

/// apps/notes-web/src/components/brand.tsx: the sign, the name and the dot.
pub fn brand() -> Div {
    workspace::brand("note-01", "Even noteren")
}

/// The web's `variant="ghost" size="icon"`: 32 points square, quiet until hovered.
pub fn icon_button(id: impl Into<ElementId>, icon: &str) -> Stateful<Div> {
    ui::icon_button(id, icon).size(px(32.))
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

/// CSS `color-mix(in oklab, a <share>, b)`, near enough in sRGB: `share` of
/// `a` and the rest of `b`, each weighed by how solid it is.
pub fn blend(a: Rgba, b: Rgba, share: f32) -> Rgba {
    let (wa, wb) = (share * a.a, (1. - share) * b.a);
    let alpha = wa + wb;
    if alpha <= 0. {
        return Rgba { r: 0., g: 0., b: 0., a: 0. };
    }
    Rgba {
        r: (a.r * wa + b.r * wb) / alpha,
        g: (a.g * wa + b.g * wb) / alpha,
        b: (a.b * wa + b.b * wb) / alpha,
        a: alpha,
    }
}
