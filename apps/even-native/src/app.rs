//! What every app inside Even (mailen, doen, noteren) gives the window that
//! holds them: its screen, its pages in the one settings window, and word
//! when the session lapsed. The shell (src/shell.rs) does the rest.

use gpui_kit::*;

/// A page in the settings window.
#[derive(Clone)]
pub struct SettingsPage {
    /// Stable, the same as the web's page id: "connections", "members".
    pub id: &'static str,
    pub label: SharedString,
    /// A Hugeicon name (see `theme::hi`).
    pub icon: &'static str,
    /// `false`: the app's own page, listed under the app's name.
    /// `true`: a shared page ("connections"); every app that names it shows
    /// its part there, one below the other in rail order.
    pub shared: bool,
    /// More words the settings' search finds the page by.
    pub keywords: Vec<SharedString>,
}

/// What an app tells the shell.
#[derive(Clone, Debug)]
pub enum AppEvent {
    /// The API said the session is over: back to the sign-in screen.
    SignedOut,
    /// Open the settings window, at this page of the app's when given.
    OpenSettings(Option<&'static str>),
    /// Close the settings window and bring this app to the front: what it
    /// does next happens in its own screen (arranging mail's sidebar).
    Show,
}

/// An app in the rail. Its `Render` draws everything right of the rail: its
/// own sidebar (`ui::list_sidebar`) and panes, on `theme::background()`.
pub trait EvenApp: Render + EventEmitter<AppEvent> + Sized + 'static {
    /// The app's pages in the settings window, in order.
    fn settings_pages(&self, _cx: &App) -> Vec<SettingsPage> {
        Vec::new()
    }

    /// The content of one of those pages: `ui::settings_section`s in a column.
    /// For a shared page, only this app's part.
    fn render_settings(&mut self, _page: &str, _window: &mut Window, _cx: &mut Context<Self>) -> AnyElement {
        gpui_kit::div().into_any_element()
    }

    /// The app came on screen: take the keyboard focus, refresh what is stale.
    fn activated(&mut self, _window: &mut Window, _cx: &mut Context<Self>) {}

    /// Something lies over the app (the settings window) or another app
    /// shows. An app with a system webview hides it here: it would draw above.
    fn set_covered(&mut self, _covered: bool, _window: &mut Window, _cx: &mut Context<Self>) {}
}
