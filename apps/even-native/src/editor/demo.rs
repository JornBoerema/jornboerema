//! The editor by itself in a window, to look at without the rest of the app:
//!
//! ```sh
//! cargo build && EVEN_EDITOR_DEMO=markdown scripts/shot.sh out.png 6
//! EVEN_EDITOR_DEMO=html EVEN_THEME=light scripts/shot.sh out.png 6
//! EVEN_EDITOR_DEMO=selftest EVEN_BACKGROUND=1 target/debug/even-native   # or selftest-html
//! ```
//!
//! `selftest` types into the page through the script (never the keyboard) and
//! prints what each typing shortcut and command made of it, ending with
//! "done"; stop it then.

use gpui_kit::prelude::*;
use gpui_kit::*;

use super::{ActiveMarks, Command, EditorEvent, Look, Mode, RichEditor};
use crate::{theme, ui};

const MARKDOWN: &str = "# The editor, in markdown\n\nA paragraph with **bold**, *italic*, ~~struck~~ and `inline code`, and a [link](https://jornboerema.nl) to follow with ⌘-click.  \nA hard break ends the line before this one.\n\n## Lists\n\n- A bullet\n  - A nested bullet\n- Another bullet\n\n1. First\n2. Second\n\n- [ ] Something to do\n- [x] Something done\n  - [ ] A step inside it\n\n### Quote, code and a rule\n\n> A quote, in the quiet colour.\n\n```rust\nfn main() {\n    println!(\"Hello, Even\");\n}\n```\n\n---\n\nThe last paragraph.";

const HTML: &str = "<div style=\"font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5\"><p style=\"margin:0\">Hi Sanne,</p><p style=\"margin:0\"><br></p><p style=\"margin:0\">A mail with <strong>bold</strong>, <em>italic</em>, <u>underlined</u> and <s>struck</s> words, a <a href=\"https://jornboerema.nl\">link</a>, <span style=\"font-size:12px\">small</span>, <span style=\"font-size:18px\">large</span> and <span style=\"font-size:24px\">huge</span> text, and <code>code</code>.</p><p style=\"margin:0\"><br></p><ul style=\"margin:0;padding-left:1.5em\"><li>A bullet</li><li>Another bullet</li></ul><ol style=\"margin:0;padding-left:1.5em\"><li>First</li><li>Second</li></ol><p style=\"margin:0\"><br></p><blockquote style=\"margin:0;padding-left:12px;border-left:2px solid #d0d0d0;color:#555555\"><p style=\"margin:0\">A quoted line.</p></blockquote><p style=\"margin:0\"><br></p><p style=\"margin:0\">A picture on the line: <img src=\"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAIAAAADnC86AAAALklEQVR42u3NMQ0AAAgDsFlGMk5mgoSnSf9mJy8iFovFYrFYLBaLxWKxWCwW3yndzUD5e3F+uQAAAABJRU5ErkJggg==\" width=\"40\"> and text after it.</p><p style=\"margin:0\"><br></p><div data-signature=\"\"><p style=\"margin:0\">Met vriendelijke groet,</p><p style=\"margin:0\"><strong>Jorn</strong></p></div></div>";

/// Drives the page as typing would, and tells what came of it.
const SELFTEST: &str = include_str!("../../assets/editor/selftest.js");

struct Demo {
    mode: Mode,
    editor: Entity<RichEditor>,
    marks: ActiveMarks,
    status: SharedString,
    _events: Subscription,
}

impl Demo {
    fn new(kind: &str, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let mode = if kind.ends_with("html") { Mode::Html } else { Mode::Markdown };
        let editor = cx.new(|cx| RichEditor::new(mode, window, cx));
        let selftest = kind.starts_with("selftest");
        editor.update(cx, |editor, cx| {
            editor.set_placeholder(crate::i18n::t("Write something…", "Schrijf iets…"), cx);
            if selftest {
                editor.set_forward_shortcuts(false);
                editor.run(SELFTEST, cx);
                return;
            }
            match mode {
                Mode::Markdown => editor.set_content(MARKDOWN, cx),
                Mode::Html => {
                    editor.set_look(Look::MAIL, cx);
                    editor.set_content(HTML, cx)
                }
            }
        });
        let events = cx.subscribe(&editor, |this, _, event: &EditorEvent, cx| {
            match event {
                EditorEvent::Changed(content) => this.status = format!("Changed: {} characters", content.len()).into(),
                EditorEvent::Focused => this.status = "Focused".into(),
                EditorEvent::Blurred => this.status = "Blurred".into(),
                EditorEvent::SelectionChanged(marks) => this.marks = marks.clone(),
                EditorEvent::Shortcut(keys) => this.status = format!("Shortcut: {keys}").into(),
                EditorEvent::LinkClicked(url) => this.status = format!("Link: {url}").into(),
                EditorEvent::ContentHeight(height) => this.status = format!("Content is {height} tall").into(),
            }
            cx.notify();
        });
        Self {
            mode,
            editor,
            marks: ActiveMarks::default(),
            status: "".into(),
            _events: events,
        }
    }

    fn tool(&self, id: &'static str, label: &'static str, on: bool, command: Command, cx: &mut Context<Self>) -> impl IntoElement {
        ui::button_sm(id, label, if on { ui::Variant::Secondary } else { ui::Variant::Ghost }).on_click(cx.listener(
            move |this, _, _, cx| {
                let command = command.clone();
                this.editor.update(cx, |editor, cx| editor.exec(command, cx));
            },
        ))
    }
}

impl Render for Demo {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let marks = self.marks.clone();
        let markdown = self.mode == Mode::Markdown;
        let tools = div()
            .flex()
            .flex_wrap()
            .items_center()
            .gap(px(2.))
            .child(self.tool("bold", "Bold", marks.bold, Command::Bold, cx))
            .child(self.tool("italic", "Italic", marks.italic, Command::Italic, cx))
            .when(!markdown, |el| {
                el.child(self.tool("underline", "Underline", marks.underline, Command::Underline, cx))
            })
            .child(self.tool("strike", "Strike", marks.strike, Command::Strike, cx))
            .child(self.tool("link", "Link", marks.link.is_some(), Command::EditLink, cx))
            .child(self.tool("bullets", "Bullets", marks.bullet_list, Command::BulletList, cx))
            .child(self.tool("numbers", "Numbers", marks.ordered_list, Command::OrderedList, cx))
            .child(self.tool("quote", "Quote", marks.quote, Command::Quote, cx))
            .when(markdown, |el| {
                el.child(self.tool("tasks", "Tasks", marks.task_list, Command::TaskList, cx))
                    .child(self.tool("h1", "H1", marks.heading == 1, Command::Heading(1), cx))
                    .child(self.tool("h2", "H2", marks.heading == 2, Command::Heading(2), cx))
                    .child(self.tool("code", "Code", marks.code_block, Command::CodeBlock, cx))
            })
            .when(!markdown, |el| {
                el.child(self.tool(
                    "large",
                    "Large",
                    marks.font_size.as_deref() == Some("18px"),
                    Command::FontSize(Some("18px".into())),
                    cx,
                ))
            });
        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(theme::background())
            .text_color(theme::foreground())
            .font_family(theme::FONT)
            .text_size(px(14.))
            .child(
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .justify_between()
                    .gap(px(16.))
                    .pl(px(88.))
                    .pr(px(16.))
                    .min_h(px(52.))
                    .border_b_1()
                    .border_color(theme::border())
                    .child(tools)
                    .child(
                        div()
                            .flex_none()
                            .text_size(px(12.))
                            .text_color(theme::muted())
                            .child(self.status.clone()),
                    ),
            )
            .child(
                div()
                    .flex_1()
                    .min_h_0()
                    .px(px(if markdown { 48. } else { 8. }))
                    .child(self.editor.clone()),
            )
    }
}

/// Opens the editor's own window when `EVEN_EDITOR_DEMO` asks for it
/// (`markdown`, `html`, `selftest` or `selftest-html`). `true`: the app's window stays shut.
pub fn demo_window(cx: &mut App) -> bool {
    let Ok(kind) = std::env::var("EVEN_EDITOR_DEMO") else {
        return false;
    };
    let bounds = Bounds::centered(None, size(px(920.), px(1000.)), cx);
    let options = WindowOptions {
        window_bounds: Some(WindowBounds::Windowed(bounds)),
        titlebar: Some(TitlebarOptions {
            title: Some("Even editor".into()),
            appears_transparent: true,
            traffic_light_position: Some(point(px(16.), px(18.))),
        }),
        ..Default::default()
    };
    gpui_kit::open_window(options, cx, move |window, cx| cx.new(|cx| Demo::new(&kind, window, cx)))
        .expect("could not open the editor's window");
    if std::env::var_os("EVEN_BACKGROUND").is_none() {
        cx.activate(true);
    }
    true
}
