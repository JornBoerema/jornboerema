//! Even doen's part of the API (apps/api/src/todo/routes.ts): the workspace
//! with its lists, tasks and boards, the workspaces themselves, public links,
//! attachments and whether there is a realtime channel (src/workspace/realtime.rs
//! listens to it). The types are packages/todo-core's.
//! Blocking, as `crate::api`: call on the background executor.

use std::time::Duration;

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};

use crate::api::{api_url, auth_url, Client, Unauthorized};

/// A new id, as the web's `crypto.randomUUID()`.
pub fn new_id() -> String {
    let mut bytes: [u8; 16] = rand::random();
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

/// Where Even doen lives on the web, for links that leave the app (a shared
/// list, an issue): todo.<domain> next to the account site, as the web's `appOrigin`.
pub fn web_origin() -> String {
    if let Ok(url) = std::env::var("EVEN_TODO_URL") {
        return url.trim_end_matches('/').to_string();
    }
    let auth = auth_url();
    if auth.contains("localhost") || auth.contains("127.0.0.1") {
        return "http://localhost:3000".into();
    }
    auth.replacen("://auth.", "://todo.", 1)
}

// ─── packages/todo-core/src/workspace.ts and board.ts ───────────────────────

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ListKind {
    #[default]
    Todo,
    Note,
    Board,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ListRole {
    #[default]
    Owner,
    Editor,
    Viewer,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoList {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub kind: ListKind,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub role: ListRole,
}

/// The mail a task was made from. `url` opens it, for whoever's mailbox it is in.
#[derive(Clone, Debug, Deserialize)]
pub struct TodoMail {
    #[serde(default)]
    pub subject: String,
    pub from: Option<String>,
    pub url: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub name: String,
    /// What the uploader's browser called the file's type.
    #[serde(default)]
    pub content_type: String,
    #[serde(default)]
    pub size: u64,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Todo {
    pub id: String,
    pub list_id: String,
    pub title: String,
    #[serde(default)]
    pub completed: bool,
    #[serde(default)]
    pub in_progress: bool,
    #[serde(default)]
    pub position: f64,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub mail: Option<TodoMail>,
    // Board issues only (lists of kind "board").
    #[serde(default)]
    pub number: Option<u32>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub status_id: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub priority: Option<u8>,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub assignee_ids: Vec<String>,
    #[serde(default)]
    pub attachments: Vec<Attachment>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum StatusCategory {
    Backlog,
    Unstarted,
    Started,
    Completed,
    Canceled,
}

impl StatusCategory {
    pub const ALL: [StatusCategory; 5] = [
        StatusCategory::Backlog,
        StatusCategory::Unstarted,
        StatusCategory::Started,
        StatusCategory::Completed,
        StatusCategory::Canceled,
    ];

    pub fn order(self) -> usize {
        Self::ALL.iter().position(|category| *category == self).unwrap_or(0)
    }
}

#[derive(Clone, Debug, Deserialize)]
pub struct BoardStatus {
    pub id: String,
    pub name: String,
    pub category: StatusCategory,
    pub color: String,
    #[serde(default)]
    pub position: f64,
}

#[derive(Clone, Debug, Deserialize)]
pub struct BoardProject {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub color: String,
    #[serde(default)]
    pub position: f64,
}

#[derive(Clone, Debug, Deserialize)]
pub struct BoardMember {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub email: String,
    /// The address of their profile picture, when they have one.
    #[serde(default)]
    pub image: Option<String>,
}

impl BoardMember {
    /// The web's `member.name || member.email`.
    pub fn label(&self) -> &str {
        if self.name.is_empty() {
            &self.email
        } else {
            &self.name
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct WorkspaceData {
    #[serde(default)]
    pub lists: Vec<TodoList>,
    #[serde(default)]
    pub todos: Vec<Todo>,
    /// Board columns, shared by every board in the workspace.
    #[serde(default)]
    pub statuses: Vec<BoardStatus>,
    #[serde(default)]
    pub projects: Vec<BoardProject>,
    /// Who issues can be assigned to.
    #[serde(default)]
    pub members: Vec<BoardMember>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Placement {
    Before,
    After,
}

/// todo-core's `commandSchema`: every change to a workspace's lists and boards.
/// Absent fields are left out, as the schema's `.optional()` wants.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum Command {
    CreateList {
        id: String,
        workspace_id: String,
        name: String,
        kind: ListKind,
    },
    RenameList {
        id: String,
        name: String,
    },
    DeleteList {
        id: String,
    },
    CreateTodo {
        id: String,
        list_id: String,
        title: String,
    },
    UpdateTodo {
        id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        completed: Option<bool>,
        #[serde(skip_serializing_if = "Option::is_none")]
        in_progress: Option<bool>,
    },
    DeleteTodo {
        id: String,
    },
    ClearDone {
        list_id: String,
    },
    MoveTodo {
        id: String,
        target_id: String,
        placement: Placement,
    },
    MoveList {
        id: String,
        target_id: String,
        placement: Placement,
    },
    CreateIssue {
        id: String,
        list_id: String,
        title: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        description: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        status_id: Option<String>,
        /// `null` is "no project".
        project_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        priority: Option<u8>,
        #[serde(skip_serializing_if = "Option::is_none")]
        parent_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        assignee_ids: Option<Vec<String>>,
    },
    UpdateIssue {
        id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        description: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        status_id: Option<String>,
        /// Outer `None`: unchanged. `Some(None)`: no project.
        #[serde(skip_serializing_if = "Option::is_none")]
        project_id: Option<Option<String>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        priority: Option<u8>,
        #[serde(skip_serializing_if = "Option::is_none")]
        assignee_ids: Option<Vec<String>>,
    },
    /// Into a status column, before or after another issue there (or on top).
    MoveIssue {
        id: String,
        status_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        target_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        placement: Option<Placement>,
    },
    DeleteAttachment {
        id: String,
    },
    CreateStatus {
        id: String,
        workspace_id: String,
        name: String,
        category: StatusCategory,
        color: String,
    },
    UpdateStatus {
        id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        category: Option<StatusCategory>,
        #[serde(skip_serializing_if = "Option::is_none")]
        color: Option<String>,
    },
    MoveStatus {
        id: String,
        target_id: String,
        placement: Placement,
    },
    /// Its issues move to `replacement_id`.
    DeleteStatus {
        id: String,
        replacement_id: String,
    },
    CreateProject {
        id: String,
        workspace_id: String,
        name: String,
        description: String,
        color: String,
    },
    UpdateProject {
        id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        description: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        color: Option<String>,
    },
    DeleteProject {
        id: String,
    },
}

impl Command {
    /// An `update-issue` that changes nothing yet: fill in what does.
    pub fn update_issue(id: &str) -> Command {
        Command::UpdateIssue {
            id: id.to_string(),
            title: None,
            description: None,
            status_id: None,
            project_id: None,
            priority: None,
            assignee_ids: None,
        }
    }
}

// ─── packages/todo-core/src/workspaces.ts ───────────────────────────────────

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceRole {
    Owner,
    Admin,
    Member,
}

impl WorkspaceRole {
    /// Owners and admins manage members and workspace settings.
    pub fn can_manage(self) -> bool {
        self != WorkspaceRole::Member
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSummary {
    pub id: String,
    pub name: String,
    pub role: WorkspaceRole,
    #[serde(default)]
    pub member_count: u32,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub id: String,
    pub user_id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub email: String,
    pub role: WorkspaceRole,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Invitation {
    pub id: String,
    pub email: String,
    pub role: WorkspaceRole,
    pub expires_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct WorkspaceMembers {
    #[serde(default)]
    pub members: Vec<Member>,
    #[serde(default)]
    pub invitations: Vec<Invitation>,
}

/// todo-core's `workspaceCommand`.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum WorkspaceCommand {
    Create { id: String, name: String },
    Rename { workspace_id: String, name: String },
    Delete { workspace_id: String },
    Leave { workspace_id: String },
    Invite {
        workspace_id: String,
        email: String,
        #[serde(serialize_with = "assignable_role")]
        role: WorkspaceRole,
    },
    UpdateMember {
        workspace_id: String,
        member_id: String,
        #[serde(serialize_with = "assignable_role")]
        role: WorkspaceRole,
    },
    RemoveMember { workspace_id: String, member_id: String },
    RevokeInvite { workspace_id: String, invitation_id: String },
}

/// workspaces.ts `assignableRole`: ownership is never handed out through an
/// invitation or a role change, so anything but "admin" is written as "member"
/// (the web's `invite.role === "admin" ? "admin" : "member"`).
fn assignable_role<S: serde::Serializer>(role: &WorkspaceRole, serializer: S) -> std::result::Result<S::Ok, S::Error> {
    serializer.serialize_str(if *role == WorkspaceRole::Admin { "admin" } else { "member" })
}

// ─── packages/todo-core/src/sharing.ts ──────────────────────────────────────

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ShareRole {
    Viewer,
    Editor,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ShareLink {
    pub token: String,
    pub role: ShareRole,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct SharingData {
    pub link: Option<ShareLink>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum SharingCommand {
    EnableLink { list_id: String, role: ShareRole },
    RevokeLink { list_id: String },
}

// ─── The calls ──────────────────────────────────────────────────────────────

/// A file on an issue may be at most this large; it is sent in chunks.
pub const MAX_ATTACHMENT_BYTES: u64 = 25 * 1024 * 1024;

/// An upload the API never saw: the file is larger than 25 MB.
#[derive(Debug)]
pub struct AttachmentTooLarge;

impl std::fmt::Display for AttachmentTooLarge {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("attachment too large")
    }
}

impl std::error::Error for AttachmentTooLarge {}

fn encode(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

pub fn workspaces(client: &Client) -> Result<Vec<WorkspaceSummary>> {
    client.get_json("/api/workspaces")
}

pub fn workspace(client: &Client, workspace_id: &str) -> Result<WorkspaceData> {
    client.get_json(&format!("/api/workspace?workspaceId={}", encode(workspace_id)))
}

pub fn run(client: &Client, command: &Command) -> Result<()> {
    crate::workspace::before_write("todo", command)?;
    let _: serde_json::Value = client.post_json("/api/workspace", command)?;
    Ok(())
}

pub fn members(client: &Client, workspace_id: &str) -> Result<WorkspaceMembers> {
    client.get_json(&format!("/api/workspaces/{}/members", encode(workspace_id)))
}

pub fn change_workspace(client: &Client, command: &WorkspaceCommand) -> Result<()> {
    crate::workspace::before_write("todo workspaces", command)?;
    let _: serde_json::Value = client.post_json("/api/workspaces", command)?;
    Ok(())
}

pub fn sharing(client: &Client, list_id: &str) -> Result<SharingData> {
    client.get_json(&format!("/api/sharing?listId={}", encode(list_id)))
}

pub fn change_sharing(client: &Client, command: &SharingCommand) -> Result<()> {
    crate::workspace::before_write("todo sharing", command)?;
    let _: serde_json::Value = client.post_json("/api/sharing", command)?;
    Ok(())
}

/// Whether the API has a realtime provider (`/api/config`).
pub fn realtime_enabled(client: &Client) -> bool {
    #[derive(Deserialize)]
    struct Config {
        #[serde(default)]
        realtime: bool,
    }
    client
        .get_json::<Config>("/api/config")
        .map(|config| config.realtime)
        .unwrap_or(false)
}

/// apps/todo-web/src/lib/attachments.ts: sends a file in chunks (each below
/// the API's request limit), then it shows on the issue.
pub fn upload_attachment(client: &Client, todo_id: &str, path: &std::path::Path) -> Result<()> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Created {
        id: String,
        chunk_bytes: usize,
    }
    let size = std::fs::metadata(path)?.len();
    if size > MAX_ATTACHMENT_BYTES {
        return Err(AttachmentTooLarge.into());
    }
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".into());
    let bytes = std::fs::read(path)?;
    let body = attachment_body(todo_id, &name, bytes.len());
    crate::workspace::before_write("todo attachments", &serde_json::json!({ "type": "upload-attachment" }))?;
    let created: Created = client.post_json("/api/todo-attachments", &body)?;
    let chunk = created.chunk_bytes.max(1);
    let chunks: Vec<&[u8]> = if bytes.is_empty() {
        vec![&bytes[..]]
    } else {
        bytes.chunks(chunk).collect()
    };
    for (index, part) in chunks.into_iter().enumerate() {
        put_chunk(client, &format!("/api/todo-attachments/{}/chunks/{index}", created.id), part)?;
    }
    let _: serde_json::Value = client.post_json(
        &format!("/api/todo-attachments/{}/complete", created.id),
        &serde_json::json!({}),
    )?;
    Ok(())
}

/// What announces a file to the API (routes.ts `attachmentBody`): the issue,
/// the file's name, the type a browser would give it, and its size in bytes.
pub fn attachment_body(todo_id: &str, name: &str, size: usize) -> serde_json::Value {
    serde_json::json!({
        "todoId": todo_id,
        "name": name,
        "contentType": content_type(name),
        "size": size,
    })
}

/// Raw bytes, one chunk per request. The shared client only POSTs bytes, so
/// this PUT is made here, signed the same way.
fn put_chunk(client: &Client, path: &str, bytes: &[u8]) -> Result<()> {
    let response = ureq::put(&format!("{}{path}", api_url()))
        .timeout(Duration::from_secs(120))
        .set("Authorization", &format!("Bearer {}", client.token()))
        .set("Origin", "tauri://localhost")
        .set("Content-Type", "application/octet-stream")
        .send_bytes(bytes);
    match response {
        Ok(_) => Ok(()),
        Err(ureq::Error::Status(401, _)) => Err(Unauthorized.into()),
        Err(error) => Err(anyhow!(error)),
    }
}

/// The file's bytes, to save like a normal download.
pub fn download_attachment(client: &Client, id: &str) -> Result<Vec<u8>> {
    client.get_bytes(&format!("/api/todo-attachments/{}", encode(id)), MAX_ATTACHMENT_BYTES + 1024)
}

/// What the browser would send as a file's type, from its name.
fn content_type(name: &str) -> &'static str {
    let extension = name.rsplit('.').next().unwrap_or("").to_lowercase();
    match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        "txt" | "log" => "text/plain",
        "md" => "text/markdown",
        "csv" => "text/csv",
        "json" => "application/json",
        "html" | "htm" => "text/html",
        "zip" => "application/zip",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ppt" => "application/vnd.ms-powerpoint",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "mp3" => "audio/mpeg",
        _ => "application/octet-stream",
    }
}
