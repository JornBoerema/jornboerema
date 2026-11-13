//! The sidebar (apps/mail-web/src/components/sidebar.tsx, with the classes of
//! packages/ui/src/styles/sidebar.css and mail.css): New message, the places
//! in the order the user arranged them, More, the mailboxes. Collapsed (⌘B) it
//! is a narrow strip of the same places as icons. As inside the desktop app:
//! no collapse button and no account menu; the rail's settings button and the
//! account page do that. Arranging it is components/sidebar-editor.tsx.

use crate::ui;

use super::places::{Layout, Place};
use super::*;

/// The window's column for the sidebar (`.desktop-stage .workspace-shell`),
/// and for its strip of icons (`.mail-shell.sidebar-collapsed`).
pub(crate) const COLUMN: f32 = 260.;
const COLUMN_COLLAPSED: f32 = 56.;

/// A place being dragged to another spot while the sidebar is arranged.
#[derive(Clone)]
struct DraggedPlace {
    place: Place,
}

impl Render for DraggedPlace {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        ui::list_link("dragged", self.place.icon(), self.place.label(), false)
            .w(px(216.))
            .bg(theme::sidebar())
            .border_1()
            .border_color(theme::border())
            .shadow_lg()
    }
}

/// A row in the editor's one list: a place, or where More or Hidden starts.
#[derive(Clone, Copy, PartialEq, Eq)]
enum EditorRow {
    Place(Place),
    More,
    Hidden,
}

fn rows_of(layout: &Layout) -> Vec<EditorRow> {
    let places = |list: &[Place]| list.iter().copied().map(EditorRow::Place).collect::<Vec<_>>();
    let mut rows = places(&layout.main);
    rows.push(EditorRow::More);
    rows.extend(places(&layout.more));
    rows.push(EditorRow::Hidden);
    rows.extend(places(&layout.hidden));
    rows
}

/// The layout a list of rows stands for, or none when it isn't one: Hidden
/// before More, or the inbox hidden (it is always a way home).
fn layout_of(rows: &[EditorRow]) -> Option<Layout> {
    let more = rows.iter().position(|row| *row == EditorRow::More)?;
    let hidden = rows.iter().position(|row| *row == EditorRow::Hidden)?;
    if more > hidden {
        return None;
    }
    let places = |rows: &[EditorRow]| {
        rows.iter()
            .filter_map(|row| match row {
                EditorRow::Place(place) => Some(*place),
                _ => None,
            })
            .collect::<Vec<_>>()
    };
    let layout = Layout {
        main: places(&rows[..more]),
        more: places(&rows[more + 1..hidden]),
        hidden: places(&rows[hidden + 1..]),
    };
    (!layout.hidden.contains(&Place::Inbox)).then_some(layout)
}

/// One place as the sidebar draws it (`Place` in sidebar.tsx).
struct Shown {
    place: Place,
    selected: bool,
    count: Option<String>,
    /// A dot on the rail icon, for unread mail.
    badge: bool,
}

impl MailView {
    /// A place as it shows now, or none when it is turned off as a feature or
    /// empty where empty means nothing to show.
    fn shown(&self, place: Place) -> Option<Shown> {
        let view = (!self.composing()).then_some(self.view);
        let here = view == Some(place.view());
        let snoozed = self.snoozes.data.as_ref().map_or(0, |snoozes| snoozes.snoozed.len());
        let scheduled = self.scheduled.data.as_ref().map_or(0, Vec::len);
        let drafts = self.drafts.data.as_ref().map_or(0, |drafts| drafts.drafts.len());
        let unread = self.unread.as_ref().map_or(0, |unread| unread.count);
        let (visible, selected, count, badge) = match place {
            Place::Inbox => (
                true,
                here && self.filter.is_empty(),
                (unread > 0).then(|| format::number(unread)),
                unread > 0,
            ),
            Place::Parcels => (Feature::Parcels.on(), here, None, false),
            Place::Invoices => (Feature::Invoices.on(), here, None, false),
            Place::Senders => (Feature::Senders.on(), here, None, false),
            // Snoozed and Scheduled only when there is something in them, or they are open.
            Place::Snoozed => (snoozed > 0 || here, here, Some(snoozed.to_string()), false),
            Place::Scheduled => (scheduled > 0 || here, here, Some(scheduled.to_string()), false),
            Place::Drafts => (true, here, (drafts > 0).then(|| drafts.to_string()), false),
            _ => (true, here, None, false),
        };
        visible.then_some(Shown {
            place,
            selected,
            count,
            badge,
        })
    }

    fn place_link(&self, shown: &Shown, cx: &mut Context<Self>) -> Stateful<Div> {
        let place = shown.place;
        ui::list_link(("place", place as usize), place.icon(), place.label(), shown.selected)
            .when_some(shown.count.clone(), |el, count| el.child(ui::list_count(count)))
            .on_click(cx.listener(move |this, _, _, cx| this.select_view(place.view(), cx)))
    }

    pub(super) fn render_sidebar(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let collapsed = self.collapsed && self.editor.is_none();
        let panel = if collapsed {
            self.render_rail(cx).into_any_element()
        } else {
            self.render_full(cx).into_any_element()
        };
        div()
            .flex_none()
            .h_full()
            .w(px(if collapsed { COLUMN_COLLAPSED } else { COLUMN }))
            // `.list-sidebar`'s margin; the rail holds most of the left one.
            .pt(px(8.))
            .pb(px(8.))
            .pl(px(4.))
            .child(panel)
    }

    fn render_full(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        let composing = self.composing();
        let compose = ui::list_link(
            "compose",
            "pencil-edit-02",
            t("New message", "Nieuw bericht"),
            composing,
        )
        .mb(px(12.))
        // `.nav-kbd`.
        .child(
            div()
                .ml_auto()
                .text_size(px(11.))
                .text_color(theme::muted())
                .opacity(0.8)
                .child("C"),
        )
        .on_click(cx.listener(|this, _, window, cx| this.compose(window, cx)));

        let places: Vec<AnyElement> = match &self.editor {
            Some(draft) => self.render_editor(draft, cx),
            None => {
                let mut rows: Vec<AnyElement> = self
                    .layout
                    .main
                    .iter()
                    .filter_map(|place| self.shown(*place))
                    .map(|shown| self.place_link(&shown, cx).into_any_element())
                    .collect();
                rows.extend(self.render_more(cx));
                rows
            }
        };

        let mailboxes = self.mailboxes.iter().enumerate().map(|(index, mailbox)| {
            let selected = !composing && self.view == View::Inbox && mailbox.id == self.filter;
            let id = mailbox.id.clone();
            let active = mailbox.active();
            ui::list_row(("mailbox", index), selected)
                .child(if active {
                    div()
                        .flex()
                        .flex_none()
                        .items_center()
                        .justify_center()
                        .size(px(16.))
                        .child(div().size(px(10.)).rounded_full().bg(theme::account(mailbox.color)))
                        .into_any_element()
                } else {
                    theme::hi("alert-02").text_color(theme::muted()).into_any_element()
                })
                .child(div().flex_1().min_w_0().truncate().child(mailbox.email.clone()))
                .when(!active, |el| el.tooltip(ui::tip(t("Access has ended", "Toegang verlopen"))))
                .on_click(cx.listener(move |this, _, _, cx| this.select_account(id.clone(), cx)))
        });

        ui::floating_panel()
            .size_full()
            .flex()
            .flex_col()
            .gap(px(8.))
            .pt(px(22.))
            .px(px(16.))
            .pb(px(16.))
            // `.sidebar-brand-row`.
            .child(
                div().flex().flex_none().items_center().pl(px(10.)).pb(px(22.)).child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(10.))
                        .text_size(px(20.))
                        .font_weight(FontWeight(650.))
                        .child(theme::hi("mail-01").size(px(20.)).text_color(theme::primary_mark()))
                        .child(
                            div()
                                .flex()
                                .child("Even mailen")
                                .child(div().text_color(theme::primary_mark()).child(".")),
                        ),
                ),
            )
            // `.list-navigation.sidebar-sections`.
            .child(
                div()
                    .id("mail-navigation")
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_h_0()
                    .gap(px(18.))
                    .overflow_y_scroll()
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .flex_none()
                            .gap(px(2.))
                            .child(compose)
                            .children(places),
                    )
                    .child(
                        div()
                            .group("mailboxes")
                            .flex()
                            .flex_col()
                            .flex_none()
                            .child(
                                ui::sidebar_heading(t("Mailboxes", "Mailboxen")).child(
                                    // The add button appears on hover so the heading stays calm.
                                    ui::icon_button("connect-mailbox", "add-01")
                                        .opacity(0.)
                                        .group_hover("mailboxes", |el| el.opacity(1.))
                                        .tooltip(ui::tip(t("Connect a mailbox", "Mailbox koppelen")))
                                        .on_click(cx.listener(|this, _, _, cx| this.open_settings(Some("mailboxes"), cx))),
                                ),
                            )
                            .child(div().flex().flex_col().gap(px(2.)).children(mailboxes)),
                    ),
            )
    }

    /// The places tucked under More, out of the way until asked for, and the
    /// way to arrange them all (`MorePlaces`).
    fn render_more(&self, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let places: Vec<Shown> = self.layout.more.iter().filter_map(|place| self.shown(*place)).collect();
        // Being in one of them keeps the group open, so the current place stays in sight.
        let open = self.more_open || places.iter().any(|shown| shown.selected);
        let toggle = ghost_row("more")
            .min_h(px(28.))
            .py(px(4.))
            .text_size(px(13.))
            .hover(|el| el.bg(theme::muted_bg()).text_color(theme::foreground()))
            .child(
                theme::hi(if open { "arrow-down-01" } else { "arrow-right-01" })
                    .size(px(14.))
                    .mx(px(1.))
                    .text_color(theme::muted()),
            )
            .child(t("More", "Meer"))
            .on_click(cx.listener(move |this, _, _, cx| {
                this.more_open = !open;
                settings::set_more_open(this.more_open);
                cx.notify();
            }));
        let mut rows = vec![toggle.into_any_element()];
        if open {
            rows.extend(places.iter().map(|shown| self.place_link(shown, cx).into_any_element()));
            rows.push(
                ghost_row("customize")
                    .hover(|el| el.bg(theme::muted_bg()).text_color(theme::foreground()))
                    .child(theme::hi("drag-drop-vertical").text_color(theme::muted()))
                    .child(div().flex_1().min_w_0().truncate().child(t("Arrange sidebar", "Sidebar indelen")))
                .on_click(cx.listener(|this, _, _, cx| this.customize_sidebar(cx)))
                .into_any_element(),
            );
        }
        rows
    }

    /// Starts arranging the sidebar in place; a collapsed one opens for it.
    pub(crate) fn customize_sidebar(&mut self, cx: &mut Context<Self>) {
        self.editor = Some(self.layout.clone());
        cx.notify();
    }

    /// The sidebar while it is being arranged: every place in one list to
    /// drag, More and Hidden as the breaks between, an eye on each to hide or
    /// show it. Nothing changes until it is saved from the bar at the bottom.
    fn render_editor(&self, draft: &Layout, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let rows = rows_of(draft);
        rows.iter()
            .enumerate()
            .map(|(index, row)| {
                let target = *row;
                let drop = cx.listener(move |this, dragged: &DraggedPlace, _, cx| {
                    this.editor_move(dragged.place, target, cx);
                });
                match *row {
                    EditorRow::More | EditorRow::Hidden => {
                        let more = *row == EditorRow::More;
                        ghost_row(("break", index))
                            .mt(px(8.))
                            .cursor_default()
                            .child(
                                theme::hi(if more { "arrow-down-01" } else { "view-off-slash" })
                                    .text_color(theme::muted()),
                            )
                            .child(if more { t("More", "Meer") } else { t("Hidden", "Verborgen") })
                        .drag_over::<DraggedPlace>(|el, _, _, _| el.bg(theme::muted_bg()))
                        .on_drop(drop)
                        .into_any_element()
                    }
                    EditorRow::Place(place) => {
                        let hidden = draft.hidden.contains(&place);
                        let label = place.label();
                        ui::list_row(("edit", place as usize), false)
                            .group("edit-row")
                            .cursor_grab()
                            .when(hidden, |el| el.text_color(theme::muted()))
                            .child(
                                theme::hi(place.icon())
                                    .text_color(theme::muted())
                                    .when(hidden, |el| el.opacity(0.5)),
                            )
                            .child(div().flex_1().min_w_0().truncate().child(label))
                            .when(place != Place::Inbox, |el| {
                                el.child(
                                    div()
                                        .id(("eye", place as usize))
                                        .flex()
                                        .flex_none()
                                        .items_center()
                                        .justify_center()
                                        .size(px(24.))
                                        .my(px(-4.))
                                        .mr(px(-6.))
                                        .rounded(theme::RADIUS_SM)
                                        .child(
                                            theme::hi(if hidden { "view" } else { "view-off-slash" })
                                                .size(px(14.))
                                                .text_color(theme::muted()),
                                        )
                                        .tooltip(ui::tip(if hidden {
                                            t(format!("Show {label}"), format!("{label} tonen"))
                                        } else {
                                            t(format!("Hide {label}"), format!("{label} verbergen"))
                                        }))
                                        .on_click(cx.listener(move |this, _, _, cx| {
                                            cx.stop_propagation();
                                            this.editor_toggle(place, cx);
                                        })),
                                )
                            })
                            .child(
                                theme::hi("drag-drop-vertical")
                                    .size(px(14.))
                                    .text_color(theme::muted())
                                    .opacity(0.)
                                    .group_hover("edit-row", |el| el.opacity(1.)),
                            )
                            .on_drag(DraggedPlace { place }, |dragged, _, _, cx| cx.new(|_| dragged.clone()))
                            .drag_over::<DraggedPlace>(|el, _, _, _| el.bg(theme::muted_bg()))
                            .on_drop(drop)
                            .into_any_element()
                    }
                }
            })
            .collect()
    }

    /// Drops a place on another row: it takes that row's spot (`arrayMove`).
    fn editor_move(&mut self, place: Place, onto: EditorRow, cx: &mut Context<Self>) {
        let Some(draft) = &self.editor else { return };
        let mut rows = rows_of(draft);
        let from = rows.iter().position(|row| *row == EditorRow::Place(place));
        let to = rows.iter().position(|row| *row == onto);
        let (Some(from), Some(to)) = (from, to) else { return };
        if from == to {
            return;
        }
        let row = rows.remove(from);
        rows.insert(to, row);
        if let Some(layout) = layout_of(&rows) {
            self.editor = Some(layout);
            cx.notify();
        }
    }

    /// Hiding goes to the end of Hidden; showing again goes back to the end of the sidebar.
    fn editor_toggle(&mut self, place: Place, cx: &mut Context<Self>) {
        let Some(draft) = &mut self.editor else { return };
        let hidden = draft.hidden.contains(&place);
        draft.main.retain(|item| *item != place);
        draft.more.retain(|item| *item != place);
        draft.hidden.retain(|item| *item != place);
        if hidden {
            draft.main.push(place);
        } else {
            draft.hidden.push(place);
        }
        cx.notify();
    }

    fn editor_save(&mut self, cx: &mut Context<Self>) {
        let Some(draft) = self.editor.take() else { return };
        if draft != self.layout {
            let saved = (draft != Layout::default()).then(|| draft.clone());
            settings::keep_sidebar_locally(saved.as_ref());
            self.layout = draft;
            self.fetch(
                cx,
                move |client| api::save_preferences(client, &serde_json::json!({ "sidebar": saved })),
                |this, result, cx| {
                    if let Err(error) = result {
                        this.toast_error(error, cx);
                    }
                },
            );
        }
        cx.notify();
    }

    /// Save and Cancel while the sidebar is arranged, in a bar at the bottom.
    pub(super) fn render_editor_bar(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let draft = self.editor.as_ref()?;
        let is_default = *draft == Layout::default();
        let bar = div()
            .flex()
            .items_center()
            .justify_between()
            .gap(px(12.))
            .w(px(560.))
            .max_w_full()
            .h(px(56.))
            .pl(px(16.))
            .pr(px(10.))
            .rounded(theme::RADIUS_XL)
            .border_1()
            .border_color(theme::border())
            .bg(theme::background())
            .shadow_sm()
            .occlude()
            .child(
                div()
                    .min_w_0()
                    .truncate()
                    .text_color(theme::muted())
                    .child(t("Drag to order · the eye hides", "Sleep om te ordenen · het oogje verbergt")),
            )
            .child(
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(px(6.))
                    .when(!is_default, |el| {
                        el.child(
                            ui::button("editor-reset", t("Default", "Standaard"), ui::Variant::Ghost).on_click(
                                cx.listener(|this, _, _, cx| {
                                    this.editor = Some(Layout::default());
                                    cx.notify();
                                }),
                            ),
                        )
                    })
                    .child(
                        ui::button("editor-cancel", t("Cancel", "Annuleren"), ui::Variant::Outline).on_click(
                            cx.listener(|this, _, _, cx| {
                                this.editor = None;
                                cx.notify();
                            }),
                        ),
                    )
                    .child(
                        ui::button("editor-save", t("Save", "Opslaan"), ui::Variant::Primary)
                            .on_click(cx.listener(|this, _, _, cx| this.editor_save(cx))),
                    ),
            );
        Some(
            div()
                .absolute()
                .left_0()
                .right_0()
                .bottom(px(24.))
                .px(px(16.))
                .flex()
                .justify_center()
                .child(bar)
                .into_any_element(),
        )
    }

    /// The collapsed sidebar: the same places as icons in a narrow strip, so
    /// nothing is more than a click away. The logo brings the full sidebar
    /// back (`SidebarRail`).
    fn render_rail(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        let composing = self.composing();
        let places = self
            .layout
            .main
            .iter()
            .chain(&self.layout.more)
            .filter_map(|place| self.shown(*place))
            .map(|shown| {
                let place = shown.place;
                let label = match (&shown.count, place) {
                    (Some(count), Place::Inbox) => {
                        t(format!("Inbox · {count} unread in your inbox"), format!("Inbox · {count} ongelezen in je inbox"))
                    }
                    (Some(count), Place::Drafts) => format!("{} · {count}", place.label()),
                    _ => place.label().to_string(),
                };
                rail_link(("rail", place as usize), shown.selected)
                    .child(theme::hi(place.icon()).text_color(if shown.selected {
                        theme::primary_mark()
                    } else {
                        theme::muted()
                    }))
                    .when(shown.badge, |el| {
                        el.child(
                            div()
                                .absolute()
                                .top(px(8.))
                                .right(px(8.))
                                .size(px(6.))
                                .rounded_full()
                                .bg(theme::primary_mark()),
                        )
                    })
                    .tooltip(ui::tip(label))
                    .on_click(cx.listener(move |this, _, _, cx| this.select_view(place.view(), cx)))
            })
            .collect::<Vec<_>>();
        let mailboxes = self
            .mailboxes
            .iter()
            .enumerate()
            .map(|(index, mailbox)| {
                let id = mailbox.id.clone();
                let selected = !composing && self.view == View::Inbox && mailbox.id == self.filter;
                let label = if mailbox.active() {
                    mailbox.email.clone()
                } else {
                    format!("{} · {}", mailbox.email, t("Access has ended", "Toegang verlopen"))
                };
                rail_link(("rail-mailbox", index), selected)
                    .child(if mailbox.active() {
                        div()
                            .size(px(10.))
                            .rounded_full()
                            .bg(theme::account(mailbox.color))
                            .into_any_element()
                    } else {
                        theme::hi("alert-02").text_color(theme::muted()).into_any_element()
                    })
                    .tooltip(ui::tip(label))
                    .on_click(cx.listener(move |this, _, _, cx| this.select_account(id.clone(), cx)))
            })
            .collect::<Vec<_>>();
        ui::floating_panel()
            .w(px(44.))
            .h_full()
            .flex()
            .flex_col()
            .items_center()
            .gap(px(4.))
            .pt(px(16.))
            .pb(px(12.))
            // `.rail-brand`: the logo turns into the expand control when pointed at.
            .child(
                rail_link("rail-brand", false)
                    .group("rail-brand")
                    .mb(px(14.))
                    .child(
                        theme::hi("mail-01")
                            .size(px(20.))
                            .text_color(theme::primary_mark())
                            .group_hover("rail-brand", |el| el.invisible()),
                    )
                    .child(
                        theme::hi("panel-left-close")
                            .absolute()
                            .text_color(theme::foreground())
                            .invisible()
                            .group_hover("rail-brand", |el| el.visible()),
                    )
                    .tooltip(ui::tip_with_hint(t("Expand sidebar", "Sidebar uitklappen"), "⌘B"))
                    .on_click(cx.listener(|this, _, _, cx| this.toggle_sidebar(cx))),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_none()
                    .items_center()
                    .gap(px(2.))
                    .child(
                        rail_link("rail-compose", composing)
                            .child(theme::hi("pencil-edit-02").text_color(if composing {
                                theme::primary_mark()
                            } else {
                                theme::muted()
                            }))
                            .tooltip(ui::tip_with_hint(t("New message", "Nieuw bericht"), "C"))
                            .on_click(cx.listener(|this, _, window, cx| this.compose(window, cx))),
                    )
                    .child(div().h(px(10.)))
                    .children(places),
            )
            // `.rail-mailboxes`.
            .child(
                div()
                    .id("rail-mailboxes")
                    .flex()
                    .flex_col()
                    .items_center()
                    .gap(px(2.))
                    .mt(px(14.))
                    .pt(px(14.))
                    .w_full()
                    .min_h_0()
                    .border_t_1()
                    .border_color(theme::border())
                    .overflow_y_scroll()
                    .children(mailboxes),
            )
    }
}

/// `.list-link.is-ghost`: a quieter row, such as a toggle. Its hover is the caller's.
fn ghost_row(id: impl Into<ElementId>) -> Stateful<Div> {
    div()
        .id(id)
        .flex()
        .flex_none()
        .items_center()
        .gap(px(10.))
        .w_full()
        .min_h(px(34.))
        .px(px(10.))
        .py(px(6.))
        .text_size(px(14.))
        .text_color(theme::muted())
        .rounded(theme::RADIUS)
        .cursor_pointer()
}

/// `.rail-link`: a square icon button in the collapsed sidebar.
fn rail_link(id: impl Into<ElementId>, selected: bool) -> Stateful<Div> {
    div()
        .id(id)
        .relative()
        .flex()
        .flex_none()
        .items_center()
        .justify_center()
        .size(px(36.))
        .rounded(theme::RADIUS)
        .cursor_pointer()
        .when(selected, |el| el.bg(theme::accent()))
        .when(!selected, |el| el.hover(|el| el.bg(theme::muted_bg())))
}

#[cfg(test)]
mod tests {
    use super::{layout_of, rows_of, EditorRow, Layout, Place};

    #[test]
    fn the_editor_list_is_the_layout_and_back() {
        let layout = Layout::default();
        let mut rows = rows_of(&layout);
        assert_eq!(layout_of(&rows), Some(layout));
        // Dropping Trash on Starred puts it there, in the main part.
        let from = rows.iter().position(|row| *row == EditorRow::Place(Place::Trash)).unwrap();
        let row = rows.remove(from);
        rows.insert(1, row);
        let moved = layout_of(&rows).unwrap();
        assert_eq!(moved.main[..3], [Place::Inbox, Place::Trash, Place::Starred]);
        assert_eq!(moved.more, [Place::Archive, Place::Spam]);
        // The inbox can't be hidden.
        let inbox = rows.remove(0);
        rows.push(inbox);
        assert_eq!(layout_of(&rows), None);
    }
}
