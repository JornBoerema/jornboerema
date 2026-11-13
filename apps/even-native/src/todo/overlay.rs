//! What floats above a screen: menus (packages/ui dropdown-menu.tsx) and
//! dialogs (dialog.tsx, alert-dialog.tsx). Both are plain state on `TodoApp`,
//! drawn after everything else, so the same code serves the app's screen and
//! its pages in the settings window.

use std::rc::Rc;
use std::time::{Duration, Instant};

use gpui_kit::component::input::Escape;

use super::*;

/// Which menu is open. What is in it is decided when it is drawn (menus.rs),
/// so a menu that stays open shows the change it just made.
#[derive(Clone, PartialEq, Eq, Debug)]
pub(super) enum MenuKind {
    Workspace,
    ListOptions,
    Task(String),
    Status(Target),
    Priority(Target),
    Project(Target),
    Assignees(Target),
    Filter,
    FilterProject,
    FilterAssignee,
    IssueOptions,
    // Settings
    StatusOptions(String),
    StatusColor(String),
    ProjectOptions(String),
    ProjectColor(String),
    EditingProjectColor,
    // The web's Selects
    ShareRole,
    InviteRole,
    MemberRole(String),
    Replacement,
}

/// Whose property a status, priority, project or assignee menu changes.
#[derive(Clone, PartialEq, Eq, Debug)]
pub(super) enum Target {
    Issue(String),
    /// The issue being written in the new issue dialog.
    Draft,
}

pub(super) struct OpenMenu {
    pub kind: MenuKind,
    /// The tracked name of the button it hangs from.
    pub anchor: SharedString,
    pub surface: Surface,
    /// A submenu beside it, and the row it opened from.
    pub sub: Option<(MenuKind, SharedString)>,
    pub highlight: Option<usize>,
    pub focus: FocusHandle,
    /// Where the keyboard was, to give it back.
    pub restore: Option<FocusHandle>,
}

pub(super) type Action = Rc<dyn Fn(&mut TodoApp, &mut Window, &mut Context<TodoApp>)>;

pub(super) struct Item {
    pub icon: Option<AnyElement>,
    /// A Hugeicon instead, drawn in the row's own colour.
    pub sign: Option<SharedString>,
    pub label: SharedString,
    /// Quiet words at the end ("3 members").
    pub hint: Option<SharedString>,
    /// `Some`: a radio or checkbox item, with its tick at the end when set.
    pub checked: Option<bool>,
    pub destructive: bool,
    pub disabled: bool,
    /// Stay open, so several can be picked in one go.
    pub keep_open: bool,
    /// Opens this submenu instead of doing something.
    pub sub: Option<MenuKind>,
    pub action: Option<Action>,
}

impl Item {
    pub fn new(label: impl Into<SharedString>, action: impl Fn(&mut TodoApp, &mut Window, &mut Context<TodoApp>) + 'static) -> Self {
        Self {
            icon: None,
            sign: None,
            label: label.into(),
            hint: None,
            checked: None,
            destructive: false,
            disabled: false,
            keep_open: false,
            sub: None,
            action: Some(Rc::new(action)),
        }
    }

    pub fn sub(label: impl Into<SharedString>, kind: MenuKind) -> Self {
        Self {
            icon: None,
            sign: None,
            label: label.into(),
            hint: None,
            checked: None,
            destructive: false,
            disabled: false,
            keep_open: true,
            sub: Some(kind),
            action: None,
        }
    }

    pub fn icon(mut self, icon: impl IntoElement) -> Self {
        self.icon = Some(icon.into_any_element());
        self
    }

    pub fn hi(mut self, name: &str) -> Self {
        self.sign = Some(SharedString::from(name.to_string()));
        self
    }

    pub fn hint(mut self, hint: impl Into<SharedString>) -> Self {
        self.hint = Some(hint.into());
        self
    }

    pub fn checked(mut self, checked: bool) -> Self {
        self.checked = Some(checked);
        self
    }

    pub fn destructive(mut self) -> Self {
        self.destructive = true;
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn keep_open(mut self) -> Self {
        self.keep_open = true;
        self
    }
}

pub(super) enum Entry {
    Label(SharedString),
    Separator,
    Item(Item),
    /// Something of its own, such as the grid of colours.
    Custom(AnyElement),
}

/// How a menu sits against its button, and how wide it is at least.
pub(super) struct Look {
    pub min_width: f32,
    /// Opens above the button (the workspace switcher, at the sidebar's foot).
    pub above: bool,
    /// Lines up with the button's right edge (the web's `align="end"`).
    pub end: bool,
    /// The board toolbar's smaller menus (`.board-menu`).
    pub compact: bool,
    /// At least as wide as its button (a select, the workspace switcher).
    pub fit: bool,
}

impl TodoApp {
    /// Opens the menu against its button; a second click on the button closes it.
    pub(super) fn open_menu(&mut self, kind: MenuKind, anchor: impl Into<SharedString>, window: &mut Window, cx: &mut Context<Self>) {
        let anchor: SharedString = anchor.into();
        let just_closed = self
            .menu_dismissed
            .take()
            .is_some_and(|(key, at)| key == anchor && at.elapsed() < Duration::from_millis(400));
        if just_closed {
            return;
        }
        let surface = if matches!(
            kind,
            MenuKind::StatusOptions(_)
                | MenuKind::StatusColor(_)
                | MenuKind::ProjectOptions(_)
                | MenuKind::ProjectColor(_)
                | MenuKind::EditingProjectColor
                | MenuKind::InviteRole
                | MenuKind::MemberRole(_)
                | MenuKind::Replacement
        ) {
            Surface::Settings
        } else {
            Surface::App
        };
        let focus = cx.focus_handle();
        let restore = window.focused(cx);
        window.focus(&focus, cx);
        self.menu = Some(OpenMenu {
            kind,
            anchor,
            surface,
            sub: None,
            highlight: None,
            focus,
            restore,
        });
        cx.notify();
    }

    pub(super) fn close_menu(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(menu) = self.menu.take() {
            if let Some(restore) = menu.restore {
                window.focus(&restore, cx);
            }
            cx.notify();
        }
    }

    /// A press outside the menu: it closes, and its own button won't reopen it on this click.
    fn dismiss_menu(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(menu) = &self.menu {
            self.menu_dismissed = Some((menu.anchor.clone(), Instant::now()));
        }
        self.close_menu(window, cx);
    }

    fn step_menu(&mut self, by: isize, window: &mut Window, cx: &mut Context<Self>) {
        let Some(menu) = &self.menu else { return };
        let kind = menu.sub.as_ref().map(|(kind, _)| kind.clone()).unwrap_or_else(|| menu.kind.clone());
        let entries = self.menu_entries(&kind, window, cx);
        let choices: Vec<usize> = entries
            .iter()
            .enumerate()
            .filter(|(_, entry)| matches!(entry, Entry::Item(item) if !item.disabled))
            .map(|(index, _)| index)
            .collect();
        if choices.is_empty() {
            return;
        }
        let Some(menu) = &mut self.menu else { return };
        let at = menu.highlight.and_then(|current| choices.iter().position(|index| *index == current));
        let next = match at {
            Some(at) => (at as isize + by).rem_euclid(choices.len() as isize) as usize,
            None if by > 0 => 0,
            None => choices.len() - 1,
        };
        menu.highlight = Some(choices[next]);
        cx.notify();
    }

    fn confirm_menu(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(menu) = &self.menu else { return };
        let Some(index) = menu.highlight else { return };
        let kind = menu.sub.as_ref().map(|(kind, _)| kind.clone()).unwrap_or_else(|| menu.kind.clone());
        let mut entries = self.menu_entries(&kind, window, cx);
        if index >= entries.len() {
            return;
        }
        if let Entry::Item(item) = entries.swap_remove(index) {
            self.pick(&item, index, window, cx);
        }
    }

    fn pick(&mut self, item: &Item, index: usize, window: &mut Window, cx: &mut Context<Self>) {
        if item.disabled {
            return;
        }
        if let Some(sub) = &item.sub {
            if let Some(menu) = &mut self.menu {
                menu.sub = Some((sub.clone(), SharedString::from(format!("menu-item-{index}"))));
                menu.highlight = None;
            }
            cx.notify();
            return;
        }
        if !item.keep_open {
            self.close_menu(window, cx);
        }
        if let Some(action) = item.action.clone() {
            action(self, window, cx);
        }
        cx.notify();
    }

    /// The open menu, if `surface` is where it belongs.
    pub(super) fn render_menu(&mut self, surface: Surface, window: &mut Window, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let Some(menu) = &self.menu else { return Vec::new() };
        if menu.surface != surface {
            return Vec::new();
        }
        let kind = menu.kind.clone();
        let anchor = menu.anchor.clone();
        let sub = menu.sub.clone();
        let focus = menu.focus.clone();
        let highlight = menu.highlight;
        let Some(bounds) = self.tracked.borrow().get(&anchor).copied() else {
            return Vec::new();
        };
        let look = self.menu_look(&kind);
        let entries = self.menu_entries(&kind, window, cx);
        let (position, corner) = match (look.above, look.end) {
            (true, _) => (point(bounds.left(), bounds.top() - px(6.)), Anchor::BottomLeft),
            (false, true) => (point(bounds.right(), bounds.bottom() + px(4.)), Anchor::TopRight),
            (false, false) => (point(bounds.left(), bounds.bottom() + px(4.)), Anchor::TopLeft),
        };
        let min_width = if look.fit { bounds.size.width.max(px(look.min_width)) } else { px(look.min_width) };
        let main_highlight = if sub.is_some() { None } else { highlight };
        let panel = self
            .menu_panel(entries, min_width, look.compact, main_highlight, false, cx)
            .key_context("TodoOverlay TodoMenu")
            .track_focus(&focus)
            .on_action(cx.listener(|this, _: &Dismiss, window, cx| this.close_menu(window, cx)))
            .on_action(cx.listener(|this, _: &MenuUp, window, cx| this.step_menu(-1, window, cx)))
            .on_action(cx.listener(|this, _: &MenuDown, window, cx| this.step_menu(1, window, cx)))
            .on_action(cx.listener(|this, _: &MenuConfirm, window, cx| this.confirm_menu(window, cx)));
        let mut layers = vec![deferred(
            anchored()
                .position(position)
                .anchor(corner)
                .snap_to_window_with_margin(px(8.))
                .child(panel.on_mouse_down_out(cx.listener(|this, _, window, cx| {
                    // The submenu is outside this panel too; it closes the menu itself.
                    if this.menu.as_ref().is_some_and(|menu| menu.sub.is_none()) {
                        this.dismiss_menu(window, cx);
                    }
                }))),
        )
        .with_priority(60)
        .into_any_element()];
        if let Some((sub_kind, row)) = sub {
            if let Some(row_bounds) = self.tracked.borrow().get(&row).copied() {
                let sub_look = self.menu_look(&sub_kind);
                let entries = self.menu_entries(&sub_kind, window, cx);
                let parent = self.tracked.borrow().get(&SharedString::from("menu-panel")).copied();
                let panel = self
                    .menu_panel(entries, px(sub_look.min_width), sub_look.compact, highlight, true, cx)
                    .on_mouse_down_out(cx.listener(move |this, event: &MouseDownEvent, window, cx| {
                        // A press on the parent menu keeps it; anywhere else closes both.
                        if parent.is_some_and(|parent| parent.contains(&event.position)) {
                            return;
                        }
                        this.dismiss_menu(window, cx);
                    }));
                layers.push(
                    deferred(
                        anchored()
                            .position(point(row_bounds.right() + px(6.), row_bounds.top() - px(4.)))
                            .anchor(Anchor::TopLeft)
                            .snap_to_window_with_margin(px(8.))
                            .child(panel),
                    )
                    .with_priority(61)
                    .into_any_element(),
                );
            }
        }
        layers
    }

    /// packages/ui dropdown-menu.tsx: the panel and its rows.
    fn menu_panel(
        &self,
        entries: Vec<Entry>,
        min_width: Pixels,
        compact: bool,
        highlight: Option<usize>,
        is_sub: bool,
        cx: &mut Context<Self>,
    ) -> Stateful<Div> {
        let text = if compact { 12.5 } else { 14. };
        let mut panel = div()
            .id(if is_sub { "todo-submenu" } else { "todo-menu" })
            .occlude()
            .relative()
            .flex()
            .flex_col()
            .min_w(min_width)
            .max_w(px(320.))
            .max_h(px(320.))
            .overflow_y_scroll()
            .p(px(4.))
            .rounded(theme::RADIUS)
            .bg(theme::popover())
            .border_1()
            .border_color(theme::with_alpha(theme::foreground(), if theme::is_dark() { 0.1 } else { 0.05 }))
            .shadow_lg()
            .font_family(theme::FONT)
            .text_size(px(text))
            .text_color(theme::foreground());
        if !is_sub {
            panel = panel.child(kit::track(&self.tracked, "menu-panel"));
        }
        for (index, entry) in entries.into_iter().enumerate() {
            panel = match entry {
                Entry::Label(label) => panel.child(
                    div()
                        .px(px(8.))
                        .py(px(4.))
                        .text_size(px(12.))
                        .text_color(theme::muted())
                        .child(label),
                ),
                Entry::Separator => panel.child(
                    div()
                        .flex_none()
                        .h(px(1.))
                        .mx(px(-4.))
                        .my(px(if compact { 3. } else { 4. }))
                        .bg(theme::with_alpha(theme::border(), 0.5)),
                ),
                Entry::Custom(element) => panel.child(element),
                Entry::Item(mut item) => {
                    let color = if item.destructive { theme::danger() } else { theme::foreground() };
                    let hover = if item.destructive {
                        theme::mix(theme::danger(), if theme::is_dark() { 20. } else { 10. })
                    } else {
                        theme::accent()
                    };
                    let opens = item.sub.is_some();
                    let checked = item.checked;
                    let disabled = item.disabled;
                    let is_highlighted = highlight == Some(index);
                    let row_key = SharedString::from(format!("menu-item-{index}"));
                    let mut row = div()
                        .id(SharedString::from(format!("{}-{index}", if is_sub { "sub-item" } else { "menu-item" })))
                        .relative()
                        .flex()
                        .flex_none()
                        .items_center()
                        .gap(px(8.))
                        .min_h(px(if compact { 26. } else { 28. }))
                        .px(px(8.))
                        .py(px(if compact { 3. } else { 6. }))
                        .rounded(theme::RADIUS_SM)
                        .text_color(color)
                        .when(checked.is_some() || opens, |el| el.pr(px(32.)))
                        .when(is_highlighted, |el| el.bg(hover))
                        .when(disabled, |el| el.opacity(0.5))
                        .when(!disabled, |el| el.cursor_pointer().hover(|el| el.bg(hover)));
                    if opens && !is_sub {
                        row = row.child(kit::track(&self.tracked, row_key));
                    }
                    if let Some(sign) = item.sign.take() {
                        row = row.child(theme::hi(&sign).size(px(if compact { 14. } else { 16. })).text_color(color));
                    }
                    if let Some(icon) = item.icon.take() {
                        row = row.child(
                            div()
                                .flex()
                                .flex_none()
                                .items_center()
                                .justify_center()
                                .text_color(if item.destructive { theme::danger() } else { theme::muted() })
                                .child(icon),
                        );
                    }
                    row = row.child(div().flex_1().min_w_0().truncate().child(item.label.clone()));
                    if let Some(hint) = item.hint.clone() {
                        row = row.child(div().flex_none().text_size(px(12.)).text_color(theme::muted()).child(hint));
                    }
                    if checked == Some(true) {
                        row = row.child(
                            div()
                                .absolute()
                                .right(px(8.))
                                .top_0()
                                .bottom_0()
                                .flex()
                                .items_center()
                                .child(theme::hi("tick-02").text_color(theme::foreground())),
                        );
                    }
                    if opens {
                        row = row.child(
                            div()
                                .absolute()
                                .right(px(6.))
                                .top_0()
                                .bottom_0()
                                .flex()
                                .items_center()
                                .child(theme::hi("arrow-right-01").text_color(theme::muted())),
                        );
                    }
                    let item = Rc::new(item);
                    let hovered = item.clone();
                    panel.child(
                        row.on_hover(cx.listener(move |this, over: &bool, _, cx| {
                            // A submenu opens on its row, and closes on any other row of its parent.
                            if !*over || is_sub {
                                return;
                            }
                            let Some(menu) = &mut this.menu else { return };
                            let wanted = hovered
                                .sub
                                .clone()
                                .map(|kind| (kind, SharedString::from(format!("menu-item-{index}"))));
                            if menu.sub != wanted {
                                menu.sub = wanted;
                                cx.notify();
                            }
                        }))
                        .on_click(cx.listener(move |this, _, window, cx| this.pick(&item, index, window, cx))),
                    )
                }
            };
        }
        panel
    }

    /// Menus, the issue and the dialogs of `surface`, lowest first.
    pub(super) fn render_overlays(&mut self, surface: Surface, window: &mut Window, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let mut layers = Vec::new();
        match surface {
            Surface::App => {
                layers.extend(self.render_issue(window, cx));
                layers.extend(self.render_dialog(window, cx));
            }
            Surface::Settings => layers.extend(self.render_settings_dialog(window, cx)),
        }
        layers.extend(self.render_menu(surface, window, cx));
        layers
    }
}

/// The dimmed window behind a dialog, with the dialog in it. `top`: how far
/// from the window's top it sits; `None` centres it. A press beside the
/// dialog calls `dismiss`.
pub(super) fn modal(
    layer: usize,
    top: Option<Pixels>,
    window: &Window,
    panel: impl IntoElement,
    dismiss: impl Fn(&MouseDownEvent, &mut Window, &mut App) + 'static,
) -> AnyElement {
    let size = window.viewport_size();
    deferred(
        anchored().position(point(px(0.), px(0.))).child(
            div()
                .id(("todo-backdrop", layer))
                .occlude()
                .w(size.width)
                .h(size.height)
                .flex()
                .justify_center()
                .map(|el| match top {
                    Some(top) => el.items_start().pt(top),
                    None => el.items_center(),
                })
                .bg(rgba(0x0000004d))
                .on_mouse_down(MouseButton::Left, dismiss)
                .child(panel),
        ),
    )
    .with_priority(10 + layer)
    .into_any_element()
}

/// packages/ui dialog.tsx `DialogContent`: the raised box, 448 wide.
pub(super) fn dialog_panel(id: impl Into<ElementId>, window: &Window) -> Stateful<Div> {
    let width = (window.viewport_size().width - px(32.)).min(px(448.));
    div()
        .id(id)
        .occlude()
        .relative()
        .flex()
        .flex_col()
        .gap(px(24.))
        .w(width)
        .p(px(24.))
        .rounded(theme::RADIUS_XL)
        .bg(theme::popover())
        .border_1()
        .border_color(theme::with_alpha(theme::foreground(), if theme::is_dark() { 0.1 } else { 0.05 }))
        .shadow_xl()
        .font_family(theme::FONT)
        .text_size(px(14.))
        .text_color(theme::foreground())
}

/// `DialogHeader` with its title and description. `large`: an alert dialog's 18-point title.
pub(super) fn dialog_header(title: impl Into<SharedString>, description: Option<SharedString>, large: bool) -> Div {
    div()
        .flex()
        .flex_col()
        .gap(px(6.))
        .child(
            div()
                .text_size(px(if large { 18. } else { 16. }))
                .font_weight(FontWeight::MEDIUM)
                .child(title.into()),
        )
        .when_some(description, |el, description| {
            el.child(div().text_size(px(14.)).text_color(theme::muted()).child(description))
        })
}

/// `DialogFooter`: the buttons at the right.
pub(super) fn dialog_footer() -> Div {
    div().flex().justify_end().gap(px(8.))
}

/// The dialog's own close button (top right, on the quiet fill).
pub(super) fn dialog_close(id: impl Into<ElementId>) -> Stateful<Div> {
    ui::icon_button(id, "cancel-01")
        .absolute()
        .top(px(16.))
        .right(px(16.))
        .bg(theme::secondary())
}

/// A `FieldLabel` above its control.
pub(super) fn labeled(label: impl Into<SharedString>, control: impl IntoElement) -> Div {
    div()
        .flex()
        .flex_col()
        .gap(px(12.))
        .child(div().text_size(px(14.)).font_weight(FontWeight::MEDIUM).child(label.into()))
        .child(control)
}

/// Escape from a field inside a dialog reaches the dialog as the field's own
/// `Escape`; outside a field it is `Dismiss`. Both end up here.
pub(super) fn on_escape<E: InteractiveElement>(
    element: E,
    cx: &mut Context<TodoApp>,
    close: impl Fn(&mut TodoApp, &mut Window, &mut Context<TodoApp>) + Clone + 'static,
) -> E {
    let other = close.clone();
    element
        .on_action(cx.listener(move |this, _: &Dismiss, window, cx| close(this, window, cx)))
        .on_action(cx.listener(move |this, _: &Escape, window, cx| other(this, window, cx)))
}
