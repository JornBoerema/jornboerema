//! The building blocks every Even app shares, as packages/ui has them on the
//! web: buttons, the floating panel, sidebar rows, settings sections, tooltips
//! and toasts. Each takes the look from the web's classes named in its comment.
//!
//! For fields, menus, dialogs, selects, switches and checkboxes use
//! gpui-component (`gpui_kit::component`): it reads Even's colours from
//! `theme::apply`. Never a native dropdown: a select is `component::select`.

use gpui_kit::component::notification::Notification;
use gpui_kit::component::tooltip::Tooltip;
use gpui_kit::component::WindowExt as _;
use gpui_kit::prelude::*;
use gpui_kit::*;

use crate::theme;

/// The web's Button variants (packages/ui/src/components/button.tsx).
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Variant {
    /// Filled with the brand colour.
    Primary,
    /// An edge, no fill.
    Outline,
    /// The quiet grey fill.
    Secondary,
    /// Nothing until hovered.
    Ghost,
    /// For what cannot be undone.
    Destructive,
}

/// A button, 32 points tall (the web's default size). `.on_click(…)` it;
/// `.opacity(0.5)` and no handler when disabled (see [`disabled`]).
pub fn button(id: impl Into<ElementId>, label: impl Into<SharedString>, variant: Variant) -> Stateful<Div> {
    button_base(id, variant)
        .h(px(32.))
        .px(px(12.))
        .gap(px(6.))
        .text_size(px(13.))
        .child(label.into())
}

/// The web's `size="sm"`: 28 points tall, 12.5-point text.
pub fn button_sm(id: impl Into<ElementId>, label: impl Into<SharedString>, variant: Variant) -> Stateful<Div> {
    button_base(id, variant)
        .h(px(28.))
        .px(px(10.))
        .gap(px(6.))
        .text_size(px(12.5))
        .child(label.into())
}

/// A button with a sign before its label.
pub fn button_with_icon(
    id: impl Into<ElementId>,
    icon: &str,
    label: impl Into<SharedString>,
    variant: Variant,
) -> Stateful<Div> {
    button_base(id, variant)
        .h(px(32.))
        .pl(px(10.))
        .pr(px(12.))
        .gap(px(6.))
        .text_size(px(13.))
        .child(theme::hi(icon).text_color(variant_foreground(variant)))
        .child(label.into())
}

/// A square button with only a sign: the web's `size="icon-sm"` (28 points).
/// Give it a tooltip that names it.
pub fn icon_button(id: impl Into<ElementId>, icon: &str) -> Stateful<Div> {
    button_base(id, Variant::Ghost)
        .size(px(28.))
        .child(theme::hi(icon).text_color(theme::muted()))
}

fn variant_foreground(variant: Variant) -> Rgba {
    match variant {
        Variant::Primary => theme::primary_foreground(),
        Variant::Destructive => theme::danger(),
        _ => theme::foreground(),
    }
}

fn button_base(id: impl Into<ElementId>, variant: Variant) -> Stateful<Div> {
    let base = div()
        .id(id)
        .flex()
        .flex_none()
        .items_center()
        .justify_center()
        .rounded(theme::RADIUS_MD)
        .font_weight(FontWeight::MEDIUM)
        .text_color(variant_foreground(variant))
        .cursor_pointer();
    match variant {
        Variant::Primary => base
            .bg(theme::primary())
            .hover(|el| el.bg(theme::with_alpha(theme::primary(), 0.9))),
        Variant::Outline => base
            .border_1()
            .border_color(theme::input())
            .bg(theme::background())
            .hover(|el| el.bg(theme::muted_bg())),
        Variant::Secondary => base
            .bg(theme::secondary())
            .hover(|el| el.bg(theme::with_alpha(theme::secondary(), 0.8))),
        Variant::Ghost => base.hover(|el| el.bg(theme::muted_bg())),
        Variant::Destructive => base
            .bg(theme::mix(theme::danger(), 10.))
            .hover(|el| el.bg(theme::mix(theme::danger(), 20.))),
    }
}

/// How a button looks while it can't be pressed. Leave its handler off too.
pub fn disabled<E: Styled>(element: E) -> E {
    element.opacity(0.5).cursor_default()
}

/// A tooltip with plain text: `.tooltip(ui::tip("Archive"))`.
pub fn tip(text: impl Into<SharedString>) -> impl Fn(&mut Window, &mut App) -> AnyView + 'static {
    let text: SharedString = text.into();
    move |window, cx| Tooltip::new(text.clone()).build(window, cx)
}

/// A tooltip with a quieter hint after the text: a shortcut, "Coming soon".
pub fn tip_with_hint(
    text: impl Into<SharedString>,
    hint: impl Into<SharedString>,
) -> impl Fn(&mut Window, &mut App) -> AnyView + 'static {
    let text: SharedString = text.into();
    let hint: SharedString = hint.into();
    move |window, cx| {
        let (text, hint) = (text.clone(), hint.clone());
        Tooltip::element(move |_, _| {
            div()
                .flex()
                .gap(px(8.))
                .child(text.clone())
                .child(div().opacity(0.6).child(hint.clone()))
        })
        .build(window, cx)
    }
}

/// The web's `.floating-panel`: the raised surface of sidebars and panes.
pub fn floating_panel() -> Div {
    div()
        .bg(theme::sidebar())
        .rounded(theme::RADIUS)
        .border_1()
        .border_color(theme::border())
        .shadow_sm()
        .overflow_hidden()
}

/// The web's `.list-sidebar`: a floating panel 248 wide with the sidebar's padding.
/// Put it in a column with `m(px(8.))` around, as [`sidebar_shell`] does.
pub fn list_sidebar() -> Div {
    floating_panel()
        .w(px(248.))
        .flex_none()
        .flex()
        .flex_col()
        .gap(px(8.))
        .pt(px(22.))
        .px(px(16.))
        .pb(px(16.))
}

/// The app's name with its sign, at the top of its sidebar (`.brand`).
pub fn brand(icon: &str, name: impl Into<SharedString>) -> Div {
    div()
        .flex()
        .items_center()
        .gap(px(10.))
        .text_size(px(20.))
        .font_weight(FontWeight(650.))
        .child(theme::hi(icon).size(px(22.)).text_color(theme::primary_mark()))
        .child(name.into())
}

/// The web's `.sidebar-heading`: a quiet 12-point title above a group of rows.
pub fn sidebar_heading(label: impl Into<SharedString>) -> Div {
    div()
        .flex()
        .items_center()
        .justify_between()
        .min_h(px(28.))
        .pl(px(10.))
        .pr(px(4.))
        .pb(px(2.))
        .text_size(px(12.))
        .text_color(theme::muted())
        .child(label.into())
}

/// The web's `.list-link`: a sidebar row with a sign and a label. Add a count
/// or shortcut with [`list_count`] as a further child.
pub fn list_link(id: impl Into<ElementId>, icon: &str, label: impl Into<SharedString>, selected: bool) -> Stateful<Div> {
    list_row(id, selected)
        .child(theme::hi(icon).text_color(if selected {
            theme::primary_mark()
        } else {
            theme::muted()
        }))
        .child(div().flex_1().min_w_0().truncate().child(label.into()))
}

/// A `.list-link` without the sign, for rows that draw their own start.
pub fn list_row(id: impl Into<ElementId>, selected: bool) -> Stateful<Div> {
    div()
        .id(id)
        .flex()
        .flex_none()
        .items_center()
        .gap(px(10.))
        .w_full()
        .min_h(px(34.))
        .px(px(10.))
        .py(px(6.))
        .text_size(px(14.))
        .rounded(theme::RADIUS)
        .cursor_pointer()
        .when(selected, |el| el.bg(theme::accent()).font_weight(FontWeight(550.)))
        .when(!selected, |el| el.hover(|el| el.bg(theme::muted_bg())))
}

/// The web's `.list-count`: a number at the end of a sidebar row.
pub fn list_count(count: impl Into<SharedString>) -> Div {
    div()
        .flex_none()
        .ml_auto()
        .text_size(px(12.))
        .text_color(theme::muted())
        .child(count.into())
}

/// A key or shortcut, as the web's `<kbd>` in menus and hints.
pub fn kbd(keys: impl Into<SharedString>) -> Div {
    div()
        .flex_none()
        .px(px(5.))
        .h(px(18.))
        .flex()
        .items_center()
        .rounded(px(4.))
        .bg(theme::muted_bg())
        .text_size(px(11.))
        .text_color(theme::muted())
        .child(keys.into())
}

/// The web's SettingsSection: a title, perhaps a description, then one card
/// of rows. `rows` are [`settings_row`]s; lines between them are drawn here.
pub fn settings_section(
    title: impl Into<SharedString>,
    description: Option<SharedString>,
    rows: Vec<AnyElement>,
) -> Div {
    settings_section_with(title, description, None, false, rows)
}

/// As [`settings_section`], with a control at the right of the heading (an
/// add button) and the danger look for what cannot be undone.
pub fn settings_section_with(
    title: impl Into<SharedString>,
    description: Option<SharedString>,
    action: Option<AnyElement>,
    destructive: bool,
    rows: Vec<AnyElement>,
) -> Div {
    let count = rows.len();
    div()
        .flex()
        .flex_col()
        .gap(px(12.))
        .child(
            div()
                .flex()
                .items_end()
                .justify_between()
                .gap(px(16.))
                .px(px(4.))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(4.))
                        .min_w_0()
                        .child(
                            div()
                                .text_size(px(16.))
                                .font_weight(FontWeight::SEMIBOLD)
                                .when(destructive, |el| el.text_color(theme::danger()))
                                .child(title.into()),
                        )
                        .when_some(description, |el, description| {
                            el.child(div().text_size(px(14.)).text_color(theme::muted()).child(description))
                        }),
                )
                .when_some(action, |el, action| el.child(div().flex_none().child(action))),
        )
        .child(
            div()
                .flex()
                .flex_col()
                .rounded(theme::RADIUS)
                .bg(theme::card())
                .border_1()
                .border_color(theme::border())
                .overflow_hidden()
                .children(rows.into_iter().enumerate().map(move |(index, row)| {
                    div()
                        .when(index + 1 < count, |el| el.border_b_1().border_color(theme::border()))
                        .child(row)
                })),
        )
}

/// The web's SettingsRow: what the setting is on the left, its control on the right.
pub fn settings_row(
    title: impl Into<SharedString>,
    description: Option<SharedString>,
    control: impl IntoElement,
) -> Div {
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
                        .child(title.into()),
                )
                .when_some(description, |el, description| {
                    el.child(div().text_size(px(14.)).text_color(theme::muted()).child(description))
                }),
        )
        .child(div().flex().flex_none().items_center().gap(px(8.)).child(control))
}

/// A sign that turns while something loads (the web's spinning Loading03Icon).
pub fn spinner() -> impl IntoElement {
    theme::hi("loading-03")
        .text_color(theme::muted())
        .with_animation(
            "spin",
            Animation::new(std::time::Duration::from_secs(1)).repeat(),
            |icon, delta| icon.with_transformation(Transformation::rotate(percentage(delta))),
        )
}

/// A toast at the bottom right, as the web's sonner: what happened, in a line.
pub fn toast(message: impl Into<SharedString>, window: &mut Window, cx: &mut App) {
    window.push_notification(Notification::new().message(message.into()), cx);
}

/// A toast for what went wrong.
pub fn toast_error(message: impl Into<SharedString>, window: &mut Window, cx: &mut App) {
    window.push_notification(Notification::error(message.into()), cx);
}

/// The first letters of a name, for an avatar without a picture.
pub fn initials(name: &str) -> String {
    name.split_whitespace()
        .filter_map(|word| word.chars().next())
        .take(2)
        .flat_map(char::to_uppercase)
        .collect()
}

/// One choice in a [`select`].
#[derive(Clone)]
pub struct SelectOption {
    label: SharedString,
    icon: Option<&'static str>,
    selected: bool,
}

impl SelectOption {
    pub fn new(label: impl Into<SharedString>) -> Self {
        Self {
            label: label.into(),
            icon: None,
            selected: false,
        }
    }

    /// A Hugeicon before the label.
    pub fn icon(mut self, icon: &'static str) -> Self {
        self.icon = Some(icon);
        self
    }

    pub fn selected(mut self, selected: bool) -> Self {
        self.selected = selected;
        self
    }
}

/// The web's Select (never the system's dropdown): a button with the chosen
/// option that opens a menu of them. `on_pick` gets the option's index.
/// 160 wide, as the web's `w-40`; `.w(…)` on the result changes it.
pub fn select(
    id: impl Into<ElementId>,
    options: Vec<SelectOption>,
    on_pick: impl Fn(usize, &mut Window, &mut App) + 'static,
) -> impl IntoElement {
    use gpui_kit::component::button::{Button};
    use gpui_kit::component::menu::{DropdownMenu as _, PopupMenuItem};

    let current = options
        .iter()
        .find(|option| option.selected)
        .map(|option| option.label.clone())
        .unwrap_or_default();
    let on_pick = std::rc::Rc::new(on_pick);
    Button::new(id)
        .outline()
        .label(current)
        .dropdown_caret(true)
        .w(px(160.))
        .justify_between()
        .dropdown_menu(move |mut menu, _, _| {
            menu = menu.min_w(px(160.));
            for (index, option) in options.iter().enumerate() {
                let on_pick = on_pick.clone();
                let mut item = PopupMenuItem::new(option.label.clone()).checked(option.selected);
                if let Some(icon) = option.icon {
                    item = item.icon(gpui_kit::component::Icon::default().path(format!("hi/{icon}.svg")));
                }
                menu = menu.item(item.on_click(move |_, window, cx| on_pick(index, window, cx)));
            }
            menu
        })
}
