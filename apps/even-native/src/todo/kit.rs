//! The small parts Even doen's screens share: the board's glyphs
//! (apps/todo-web/src/components/board/board-meta.tsx), the web's checkbox,
//! switch, progress bar, field and empty state as packages/ui draws them, and
//! where on screen a menu's button is.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use gpui_kit::component::input::{Input, InputState};
use gpui_kit::prelude::*;
use gpui_kit::*;

use super::api::{BoardMember, StatusCategory};
use crate::theme;

/// `#rrggbb` as the API keeps a status's or project's colour.
pub fn hex(color: &str) -> Rgba {
    let value = u32::from_str_radix(color.trim_start_matches('#'), 16).unwrap_or(0x95a2b3);
    rgb(value)
}

/// CSS `oklch(l c h)`, for the avatars' own colours.
fn oklch(l: f32, c: f32, hue: f32) -> Rgba {
    let (a, b) = (c * hue.to_radians().cos(), c * hue.to_radians().sin());
    let l_ = (l + 0.396_337_78 * a + 0.215_803_76 * b).powi(3);
    let m_ = (l - 0.105_561_346 * a - 0.063_854_17 * b).powi(3);
    let s_ = (l - 0.089_484_18 * a - 1.291_485_5 * b).powi(3);
    let encode = |value: f32| {
        let value = value.clamp(0., 1.);
        if value <= 0.003_130_8 {
            12.92 * value
        } else {
            1.055 * value.powf(1. / 2.4) - 0.055
        }
    };
    Rgba {
        r: encode(4.076_741_7 * l_ - 3.307_711_6 * m_ + 0.230_969_93 * s_),
        g: encode(-1.268_438 * l_ + 2.609_757_4 * m_ - 0.341_319_4 * s_),
        b: encode(-0.004_196_086_3 * l_ - 0.703_418_6 * m_ + 1.707_614_7 * s_),
        a: 1.,
    }
}

/// Where the triggers of menus are on screen, by name: a menu opens against
/// the button that asked for it, as the web's dropdowns do.
pub type Tracked = Rc<RefCell<HashMap<SharedString, Bounds<Pixels>>>>;

/// Put this inside a `relative()` element to remember its bounds under `key`.
pub fn track(tracked: &Tracked, key: impl Into<SharedString>) -> impl IntoElement {
    let tracked = tracked.clone();
    let key: SharedString = key.into();
    canvas(
        move |bounds, _, _| {
            tracked.borrow_mut().insert(key, bounds);
        },
        |_, _, _, _| {},
    )
    .absolute()
    .inset_0()
}

/// A drawing in the 14 by 14 box the web's inline SVGs use, scaled to `size`.
fn glyph(size: f32, paint: impl Fn(&dyn Fn(f32, f32) -> Point<Pixels>, f32, &mut Window) + 'static) -> impl IntoElement {
    canvas(
        |_, _, _| {},
        move |bounds, _, window, _| {
            let scale = size / 14.;
            let at = move |x: f32, y: f32| point(bounds.origin.x + px(x * scale), bounds.origin.y + px(y * scale));
            paint(&at, scale, window);
        },
    )
    .size(px(size))
    .flex_none()
}

fn circle(path: &mut PathBuilder, at: &dyn Fn(f32, f32) -> Point<Pixels>, radius: f32, scale: f32) {
    let radii = point(px(radius * scale), px(radius * scale));
    path.move_to(at(7. + radius, 7.));
    path.arc_to(radii, px(0.), false, true, at(7. - radius, 7.));
    path.arc_to(radii, px(0.), false, true, at(7. + radius, 7.));
    path.close();
}

/// Linear-style status glyph: dashed (backlog), ring, half-filled, check, cross.
pub fn status_icon(category: Option<StatusCategory>, color: Option<&str>, size: f32) -> impl IntoElement {
    let color: Hsla = color.map(hex).unwrap_or_else(theme::muted).into();
    let category = category.unwrap_or(StatusCategory::Unstarted);
    let background: Hsla = theme::background().into();
    glyph(size, move |at, scale, window| {
        let stroke = px(1.5 * scale);
        match category {
            StatusCategory::Backlog | StatusCategory::Unstarted | StatusCategory::Started => {
                let mut ring = PathBuilder::stroke(stroke);
                if category == StatusCategory::Backlog {
                    ring = ring.dash_array(&[px(1.6 * scale), px(1.6 * scale)]);
                }
                circle(&mut ring, at, 6., scale);
                if let Ok(path) = ring.build() {
                    window.paint_path(path, color);
                }
                if category == StatusCategory::Started {
                    let radii = point(px(3.5 * scale), px(3.5 * scale));
                    let mut half = PathBuilder::fill();
                    half.move_to(at(7., 3.5));
                    half.arc_to(radii, px(0.), false, true, at(7., 10.5));
                    half.close();
                    if let Ok(path) = half.build() {
                        window.paint_path(path, color);
                    }
                }
            }
            StatusCategory::Completed | StatusCategory::Canceled => {
                let mut disc = PathBuilder::fill();
                circle(&mut disc, at, 7., scale);
                if let Ok(path) = disc.build() {
                    window.paint_path(path, color);
                }
                let mut mark = PathBuilder::stroke(stroke);
                if category == StatusCategory::Completed {
                    mark.move_to(at(4.2, 7.2));
                    mark.line_to(at(6.2, 9.1));
                    mark.line_to(at(9.9, 5.1));
                } else {
                    mark.move_to(at(4.8, 4.8));
                    mark.line_to(at(9.2, 9.2));
                    mark.move_to(at(9.2, 4.8));
                    mark.line_to(at(4.8, 9.2));
                }
                if let Ok(path) = mark.build() {
                    window.paint_path(path, background);
                }
            }
        }
    })
}

/// 0 none (dots), 1 urgent (alert square), 2–4 signal bars.
pub fn priority_icon(priority: u8) -> Div {
    let frame = div().relative().size(px(14.)).flex_none();
    match priority {
        1 => frame
            .child(
                div()
                    .absolute()
                    .left(px(0.5))
                    .top(px(0.5))
                    .size(px(13.))
                    .rounded(px(3.))
                    .bg(rgb(0xf2994a)),
            )
            .child(
                div()
                    .absolute()
                    .left(px(6.2))
                    .top(px(2.7))
                    .w(px(1.6))
                    .h(px(5.8))
                    .rounded(px(0.8))
                    .bg(rgb(0xffffff)),
            )
            .child(
                div()
                    .absolute()
                    .left(px(6.05))
                    .top(px(9.25))
                    .size(px(1.9))
                    .rounded_full()
                    .bg(rgb(0xffffff)),
            ),
        0 => frame.children([2.5_f32, 7., 11.5].map(|x| {
            div()
                .absolute()
                .left(px(x - 1.))
                .top(px(6.25))
                .w(px(2.))
                .h(px(1.5))
                .rounded(px(0.5))
                .bg(theme::muted())
        })),
        // high 3, medium 2, low 1
        level => frame.children((0..3u8).map(move |bar| {
            let filled = bar < 5u8.saturating_sub(level);
            div()
                .absolute()
                .left(px(1.5 + f32::from(bar) * 4.))
                .top(px(9. - f32::from(bar) * 3.))
                .w(px(3.))
                .h(px(4. + f32::from(bar) * 3.))
                .rounded(px(0.75))
                .bg(theme::with_alpha(theme::foreground(), if filled { 1. } else { 0.25 }))
        })),
    }
}

/// A project's folder in its colour; the quiet outline when there is none.
pub fn project_dot(color: Option<&str>, size: f32) -> AnyElement {
    let Some(color) = color else {
        return theme::hi("folder-01")
            .size(px(size))
            .text_color(theme::muted())
            .into_any_element();
    };
    let color: Hsla = hex(color).into();
    glyph(size, move |at, _, window| {
        let mut folder = PathBuilder::fill();
        folder.add_polygon(
            &[
                at(1.5, 3.2),
                at(2.2, 2.5),
                at(5.5, 2.5),
                at(7., 4.),
                at(11.8, 4.),
                at(12.5, 4.7),
                at(12.5, 11.3),
                at(11.8, 12.),
                at(2.2, 12.),
                at(1.5, 11.3),
            ],
            true,
        );
        if let Ok(path) = folder.build() {
            window.paint_path(path, color);
        }
    })
    .into_any_element()
}

/// The first letters of the first two words, as the web's avatars.
pub fn initials(name: &str) -> String {
    let letters: String = name
        .split_whitespace()
        .take(2)
        .filter_map(|part| part.chars().next())
        .flat_map(char::to_uppercase)
        .collect();
    if letters.is_empty() {
        "?".into()
    } else {
        letters
    }
}

fn hue(id: &str) -> f32 {
    let mut hash: u32 = 0;
    for unit in id.encode_utf16() {
        hash = (hash * 31 + u32::from(unit)) % 360;
    }
    hash as f32
}

/// A member's initials on their own colour, with the ring that parts a stack.
pub fn member_avatar(member: &BoardMember, size: f32) -> Div {
    // The ring is drawn around the avatar without taking room, as a CSS ring.
    div()
        .flex()
        .flex_none()
        .items_center()
        .justify_center()
        .size(px(size + 4.))
        .m(px(-2.))
        .rounded_full()
        .bg(theme::background())
        .child(
            div()
                .flex()
                .items_center()
                .justify_center()
                .size(px(size))
                .rounded_full()
                .bg(oklch(0.62, 0.12, hue(&member.id)))
                .text_color(rgb(0xffffff))
                .text_size(px(size * 0.42))
                .font_weight(FontWeight::MEDIUM)
                .child(initials(member.label())),
        )
}

/// Up to `max` avatars overlapping, then "+n". Nothing when nobody is assigned.
pub fn avatar_stack(members: &[&BoardMember], size: f32, max: usize) -> Option<Div> {
    if members.is_empty() {
        return None;
    }
    let mut stack = div().flex().flex_none().items_center();
    for (index, member) in members.iter().take(max).enumerate() {
        stack = stack.child(member_avatar(member, size).when(index > 0, |el| el.ml(px(-8.))));
    }
    if members.len() > max {
        stack = stack.child(
            div()
                .m(px(-2.))
                .ml(px(-8.))
                .flex()
                .flex_none()
                .items_center()
                .justify_center()
                .size(px(size + 4.))
                .rounded_full()
                .bg(theme::background())
                .child(
                    div()
                        .flex()
                        .items_center()
                        .justify_center()
                        .size(px(size))
                        .rounded_full()
                        .bg(theme::muted_bg())
                        .text_size(px(10.))
                        .text_color(theme::muted())
                        .child(format!("+{}", members.len() - max)),
                ),
        );
    }
    Some(stack)
}

/// packages/ui's Button, `variant="ghost"` with only a sign: 32 points at
/// `size="icon"`, 28 at `size="icon-sm"`.
pub fn icon_button(id: impl Into<ElementId>, icon: &str, size: f32) -> Stateful<Div> {
    div()
        .id(id)
        .flex()
        .flex_none()
        .items_center()
        .justify_center()
        .size(px(size))
        .rounded(theme::RADIUS_MD)
        .cursor_pointer()
        .hover(|el| el.bg(theme::muted_bg()))
        .child(theme::hi(icon).text_color(theme::foreground()))
}

/// The three looks of packages/ui's Checkbox: empty, the tick on the quiet
/// box (a task in progress, "indeterminate") and the tick on the accent.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Check {
    Off,
    Busy,
    On,
}

pub fn checkbox(id: impl Into<ElementId>, state: Check, size: f32) -> Stateful<Div> {
    div()
        .id(id)
        .flex()
        .flex_none()
        .items_center()
        .justify_center()
        .size(px(size))
        .rounded(px(5.))
        .cursor_pointer()
        .map(|el| match state {
            Check::On => el.bg(theme::primary()),
            _ => el.bg(theme::with_alpha(theme::input(), if theme::is_dark() { 1. } else { 0.9 })),
        })
        .when(state != Check::Off, |el| {
            el.child(theme::hi("tick-02").size(px(14.)).text_color(if state == Check::On {
                theme::primary_foreground()
            } else {
                theme::foreground()
            }))
        })
}

/// packages/ui's Switch at `size="sm"`: 24 by 16.
pub fn switch_sm(id: impl Into<ElementId>, checked: bool) -> Stateful<Div> {
    div()
        .id(id)
        .flex()
        .flex_none()
        .items_center()
        .w(px(24.))
        .h(px(16.))
        .p(px(2.))
        .rounded_full()
        .cursor_pointer()
        .bg(if checked { theme::primary() } else { theme::input() })
        .when(checked, |el| el.justify_end())
        .child(div().size(px(12.)).rounded_full().bg(if checked && theme::is_dark() {
            theme::primary_foreground()
        } else if theme::is_dark() {
            theme::foreground()
        } else {
            theme::background()
        }))
}

/// packages/ui's Progress: an 8-point track with the accent filling `percent` of it.
pub fn progress(percent: f32) -> Div {
    div()
        .flex()
        .h(px(8.))
        .w_full()
        .rounded_full()
        .overflow_hidden()
        .bg(theme::muted_bg())
        .child(
            div()
                .h_full()
                .w(relative(percent.clamp(0., 100.) / 100.))
                .bg(theme::primary()),
        )
}

/// A sign that turns while something is being saved (the web's `animate-spin`).
pub fn spinning(icon: &str) -> impl IntoElement {
    theme::hi(icon).text_color(theme::muted()).with_animation(
        "spin",
        Animation::new(std::time::Duration::from_secs(1)).repeat(),
        |icon, delta| icon.with_transformation(Transformation::rotate(percentage(delta))),
    )
}

/// packages/ui's Skeleton: the quiet block that stands in while something loads.
pub fn skeleton() -> Div {
    div().rounded(theme::RADIUS_MD).bg(theme::muted_bg())
}

/// packages/ui's Input around a gpui-component field: the quiet fill, no edge
/// until it has the keyboard.
pub fn field(state: &Entity<InputState>, window: &Window, cx: &App) -> Div {
    let focused = state.read(cx).focus_handle(cx).is_focused(window);
    div()
        .flex()
        .items_center()
        .h(px(32.))
        .w_full()
        .min_w_0()
        .rounded(theme::RADIUS_MD)
        .border_1()
        .border_color(if focused { theme::ring() } else { gpui_kit::transparent_black().into() })
        .bg(theme::with_alpha(theme::input(), 0.5))
        .text_size(px(14.))
        .child(Input::new(state).appearance(false))
}

/// packages/ui's Empty: a sign, a title, a line below, perhaps a button.
pub fn empty(
    icon: Option<AnyElement>,
    title: impl Into<SharedString>,
    description: impl Into<SharedString>,
    action: Option<AnyElement>,
) -> Div {
    div()
        .flex()
        .flex_col()
        .items_center()
        .justify_center()
        .gap(px(16.))
        .w_full()
        .p(px(48.))
        .child(
            div()
                .flex()
                .flex_col()
                .items_center()
                .gap(px(8.))
                .max_w(px(384.))
                .when_some(icon, |el, icon| el.child(div().mb(px(8.)).child(icon)))
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
                        .child(description.into()),
                ),
        )
        .when_some(action, |el, action| el.child(action))
}

/// packages/ui's Card at `size="sm"`: the raised box of the overview's widgets.
pub fn card() -> Div {
    div()
        .flex()
        .flex_col()
        .gap(px(16.))
        .py(px(16.))
        .rounded(theme::RADIUS_XL)
        .bg(theme::card())
        .border_1()
        .border_color(theme::with_alpha(theme::foreground(), if theme::is_dark() { 0.1 } else { 0.05 }))
        .shadow_sm()
        .overflow_hidden()
        .text_size(px(14.))
}

/// packages/ui's Alert: a quiet box with a title and what to do about it.
pub fn alert(title: Option<SharedString>, description: impl Into<SharedString>, destructive: bool) -> Div {
    div()
        .flex()
        .flex_col()
        .gap(px(2.))
        .w_full()
        .rounded(theme::RADIUS)
        .border_1()
        .border_color(theme::border())
        .bg(theme::card())
        .px(px(16.))
        .py(px(12.))
        .text_size(px(14.))
        .when_some(title, |el, title| {
            el.child(
                div()
                    .font_weight(FontWeight::MEDIUM)
                    .when(destructive, |el| el.text_color(theme::danger()))
                    .child(title),
            )
        })
        .child(
            div()
                .text_color(if destructive {
                    theme::with_alpha(theme::danger(), 0.9)
                } else {
                    theme::muted()
                })
                .child(description.into()),
        )
}

/// apps/todo-web/src/lib/attachments.ts `formatBytes`.
pub fn format_bytes(bytes: u64) -> String {
    const UNITS: [&str; 4] = ["B", "KB", "MB", "GB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024. && unit < UNITS.len() - 1 {
        value /= 1024.;
        unit += 1;
    }
    let number = if unit == 0 {
        format!("{value:.0}")
    } else {
        let text = format!("{value:.1}");
        text.strip_suffix(".0").map(str::to_string).unwrap_or(text)
    };
    // Dutch writes the decimal with a comma, as Intl.NumberFormat does.
    let number = crate::i18n::t(number.clone(), number.replace('.', ","));
    format!("{number} {}", UNITS[unit])
}

#[cfg(test)]
mod tests {
    // Not `super::*`: GPUI's own `test` macro would shadow Rust's.
    use super::{hex, initials};

    #[test]
    fn initials_take_two_words() {
        assert_eq!(initials("jorn boerema"), "JB");
        assert_eq!(initials("  "), "?");
        assert_eq!(initials("Even"), "E");
    }

    #[test]
    fn a_colour_reads_from_hex() {
        let color = hex("#ff0000");
        assert!(color.r > 0.99 && color.g < 0.01 && color.b < 0.01);
    }
}
