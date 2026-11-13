//! How writing looks: the new message in the reading pane (`ComposeForm` in
//! apps/mail-web/src/pages/compose.tsx), the reply and forward forms under a
//! conversation (components/reply-forms.tsx), and what they share: the rows
//! (message-field.tsx), the bar with attachments, AI and signature
//! (attachment-picker.tsx, ai-writer.tsx, signature-picker.tsx) and the send
//! button with Send later (send-button.tsx).

use gpui_kit::component::input::{Escape, Input};

use super::drafts::SaveStatus;
use super::files::size_label;
use super::overlays::SnoozeTarget;
use super::*;

/// The web's reading column (`max-w-3xl`).
const COLUMN: f32 = 768.;
/// The least an editor gets: `min-h-40` for a message, `min-h-32` for a reply, `min-h-24` for a forward.
const MESSAGE_MIN: f32 = 160.;
const REPLY_MIN: f32 = 128.;
const FORWARD_MIN: f32 = 96.;

/// Remembers where an element is, for the menu that hangs from it. Goes
/// inside the element, which is `relative`.
pub(super) fn anchor(anchors: &Rc<RefCell<HashMap<&'static str, Bounds<Pixels>>>>, name: &'static str) -> impl IntoElement {
    let anchors = anchors.clone();
    canvas(
        move |bounds, _, _| {
            anchors.borrow_mut().insert(name, bounds);
        },
        |_, _, _, _| {},
    )
    .absolute()
    .inset_0()
}

/// The web's menu surface (`DropdownMenuContent`): `rounded-lg bg-popover p-1 shadow-lg ring-1`.
pub(super) fn menu_panel(id: &'static str) -> Stateful<Div> {
    div()
        .id(id)
        .occlude()
        .flex()
        .flex_col()
        .p(px(4.))
        .rounded(theme::RADIUS)
        .bg(theme::popover())
        .border_1()
        .border_color(theme::border())
        .shadow_lg()
        .text_color(theme::foreground())
}

/// A labelled line in a message form: the label on the left, its control
/// filling the rest (`MessageRow`).
pub(super) fn message_row(label: &'static str, focused: bool, control: impl IntoElement, action: Option<AnyElement>) -> Div {
    div()
        .flex()
        .items_start()
        .gap(px(12.))
        .min_h(px(40.))
        .px(px(16.))
        .rounded(theme::RADIUS)
        .text_size(px(14.))
        .when(focused, |el| el.bg(theme::with_alpha(theme::muted_bg(), 0.4)))
        .child(
            div()
                .flex()
                .flex_1()
                .min_w_0()
                .min_h(px(40.))
                .items_center()
                .gap(px(12.))
                .child(
                    div()
                        .w(px(64.))
                        .flex_none()
                        .self_start()
                        .pt(px(10.))
                        .line_height(px(20.))
                        .text_color(theme::muted())
                        .child(label),
                )
                .child(control),
        )
        .when_some(action, |el, action| {
            el.child(div().flex().flex_none().items_center().h(px(40.)).child(action))
        })
}

/// A quiet square button with a sign (the web's ghost `icon-sm`), pressed while its menu or line is open.
fn tool(id: &'static str, icon: &'static str, on: bool) -> Stateful<Div> {
    div()
        .id(id)
        .relative()
        .flex()
        .flex_none()
        .items_center()
        .justify_center()
        .size(px(28.))
        .rounded(theme::RADIUS_MD)
        .cursor_pointer()
        .when(on, |el| el.bg(theme::accent()))
        .hover(|el| el.bg(theme::muted_bg()))
        .child(theme::hi(icon).text_color(theme::foreground()))
}

/// A row in one of the composer's menus (`min-h-7 rounded-lg py-1 text-[13px]`).
fn menu_item(id: impl Into<ElementId>) -> Stateful<Div> {
    div()
        .id(id)
        .flex()
        .items_center()
        .gap(px(8.))
        .min_h(px(28.))
        .px(px(8.))
        .py(px(4.))
        .rounded(theme::RADIUS)
        .text_size(px(13.))
        .cursor_pointer()
        .hover(|el| el.bg(theme::accent()))
}

impl MailView {
    /// What is being written, where the reader shows it: the new message in
    /// the reader's place, or the answer under the open conversation.
    pub(in crate::mail) fn render_composer(&mut self, cx: &mut Context<Self>) -> Option<AnyElement> {
        if self.composing() {
            return self.render_message(cx);
        }
        let open = self.open_id()?;
        if self.writing.answer.as_ref()?.thread() != Some(open) {
            return None;
        }
        self.render_answer(cx)
    }

    /// The editor in its place, or its words while something must show over
    /// it: a system webview draws above every menu and dialog.
    fn editor_slot(&mut self, key: u64, cx: &mut Context<Self>) -> AnyElement {
        let veiled = self.veiled();
        let Some(composer) = self.writer(key) else {
            return div().into_any_element();
        };
        composer.shown = true;
        composer.editor.update(cx, |editor, cx| editor.set_hidden(veiled, cx));
        if !veiled {
            return composer.editor.clone().into_any_element();
        }
        let text = composer.editor.read(cx).plain_text().to_string();
        div()
            .size_full()
            .overflow_hidden()
            .px(px(16.))
            .py(px(12.))
            .text_size(px(14.))
            .line_height(relative(1.625))
            .children(text.split('\n').map(|line| {
                // An empty line keeps its height.
                div().min_h(px(22.75)).child(line.to_string())
            }))
            .into_any_element()
    }

    /// The keys a composer answers wherever the keyboard is in it.
    fn composer_shell(&self, key: u64, cx: &mut Context<Self>) -> Div {
        let editing = move |this: &mut Self, cx: &mut Context<Self>| {
            this.writer(key).map(|composer| composer.editor.clone()).filter(|editor| editor.read(cx).is_focused())
        };
        div()
            .key_context("Composer")
            .on_action(cx.listener(move |this, _: &SendMail, window, cx| this.submit(key, window, cx)))
            .on_action(cx.listener(move |this, _: &AiWrite, window, cx| this.toggle_ai(key, window, cx)))
            // The fields' own Escape bubbles up here when they have nothing else to undo;
            // the editor's arrives as the list's Close.
            .on_action(cx.listener(move |this, _: &Escape, window, cx| this.escape_composer(key, window, cx)))
            .on_action(cx.listener(move |this, _: &Close, window, cx| {
                if this.overlay.is_some() {
                    return cx.propagate();
                }
                this.escape_composer(key, window, cx)
            }))
            // In the text these are the editor's: bold, select all, and a link on what is selected.
            .on_action(cx.listener(move |this, _: &ToggleSidebar, _, cx| match editing(this, cx) {
                Some(editor) => editor.update(cx, |editor, cx| editor.exec(Command::Bold, cx)),
                None => cx.propagate(),
            }))
            .on_action(cx.listener(move |this, _: &SelectAll, _, cx| match editing(this, cx) {
                Some(editor) => editor.update(cx, |editor, cx| editor.press("cmd-a", cx)),
                None => cx.propagate(),
            }))
            .on_action(cx.listener(move |this, _: &Search, _, cx| {
                match editing(this, cx).filter(|editor| editor.read(cx).marks().range) {
                    Some(editor) => editor.update(cx, |editor, cx| editor.exec(Command::EditLink, cx)),
                    None => cx.propagate(),
                }
            }))
            // Files dropped beside the text are attached; pictures dropped on the text land in it.
            .on_drop(cx.listener(move |this, paths: &ExternalPaths, _, cx| this.attach(key, paths.paths().to_vec(), cx)))
    }

    /// The new message, or the draft opened again (`ComposePage`).
    fn render_message(&mut self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let composer = self.composer.as_ref()?;
        let key = composer.key;
        let page = self.composer_shell(key, cx).flex().flex_col().flex_1().min_h_0();
        // `ComposeHeader`: only phones have something in it.
        let header = div().h(px(40.)).flex_none();
        if composer.stage != Stage::Ready {
            let failed = composer.stage == Stage::Failed;
            return Some(
                page.child(header)
                    .child(
                        div()
                            .flex()
                            .flex_1()
                            .items_center()
                            .justify_center()
                            .text_size(px(14.))
                            .text_color(theme::muted())
                            .map(|el| {
                                if failed {
                                    el.child(t("This draft couldn't be opened.", "Dit concept kon niet worden geopend."))
                                } else {
                                    el.child(ui::spinner())
                                }
                            }),
                    )
                    .into_any_element(),
            );
        }
        let editor = self.editor_slot(key, cx);
        let composer = self.composer.as_ref()?;
        let usable: Vec<&Mailbox> = self.mailboxes.iter().filter(|mailbox| mailbox.active()).collect();
        let from = (usable.len() > 1).then(|| {
            let current = composer.account.as_deref().and_then(|id| self.mailbox(id));
            let open = composer.menu == Some(Menu::From);
            let trigger = div()
                .id("from")
                .relative()
                .flex()
                .items_center()
                .gap(px(6.))
                .h(px(32.))
                .px(px(12.))
                .ml(px(-12.))
                .min_w_0()
                .rounded(theme::RADIUS_MD)
                .cursor_pointer()
                .when(open, |el| el.bg(theme::muted_bg()))
                .when_some(current, |el, mailbox| {
                    el.child(div().flex_none().size(px(8.)).rounded_full().bg(theme::account(mailbox.color)))
                        .child(div().min_w_0().truncate().child(mailbox.email.clone()))
                })
                .child(theme::hi("unfold-more").text_color(theme::muted()))
                .child(anchor(&self.writing.anchors, "from"))
                .on_click(cx.listener(move |this, _, _, cx| this.toggle_menu(key, Menu::From, cx)));
            message_row(t("From", "Van"), false, trigger, None)
        });
        let copies = (!composer.copies).then(|| {
            div()
                .id("copies")
                .flex_none()
                .text_size(px(12.))
                .text_color(theme::muted())
                .cursor_pointer()
                .hover(|el| el.text_color(theme::foreground()))
                .child("Cc / Bcc")
                .on_click(cx.listener(move |this, _, _, cx| {
                    if let Some(composer) = this.writer(key) {
                        composer.copies = true;
                    }
                    cx.notify();
                }))
                .into_any_element()
        });
        let subject = message_row(
            t("Subject", "Onderwerp"),
            composer.subject_focused,
            div().flex_1().min_w_0().child(Input::new(&composer.subject).appearance(false).text_size(px(14.))),
            None,
        );
        let fields = div()
            .flex()
            .flex_col()
            .flex_none()
            .children(from)
            .child(self.render_address_row(composer, Which::To, t("To", "Aan"), copies, cx))
            .when(composer.copies, |el| {
                el.child(self.render_address_row(composer, Which::Cc, "Cc", None, cx))
                    .child(self.render_address_row(composer, Which::Bcc, "Bcc", None, cx))
            })
            .child(subject);
        let status = match composer.autosave.status {
            SaveStatus::Idle => "",
            SaveStatus::Saving => t("Saving…", "Opslaan…"),
            SaveStatus::Saved => t("Draft saved", "Concept opgeslagen"),
            SaveStatus::Failed => t("Couldn't save the draft", "Concept niet opgeslagen"),
        };
        let failed = composer.autosave.status == SaveStatus::Failed;
        let busy = composer.busy;
        let discard = (composer.has_draft() || composer.opened.is_some()).then(|| {
            // `text-muted-foreground hover:bg-transparent hover:text-destructive`.
            div()
                .id("discard")
                .group("discard")
                .flex()
                .flex_none()
                .items_center()
                .justify_center()
                .size(px(32.))
                .rounded(theme::RADIUS_MD)
                .child(
                    theme::hi("delete-02")
                        .text_color(theme::muted())
                        .group_hover("discard", |el| el.text_color(theme::danger())),
                )
                .tooltip(ui::tip(t("Discard draft", "Concept verwijderen")))
                .map(|el| {
                    if busy {
                        ui::disabled(el)
                    } else {
                        el.cursor_pointer().on_click(cx.listener(|this, _, _, cx| this.discard_message(cx)))
                    }
                })
        });
        let send = self.render_send(composer, t("Send", "Versturen"), true, cx);
        let bar = div()
            .flex_none()
            .mx(px(16.))
            .mb(px(16.))
            .px(px(10.))
            .py(px(8.))
            .rounded(theme::RADIUS_XL)
            .border_1()
            .border_color(theme::border())
            .bg(theme::with_alpha(theme::background(), 0.9))
            .shadow_sm()
            .children(self.render_files(composer, cx).map(|files| {
                files.mb(px(8.)).border_b_1().border_color(theme::border()).px(px(2.)).pt(px(2.)).pb(px(10.))
            }))
            .children(self.render_ai_line(composer, cx).map(|line| {
                line.mb(px(8.)).border_b_1().border_color(theme::border()).px(px(4.)).pt(px(2.)).pb(px(10.))
            }))
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap(px(12.))
                    .min_h(px(40.))
                    .child(self.render_tools(composer, cx))
                    .child(
                        div()
                            .flex()
                            .flex_none()
                            .items_center()
                            .gap(px(4.))
                            .child(
                                div()
                                    .mr(px(4.))
                                    .text_size(px(12.))
                                    .text_color(if failed { theme::danger() } else { theme::muted() })
                                    .child(status),
                            )
                            .children(discard)
                            .child(send),
                    ),
            );
        let title = if composer.opened.is_some() { t("Draft", "Concept") } else { t("New message", "Nieuw bericht") };
        // The toasts are drawn at the bottom right: the editor, a system view, leaves them room.
        let room = (self.toast_room() - 80.).max(0.);
        let menus = self.render_compose_menu(composer, cx);
        Some(
            page.child(header)
                .child(
                    // `readingColumn … flex min-h-full flex-col pt-2`.
                    div()
                        .flex()
                        .flex_col()
                        .flex_1()
                        .min_h_0()
                        .w_full()
                        .max_w(px(COLUMN))
                        .mx_auto()
                        .pt(px(8.))
                        .child(
                            div()
                                .mb(px(8.))
                                .px(px(32.))
                                .text_size(px(18.))
                                .line_height(px(28.))
                                .font_weight(FontWeight::SEMIBOLD)
                                .child(title),
                        )
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .flex_1()
                                .min_h_0()
                                .px(px(16.))
                                .child(fields)
                                .child(div().flex_1().min_h(px(MESSAGE_MIN)).pb(px(room)).child(editor))
                                .child(bar),
                        ),
                )
                .children(menus)
                .into_any_element(),
        )
    }

    /// The reply or forward under the open conversation (`ReplyForm`, `ForwardForm`).
    fn render_answer(&mut self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let key = self.writing.answer.as_ref()?.key;
        let editor = self.editor_slot(key, cx);
        let answer = self.writing.answer.as_ref()?;
        let forward = matches!(answer.kind, Kind::Forward { .. });
        // The form takes at most `max-h-[60dvh]`; the text scrolls inside it beyond that.
        let least = if forward { FORWARD_MIN } else { REPLY_MIN };
        let most = (self.writing.viewport * 0.6 - 150.).max(least);
        let height = answer.editor.read(cx).content_height().unwrap_or(least).clamp(least, most);
        let names = |list: &[Address]| list.iter().map(|address| address.label()).collect::<Vec<_>>().join(", ");
        let head = match &answer.kind {
            Kind::Forward { .. } => self.render_address_row(answer, Which::To, t("To", "Aan"), None, cx),
            _ => {
                let mut line = format!("{}: {}", t("To", "Aan"), names(&answer.reply_to));
                if !answer.reply_cc.is_empty() {
                    line.push_str(&format!(" · Cc: {}", names(&answer.reply_cc)));
                }
                div()
                    .truncate()
                    .border_b_1()
                    .border_color(theme::border())
                    .px(px(16.))
                    .py(px(8.))
                    .text_size(px(12.))
                    .line_height(px(16.))
                    .text_color(theme::muted())
                    .child(line)
                    .into_any_element()
            }
        };
        let note = match answer.kind {
            Kind::Forward { files, .. } if files > 0 => Some(if files == 1 {
                t("1 attachment is included.", "1 bijlage wordt meegestuurd.").to_string()
            } else {
                t(format!("{files} attachments are included."), format!("{files} bijlagen worden meegestuurd."))
            }),
            _ => None,
        };
        let send = self.render_send(answer, t("Send", "Versturen"), false, cx);
        let form = div()
            .flex()
            .flex_col()
            .overflow_hidden()
            .rounded(theme::RADIUS_XL)
            .border_1()
            .border_color(theme::border())
            .bg(theme::background())
            .shadow_sm()
            .child(head)
            .child(div().h(px(height)).flex_none().child(editor))
            .children(self.render_files(answer, cx).map(|files| {
                files.mx(px(8.)).border_t_1().border_color(theme::border()).px(px(4.)).pt(px(10.)).pb(px(4.))
            }))
            .children(self.render_ai_line(answer, cx).map(|line| {
                line.mx(px(8.)).border_t_1().border_color(theme::border()).px(px(8.)).pt(px(10.)).pb(px(4.))
            }))
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap(px(12.))
                    .p(px(8.))
                    .child(self.render_tools(answer, cx).when_some(note, |el, note| {
                        el.child(div().min_w_0().truncate().px(px(8.)).text_size(px(12.)).text_color(theme::muted()).child(note))
                    }))
                    .child(
                        div()
                            .flex()
                            .flex_none()
                            .items_center()
                            .gap(px(4.))
                            .child(
                                ui::button_sm("cancel-answer", t("Cancel", "Annuleren"), ui::Variant::Ghost)
                                    .on_click(cx.listener(|this, _, window, cx| this.cancel_answer(window, cx))),
                            )
                            .child(send),
                    ),
            );
        let menus = self.render_compose_menu(answer, cx);
        Some(
            self.composer_shell(key, cx)
                .flex_none()
                .w_full()
                .max_w(px(COLUMN))
                .mx_auto()
                .px(px(32.))
                .pt(px(8.))
                // Clear of the toasts, which are drawn over the panel's bottom right.
                .pb(px(16.))
                .child(form)
                .children(menus)
                .into_any_element(),
        )
    }

    /// The paperclip, the sparkle and the pen at the bar's start.
    fn render_tools(&self, composer: &Composer, cx: &mut Context<Self>) -> Div {
        let key = composer.key;
        let attach = composer.takes_files().then(|| {
            let limit = format!("{} MB", wire::MAX_ATTACHMENTS_BYTES / (1024 * 1024));
            tool("attach", "attachment-01", false)
                .tooltip(ui::tip(t(format!("Attach files (max {limit})"), format!("Bestanden toevoegen (max {limit})"))))
                .on_click(cx.listener(move |this, _, window, cx| this.pick_attachments(key, window, cx)))
        });
        let ai = Ai::enabled().then(|| {
            tool("ai", "sparkles", composer.ai.open)
                .tooltip(ui::tip_with_hint(t("Write with AI", "Schrijven met AI"), "⌘J"))
                .on_click(cx.listener(move |this, _, window, cx| this.toggle_ai(key, window, cx)))
        });
        let signatures = self.writing.signatures.as_deref().unwrap_or_default();
        let signature = (!signatures.is_empty()).then(|| {
            let current = self.signature_of(composer).flatten().map(|signature| signature.name.clone());
            let name = current.unwrap_or_else(|| t("No signature", "Geen handtekening").to_string());
            tool("signature", "pen-tool-03", composer.menu == Some(Menu::Signature))
                .child(anchor(&self.writing.anchors, "signature"))
                .tooltip(ui::tip(format!("{}: {name}", t("Signature", "Handtekening"))))
                .on_click(cx.listener(move |this, _, _, cx| this.toggle_menu(key, Menu::Signature, cx)))
        });
        div()
            .flex()
            .items_center()
            .gap(px(4.))
            .min_w_0()
            .children(attach)
            .children(ai)
            .children(signature)
    }

    /// Sends the form: its name, the shortcut in a tooltip. With `later`, a
    /// split button: the arrow on its right opens "Send later" (`SendButton`).
    fn render_send(&self, composer: &Composer, label: &'static str, later: bool, cx: &mut Context<Self>) -> AnyElement {
        let key = composer.key;
        let can = composer.can_send();
        let send = ui::button("send", label, ui::Variant::Primary)
            .px(px(12.))
            .tooltip(ui::tip_with_hint(label, "⌘↵"));
        let send = if can {
            send.on_click(cx.listener(move |this, _, window, cx| this.submit(key, window, cx)))
        } else {
            ui::disabled(send)
        };
        if !later {
            return send.into_any_element();
        }
        let open = composer.menu == Some(Menu::Later);
        let arrow = div()
            .id("send-later")
            .relative()
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
            .size(px(32.))
            .rounded_r(theme::RADIUS_MD)
            .bg(theme::primary())
            .child(theme::hi(if open { "arrow-up-01" } else { "arrow-down-01" }).text_color(theme::primary_foreground()))
            .child(anchor(&self.writing.anchors, "later"))
            .tooltip(ui::tip(t("Send later", "Later versturen")));
        let arrow = if can {
            arrow
                .cursor_pointer()
                .hover(|el| el.bg(theme::with_alpha(theme::primary(), 0.9)))
                .on_click(cx.listener(move |this, _, _, cx| this.toggle_menu(key, Menu::Later, cx)))
        } else {
            ui::disabled(arrow)
        };
        // `ButtonGroup` with its separator: the two share an edge.
        div()
            .flex()
            .flex_none()
            .items_center()
            .child(send.rounded_r(px(0.)))
            .child(div().w(px(1.)).h(px(32.)).bg(theme::with_alpha(theme::primary_foreground(), 0.3)))
            .child(arrow)
            .into_any_element()
    }

    /// The attached files as small cards: kind, name, size, and how far the
    /// upload is (`AttachmentList`).
    fn render_files(&self, composer: &Composer, cx: &mut Context<Self>) -> Option<Div> {
        if composer.files.is_empty() {
            return None;
        }
        let key = composer.key;
        let cards = composer.files.iter().map(|file| {
            let uploading = !file.failed && file.progress < 1.;
            let file_key = file.key;
            let group = SharedString::from(format!("file-{file_key}"));
            let detail = if file.failed {
                t("Didn't upload", "Niet geüpload").to_string()
            } else if uploading {
                format!("{} · {}%", size_label(file.size), (file.progress * 100.).round() as u32)
            } else {
                size_label(file.size)
            };
            div()
                .id(("file", file_key as usize))
                .group(group.clone())
                .relative()
                .flex()
                .items_center()
                .gap(px(10.))
                .h(px(44.))
                .max_w(px(240.))
                .min_w_0()
                .pl(px(8.))
                .pr(px(6.))
                .overflow_hidden()
                .rounded(theme::RADIUS)
                .border_1()
                .border_color(if file.failed { theme::with_alpha(theme::danger(), 0.4) } else { theme::border() })
                .bg(theme::with_alpha(theme::muted_bg(), 0.4))
                .child(
                    div()
                        .flex()
                        .flex_none()
                        .items_center()
                        .justify_center()
                        .size(px(28.))
                        .rounded(theme::RADIUS)
                        .bg(theme::background())
                        .child(theme::hi(file.icon()).text_color(if file.failed { theme::danger() } else { theme::muted() })),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .flex_1()
                        .min_w_0()
                        .child(
                            div()
                                .truncate()
                                .text_size(px(12.))
                                .line_height(px(16.))
                                .font_weight(FontWeight::MEDIUM)
                                .child(file.name.clone()),
                        )
                        .child(
                            div()
                                .truncate()
                                .text_size(px(11.))
                                .line_height(px(16.))
                                .text_color(if file.failed { theme::danger() } else { theme::muted() })
                                .child(detail),
                        ),
                )
                .child(
                    div()
                        .id(("remove-file", file_key as usize))
                        .flex()
                        .flex_none()
                        .items_center()
                        .justify_center()
                        .size(px(24.))
                        .rounded(theme::RADIUS_SM)
                        .cursor_pointer()
                        .invisible()
                        .group_hover(group, |el| el.visible())
                        .child(theme::hi("cancel-01").size(px(12.)).text_color(theme::with_alpha(theme::foreground(), 0.7)))
                        .on_click(cx.listener(move |this, _, _, cx| this.remove_attachment(key, file_key, cx))),
                )
                .when(uploading, |el| {
                    el.child(
                        div()
                            .absolute()
                            .left_0()
                            .bottom_0()
                            .h(px(2.))
                            .w(relative(file.progress.max(0.04)))
                            .bg(theme::primary()),
                    )
                })
        });
        Some(div().flex().flex_wrap().gap(px(8.)).children(cards))
    }

    /// One line: what to write. Enter writes, Escape closes (`AiPrompt`).
    fn render_ai_line(&self, composer: &Composer, cx: &mut Context<Self>) -> Option<Div> {
        if !composer.ai.open || !Ai::enabled() {
            return None;
        }
        let key = composer.key;
        let pending = composer.ai.pending;
        let filled = !composer.ai.input.read(cx).value().trim().is_empty();
        let round = div()
            .id("ai-go")
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
            .size(px(28.))
            .rounded_full()
            .map(|el| {
                if pending || filled {
                    el.bg(theme::primary())
                        .cursor_pointer()
                        .hover(|el| el.bg(theme::with_alpha(theme::primary(), 0.9)))
                        .child(
                            theme::hi(if pending { "stop" } else { "arrow-up-02" })
                                .size(px(if pending { 14. } else { 16. }))
                                .text_color(theme::primary_foreground()),
                        )
                        .on_click(cx.listener(move |this, _, window, cx| {
                            if pending {
                                this.close_ai(key, window, cx)
                            } else {
                                this.submit_ai(key, window, cx)
                            }
                        }))
                } else {
                    el.bg(theme::muted_bg()).child(theme::hi("arrow-up-02").text_color(theme::muted()))
                }
            })
            .tooltip(if pending {
                ui::tip_with_hint(t("Stop writing", "Stoppen met schrijven"), "")
            } else {
                ui::tip_with_hint(t("Write", "Schrijven"), "↵")
            });
        Some(
            div()
                .flex()
                .items_center()
                .gap(px(8.))
                .child(theme::hi("sparkles").text_color(theme::primary_mark()))
                .child(
                    div()
                        .key_context("AiLine")
                        .flex_1()
                        .min_w_0()
                        .text_size(px(14.))
                        .when(pending, |el| el.opacity(0.6))
                        // Not the composer's own Escape, which would put the message away.
                        .capture_action(cx.listener(move |this, _: &Escape, window, cx| {
                            this.close_ai(key, window, cx);
                            cx.stop_propagation();
                        }))
                        .child(Input::new(&composer.ai.input).appearance(false).text_size(px(14.))),
                )
                .when(pending, |el| {
                    el.child(
                        div()
                            .flex_none()
                            .text_size(px(12.))
                            .text_color(theme::muted())
                            .child(t("Writing…", "Schrijven…")),
                    )
                })
                .child(round),
        )
    }

    /// The menu that is open, hanging from its button: the mailbox to send
    /// from, the signature, or Send later.
    fn render_compose_menu(&self, composer: &Composer, cx: &mut Context<Self>) -> Option<AnyElement> {
        let menu = composer.menu?;
        let key = composer.key;
        let name = match menu {
            Menu::From => "from",
            Menu::Signature => "signature",
            Menu::Later => "later",
        };
        let bounds = self.writing.anchors.borrow().get(name).copied()?;
        let check = || theme::hi("tick-02").text_color(theme::foreground());
        let (panel, position, corner) = match menu {
            Menu::From => {
                let rows = self.mailboxes.iter().filter(|mailbox| mailbox.active()).enumerate().map(|(index, mailbox)| {
                    let id = mailbox.id.clone();
                    let chosen = composer.account.as_deref() == Some(mailbox.id.as_str());
                    menu_item(("from", index))
                        .text_size(px(14.))
                        .rounded(theme::RADIUS_SM)
                        .child(div().flex_none().size(px(8.)).rounded_full().bg(theme::account(mailbox.color)))
                        .child(div().flex_1().min_w_0().truncate().child(mailbox.email.clone()))
                        .child(div().flex().flex_none().size(px(16.)).children(chosen.then(check)))
                        .on_click(cx.listener(move |this, _, _, cx| this.set_from(key, id.clone(), cx)))
                });
                (
                    menu_panel("from-menu").min_w(bounds.size.width.max(px(144.))).children(rows),
                    point(bounds.left(), bounds.bottom() + px(4.)),
                    Anchor::TopLeft,
                )
            }
            Menu::Signature => {
                let current = self.signature_of(composer).flatten().map(|signature| signature.id.clone());
                let signatures = self.writing.signatures.as_deref().unwrap_or_default();
                let rows = signatures.iter().enumerate().map(|(index, signature)| {
                    let id = signature.id.clone();
                    let chosen = current.as_deref() == Some(signature.id.as_str());
                    menu_item(("signature", index))
                        .child(div().flex_1().min_w_0().truncate().child(signature.name.clone()))
                        .child(div().flex().flex_none().size(px(16.)).children(chosen.then(check)))
                        .on_click(cx.listener(move |this, _, _, cx| this.pick_signature(key, Some(id.clone()), cx)))
                });
                let none = menu_item("no-signature")
                    .text_color(theme::muted())
                    .child(div().flex_1().min_w_0().truncate().child(t("No signature", "Geen handtekening")))
                    .child(div().flex().flex_none().size(px(16.)).children(current.is_none().then(check)))
                    .on_click(cx.listener(move |this, _, _, cx| this.pick_signature(key, None, cx)));
                (
                    menu_panel("signature-menu")
                        .w(px(208.))
                        .child(
                            div()
                                .px(px(8.))
                                .py(px(4.))
                                .text_size(px(12.))
                                .text_color(theme::muted())
                                .child(t("Signature", "Handtekening")),
                        )
                        .children(rows)
                        .child(div().mx(px(-4.)).my(px(4.)).h(px(1.)).bg(theme::with_alpha(theme::border(), 0.5)))
                        .child(none),
                    point(bounds.left(), bounds.top() - px(8.)),
                    Anchor::BottomLeft,
                )
            }
            Menu::Later => (
                menu_panel("later-menu").min_w(px(176.)).child(
                    menu_item("send-later-item")
                        .gap(px(10.))
                        .child(theme::hi("alarm-clock").size(px(14.)).text_color(theme::foreground()))
                        .child(t("Send later", "Later versturen"))
                        .on_click(cx.listener(move |this, _, window, cx| {
                            if let Some(composer) = this.writer(key) {
                                composer.menu = None;
                            }
                            this.open_send_when(window, cx);
                        })),
                ),
                point(bounds.right(), bounds.top() - px(6.)),
                Anchor::BottomRight,
            ),
        };
        let panel = panel.on_mouse_down_out(cx.listener(move |this, event: &MouseDownEvent, _, cx| {
            // A press on the button itself closes it there.
            if bounds.contains(&event.position) {
                return;
            }
            if let Some(composer) = this.writer(key) {
                composer.menu = None;
            }
            cx.notify();
        }));
        Some(
            deferred(anchored().position(position).anchor(corner).snap_to_window_with_margin(px(8.)).child(panel))
                .with_priority(50)
                .into_any_element(),
        )
    }

    /// Send later: when to send, picked like a snooze (`WhenPicker` with `purpose="send"`).
    pub(super) fn open_send_when(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(composer) = &self.composer {
            composer.editor.read(cx).release_keyboard(cx);
        }
        self.open_when(SnoozeTarget::Send, window, cx);
    }
}
