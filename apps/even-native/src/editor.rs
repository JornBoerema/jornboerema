//! The rich text editor every Even app shares: what tiptap is on the web.
//! GPUI has no rich text editing, so `RichEditor` hosts a system webview with
//! one contenteditable document, driven by our own script. Nothing comes from
//! the network: the script, the styles and Inter are built in, and the page's
//! content policy runs only the script with this view's nonce.
//!
//! The specification is the three web editors:
//! - apps/notes-web/src/components/note-editor.tsx (markdown in and out),
//! - apps/todo-web/src/components/board/description-editor.tsx (markdown),
//! - apps/mail-web/src/components/rich-text-editor.tsx (HTML in and out).
//!
//! The page itself is in assets/editor: `markdown.js` converts (pure string
//! functions, tested by `node scripts/editor-test.mjs`), `editor.js` edits,
//! `editor.css` has the web editors' typography.
//!
//! ```ignore
//! let editor = cx.new(|cx| RichEditor::new(Mode::Markdown, window, cx));
//! editor.update(cx, |editor, cx| {
//!     editor.set_look(Look::ISSUE, cx);
//!     editor.set_placeholder(t("Add a description…", "Voeg een beschrijving toe…"), cx);
//!     editor.set_content(&issue.description, cx);
//! });
//! cx.subscribe_in(&editor, window, |this, _, event, window, cx| match event {
//!     EditorEvent::Changed(markdown) => this.save_soon(markdown.clone(), cx),
//!     EditorEvent::Blurred => this.save_now(cx),
//!     EditorEvent::Shortcut(keys) if keys == "escape" => this.close(window, cx),
//!     _ => {}
//! })
//! .detach();
//! // In render: `div().h(px(300.)).child(self.editor.clone())`.
//! ```
//!
//! A system webview draws above everything GPUI draws. Call
//! [`RichEditor::set_hidden`] while a dialog or menu must show over it, and
//! when the host stops drawing the editor (dropping the entity hides it too).

use std::borrow::Cow;
use std::sync::LazyLock;

use futures::channel::mpsc::{unbounded, UnboundedSender};
use futures::StreamExt as _;
use gpui_kit::component::input as text_input;
use gpui_kit::prelude::*;
use gpui_kit::*;
use gpui_webview::WebView;
use regex::Regex;
use serde::Deserialize;
use serde_json::json;

use crate::i18n::t;
use crate::theme;

mod demo;

pub use demo::demo_window;

const STYLE: &str = include_str!("../assets/editor/editor.css");
const CONVERTERS: &str = include_str!("../assets/editor/markdown.js");
const SCRIPT: &str = include_str!("../assets/editor/editor.js");

/// What the editor reads and writes.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Mode {
    /// Notes and issue descriptions: markdown, as tiptap's StarterKit with
    /// task lists writes it.
    Markdown,
    /// Mail: HTML, with its spacing inline as mail clients need it.
    Html,
}

/// The sizes around the text, which differ per web editor.
#[derive(Clone, Copy, PartialEq, Debug)]
pub struct Look {
    pub font_size: f32,
    /// As a multiple of the font size.
    pub line_height: f32,
    /// Top, right, bottom, left.
    pub padding: [f32; 4],
    /// Between two blocks.
    pub gap: f32,
}

impl Look {
    /// A note: the web's `.note-prose`.
    pub const NOTE: Look = Look {
        font_size: 15.,
        line_height: 1.8,
        padding: [10., 0., 100., 0.],
        gap: 12.,
    };
    /// An issue's description: `.note-prose.issue-prose`.
    pub const ISSUE: Look = Look {
        font_size: 14.5,
        line_height: 1.7,
        padding: [12., 0., 24., 0.],
        gap: 12.,
    };
    /// A mail being written: `.mail-editor`.
    pub const MAIL: Look = Look {
        font_size: 14.,
        line_height: 1.625,
        padding: [12., 16., 12., 16.],
        gap: 0.,
    };
}

/// What a toolbar button or a host asks of the editor. Each acts on the
/// selection and counts as an edit ([`EditorEvent::Changed`] follows).
#[derive(Clone, Debug, PartialEq)]
pub enum Command {
    Bold,
    Italic,
    /// Mail only: markdown has no underline.
    Underline,
    Strike,
    /// Inline code.
    Code,
    BulletList,
    OrderedList,
    /// Markdown only.
    TaskList,
    Quote,
    /// Markdown only.
    CodeBlock,
    /// Markdown only.
    HorizontalRule,
    /// 1 to 6; 0 makes a paragraph again. Markdown only: mail has no headings.
    Heading(u8),
    /// Links the selection, or changes the link the caret is in. `None` unlinks.
    Link(Option<String>),
    /// Opens the address field over the selection, as ⌘K does.
    EditLink,
    /// Mail only: "12px", "18px", "24px"; `None` is the message's own size.
    FontSize(Option<String>),
    /// Mail only: a picture at the caret, as a `data:` address (or `https:`
    /// once [`RichEditor::set_remote_images`] allows those).
    InsertImage { src: String, width: Option<u32> },
    /// HTML at the caret, sanitized as a paste is.
    InsertHtml(String),
    /// Mail only: the signature block at the end, replaced whole; empty removes it.
    SetSignature(String),
    Undo,
    Redo,
}

/// What is on at the caret, for a toolbar's pressed buttons.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ActiveMarks {
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub strike: bool,
    pub code: bool,
    /// The address of the link the caret is in.
    pub link: Option<String>,
    /// 1 to 6 in a heading, else 0.
    pub heading: u8,
    pub bullet_list: bool,
    pub ordered_list: bool,
    pub task_list: bool,
    pub quote: bool,
    pub code_block: bool,
    pub font_size: Option<String>,
    /// Something is selected, not just a caret.
    pub range: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub enum EditorEvent {
    /// The user changed the content: markdown or mail HTML, by [`Mode`].
    /// Never sent for [`RichEditor::set_content`].
    Changed(String),
    Focused,
    /// The last `Changed` always comes before this.
    Blurred,
    SelectionChanged(ActiveMarks),
    /// Keys the editor has no use for, pressed while the webview had the
    /// keyboard: "cmd-enter", "escape", "cmd-s", "tab", "cmd-1". Unless
    /// [`RichEditor::set_forward_shortcuts`] turns it off they are also handed
    /// to the window, so the app's own key bindings keep working.
    Shortcut(String),
    /// A link was ⌘-clicked (or clicked, when not editable). Opened in the
    /// browser unless [`RichEditor::set_open_links`] turns that off.
    LinkClicked(String),
    /// How tall the content is, in points: for a view that grows with it.
    ContentHeight(f32),
}

/// Mail: the page read the content it was given with [`RichEditor::set_content`],
/// so [`RichEditor::html`], [`RichEditor::plain_text`], [`RichEditor::is_written`]
/// and [`RichEditor::body_text`] now say what an unchanged draft holds. An
/// event of its own, beside [`EditorEvent`]: subscribe to it separately.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ContentRead;

/// What the page tells the app. Only our script can post (the page's policy
/// runs nothing else), and every message is still checked here.
#[derive(Debug, PartialEq, Deserialize)]
#[serde(tag = "t", rename_all = "lowercase")]
enum Message {
    Ready,
    Change {
        content: String,
        #[serde(default)]
        text: String,
        #[serde(default)]
        written: bool,
    },
    Focus,
    Blur,
    Selection {
        marks: ActiveMarks,
    },
    Key {
        key: String,
    },
    Link {
        url: String,
    },
    Height {
        px: f32,
    },
    /// ⌘V arrived in the page instead of at the Edit menu.
    Paste {
        #[serde(default)]
        plain: bool,
    },
    /// ⌘C likewise, when the page may not write the clipboard itself.
    Copy {
        text: String,
    },
    /// A pasted picture could not be read.
    Failed,
    /// The wheel turned over a page its host scrolls (see [`RichEditor::set_scroller`]).
    Wheel {
        dy: f32,
    },
    /// Mail: how the page reads the content it was given.
    Read {
        content: String,
        #[serde(default)]
        text: String,
        #[serde(default)]
        written: bool,
        #[serde(default)]
        body: String,
    },
    /// Mail: what is written above the signature, as plain text.
    Body {
        text: String,
    },
    /// From the demo's self-test.
    Log {
        message: String,
    },
}

static KEYS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^((cmd|ctrl|alt|shift)-){0,4}([a-z0-9]{1,10}|[!-/:-@\[-`{-~])$").unwrap());

fn parse_message(raw: &str) -> Option<Message> {
    let message: Message = serde_json::from_str(raw).ok()?;
    match &message {
        Message::Key { key } if !KEYS.is_match(key) => None,
        Message::Height { px } if !px.is_finite() || *px < 0. || *px > 1_000_000. => None,
        Message::Wheel { dy } if !dy.is_finite() || dy.abs() > 100_000. => None,
        _ => Some(message),
    }
}

/// A link's address as it may leave the app: web, mail and phone only. One
/// without a scheme is a web address, as the web editors' `defaultProtocol`.
fn link_address(url: &str) -> Option<String> {
    let url = url.trim();
    if url.is_empty() || url.chars().any(|c| c.is_control()) {
        return None;
    }
    let lower = url.to_ascii_lowercase();
    if ["http://", "https://", "mailto:", "tel:"].iter().any(|scheme| lower.starts_with(scheme)) {
        return Some(url.to_string());
    }
    let scheme = url.split(['/', '?', '#']).next().unwrap_or_default();
    if scheme.contains(':') {
        return None;
    }
    Some(format!("https://{url}"))
}

/// A value as JavaScript source, safe inside a `<script>` too: `<` never
/// appears, so no `</script>` or `<!--` can end or bend the script.
fn js(value: &impl serde::Serialize) -> String {
    serde_json::to_string(value)
        .unwrap_or_else(|_| "null".into())
        .replace('<', "\\u003c")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029")
}

fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            c => out.push(c),
        }
    }
    out
}

fn css(color: Rgba) -> String {
    let byte = |value: f32| (value.clamp(0., 1.) * 255.).round() as u8;
    format!(
        "rgba({},{},{},{:.3})",
        byte(color.r),
        byte(color.g),
        byte(color.b),
        color.a.clamp(0., 1.)
    )
}

/// The shortcuts the editor answers itself. The window sees ⌘-keys before
/// the webview does, so these are passed on to the page from here.
fn is_editing_shortcut(keys: &str) -> bool {
    matches!(
        keys,
        "cmd-b"
            | "cmd-i"
            | "cmd-u"
            | "cmd-e"
            | "cmd-k"
            | "cmd-shift-x"
            | "cmd-shift-s"
            | "cmd-shift-7"
            | "cmd-shift-8"
            | "cmd-shift-9"
            | "cmd-shift-b"
            | "cmd-alt-c"
            | "cmd-alt-0"
            | "cmd-alt-1"
            | "cmd-alt-2"
            | "cmd-alt-3"
            | "cmd-alt-4"
            | "cmd-alt-5"
            | "cmd-alt-6"
            | "cmd-z"
            | "cmd-shift-z"
            | "cmd-y"
    )
}

/// Inter for the page, from the fonts the binary carries.
fn font(path: &str) -> wry::http::Response<Cow<'static, [u8]>> {
    let name = path.trim_start_matches('/');
    let known = name.starts_with("Inter-") && name.ends_with(".ttf") && !name.contains(['/', '\\']);
    let bytes = known
        .then(|| crate::assets::Assets.load(&format!("fonts/{name}")).ok().flatten())
        .flatten();
    let response = match bytes {
        Some(bytes) => wry::http::Response::builder()
            .header("Content-Type", "font/ttf")
            // The page has no origin of its own, and fonts are fetched with CORS.
            .header("Access-Control-Allow-Origin", "*")
            .body(bytes),
        None => wry::http::Response::builder().status(404).body(Cow::Borrowed(&[][..])),
    };
    response.unwrap_or_default()
}

/// The Edit menu. With it ⌘C, ⌘V, ⌘X and ⌘A reach whatever has the keyboard,
/// a webview too: without a menu item macOS gives a webview no clipboard keys.
/// The same actions drive gpui-component's own fields.
pub fn edit_menu() -> Menu {
    Menu {
        name: t("Edit", "Wijzig").into(),
        items: vec![
            MenuItem::os_action(t("Undo", "Herstel"), text_input::Undo, OsAction::Undo),
            MenuItem::os_action(t("Redo", "Opnieuw"), text_input::Redo, OsAction::Redo),
            MenuItem::separator(),
            MenuItem::os_action(t("Cut", "Knip"), text_input::Cut, OsAction::Cut),
            MenuItem::os_action(t("Copy", "Kopieer"), text_input::Copy, OsAction::Copy),
            MenuItem::os_action(t("Paste", "Plak"), text_input::Paste, OsAction::Paste),
            MenuItem::os_action(t("Select All", "Selecteer alles"), text_input::SelectAll, OsAction::SelectAll),
        ],
        disabled: false,
    }
}

/// A rich text field. See the module's words for how a host uses it.
pub struct RichEditor {
    mode: Mode,
    webview: Option<Entity<WebView>>,
    /// Why there is no webview, shown in its place.
    error: Option<SharedString>,
    focus_handle: FocusHandle,
    nonce: String,
    /// The page's script has started: until then, what it must do waits in `queue`.
    ready: bool,
    queue: Vec<String>,
    content: String,
    text: String,
    written: bool,
    /// Mail: the content as the page reads it, and the text above the signature.
    html: String,
    body: String,
    /// Mail: formatting shows on the selection.
    format_menu: bool,
    placeholder: String,
    editable: bool,
    hidden: bool,
    /// The webview has the keyboard.
    focused: bool,
    marks: ActiveMarks,
    height: Option<f32>,
    look: Look,
    /// Asked on every theme change: the host's own surface colour.
    background: fn() -> Rgba,
    /// The colours the page last got, to tell it only when they change.
    theme_sent: String,
    remote_images: bool,
    open_links: bool,
    forward_shortcuts: bool,
    /// The pane that scrolls this editor along with what is around it.
    scroller: Option<ScrollHandle>,
    ipc: UnboundedSender<String>,
    _ipc: Task<()>,
}

impl EventEmitter<EditorEvent> for RichEditor {}
impl EventEmitter<ContentRead> for RichEditor {}

impl Focusable for RichEditor {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl RichEditor {
    pub fn new(mode: Mode, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let (ipc, mut received) = unbounded::<String>();
        let task = cx.spawn_in(window, async move |this, cx| {
            while let Some(raw) = received.next().await {
                if this
                    .update_in(cx, |this, window, cx| this.message(&raw, window, cx))
                    .is_err()
                {
                    break;
                }
            }
        });
        let mut editor = Self {
            mode,
            webview: None,
            error: None,
            focus_handle: cx.focus_handle(),
            nonce: nonce(),
            ready: false,
            queue: Vec::new(),
            content: String::new(),
            text: String::new(),
            written: false,
            html: String::new(),
            body: String::new(),
            format_menu: false,
            placeholder: String::new(),
            editable: true,
            hidden: false,
            focused: false,
            marks: ActiveMarks::default(),
            height: None,
            look: match mode {
                Mode::Markdown => Look::NOTE,
                Mode::Html => Look::MAIL,
            },
            background: theme::background,
            theme_sent: String::new(),
            remote_images: false,
            open_links: true,
            forward_shortcuts: true,
            scroller: None,
            ipc,
            _ipc: task,
        };
        editor.build(window, cx);
        editor
    }

    fn build(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let ipc = self.ipc.clone();
        let background = (self.background)();
        let byte = |value: f32| (value.clamp(0., 1.) * 255.).round() as u8;
        let builder = wry::WebViewBuilder::new()
            .with_background_color((byte(background.r), byte(background.g), byte(background.b), 255))
            .with_html(self.document())
            .with_ipc_handler(move |request| {
                let _ = ipc.unbounded_send(request.body().clone());
            })
            .with_custom_protocol("evenfont".into(), |_, request| font(request.uri().path()))
            // The page never goes anywhere: links are told to the app, a dropped file must not open.
            .with_navigation_handler(|url| url.starts_with("about:"))
            .with_new_window_req_handler(|_, _| wry::NewWindowResponse::Deny)
            .with_accept_first_mouse(true);
        match WebView::build(builder, window, cx) {
            Ok(webview) => self.webview = Some(cx.new(|_| webview)),
            Err(error) => {
                self.error = Some(
                    t(
                        format!("The editor could not start: {error}"),
                        format!("De editor start niet: {error}"),
                    )
                    .into(),
                )
            }
        }
    }

    /// The whole page: styles, the empty document and our scripts, behind a
    /// policy that loads nothing from anywhere and runs only what has the nonce.
    fn document(&mut self) -> String {
        let nonce = &self.nonce;
        let images = if self.remote_images { " https:" } else { "" };
        let policy = format!(
            "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:{images}; font-src evenfont:; script-src 'nonce-{nonce}'; form-action 'none'; base-uri 'none'"
        );
        let theme = self.theme();
        self.theme_sent = theme.to_string();
        let init = js(&json!({
            "mode": self.mode_name(),
            "theme": theme,
            "look": self.look_values(),
            "placeholder": self.placeholder,
            "editable": self.editable,
            "linkPlaceholder": t("Paste or type a link", "Plak of typ een link"),
        }));
        let mode = self.mode_name();
        let label = escape(&self.placeholder);
        format!(
            r#"<!doctype html><html class="{mode}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="{policy}"><meta name="referrer" content="no-referrer"><style>{STYLE}</style></head><body><div id="editor" contenteditable="true" role="textbox" aria-multiline="true" aria-label="{label}"></div><div id="link" hidden><input type="url" autocomplete="off" spellcheck="false"></div><script nonce="{nonce}">window.EVEN_INIT={init};</script><script nonce="{nonce}">{CONVERTERS}</script><script nonce="{nonce}">{SCRIPT}</script></body></html>"#
        )
    }

    fn mode_name(&self) -> &'static str {
        match self.mode {
            Mode::Markdown => "markdown",
            Mode::Html => "html",
        }
    }

    /// Even's colours as the page's CSS variables.
    fn theme(&self) -> serde_json::Value {
        json!({
            "scheme": if theme::is_dark() { "dark" } else { "light" },
            "background": css((self.background)()),
            "foreground": css(theme::foreground()),
            "muted": css(theme::muted_bg()),
            "muted-foreground": css(theme::muted()),
            "border": css(theme::border()),
            // Links and the caret: the web's --primary, a step lighter on dark (see theme::primary_mark).
            "brand": css(theme::primary_mark()),
            "primary": css(theme::primary()),
            "primary-foreground": css(theme::primary_foreground()),
            "selection": css(theme::with_alpha(theme::primary_mark(), 0.35)),
            "popover": css(theme::popover()),
            "box": css(theme::ring()),
            "box-fill": css(theme::with_alpha(theme::background(), 0.)),
        })
    }

    fn look_values(&self) -> serde_json::Value {
        let [top, right, bottom, left] = self.look.padding;
        json!({
            "font-size": format!("{}px", self.look.font_size),
            "line-height": self.look.line_height.to_string(),
            "padding": format!("{top}px {right}px {bottom}px {left}px"),
            "gap": format!("{}px", self.look.gap),
        })
    }

    /// Runs script in the page, or keeps it until the page is there.
    fn eval(&mut self, script: String, cx: &App) {
        if !self.ready {
            self.queue.push(script);
            return;
        }
        if let Some(webview) = &self.webview {
            let _ = webview.read(cx).evaluate_script(&script);
        }
    }

    /// Shows this content. No [`EditorEvent::Changed`] follows: that is for
    /// what the user does.
    pub fn set_content(&mut self, content: &str, cx: &mut Context<Self>) {
        self.content = content.to_string();
        self.text.clear();
        self.written = false;
        self.html.clear();
        self.body.clear();
        self.eval(format!("__even.set({})", js(&content)), cx);
    }

    /// Mail: the content as mail HTML, as the page reads it: what the user
    /// made of it, or what was set once [`ContentRead`] came. Empty when
    /// nothing but blank lines is written.
    pub fn html(&self) -> &str {
        &self.html
    }

    /// Mail: what is written above the signature, as plain text.
    pub fn body_text(&self) -> &str {
        &self.body
    }

    /// Mail: puts `html` in place of everything above the signature, as one undo step.
    pub fn set_body(&mut self, html: &str, cx: &mut Context<Self>) {
        self.eval(format!("__even.setBody({})", js(&html)), cx);
    }

    /// Mail: text is about to be written into the body as it arrives
    /// ([`Self::stream_body`]), without filling the undo history.
    /// [`Self::finish_stream`] makes the result a single undo step back to how it was.
    pub fn start_stream(&mut self, cx: &mut Context<Self>) {
        self.eval("__even.startStream()".into(), cx);
    }

    pub fn stream_body(&mut self, html: &str, cx: &mut Context<Self>) {
        self.eval(format!("__even.streamBody({})", js(&html)), cx);
    }

    pub fn finish_stream(&mut self, html: &str, cx: &mut Context<Self>) {
        self.eval(format!("__even.finishStream({})", js(&html)), cx);
    }

    /// Mail: puts back what was there before [`Self::start_stream`].
    pub fn cancel_stream(&mut self, cx: &mut Context<Self>) {
        self.eval("__even.cancelStream()".into(), cx);
    }

    /// Mail: the web's bubble menu. While something is selected, its
    /// formatting (bold to quote, a link, the text size) shows above it.
    pub fn set_format_menu(&mut self, on: bool, cx: &mut Context<Self>) {
        self.format_menu = on;
        let script = self.format_menu_script();
        self.eval(script, cx);
    }

    fn format_menu_script(&self) -> String {
        if !self.format_menu {
            return "__even.bubble(null)".into();
        }
        let icons: serde_json::Map<String, serde_json::Value> = [
            ("bold", "text-bold"),
            ("italic", "text-italic"),
            ("underline", "text-underline"),
            ("strike", "text-strikethrough"),
            ("link", "link-01"),
            ("size", "text-font"),
            ("bulletList", "left-to-right-list-bullet"),
            ("orderedList", "left-to-right-list-number"),
            ("quote", "quote-down"),
        ]
        .into_iter()
        .filter_map(|(tool, icon)| {
            let bytes = crate::assets::Assets.load(&format!("hi/{icon}.svg")).ok().flatten()?;
            Some((tool.to_string(), String::from_utf8_lossy(&bytes).into_owned().into()))
        })
        .collect();
        let config = json!({
            "icons": icons,
            "labels": {
                "bold": t("Bold", "Vet"),
                "italic": t("Italic", "Cursief"),
                "underline": t("Underline", "Onderstrepen"),
                "strike": t("Strikethrough", "Doorhalen"),
                "link": t("Link", "Link"),
                "size": t("Text size", "Tekstgrootte"),
                "bulletList": t("Bulleted list", "Lijst met opsommingstekens"),
                "orderedList": t("Numbered list", "Genummerde lijst"),
                "quote": t("Quote", "Citaat"),
                "sizes": {
                    "small": t("Small", "Klein"),
                    "normal": t("Normal", "Normaal"),
                    "large": t("Large", "Groot"),
                    "huge": t("Huge", "Extra groot"),
                },
            },
        });
        format!("__even.bubble({})", js(&config))
    }

    /// The content as last known: what was set, or what the user made of it.
    pub fn content(&self) -> String {
        self.content.clone()
    }

    /// Mail: the content as plain text, one line per paragraph. Known once
    /// the user changed something.
    pub fn plain_text(&self) -> &str {
        &self.text
    }

    /// Mail: something besides the signature has been written.
    pub fn is_written(&self) -> bool {
        self.written
    }

    pub fn mode(&self) -> Mode {
        self.mode
    }

    /// What is on at the caret, as last told by [`EditorEvent::SelectionChanged`].
    pub fn marks(&self) -> &ActiveMarks {
        &self.marks
    }

    /// Whether the webview has the keyboard.
    pub fn is_focused(&self) -> bool {
        self.focused
    }

    /// The content's height, once the page measured it.
    pub fn content_height(&self) -> Option<f32> {
        self.height
    }

    pub fn set_placeholder(&mut self, placeholder: impl Into<String>, cx: &mut Context<Self>) {
        self.placeholder = placeholder.into();
        self.eval(format!("__even.placeholder({})", js(&self.placeholder)), cx);
    }

    /// Read-only when `false`: the text can still be selected and its links followed.
    pub fn set_editable(&mut self, editable: bool, cx: &mut Context<Self>) {
        if self.editable == editable {
            return;
        }
        self.editable = editable;
        self.eval(format!("__even.editable({editable})"), cx);
    }

    /// The sizes of one of the web editors; see [`Look`].
    pub fn set_look(&mut self, look: Look, cx: &mut Context<Self>) {
        if self.look == look {
            return;
        }
        self.look = look;
        let values = self.look_values();
        self.eval(format!("__even.look({values})"), cx);
    }

    /// The colour behind the text: the surface the host puts the editor on,
    /// as a `theme::…` function so it follows light and dark.
    pub fn set_background(&mut self, background: fn() -> Rgba, cx: &mut Context<Self>) {
        self.background = background;
        self.sync_theme(cx);
    }

    /// Lets the page load pictures from the web (a signature with a hosted
    /// logo). Off by default, as mail shows no remote pictures unasked.
    pub fn set_remote_images(&mut self, allow: bool, cx: &mut Context<Self>) {
        if self.remote_images == allow {
            return;
        }
        self.remote_images = allow;
        // The policy is part of the page, so the page loads again with what it held.
        self.ready = false;
        self.queue = vec![format!("__even.set({})", js(&self.content))];
        if self.format_menu {
            self.queue.push(self.format_menu_script());
        }
        let document = self.document();
        if let Some(webview) = &self.webview {
            let _ = webview.read(cx).load_html(&document);
        }
    }

    /// Whether a followed link opens in the browser (it does unless turned off).
    pub fn set_open_links(&mut self, open: bool) {
        self.open_links = open;
    }

    /// Whether [`EditorEvent::Shortcut`] keys are also given to the window's
    /// own key bindings (they are unless turned off).
    pub fn set_forward_shortcuts(&mut self, forward: bool) {
        self.forward_shortcuts = forward;
    }

    /// Notes: typing "/" at the start of a paragraph lists these blocks
    /// (`(id, label)`, the ids of note-editor.tsx's `blockIds`) to turn the
    /// line into; `empty` shows when what is typed after it matches none.
    pub fn set_slash_menu(&mut self, blocks: &[(&str, &str)], empty: &str, cx: &mut Context<Self>) {
        let blocks: Vec<_> = blocks.iter().map(|(id, label)| json!({ "id": id, "label": label })).collect();
        let config = json!({ "blocks": blocks, "empty": empty });
        self.eval(format!("__even.slash({})", js(&config)), cx);
    }

    /// For an editor as tall as its content ([`EditorEvent::ContentHeight`])
    /// inside a pane the host scrolls: the wheel over the text scrolls that
    /// pane, and typing past its edge brings the caret back in sight. The
    /// host draws only the part in sight and says where it starts with
    /// [`Self::set_page_scroll`] (a system webview can't be clipped).
    pub fn set_scroller(&mut self, scroller: ScrollHandle, cx: &mut Context<Self>) {
        self.scroller = Some(scroller);
        self.set_page_scroll(0., cx);
    }

    /// How far down the document the part the view shows starts, in points.
    pub fn set_page_scroll(&mut self, top: f32, cx: &mut Context<Self>) {
        self.eval(format!("__even.scroll({})", js(&top.max(0.))), cx);
    }

    /// Gives the editor the keyboard, the caret where it last was.
    pub fn focus(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.focus_at("", window, cx);
    }

    /// Gives the editor the keyboard with the caret at the start, as mail
    /// does so typing goes above a signature.
    pub fn focus_start(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.focus_at("start", window, cx);
    }

    fn focus_at(&mut self, place: &str, window: &mut Window, cx: &mut Context<Self>) {
        window.focus(&self.focus_handle, cx);
        if let Some(webview) = &self.webview {
            let _ = webview.read(cx).focus();
        }
        self.eval(format!("__even.focus({})", js(&place)), cx);
    }

    /// Hands the keyboard back to the window, before a field of the host's
    /// own takes it: a webview keeps it otherwise.
    pub fn release_keyboard(&self, cx: &App) {
        if let Some(webview) = &self.webview {
            let _ = webview.read(cx).raw().focus_parent();
        }
    }

    /// Presses a key combination in the page, as if typed there: "cmd-a",
    /// "cmd-b". For combinations the host's own key bindings caught first.
    pub fn press(&mut self, keys: &str, cx: &mut Context<Self>) {
        self.eval(format!("__even.combo({})", js(&keys)), cx);
    }

    /// Does what a toolbar button asks, on the selection.
    pub fn exec(&mut self, command: Command, cx: &mut Context<Self>) {
        // The signature changes with the mailbox, while the keyboard is elsewhere.
        let refocus = !matches!(command, Command::SetSignature(_));
        let (name, value) = match command {
            Command::Bold => ("bold", json!(null)),
            Command::Italic => ("italic", json!(null)),
            Command::Underline => ("underline", json!(null)),
            Command::Strike => ("strike", json!(null)),
            Command::Code => ("code", json!(null)),
            Command::BulletList => ("bulletList", json!(null)),
            Command::OrderedList => ("orderedList", json!(null)),
            Command::TaskList => ("taskList", json!(null)),
            Command::Quote => ("quote", json!(null)),
            Command::CodeBlock => ("codeBlock", json!(null)),
            Command::HorizontalRule => ("rule", json!(null)),
            Command::Heading(level) => ("heading", json!(level.min(6))),
            Command::Link(url) => ("link", json!(url.unwrap_or_default())),
            Command::EditLink => ("editLink", json!(null)),
            Command::FontSize(size) => ("fontSize", json!(size)),
            Command::InsertImage { src, width } => ("image", json!({ "src": src, "width": width })),
            Command::InsertHtml(html) => ("html", json!(html)),
            Command::SetSignature(html) => ("signature", json!(html)),
            Command::Undo => ("undo", json!(null)),
            Command::Redo => ("redo", json!(null)),
        };
        self.eval(format!("__even.exec({}, {})", js(&name), js(&value)), cx);
        // A click on a toolbar took the keyboard from the webview: back to the text.
        if refocus && !self.hidden {
            if let Some(webview) = &self.webview {
                let _ = webview.read(cx).focus();
            }
        }
    }

    /// Takes the webview off the screen, or puts it back. A system webview
    /// draws above all of GPUI, so hide it under dialogs and menus and when
    /// the host stops drawing the editor.
    pub fn set_hidden(&mut self, hidden: bool, cx: &mut Context<Self>) {
        if self.hidden == hidden {
            return;
        }
        self.hidden = hidden;
        if let Some(webview) = &self.webview {
            webview.update(cx, |webview, _| {
                if hidden {
                    webview.hide()
                } else {
                    webview.show()
                }
            });
        }
        cx.notify();
    }

    pub fn is_hidden(&self) -> bool {
        self.hidden
    }

    /// Brings the page's colours in line with Even's theme. Drawing the
    /// editor does this, so a host only calls it for an editor it isn't drawing.
    pub fn sync_theme(&mut self, cx: &mut Context<Self>) {
        let theme = self.theme().to_string();
        if theme == self.theme_sent {
            return;
        }
        self.eval(format!("__even.theme({theme})"), cx);
        self.theme_sent = theme;
    }

    /// For the demo's self-test: script in the page, after everything queued.
    fn run(&mut self, script: &str, cx: &mut Context<Self>) {
        self.eval(script.to_string(), cx);
    }

    fn message(&mut self, raw: &str, window: &mut Window, cx: &mut Context<Self>) {
        let Some(message) = parse_message(raw) else { return };
        match message {
            Message::Ready => {
                self.ready = true;
                for script in std::mem::take(&mut self.queue) {
                    self.eval(script, cx);
                }
            }
            Message::Change { content, text, written } => {
                self.content = content.clone();
                self.text = text;
                self.written = written;
                if self.mode == Mode::Html {
                    self.html = content.clone();
                }
                cx.emit(EditorEvent::Changed(content));
            }
            Message::Read { content, text, written, body } => {
                self.html = content;
                self.text = text;
                self.written = written;
                self.body = body;
                cx.emit(ContentRead);
            }
            Message::Body { text } => self.body = text,
            Message::Focus => {
                self.focused = true;
                // GPUI's focus follows, so ⌘-keys the window sees first come to this view.
                window.focus(&self.focus_handle, cx);
                cx.emit(EditorEvent::Focused);
            }
            Message::Blur => {
                self.focused = false;
                cx.emit(EditorEvent::Blurred);
            }
            Message::Selection { marks } => {
                self.marks = marks.clone();
                cx.emit(EditorEvent::SelectionChanged(marks));
            }
            Message::Key { key } => {
                cx.emit(EditorEvent::Shortcut(key.clone()));
                if self.forward_shortcuts {
                    if let Ok(keystroke) = Keystroke::parse_with_os(&key, OperatingSystem::Mac) {
                        // After this update: the binding it finds may want this editor.
                        window.defer(cx, move |window, cx| {
                            window.dispatch_keystroke(keystroke, cx);
                        });
                    }
                }
            }
            Message::Link { url } => {
                let Some(url) = link_address(&url) else { return };
                if self.open_links {
                    cx.open_url(&url);
                }
                cx.emit(EditorEvent::LinkClicked(url));
            }
            Message::Height { px } => {
                self.height = Some(px);
                cx.emit(EditorEvent::ContentHeight(px));
            }
            Message::Paste { plain } => {
                if let Some(text) = cx.read_from_clipboard().and_then(|item| item.text()) {
                    self.eval(format!("__even.paste({}, {plain})", js(&text)), cx);
                }
            }
            Message::Copy { text } => {
                if !text.is_empty() {
                    cx.write_to_clipboard(ClipboardItem::new_string(text));
                }
            }
            Message::Failed => crate::ui::toast_error(
                t("That image couldn't be added.", "Die afbeelding kon niet worden toegevoegd."),
                window,
                cx,
            ),
            Message::Wheel { dy } => {
                if let Some(scroller) = &self.scroller {
                    let (offset, most) = (scroller.offset(), scroller.max_offset());
                    let y = (offset.y - px(dy)).clamp(-most.y, px(0.));
                    if y != offset.y {
                        scroller.set_offset(point(offset.x, y));
                        window.refresh();
                    }
                }
            }
            Message::Log { message } => eprintln!("[editor] {message}"),
        }
    }

    /// ⌘-keys reach the window before the webview. The editor's own are
    /// handed to the page; the rest go on to the app's bindings.
    fn key_down(&mut self, event: &KeyDownEvent, _: &mut Window, cx: &mut Context<Self>) {
        let modifiers = event.keystroke.modifiers;
        if !self.focused || !modifiers.platform || modifiers.control || modifiers.function {
            return;
        }
        let keys = format!(
            "cmd-{}{}{}",
            if modifiers.alt { "alt-" } else { "" },
            if modifiers.shift { "shift-" } else { "" },
            event.keystroke.key
        );
        if !is_editing_shortcut(&keys) {
            return;
        }
        self.eval(format!("__even.combo({})", js(&keys)), cx);
        cx.stop_propagation();
    }
}

impl Render for RichEditor {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.sync_theme(cx);
        let hidden = self.hidden;
        if let Some(webview) = &self.webview {
            webview.update(cx, |webview, _| {
                if hidden {
                    if webview.visible() {
                        webview.hide();
                    }
                } else if !webview.visible() {
                    webview.show();
                }
            });
        }
        div()
            .track_focus(&self.focus_handle)
            .size_full()
            .on_key_down(cx.listener(Self::key_down))
            // The Edit menu's Undo and Redo arrive as actions, not as keys.
            .on_action(cx.listener(|this, _: &text_input::Undo, _, cx| this.exec(Command::Undo, cx)))
            .on_action(cx.listener(|this, _: &text_input::Redo, _, cx| this.exec(Command::Redo, cx)))
            .children(self.webview.clone())
            .when_some(self.error.clone(), |el, error| {
                el.child(div().text_size(px(13.)).text_color(theme::danger()).child(error))
            })
    }
}

fn nonce() -> String {
    use base64::Engine as _;
    use rand::RngCore as _;
    let mut bytes = [0u8; 18];
    rand::thread_rng().fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// A picture that travels with a mail as an inline file (the API's `MailInlineUpload`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InlineImage {
    pub content_id: String,
    pub name: String,
    pub content_type: String,
    /// Base64.
    pub data: String,
}

static DATA_IMAGE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"src="(data:(image/[\w.+-]+);base64,([A-Za-z0-9+/=]+))""#).unwrap());
static CID_IMAGE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"src="cid:([^"]+)""#).unwrap());

/// FNV-1a over the address, in base 36: the same id for the same picture, so
/// saving a draft again keeps its ids (as the web's lib/inline-images.ts).
fn image_hash(value: &str) -> String {
    let mut hash: u32 = 0x811c9dc5;
    for unit in value.encode_utf16() {
        hash ^= unit as u32;
        hash = hash.wrapping_mul(0x01000193);
    }
    base36(hash as u64)
}

fn base36(mut value: u64) -> String {
    if value == 0 {
        return "0".into();
    }
    let mut digits = Vec::new();
    while value > 0 {
        digits.push(char::from_digit((value % 36) as u32, 36).unwrap_or('0'));
        value /= 36;
    }
    digits.iter().rev().collect()
}

/// Mail clients block `data:` pictures: each one in the editor's HTML becomes
/// an inline file, and the HTML refers to it by content id.
pub fn to_inline_images(html: &str) -> (String, Vec<InlineImage>) {
    let mut images: Vec<InlineImage> = Vec::new();
    let html = DATA_IMAGE.replace_all(html, |found: &regex::Captures| {
        let (src, content_type, data) = (&found[1], &found[2], &found[3]);
        let hash = image_hash(src);
        let content_id = format!("{hash}.{}@evido", base36(src.encode_utf16().count() as u64));
        if !images.iter().any(|image| image.content_id == content_id) {
            let extension = match content_type {
                "image/jpeg" => "jpg",
                "image/png" => "png",
                "image/gif" => "gif",
                "image/webp" => "webp",
                _ => "img",
            };
            images.push(InlineImage {
                content_id: content_id.clone(),
                name: format!("image-{hash}.{extension}"),
                content_type: content_type.to_string(),
                data: data.to_string(),
            });
        }
        format!(r#"src="cid:{content_id}""#)
    });
    (html.into_owned(), images)
}

/// The other way, for a saved draft: `cid:` links become pictures the editor can show.
pub fn from_inline_images(html: &str, images: &[InlineImage]) -> String {
    CID_IMAGE
        .replace_all(html, |found: &regex::Captures| {
            match images.iter().find(|image| image.content_id == found[1]) {
                Some(image) if image.content_type.starts_with("image/") => {
                    format!(r#"src="data:{};base64,{}""#, image.content_type, image.data)
                }
                _ => found[0].to_string(),
            }
        })
        .into_owned()
}

#[cfg(test)]
mod tests {
    // Not `super::*`: that brings in gpui's own `test` attribute.
    use gpui_kit::rgba;
    use serde_json::json;

    use super::{
        base36, css, escape, from_inline_images, is_editing_shortcut, js, link_address, parse_message, to_inline_images,
        Message, CONVERTERS, SCRIPT, STYLE,
    };

    #[test]
    fn reads_what_the_page_says() {
        assert_eq!(parse_message(r#"{"t":"ready"}"#), Some(Message::Ready));
        assert_eq!(parse_message(r#"{"t":"focus"}"#), Some(Message::Focus));
        assert_eq!(parse_message(r#"{"t":"blur"}"#), Some(Message::Blur));
        assert_eq!(
            parse_message(r##"{"t":"change","content":"# Hi","text":"","written":false}"##),
            Some(Message::Change {
                content: "# Hi".into(),
                text: String::new(),
                written: false
            })
        );
        assert_eq!(
            parse_message(r#"{"t":"change","content":"<p>a</p>","text":"a","written":true}"#),
            Some(Message::Change {
                content: "<p>a</p>".into(),
                text: "a".into(),
                written: true
            })
        );
        assert_eq!(
            parse_message(r#"{"t":"key","key":"cmd-enter"}"#),
            Some(Message::Key { key: "cmd-enter".into() })
        );
        assert_eq!(
            parse_message(r#"{"t":"key","key":"cmd-,"}"#),
            Some(Message::Key { key: "cmd-,".into() })
        );
        assert_eq!(
            parse_message(r#"{"t":"link","url":"https://example.com"}"#),
            Some(Message::Link {
                url: "https://example.com".into()
            })
        );
        assert_eq!(parse_message(r#"{"t":"height","px":412}"#), Some(Message::Height { px: 412. }));
        assert_eq!(parse_message(r#"{"t":"paste","plain":true}"#), Some(Message::Paste { plain: true }));
        assert_eq!(parse_message(r#"{"t":"failed","what":"image"}"#), Some(Message::Failed));
    }

    #[test]
    fn reads_the_marks() {
        let message = parse_message(
            r#"{"t":"selection","marks":{"bold":true,"italic":false,"link":"https://a.b","heading":2,"taskList":true,"fontSize":"18px","range":true}}"#,
        );
        let Some(Message::Selection { marks }) = message else {
            panic!("not a selection")
        };
        assert!(marks.bold && !marks.italic && marks.task_list && marks.range && !marks.bullet_list);
        assert_eq!(marks.link.as_deref(), Some("https://a.b"));
        assert_eq!(marks.heading, 2);
        assert_eq!(marks.font_size.as_deref(), Some("18px"));
    }

    #[test]
    fn drops_what_it_does_not_know() {
        assert_eq!(parse_message(""), None);
        assert_eq!(parse_message("key:j"), None);
        assert_eq!(parse_message(r#"{"t":"quit"}"#), None);
        assert_eq!(parse_message(r#"{"t":"change"}"#), None);
        assert_eq!(parse_message(r#"{"t":"key","key":"cmd-enter; rm"}"#), None);
        assert_eq!(parse_message(r#"{"t":"key","key":""}"#), None);
        assert_eq!(parse_message(r#"{"t":"height","px":-4}"#), None);
        assert_eq!(parse_message(r#"{"t":"height","px":1e12}"#), None);
        assert_eq!(parse_message(r#"{"t":"height","px":"tall"}"#), None);
    }

    #[test]
    fn only_lets_links_out_that_are_links() {
        assert_eq!(link_address("https://example.com/a?b=1"), Some("https://example.com/a?b=1".into()));
        assert_eq!(link_address(" MAILTO:a@b.nl "), Some("MAILTO:a@b.nl".into()));
        assert_eq!(link_address("tel:+31600000000"), Some("tel:+31600000000".into()));
        assert_eq!(link_address("example.com/path"), Some("https://example.com/path".into()));
        assert_eq!(link_address("example.com/a:b"), Some("https://example.com/a:b".into()));
        assert_eq!(link_address("javascript:alert(1)"), None);
        assert_eq!(link_address("file:///etc/passwd"), None);
        assert_eq!(link_address("data:text/html,x"), None);
        assert_eq!(link_address("https://a.b/\nx"), None);
        assert_eq!(link_address(""), None);
    }

    #[test]
    fn escapes_html() {
        assert_eq!(escape(r#"<a href="x">Tom & 'Jerry'</a>"#), "&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;");
        assert_eq!(escape("plain"), "plain");
    }

    #[test]
    fn script_values_cannot_leave_the_script() {
        assert_eq!(js(&"plain"), r#""plain""#);
        assert_eq!(js(&"a\"b\\c\nd"), r#""a\"b\\c\nd""#);
        let value = js(&"</script><script>alert(1)</script><!--");
        assert!(!value.contains('<'));
        assert_eq!(serde_json::from_str::<String>(&value).unwrap(), "</script><script>alert(1)</script><!--");
        assert_eq!(js(&"a\u{2028}b\u{2029}"), r#""a\u2028b\u2029""#);
        assert_eq!(js(&json!({ "a": "<b>" })), r#"{"a":"\u003cb>"}"#);
    }

    #[test]
    fn the_page_is_one_document() {
        // Each source goes inside its own tag; neither may close it early.
        for source in [CONVERTERS, SCRIPT] {
            let lower = source.to_ascii_lowercase();
            assert!(!lower.contains("</script"));
            assert!(!lower.contains("<script"));
        }
        assert!(!STYLE.to_ascii_lowercase().contains("</style"));
    }

    #[test]
    fn colours_as_css() {
        assert_eq!(css(rgba(0xbb4d00ff)), "rgba(187,77,0,1.000)");
        assert_eq!(css(rgba(0xffffff1a)), "rgba(255,255,255,0.102)");
    }

    #[test]
    fn knows_its_own_shortcuts() {
        assert!(is_editing_shortcut("cmd-b"));
        assert!(is_editing_shortcut("cmd-shift-x"));
        assert!(is_editing_shortcut("cmd-alt-2"));
        // The app's, and the clipboard's (the Edit menu's).
        assert!(!is_editing_shortcut("cmd-1"));
        assert!(!is_editing_shortcut("cmd-,"));
        assert!(!is_editing_shortcut("cmd-enter"));
        assert!(!is_editing_shortcut("cmd-v"));
    }

    #[test]
    fn pictures_travel_as_inline_files() {
        let src = "data:image/png;base64,iVBORw0KGgo=";
        let html = format!(r#"<p><img src="{src}" width="40"><img src="{src}"></p><img src="https://a.b/c.png">"#);
        let (out, images) = to_inline_images(&html);
        assert_eq!(images.len(), 1);
        let image = &images[0];
        // The web's ids: FNV-1a of the address and its length, both in base 36.
        assert_eq!(image.content_id, "1fgj1jg.y@evido");
        assert_eq!(image.name, "image-1fgj1jg.png");
        assert_eq!(image.content_type, "image/png");
        assert_eq!(image.data, "iVBORw0KGgo=");
        assert_eq!(
            out,
            r#"<p><img src="cid:1fgj1jg.y@evido" width="40"><img src="cid:1fgj1jg.y@evido"></p><img src="https://a.b/c.png">"#
        );
        assert_eq!(from_inline_images(&out, &images), html);
        assert_eq!(from_inline_images(r#"<img src="cid:other">"#, &images), r#"<img src="cid:other">"#);
        assert_eq!(to_inline_images("<p>no pictures</p>"), ("<p>no pictures</p>".to_string(), vec![]));
    }

    #[test]
    fn base_36() {
        assert_eq!(base36(0), "0");
        assert_eq!(base36(35), "z");
        assert_eq!(base36(36), "10");
        assert_eq!(base36(u32::MAX as u64), "1z141z3");
    }
}
