//! packages/todo-core/src/workspace.ts and board.ts: the order of tasks, lists
//! and statuses, and what each command does to the data before the server
//! answers (`optimistic_update`). Kept line for line with the TypeScript, so
//! the screen and the server agree.

use std::collections::{HashMap, HashSet};

use super::api::{
    BoardProject, BoardStatus, Command, ListKind, ListRole, Placement, StatusCategory, Todo, TodoList, WorkspaceData,
};

pub const STATUS_COLORS: [&str; 9] = [
    "#95a2b3", "#a1a1aa", "#f2c94c", "#5e6ad2", "#4cb782", "#eb5757", "#f2994a", "#26b5ce", "#bb87fc",
];
pub const PROJECT_COLORS: [&str; 8] = [
    "#5e6ad2", "#26b5ce", "#4cb782", "#f2c94c", "#f2994a", "#eb5757", "#bb87fc", "#95a2b3",
];

/// "busy", "open" or "done": the three groups of a simple list.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TaskStatus {
    Busy,
    Open,
    Done,
}

impl TaskStatus {
    pub const ALL: [TaskStatus; 3] = [TaskStatus::Busy, TaskStatus::Open, TaskStatus::Done];
}

pub fn task_status(todo: &Todo) -> TaskStatus {
    if todo.completed {
        TaskStatus::Done
    } else if todo.in_progress {
        TaskStatus::Busy
    } else {
        TaskStatus::Open
    }
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub fn sort_todos(mut items: Vec<Todo>) -> Vec<Todo> {
    items.sort_by(|a, b| {
        (task_status(a) as u8)
            .cmp(&(task_status(b) as u8))
            .then(a.position.total_cmp(&b.position))
            .then(b.created_at.cmp(&a.created_at))
            .then(a.id.cmp(&b.id))
    });
    items
}

/// Board columns are in status order; within one, issues are in `position` order.
pub fn sort_issues(mut items: Vec<Todo>) -> Vec<Todo> {
    items.sort_by(|a, b| {
        a.position
            .total_cmp(&b.position)
            .then(b.created_at.cmp(&a.created_at))
            .then(a.id.cmp(&b.id))
    });
    items
}

/// Sub-issues read top to bottom in the order they were added.
pub fn sort_sub_issues(mut items: Vec<Todo>) -> Vec<Todo> {
    items.sort_by(|a, b| a.created_at.cmp(&b.created_at).then(a.id.cmp(&b.id)));
    items
}

pub fn sort_statuses(statuses: &[BoardStatus]) -> Vec<BoardStatus> {
    let mut sorted = statuses.to_vec();
    sorted.sort_by(|a, b| {
        a.category
            .order()
            .cmp(&b.category.order())
            .then(a.position.total_cmp(&b.position))
            .then(a.id.cmp(&b.id))
    });
    sorted
}

/// Where a new issue starts: the first "unstarted" status, else the first one.
pub fn default_status(statuses: &[BoardStatus]) -> Option<BoardStatus> {
    let sorted = sort_statuses(statuses);
    sorted
        .iter()
        .find(|status| status.category == StatusCategory::Unstarted)
        .or(sorted.first())
        .cloned()
}

/// Simple-list flags kept in sync with an issue's status, so counts work everywhere.
fn status_flags(category: Option<StatusCategory>) -> (bool, bool) {
    (
        matches!(category, Some(StatusCategory::Completed | StatusCategory::Canceled)),
        category == Some(StatusCategory::Started),
    )
}

/// Moves `id` directly before or after `target_id`; unknown ids leave the order unchanged.
pub fn reorder_ids(ids: &[String], id: &str, target_id: &str, placement: Placement) -> Vec<String> {
    if id == target_id || !ids.iter().any(|other| other == id) || !ids.iter().any(|other| other == target_id) {
        return ids.to_vec();
    }
    let mut rest: Vec<String> = ids.iter().filter(|other| *other != id).cloned().collect();
    let index = rest.iter().position(|other| other == target_id).unwrap_or(0);
    rest.insert(index + usize::from(placement == Placement::After), id.to_string());
    rest
}

fn move_todo(items: &mut [Todo], id: &str, target_id: &str, placement: Placement) {
    let Some(moving) = items.iter().find(|todo| todo.id == id).cloned() else { return };
    let Some(target) = items.iter().find(|todo| todo.id == target_id).cloned() else { return };
    if moving.id == target.id || moving.list_id != target.list_id || task_status(&moving) != task_status(&target) {
        return;
    }
    let mut ordered = sort_todos(
        items
            .iter()
            .filter(|todo| todo.list_id == moving.list_id && todo.id != moving.id)
            .cloned()
            .collect(),
    );
    let index = ordered.iter().position(|todo| todo.id == target.id).unwrap_or(0);
    ordered.insert(index + usize::from(placement == Placement::After), moving);
    let positions: HashMap<String, f64> = ordered
        .into_iter()
        .enumerate()
        .map(|(position, todo)| (todo.id, position as f64))
        .collect();
    for todo in items.iter_mut() {
        if let Some(position) = positions.get(&todo.id) {
            todo.position = *position;
        }
    }
}

/// Lists are ordered per kind (the sidebar sections); `lists` is in display order.
fn move_list(lists: &mut Vec<TodoList>, id: &str, target_id: &str, placement: Placement) {
    let Some(moving) = lists.iter().find(|list| list.id == id) else { return };
    let Some(target) = lists.iter().find(|list| list.id == target_id) else { return };
    if moving.kind != target.kind {
        return;
    }
    let kind = moving.kind;
    let section: Vec<TodoList> = lists.iter().filter(|list| list.kind == kind).cloned().collect();
    let ids: Vec<String> = section.iter().map(|list| list.id.clone()).collect();
    let order = reorder_ids(&ids, id, target_id, placement);
    let mut sorted = order
        .iter()
        .filter_map(|list_id| section.iter().find(|list| &list.id == list_id).cloned());
    for list in lists.iter_mut() {
        if list.kind == kind {
            if let Some(next) = sorted.next() {
                *list = next;
            }
        }
    }
}

/// The issue and everything below it.
pub fn issue_with_descendants(todos: &[Todo], id: &str) -> HashSet<String> {
    let mut ids: HashSet<String> = HashSet::from([id.to_string()]);
    let mut grew = true;
    while grew {
        grew = false;
        for todo in todos {
            if let Some(parent) = &todo.parent_id {
                if ids.contains(parent) && !ids.contains(&todo.id) {
                    ids.insert(todo.id.clone());
                    grew = true;
                }
            }
        }
    }
    ids
}

/// New positions for a column after `move-issue`; the moving issue gets the new status.
fn move_issue(
    todos: &[Todo],
    id: &str,
    status_id: &str,
    target_id: Option<&str>,
    placement: Option<Placement>,
) -> HashMap<String, f64> {
    let Some(moving) = todos.iter().find(|todo| todo.id == id).cloned() else {
        return HashMap::new();
    };
    let mut column = sort_issues(
        todos
            .iter()
            .filter(|todo| {
                todo.list_id == moving.list_id
                    && todo.parent_id.is_none()
                    && todo.status_id.as_deref() == Some(status_id)
                    && todo.id != moving.id
            })
            .cloned()
            .collect(),
    );
    let index = target_id.and_then(|target| column.iter().position(|todo| todo.id == target));
    let at = match index {
        Some(index) => index + usize::from(placement == Some(Placement::After)),
        None => 0,
    };
    column.insert(at, moving);
    column
        .into_iter()
        .enumerate()
        .map(|(position, todo)| (todo.id, position as f64))
        .collect()
}

fn status_by_id<'a>(data: &'a WorkspaceData, id: Option<&str>) -> Option<&'a BoardStatus> {
    data.statuses.iter().find(|status| Some(status.id.as_str()) == id)
}

/// What `command` does to `data`, before (and after) the server did it too.
/// Applying a command twice is harmless: they are idempotent.
pub fn optimistic_update(data: &mut WorkspaceData, command: &Command) {
    match command {
        Command::CreateIssue {
            id,
            list_id,
            title,
            description,
            status_id,
            project_id,
            priority,
            parent_id,
            assignee_ids,
        } => {
            if data.todos.iter().any(|todo| &todo.id == id) {
                return;
            }
            let status = status_by_id(data, status_id.as_deref())
                .cloned()
                .or_else(|| default_status(&data.statuses));
            let (completed, in_progress) = status_flags(status.as_ref().map(|status| status.category));
            let status_id = status.map(|status| status.id);
            let siblings: Vec<&Todo> = data.todos.iter().filter(|todo| &todo.list_id == list_id).collect();
            let position = siblings
                .iter()
                .filter(|todo| todo.status_id == status_id)
                .map(|todo| todo.position)
                .fold(0., f64::min)
                - 1.;
            let number = siblings.iter().filter_map(|todo| todo.number).max().unwrap_or(0) + 1;
            data.todos.push(Todo {
                id: id.clone(),
                list_id: list_id.clone(),
                title: title.clone(),
                completed,
                in_progress,
                position,
                created_at: now(),
                mail: None,
                number: Some(number),
                description: Some(description.clone().unwrap_or_default()),
                status_id,
                project_id: project_id.clone(),
                priority: Some(priority.unwrap_or(0)),
                parent_id: parent_id.clone(),
                assignee_ids: assignee_ids.clone().unwrap_or_default(),
                attachments: Vec::new(),
            });
        }
        Command::UpdateIssue {
            id,
            title,
            description,
            status_id,
            project_id,
            priority,
            assignee_ids,
        } => {
            let status = status_by_id(data, status_id.as_deref()).cloned();
            if let Some(todo) = data.todos.iter_mut().find(|todo| &todo.id == id) {
                if let Some(title) = title {
                    todo.title = title.clone();
                }
                if let Some(description) = description {
                    todo.description = Some(description.clone());
                }
                if let Some(status) = status {
                    let (completed, in_progress) = status_flags(Some(status.category));
                    todo.status_id = Some(status.id);
                    todo.completed = completed;
                    todo.in_progress = in_progress;
                }
                if let Some(project_id) = project_id {
                    todo.project_id = project_id.clone();
                }
                if let Some(priority) = priority {
                    todo.priority = Some(*priority);
                }
                if let Some(assignee_ids) = assignee_ids {
                    todo.assignee_ids = assignee_ids.clone();
                }
            }
        }
        Command::MoveIssue {
            id,
            status_id,
            target_id,
            placement,
        } => {
            let Some(status) = status_by_id(data, Some(status_id)).cloned() else { return };
            let positions = move_issue(&data.todos, id, status_id, target_id.as_deref(), *placement);
            let (completed, in_progress) = status_flags(Some(status.category));
            for todo in data.todos.iter_mut() {
                if &todo.id == id {
                    todo.status_id = Some(status.id.clone());
                    todo.completed = completed;
                    todo.in_progress = in_progress;
                }
                if let Some(position) = positions.get(&todo.id) {
                    todo.position = *position;
                }
            }
        }
        Command::DeleteAttachment { id } => {
            for todo in data.todos.iter_mut() {
                todo.attachments.retain(|attachment| &attachment.id != id);
            }
        }
        Command::CreateStatus {
            id,
            name,
            category,
            color,
            ..
        } => {
            if data.statuses.iter().any(|status| &status.id == id) {
                return;
            }
            let position = data
                .statuses
                .iter()
                .filter(|status| status.category == *category)
                .map(|status| status.position)
                .fold(-1., f64::max)
                + 1.;
            data.statuses.push(BoardStatus {
                id: id.clone(),
                name: name.clone(),
                category: *category,
                color: color.clone(),
                position,
            });
        }
        Command::UpdateStatus {
            id,
            name,
            category,
            color,
        } => {
            let last = |category: StatusCategory, statuses: &[BoardStatus]| {
                statuses
                    .iter()
                    .filter(|other| other.category == category)
                    .map(|other| other.position)
                    .fold(-1., f64::max)
                    + 1.
            };
            let moved = category.map(|category| (category, last(category, &data.statuses)));
            let mut now_in = None;
            if let Some(status) = data.statuses.iter_mut().find(|status| &status.id == id) {
                if let Some(name) = name {
                    status.name = name.clone();
                }
                if let Some(color) = color {
                    status.color = color.clone();
                }
                if let Some((category, position)) = moved {
                    if category != status.category {
                        status.category = category;
                        status.position = position;
                    }
                }
                now_in = Some(status.category);
            }
            if category.is_some() {
                let (completed, in_progress) = status_flags(now_in);
                for todo in data.todos.iter_mut() {
                    if todo.status_id.as_deref() == Some(id) {
                        todo.completed = completed;
                        todo.in_progress = in_progress;
                    }
                }
            }
        }
        Command::MoveStatus {
            id,
            target_id,
            placement,
        } => {
            let Some(moving) = data.statuses.iter().find(|status| &status.id == id) else { return };
            let Some(target) = data.statuses.iter().find(|status| &status.id == target_id) else { return };
            if moving.category != target.category {
                return;
            }
            let category = moving.category;
            let group: Vec<BoardStatus> = data
                .statuses
                .iter()
                .filter(|status| status.category == category)
                .cloned()
                .collect();
            let ids: Vec<String> = sort_statuses(&group).into_iter().map(|status| status.id).collect();
            let order = reorder_ids(&ids, id, target_id, *placement);
            for status in data.statuses.iter_mut() {
                if let Some(position) = order.iter().position(|other| other == &status.id) {
                    status.position = position as f64;
                }
            }
        }
        Command::DeleteStatus { id, replacement_id } => {
            let Some(replacement) = status_by_id(data, Some(replacement_id)).cloned() else { return };
            if id == replacement_id {
                return;
            }
            data.statuses.retain(|status| &status.id != id);
            let (completed, in_progress) = status_flags(Some(replacement.category));
            for todo in data.todos.iter_mut() {
                if todo.status_id.as_deref() == Some(id) {
                    todo.status_id = Some(replacement.id.clone());
                    todo.completed = completed;
                    todo.in_progress = in_progress;
                }
            }
        }
        Command::CreateProject {
            id,
            name,
            description,
            color,
            ..
        } => {
            if data.projects.iter().any(|project| &project.id == id) {
                return;
            }
            let position = data.projects.iter().map(|project| project.position).fold(-1., f64::max) + 1.;
            data.projects.push(BoardProject {
                id: id.clone(),
                name: name.clone(),
                description: description.clone(),
                color: color.clone(),
                position,
            });
        }
        Command::UpdateProject {
            id,
            name,
            description,
            color,
        } => {
            if let Some(project) = data.projects.iter_mut().find(|project| &project.id == id) {
                if let Some(name) = name {
                    project.name = name.clone();
                }
                if let Some(description) = description {
                    project.description = description.clone();
                }
                if let Some(color) = color {
                    project.color = color.clone();
                }
            }
        }
        Command::DeleteProject { id } => {
            data.projects.retain(|project| &project.id != id);
            for todo in data.todos.iter_mut() {
                if todo.project_id.as_deref() == Some(id) {
                    todo.project_id = None;
                }
            }
        }
        Command::CreateList { id, name, kind, .. } => {
            if data.lists.iter().any(|list| &list.id == id) {
                return;
            }
            data.lists.push(TodoList {
                id: id.clone(),
                name: name.clone(),
                kind: *kind,
                created_at: now(),
                role: ListRole::Owner,
            });
        }
        Command::RenameList { id, name } => {
            if let Some(list) = data.lists.iter_mut().find(|list| &list.id == id) {
                list.name = name.clone();
            }
        }
        Command::DeleteList { id } => {
            data.lists.retain(|list| &list.id != id);
            data.todos.retain(|todo| &todo.list_id != id);
        }
        Command::CreateTodo { id, list_id, title } => {
            if data.todos.iter().any(|todo| &todo.id == id) {
                return;
            }
            let position = data
                .todos
                .iter()
                .filter(|todo| &todo.list_id == list_id)
                .map(|todo| todo.position)
                .fold(0., f64::min)
                - 1.;
            data.todos.push(Todo {
                id: id.clone(),
                list_id: list_id.clone(),
                title: title.clone(),
                position,
                created_at: now(),
                ..Todo::default()
            });
        }
        Command::UpdateTodo {
            id,
            title,
            completed,
            in_progress,
        } => {
            if let Some(todo) = data.todos.iter_mut().find(|todo| &todo.id == id) {
                if let Some(title) = title {
                    todo.title = title.clone();
                }
                // todo-core's `taskStatePatch`: either flag given sets both.
                if completed.is_some() || in_progress.is_some() {
                    todo.completed = completed.unwrap_or(false);
                    todo.in_progress = in_progress.unwrap_or(false);
                }
            }
        }
        Command::MoveTodo {
            id,
            target_id,
            placement,
        } => move_todo(&mut data.todos, id, target_id, *placement),
        Command::MoveList {
            id,
            target_id,
            placement,
        } => move_list(&mut data.lists, id, target_id, *placement),
        Command::DeleteTodo { id } => {
            let gone = issue_with_descendants(&data.todos, id);
            data.todos.retain(|todo| !gone.contains(&todo.id));
        }
        Command::ClearDone { list_id } => {
            data.todos.retain(|todo| &todo.list_id != list_id || !todo.completed);
        }
    }
}

/// use-workspace.ts `data`: the server's workspace with every change that is
/// not saved yet on top, in the order they were made. A change that failed
/// has left the queue, so what it showed is gone again.
pub fn shown<'a>(server: &WorkspaceData, queued: impl IntoIterator<Item = &'a Command>) -> WorkspaceData {
    let mut data = server.clone();
    for command in queued {
        optimistic_update(&mut data, command);
    }
    data
}

/// Lists of the kind Even doen shows: notes live in Even noteren.
pub fn shown_lists(data: &WorkspaceData) -> Vec<TodoList> {
    data.lists.iter().filter(|list| list.kind != ListKind::Note).cloned().collect()
}

/// board.ts `statusForFlags`: the status a simple "done / busy / open" change
/// maps to on a board (what the server does with `update-todo` there).
#[cfg(test)]
fn status_for_flags(statuses: &[BoardStatus], completed: bool, in_progress: bool) -> Option<BoardStatus> {
    let category = if completed {
        StatusCategory::Completed
    } else if in_progress {
        StatusCategory::Started
    } else {
        StatusCategory::Unstarted
    };
    sort_statuses(statuses)
        .into_iter()
        .find(|status| status.category == category)
        .or_else(|| default_status(statuses))
}

/// packages/todo-core/test/workspace.test.ts and board.test.ts, case for case,
/// and every command's JSON against `commandSchema` (workspace.ts),
/// `workspaceCommand` (workspaces.ts) and `sharingCommand` (sharing.ts).
#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use super::super::api::{
        attachment_body, ShareRole, SharingCommand, WorkspaceCommand, WorkspaceRole,
    };
    use super::*;

    fn id(n: u32) -> String {
        format!("00000000-0000-4000-8000-{n:012}")
    }

    fn todo(id: &str, position: f64) -> Todo {
        Todo {
            id: id.into(),
            list_id: "l".into(),
            title: id.into(),
            position,
            ..Todo::default()
        }
    }

    fn list(id: &str, kind: ListKind) -> TodoList {
        TodoList {
            id: id.into(),
            name: id.into(),
            kind,
            created_at: String::new(),
            role: ListRole::Owner,
        }
    }

    fn order(todos: &[Todo]) -> Vec<String> {
        sort_todos(todos.to_vec()).into_iter().map(|todo| todo.id).collect()
    }

    fn apply(data: &WorkspaceData, command: Command) -> WorkspaceData {
        let mut next = data.clone();
        optimistic_update(&mut next, &command);
        next
    }

    fn update_todo(id: &str, title: Option<&str>, completed: Option<bool>, in_progress: Option<bool>) -> Command {
        Command::UpdateTodo {
            id: id.into(),
            title: title.map(str::to_string),
            completed,
            in_progress,
        }
    }

    fn move_todo_command(id: &str, target: &str, placement: Placement) -> Command {
        Command::MoveTodo {
            id: id.into(),
            target_id: target.into(),
            placement,
        }
    }

    // ── workspace.test.ts ──

    /// Two tasks in one list, the second made a day later.
    fn simple() -> WorkspaceData {
        let task = |n: u32, title: &str, created: &str| Todo {
            id: id(n),
            list_id: id(1),
            title: title.into(),
            created_at: created.into(),
            ..Todo::default()
        };
        WorkspaceData {
            lists: vec![TodoList {
                id: id(1),
                name: "Werk".into(),
                kind: ListKind::Todo,
                created_at: "2026-01-01".into(),
                role: ListRole::Owner,
            }],
            todos: vec![task(1, "Eerste taak", "2026-01-01"), task(2, "Tweede taak", "2026-01-02")],
            ..WorkspaceData::default()
        }
    }

    #[test]
    fn shows_newest_tasks_first_while_keeping_completed_tasks_below_open_tasks() {
        let data = simple();
        assert_eq!(order(&data.todos), [id(2), id(1)]);
        let updated = apply(&data, update_todo(&id(2), None, Some(true), None));
        assert_eq!(order(&updated.todos), [id(1), id(2)]);
        let reopened = apply(&updated, update_todo(&id(2), None, Some(false), None));
        assert_eq!(order(&reopened.todos), [id(2), id(1)]);
        assert!(!data.todos[1].completed);
    }

    #[test]
    fn persists_manual_order_keeps_completion_groups_separate_and_prepends_new_tasks() {
        let data = simple();
        let moved = apply(&data, move_todo_command(&id(1), &id(2), Placement::Before));
        assert_eq!(order(&moved.todos), [id(1), id(2)]);
        let added = apply(
            &moved,
            Command::CreateTodo {
                id: id(3),
                list_id: id(1),
                title: "Nieuw".into(),
            },
        );
        assert_eq!(sort_todos(added.todos)[0].title, "Nieuw");
        let done = apply(&moved, update_todo(&id(1), None, Some(true), None));
        // A done task does not move among the open ones.
        let invalid = apply(&done, move_todo_command(&id(1), &id(2), Placement::Before));
        let positions = |data: &WorkspaceData| data.todos.iter().map(|todo| todo.position).collect::<Vec<_>>();
        assert_eq!(positions(&invalid), positions(&done));
        assert_eq!(order(&done.todos), [id(2), id(1)]);
    }

    #[test]
    fn cycles_open_busy_and_done_without_marking_busy_tasks_complete() {
        let data = simple();
        let busy = apply(&data, update_todo(&id(1), None, None, Some(true)));
        assert!(!busy.todos[0].completed && busy.todos[0].in_progress);
        assert_eq!(order(&busy.todos), [id(1), id(2)]);
        let edited = apply(&busy, update_todo(&id(1), Some("Bezig"), None, None));
        assert!(edited.todos[0].in_progress);
        assert_eq!(edited.todos[0].title, "Bezig");
        let done = apply(&edited, update_todo(&id(1), None, Some(true), None));
        assert!(done.todos[0].completed && !done.todos[0].in_progress);
        let reopened = apply(&done, update_todo(&id(1), None, Some(false), None));
        assert!(!reopened.todos[0].completed && !reopened.todos[0].in_progress);
    }

    /// workspace-app.tsx `onToggle`: what the checkbox sends from each state.
    /// The schema refuses `completed` and `inProgress` both true.
    #[test]
    fn the_checkbox_never_sends_done_and_busy_together() {
        for (completed, in_progress) in [(false, false), (false, true), (true, false), (true, true)] {
            let (next_done, next_busy) = (!completed && in_progress, !completed && !in_progress);
            assert!(!(next_done && next_busy));
            let command = update_todo("a", None, Some(next_done), Some(next_busy));
            assert_eq!(
                serde_json::to_value(&command).unwrap(),
                json!({ "type": "update-todo", "id": "a", "completed": next_done, "inProgress": next_busy })
            );
        }
    }

    #[test]
    fn clears_only_the_done_tasks_of_one_list() {
        let mut data = simple();
        data.todos.push(Todo {
            id: id(3),
            list_id: id(2),
            completed: true,
            ..data.todos[0].clone()
        });
        let done = apply(&data, update_todo(&id(1), None, Some(true), None));
        let cleared = apply(&done, Command::ClearDone { list_id: id(1) });
        let left: Vec<String> = cleared.todos.iter().map(|todo| todo.id.clone()).collect();
        assert_eq!(left, [id(2), id(3)]);
    }

    #[test]
    fn does_not_duplicate_a_created_item_when_realtime_refetch_arrives_before_mutation_settles() {
        let data = simple();
        let again = apply(
            &data,
            Command::CreateTodo {
                id: id(1),
                list_id: id(1),
                title: "Eerste taak".into(),
            },
        );
        assert_eq!(again.todos.len(), 2);
        let again = apply(
            &data,
            Command::CreateList {
                id: id(1),
                workspace_id: id(2),
                name: "Werk".into(),
                kind: ListKind::Todo,
            },
        );
        assert_eq!(again.lists.len(), 1);
    }

    #[test]
    fn every_command_twice_is_the_command_once() {
        // use-workspace.ts applies a saved command to the server's data while
        // it may still be in the queue: "applying a command twice is harmless".
        let data = board();
        let commands = [
            Command::CreateIssue {
                id: id(13),
                list_id: id(1),
                title: "New".into(),
                description: None,
                status_id: None,
                project_id: None,
                priority: None,
                parent_id: None,
                assignee_ids: None,
            },
            Command::MoveIssue {
                id: id(10),
                status_id: id(103),
                target_id: Some(id(12)),
                placement: Some(Placement::After),
            },
            Command::DeleteStatus {
                id: id(102),
                replacement_id: id(104),
            },
            Command::CreateStatus {
                id: id(105),
                workspace_id: id(2),
                name: "QA".into(),
                category: StatusCategory::Started,
                color: "#123abc".into(),
            },
            Command::CreateProject {
                id: id(202),
                workspace_id: id(2),
                name: "P".into(),
                description: String::new(),
                color: "#5e6ad2".into(),
            },
            Command::DeleteTodo { id: id(10) },
        ];
        for command in commands {
            let once = apply(&data, command.clone());
            let twice = apply(&once, command.clone());
            assert_eq!(format!("{once:?}"), format!("{twice:?}"), "{command:?}");
        }
    }

    // ── hooks/use-workspace.ts: the queue ──

    #[test]
    fn unsaved_changes_show_in_order_and_a_failed_one_rolls_back() {
        let server = simple();
        let new_list = Command::CreateList {
            id: id(9),
            workspace_id: id(2),
            name: "Nieuw".into(),
            kind: ListKind::Todo,
        };
        let task_in_it = Command::CreateTodo {
            id: id(10),
            list_id: id(9),
            title: "Erin".into(),
        };
        let rename = Command::RenameList {
            id: id(1),
            name: "Anders".into(),
        };
        // A new list, a task in it and a rename wait: all three show at once.
        let queue = vec![new_list.clone(), task_in_it.clone(), rename.clone()];
        let data = shown(&server, &queue);
        assert_eq!(data.lists.len(), 2);
        assert_eq!(data.todos.len(), 3);
        assert_eq!(data.lists[0].name, "Anders");
        // The first one is saved: it is written into the server's data and
        // leaves the queue; nothing on screen changes.
        let mut saved = server.clone();
        optimistic_update(&mut saved, &new_list);
        let after = shown(&saved, &queue[1..]);
        assert_eq!(format!("{:?}", after.lists), format!("{:?}", data.lists));
        assert_eq!(after.todos.len(), 3);
        // The second one fails: it leaves the queue without reaching the
        // server's data, so its task is gone; the rename behind it still shows.
        let after = shown(&saved, &queue[2..]);
        assert_eq!(after.todos.len(), 2);
        assert_eq!(after.lists[0].name, "Anders");
        // The last one fails too: the screen is the server's again.
        let after = shown(&saved, &[]);
        assert_eq!(after.lists[0].name, "Werk");
        assert_eq!(server.lists[0].name, "Werk");
    }

    // ── "list order" ──

    #[test]
    fn moves_an_id_before_or_after_a_target() {
        let ids: Vec<String> = ["a", "b", "c", "d"].iter().map(|id| id.to_string()).collect();
        assert_eq!(reorder_ids(&ids, "d", "a", Placement::Before), ["d", "a", "b", "c"]);
        assert_eq!(reorder_ids(&ids, "a", "c", Placement::After), ["b", "c", "a", "d"]);
        assert_eq!(reorder_ids(&ids, "a", "x", Placement::After), ids);
    }

    #[test]
    fn reorders_only_within_the_same_kind_and_keeps_other_sections_in_place() {
        let lists = vec![
            list("t1", ListKind::Todo),
            list("n1", ListKind::Note),
            list("t2", ListKind::Todo),
            list("t3", ListKind::Todo),
            list("n2", ListKind::Note),
        ];
        let ids = |lists: &[TodoList]| lists.iter().map(|list| list.id.clone()).collect::<Vec<_>>();
        let mut moved = lists.clone();
        move_list(&mut moved, "t3", "t1", Placement::Before);
        assert_eq!(ids(&moved), ["t3", "n1", "t1", "t2", "n2"]);
        let mut same = lists.clone();
        move_list(&mut same, "t1", "n1", Placement::Before);
        assert_eq!(ids(&same), ids(&lists));
    }

    #[test]
    fn a_new_task_goes_on_top() {
        let mut data = WorkspaceData {
            todos: vec![todo("a", 0.), todo("b", 1.)],
            ..WorkspaceData::default()
        };
        optimistic_update(
            &mut data,
            &Command::CreateTodo {
                id: "c".into(),
                list_id: "l".into(),
                title: "c".into(),
            },
        );
        assert_eq!(order(&data.todos), ["c", "a", "b"]);
    }

    #[test]
    fn moving_a_task_renumbers_its_list() {
        let mut data = WorkspaceData {
            todos: vec![todo("a", 0.), todo("b", 1.), todo("c", 2.)],
            ..WorkspaceData::default()
        };
        optimistic_update(&mut data, &move_todo_command("a", "c", Placement::After));
        assert_eq!(order(&data.todos), ["b", "c", "a"]);
    }

    // ── board.test.ts ──

    fn statuses() -> Vec<BoardStatus> {
        let status = |n: u32, name: &str, category, color: &str, position: f64| BoardStatus {
            id: id(n),
            name: name.into(),
            category,
            color: color.into(),
            position,
        };
        vec![
            status(101, "Backlog", StatusCategory::Backlog, "#95a2b3", 0.),
            status(102, "Todo", StatusCategory::Unstarted, "#e2e2e2", 1.),
            status(103, "In Progress", StatusCategory::Started, "#f2c94c", 2.),
            status(104, "Done", StatusCategory::Completed, "#5e6ad2", 3.),
        ]
    }

    fn issue(n: u32, status: u32, position: f64) -> Todo {
        Todo {
            id: id(n),
            list_id: id(1),
            title: format!("Issue {n}"),
            position,
            created_at: "2026-01-01".into(),
            number: Some(n),
            description: Some(String::new()),
            status_id: Some(id(status)),
            priority: Some(0),
            ..Todo::default()
        }
    }

    fn board() -> WorkspaceData {
        WorkspaceData {
            lists: vec![TodoList {
                id: id(1),
                name: "Website".into(),
                kind: ListKind::Board,
                created_at: "2026-01-01".into(),
                role: ListRole::Owner,
            }],
            todos: vec![issue(10, 102, 0.), issue(11, 102, 1.), issue(12, 103, 0.)],
            statuses: statuses(),
            projects: vec![BoardProject {
                id: id(201),
                name: "Launch".into(),
                description: String::new(),
                color: "#5e6ad2".into(),
                position: 0.,
            }],
            members: Vec::new(),
        }
    }

    fn create_issue(n: u32, title: &str, parent: Option<u32>) -> Command {
        Command::CreateIssue {
            id: id(n),
            list_id: id(1),
            title: title.into(),
            description: None,
            status_id: None,
            project_id: None,
            priority: None,
            parent_id: parent.map(id),
            assignee_ids: None,
        }
    }

    fn update_issue(n: u32, change: impl FnOnce(&mut Command)) -> Command {
        let mut command = Command::update_issue(&id(n));
        change(&mut command);
        command
    }

    #[test]
    fn starts_new_issues_in_the_first_unstarted_status_with_the_next_number() {
        let data = board();
        assert_eq!(default_status(&data.statuses).map(|status| status.id), Some(id(102)));
        let next = apply(&data, create_issue(13, "New", None));
        let created = next.todos.iter().find(|todo| todo.id == id(13)).unwrap();
        assert_eq!(created.status_id, Some(id(102)));
        assert_eq!(created.number, Some(13));
        assert!(!created.completed);
        // On top of its column, as the server puts it (`min(0, …) - 1`).
        assert_eq!(created.position, -1.);
    }

    #[test]
    fn moves_an_issue_into_another_column_at_the_given_spot_and_syncs_done_flags() {
        let data = board();
        let moved = apply(
            &data,
            Command::MoveIssue {
                id: id(10),
                status_id: id(103),
                target_id: Some(id(12)),
                placement: Some(Placement::After),
            },
        );
        let column: Vec<String> = sort_issues(
            moved
                .todos
                .iter()
                .filter(|todo| todo.status_id == Some(id(103)))
                .cloned()
                .collect(),
        )
        .into_iter()
        .map(|todo| todo.id)
        .collect();
        assert_eq!(column, [id(12), id(10)]);
        let ten = moved.todos.iter().find(|todo| todo.id == id(10)).unwrap();
        assert!(ten.in_progress && !ten.completed);
        let done = apply(
            &data,
            update_issue(11, |command| {
                if let Command::UpdateIssue { status_id, .. } = command {
                    *status_id = Some(id(104));
                }
            }),
        );
        assert!(done.todos.iter().find(|todo| todo.id == id(11)).unwrap().completed);
    }

    #[test]
    fn an_issue_dropped_on_an_empty_column_goes_on_top() {
        let data = board();
        let moved = apply(
            &data,
            Command::MoveIssue {
                id: id(10),
                status_id: id(104),
                target_id: None,
                placement: None,
            },
        );
        let ten = moved.todos.iter().find(|todo| todo.id == id(10)).unwrap();
        assert_eq!((ten.status_id.clone(), ten.position, ten.completed), (Some(id(104)), 0., true));
        // A status the workspace does not have changes nothing.
        let nowhere = apply(
            &data,
            Command::MoveIssue {
                id: id(10),
                status_id: id(999),
                target_id: None,
                placement: None,
            },
        );
        assert_eq!(format!("{nowhere:?}"), format!("{data:?}"));
    }

    #[test]
    fn deletes_sub_issues_with_their_parent() {
        let data = board();
        let with_child = apply(&data, create_issue(20, "Child", Some(10)));
        let grandchild = apply(&with_child, create_issue(21, "Grandchild", Some(20)));
        let after = apply(&grandchild, Command::DeleteTodo { id: id(10) });
        let left: Vec<String> = after.todos.iter().map(|todo| todo.id.clone()).collect();
        assert_eq!(left, [id(11), id(12)]);
    }

    #[test]
    fn moves_issues_to_the_replacement_when_a_status_is_deleted() {
        let data = board();
        let after = apply(
            &data,
            Command::DeleteStatus {
                id: id(102),
                replacement_id: id(104),
            },
        );
        assert!(!after.statuses.iter().any(|status| status.id == id(102)));
        let moved = after
            .todos
            .iter()
            .filter(|todo| todo.status_id == Some(id(104)) && todo.completed)
            .count();
        assert_eq!(moved, 2);
    }

    #[test]
    fn clears_the_project_from_issues_when_it_is_deleted() {
        let data = board();
        let tagged = apply(
            &data,
            update_issue(10, |command| {
                if let Command::UpdateIssue { project_id, .. } = command {
                    *project_id = Some(Some(id(201)));
                }
            }),
        );
        assert_eq!(tagged.todos[0].project_id, Some(id(201)));
        let cleared = apply(&tagged, Command::DeleteProject { id: id(201) });
        assert_eq!(cleared.todos[0].project_id, None);
        // "No project" from the menu: `projectId: null`.
        let none = apply(
            &tagged,
            update_issue(10, |command| {
                if let Command::UpdateIssue { project_id, .. } = command {
                    *project_id = Some(None);
                }
            }),
        );
        assert_eq!(none.todos[0].project_id, None);
    }

    #[test]
    fn maps_simple_done_and_busy_changes_to_a_status() {
        let statuses = statuses();
        assert_eq!(status_for_flags(&statuses, true, false).map(|status| status.id), Some(id(104)));
        assert_eq!(status_for_flags(&statuses, false, true).map(|status| status.id), Some(id(103)));
    }

    #[test]
    fn a_status_in_another_category_goes_last_there_and_takes_its_issues_flags() {
        let data = board();
        let after = apply(
            &data,
            Command::UpdateStatus {
                id: id(102),
                name: None,
                category: Some(StatusCategory::Completed),
                color: None,
            },
        );
        let status = after.statuses.iter().find(|status| status.id == id(102)).unwrap();
        assert_eq!((status.category, status.position), (StatusCategory::Completed, 4.));
        assert!(after.todos.iter().filter(|todo| todo.status_id == Some(id(102))).all(|todo| todo.completed));
        // The same category again moves nothing.
        let same = apply(
            &data,
            Command::UpdateStatus {
                id: id(102),
                name: None,
                category: Some(StatusCategory::Unstarted),
                color: None,
            },
        );
        assert_eq!(same.statuses[1].position, 1.);
    }

    // ── The JSON each command is sent as ──

    fn sent(command: &impl serde::Serialize) -> Value {
        serde_json::to_value(command).unwrap()
    }

    /// The keys `commandSchema` knows per command type, and which it requires.
    /// Kept beside the schema in packages/todo-core/src/workspace.ts.
    fn schema(kind: &str) -> (&'static [&'static str], &'static [&'static str]) {
        match kind {
            "create-list" => (&["id", "workspaceId", "name"], &["kind"]),
            "rename-list" => (&["id", "name"], &[]),
            "delete-list" | "delete-todo" | "delete-attachment" | "delete-project" => (&["id"], &[]),
            "create-todo" => (&["id", "listId", "title"], &[]),
            "update-todo" => (&["id"], &["title", "completed", "inProgress"]),
            "clear-done" => (&["listId"], &[]),
            "move-todo" | "move-list" | "move-status" => (&["id", "targetId", "placement"], &[]),
            "create-issue" => (
                &["id", "listId", "title"],
                &["description", "statusId", "projectId", "priority", "parentId", "assigneeIds"],
            ),
            "update-issue" => (
                &["id"],
                &["title", "description", "statusId", "projectId", "priority", "assigneeIds"],
            ),
            "move-issue" => (&["id", "statusId"], &["targetId", "placement"]),
            "create-status" => (&["id", "workspaceId", "name", "category", "color"], &[]),
            "update-status" => (&["id"], &["name", "category", "color"]),
            "delete-status" => (&["id", "replacementId"], &[]),
            "create-project" => (&["id", "workspaceId", "name", "color"], &["description"]),
            "update-project" => (&["id"], &["name", "description", "color"]),
            other => panic!("a command the schema does not know: {other}"),
        }
    }

    /// Every key is one the schema knows, every required one is there, and
    /// nothing optional is sent as `null` (only `projectId` may be).
    fn check(command: &Command) -> Value {
        let value = sent(command);
        let object = value.as_object().unwrap();
        let kind = object["type"].as_str().unwrap();
        let (required, optional) = schema(kind);
        for key in required {
            assert!(object.contains_key(*key), "{kind} lacks {key}");
        }
        for (key, value) in object {
            if key == "type" {
                continue;
            }
            assert!(
                required.contains(&key.as_str()) || optional.contains(&key.as_str()),
                "{kind} sends {key}, which the schema does not know"
            );
            assert!(!value.is_null() || key == "projectId", "{kind} sends {key}: null");
        }
        value
    }

    #[test]
    fn list_and_task_commands_have_the_schema_shape() {
        assert_eq!(
            check(&Command::CreateList {
                id: id(1),
                workspace_id: id(2),
                name: "Bord".into(),
                kind: ListKind::Board,
            }),
            json!({ "type": "create-list", "id": id(1), "workspaceId": id(2), "name": "Bord", "kind": "board" })
        );
        assert_eq!(
            check(&Command::CreateList {
                id: id(1),
                workspace_id: id(2),
                name: "Lijst".into(),
                kind: ListKind::Todo,
            })["kind"],
            "todo"
        );
        assert_eq!(
            check(&Command::RenameList {
                id: id(1),
                name: "Werk".into(),
            }),
            json!({ "type": "rename-list", "id": id(1), "name": "Werk" })
        );
        assert_eq!(check(&Command::DeleteList { id: id(1) }), json!({ "type": "delete-list", "id": id(1) }));
        assert_eq!(
            check(&Command::MoveList {
                id: id(1),
                target_id: id(2),
                placement: Placement::Before,
            }),
            json!({ "type": "move-list", "id": id(1), "targetId": id(2), "placement": "before" })
        );
        assert_eq!(
            check(&Command::CreateTodo {
                id: id(3),
                list_id: id(1),
                title: "Taak".into(),
            }),
            json!({ "type": "create-todo", "id": id(3), "listId": id(1), "title": "Taak" })
        );
        assert_eq!(
            check(&update_todo(&id(3), Some("Anders"), None, None)),
            json!({ "type": "update-todo", "id": id(3), "title": "Anders" })
        );
        assert_eq!(
            check(&update_todo(&id(3), None, Some(false), Some(true))),
            json!({ "type": "update-todo", "id": id(3), "completed": false, "inProgress": true })
        );
        assert_eq!(check(&Command::DeleteTodo { id: id(3) }), json!({ "type": "delete-todo", "id": id(3) }));
        assert_eq!(
            check(&Command::ClearDone { list_id: id(1) }),
            json!({ "type": "clear-done", "listId": id(1) })
        );
        assert_eq!(
            check(&move_todo_command(&id(3), &id(4), Placement::After)),
            json!({ "type": "move-todo", "id": id(3), "targetId": id(4), "placement": "after" })
        );
    }

    #[test]
    fn issue_commands_have_the_schema_shape() {
        // board-view.tsx `submit`: the new issue dialog.
        assert_eq!(
            check(&Command::CreateIssue {
                id: id(13),
                list_id: id(1),
                title: "Nieuw".into(),
                description: Some("Tekst".into()),
                status_id: Some(id(102)),
                project_id: Some(id(201)),
                priority: Some(2),
                parent_id: None,
                assignee_ids: Some(vec!["Zhf2K7IoU5vymB9KkQUiWQgS9a1hi4fF".into()]),
            }),
            json!({
                "type": "create-issue", "id": id(13), "listId": id(1), "title": "Nieuw",
                "description": "Tekst", "statusId": id(102), "projectId": id(201), "priority": 2,
                "assigneeIds": ["Zhf2K7IoU5vymB9KkQUiWQgS9a1hi4fF"],
            })
        );
        // issue-detail.tsx `addChild`: `projectId: issue.projectId ?? null`.
        assert_eq!(
            check(&create_issue(20, "Kind", Some(10))),
            json!({ "type": "create-issue", "id": id(20), "listId": id(1), "title": "Kind", "projectId": null, "parentId": id(10) })
        );
        // One field at a time, the others absent.
        assert_eq!(check(&Command::update_issue(&id(10))), json!({ "type": "update-issue", "id": id(10) }));
        let field = |change: fn(&mut Command)| {
            let value = check(&update_issue(10, change));
            let mut keys: Vec<String> = value.as_object().unwrap().keys().cloned().collect();
            keys.retain(|key| key != "type" && key != "id");
            (keys, value)
        };
        let (keys, value) = field(|command| {
            if let Command::UpdateIssue { title, .. } = command {
                *title = Some("T".into());
            }
        });
        assert_eq!((keys, &value["title"]), (vec!["title".to_string()], &json!("T")));
        let (keys, value) = field(|command| {
            if let Command::UpdateIssue { description, .. } = command {
                *description = Some(String::new());
            }
        });
        // An emptied description is sent as "", not left out.
        assert_eq!((keys, &value["description"]), (vec!["description".to_string()], &json!("")));
        let (keys, value) = field(|command| {
            if let Command::UpdateIssue { project_id, .. } = command {
                *project_id = Some(None);
            }
        });
        assert_eq!((keys, &value["projectId"]), (vec!["projectId".to_string()], &Value::Null));
        let (keys, value) = field(|command| {
            if let Command::UpdateIssue { priority, .. } = command {
                *priority = Some(0);
            }
        });
        assert_eq!((keys, &value["priority"]), (vec!["priority".to_string()], &json!(0)));
        let (keys, value) = field(|command| {
            if let Command::UpdateIssue { assignee_ids, .. } = command {
                *assignee_ids = Some(Vec::new());
            }
        });
        // Nobody assigned any more is an empty list, not an absent one.
        assert_eq!((keys, &value["assigneeIds"]), (vec!["assigneeIds".to_string()], &json!([])));
        assert_eq!(
            check(&Command::MoveIssue {
                id: id(10),
                status_id: id(103),
                target_id: Some(id(12)),
                placement: Some(Placement::After),
            }),
            json!({ "type": "move-issue", "id": id(10), "statusId": id(103), "targetId": id(12), "placement": "after" })
        );
        assert_eq!(
            check(&Command::MoveIssue {
                id: id(10),
                status_id: id(104),
                target_id: None,
                placement: None,
            }),
            json!({ "type": "move-issue", "id": id(10), "statusId": id(104) })
        );
        assert_eq!(
            check(&Command::DeleteAttachment { id: id(300) }),
            json!({ "type": "delete-attachment", "id": id(300) })
        );
    }

    #[test]
    fn board_settings_commands_have_the_schema_shape() {
        assert_eq!(
            check(&Command::CreateStatus {
                id: id(1),
                workspace_id: id(2),
                name: "QA".into(),
                category: StatusCategory::Started,
                color: "#123abc".into(),
            }),
            json!({ "type": "create-status", "id": id(1), "workspaceId": id(2), "name": "QA", "category": "started", "color": "#123abc" })
        );
        for (category, word) in StatusCategory::ALL
            .into_iter()
            .zip(["backlog", "unstarted", "started", "completed", "canceled"])
        {
            assert_eq!(
                check(&Command::UpdateStatus {
                    id: id(1),
                    name: None,
                    category: Some(category),
                    color: None,
                }),
                json!({ "type": "update-status", "id": id(1), "category": word })
            );
        }
        assert_eq!(
            check(&Command::UpdateStatus {
                id: id(1),
                name: Some("Klaar".into()),
                category: None,
                color: None,
            }),
            json!({ "type": "update-status", "id": id(1), "name": "Klaar" })
        );
        assert_eq!(
            check(&Command::MoveStatus {
                id: id(1),
                target_id: id(2),
                placement: Placement::Before,
            }),
            json!({ "type": "move-status", "id": id(1), "targetId": id(2), "placement": "before" })
        );
        assert_eq!(
            check(&Command::DeleteStatus {
                id: id(1),
                replacement_id: id(2),
            }),
            json!({ "type": "delete-status", "id": id(1), "replacementId": id(2) })
        );
        assert_eq!(
            check(&Command::CreateProject {
                id: id(1),
                workspace_id: id(2),
                name: "Launch".into(),
                description: String::new(),
                color: "#5e6ad2".into(),
            }),
            json!({ "type": "create-project", "id": id(1), "workspaceId": id(2), "name": "Launch", "description": "", "color": "#5e6ad2" })
        );
        assert_eq!(
            check(&Command::UpdateProject {
                id: id(1),
                name: None,
                description: None,
                color: Some("#26b5ce".into()),
            }),
            json!({ "type": "update-project", "id": id(1), "color": "#26b5ce" })
        );
        assert_eq!(check(&Command::DeleteProject { id: id(1) }), json!({ "type": "delete-project", "id": id(1) }));
        // The colours offered are ones the schema's `#rrggbb` takes.
        for color in STATUS_COLORS.iter().chain(PROJECT_COLORS.iter()) {
            assert!(color.len() == 7 && color.starts_with('#') && color[1..].chars().all(|c| c.is_ascii_hexdigit()));
        }
    }

    #[test]
    fn workspace_commands_have_the_schema_shape() {
        let (workspace, other) = (id(3), id(4));
        assert_eq!(
            sent(&WorkspaceCommand::Create {
                id: workspace.clone(),
                name: "Werk".into(),
            }),
            json!({ "type": "create", "id": workspace, "name": "Werk" })
        );
        assert_eq!(
            sent(&WorkspaceCommand::Rename {
                workspace_id: workspace.clone(),
                name: "Thuis".into(),
            }),
            json!({ "type": "rename", "workspaceId": workspace, "name": "Thuis" })
        );
        assert_eq!(
            sent(&WorkspaceCommand::Delete {
                workspace_id: workspace.clone(),
            }),
            json!({ "type": "delete", "workspaceId": workspace })
        );
        assert_eq!(
            sent(&WorkspaceCommand::Leave {
                workspace_id: workspace.clone(),
            }),
            json!({ "type": "leave", "workspaceId": workspace })
        );
        assert_eq!(
            sent(&WorkspaceCommand::Invite {
                workspace_id: workspace.clone(),
                email: "a@b.nl".into(),
                role: WorkspaceRole::Admin,
            }),
            json!({ "type": "invite", "workspaceId": workspace, "email": "a@b.nl", "role": "admin" })
        );
        assert_eq!(
            sent(&WorkspaceCommand::UpdateMember {
                workspace_id: workspace.clone(),
                member_id: other.clone(),
                role: WorkspaceRole::Member,
            }),
            json!({ "type": "update-member", "workspaceId": workspace, "memberId": other, "role": "member" })
        );
        assert_eq!(
            sent(&WorkspaceCommand::RemoveMember {
                workspace_id: workspace.clone(),
                member_id: other.clone(),
            }),
            json!({ "type": "remove-member", "workspaceId": workspace, "memberId": other })
        );
        assert_eq!(
            sent(&WorkspaceCommand::RevokeInvite {
                workspace_id: workspace.clone(),
                invitation_id: other.clone(),
            }),
            json!({ "type": "revoke-invite", "workspaceId": workspace, "invitationId": other })
        );
    }

    /// workspace.test.ts "never assigns ownership through invites or role changes".
    #[test]
    fn never_assigns_ownership_through_invites_or_role_changes() {
        let invite = sent(&WorkspaceCommand::Invite {
            workspace_id: id(3),
            email: "a@b.nl".into(),
            role: WorkspaceRole::Owner,
        });
        assert_eq!(invite["role"], "member");
        let update = sent(&WorkspaceCommand::UpdateMember {
            workspace_id: id(3),
            member_id: id(4),
            role: WorkspaceRole::Owner,
        });
        assert_eq!(update["role"], "member");
    }

    #[test]
    fn lets_owners_and_admins_manage_not_members() {
        assert!(WorkspaceRole::Owner.can_manage());
        assert!(WorkspaceRole::Admin.can_manage());
        assert!(!WorkspaceRole::Member.can_manage());
    }

    #[test]
    fn sharing_commands_have_the_schema_shape() {
        assert_eq!(
            sent(&SharingCommand::EnableLink {
                list_id: id(1),
                role: ShareRole::Editor,
            }),
            json!({ "type": "enable-link", "listId": id(1), "role": "editor" })
        );
        assert_eq!(
            sent(&SharingCommand::EnableLink {
                list_id: id(1),
                role: ShareRole::Viewer,
            })["role"],
            "viewer"
        );
        assert_eq!(
            sent(&SharingCommand::RevokeLink { list_id: id(1) }),
            json!({ "type": "revoke-link", "listId": id(1) })
        );
    }

    /// routes.ts `attachmentBody` and lib/attachments.ts `uploadAttachment`.
    #[test]
    fn an_upload_is_announced_as_the_api_reads_it() {
        assert_eq!(
            attachment_body(&id(10), "Foto.PNG", 1234),
            json!({ "todoId": id(10), "name": "Foto.PNG", "contentType": "image/png", "size": 1234 })
        );
        // The web's `file.type || "application/octet-stream"`.
        assert_eq!(attachment_body(&id(10), "notes", 0)["contentType"], "application/octet-stream");
    }

    #[test]
    fn reads_a_workspace_as_the_api_writes_it() {
        // workspace-server.ts `readWorkspace`: a plain list has no `kind`, a
        // simple task no board fields, an issue all of them.
        let data: WorkspaceData = serde_json::from_value(json!({
            "statuses": [{ "id": id(101), "name": "Todo", "category": "unstarted", "color": "#a1a1aa", "position": 0 }],
            "projects": [],
            "members": [{ "id": "u1", "name": "Jan", "email": "jan@example.nl", "image": null }],
            "lists": [
                { "id": id(1), "name": "Werk", "createdAt": "2026-01-01T00:00:00.000Z", "role": "owner" },
                { "id": id(2), "name": "Bord", "kind": "board", "createdAt": "2026-01-01T00:00:00.000Z", "role": "owner" },
            ],
            "todos": [
                { "id": id(3), "listId": id(1), "title": "Taak", "completed": false, "inProgress": true, "position": -1,
                  "createdAt": "2026-01-01T00:00:00.000Z",
                  "mail": { "subject": "Hoi", "from": null, "url": null } },
                { "id": id(4), "listId": id(2), "title": "Issue", "completed": false, "inProgress": false, "position": 0,
                  "createdAt": "2026-01-01T00:00:00.000Z", "number": 7, "description": "", "statusId": id(101),
                  "priority": 2, "assigneeIds": ["u1"],
                  "attachments": [{ "id": id(5), "name": "a.png", "contentType": "image/png", "size": 10,
                                    "createdAt": "2026-01-01T00:00:00.000Z" }] },
            ],
        }))
        .unwrap();
        assert_eq!(data.lists[0].kind, ListKind::Todo);
        assert_eq!(data.lists[1].kind, ListKind::Board);
        assert!(data.todos[0].in_progress && data.todos[0].number.is_none());
        assert_eq!(data.todos[1].number, Some(7));
        assert_eq!(data.todos[1].attachments[0].content_type, "image/png");
        assert_eq!(data.members[0].image, None);
    }
}
