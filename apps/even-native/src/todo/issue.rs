//! One issue, open over the board (components/board/issue-detail.tsx): the
//! title and description at the left with the sub-issues and attachments
//! below them, the properties at the right.

use std::path::PathBuf;
use std::time::Duration;

use gpui_kit::component::input::{Input, InputEvent, InputState, Textarea, TextareaState};

use crate::editor::EditorEvent;

use super::api::{AttachmentTooLarge, BoardMember};
use super::core::{default_status, sort_statuses, sort_sub_issues};
use super::description::DescriptionEditor;
use super::overlay::{dialog_footer, dialog_header, dialog_panel, modal, on_escape, Target};
use super::*;

pub(super) struct IssueView {
    pub id: String,
    pub focus: FocusHandle,
    title: Entity<TextareaState>,
    /// The title as last shown from the data, to see a change made elsewhere.
    shown_title: String,
    pub description: DescriptionEditor,
    /// The field for a new sub-issue, while one is being added.
    sub: Option<Entity<InputState>>,
    /// The names of files on their way up.
    uploads: Vec<String>,
    confirm_delete: bool,
    /// Saves the description a moment after typing stops.
    save_timer: Option<Task<()>>,
    _events: Vec<Subscription>,
}

/// A click that saves the file, for the name and for the button beside it.
fn download_listener(file: &api::Attachment, cx: &mut Context<TodoApp>) -> impl Fn(&ClickEvent, &mut Window, &mut App) + 'static {
    let (id, name) = (file.id.clone(), file.name.clone());
    let app = cx.entity().downgrade();
    move |_, window, cx| {
        let _ = app.update(cx, |this, cx| this.download_attachment(id.clone(), name.clone(), window, cx));
    }
}

impl TodoApp {
    pub(super) fn open_issue(&mut self, id: &str, window: &mut Window, cx: &mut Context<Self>) {
        // Closing the issue that was open mid-sentence still saves it.
        self.commit_issue_title(window, cx);
        self.flush_description(window, cx);
        let Some(issue) = self.data.todos.iter().find(|todo| todo.id == id) else { return };
        let title = cx.new(|cx| {
            TextareaState::new(window, cx)
                .auto_grow(1, 8)
                .submit_on_enter(true)
                .default_value(issue.title.clone())
        });
        let description = DescriptionEditor::new(
            issue.description.as_deref().unwrap_or(""),
            t("Add a description…", "Voeg een beschrijving toe…"),
            window,
            cx,
        );
        let events = vec![
            cx.subscribe_in(&title, window, |this, _, event: &InputEvent, window, cx| match event {
                InputEvent::Blur => this.commit_issue_title(window, cx),
                InputEvent::PressEnter { .. } => {
                    // Enter leaves the field, which saves it.
                    if let Some(issue) = &this.issue {
                        window.focus(&issue.focus, cx);
                    }
                }
                _ => {}
            }),
            cx.subscribe_in(description.events(), window, |this, _, event: &EditorEvent, window, cx| {
                // The description grows with its text: drawn again at its new height.
                if matches!(event, EditorEvent::ContentHeight(_)) {
                    cx.notify();
                }
                match DescriptionEditor::save_on(event) {
                    Some(true) => this.flush_description(window, cx),
                    Some(false) => {
                        let timer = cx.spawn_in(window, async move |this, cx| {
                            cx.background_executor().timer(Duration::from_millis(800)).await;
                            let _ = this.update_in(cx, |this, window, cx| this.flush_description(window, cx));
                        });
                        if let Some(issue) = &mut this.issue {
                            issue.save_timer = Some(timer);
                        }
                    }
                    None => {}
                }
            }),
        ];
        let focus = cx.focus_handle();
        window.focus(&focus, cx);
        self.menu = None;
        self.issue = Some(IssueView {
            id: id.to_string(),
            focus,
            shown_title: issue.title.clone(),
            title,
            description,
            sub: None,
            uploads: Vec::new(),
            confirm_delete: false,
            save_timer: None,
            _events: events,
        });
        cx.notify();
    }

    pub(super) fn close_issue(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.issue.is_none() {
            return;
        }
        self.commit_issue_title(window, cx);
        self.flush_description(window, cx);
        self.issue = None;
        window.focus(&self.focus, cx);
        cx.notify();
    }

    /// The title saves when its field is left; an empty one goes back to what it was.
    fn commit_issue_title(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(view) = &mut self.issue else { return };
        let id = view.id.clone();
        let Some(current) = self.data.todos.iter().find(|todo| todo.id == id).map(|todo| todo.title.clone()) else {
            return;
        };
        let next: String = view
            .title
            .read(cx)
            .value()
            .replace('\n', " ")
            .trim()
            .chars()
            .take(500)
            .collect();
        if next.is_empty() {
            view.title.update(cx, |title, cx| title.set_value(current, window, cx));
            return;
        }
        if next == current {
            return;
        }
        view.shown_title = next.clone();
        let mut command = Command::update_issue(&id);
        if let Command::UpdateIssue { title, .. } = &mut command {
            *title = Some(next);
        }
        self.run(command, window, cx);
    }

    fn flush_description(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(view) = &mut self.issue else { return };
        view.save_timer = None;
        let Some(markdown) = view.description.take_unsaved(cx) else { return };
        let mut command = Command::update_issue(&view.id);
        if let Command::UpdateIssue { description, .. } = &mut command {
            *description = Some(markdown);
        }
        let after: After = Box::new(|_, saved, window, cx| {
            if !saved {
                ui::toast_error(
                    t(
                        "The description couldn't be saved.",
                        "De beschrijving kon niet worden opgeslagen.",
                    ),
                    window,
                    cx,
                );
            }
        });
        self.run_then(command, Some(after), window, cx);
    }

    /// A sub-issue's checkbox: done, or back to where a new issue starts.
    fn toggle_child(&mut self, child_id: &str, window: &mut Window, cx: &mut Context<Self>) {
        let Some(child) = self.data.todos.iter().find(|todo| todo.id == child_id) else { return };
        let next = if child.completed {
            default_status(&self.data.statuses)
        } else {
            sort_statuses(&self.data.statuses)
                .into_iter()
                .find(|status| status.category == StatusCategory::Completed)
        };
        let Some(next) = next else { return };
        let mut command = Command::update_issue(child_id);
        if let Command::UpdateIssue { status_id, .. } = &mut command {
            *status_id = Some(next.id);
        }
        self.run(command, window, cx);
    }

    fn start_sub_issue(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let input = cx.new(|cx| InputState::new(window, cx).placeholder(t("Sub-issue title", "Titel van het sub-issue")));
        let events = cx.subscribe_in(&input, window, |this, input, event: &InputEvent, window, cx| match event {
            InputEvent::PressEnter { .. } => this.add_sub_issue(window, cx),
            InputEvent::Change => cx.notify(),
            // Left empty: the form goes away again.
            InputEvent::Blur => {
                if input.read(cx).value().trim().is_empty() {
                    if let Some(issue) = &mut this.issue {
                        issue.sub = None;
                        cx.notify();
                    }
                }
            }
            _ => {}
        });
        input.update(cx, |input, cx| input.focus(window, cx));
        if let Some(issue) = &mut self.issue {
            issue.sub = Some(input);
            issue._events.truncate(2);
            issue._events.push(events);
        }
        cx.notify();
    }

    fn add_sub_issue(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(view) = &self.issue else { return };
        let Some(input) = view.sub.clone() else { return };
        let title: String = input.read(cx).value().trim().chars().take(500).collect();
        if title.is_empty() {
            return;
        }
        let Some(parent) = self.data.todos.iter().find(|todo| todo.id == view.id) else { return };
        let command = Command::CreateIssue {
            id: api::new_id(),
            list_id: parent.list_id.clone(),
            title,
            description: None,
            status_id: None,
            project_id: parent.project_id.clone(),
            priority: None,
            parent_id: Some(parent.id.clone()),
            assignee_ids: None,
        };
        self.run(command, window, cx);
        input.update(cx, |input, cx| input.set_value("", window, cx));
    }

    /// Sends files to an issue, one after the other. `announce`: say so when done.
    pub(super) fn upload_files(
        &mut self,
        issue_id: String,
        files: Vec<PathBuf>,
        announce: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if files.is_empty() {
            return;
        }
        let name_of = |path: &PathBuf| {
            path.file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_default()
        };
        if let Some(view) = self.issue.as_mut().filter(|view| view.id == issue_id) {
            view.uploads.extend(files.iter().map(name_of));
        }
        let client = self.client.clone();
        cx.spawn_in(window, async move |this, cx| {
            let mut done = 0;
            for path in files {
                let name = name_of(&path);
                let (client, id) = (client.clone(), issue_id.clone());
                let result = cx
                    .background_executor()
                    .spawn(async move { api::upload_attachment(&client, &id, &path) })
                    .await;
                let updated = this.update_in(cx, |this, window, cx| {
                    if let Some(view) = this.issue.as_mut().filter(|view| view.id == issue_id) {
                        if let Some(index) = view.uploads.iter().position(|upload| upload == &name) {
                            view.uploads.remove(index);
                        }
                    }
                    match result {
                        Ok(()) => done += 1,
                        Err(error) => {
                            let message = if error.is::<AttachmentTooLarge>() {
                                t(format!("{name} is larger than 25 MB."), format!("{name} is groter dan 25 MB."))
                            } else {
                                // A lapsed session signs out; the words stay the web's.
                                this.message(&error, cx);
                                t(
                                    format!("Uploading {name} didn't work."),
                                    format!("Uploaden van {name} is niet gelukt."),
                                )
                            };
                            ui::toast_error(message, window, cx);
                        }
                    }
                    cx.notify();
                });
                if updated.is_err() {
                    return;
                }
            }
            if done > 0 {
                let _ = this.update_in(cx, |this, window, cx| {
                    if announce {
                        ui::toast(
                            t(
                                if done == 1 { "File attached." } else { "Files attached." },
                                if done == 1 { "Bestand toegevoegd." } else { "Bestanden toegevoegd." },
                            ),
                            window,
                            cx,
                        );
                    }
                    this.refresh_quietly(cx);
                });
            }
        })
        .detach();
        cx.notify();
    }

    /// Saved like a normal download: into the Downloads folder, then shown there.
    fn download_attachment(&mut self, id: String, name: String, window: &mut Window, cx: &mut Context<Self>) {
        let client = self.client.clone();
        let task = cx.background_executor().spawn(async move {
            let bytes = api::download_attachment(&client, &id)?;
            let folder = dirs::download_dir().ok_or_else(|| anyhow::anyhow!("no downloads folder"))?;
            // Never over a file that is already there.
            let clean: String = name.replace(['/', '\\', ':'], "_");
            let (stem, extension) = match clean.rsplit_once('.') {
                Some((stem, extension)) if !stem.is_empty() => (stem.to_string(), format!(".{extension}")),
                _ => (clean.clone(), String::new()),
            };
            let mut path = folder.join(&clean);
            let mut copy = 1;
            while path.exists() {
                copy += 1;
                path = folder.join(format!("{stem} {copy}{extension}"));
            }
            std::fs::write(&path, bytes)?;
            anyhow::Ok(path)
        });
        cx.spawn_in(window, async move |this, cx| {
            let result = task.await;
            let _ = this.update_in(cx, |this, window, cx| match result {
                Ok(path) => cx.reveal_path(&path),
                Err(error) => {
                    this.message(&error, cx);
                    ui::toast_error(t("Downloading didn't work.", "Downloaden is niet gelukt."), window, cx);
                }
            });
        })
        .detach();
    }

    fn copy_issue_link(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(view) = &self.issue else { return };
        let Some(issue) = self.data.todos.iter().find(|todo| todo.id == view.id) else { return };
        let mut url = format!("{}/?list={}&issue={}", api::web_origin(), issue.list_id, issue.id);
        if let Some(workspace) = self.active() {
            url = format!(
                "{}/?workspace={}&list={}&issue={}",
                api::web_origin(),
                workspace.id,
                issue.list_id,
                issue.id
            );
        }
        cx.write_to_clipboard(ClipboardItem::new_string(url));
        ui::toast(t("Link copied.", "Link gekopieerd."), window, cx);
    }

    pub(super) fn ask_delete_issue(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(view) = &mut self.issue {
            view.confirm_delete = true;
            window.focus(&view.focus, cx);
            cx.notify();
        }
    }

    pub(super) fn copy_open_issue_link(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.copy_issue_link(window, cx);
    }

    fn delete_open_issue(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(view) = self.issue.take() else { return };
        window.focus(&self.focus, cx);
        self.run(Command::DeleteTodo { id: view.id }, window, cx);
    }

    /// The open issue's dialog, and the delete question above it.
    pub(super) fn render_issue(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let Some(view) = &mut self.issue else { return Vec::new() };
        let Some(issue) = self.data.todos.iter().find(|todo| todo.id == view.id).cloned() else {
            // The open issue was deleted (here or elsewhere): close it.
            self.issue = None;
            return Vec::new();
        };
        // Changed elsewhere: show theirs, unless the field is in use.
        if issue.title != view.shown_title && !view.title.read(cx).focus_handle(cx).is_focused(window) {
            view.shown_title = issue.title.clone();
            view.title
                .update(cx, |title, cx| title.set_value(issue.title.clone(), window, cx));
        }
        view.description.sync(issue.description.as_deref().unwrap_or(""), cx);

        let list = self.data.lists.iter().find(|list| list.id == issue.list_id);
        let read_only = list.is_some_and(|list| list.role == api::ListRole::Viewer);
        // The description is a system view above everything GPUI draws: off
        // the screen while a menu, a dialog or the delete question shows.
        let covered = self.covered || self.menu.is_some() || self.dialog.is_some() || view.confirm_delete;
        view.description.set_hidden(covered, cx);
        let room = crate::workspace::toast_room(window, cx);
        let description = view.description.render(!read_only, room, window, cx).into_any_element();
        let scroller = view.description.scroller().clone();

        let Some(view) = &self.issue else { return Vec::new() };
        let list_name = list.map(|list| list.name.clone()).unwrap_or_default();
        let statuses = &self.data.statuses;
        let status = statuses.iter().find(|status| Some(&status.id) == issue.status_id.as_ref());
        let project = self
            .data
            .projects
            .iter()
            .find(|project| Some(&project.id) == issue.project_id.as_ref());
        let assignees: Vec<&BoardMember> = self
            .data
            .members
            .iter()
            .filter(|member| issue.assignee_ids.contains(&member.id))
            .collect();
        let parent = issue
            .parent_id
            .as_ref()
            .and_then(|parent| self.data.todos.iter().find(|todo| &todo.id == parent));
        let children = sort_sub_issues(
            self.data
                .todos
                .iter()
                .filter(|todo| todo.parent_id.as_ref() == Some(&issue.id))
                .cloned()
                .collect(),
        );
        let child_done = children.iter().filter(|child| child.completed).count();
        let reference = |todo: &Todo| format!("#{}", todo.number.map(|number| number.to_string()).unwrap_or_default());
        let options_open = self.menu.as_ref().is_some_and(|menu| menu.kind == MenuKind::IssueOptions);

        // ── The bar at the top ──
        let mut crumbs = div()
            .flex()
            .items_center()
            .gap(px(6.))
            .min_w_0()
            .text_size(px(13.))
            .text_color(theme::muted())
            .child(theme::hi("kanban").size(px(14.)).text_color(theme::muted()))
            .child(div().min_w_0().truncate().child(list_name));
        if let Some(parent) = parent {
            let parent_id = parent.id.clone();
            crumbs = crumbs.child("›").child(
                div()
                    .id("issue-parent")
                    .min_w_0()
                    .max_w(px(260.))
                    .truncate()
                    .px(px(4.))
                    .py(px(2.))
                    .rounded(theme::RADIUS_SM)
                    .cursor_pointer()
                    .hover(|el| el.bg(theme::muted_bg()).text_color(theme::foreground()))
                    .child(format!("{} {}", reference(parent), parent.title))
                    .on_click(cx.listener(move |this, _, window, cx| this.open_issue(&parent_id, window, cx))),
            );
        }
        crumbs = crumbs.child("›").child(div().flex_none().child(reference(&issue)));
        let topbar = div()
            .flex()
            .flex_none()
            .items_center()
            .justify_between()
            .gap(px(12.))
            .h(px(48.))
            .pl(px(20.))
            .pr(px(12.))
            .border_b_1()
            .border_color(theme::border())
            .child(crumbs)
            .child(
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(px(4.))
                    .child(
                        kit::icon_button("issue-options", "more-horizontal", 28.)
                            .relative()
                            .when(options_open, |el| el.bg(theme::muted_bg()))
                            .child(kit::track(&self.tracked, "issue-options"))
                            .tooltip(ui::tip(t("Issue options", "Opties voor issue")))
                            .on_click(cx.listener(|this, _, window, cx| {
                                this.open_menu(MenuKind::IssueOptions, "issue-options", window, cx)
                            })),
                    )
                    .child(
                        kit::icon_button("issue-close", "cancel-01", 28.)
                            .tooltip(ui::tip(t("Close", "Sluiten")))
                            .on_click(cx.listener(|this, _, window, cx| this.close_issue(window, cx))),
                    ),
            );

        // ── Sub-issues ──
        let section = |title: &'static str, count: Option<String>, add: Option<AnyElement>| {
            div()
                .flex()
                .items_center()
                .justify_between()
                .min_h(px(28.))
                .mb(px(8.))
                .child(
                    div()
                        .flex()
                        .items_end()
                        .gap(px(8.))
                        .text_size(px(13.))
                        .font_weight(FontWeight::SEMIBOLD)
                        .child(title)
                        .when_some(count, |el, count| {
                            el.child(
                                div()
                                    .font_weight(FontWeight::NORMAL)
                                    .text_color(theme::muted())
                                    .child(count),
                            )
                        }),
                )
                .when_some(add, |el, add| el.child(add))
        };
        let row = |id: SharedString| {
            div()
                .id(id)
                .flex()
                .items_center()
                .gap(px(8.))
                .min_h(px(36.))
                .px(px(6.))
                .rounded(theme::RADIUS_MD)
                .hover(|el| el.bg(theme::with_alpha(theme::muted_bg(), 0.6)))
        };
        let mut sub_issues = div().flex().flex_col().pt(px(16.)).mt(px(8.)).border_t_1().border_color(theme::border()).child(
            section(
                t("Sub-issues", "Sub-issues"),
                (!children.is_empty()).then(|| format!("{child_done}/{}", children.len())),
                (!read_only).then(|| {
                    kit::icon_button("sub-issue-add", "add-01", 28.)
                        .tooltip(ui::tip(t("Add sub-issue", "Sub-issue toevoegen")))
                        .on_click(cx.listener(|this, _, window, cx| this.start_sub_issue(window, cx)))
                        .into_any_element()
                }),
            ),
        );
        for child in &children {
            let child_status = statuses.iter().find(|status| Some(&status.id) == child.status_id.as_ref());
            let child_assignees: Vec<&BoardMember> = self
                .data
                .members
                .iter()
                .filter(|member| child.assignee_ids.contains(&member.id))
                .collect();
            let (toggle, open) = (child.id.clone(), child.id.clone());
            sub_issues = sub_issues.child(
                row(SharedString::from(format!("sub-issue-{}", child.id)))
                    .child(
                        div()
                            .id(SharedString::from(format!("sub-issue-toggle-{}", child.id)))
                            .flex()
                            .flex_none()
                            .items_center()
                            .justify_center()
                            .size(px(24.))
                            .rounded(theme::RADIUS_SM)
                            .child(kit::status_icon(
                                child_status.map(|status| status.category),
                                child_status.map(|status| status.color.as_str()),
                                14.,
                            ))
                            .when(!read_only, |el| {
                                el.cursor_pointer()
                                    .hover(|el| el.bg(theme::muted_bg()))
                                    .on_click(cx.listener(move |this, _, window, cx| {
                                        this.toggle_child(&toggle, window, cx)
                                    }))
                            }),
                    )
                    .child(
                        div()
                            .id(SharedString::from(format!("sub-issue-open-{}", child.id)))
                            .flex()
                            .flex_1()
                            .min_w_0()
                            .items_center()
                            .gap(px(8.))
                            .h(px(36.))
                            .text_size(px(13.5))
                            .cursor_pointer()
                            .child(
                                div()
                                    .flex_none()
                                    .text_size(px(12.))
                                    .text_color(theme::muted())
                                    .child(reference(child)),
                            )
                            .child(
                                div()
                                    .min_w_0()
                                    .truncate()
                                    .when(child.completed, |el| {
                                        el.text_color(theme::muted())
                                            .line_through()
                                            .text_decoration_color(theme::with_alpha(theme::muted(), 0.5))
                                    })
                                    .child(child.title.clone()),
                            )
                            .on_click(cx.listener(move |this, _, window, cx| this.open_issue(&open, window, cx))),
                    )
                    .when(child.priority.unwrap_or(0) > 0, |el| {
                        el.child(kit::priority_icon(child.priority.unwrap_or(0)))
                    })
                    .children(kit::avatar_stack(&child_assignees, 18., 3)),
            );
        }
        if let Some(input) = view.sub.as_ref().filter(|_| !read_only) {
            let first = default_status(statuses);
            let empty = input.read(cx).value().trim().is_empty();
            sub_issues = sub_issues.child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .px(px(6.))
                    .py(px(4.))
                    .child(kit::status_icon(
                        first.as_ref().map(|status| status.category),
                        first.as_ref().map(|status| status.color.as_str()),
                        14.,
                    ))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .h(px(32.))
                            .flex()
                            .items_center()
                            .text_size(px(13.5))
                            .child(Input::new(input).appearance(false).text_size(px(13.5))),
                    )
                    .child(
                        ui::button_sm("sub-issue-save", t("Add", "Toevoegen"), ui::Variant::Primary)
                            .when(empty, ui::disabled)
                            .when(!empty, |el| {
                                el.on_click(cx.listener(|this, _, window, cx| this.add_sub_issue(window, cx)))
                            }),
                    ),
            );
        }

        // ── Attachments ──
        let issue_id = issue.id.clone();
        let mut attachments = div().flex().flex_col().pt(px(16.)).mt(px(24.)).border_t_1().border_color(theme::border()).child(
            section(
                t("Attachments", "Bijlagen"),
                (!issue.attachments.is_empty()).then(|| issue.attachments.len().to_string()),
                (!read_only).then(|| {
                    kit::icon_button("attachment-add", "add-01", 28.)
                        .tooltip(ui::tip(t("Add files", "Bestanden toevoegen")))
                        .on_click(cx.listener(move |this, _, window, cx| {
                            let issue_id = issue_id.clone();
                            this.pick_files(window, cx, move |this, paths, window, cx| {
                                this.upload_files(issue_id, paths, true, window, cx)
                            })
                        }))
                        .into_any_element()
                }),
            ),
        );
        if issue.attachments.is_empty() && view.uploads.is_empty() {
            attachments = attachments.child(div().text_size(px(13.)).text_color(theme::muted()).child(if read_only {
                t(
                    "Sign in as a workspace member to add files.",
                    "Log in als lid van de workspace om bestanden toe te voegen.",
                )
            } else {
                t(
                    "No files yet. Drop them here or add them.",
                    "Nog geen bestanden. Sleep ze hierheen of voeg ze toe.",
                )
            }));
        }
        for file in &issue.attachments {
            let remove = file.id.clone();
            attachments = attachments.child(
                row(SharedString::from(format!("attachment-{}", file.id)))
                    .child(theme::hi("attachment-01").text_color(theme::muted()))
                    .child(
                        div()
                            .id(SharedString::from(format!("attachment-name-{}", file.id)))
                            .flex()
                            .flex_1()
                            .min_w_0()
                            .items_center()
                            .gap(px(8.))
                            .h(px(36.))
                            .text_size(px(13.5))
                            .cursor_pointer()
                            .child(div().min_w_0().truncate().child(file.name.clone()))
                            .child(
                                div()
                                    .flex_none()
                                    .text_size(px(12.))
                                    .text_color(theme::muted())
                                    .child(kit::format_bytes(file.size)),
                            )
                            .on_click(download_listener(file, cx)),
                    )
                    .child(
                        kit::icon_button(SharedString::from(format!("attachment-download-{}", file.id)), "download-04", 28.)
                            .tooltip(ui::tip(t(
                                format!("Download {}", file.name),
                                format!("{} downloaden", file.name),
                            )))
                            .on_click(download_listener(file, cx)),
                    )
                    .when(!read_only, |el| {
                        el.child(
                            kit::icon_button(SharedString::from(format!("attachment-remove-{}", file.id)), "delete-02", 28.)
                                .tooltip(ui::tip(t(
                                    format!("Remove {}", file.name),
                                    format!("{} verwijderen", file.name),
                                )))
                                .on_click(cx.listener(move |this, _, window, cx| {
                                    this.run(Command::DeleteAttachment { id: remove.clone() }, window, cx)
                                })),
                        )
                    }),
            );
        }
        for (index, name) in view.uploads.iter().enumerate() {
            attachments = attachments.child(
                row(SharedString::from(format!("upload-{index}")))
                    .child(theme::hi("attachment-01").text_color(theme::muted()))
                    .child(div().min_w_0().truncate().text_size(px(14.)).text_color(theme::muted()).child(t(
                        format!("Uploading {name}…"),
                        format!("{name} uploaden…"),
                    ))),
            );
        }

        // ── The properties at the right ──
        let property = |label: &'static str, value: AnyElement| {
            div()
                .flex()
                .items_center()
                .min_h(px(36.))
                .child(
                    div()
                        .w(px(92.))
                        .flex_none()
                        .text_size(px(12.5))
                        .text_color(theme::muted())
                        .child(label),
                )
                .child(div().flex_1().min_w_0().child(value))
        };
        let value = |key: &'static str, kind: MenuKind, cx: &mut Context<Self>| {
            let open = self.menu.as_ref().is_some_and(|menu| menu.anchor.as_ref() == key);
            div()
                .id(key)
                .relative()
                .flex()
                .items_center()
                .gap(px(8.))
                .min_w_0()
                .h(px(32.))
                .px(px(8.))
                .ml(px(-8.))
                .rounded(theme::RADIUS_MD)
                .text_size(px(13.))
                .child(kit::track(&self.tracked, key))
                .when(open, |el| el.bg(theme::muted_bg()))
                .when(!read_only, |el| {
                    el.cursor_pointer()
                        .hover(|el| el.bg(theme::muted_bg()))
                        .on_click(cx.listener(move |this, _, window, cx| this.open_menu(kind.clone(), key, window, cx)))
                })
        };
        let target = || Target::Issue(issue.id.clone());
        let priority = issue.priority.unwrap_or(0);
        let assignee_value = value("issue-prop-assignees", MenuKind::Assignees(target()), cx).map(|el| match assignees.len() {
            0 => el.child(div().text_color(theme::muted()).child(t("Unassigned", "Niet toegewezen"))),
            1 => el
                .child(kit::member_avatar(assignees[0], 18.))
                .child(div().min_w_0().truncate().child(assignees[0].label().to_string())),
            _ => el.children(kit::avatar_stack(&assignees, 18., 5)),
        });
        let props = div()
            .flex()
            .flex_col()
            .flex_none()
            .gap(px(2.))
            .w(px(260.))
            .px(px(16.))
            .py(px(20.))
            .border_l_1()
            .border_color(theme::border())
            .bg(theme::with_alpha(theme::muted_bg(), 0.35))
            .child(property(
                "Status",
                value("issue-prop-status", MenuKind::Status(target()), cx)
                    .child(kit::status_icon(
                        status.map(|status| status.category),
                        status.map(|status| status.color.as_str()),
                        14.,
                    ))
                    .child(
                        div()
                            .min_w_0()
                            .truncate()
                            .child(status.map(|status| status.name.clone()).unwrap_or_else(|| "—".into())),
                    )
                    .into_any_element(),
            ))
            .child(property(
                t("Priority", "Prioriteit"),
                value("issue-prop-priority", MenuKind::Priority(target()), cx)
                    .child(kit::priority_icon(priority))
                    .child(priority_name(priority))
                    .into_any_element(),
            ))
            .child(property(t("Assignees", "Toegewezen aan"), assignee_value.into_any_element()))
            .child(property(
                "Project",
                value("issue-prop-project", MenuKind::Project(target()), cx)
                    .child(kit::project_dot(project.map(|project| project.color.as_str()), 14.))
                    .child(
                        div()
                            .min_w_0()
                            .truncate()
                            .when(project.is_none(), |el| el.text_color(theme::muted()))
                            .child(
                                project
                                    .map(|project| project.name.clone())
                                    .unwrap_or_else(|| t("No project", "Geen project").into()),
                            ),
                    )
                    .into_any_element(),
            ))
            .child(property(
                t("Created", "Gemaakt"),
                div()
                    .text_size(px(13.))
                    .child(dashboard::short_date(&issue.created_at))
                    .into_any_element(),
            ));

        let main = div()
            .id("issue-main")
            .flex()
            .flex_col()
            .flex_1()
            .min_w_0()
            .overflow_y_scroll()
            .track_scroll(&scroller)
            .px(px(40.))
            .pt(px(28.))
            .pb(px(40.))
            .child(
                div()
                    .mx(px(-10.))
                    .text_size(px(22.))
                    .font_weight(FontWeight::SEMIBOLD)
                    .line_height(relative(1.35))
                    .child(
                        Textarea::new(&view.title)
                            .appearance(false)
                            .readonly(read_only)
                            .text_size(px(22.))
                            .line_height(relative(1.35))
                            .font_weight(FontWeight::SEMIBOLD),
                    ),
            )
            .child(description)
            .child(sub_issues)
            .child(attachments);

        let size = window.viewport_size();
        let drop_id = issue.id.clone();
        let panel = div()
            .id("issue-dialog")
            .occlude()
            .key_context("TodoOverlay")
            .track_focus(&view.focus)
            .flex()
            .flex_col()
            .w((size.width - px(32.)).min(px(1040.)))
            .h((size.height - px(48.)).min(px(760.)))
            .rounded(theme::RADIUS_XL)
            .bg(theme::popover())
            .border_1()
            .border_color(theme::with_alpha(theme::foreground(), if theme::is_dark() { 0.1 } else { 0.05 }))
            .shadow_xl()
            .overflow_hidden()
            .font_family(theme::FONT)
            .text_size(px(14.))
            .text_color(theme::foreground())
            .child(topbar)
            .child(div().flex().flex_1().min_h_0().child(main).child(props))
            .when(!read_only, |el| {
                // Files dropped on the issue are attached to it.
                el.drag_over::<ExternalPaths>(|style, _, _, _| style.border_color(theme::primary_mark()))
                    .on_drop(cx.listener(move |this, paths: &ExternalPaths, window, cx| {
                        this.upload_files(drop_id.clone(), paths.paths().to_vec(), true, window, cx)
                    }))
            });
        let panel = on_escape(panel, cx, |this, window, cx| {
            // Escape closes the delete question first, then the issue.
            match &mut this.issue {
                Some(view) if view.confirm_delete => {
                    view.confirm_delete = false;
                    cx.notify();
                }
                _ => this.close_issue(window, cx),
            }
        });
        let mut layers = vec![modal(
            0,
            None,
            window,
            panel,
            cx.listener(|this, _, window, cx| this.close_issue(window, cx)),
        )];
        if view.confirm_delete {
            let title = issue.title.clone();
            let confirm = dialog_panel("issue-delete-dialog", window)
                .child(dialog_header(
                    t("Delete issue?", "Issue verwijderen?"),
                    Some(
                        t(
                            format!("“{title}” will be deleted, along with its sub-issues and files. This can't be undone."),
                            format!("“{title}” wordt verwijderd, samen met de sub-issues en bestanden. Dit kun je niet ongedaan maken."),
                        )
                        .into(),
                    ),
                    true,
                ))
                .child(
                    dialog_footer()
                        .child(
                            ui::button("issue-delete-cancel", t("Cancel", "Annuleren"), ui::Variant::Outline).on_click(
                                cx.listener(|this, _, _, cx| {
                                    if let Some(view) = &mut this.issue {
                                        view.confirm_delete = false;
                                        cx.notify();
                                    }
                                }),
                            ),
                        )
                        .child(
                            ui::button("issue-delete-confirm", t("Delete", "Verwijderen"), ui::Variant::Destructive)
                                .on_click(cx.listener(|this, _, window, cx| this.delete_open_issue(window, cx))),
                        ),
                );
            layers.push(modal(2, None, window, confirm, |_, _, _| {}));
        }
        layers
    }
}
