//! Even noteren's part of the Even API: the workspaces, their lists (a note is
//! a list of kind "note"), the commands that change them and the public link.
//! The shapes are packages/todo-core/src (workspace.ts, workspaces.ts,
//! sharing.ts); the routes apps/api/src/todo/routes.ts. Blocking, as `Client`.

use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::api::{ApiError, Client, Unauthorized};

/// A note may hold this many characters (UTF-16 units, as the web counts).
pub const MAX_NOTE: usize = 100_000;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Note {
    pub markdown: String,
    pub version: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ListRole {
    Owner,
    Editor,
    Viewer,
}

/// `TodoList`: a task list, a board or a note. Even noteren shows the notes.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct List {
    pub id: String,
    pub name: String,
    /// Absent for a plain task list.
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub note: Option<Note>,
    pub role: ListRole,
}

impl List {
    fn kind(&self) -> &str {
        self.kind.as_deref().unwrap_or("todo")
    }

    pub fn is_note(&self) -> bool {
        self.kind() == "note"
    }

    pub fn markdown(&self) -> &str {
        self.note.as_ref().map_or("", |note| note.markdown.as_str())
    }
}

/// `WorkspaceData`, as far as the notes need it: the lists in display order.
#[derive(Clone, Debug, Deserialize)]
pub struct WorkspaceData {
    pub lists: Vec<List>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSummary {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub member_count: u32,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Placement {
    Before,
    After,
}

/// The commands of `commandSchema` a note takes.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Command {
    #[serde(rename_all = "camelCase")]
    CreateList {
        id: String,
        workspace_id: String,
        name: String,
        kind: &'static str,
    },
    RenameList {
        id: String,
        name: String,
    },
    DeleteList {
        id: String,
    },
    #[serde(rename_all = "camelCase")]
    MoveList {
        id: String,
        target_id: String,
        placement: Placement,
    },
    UpdateNote {
        id: String,
        markdown: String,
        version: u64,
    },
}

/// `optimisticUpdate`: what a command does to the lists, before and after the
/// server has it. Applying one twice changes nothing more.
pub fn apply(lists: &mut Vec<List>, command: &Command) {
    match command {
        Command::CreateList { id, name, kind, .. } => {
            if lists.iter().any(|list| list.id == *id) {
                return;
            }
            lists.push(List {
                id: id.clone(),
                name: name.clone(),
                kind: (*kind != "todo").then(|| kind.to_string()),
                note: (*kind == "note").then(|| Note {
                    markdown: String::new(),
                    version: 0,
                }),
                role: ListRole::Owner,
            });
        }
        Command::RenameList { id, name } => {
            if let Some(list) = lists.iter_mut().find(|list| list.id == *id) {
                list.name = name.clone();
            }
        }
        Command::DeleteList { id } => lists.retain(|list| list.id != *id),
        Command::MoveList {
            id,
            target_id,
            placement,
        } => move_list(lists, id, target_id, *placement),
        Command::UpdateNote { id, markdown, version } => {
            if let Some(list) = lists.iter_mut().find(|list| list.id == *id) {
                list.note = Some(Note {
                    markdown: markdown.clone(),
                    version: version + 1,
                });
            }
        }
    }
}

/// `moveList`: lists are ordered within their kind; the other kinds keep their places.
fn move_list(lists: &mut [List], id: &str, target_id: &str, placement: Placement) {
    let kind_of = |wanted: &str| lists.iter().find(|list| list.id == wanted).map(|list| list.kind().to_string());
    let (Some(kind), Some(target_kind)) = (kind_of(id), kind_of(target_id)) else {
        return;
    };
    if kind != target_kind || id == target_id {
        return;
    }
    let places: Vec<usize> = (0..lists.len()).filter(|&index| lists[index].kind() == kind).collect();
    let mut section: Vec<List> = places.iter().map(|&index| lists[index].clone()).collect();
    let Some(from) = section.iter().position(|list| list.id == id) else {
        return;
    };
    let moving = section.remove(from);
    let Some(target) = section.iter().position(|list| list.id == target_id) else {
        return;
    };
    section.insert(target + usize::from(placement == Placement::After), moving);
    for (place, list) in places.into_iter().zip(section) {
        lists[place] = list;
    }
}

/// `SharingData`: the public link to one list, if it has one.
#[derive(Clone, Debug, Deserialize)]
pub struct Sharing {
    pub link: Option<Link>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Link {
    pub token: String,
    pub role: LinkRole,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LinkRole {
    Viewer,
    Editor,
}

/// Where a public link opens: Even noteren on the web. The desktop app has
/// no address of its own (the Tauri app's `VITE_NOTES_WEB_URL`).
pub fn notes_web_url() -> String {
    std::env::var("EVEN_NOTES_URL")
        .unwrap_or_else(|_| "https://notes.jornboerema.nl".into())
        .trim_end_matches('/')
        .to_string()
}

pub fn workspaces(client: &Client) -> Result<Vec<WorkspaceSummary>> {
    client.get_json("/api/workspaces")
}

pub fn workspace(client: &Client, workspace_id: &str) -> Result<WorkspaceData> {
    client.get_query("/api/workspace", &[("workspaceId", workspace_id)])
}

/// Whether the API pushes changes (Ably), or the app only asks now and then.
pub fn realtime_enabled(client: &Client) -> Result<bool> {
    #[derive(Deserialize)]
    struct Config {
        #[serde(default)]
        realtime: bool,
    }
    Ok(client.get_json::<Config>("/api/config")?.realtime)
}

pub fn run(client: &Client, workspace_id: &str, command: &Command) -> Result<()> {
    crate::workspace::before_write("notes", command)?;
    let _: serde_json::Value = client.post_json(&format!("/api/workspace?workspaceId={workspace_id}"), command)?;
    Ok(())
}

/// `workspaceCommand` "create": a new workspace with this id and name.
pub fn create_workspace(client: &Client, id: &str, name: &str) -> Result<()> {
    let body = workspace_body(id, name);
    crate::workspace::before_write("notes workspaces", &body)?;
    let _: serde_json::Value = client.post_json("/api/workspaces", &body)?;
    Ok(())
}

pub fn sharing(client: &Client, list_id: &str) -> Result<Sharing> {
    client.get_query("/api/sharing", &[("listId", list_id)])
}

fn workspace_body(id: &str, name: &str) -> serde_json::Value {
    serde_json::json!({ "type": "create", "id": id, "name": name })
}

fn share_body(list_id: &str, role: Option<LinkRole>) -> serde_json::Value {
    match role {
        Some(role) => serde_json::json!({ "type": "enable-link", "listId": list_id, "role": role }),
        None => serde_json::json!({ "type": "revoke-link", "listId": list_id }),
    }
}

/// `sharingCommand`: a link with this role, or with `None` no link any more.
pub fn share(client: &Client, list_id: &str, role: Option<LinkRole>) -> Result<()> {
    let body = share_body(list_id, role);
    crate::workspace::before_write("notes sharing", &body)?;
    let _: serde_json::Value = client.post_json("/api/sharing", &body)?;
    Ok(())
}

/// Why a call failed, as far as the screens tell the cases apart.
pub enum Failure {
    /// The session lapsed: back to the sign-in screen.
    SignedOut,
    /// The API was not reached at all.
    Offline,
    /// 404: the workspace, list or link is gone (or no longer the user's).
    Gone(Option<String>),
    /// 409: the note was changed elsewhere since this version.
    Conflict(Option<String>),
    /// Anything else, with the API's own words when it had some.
    Other(Option<String>),
}

pub fn failure(error: &anyhow::Error) -> Failure {
    if error.downcast_ref::<Unauthorized>().is_some() {
        return Failure::SignedOut;
    }
    if let Some(api) = error.downcast_ref::<ApiError>() {
        let message = Some(api.message.clone());
        return match api.status {
            404 => Failure::Gone(message),
            409 => Failure::Conflict(message),
            _ => Failure::Other(message),
        };
    }
    if matches!(error.downcast_ref::<ureq::Error>(), Some(ureq::Error::Transport(_))) {
        return Failure::Offline;
    }
    // `Client::get_json` keeps a failed GET's status only in its words.
    if error.to_string().starts_with("API answered 404") {
        return Failure::Gone(None);
    }
    Failure::Other(None)
}

/// A random UUID (version 4), as the web's `crypto.randomUUID()`.
pub fn new_id() -> String {
    use rand::RngCore as _;
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn list(id: &str, kind: Option<&str>) -> List {
        List {
            id: id.into(),
            name: id.into(),
            kind: kind.map(str::to_string),
            note: None,
            role: ListRole::Owner,
        }
    }

    fn ids(lists: &[List]) -> Vec<&str> {
        lists.iter().map(|list| list.id.as_str()).collect()
    }

    #[test]
    fn reads_a_workspace() {
        let json = r#"{"lists":[
            {"id":"a","name":"Werk","createdAt":"2026-01-01T00:00:00.000Z","role":"owner"},
            {"id":"b","name":"Ideeën","kind":"note","note":{"markdown":"Hoi","version":3},
             "createdAt":"2026-01-01T00:00:00.000Z","role":"viewer"}],
            "todos":[],"statuses":[]}"#;
        let data: WorkspaceData = serde_json::from_str(json).unwrap();
        assert!(!data.lists[0].is_note());
        assert!(data.lists[1].is_note());
        assert_eq!(data.lists[1].markdown(), "Hoi");
        assert_eq!(data.lists[1].role, ListRole::Viewer);
    }

    #[test]
    fn commands_are_written_as_the_api_reads_them() {
        let create = Command::CreateList {
            id: "i".into(),
            workspace_id: "w".into(),
            name: "N".into(),
            kind: "note",
        };
        assert_eq!(
            serde_json::to_string(&create).unwrap(),
            r#"{"type":"create-list","id":"i","workspaceId":"w","name":"N","kind":"note"}"#
        );
        let moving = Command::MoveList {
            id: "a".into(),
            target_id: "b".into(),
            placement: Placement::Before,
        };
        assert_eq!(
            serde_json::to_string(&moving).unwrap(),
            r#"{"type":"move-list","id":"a","targetId":"b","placement":"before"}"#
        );
        let update = Command::UpdateNote {
            id: "a".into(),
            markdown: "x".into(),
            version: 2,
        };
        assert_eq!(
            serde_json::to_string(&update).unwrap(),
            r#"{"type":"update-note","id":"a","markdown":"x","version":2}"#
        );
    }

    #[test]
    fn the_other_commands_are_written_as_the_api_reads_them() {
        use serde_json::json;
        let value = |command: &Command| serde_json::to_value(command).unwrap();
        assert_eq!(
            value(&Command::RenameList {
                id: "a".into(),
                name: "Nieuw".into(),
            }),
            json!({ "type": "rename-list", "id": "a", "name": "Nieuw" })
        );
        assert_eq!(value(&Command::DeleteList { id: "a".into() }), json!({ "type": "delete-list", "id": "a" }));
        assert_eq!(
            value(&Command::MoveList {
                id: "a".into(),
                target_id: "b".into(),
                placement: Placement::After,
            })["placement"],
            "after"
        );
        // An emptied note is sent as "", and a first save as version 0.
        assert_eq!(
            value(&Command::UpdateNote {
                id: "a".into(),
                markdown: String::new(),
                version: 0,
            }),
            json!({ "type": "update-note", "id": "a", "markdown": "", "version": 0 })
        );
        // workspaces.ts `workspaceCommand` and sharing.ts `sharingCommand`.
        assert_eq!(workspace_body("w", "Werk"), json!({ "type": "create", "id": "w", "name": "Werk" }));
        assert_eq!(
            share_body("l", Some(LinkRole::Editor)),
            json!({ "type": "enable-link", "listId": "l", "role": "editor" })
        );
        assert_eq!(
            share_body("l", Some(LinkRole::Viewer)),
            json!({ "type": "enable-link", "listId": "l", "role": "viewer" })
        );
        assert_eq!(share_body("l", None), json!({ "type": "revoke-link", "listId": "l" }));
    }

    #[test]
    fn a_new_note_shows_at_once_and_only_once() {
        let mut lists = vec![list("n1", Some("note"))];
        let create = Command::CreateList {
            id: "n2".into(),
            workspace_id: "w".into(),
            name: "Idee".into(),
            kind: "note",
        };
        apply(&mut lists, &create);
        apply(&mut lists, &create);
        assert_eq!(ids(&lists), ["n1", "n2"]);
        assert_eq!(
            lists[1].note,
            Some(Note {
                markdown: String::new(),
                version: 0
            })
        );
        apply(&mut lists, &Command::DeleteList { id: "n1".into() });
        assert_eq!(ids(&lists), ["n2"]);
    }

    #[test]
    fn failures_are_told_apart() {
        let api = |status: u16| anyhow::Error::from(ApiError {
            status,
            message: "x".into(),
        });
        assert!(matches!(failure(&api(409)), Failure::Conflict(Some(_))));
        assert!(matches!(failure(&api(404)), Failure::Gone(Some(_))));
        assert!(matches!(failure(&api(403)), Failure::Other(Some(_))));
        assert!(matches!(failure(&anyhow::Error::from(Unauthorized)), Failure::SignedOut));
        assert!(matches!(failure(&anyhow::anyhow!("API answered 404: {{}}")), Failure::Gone(None)));
    }

    #[test]
    fn notes_move_among_notes_only() {
        let mut lists = vec![
            list("t1", None),
            list("n1", Some("note")),
            list("t2", None),
            list("n2", Some("note")),
            list("n3", Some("note")),
        ];
        let moving = |id: &str, target: &str, placement| Command::MoveList {
            id: id.into(),
            target_id: target.into(),
            placement,
        };
        apply(&mut lists, &moving("n3", "n1", Placement::Before));
        assert_eq!(ids(&lists), ["t1", "n3", "t2", "n1", "n2"]);
        apply(&mut lists, &moving("n3", "n2", Placement::After));
        assert_eq!(ids(&lists), ["t1", "n1", "t2", "n2", "n3"]);
        // A note does not move past a task list.
        apply(&mut lists, &moving("n1", "t2", Placement::After));
        assert_eq!(ids(&lists), ["t1", "n1", "t2", "n2", "n3"]);
    }

    #[test]
    fn a_saved_note_is_one_version_on() {
        let mut lists = vec![list("n", Some("note"))];
        apply(
            &mut lists,
            &Command::UpdateNote {
                id: "n".into(),
                markdown: "Nieuw".into(),
                version: 4,
            },
        );
        assert_eq!(
            lists[0].note,
            Some(Note {
                markdown: "Nieuw".into(),
                version: 5
            })
        );
    }

    #[test]
    fn ids_are_uuids() {
        let id = new_id();
        assert_eq!(id.len(), 36);
        assert_eq!(id.as_bytes()[14], b'4');
        assert_ne!(id, new_id());
    }
}
