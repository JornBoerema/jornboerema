//! What the binary carries: the icons (ours and Hugeicons, as on the web) and
//! the Inter font. Everything under assets/ is built in.

use std::borrow::Cow;

use gpui_kit::{App, AssetSource, Result, SharedString};
use rust_embed::RustEmbed;

/// `icons/…` are the Lucide icons of the first screens, `hi/…` the Hugeicons
/// (`node scripts/icons.mjs` writes those), `fonts/…` Inter.
#[derive(RustEmbed)]
#[folder = "assets"]
#[include = "icons/*.svg"]
#[include = "hi/*.svg"]
#[include = "fonts/*.ttf"]
struct Files;

/// Ours first; gpui-kit's own set for what its components need.
pub struct Assets;

impl AssetSource for Assets {
    fn load(&self, path: &str) -> Result<Option<Cow<'static, [u8]>>> {
        match Files::get(path) {
            Some(file) => Ok(Some(file.data)),
            None => gpui_kit::assets::Assets.load(path),
        }
    }

    fn list(&self, path: &str) -> Result<Vec<SharedString>> {
        let mut names: Vec<SharedString> = Files::iter()
            .filter(|name| name.starts_with(path))
            .map(|name| SharedString::from(name.to_string()))
            .collect();
        names.extend(gpui_kit::assets::Assets.list(path)?);
        Ok(names)
    }
}

/// Inter, the web's font, for every text in the app.
pub fn load_fonts(cx: &mut App) {
    let fonts: Vec<Cow<'static, [u8]>> = Files::iter()
        .filter(|name| name.starts_with("fonts/"))
        .filter_map(|name| Files::get(&name).map(|file| file.data))
        .collect();
    if let Err(error) = cx.text_system().add_fonts(fonts) {
        eprintln!("Could not load Inter: {error}");
    }
}
