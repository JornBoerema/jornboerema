//! Even's dark theme, from the design tokens in packages/ui (oklch, converted).

use gpui_kit::{rgb, rgba, Rgba};

pub fn background() -> Rgba {
    rgb(0x0a0a0a)
}
pub fn sidebar() -> Rgba {
    rgb(0x141414)
}
pub fn panel() -> Rgba {
    rgb(0x0f0f0f)
}
pub fn foreground() -> Rgba {
    rgb(0xfafafa)
}
pub fn muted() -> Rgba {
    rgb(0xa1a1a1)
}
pub fn faint() -> Rgba {
    rgb(0x6b6b6b)
}
pub fn accent() -> Rgba {
    rgb(0x262626)
}
pub fn hover() -> Rgba {
    rgba(0x26262699)
}
pub fn border() -> Rgba {
    rgba(0xffffff1a)
}
/// The brand orange, a step lighter than the web's dark primary for small marks.
pub fn primary() -> Rgba {
    rgb(0xe8772e)
}
pub fn danger() -> Rgba {
    rgb(0xe9483d)
}
pub fn starred() -> Rgba {
    rgb(0xeba002)
}

/// Mailbox colours, the same eight as the web's account dots.
const ACCOUNT_COLORS: [u32; 8] = [0x3e96ea, 0xeba002, 0xed5c9e, 0x26b76e, 0x9d6fe3, 0x14bbc2, 0xe9483d, 0x88909c];

pub fn account(color: usize) -> Rgba {
    rgb(ACCOUNT_COLORS[color % ACCOUNT_COLORS.len()])
}
