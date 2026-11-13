//! The signatures page of mail's settings
//! (apps/mail-web/src/components/signature-settings.tsx): the signatures in a
//! list, one opened to write it, and which one each mailbox adds to new
//! messages and to replies. A signature is written in the shared rich text
//! editor (src/editor.rs), a system webview: it is hidden under a dialog and
//! dropped when the page is left.

use std::sync::LazyLock;
use std::time::Duration;

use gpui_kit::component::input::{Input, InputEvent, InputState};
use gpui_kit::prelude::*;
use gpui_kit::*;
use regex::Regex;

use crate::editor::{EditorEvent, Look, Mode, RichEditor};
use crate::i18n::t;
use crate::{theme, ui};

use super::api::{self, Mailbox, Signature};
use super::settings_pages::{debug_wants, error_text, row, select, Dialog, SelectLook};
use super::toast::ToastKind;
use super::MailView;

/// Typing pauses this long before a change is saved (`SAVE_DELAY_MS`).
const SAVE_DELAY: Duration = Duration::from_millis(800);
/// A signature's name is at most this long (`maxLength`).
const NAME_LENGTH: usize = 100;
/// The editor's least height (`min-h-48`).
const EDITOR_MIN: f32 = 192.;

/// The signature being written (`SignatureEditor`).
pub(super) struct SignatureEditor {
    id: String,
    name: Entity<InputState>,
    editor: Entity<RichEditor>,
    /// What was typed and is not saved yet, with the pause that saves it.
    pending_name: Option<String>,
    pending_html: Option<String>,
    name_timer: Option<Task<()>>,
    html_timer: Option<Task<()>>,
    /// How tall the editor last was while it showed: hidden under a dialog
    /// it measures nothing sensible.
    height: f32,
    /// Where the keyboard was before the editor took it.
    restore: Option<FocusHandle>,
    _events: Vec<Subscription>,
}

/// The signature as one line of text, for the list (`previewOf`): blocks and
/// line breaks become " · ".
pub(super) fn preview_of(html: &str) -> String {
    static BREAKS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)</(p|div|li)\s*>|<br\s*/?>").unwrap());
    static HIDDEN: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?is)<(script|style)\b.*?</(script|style)\s*>|<!--.*?-->").unwrap());
    static TAGS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)<[^>]*>").unwrap());
    static ENTITIES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"&(#x?[0-9a-fA-F]+|[a-zA-Z]+);").unwrap());
    static DOTS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(\s*·\s*)+").unwrap());

    let text = HIDDEN.replace_all(html, "");
    let text = BREAKS.replace_all(&text, "$0 · ");
    let text = TAGS.replace_all(&text, "");
    let text = ENTITIES.replace_all(&text, |found: &regex::Captures| {
        let name = &found[1];
        let code = match name.strip_prefix('#') {
            Some(number) => match number.strip_prefix(['x', 'X']) {
                Some(hex) => u32::from_str_radix(hex, 16).ok(),
                None => number.parse().ok(),
            },
            None => match name {
                "amp" => Some('&' as u32),
                "lt" => Some('<' as u32),
                "gt" => Some('>' as u32),
                "quot" => Some('"' as u32),
                "apos" => Some('\'' as u32),
                "nbsp" => Some(0xa0),
                _ => None,
            },
        };
        match code.and_then(char::from_u32) {
            Some(character) => character.to_string(),
            None => found[0].to_string(),
        }
    });
    let text = DOTS.replace_all(&text, " · ");
    let text = text.strip_prefix(" · ").unwrap_or(&text);
    let text = text.strip_suffix(" · ").unwrap_or(text);
    text.trim().to_string()
}

/// `signatures.usedBy`.
fn used_by(count: usize) -> String {
    match count {
        0 => t("Not used", "Niet gebruikt").into(),
        1 => t("Used by 1 mailbox", "Gebruikt door 1 mailbox").into(),
        _ => t(format!("Used by {count} mailboxes"), format!("Gebruikt door {count} mailboxen")),
    }
}

impl MailView {
    pub(super) fn load_signatures(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.settings_call(window, cx, api::signatures, |this, result, _, _| {
            this.pages.signatures.set(result);
        });
    }

    fn signature(&self, id: &str) -> Option<&Signature> {
        self.pages.signatures.data.as_ref()?.iter().find(|signature| signature.id == id)
    }

    /// The signature's name as the page shows it: what is being typed, or
    /// its saved name while the field is empty.
    pub(super) fn signature_label(&self, id: &str, cx: &App) -> String {
        let saved = self.signature(id).map(|signature| signature.name.clone()).unwrap_or_default();
        match &self.pages.editing {
            Some(editing) if editing.id == id => {
                let typed = editing.name.read(cx).value().trim().to_string();
                if typed.is_empty() {
                    saved
                } else {
                    typed
                }
            }
            _ => saved,
        }
    }

    /// A new, empty signature, opened to write it.
    fn create_signature(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let count = self.pages.signatures.data.as_ref().map_or(0, Vec::len) + 1;
        let name = t(format!("Signature {count}"), format!("Handtekening {count}"));
        self.pages.creating_signature = true;
        cx.notify();
        self.settings_call(
            window,
            cx,
            move |client| api::create_signature(client, &name),
            |this, result, window, cx| {
                this.pages.creating_signature = false;
                match result {
                    Ok(created) => {
                        let id = created.id.clone();
                        this.pages.signatures.data.get_or_insert_with(Vec::new).push(created);
                        this.open_signature(&id, window, cx);
                    }
                    Err(error) => ui::toast_error(error_text(&error), window, cx),
                }
            },
        );
    }

    /// Opens a signature in the editor, with the keyboard in it.
    pub(super) fn open_signature(&mut self, id: &str, window: &mut Window, cx: &mut Context<Self>) {
        let Some(signature) = self.signature(id).cloned() else { return };
        self.close_signature(cx);
        let restore = window.focused(cx);
        let name = cx.new(|cx| {
            InputState::new(window, cx)
                .placeholder(t("Name", "Naam"))
                .default_value(signature.name.clone())
        });
        let editor = cx.new(|cx| RichEditor::new(Mode::Html, window, cx));
        editor.update(cx, |editor, cx| {
            // A signature may hold a logo that lives on the web. First: it loads the page again.
            editor.set_remote_images(true, cx);
            editor.set_look(Look::MAIL, cx);
            editor.set_background(theme::card, cx);
            editor.set_placeholder(
                t("Your name, role, phone number…", "Je naam, functie, telefoonnummer…"),
                cx,
            );
            editor.set_content(&signature.html, cx);
            // A run that only looks leaves the keyboard where the user has it.
            if !debug_wants("settings-signature") && !debug_wants("settings-delete-signature") {
                editor.focus_start(window, cx);
            }
        });
        let events = vec![
            cx.subscribe_in(&name, window, |this, _, event: &InputEvent, window, cx| {
                if matches!(event, InputEvent::Change) {
                    this.signature_name_typed(window, cx);
                }
            }),
            cx.subscribe_in(&editor, window, |this, _, event: &EditorEvent, window, cx| match event {
                EditorEvent::Changed(html) => this.signature_written(html.clone(), window, cx),
                EditorEvent::ContentHeight(_) => cx.notify(),
                _ => {}
            }),
        ];
        self.pages.editing = Some(SignatureEditor {
            id: signature.id,
            name,
            editor,
            pending_name: None,
            pending_html: None,
            name_timer: None,
            html_timer: None,
            height: EDITOR_MIN,
            restore,
            _events: events,
        });
        cx.notify();
    }

    /// The name changed: saved after a pause, unless it is empty.
    fn signature_name_typed(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(editing) = &mut self.pages.editing else { return };
        let typed: String = editing.name.read(cx).value().trim().chars().take(NAME_LENGTH).collect();
        cx.notify();
        if typed.is_empty() {
            return;
        }
        editing.pending_name = Some(typed);
        editing.name_timer = Some(cx.spawn_in(window, async move |this, cx| {
            cx.background_executor().timer(SAVE_DELAY).await;
            let _ = this.update_in(cx, |this, window, cx| this.save_signature(Some(window), cx));
        }));
    }

    /// The signature itself changed: saved after a pause.
    fn signature_written(&mut self, html: String, window: &mut Window, cx: &mut Context<Self>) {
        let Some(editing) = &mut self.pages.editing else { return };
        editing.pending_html = Some(html);
        editing.html_timer = Some(cx.spawn_in(window, async move |this, cx| {
            cx.background_executor().timer(SAVE_DELAY).await;
            let _ = this.update_in(cx, |this, window, cx| this.save_signature(Some(window), cx));
        }));
    }

    /// Saves what was typed since the last save: in the list at once, then on
    /// the account. Without a window (the page was left) a failure shows in
    /// mail's own toasts.
    fn save_signature(&mut self, window: Option<&mut Window>, cx: &mut Context<Self>) {
        let Some(editing) = &mut self.pages.editing else { return };
        let (name, html) = (editing.pending_name.take(), editing.pending_html.take());
        editing.name_timer = None;
        editing.html_timer = None;
        if name.is_none() && html.is_none() {
            return;
        }
        let id = editing.id.clone();
        if let Some(signature) = self
            .pages
            .signatures
            .data
            .as_mut()
            .and_then(|signatures| signatures.iter_mut().find(|signature| signature.id == id))
        {
            if let Some(name) = &name {
                signature.name = name.clone();
            }
            if let Some(html) = &html {
                signature.html = html.clone();
            }
        }
        let mut change = serde_json::Map::new();
        if let Some(name) = name {
            change.insert("name".into(), name.into());
        }
        if let Some(html) = html {
            change.insert("html".into(), html.into());
        }
        let change = serde_json::Value::Object(change);
        let failed = || {
            t(
                "The signature couldn't be saved.",
                "De handtekening kon niet worden opgeslagen.",
            )
        };
        match window {
            Some(window) => self.settings_call(
                window,
                cx,
                move |client| api::update_signature(client, &id, &change),
                move |this, result, window, cx| {
                    if result.is_err() {
                        ui::toast_error(failed(), window, cx);
                        if this.pages.editing.is_none() {
                            this.load_signatures(window, cx);
                        }
                    }
                },
            ),
            None => self.fetch(
                cx,
                move |client| api::update_signature(client, &id, &change),
                move |this, result, cx| {
                    if result.is_err() {
                        this.toast(failed(), ToastKind::Error, None, false, cx);
                    }
                },
            ),
        }
        cx.notify();
    }

    /// Leaves the editor: what was typed is saved, and its webview goes.
    pub(super) fn close_signature(&mut self, cx: &mut Context<Self>) {
        if self.pages.editing.is_none() {
            return;
        }
        self.save_signature(None, cx);
        self.pages.editing = None;
        cx.notify();
    }

    /// Back to the list ("All signatures").
    fn leave_signature(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let restore = self.pages.editing.as_mut().and_then(|editing| editing.restore.take());
        self.close_signature(cx);
        // The editor had the keyboard; the settings window gets it back.
        if let Some(restore) = restore {
            window.focus(&restore, cx);
        }
    }

    /// Hides the editor's webview while a dialog shows over it.
    pub(super) fn veil_signature(&mut self, hidden: bool, cx: &mut Context<Self>) {
        if let Some(editing) = &self.pages.editing {
            editing.editor.update(cx, |editor, cx| editor.set_hidden(hidden, cx));
        }
    }

    pub(super) fn delete_signature(&mut self, id: String, window: &mut Window, cx: &mut Context<Self>) {
        // Nothing of it is saved any more.
        if let Some(editing) = self.pages.editing.as_mut().filter(|editing| editing.id == id) {
            editing.pending_name = None;
            editing.pending_html = None;
            editing.name_timer = None;
            editing.html_timer = None;
        }
        let signature = id.clone();
        self.settings_call(
            window,
            cx,
            move |client| api::delete_signature(client, &signature),
            move |this, result, window, cx| match result {
                Ok(()) => {
                    if this.pages.editing.as_ref().is_some_and(|editing| editing.id == id) {
                        this.leave_signature(window, cx);
                    }
                    if let Some(signatures) = &mut this.pages.signatures.data {
                        signatures.retain(|signature| signature.id != id);
                    }
                    // Mailboxes that used it now have none.
                    this.load_signatures(window, cx);
                    this.refresh_mailboxes(window, cx);
                }
                Err(error) => ui::toast_error(error_text(&error), window, cx),
            },
        );
    }

    /// Which signature a mailbox adds to new messages (`for_new`) or to
    /// replies and forwards; `None` adds none.
    fn choose_signature(
        &mut self,
        mailbox: String,
        for_new: bool,
        signature: Option<String>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        for item in self.mailboxes.iter_mut().filter(|item| item.id == mailbox) {
            if for_new {
                item.signatures.new_id = signature.clone();
            } else {
                item.signatures.reply_id = signature.clone();
            }
        }
        cx.notify();
        let key = if for_new { "signatureNewId" } else { "signatureReplyId" };
        self.settings_call(
            window,
            cx,
            move |client| api::update_mailbox(client, &mailbox, &serde_json::json!({ key: signature })),
            |this, result, window, cx| {
                if let Err(error) = result {
                    ui::toast_error(error_text(&error), window, cx);
                    this.refresh_mailboxes(window, cx);
                }
            },
        );
    }

    /// `SignatureSettings`: the open signature, or the list and the choices per mailbox.
    pub(super) fn render_signatures(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Vec<AnyElement> {
        if self.pages.editing.is_some() {
            return vec![self.render_signature_editor(window, cx)];
        }
        let signatures = self.pages.signatures.data.clone().unwrap_or_default();
        let mailboxes: Vec<Mailbox> = self.mailboxes.iter().filter(|mailbox| mailbox.active()).cloned().collect();
        let mut rows: Vec<AnyElement> = Vec::new();
        if self.pages.signatures.data.is_some() && signatures.is_empty() {
            rows.push(
                div()
                    .px(px(20.))
                    .py(px(16.))
                    .text_size(px(14.))
                    .text_color(theme::muted())
                    .child(t("No signatures yet.", "Nog geen handtekeningen."))
                    .into_any_element(),
            );
        }
        for signature in &signatures {
            let count = mailboxes
                .iter()
                .filter(|mailbox| {
                    mailbox.signatures.new_id.as_deref() == Some(signature.id.as_str())
                        || mailbox.signatures.reply_id.as_deref() == Some(signature.id.as_str())
                })
                .count();
            let preview = preview_of(&signature.html);
            let id = signature.id.clone();
            // `SignatureRow`.
            rows.push(
                div()
                    .id(SharedString::from(format!("signature-{id}")))
                    .flex()
                    .items_center()
                    .gap(px(16.))
                    .px(px(20.))
                    .py(px(14.))
                    .cursor_pointer()
                    .hover(|el| el.bg(theme::with_alpha(theme::muted_bg(), 0.5)))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .flex_1()
                            .min_w_0()
                            .gap(px(2.))
                            .text_size(px(14.))
                            .child(div().truncate().font_weight(FontWeight::MEDIUM).child(signature.name.clone()))
                            .child(div().truncate().text_color(theme::muted()).child(if preview.is_empty() {
                                t("Empty", "Leeg").to_string()
                            } else {
                                preview
                            })),
                    )
                    .child(
                        div()
                            .flex_none()
                            .text_size(px(12.))
                            .text_color(theme::muted())
                            .child(used_by(count)),
                    )
                    .child(theme::hi("arrow-right-01").flex_none().text_color(theme::muted()))
                    .on_click(cx.listener(move |this, _, window, cx| this.open_signature(&id, window, cx)))
                    .into_any_element(),
            );
        }
        let add = div()
            .id("signature-add")
            .flex()
            .flex_none()
            .items_center()
            .gap(px(4.))
            .h(px(28.))
            .px(px(10.))
            .rounded(theme::RADIUS_MD)
            .text_size(px(13.))
            .font_weight(FontWeight::MEDIUM)
            .child(theme::hi("add-01").size(px(14.)).text_color(theme::foreground()))
            .child(t("New signature", "Nieuwe handtekening"));
        let add = if self.pages.creating_signature {
            ui::disabled(add)
        } else {
            add.cursor_pointer()
                .hover(|el| el.bg(theme::muted_bg()))
                .on_click(cx.listener(|this, _, window, cx| this.create_signature(window, cx)))
        };
        rows.push(div().flex().px(px(12.)).py(px(8.)).child(add).into_any_element());

        // One line per mailbox, with the choices in columns (`MAILBOX_GRID`).
        let line = |mailbox: AnyElement, for_new: AnyElement, for_replies: AnyElement| {
            div()
                .flex()
                .items_center()
                .gap(px(12.))
                .px(px(20.))
                .py(px(10.))
                .child(div().flex_1().min_w_0().child(mailbox))
                .child(div().flex_none().w(px(168.)).child(for_new))
                .child(div().flex_none().w(px(168.)).child(for_replies))
        };
        let mut defaults: Vec<AnyElement> = Vec::new();
        if mailboxes.is_empty() {
            defaults.push(row(
                t(
                    "Connect a mailbox to choose its signature.",
                    "Koppel een mailbox om zijn handtekening te kiezen.",
                ),
                None,
                false,
                None,
            ));
        } else {
            defaults.push(
                line(
                    div().child(t("Mailbox", "Mailbox")).into_any_element(),
                    div().child(t("New messages", "Nieuwe berichten")).into_any_element(),
                    div().child(t("Replies and forwards", "Antwoorden en doorsturen")).into_any_element(),
                )
                .text_size(px(12.))
                .text_color(theme::muted())
                .into_any_element(),
            );
            for mailbox in &mailboxes {
                // `SignatureChoice`: quiet, like the sender choice in a new message.
                let choice = |for_new: bool, cx: &mut Context<Self>| {
                    let value = if for_new { &mailbox.signatures.new_id } else { &mailbox.signatures.reply_id };
                    // A signature that is gone reads as none.
                    let value = value.clone().filter(|id| signatures.iter().any(|signature| signature.id == *id));
                    let ids: Vec<Option<String>> = std::iter::once(None)
                        .chain(signatures.iter().map(|signature| Some(signature.id.clone())))
                        .collect();
                    let options: Vec<(SharedString, bool)> =
                        std::iter::once((t("No signature", "Geen handtekening").into(), value.is_none()))
                            .chain(signatures.iter().map(|signature| {
                                (signature.name.clone().into(), value.as_deref() == Some(signature.id.as_str()))
                            }))
                            .collect();
                    let this = cx.weak_entity();
                    let account = mailbox.id.clone();
                    let kind = if for_new { "new" } else { "reply" };
                    div()
                        .flex()
                        .ml(px(-12.))
                        .child(select(
                            SharedString::from(format!("signature-{kind}-{}", mailbox.id)),
                            options,
                            SelectLook::Quiet(value.is_none()),
                            move |index, window, cx| {
                                let signature = ids[index].clone();
                                let account = account.clone();
                                let _ = this.update(cx, |this, cx| {
                                    this.choose_signature(account, for_new, signature, window, cx)
                                });
                            },
                        ))
                        .into_any_element()
                };
                defaults.push(
                    line(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(8.))
                            .text_size(px(14.))
                            .child(div().flex_none().size(px(8.)).rounded_full().bg(theme::account(mailbox.color)))
                            .child(div().truncate().child(mailbox.email.clone()))
                            .into_any_element(),
                        choice(true, cx),
                        choice(false, cx),
                    )
                    .into_any_element(),
                );
            }
        }
        vec![
            ui::settings_section(
                t("Signatures", "Handtekeningen"),
                Some(
                    t(
                        "Write signatures once, then choose which one each mailbox adds.",
                        "Schrijf handtekeningen één keer en kies per mailbox welke hij toevoegt.",
                    )
                    .into(),
                ),
                rows,
            )
            .into_any_element(),
            ui::settings_section(
                t("Per mailbox", "Per mailbox"),
                Some(
                    t(
                        "Which signature each mailbox adds. You can still change it in a message.",
                        "Welke handtekening elke mailbox toevoegt. In een bericht kun je hem nog aanpassen.",
                    )
                    .into(),
                ),
                defaults,
            )
            .into_any_element(),
        ]
    }

    /// `SignatureEditor`: the name is the page's title, edited in place; the
    /// editor is the only surface.
    fn render_signature_editor(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let Some(editing) = &mut self.pages.editing else {
            return div().into_any_element();
        };
        let id = editing.id.clone();
        let name = editing.name.clone();
        let editor = editing.editor.clone();
        // As tall as what is written, within the settings window: the webview
        // is not clipped by the page's scroll, so it must fit.
        let room = window.viewport_size().height.min(px(792.)) - px(32. + 56. + 64. + 120.);
        if !editor.read(cx).is_hidden() {
            editing.height = editor.read(cx).content_height().unwrap_or(0.);
        }
        let height = px(editing.height).max(px(EDITOR_MIN)).min(room.max(px(EDITOR_MIN)));
        let back = div()
            .id("signature-back")
            .flex()
            .flex_none()
            .items_center()
            .gap(px(4.))
            .h(px(28.))
            .px(px(10.))
            .ml(px(-8.))
            .rounded(theme::RADIUS_MD)
            .text_size(px(13.))
            .font_weight(FontWeight::MEDIUM)
            .text_color(theme::muted())
            .cursor_pointer()
            .hover(|el| el.bg(theme::muted_bg()).text_color(theme::foreground()))
            .child(theme::hi("arrow-left-01").size(px(14.)).text_color(theme::muted()))
            .child(t("All signatures", "Alle handtekeningen"))
            .on_click(cx.listener(|this, _, window, cx| this.leave_signature(window, cx)));
        let delete = div()
            .id("signature-delete")
            .group("signature-delete")
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
            .size(px(28.))
            .ml_auto()
            .cursor_pointer()
            .child(
                theme::hi("delete-02")
                    .text_color(theme::muted())
                    .group_hover("signature-delete", |el| el.text_color(theme::danger())),
            )
            .tooltip(ui::tip(t("Delete signature", "Handtekening verwijderen")))
            .on_click(cx.listener(move |this, _, window, cx| this.ask(Dialog::Signature(id.clone()), window, cx)));
        div()
            .flex()
            .flex_col()
            .gap(px(16.))
            .child(div().flex().items_center().gap(px(8.)).child(back).child(delete))
            .child(
                div()
                    .mx(px(-4.))
                    .text_size(px(18.))
                    .font_weight(FontWeight::SEMIBOLD)
                    .child(Input::new(&name).appearance(false).text_size(px(18.))),
            )
            .child(
                div()
                    .h(height)
                    .rounded(theme::RADIUS)
                    .bg(theme::card())
                    .border_1()
                    .border_color(theme::border())
                    // The webview is square: this keeps it off the card's round corners.
                    .p(px(3.))
                    .child(editor),
            )
            .into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::preview_of;

    #[test]
    fn a_signature_reads_as_one_line() {
        assert_eq!(preview_of("<p>Jan de Vries</p><p>Even &amp; co</p>"), "Jan de Vries · Even & co");
        assert_eq!(preview_of("<div><p>Jan<br>Directeur</p></div>"), "Jan · Directeur");
        assert_eq!(preview_of("<ul><li><p>a</p></li><li>b</li></ul>"), "a · b");
        assert_eq!(preview_of("<p><img src=\"data:image/png;base64,AAAA\"></p>"), "");
        assert_eq!(preview_of("<p>Tel:&nbsp;06&#32;12</p>"), "Tel:\u{a0}06 12");
        assert_eq!(preview_of(""), "");
    }
}
