//! A made-up workspace for a run that only looks (`EVEN_TODO_SHOW=sample,…`,
//! scripts/shot.sh): a simple list with tasks in all three groups, a board
//! with issues, projects, members with and without a picture, files on an
//! issue and a long description. It lives in memory only: with it on screen
//! nothing is read from or sent to the API (`TodoApp::sample`).

use super::api::{
    Attachment, BoardMember, BoardProject, BoardStatus, Invitation, ListKind, ListRole, Member, ShareLink, SharingData,
    StatusCategory, Todo, TodoList, TodoMail, WorkspaceData, WorkspaceMembers, WorkspaceRole, WorkspaceSummary,
};

/// A small picture (PNG), as a member's profile picture would arrive.
const FACE: &str = "iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAIAAADYYG7QAAAA1klEQVR42s3O2w0CMQwEwFRDWRRAf7TBBxWBBOJxl0tie71raQqYdr7cS2mlNqfrrZXaFAq9NlVCn02J0O9GH9psxKH9RhnqbmSho40mNNgIQuMNOzTdUEMrG15ocUMKrW8YIdMmPWTd5IYcm8SQb5MVcm9SQpENPhTcgEPxDTIE2cBCqA0mBNwAQthNNATfhEIZG38oaeMM5W08odSNOZS9sYUIG0OIs1kN0TZLIeZmHiJvJiH+ZhSSbA5Dqk0/JNx0QtrNNiTf/IUqbL6hIpt3qM7m6QEY3qzrc6QkxAAAAABJRU5ErkJggg==";
/// Another, for an image attached to an issue.
const PICTURE: &str = "iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAAAXUlEQVR42u3XMQ0AIAwEQARWFabQgB0UYKBMXSBc0vGH3vT5FqOnt2akd1u+AQAAAACUAK88esoDAAAAANQAmhgAAADAHtDEAAAAAPaAJgYAAACwBzQxAAAAwHeADRWISTyUPefMAAAAAElFTkSuQmCC";

pub(super) fn id(n: u32) -> String {
    format!("00000000-0000-4000-8000-{n:012}")
}

pub(super) const WORKSPACE: u32 = 1;
pub(super) const LIST: u32 = 10;
pub(super) const BOARD: u32 = 11;
pub(super) const ISSUE: u32 = 40;

pub(super) fn workspaces() -> Vec<WorkspaceSummary> {
    vec![WorkspaceSummary {
        id: id(WORKSPACE),
        name: "Voorbeeld".into(),
        role: WorkspaceRole::Owner,
        member_count: 3,
    }]
}

/// The bytes of the picture attached to the sample issue.
pub(super) fn picture() -> Vec<u8> {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD.decode(PICTURE).unwrap_or_default()
}

pub(super) fn members() -> WorkspaceMembers {
    let member = |n: u32, user: &str, name: &str, email: &str, role| Member {
        id: id(n),
        user_id: user.into(),
        name: name.into(),
        email: email.into(),
        role,
    };
    WorkspaceMembers {
        members: vec![
            member(90, "u1", "Sanne de Vries", "sanne@voorbeeld.nl", WorkspaceRole::Owner),
            member(91, "u2", "Pieter Jansen", "pieter@voorbeeld.nl", WorkspaceRole::Admin),
            member(92, "u3", "", "lotte@voorbeeld.nl", WorkspaceRole::Member),
        ],
        invitations: vec![Invitation {
            id: id(95),
            email: "nieuw@voorbeeld.nl".into(),
            role: WorkspaceRole::Member,
            expires_at: chrono::Utc::now() + chrono::Duration::days(6),
        }],
    }
}

pub(super) fn sharing(link: bool) -> SharingData {
    SharingData {
        link: link.then(|| ShareLink {
            token: "voorbeeld-0123456789abcdefghijklmnopqrstuvw".into(),
            role: super::api::ShareRole::Viewer,
        }),
    }
}

/// A description long enough to scroll the open issue (`EVEN_TODO_SCROLL`).
fn long_description() -> String {
    let mut text = String::from("# Opzet\n\nDe eerste regel van de beschrijving.\n\n");
    for n in 1..=30 {
        text.push_str(&format!(
            "## Deel {n}\n\nAlinea {n} van de beschrijving, lang genoeg om over de rand van het venster te lopen zodat er iets te schuiven valt.\n\n- punt een van deel {n}\n- punt twee van deel {n}\n\n"
        ));
    }
    text.push_str("De laatste regel van de beschrijving.");
    text
}

pub(super) fn data() -> WorkspaceData {
    let list = |n: u32, name: &str, kind| TodoList {
        id: id(n),
        name: name.into(),
        kind,
        created_at: "2026-11-01T09:00:00.000Z".into(),
        role: ListRole::Owner,
    };
    let task = |n: u32, title: &str, completed: bool, in_progress: bool, position: f64| Todo {
        id: id(n),
        list_id: id(LIST),
        title: title.into(),
        completed,
        in_progress,
        position,
        created_at: format!("2026-11-{:02}T09:00:00.000Z", n - 19),
        ..Todo::default()
    };
    let status = |n: u32, name: &str, category, color: &str, position: f64| BoardStatus {
        id: id(n),
        name: name.into(),
        category,
        color: color.into(),
        position,
    };
    let issue = |n: u32, number: u32, title: &str, status: u32, priority: u8, position: f64| Todo {
        id: id(n),
        list_id: id(BOARD),
        title: title.into(),
        position,
        created_at: format!("2026-11-{:02}T10:00:00.000Z", number),
        number: Some(number),
        description: Some(String::new()),
        status_id: Some(id(status)),
        priority: Some(priority),
        completed: status == 104 || status == 105,
        in_progress: status == 102 || status == 103,
        ..Todo::default()
    };
    let mut tasks = vec![
        task(20, "Offerte nalezen", false, true, 0.),
        task(21, "Boodschappen doen voor het weekend", false, false, 1.),
        task(22, "Fiets naar de maker brengen", false, false, 2.),
        task(23, "Een taak met een lange titel die over meer dan een regel loopt zodat te zien is hoe de rij dan groeit en waar de knoppen blijven", false, false, 3.),
        task(24, "Verjaardagskaart sturen", true, false, 4.),
        task(25, "Tandarts bellen", true, false, 5.),
    ];
    tasks[1].mail = Some(TodoMail {
        subject: "Lijstje voor zaterdag".into(),
        from: Some("Pieter Jansen".into()),
        url: Some("https://example.com/".into()),
    });
    let mut open = issue(ISSUE, 7, "Startpagina opnieuw indelen", 102, 2, 0.);
    open.description = Some(long_description());
    open.project_id = Some(id(201));
    open.assignee_ids = vec!["u1".into(), "u2".into()];
    open.attachments = vec![
        Attachment {
            id: id(300),
            name: "Schermafbeelding 2026-11-12 10.14.03.png".into(),
            content_type: "image/png".into(),
            size: 248_312,
        },
        Attachment {
            id: id(301),
            name: "Offerte-website.pdf".into(),
            content_type: "application/pdf".into(),
            size: 1_482_301,
        },
        Attachment {
            id: id(302),
            name: "notities".into(),
            content_type: "application/octet-stream".into(),
            size: 812,
        },
    ];
    let mut child = issue(45, 8, "Kop en menu", 104, 0, 0.);
    child.parent_id = Some(id(ISSUE));
    let mut second = issue(46, 9, "Voet met contactgegevens", 101, 3, 1.);
    second.parent_id = Some(id(ISSUE));
    second.assignee_ids = vec!["u3".into()];
    let mut assigned = issue(41, 4, "Contactformulier koppelen", 101, 1, 0.);
    assigned.assignee_ids = vec!["u2".into(), "u3".into(), "u1".into()];
    assigned.project_id = Some(id(202));
    let mut todos = tasks;
    todos.extend([
        issue(39, 3, "Ideeën voor de winteractie", 100, 0, 0.),
        assigned,
        issue(42, 5, "Teksten nalopen", 101, 4, 1.),
        open,
        issue(43, 6, "Nieuwe foto's laten maken", 103, 3, 0.),
        issue(44, 2, "Domein verhuisd", 104, 0, 0.),
        issue(47, 1, "Oude blog overzetten", 105, 0, 0.),
        child,
        second,
    ]);
    // Enough rows in one status for the board's list view to scroll.
    for n in 0..14 {
        todos.push(issue(60 + n, 10 + n, &format!("Pagina {} nalopen", n + 1), 101, 0, 2. + n as f64));
    }
    WorkspaceData {
        lists: vec![
            list(LIST, "Deze week", ListKind::Todo),
            list(12, "Huis", ListKind::Todo),
            list(BOARD, "Website", ListKind::Board),
        ],
        todos,
        statuses: vec![
            status(100, "Backlog", StatusCategory::Backlog, "#95a2b3", 0.),
            status(101, "Te doen", StatusCategory::Unstarted, "#a1a1aa", 0.),
            status(102, "Bezig", StatusCategory::Started, "#f2c94c", 0.),
            status(103, "In review", StatusCategory::Started, "#4cb782", 1.),
            status(104, "Klaar", StatusCategory::Completed, "#5e6ad2", 0.),
            status(105, "Geannuleerd", StatusCategory::Canceled, "#95a2b3", 0.),
        ],
        projects: vec![
            BoardProject {
                id: id(201),
                name: "Lancering 2027".into(),
                description: "Alles wat voor de nieuwe site af moet.".into(),
                color: "#5e6ad2".into(),
                position: 0.,
            },
            BoardProject {
                id: id(202),
                name: "Onderhoud".into(),
                description: String::new(),
                color: "#4cb782".into(),
                position: 1.,
            },
        ],
        members: vec![
            BoardMember {
                id: "u1".into(),
                name: "Sanne de Vries".into(),
                email: "sanne@voorbeeld.nl".into(),
                image: Some(format!("data:image/png;base64,{FACE}")),
            },
            BoardMember {
                id: "u2".into(),
                name: "Pieter Jansen".into(),
                email: "pieter@voorbeeld.nl".into(),
                image: None,
            },
            BoardMember {
                id: "u3".into(),
                name: String::new(),
                email: "lotte@voorbeeld.nl".into(),
                image: None,
            },
        ],
    }
}
