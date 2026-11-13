//! Even's colours, from the design tokens in packages/ui/src/styles/globals.css
//! (oklch there, converted to sRGB here). Light and dark, as on the web: the
//! mode is "system" until the user picks one in the settings.

use std::sync::atomic::{AtomicBool, Ordering};

use gpui_kit::component::theme::{Theme, ThemeMode};
use gpui_kit::{prelude::*, px, rgba, svg, App, Hsla, Pixels, Rgba, SharedString, Svg, WindowAppearance};

use crate::prefs;

/// A Lucide icon from gpui-kit's assets, 16 points unless sized otherwise.
/// The first native screens used these; new code takes [`hi`].
pub fn icon(name: &str) -> Svg {
    svg()
        .path(SharedString::from(format!("icons/{name}.svg")))
        .size(px(16.))
        .flex_none()
}

/// A Hugeicon, as on the web: `hi("mail-01")` is the web's `Mail01Icon`.
/// 16 points unless sized otherwise; `node scripts/icons.mjs` writes the files.
pub fn hi(name: &str) -> Svg {
    svg()
        .path(SharedString::from(format!("hi/{name}.svg")))
        .size(px(16.))
        .flex_none()
}

/// What the user picked; "system" follows the Mac.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Choice {
    System,
    Light,
    Dark,
}

impl Choice {
    pub fn key(self) -> &'static str {
        match self {
            Choice::System => "system",
            Choice::Light => "light",
            Choice::Dark => "dark",
        }
    }
}

static DARK: AtomicBool = AtomicBool::new(true);
const PREF: &str = "theme";

pub fn is_dark() -> bool {
    DARK.load(Ordering::Relaxed)
}

pub fn choice() -> Choice {
    // For a look at one theme without changing what the user picked:
    // EVEN_THEME=light|dark (see scripts/shot.sh).
    match std::env::var("EVEN_THEME").as_deref() {
        Ok("light") => return Choice::Light,
        Ok("dark") => return Choice::Dark,
        _ => {}
    }
    match prefs::get(PREF).as_deref() {
        Some("light") => Choice::Light,
        Some("dark") => Choice::Dark,
        _ => Choice::System,
    }
}

/// Keeps the choice and repaints every window with it.
pub fn set_choice(choice: Choice, cx: &mut App) {
    match choice {
        Choice::System => prefs::remove(PREF),
        other => prefs::set(PREF, other.key()),
    }
    apply(cx);
}

/// Brings the colours in line with the choice and, for "system", the Mac's
/// appearance. Call at start and whenever either changes.
pub fn apply(cx: &mut App) {
    let dark = match choice() {
        Choice::Light => false,
        Choice::Dark => true,
        Choice::System => matches!(
            cx.window_appearance(),
            WindowAppearance::Dark | WindowAppearance::VibrantDark
        ),
    };
    DARK.store(dark, Ordering::Relaxed);
    Theme::change(if dark { ThemeMode::Dark } else { ThemeMode::Light }, None, cx);
    // gpui-component's own controls (inputs, menus, dialogs) in Even's colours.
    Theme::update(cx, |theme| {
        let color = |value: Rgba| -> Hsla { value.into() };
        theme.font_family = FONT.into();
        theme.font_size = px(14.);
        theme.radius = RADIUS_MD;
        theme.radius_lg = RADIUS;
        theme.background = color(background());
        theme.foreground = color(foreground());
        theme.border = color(border());
        theme.input = color(input());
        theme.ring = color(ring());
        theme.caret = color(foreground());
        theme.muted = color(muted_bg());
        theme.muted_foreground = color(muted());
        theme.accent = color(accent());
        theme.accent_foreground = color(foreground());
        theme.popover = color(popover());
        theme.popover_foreground = color(foreground());
        theme.primary = color(primary());
        theme.primary_hover = color(with_alpha(primary(), 0.9));
        theme.primary_active = color(with_alpha(primary(), 0.85));
        theme.primary_foreground = color(primary_foreground());
        theme.button_primary = color(primary());
        theme.button_primary_hover = color(with_alpha(primary(), 0.9));
        theme.button_primary_active = color(with_alpha(primary(), 0.85));
        theme.button_primary_foreground = color(primary_foreground());
        theme.secondary = color(secondary());
        theme.secondary_hover = color(with_alpha(secondary(), 0.8));
        theme.secondary_active = color(with_alpha(secondary(), 0.7));
        theme.secondary_foreground = color(foreground());
        theme.danger = color(danger());
        theme.danger_hover = color(with_alpha(danger(), 0.9));
        theme.danger_active = color(with_alpha(danger(), 0.85));
        theme.button_danger = color(danger());
        theme.button_danger_hover = color(with_alpha(danger(), 0.9));
        theme.button_danger_active = color(with_alpha(danger(), 0.85));
        theme.colors.list = color(popover());
        theme.list_hover = color(accent());
        theme.list_active = color(accent());
        theme.sidebar = color(sidebar());
        theme.sidebar_foreground = color(foreground());
        theme.sidebar_border = color(border());
        theme.sidebar_accent = color(accent());
        theme.sidebar_accent_foreground = color(foreground());
        theme.sidebar_primary = color(primary());
        theme.switch = color(input());
        theme.selection = color(with_alpha(primary_mark(), 0.35));
        theme.link = color(primary_mark());
        theme.title_bar = color(background());
        theme.overlay = color(rgba(if dark { 0x00000080 } else { 0x0000001a }));
    });
    cx.refresh_windows();
}

/// The web's font. The files are in assets/fonts and loaded at start.
pub const FONT: &str = "Inter";
/// `--radius` on the web (0.625rem) and the steps derived from it.
pub const RADIUS: Pixels = px(10.);
pub const RADIUS_SM: Pixels = px(6.);
pub const RADIUS_MD: Pixels = px(8.);
pub const RADIUS_XL: Pixels = px(14.);

fn pick(light: u32, dark: u32) -> Rgba {
    rgba(if is_dark() { dark } else { light })
}

/// `color` at `alpha` (0 to 1) of its own opacity: the web's `bg-muted/40`.
pub fn with_alpha(color: Rgba, alpha: f32) -> Rgba {
    Rgba {
        a: color.a * alpha,
        ..color
    }
}

/// The web's `color-mix(in oklch, <color> N%, transparent)`.
pub fn mix(color: Rgba, percent: f32) -> Rgba {
    with_alpha(color, percent / 100.)
}

// The tokens, by their web names where the names agree.

/// `--background`: the window.
pub fn background() -> Rgba {
    pick(0xffffffff, 0x0a0a0aff)
}
/// `--foreground`.
pub fn foreground() -> Rgba {
    pick(0x0a0a0aff, 0xfafafaff)
}
/// `--card`.
pub fn card() -> Rgba {
    pick(0xffffffff, 0x171717ff)
}
/// `--popover`: menus, dialogs.
pub fn popover() -> Rgba {
    pick(0xffffffff, 0x171717ff)
}
/// `--primary`: filled buttons.
pub fn primary() -> Rgba {
    pick(0xbb4d00ff, 0x973c00ff)
}
/// `--primary-foreground`.
pub fn primary_foreground() -> Rgba {
    rgba(0xfffbebff)
}
/// The accent on small marks (a selected icon, a dot, a link). The web uses
/// `--primary` there; on dark it is too dim for thin strokes, so a step lighter.
pub fn primary_mark() -> Rgba {
    pick(0xbb4d00ff, 0xe17100ff)
}
/// `--secondary`.
pub fn secondary() -> Rgba {
    pick(0xf4f4f5ff, 0x27272aff)
}
/// `--muted`: the quiet fill (hovered rows).
pub fn muted_bg() -> Rgba {
    pick(0xf5f5f5ff, 0x262626ff)
}
/// `--muted-foreground`: quiet text.
pub fn muted() -> Rgba {
    pick(0x737373ff, 0xa1a1a1ff)
}
/// Quieter than quiet: placeholders, timestamps in the background.
pub fn faint() -> Rgba {
    pick(0xa1a1a1ff, 0x6b6b6bff)
}
/// `--accent` and `--sidebar-accent`: the selected row.
pub fn accent() -> Rgba {
    pick(0xf5f5f5ff, 0x262626ff)
}
/// A hovered row that is not selected.
pub fn hover() -> Rgba {
    pick(0xf5f5f5cc, 0x26262699)
}
/// `--destructive`.
pub fn danger() -> Rgba {
    pick(0xe7000bff, 0xff6467ff)
}
/// `--border` and `--sidebar-border`.
pub fn border() -> Rgba {
    pick(0xe5e5e5ff, 0xffffff1a)
}
/// `--input`: the edge of a field.
pub fn input() -> Rgba {
    pick(0xe5e5e5ff, 0xffffff26)
}
/// `--ring`: the focus ring.
pub fn ring() -> Rgba {
    pick(0xa1a1a1ff, 0x737373ff)
}
/// `--sidebar`: the floating panels (sidebars, the list, the reader).
pub fn sidebar() -> Rgba {
    pick(0xfafafaff, 0x171717ff)
}
/// The panes beside the sidebar. The same raised colour as the sidebar.
pub fn panel() -> Rgba {
    sidebar()
}
pub fn starred() -> Rgba {
    pick(0xd08700ff, 0xeba002ff)
}
pub fn success() -> Rgba {
    pick(0x00a63eff, 0x26b76eff)
}

/// Mailbox colours, the same eight as the web's account dots.
const ACCOUNT_COLORS: [u32; 8] = [
    0x3e96eaff, 0xeba002ff, 0xed5c9eff, 0x26b76eff, 0x9d6fe3ff, 0x14bbc2ff, 0xe9483dff, 0x88909cff,
];

pub fn account(color: usize) -> Rgba {
    rgba(ACCOUNT_COLORS[color % ACCOUNT_COLORS.len()])
}
