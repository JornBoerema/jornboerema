//! English and Dutch, as on the web (packages/i18n): the language is the
//! Mac's until the user picks one in the settings. Words live next to the
//! screen that shows them: `t("Sign out", "Uitloggen")`.

use std::sync::atomic::{AtomicU8, Ordering};

use crate::prefs;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Lang {
    En,
    Nl,
}

impl Lang {
    /// "en" or "nl": what the API reads from Accept-Language.
    pub fn code(self) -> &'static str {
        match self {
            Lang::En => "en",
            Lang::Nl => "nl",
        }
    }

    /// The language's own name.
    pub fn name(self) -> &'static str {
        match self {
            Lang::En => "English",
            Lang::Nl => "Nederlands",
        }
    }

    /// For dates and numbers: `chrono::Locale` of this language.
    pub fn locale(self) -> chrono::Locale {
        match self {
            Lang::En => chrono::Locale::en_GB,
            Lang::Nl => chrono::Locale::nl_NL,
        }
    }
}

const PREF: &str = "language";
/// 0 = not read yet, 1 = English, 2 = Dutch.
static CURRENT: AtomicU8 = AtomicU8::new(0);

fn system() -> Lang {
    let locale = sys_locale::get_locale().unwrap_or_default().to_lowercase();
    if locale.starts_with("nl") {
        Lang::Nl
    } else {
        Lang::En
    }
}

/// What the user picked, if anything: `None` follows the Mac.
pub fn preference() -> Option<Lang> {
    match prefs::get(PREF).as_deref() {
        Some("en") => Some(Lang::En),
        Some("nl") => Some(Lang::Nl),
        _ => None,
    }
}

/// Keeps the pick. Repaint the windows after it (`cx.refresh_windows()`).
pub fn set_preference(lang: Option<Lang>) {
    match lang {
        Some(lang) => prefs::set(PREF, lang.code()),
        None => prefs::remove(PREF),
    }
    CURRENT.store(0, Ordering::Relaxed);
}

pub fn lang() -> Lang {
    match CURRENT.load(Ordering::Relaxed) {
        1 => Lang::En,
        2 => Lang::Nl,
        _ => {
            // `EVEN_LANG=en|nl` shows the app in a language for a look, without keeping it.
            let asked = match std::env::var("EVEN_LANG").as_deref() {
                Ok("en") => Some(Lang::En),
                Ok("nl") => Some(Lang::Nl),
                _ => None,
            };
            let lang = asked.or_else(preference).unwrap_or_else(system);
            CURRENT.store(if lang == Lang::En { 1 } else { 2 }, Ordering::Relaxed);
            lang
        }
    }
}

/// The words in the current language. Works for anything, not only text:
/// `t(format!("{n} items"), format!("{n} items"))` too.
pub fn t<T>(en: T, nl: T) -> T {
    match lang() {
        Lang::En => en,
        Lang::Nl => nl,
    }
}
