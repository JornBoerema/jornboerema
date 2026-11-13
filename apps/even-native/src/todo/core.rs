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

/// Lists of the kind Even doen shows: notes live in Even noteren.
pub fn shown_lists(data: &WorkspaceData) -> Vec<TodoList> {
    data.lists.iter().filter(|list| list.kind != ListKind::Note).cloned().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn todo(id: &str, position: f64) -> Todo {
        Todo {
            id: id.into(),
            list_id: "l".into(),
            title: id.into(),
            position,
            ..Todo::default()
        }
    }

    #[test]
    fn reorders_ids_before_and_after() {
        let ids: Vec<String> = ["a", "b", "c"].iter().map(|id| id.to_string()).collect();
        assert_eq!(reorder_ids(&ids, "c", "a", Placement::Before), ["c", "a", "b"]);
        assert_eq!(reorder_ids(&ids, "a", "b", Placement::After), ["b", "a", "c"]);
        assert_eq!(reorder_ids(&ids, "a", "x", Placement::After), ["a", "b", "c"]);
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
        let order: Vec<String> = sort_todos(data.todos).into_iter().map(|todo| todo.id).collect();
        assert_eq!(order, ["c", "a", "b"]);
    }

    #[test]
    fn moving_a_task_renumbers_its_list() {
        let mut data = WorkspaceData {
            todos: vec![todo("a", 0.), todo("b", 1.), todo("c", 2.)],
            ..WorkspaceData::default()
        };
        optimistic_update(
            &mut data,
            &Command::MoveTodo {
                id: "a".into(),
                target_id: "c".into(),
                placement: Placement::After,
            },
        );
        let order: Vec<String> = sort_todos(data.todos).into_iter().map(|todo| todo.id).collect();
        assert_eq!(order, ["b", "c", "a"]);
    }

    #[test]
    fn commands_have_the_schema_shape() {
        let command = Command::UpdateTodo {
            id: "a".into(),
            title: None,
            completed: Some(false),
            in_progress: Some(true),
        };
        assert_eq!(
            serde_json::to_string(&command).unwrap(),
            r#"{"type":"update-todo","id":"a","completed":false,"inProgress":true}"#
        );
        let command = Command::MoveIssue {
            id: "a".into(),
            status_id: "s".into(),
            target_id: None,
            placement: None,
        };
        assert_eq!(
            serde_json::to_string(&command).unwrap(),
            r#"{"type":"move-issue","id":"a","statusId":"s"}"#
        );
    }
}
