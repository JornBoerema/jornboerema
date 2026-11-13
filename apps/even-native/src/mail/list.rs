//! The list in view (apps/mail-web/src/pages/inbox.tsx): its header with the
//! title, the sync status, the mailbox filter and search, the selection bar,
//! and the conversations as two-line rows with quick actions on hover. Only
//! the rows in view are laid out (`ThreadList`).

use std::ops::Range;

use gpui_kit::component::button::{Button, ButtonVariants as _};
use gpui_kit::component::menu::{DropdownMenu as _, PopupMenuItem};
use gpui_kit::component::{v_virtual_list, Icon, Selectable as _, Sizable as _};

use crate::api::Thread;
use crate::ui;

use super::api::{can_report_spam, move_actions};
use super::overlays::{Confirm, SnoozeTarget};
use super::places::{folder_place, Place};
use super::*;

/// Between two rows (the list's `gap-0.5`).
pub(super) const ROW_GAP: f32 = 2.;
/// The quiet line below the pinned rows: `mt-1.5`, the line, `mb-1`.
pub(super) const DIVIDER: f32 = 11.;
/// Under the last row (`paddingBottom: below + 8`).
pub(super) const LIST_BOTTOM: f32 = 8.;
/// The marker that loads the next page (`LoadMore`, `h-12`).
const LOAD_MORE: f32 = 48.;

/// A star that is set: filled, in the colour mail apps use for it (`STARRED`, amber-500).
pub(super) fn amber() -> Rgba {
    rgba(0xfe9a00ff)
}

/// The list's column: `md:w-80`, `xl:w-96` by the window's width.
pub(super) fn list_width(window: &Window) -> Pixels {
    if window.viewport_size().width >= px(1280.) {
        px(384.)
    } else {
        px(320.)
    }
}

/// The web's Checkbox: 16 points, filled with the brand colour when checked.
/// `None` is the indeterminate state of "select all".
pub(super) fn checkbox(id: impl Into<ElementId>, checked: Option<bool>) -> Stateful<Div> {
    let on = checked == Some(true);
    div()
        .id(id)
        .flex()
        .flex_none()
        .items_center()
        .justify_center()
        .size(px(16.))
        .rounded(px(5.))
        .cursor_pointer()
        .bg(if on { theme::primary() } else { theme::mix(theme::input(), 90.) })
        .when(checked != Some(false), |el| {
            el.child(theme::hi("tick-02").size(px(14.)).text_color(if on {
                theme::primary_foreground()
            } else {
                theme::foreground()
            }))
        })
}

/// An icon for a gpui-component menu or button.
pub(super) fn menu_icon(name: &str) -> Icon {
    Icon::default().path(format!("hi/{name}.svg"))
}

/// The sign of a move (`MOVE_ICONS` in lib/thread-actions.ts).
pub(super) fn move_icon(action: ThreadAction) -> &'static str {
    match action {
        ThreadAction::Trash => "delete-02",
        ThreadAction::Inbox => "inbox",
        ThreadAction::Spam => "spam",
        ThreadAction::Delete => "delete-04",
        _ => "archive",
    }
}

/// "Move to inbox" from spam is "Not spam" (`moveLabel`).
pub(super) fn move_label(action: ThreadAction, folder: Option<MailFolder>) -> &'static str {
    match action {
        ThreadAction::Inbox if folder == Some(MailFolder::Spam) => t("Not spam", "Geen spam"),
        ThreadAction::Inbox => t("Move to inbox", "Terug naar inbox"),
        ThreadAction::Delete => t("Delete for good", "Definitief verwijderen"),
        ThreadAction::Spam => t("Report spam", "Spam melden"),
        ThreadAction::Archive => t("Archive", "Archiveren"),
        _ => t("Move to trash", "Naar prullenbak"),
    }
}

pub(super) fn is_destructive(action: ThreadAction) -> bool {
    matches!(action, ThreadAction::Trash | ThreadAction::Delete)
}

/// One quick action over a row's right end (`RowActions`): only the icon
/// reacts; the row already shows what is hovered.
pub(super) struct RowAction {
    pub(super) icon: &'static str,
    pub(super) label: SharedString,
    pub(super) destructive: bool,
    /// A set star keeps its colour.
    pub(super) starred: bool,
    pub(super) run: Box<dyn Fn(&mut MailView, &mut Window, &mut Context<MailView>) + 'static>,
}

impl RowAction {
    pub(super) fn new(
        icon: &'static str,
        label: impl Into<SharedString>,
        run: impl Fn(&mut MailView, &mut Window, &mut Context<MailView>) + 'static,
    ) -> Self {
        Self {
            icon,
            label: label.into(),
            destructive: false,
            starred: false,
            run: Box::new(run),
        }
    }

    pub(super) fn destructive(mut self, destructive: bool) -> Self {
        self.destructive = destructive;
        self
    }
}

/// The quick actions, shown on hover of the row's group in place of the date.
pub(super) fn row_actions(row: usize, actions: Vec<RowAction>, cx: &mut Context<MailView>) -> Div {
    div()
        .absolute()
        .top(px(6.))
        .right(px(6.))
        .flex()
        .gap(px(2.))
        .opacity(0.)
        .group_hover("row", |el| el.opacity(1.))
        .children(actions.into_iter().enumerate().map(|(index, action)| {
            let group = SharedString::from(format!("row-action-{row}-{index}"));
            let run = action.run;
            let (icon, color, hover) = if action.starred {
                ("star-filled", amber(), amber())
            } else if action.destructive {
                (action.icon, theme::muted(), theme::danger())
            } else {
                (action.icon, theme::muted(), theme::foreground())
            };
            div()
                .id(("row-action", row * 16 + index))
                .group(group.clone())
                .flex()
                .items_center()
                .justify_center()
                .size(px(24.))
                .cursor_pointer()
                .child(
                    theme::hi(icon)
                        .size(px(12.))
                        .text_color(color)
                        .group_hover(group, move |el| el.text_color(hover)),
                )
                .tooltip(ui::tip(action.label))
                .on_click(cx.listener(move |this, _, window, cx| {
                    cx.stop_propagation();
                    run(this, window, cx);
                }))
        }))
}

/// The shell of every line in every list: the row's button with the web's
/// inset, which leaves a gutter for the unread dot and the checkbox.
pub(super) fn row_button(id: impl Into<ElementId>, selected: bool, checked: bool) -> Stateful<Div> {
    div()
        .id(id)
        .flex()
        .flex_col()
        .w_full()
        .gap(px(2.))
        .py(px(8.))
        .pr(px(10.))
        .pl(px(32.))
        .rounded(theme::RADIUS)
        .text_size(px(14.))
        .line_height(px(20.))
        .cursor_pointer()
        .map(|el| {
            if checked {
                el.bg(theme::mix(theme::primary_mark(), 10.))
            } else if selected {
                el.bg(theme::accent())
            } else {
                el.group_hover("row", |el| el.bg(theme::with_alpha(theme::accent(), 0.6)))
            }
        })
}

/// Lines while a list loads, inset like the lines that follow (`ListSkeleton`).
pub(super) fn skeleton(inset: bool) -> impl IntoElement {
    let bar = |width: f32| {
        div()
            .h(px(14.))
            .w(relative(width))
            .rounded(theme::RADIUS_SM)
            .bg(theme::muted_bg())
    };
    div()
        .px(px(8.))
        .pb(px(8.))
        .children((0..10).map(move |_| {
            div()
                .flex()
                .flex_col()
                .gap(px(8.))
                .py(px(12.))
                .pr(px(10.))
                .pl(px(if inset { 32. } else { 10. }))
                .child(bar(0.4))
                .child(bar(0.8))
        }))
        .with_animation(
            "pulse",
            Animation::new(Duration::from_secs(2)).repeat().with_easing(gpui_kit::pulsating_between(0.5, 1.)),
            |el, delta| el.opacity(delta),
        )
}

/// An empty list: the place's sign, what is (not) here and, if useful, one
/// line on why (components/list-empty.tsx).
pub(super) fn list_empty(icon: &str, title: impl Into<SharedString>, body: Option<SharedString>) -> Div {
    div()
        .flex()
        .flex_col()
        .size_full()
        .items_center()
        .justify_center()
        .gap(px(4.))
        .px(px(32.))
        // A little above the middle, where the eye lands (`pb-[12vh]`).
        .pb(relative(0.12))
        .child(
            div()
                .flex()
                .items_center()
                .justify_center()
                .size(px(40.))
                .mb(px(12.))
                .rounded(theme::RADIUS)
                .bg(theme::muted_bg())
                .child(theme::hi(icon).size(px(20.)).text_color(theme::muted())),
        )
        .child(div().text_size(px(14.)).font_weight(FontWeight::MEDIUM).child(title.into()))
        .when_some(body, |el, body| {
            el.child(
                div()
                    .max_w(px(256.))
                    .text_size(px(14.))
                    .text_center()
                    .text_color(theme::muted())
                    .child(body),
            )
        })
}

/// A line of quiet text where a list would be.
pub(super) fn note(text: impl Into<SharedString>, inset: bool) -> Div {
    div()
        .p(px(16.))
        .when(inset, |el| el.pl(px(32.)))
        .text_size(px(14.))
        .text_color(theme::muted())
        .child(text.into())
}

pub(super) fn failed(text: impl Into<SharedString>, inset: bool) -> Div {
    note(text, inset).text_color(theme::danger())
}

impl MailView {
    /// The title of the list in view.
    fn title(&self) -> SharedString {
        match self.view {
            View::Inbox => self
                .mailbox(&self.filter)
                .map_or_else(|| "Inbox".into(), |mailbox| mailbox.email.clone().into()),
            View::Drafts => Place::Drafts.label().into(),
            View::Parcels => Place::Parcels.label().into(),
            View::Invoices => Place::Invoices.label().into(),
            View::Snoozed => Place::Snoozed.label().into(),
            View::Scheduled => Place::Scheduled.label().into(),
            View::Senders => Place::Senders.label().into(),
            View::Folder(folder) => folder_place(folder).label().into(),
        }
    }

    pub(super) fn render_list(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let selecting = !self.selection().is_empty();
        let header = div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(6.))
            .h(px(HEADER))
            .pr(px(8.))
            // The title lines up with the senders; the select-all box with the rows' boxes.
            .pl(px(if selecting { 18. } else { 40. }))
            .map(|el| {
                if selecting {
                    el.child(self.render_selection_bar(cx))
                } else {
                    el.child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .truncate()
                            .text_size(px(14.))
                            .font_weight(FontWeight::MEDIUM)
                            .child(self.title()),
                    )
                }
            })
            .map(|el| match self.sync {
                SyncStatus::Syncing => el.child(
                    div()
                        .id("syncing")
                        .flex()
                        .child(ui::spinner())
                        .tooltip(ui::tip(t("Syncing…", "Synchroniseren…"))),
                ),
                SyncStatus::Failed => el.child(
                    div()
                        .id("sync-failed")
                        .flex()
                        .child(theme::hi("cloud-alert").text_color(theme::muted()))
                        .tooltip(ui::tip(t(
                            "Syncing failed. Trying again soon.",
                            "Synchroniseren is mislukt. We proberen het zo opnieuw.",
                        ))),
                ),
                SyncStatus::Idle => el,
            })
            .when(!selecting && self.view != View::Inbox && self.mailboxes.len() > 1, |el| {
                el.child(self.render_mailbox_filter(cx))
            })
            .when(self.view == View::Folder(MailFolder::Trash), |el| {
                el.children(self.render_empty_trash(cx))
            })
            .when(self.view == View::Parcels, |el| {
                let shown = settings::show_delivered();
                el.child(
                    ui::icon_button("show-delivered", "package-delivered")
                        .when(shown, |el| el.bg(theme::accent()))
                        .tooltip(ui::tip(if shown {
                            t("Hide delivered", "Bezorgde verbergen")
                        } else {
                            t("Show delivered", "Bezorgde tonen")
                        }))
                        .on_click(cx.listener(move |_, _, _, cx| {
                            settings::set_show_delivered(!shown);
                            cx.notify();
                        })),
                )
            })
            .child(
                ui::icon_button("search", "search-01")
                    .tooltip(ui::tip_with_hint(t("Search", "Zoeken"), "⌘K"))
                    .on_click(cx.listener(|this, _, window, cx| this.open_spotlight(window, cx))),
            );

        let body = match self.view {
            View::Inbox | View::Folder(_) => self.render_threads(cx),
            _ => self.render_other_list(window, cx),
        };
        div()
            .flex()
            .flex_col()
            .flex_none()
            .w(list_width(window))
            .h_full()
            .min_h_0()
            .child(header)
            .children(self.render_invoice_filter(cx))
            .child(div().flex_1().min_h_0().child(body))
    }

    /// What to do with the selected conversations: the folder's two moves as
    /// buttons, then clearing the selection, and the rest in ⋯ (`SelectionBar`).
    fn render_selection_bar(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let selection = self.selection();
        let count = selection.len();
        let total = self.rows.len();
        let all_starred = selection.iter().all(|thread| thread.is_starred);
        let all_read = selection.iter().all(|thread| thread.is_read);
        let all_unread = selection.iter().all(|thread| !thread.is_read);
        // Every selected conversation is in a mailbox that can delete for good.
        let can_delete = selection
            .iter()
            .all(|thread| self.mailbox(&thread.account_id).is_some_and(Mailbox::can_delete_forever));
        let folder = self.view.folder();
        let moves = move_actions(folder, can_delete);
        let (shown, more) = moves.split_at(moves.len().min(2));
        let more = more.to_vec();
        let this = cx.weak_entity();
        div()
            .flex()
            .flex_1()
            .min_w_0()
            .items_center()
            .gap(px(4.))
            .child(
                checkbox("select-all", (count == total).then_some(true)).on_click(cx.listener(
                    move |this, _, _, cx| {
                        if count == total {
                            this.clear_selection();
                            cx.notify();
                        } else {
                            this.select_all(cx);
                        }
                    },
                )),
            )
            .child(
                div()
                    .mr_auto()
                    .min_w_0()
                    .truncate()
                    .pl(px(8.))
                    .text_size(px(14.))
                    .font_weight(FontWeight::MEDIUM)
                    .child(t(format!("{count} selected"), format!("{count} geselecteerd"))),
            )
            .children(shown.iter().map(|action| {
                let action = *action;
                ui::icon_button(("bulk", action as usize), move_icon(action))
                    .tooltip(ui::tip(move_label(action, folder)))
                    .on_click(cx.listener(move |this, _, _, cx| this.bulk(action, None, cx)))
            }))
            .child(
                ui::icon_button("clear-selection", "minus-sign-square")
                    .tooltip(ui::tip(t("Clear selection", "Selectie wissen")))
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.clear_selection();
                        cx.notify();
                    })),
            )
            .child(
                Button::new("selection-more")
                    .ghost()
                    .small()
                    .size(px(28.))
                    .icon(menu_icon("more-horizontal").size(px(16.)))
                    .dropdown_menu_with_anchor(Anchor::TopRight, move |menu, _, _| {
                        let item = |icon: &str, label: &str, run: Box<dyn Fn(&mut MailView, &mut Window, &mut Context<MailView>)>| {
                            let this = this.clone();
                            PopupMenuItem::new(label.to_string())
                                .icon(menu_icon(icon))
                                .on_click(move |_, window, cx| {
                                    let _ = this.update(cx, |this, cx| run(this, window, cx));
                                })
                        };
                        let mut menu = menu.min_w(px(192.)).item(item(
                            "alarm-clock",
                            t("Snooze", "Snoozen"),
                            Box::new(|this, window, cx| this.open_when(SnoozeTarget::Selection, window, cx)),
                        ));
                        if !all_read {
                            menu = menu.item(item(
                                "mail-open-01",
                                t("Mark as read", "Markeren als gelezen"),
                                Box::new(|this, _, cx| this.bulk(ThreadAction::Read, None, cx)),
                            ));
                        }
                        if !all_unread {
                            menu = menu.item(item(
                                "mail-01",
                                t("Mark as unread", "Markeren als ongelezen"),
                                Box::new(|this, _, cx| this.bulk(ThreadAction::Unread, None, cx)),
                            ));
                        }
                        menu = menu.item(item(
                            "star",
                            if all_starred {
                                t("Remove star", "Ster verwijderen")
                            } else {
                                t("Star", "Ster toevoegen")
                            },
                            Box::new(move |this, _, cx| {
                                this.bulk(if all_starred { ThreadAction::Unstar } else { ThreadAction::Star }, None, cx)
                            }),
                        ));
                        if can_report_spam(folder) {
                            menu = menu.item(item(
                                "spam",
                                t("Report spam", "Spam melden"),
                                Box::new(|this, _, cx| this.bulk(ThreadAction::Spam, None, cx)),
                            ));
                        }
                        for action in more.iter().copied() {
                            menu = menu.item(item(
                                move_icon(action),
                                move_label(action, folder),
                                Box::new(move |this, _, cx| this.bulk(action, None, cx)),
                            ));
                        }
                        menu
                    }),
            )
    }

    /// Which mailbox a list shows, beside its title. Every mailbox by default;
    /// one picked shows as its dot and address, so the list never looks
    /// complete when it isn't (components/mailbox-filter.tsx).
    fn render_mailbox_filter(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let picked = self.mailbox(&self.filter).cloned();
        let mailboxes = self.mailboxes.clone();
        let filter = self.filter.clone();
        let this = cx.weak_entity();
        let dot = |color: usize| div().flex_none().size(px(8.)).rounded_full().bg(theme::account(color));
        let trigger = match &picked {
            Some(mailbox) => Button::new("mailbox-filter")
                .ghost()
                .small()
                .selected(true)
                .max_w(px(192.))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(6.))
                        .min_w_0()
                        .child(dot(mailbox.color))
                        .child(div().min_w_0().truncate().text_size(px(12.)).child(mailbox.email.clone())),
                ),
            None => Button::new("mailbox-filter")
                .ghost()
                .small()
                .size(px(28.))
                .icon(menu_icon("at").size(px(16.)))
                .tooltip(t("Mailbox", "Mailbox")),
        };
        trigger.dropdown_menu_with_anchor(Anchor::TopRight, move |menu, _, _| {
            let pick = |id: String| {
                let this = this.clone();
                move |_: &ClickEvent, _: &mut Window, cx: &mut App| {
                    let _ = this.update(cx, |this, cx| this.filter_account(id.clone(), cx));
                }
            };
            let row = |dots: Vec<usize>, label: String| {
                PopupMenuItem::element(move |_, _| {
                    div()
                        .flex()
                        .items_center()
                        .gap(px(10.))
                        .text_size(px(13.))
                        .child(
                            // Every mailbox's dot, a little overlapped: all of them, at a glance.
                            div().flex().flex_none().w(px(16.)).justify_center().children(
                                dots.iter().enumerate().map(|(index, color)| {
                                    div()
                                        .flex_none()
                                        .size(px(8.))
                                        .rounded_full()
                                        .bg(theme::account(*color))
                                        .when(index > 0, |el| el.ml(px(-4.)))
                                }),
                            ),
                        )
                        .child(div().flex_1().min_w_0().truncate().child(label.clone()))
                })
            };
            let mut menu = menu
                .min_w(px(256.))
                .max_w(px(256.))
                .item(PopupMenuItem::label(t("Show mail from", "Mail tonen van")))
                .item(
                    row(
                        mailboxes.iter().take(3).map(|mailbox| mailbox.color).collect(),
                        t("All mailboxes", "Alle mailboxen").to_string(),
                    )
                    .checked(filter.is_empty())
                    .on_click(pick(String::new())),
                )
                .separator();
            for mailbox in &mailboxes {
                menu = menu.item(
                    row(vec![mailbox.color], mailbox.email.clone())
                        .checked(mailbox.id == filter)
                        .on_click(pick(mailbox.id.clone())),
                );
            }
            menu
        })
    }

    /// Empties the trash for good, in the mailboxes that allow it; Gmail
    /// empties its own (components/empty-trash.tsx).
    fn render_empty_trash(&self, cx: &mut Context<Self>) -> Option<Stateful<Div>> {
        if !self.mailboxes.iter().any(|mailbox| mailbox.active() && mailbox.can_delete_forever()) {
            return None;
        }
        if self.emptying_trash {
            return Some(div().id("emptying-trash").flex().items_center().justify_center().size(px(28.)).child(ui::spinner()));
        }
        Some(
            div()
                .id("empty-trash")
                .group("empty-trash")
                .flex()
                .flex_none()
                .items_center()
                .justify_center()
                .size(px(28.))
                .cursor_pointer()
                .child(
                    theme::hi("delete-04")
                        .text_color(theme::muted())
                        .group_hover("empty-trash", |el| el.text_color(theme::danger())),
                )
                .tooltip(ui::tip(t("Empty trash", "Prullenbak legen")))
                .on_click(cx.listener(|this, _, window, cx| this.confirm(Confirm::EmptyTrash, window, cx))),
        )
    }

    /// One page per call, so each stays well inside the API's time limit.
    pub(super) fn empty_trash(&mut self, cx: &mut Context<Self>) {
        let ids: Vec<String> = self
            .mailboxes
            .iter()
            .filter(|mailbox| mailbox.active() && mailbox.can_delete_forever())
            .map(|mailbox| mailbox.id.clone())
            .collect();
        self.emptying_trash = true;
        self.fetch(
            cx,
            move |client| {
                let mut deleted = 0;
                for id in &ids {
                    loop {
                        let (count, done) = api::empty_trash(client, id)?;
                        deleted += count;
                        if done {
                            break;
                        }
                    }
                }
                Ok(deleted)
            },
            |this, result, cx| {
                this.emptying_trash = false;
                match result {
                    Ok(count) => {
                        this.toast(
                            t(format!("{count} deleted for good"), format!("{count} definitief verwijderd")),
                            ToastKind::Success,
                            None,
                            false,
                            cx,
                        );
                    }
                    Err(error) => this.toast_error(error, cx),
                }
                this.load(true, cx);
            },
        );
        cx.notify();
    }

    /// The folder's conversations, or why there are none.
    fn render_threads(&mut self, cx: &mut Context<Self>) -> AnyElement {
        if self.loading_accounts || (!self.list_ready && !self.list_failed) {
            return skeleton(true).into_any_element();
        }
        if self.mailboxes.is_empty() {
            // `Empty` with a way to connect the first mailbox.
            return div()
                .flex()
                .flex_col()
                .size_full()
                .items_center()
                .justify_center()
                .gap(px(16.))
                .p(px(24.))
                .text_center()
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .items_center()
                        .gap(px(8.))
                        .child(
                            div()
                                .text_size(px(14.))
                                .font_weight(FontWeight::MEDIUM)
                                .child(t("No mailboxes yet", "Nog geen mailboxen")),
                        )
                        .child(div().text_size(px(14.)).text_color(theme::muted()).child(t(
                            "Connect a mailbox to see your mail here.",
                            "Koppel een mailbox om je mail hier te zien.",
                        ))),
                )
                .child(
                    ui::button("connect", t("Connect a mailbox", "Mailbox koppelen"), ui::Variant::Primary)
                        .on_click(cx.listener(|this, _, _, cx| this.open_settings(Some("mailboxes"), cx))),
                )
                .into_any_element();
        }
        let folder = self.view.folder();
        if self.list_failed {
            return failed(
                if folder.is_some() {
                    t("This folder couldn't be loaded.", "Deze map kon niet worden geladen.")
                } else {
                    t("Your messages couldn't be loaded.", "Je berichten konden niet worden geladen.")
                },
                false,
            )
            .into_any_element();
        }
        if self.rows.is_empty() {
            return match folder {
                Some(folder) => list_empty(folder_place(folder).icon(), t("Nothing here", "Hier staat niets"), None)
                    .into_any_element(),
                None if self.sync == SyncStatus::Syncing => {
                    note(t("Fetching your mail…", "Je mail ophalen…"), false).into_any_element()
                }
                None => list_empty(
                    "inbox",
                    t("No messages", "Geen berichten"),
                    Some(
                        t(
                            "Nothing arrived in the last 90 days.",
                            "Er is de afgelopen 90 dagen niets binnengekomen.",
                        )
                        .into(),
                    ),
                )
                .into_any_element(),
            };
        }
        let mut sizes = (*self.row_sizes).clone();
        if self.cursor.is_some() {
            sizes.push(size(px(0.), px(LOAD_MORE)));
        }
        v_virtual_list(cx.entity(), "threads", Rc::new(sizes), Self::render_rows)
            .track_scroll(&self.scroll)
            .size_full()
            .into_any_element()
    }

    fn render_rows(&mut self, range: Range<usize>, _: &mut Window, cx: &mut Context<Self>) -> Vec<AnyElement> {
        // The end of what is loaded is in view: fetch the next page (`LoadMore`).
        if range.end + 10 >= self.rows.len() {
            self.load(false, cx);
        }
        let several = self.filter.is_empty() && self.mailboxes.len() > 1;
        let folder = self.view.folder();
        let selecting = !self.picked.is_empty() && !self.selection().is_empty();
        let top = self.returned_count + self.pinned_count;
        let divider = (self.pinned_count > 0 && top < self.rows.len()).then(|| top - 1);
        range
            .map(|index| {
                let Some(thread) = self.rows.get(index) else {
                    // Past the last row: the marker of the next page.
                    return div()
                        .flex()
                        .h(px(LOAD_MORE))
                        .items_center()
                        .justify_center()
                        .when(self.loading, |el| el.child(ui::spinner()))
                        .into_any_element();
                };
                let mailbox = self.mailbox(&thread.account_id);
                let state = RowState {
                    index,
                    open: self.open_id() == Some(thread.id.as_str()),
                    checked: self.picked.contains(&thread.id),
                    selecting,
                    folder,
                    color: several.then(|| mailbox.map(|mailbox| mailbox.color)).flatten(),
                    can_delete: mailbox.is_some_and(Mailbox::can_delete_forever),
                    returned: index < self.returned_count,
                    pinned: index >= self.returned_count && index < top,
                    can_pin: self.can_pin(thread),
                    divider: divider == Some(index),
                };
                thread_row(thread, state, cx).into_any_element()
            })
            .collect()
    }
}

struct RowState {
    index: usize,
    open: bool,
    checked: bool,
    /// Something in the list is selected, so every checkbox shows.
    selecting: bool,
    folder: Option<MailFolder>,
    /// Only set when several mailboxes share the list.
    color: Option<usize>,
    can_delete: bool,
    /// Back from snooze, which is why it sits on top.
    returned: bool,
    pinned: bool,
    can_pin: bool,
    /// A quiet line below it, between what is pinned and the rest of the inbox.
    divider: bool,
}

/// One conversation (`ThreadRow`).
fn thread_row(thread: &Thread, state: RowState, cx: &mut Context<MailView>) -> impl IntoElement {
    let unread = !thread.is_read;
    let index = state.index;
    let who = match &thread.to {
        Some(to) => {
            let names = to.iter().map(|address| address.label()).collect::<Vec<_>>().join(", ");
            let names = if names.is_empty() { "—".to_string() } else { names };
            t(format!("To: {names}"), format!("Aan: {names}"))
        }
        None => sender_name(thread),
    };
    // The number of messages follows the name, quieter.
    let (who, count) = if thread.message_count > 1 {
        let start = who.len();
        let text = format!("{who} {}", thread.message_count);
        let end = text.len();
        (text, Some(start..end))
    } else {
        (who, None)
    };
    let who = StyledText::new(who).with_highlights(count.into_iter().map(|range| {
        (
            range,
            HighlightStyle {
                color: Some(theme::muted().into()),
                font_weight: Some(FontWeight::NORMAL),
                ..Default::default()
            },
        )
    }));
    let subject = subject_of(thread);
    let line = if thread.snippet.is_empty() {
        subject.clone()
    } else {
        format!("{subject} · {}", thread.snippet)
    };
    let line = StyledText::new(line).with_highlights(unread.then(|| {
        (
            0..subject.len(),
            HighlightStyle {
                color: Some(theme::foreground().into()),
                font_weight: Some(FontWeight::MEDIUM),
                ..Default::default()
            },
        )
    }));
    // What the quick actions cover: the date and the small icons beside it.
    let mark = |icon: &str, color: Rgba| {
        theme::hi(icon)
            .size(px(14.))
            .text_color(color)
            .group_hover("row", |el| el.invisible())
    };

    let id = thread.id.clone();
    let opened = thread.clone();
    let button = row_button(("thread", index), state.open, state.checked)
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(8.))
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .truncate()
                        .when(unread, |el| el.font_weight(FontWeight::SEMIBOLD))
                        .when(!unread, |el| el.text_color(theme::muted()))
                        .child(who),
                )
                .when(state.pinned, |el| el.child(mark("pin", theme::primary_mark())))
                .when(state.returned, |el| el.child(mark("alarm-clock", theme::primary_mark())))
                .when(thread.is_starred, |el| el.child(mark("star-filled", amber())))
                .when(thread.has_attachments, |el| el.child(mark("attachment-01", theme::muted())))
                .child(
                    div()
                        .flex_none()
                        .text_size(px(12.))
                        .text_color(theme::muted())
                        .group_hover("row", |el| el.invisible())
                        .child(format::short_date(thread.received_at)),
                ),
        )
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(8.))
                .child(div().flex_1().min_w_0().truncate().text_color(theme::muted()).child(line))
                .when_some(state.color, |el, color| {
                    el.child(div().flex_none().mr(px(2.)).size(px(8.)).rounded_full().bg(theme::account(color)))
                }),
        )
        .on_click(cx.listener(move |this, event: &ClickEvent, _, cx| {
            // Cmd or Ctrl adds to the selection and Shift takes a range, as in a file list.
            let modifiers = event.modifiers();
            if modifiers.platform || modifiers.control || modifiers.shift {
                this.toggle(&id, modifiers.shift, cx);
            } else {
                this.open_thread(opened.clone(), cx);
            }
        }));

    // The gutter shows unread mail, and a checkbox on hover or while selecting.
    let always = state.checked || state.selecting;
    let id = thread.id.clone();
    let gutter = div()
        .absolute()
        .top(px(10.))
        .left(px(10.))
        .flex()
        .size(px(16.))
        .items_center()
        .justify_center()
        .when(unread && !always, |el| {
            el.child(
                div()
                    .absolute()
                    .size(px(6.))
                    .rounded_full()
                    .bg(theme::primary_mark())
                    .group_hover("row", |el| el.invisible()),
            )
        })
        .child(
            checkbox(("check", index), Some(state.checked))
                .when(!always, |el| el.invisible().group_hover("row", |el| el.visible()))
                .on_click(cx.listener(move |this, event: &ClickEvent, _, cx| {
                    cx.stop_propagation();
                    this.toggle(&id, event.modifiers().shift, cx);
                })),
        );

    let mut actions = Vec::new();
    if state.can_pin {
        let pinned = state.pinned;
        let target = thread.clone();
        actions.push(RowAction::new(
            if pinned { "pin-off" } else { "pin" },
            if pinned { t("Unpin", "Losmaken") } else { t("Pin to top", "Bovenaan vastpinnen") },
            move |this, _, cx| this.set_pinned(target.clone(), !pinned, cx),
        ));
    }
    let id = thread.id.clone();
    let starred = thread.is_starred;
    let mut star = RowAction::new(
        "star",
        if starred { t("Remove star", "Ster verwijderen") } else { t("Star", "Ster toevoegen") },
        move |this, _, cx| {
            this.act_on(id.clone(), if starred { ThreadAction::Unstar } else { ThreadAction::Star }, cx)
        },
    );
    star.starred = starred;
    actions.push(star);
    for action in move_actions(state.folder, state.can_delete) {
        let id = thread.id.clone();
        actions.push(
            RowAction::new(move_icon(action), move_label(action, state.folder), move |this, _, cx| {
                this.act_on(id.clone(), action, cx)
            })
            .destructive(is_destructive(action)),
        );
    }

    let hovered = thread.id.clone();
    div().px(px(8.)).child(
        div()
            .id(("row", index))
            .group("row")
            .relative()
            // The pointer entered or left the row; Space then selects it.
            .on_hover(cx.listener(move |this, hovering: &bool, _, _| {
                if *hovering {
                    this.hovered = Some(hovered.clone());
                } else if this.hovered.as_deref() == Some(hovered.as_str()) {
                    this.hovered = None;
                }
            }))
            .child(button)
            .child(gutter)
            .child(row_actions(index, actions, cx))
            .when(state.divider, |el| {
                el.child(
                    div()
                        .mx(px(10.))
                        .mt(px(6.))
                        .mb(px(4.))
                        .h(px(1.))
                        .bg(theme::border()),
                )
            }),
    )
}
