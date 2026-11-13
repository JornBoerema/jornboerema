//! The To, Cc and Bcc rows (apps/mail-web/src/components/address-row.tsx):
//! recipients as badges, the one still being typed in a field after them,
//! and the people who wrote to this user suggested under it.

use std::time::Duration;

use gpui_kit::component::input::{Backspace, Escape, IndentInline, Input, InputEvent, InputState, MoveDown, MoveUp};

use super::addresses::{join_recipients, split_recipients, strip_display_names};
use super::form::{anchor, menu_panel, message_row};
use super::wire::{self, Contact};
use super::*;

/// Matching contacts is a quick database lookup, so it can follow typing closely.
const SUGGEST_DELAY: Duration = Duration::from_millis(120);

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(super) enum Which {
    To,
    Cc,
    Bcc,
}

impl Which {
    /// The name its row hangs its suggestions from.
    fn anchor(self) -> &'static str {
        match self {
            Which::To => "to",
            Which::Cc => "cc",
            Which::Bcc => "bcc",
        }
    }
}

pub(super) struct AddressField {
    pub(super) input: Entity<InputState>,
    /// The finished recipients, each a badge.
    entries: Vec<String>,
    /// What is still being typed, as the field holds it.
    draft: String,
    /// Shows in the empty field of an empty row.
    placeholder: &'static str,
    /// The people the API suggested for what was typed last.
    contacts: Vec<Contact>,
    active: usize,
    /// Escape put the suggestions away, until more is typed.
    dismissed: bool,
    pub(super) focused: bool,
    /// Numbers what is typed, so an answer for older text is dropped.
    typed: u64,
}

impl AddressField {
    pub(super) fn new(
        entries: Vec<String>,
        placeholder: &'static str,
        window: &mut Window,
        cx: &mut Context<MailView>,
    ) -> Self {
        let shown = if entries.is_empty() { placeholder } else { "" };
        Self {
            input: cx.new(|cx| InputState::new(window, cx).placeholder(shown)),
            entries,
            draft: String::new(),
            placeholder,
            contacts: Vec::new(),
            active: 0,
            dismissed: false,
            focused: false,
            typed: 0,
        }
    }

    /// The row as one comma separated string, as the web keeps it.
    pub(super) fn value(&self) -> String {
        join_recipients(&self.entries, &self.draft)
    }

    /// Who could be picked: nobody already in the row.
    fn suggestions(&self) -> Vec<&Contact> {
        if self.draft.trim().is_empty() || self.dismissed {
            return Vec::new();
        }
        self.contacts.iter().filter(|contact| !self.entries.contains(&contact.email)).collect()
    }

    pub(super) fn open(&self) -> bool {
        self.focused && !self.suggestions().is_empty()
    }

    /// Puts `value` in the row: finished addresses become badges, the rest stays in the field.
    fn update(&mut self, value: &str, window: &mut Window, cx: &mut App) {
        let (entries, draft) = split_recipients(&strip_display_names(value));
        self.entries = entries;
        self.set_draft(draft, window, cx);
    }

    fn set_draft(&mut self, draft: String, window: &mut Window, cx: &mut App) {
        if self.draft != draft {
            self.active = 0;
            self.dismissed = false;
        }
        let shown = if self.entries.is_empty() { self.placeholder } else { "" };
        self.input.update(cx, |input, cx| {
            if input.value().as_ref() != draft.as_str() {
                input.set_value(draft.clone(), window, cx);
            }
            input.set_placeholder(shown, window, cx);
        });
        self.draft = draft;
    }

    pub(super) fn set_entries(&mut self, entries: Vec<String>, window: &mut Window, cx: &mut App) {
        self.update(&join_recipients(&entries, ""), window, cx);
    }

    /// What is typed becomes a recipient (Enter, or leaving the field).
    fn finish(&mut self, window: &mut Window, cx: &mut App) -> bool {
        if self.draft.is_empty() {
            return false;
        }
        let mut entries = self.entries.clone();
        entries.push(self.draft.clone());
        self.update(&join_recipients(&entries, ""), window, cx);
        true
    }

    /// For looking at the suggestions without typing (`EVEN_MAIL_DEBUG=suggest`).
    pub(super) fn debug_suggest(&mut self, window: &mut Window, cx: &mut App) {
        self.set_draft("sa".into(), window, cx);
        self.focused = true;
        self.contacts = [
            (Some("Sanne de Vries"), "sanne@example.com"),
            (Some("Sander Bakker"), "sander.bakker@example.org"),
            (None, "sales@example.net"),
        ]
        .into_iter()
        .map(|(name, email)| Contact {
            name: name.map(String::from),
            email: email.into(),
        })
        .collect();
        self.active = 1;
    }
}

impl MailView {
    /// The field of a row said something.
    pub(super) fn address_event(
        &mut self,
        key: u64,
        which: Which,
        event: &InputEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(composer) = self.writer(key) else { return };
        let field = composer.field(which);
        match event {
            InputEvent::Change => {
                let typed = field.input.read(cx).value().to_string();
                if typed == field.draft {
                    return;
                }
                let value = join_recipients(&field.entries, &typed);
                field.update(&value, window, cx);
                self.suggest(key, which, cx);
                self.draft_changed(key, cx);
            }
            // ⌘Enter sends; Enter finishes the address, or picks the suggested one.
            InputEvent::PressEnter { secondary: true, .. } => return self.submit(key, window, cx),
            InputEvent::PressEnter { .. } => {
                let picked = field.open().then(|| field.suggestions().get(field.active).map(|contact| contact.email.clone())).flatten();
                match picked {
                    Some(email) => self.choose_contact(key, which, email, window, cx),
                    None => {
                        if field.finish(window, cx) {
                            self.draft_changed(key, cx);
                        }
                    }
                }
            }
            InputEvent::Focus => {
                field.focused = true;
                composer.menu = None;
            }
            InputEvent::Blur => {
                field.focused = false;
                if field.finish(window, cx) {
                    self.draft_changed(key, cx);
                }
            }
        }
        cx.notify();
    }

    /// Asks who matches what is typed, once typing pauses for a moment.
    fn suggest(&mut self, key: u64, which: Which, cx: &mut Context<Self>) {
        let Some(composer) = self.writer(key) else { return };
        let field = composer.field(which);
        field.typed += 1;
        let (typed, query) = (field.typed, field.draft.trim().to_string());
        if query.is_empty() {
            return;
        }
        if let Some(known) = self.writing.contacts.get(&query).cloned() {
            if let Some(composer) = self.writer(key) {
                composer.field(which).contacts = known;
            }
            return;
        }
        cx.spawn(async move |this, cx| {
            cx.background_executor().timer(SUGGEST_DELAY).await;
            let current = this.update(cx, |this, _| {
                this.writer(key).is_some_and(|composer| composer.field(which).typed == typed)
            });
            if !matches!(current, Ok(true)) {
                return;
            }
            let _ = this.update(cx, |this, cx| {
                let asked = query.clone();
                this.fetch(
                    cx,
                    move |client| wire::contacts(client, &asked),
                    move |this, result, _| {
                        let Ok(contacts) = result else { return };
                        this.writing.contacts.insert(query, contacts.clone());
                        if let Some(composer) = this.writer(key) {
                            let field = composer.field(which);
                            // The list for older text stays until this one is there, and no longer.
                            if field.typed == typed {
                                field.contacts = contacts;
                            }
                        }
                    },
                );
            });
        })
        .detach();
    }

    fn choose_contact(&mut self, key: u64, which: Which, email: String, window: &mut Window, cx: &mut Context<Self>) {
        let Some(composer) = self.writer(key) else { return };
        let field = composer.field(which);
        let mut entries = field.entries.clone();
        entries.push(email);
        field.update(&join_recipients(&entries, ""), window, cx);
        field.input.update(cx, |input, cx| input.focus(window, cx));
        self.draft_changed(key, cx);
        cx.notify();
    }

    fn remove_recipient(&mut self, key: u64, which: Which, entry: &str, window: &mut Window, cx: &mut Context<Self>) {
        let Some(composer) = self.writer(key) else { return };
        let field = composer.field(which);
        field.entries.retain(|item| item != entry);
        let draft = field.draft.clone();
        field.set_draft(draft, window, cx);
        self.draft_changed(key, cx);
        cx.notify();
    }

    /// Up and Down walk the suggestions, Tab picks one, Escape puts them away
    /// and Backspace in an empty field takes the last recipient: `true` when
    /// the key was the row's, and the field must not act on it too.
    fn address_key(&mut self, key: u64, which: Which, pressed: Pressed, window: &mut Window, cx: &mut Context<Self>) -> bool {
        let Some(composer) = self.writer(key) else { return false };
        let field = composer.field(which);
        let count = field.suggestions().len();
        let open = field.open();
        match pressed {
            Pressed::Up | Pressed::Down if open => {
                let step = if pressed == Pressed::Down { 1 } else { count - 1 };
                field.active = (field.active + step) % count;
            }
            Pressed::Tab if open => {
                let Some(email) = field.suggestions().get(field.active).map(|contact| contact.email.clone()) else {
                    return false;
                };
                self.choose_contact(key, which, email, window, cx);
            }
            // Handled here, so Escape closes the list and not the whole message.
            Pressed::Escape if open => field.dismissed = true,
            Pressed::Backspace if field.draft.is_empty() && !field.entries.is_empty() => {
                field.entries.pop();
                field.set_draft(String::new(), window, cx);
                self.draft_changed(key, cx);
            }
            _ => return false,
        }
        cx.notify();
        true
    }

    /// One row of recipients: its badges and field, with `action` at its end.
    pub(super) fn render_address_row(
        &self,
        composer: &Composer,
        which: Which,
        label: &'static str,
        action: Option<AnyElement>,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let key = composer.key;
        let field = match which {
            Which::To => &composer.to,
            Which::Cc => &composer.cc,
            Which::Bcc => &composer.bcc,
        };
        let badges = field.entries.iter().enumerate().map(|(index, entry)| {
            let valid = is_email(entry);
            let removed = entry.clone();
            div()
                .id((which.anchor(), index))
                .flex()
                .flex_none()
                .items_center()
                .gap(px(4.))
                .h(px(28.))
                .max_w_full()
                .pl(px(10.))
                .pr(px(4.))
                .rounded(px(14.))
                .text_size(px(14.))
                .map(|el| {
                    if valid {
                        el.bg(theme::secondary())
                    } else {
                        el.bg(theme::mix(theme::danger(), if theme::is_dark() { 20. } else { 10. }))
                            .text_color(theme::danger())
                            .tooltip(ui::tip(invalid_address(entry)))
                    }
                })
                .child(div().min_w_0().truncate().child(entry.clone()))
                .child(
                    div()
                        .id(("remove", index))
                        .flex()
                        .flex_none()
                        .items_center()
                        .justify_center()
                        .size(px(20.))
                        .rounded_full()
                        .cursor_pointer()
                        .hover(|el| el.bg(theme::with_alpha(theme::foreground(), 0.1)))
                        .child(theme::hi("cancel-01").size(px(12.)).text_color(if valid {
                            theme::foreground()
                        } else {
                            theme::danger()
                        }))
                        .on_click(cx.listener(move |this, _, window, cx| {
                            this.remove_recipient(key, which, &removed, window, cx)
                        })),
                )
        });
        let typing = div()
            .key_context("Recipients")
            .flex_grow(1.)
            .flex_shrink(1.)
            .flex_basis(px(128.))
            .min_w(px(128.))
            .h(px(28.))
            .flex()
            .items_center()
            // Before the field itself sees them.
            .capture_action(cx.listener(move |this, _: &MoveUp, window, cx| {
                if this.address_key(key, which, Pressed::Up, window, cx) {
                    cx.stop_propagation();
                }
            }))
            .capture_action(cx.listener(move |this, _: &MoveDown, window, cx| {
                if this.address_key(key, which, Pressed::Down, window, cx) {
                    cx.stop_propagation();
                }
            }))
            .capture_action(cx.listener(move |this, _: &IndentInline, window, cx| {
                if this.address_key(key, which, Pressed::Tab, window, cx) {
                    cx.stop_propagation();
                }
            }))
            .capture_action(cx.listener(move |this, _: &Escape, window, cx| {
                if this.address_key(key, which, Pressed::Escape, window, cx) {
                    cx.stop_propagation();
                }
            }))
            .capture_action(cx.listener(move |this, _: &Backspace, window, cx| {
                if this.address_key(key, which, Pressed::Backspace, window, cx) {
                    cx.stop_propagation();
                }
            }))
            .child(Input::new(&field.input).appearance(false).text_size(px(14.)));
        let row = message_row(
            label,
            field.focused,
            div()
                .flex()
                .flex_wrap()
                .items_center()
                .gap(px(4.))
                .py(px(6.))
                .flex_1()
                .min_w_0()
                .children(badges)
                .child(typing),
            action,
        );
        div()
            .relative()
            .child(row)
            .child(anchor(&self.writing.anchors, which.anchor()))
            .children(self.render_suggestions(composer, which, cx))
            .into_any_element()
    }

    /// The people to pick from, under the row (`role="listbox"`).
    fn render_suggestions(&self, composer: &Composer, which: Which, cx: &mut Context<Self>) -> Option<AnyElement> {
        let key = composer.key;
        let field = match which {
            Which::To => &composer.to,
            Which::Cc => &composer.cc,
            Which::Bcc => &composer.bcc,
        };
        if !field.open() {
            return None;
        }
        let bounds = self.writing.anchors.borrow().get(which.anchor()).copied()?;
        let rows = field.suggestions().into_iter().enumerate().map(|(index, contact)| {
            let email = contact.email.clone();
            let name = contact.name.clone().filter(|name| !name.is_empty());
            div()
                .id(("suggestion", index))
                .flex()
                .items_center()
                .gap(px(10.))
                .px(px(8.))
                .py(px(6.))
                .rounded(theme::RADIUS)
                .text_size(px(14.))
                .cursor_pointer()
                .when(index == field.active, |el| el.bg(theme::accent()))
                .child(
                    // `ContactAvatar`: initials on a colour from the address.
                    div()
                        .flex()
                        .flex_none()
                        .items_center()
                        .justify_center()
                        .size(px(28.))
                        .rounded_full()
                        .bg(lists::avatar_color(&contact.email))
                        .text_size(px(11.))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(rgb(0xffffff))
                        .child(lists::initials_of(name.as_deref(), &contact.email)),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .min_w_0()
                        .child(div().truncate().child(name.clone().unwrap_or_else(|| contact.email.clone())))
                        .when(name.is_some(), |el| {
                            el.child(div().truncate().text_size(px(12.)).text_color(theme::muted()).child(contact.email.clone()))
                        }),
                )
                .on_hover(cx.listener(move |this, hovering: &bool, _, cx| {
                    if let (true, Some(composer)) = (*hovering, this.writer(key)) {
                        composer.field(which).active = index;
                        cx.notify();
                    }
                }))
                .on_click(cx.listener(move |this, _, window, cx| {
                    this.choose_contact(key, which, email.clone(), window, cx)
                }))
        });
        // `top-full left-23 -mt-1 w-[min(22rem,calc(100%-6rem))]`.
        let width = px(352.).min(bounds.size.width - px(96.));
        Some(
            deferred(
                anchored()
                    .position(point(bounds.left() + px(92.), bounds.bottom() - px(4.)))
                    .anchor(Anchor::TopLeft)
                    .snap_to_window_with_margin(px(8.))
                    .child(menu_panel("suggestions").w(width).children(rows)),
            )
            .with_priority(50)
            .into_any_element(),
        )
    }
}

/// A key the row may want before its field does.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Pressed {
    Up,
    Down,
    Tab,
    Escape,
    Backspace,
}
