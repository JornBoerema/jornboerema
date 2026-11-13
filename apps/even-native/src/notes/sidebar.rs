//! The sidebar (the `<aside>` of components/workspace-app.tsx, with
//! packages/ui/src/styles/sidebar.css): the overview, the notes in their
//! order, and the workspace at the bottom (components/workspace-switcher.tsx).
//! In the desktop app it never folds away and its menu holds only workspaces:
//! the rail has the settings.

use gpui_kit::prelude::*;
use gpui_kit::*;

use crate::i18n::t;
use crate::{theme, ui};

use super::{parts, Menu, Nav, NotesApp};

/// A note on its way to another place in the sidebar; what is drawn under the pointer.
#[derive(Clone)]
struct DraggedNote {
    id: String,
    name: SharedString,
}

impl Render for DraggedNote {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        // `.sidebar-sortable-item`: the row keeps the sidebar's background while it moves.
        ui::list_link("dragged-note", "note-01", self.name.clone(), false)
            .w(px(216.))
            .bg(theme::sidebar())
            .border_1()
            .border_color(theme::border())
            .shadow_md()
            .font_family(theme::FONT)
            .text_color(theme::foreground())
    }
}

/// `.workspace-avatar`: the workspace's first letter on the brand colour.
fn avatar(name: &str, small: bool) -> Div {
    let letter: String = name.trim().chars().next().into_iter().flat_map(char::to_uppercase).collect();
    div()
        .flex()
        .flex_none()
        .items_center()
        .justify_center()
        .size(px(if small { 20. } else { 24. }))
        .rounded(px(if small { 6. } else { 7. }))
        .bg(theme::primary())
        .text_color(theme::primary_foreground())
        .text_size(px(if small { 11. } else { 12. }))
        .font_weight(FontWeight(650.))
        .child(letter)
}

impl NotesApp {
    pub(super) fn render_sidebar(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let disabled = self.disabled();
        let new_note = t("New note", "Nieuwe notitie");
        let can_sort = !disabled && self.view.len() > 1;

        let notes = self.view.iter().map(|note| {
            let selected = self.selected.as_ref() == Some(&note.id);
            let (id, target) = (note.id.clone(), note.id.clone());
            ui::list_link(
                SharedString::from(format!("note-{}", note.id)),
                "note-01",
                note.name.clone(),
                selected,
            )
            .on_click(cx.listener(move |this, _, window, cx| this.go(Nav::Note(id.clone()), window, cx)))
            .when(can_sort, |el| {
                el.on_drag(
                    DraggedNote {
                        id: note.id.clone(),
                        name: note.name.clone().into(),
                    },
                    |dragged, _, _, cx| cx.new(|_| dragged.clone()),
                )
                .drag_over::<DraggedNote>(|style, _, _, _| style.bg(theme::muted_bg()))
                .on_drop(cx.listener(move |this, dragged: &DraggedNote, window, cx| {
                    this.drop_note(&dragged.id, &target, window, cx)
                }))
            })
        });

        let section = div()
            .group("notes-section")
            .flex()
            .flex_col()
            .flex_none()
            .min_w_0()
            .child(
                ui::sidebar_heading(t("Notes", "Notities")).child(
                    // `.sidebar-add`: shows while the pointer is over the section.
                    ui::icon_button("add-note", "add-01")
                        .opacity(0.)
                        .group_hover("notes-section", |el| el.opacity(if disabled { 0.5 } else { 1. }))
                        .tooltip(ui::tip(new_note))
                        .when(!disabled, |el| {
                            el.on_click(cx.listener(|this, _, window, cx| this.open_new_note(window, cx)))
                        }),
                ),
            )
            .child(div().flex().flex_col().gap(px(2.)).children(notes))
            .when(self.view.is_empty(), |el| {
                // `.list-link.is-ghost`: with no notes yet, the way to the first one.
                el.child(
                    ui::list_row("first-note", false)
                        .text_color(theme::muted())
                        .child(theme::hi("add-01").text_color(theme::muted()))
                        .child(new_note)
                        .when(disabled, ui::disabled)
                        .when(!disabled, |el| {
                            el.hover(|el| el.text_color(theme::foreground()))
                                .on_click(cx.listener(|this, _, window, cx| this.open_new_note(window, cx)))
                        }),
                )
            });

        let navigation = div()
            .id("notes-navigation")
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .gap(px(18.))
            .overflow_y_scroll()
            .child(
                ui::list_link(
                    "overview",
                    "home-01",
                    t("Overview", "Overzicht"),
                    self.selected.is_none(),
                )
                .on_click(cx.listener(|this, _, window, cx| this.go(Nav::Overview, window, cx))),
            )
            .child(section);

        // The stage's column is 260 wide; the panel starts 4 past the rail
        // (apps/desktop/src/desktop.css) and keeps 8 around it otherwise.
        div()
            .w(px(260.))
            .h_full()
            .flex_none()
            .pl(px(4.))
            .py(px(8.))
            .child(
                ui::list_sidebar()
                    .h_full()
                    .child(div().flex_none().pl(px(10.)).pb(px(22.)).child(parts::brand()))
                    .child(navigation)
                    .children(self.render_switcher(cx)),
            )
    }

    /// `.sidebar-footer`: the open workspace, and the menu to another one.
    fn render_switcher(&self, cx: &mut Context<Self>) -> Option<impl IntoElement> {
        let active = self.active_workspace()?;
        let open = self.menu == Some(Menu::Workspaces);
        let button = div()
            .id("workspace-switcher")
            .flex()
            .items_center()
            .gap(px(10.))
            .w_full()
            .px(px(10.))
            .py(px(8.))
            .rounded(theme::RADIUS)
            .text_size(px(14.))
            .font_weight(FontWeight(550.))
            .cursor_pointer()
            .hover(|el| el.bg(theme::muted_bg()))
            .when(open, |el| el.bg(theme::muted_bg()))
            .child(avatar(&active.name, false))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .child(div().truncate().child(active.name.clone()))
                    .child(
                        div()
                            .truncate()
                            .text_size(px(12.))
                            .font_weight(FontWeight::NORMAL)
                            .text_color(theme::muted())
                            .child(self.user.name.clone()),
                    ),
            )
            .child(theme::hi("unfold-more").text_color(theme::muted()))
            .on_click(cx.listener(|this, _, _, cx| this.toggle_menu(Menu::Workspaces, cx)));
        Some(
            div().flex_none().pt(px(12.)).child(
                div()
                    .relative()
                    .child(button)
                    .when(open, |el| el.child(self.render_workspaces(cx))),
            ),
        )
    }

    /// The menu above the switcher: every workspace, and a new one.
    fn render_workspaces(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let rows = self.workspaces.iter().map(|workspace| {
            let id = workspace.id.clone();
            let members = workspace.member_count;
            parts::menu_item(SharedString::from(format!("workspace-{}", workspace.id)), false)
                .child(avatar(&workspace.name, true))
                .child(div().flex_1().min_w_0().truncate().child(workspace.name.clone()))
                .when(members > 1, |el| {
                    el.child(
                        div()
                            .flex_none()
                            .text_size(px(12.))
                            .text_color(theme::muted())
                            .child(t(format!("{members} members"), format!("{members} leden"))),
                    )
                })
                .when(self.active.as_ref() == Some(&workspace.id), |el| {
                    el.child(theme::hi("tick-02").text_color(theme::muted()))
                })
                .on_click(cx.listener(move |this, _, window, cx| this.select_workspace(id.clone(), window, cx)))
        });
        // `side="top" align="start" sideOffset={6}`, at least as wide as the switcher.
        deferred(
            div()
                .absolute()
                .left_0()
                .bottom(relative(1.))
                .pb(px(6.))
                .min_w_full()
                .occlude()
                .on_mouse_down_out(cx.listener(|this, _, _, cx| this.close_menu(cx)))
                .child(
                    parts::menu_panel()
                        .child(parts::menu_label("Workspaces"))
                        .children(rows)
                        .child(
                            parts::menu_item("new-workspace", false)
                                .child(theme::hi("add-01").text_color(theme::muted()))
                                .child(
                                    div()
                                        .whitespace_nowrap()
                                        .child(t("New workspace", "Nieuwe workspace")),
                                )
                                .on_click(cx.listener(|this, _, window, cx| this.open_new_workspace(window, cx))),
                        ),
                ),
        )
        .with_priority(1)
    }
}
