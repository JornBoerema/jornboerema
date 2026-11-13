//! Keeping what is written. A new message is saved as a draft at its
//! provider while it is written (`useDraftAutosave` in
//! apps/mail-web/src/lib/drafts.ts); a reply or forward is kept on this Mac
//! per conversation (lib/reply-drafts.ts), next to the cache and gone with it
//! when the user signs out.

use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};

use super::wire::{self, DraftRef, InlineUpload, Outgoing};
use super::*;

/// Long enough to not save on every keystroke, short enough that little is lost.
const SAVE_DELAY: Duration = Duration::from_millis(1500);
/// A reply is written to disk once typing pauses.
const KEEP_DELAY: Duration = Duration::from_millis(400);
/// A reply nobody came back to in a month isn't worth bringing back.
const MAX_AGE_MS: i64 = 30 * 24 * 60 * 60 * 1000;

#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub(super) enum SaveStatus {
    #[default]
    Idle,
    Saving,
    Saved,
    Failed,
}

/// What comes after a save that is still running.
type After = Box<dyn FnOnce(&mut MailView, &mut Context<MailView>)>;

/// Where the open message stands as a draft. Saves run one at a time, so a
/// slow one can't overwrite a newer one.
#[derive(Default)]
pub(super) struct Autosave {
    pub(super) status: SaveStatus,
    /// The draft this message is saved as, once it is.
    pub(super) saved: Option<DraftRef>,
    /// The message as last saved; none until its content is complete.
    saved_key: Option<String>,
    saved_files: String,
    saved_pictures: String,
    paused: bool,
    running: bool,
    /// Something changed while a save ran.
    again: bool,
    timer: u64,
    after: Vec<After>,
}

impl Autosave {
    /// The content as it is now is the starting point, not a change.
    pub(super) fn start(&mut self, account: &str, content: &Outgoing) {
        self.saved_key = Some(content.key(account));
        self.saved_files = content.files_key();
        self.saved_pictures = content.pictures_key();
    }

    pub(super) fn started(&self) -> bool {
        self.saved_key.is_some()
    }

    /// Graph keeps files apart from the message, so it only re-uploads them when told.
    pub(super) fn files_changed(&self, content: &Outgoing) -> bool {
        content.files_key() != self.saved_files || content.pictures_key() != self.saved_pictures
    }

    fn dirty(&self, account: &str, content: &Outgoing) -> bool {
        self.saved_key.as_ref().is_some_and(|key| *key != content.key(account) || self.files_changed(content))
    }
}

/// A message as it must be saved one last time: when its composer closes, or the app quits.
pub(super) struct Parting {
    account: String,
    content: Outgoing,
    worth_keeping: bool,
    previous: Option<DraftRef>,
    files_changed: bool,
}

impl Parting {
    /// What there is to save, if the message changed since it last was.
    pub(super) fn of(composer: &Composer) -> Option<Self> {
        let account = composer.account.clone()?;
        let content = composer.content();
        let wanted = composer.is_new()
            && !composer.dry
            && composer.stage == Stage::Ready
            && !composer.autosave.paused
            && composer.autosave.dirty(&account, &content);
        wanted.then(|| Self {
            worth_keeping: worth_keeping(composer, &content),
            previous: composer.autosave.saved.clone(),
            files_changed: composer.autosave.files_changed(&content),
            account,
            content,
        })
    }

    pub(super) fn keep(self, client: &Client) -> anyhow::Result<Option<DraftRef>> {
        wire::keep_draft(client, &self.account, &self.content, self.worth_keeping, self.previous, self.files_changed)
    }
}

/// A message only becomes a draft once its subject or text is started; a
/// signature alone doesn't make it worth keeping (`isDraftWorthKeeping`).
fn worth_keeping(composer: &Composer, content: &Outgoing) -> bool {
    !content.subject.trim().is_empty() || (composer.body.written && !content.text.trim().is_empty())
}

impl MailView {
    /// Something in the new message changed: it is saved once typing pauses.
    pub(super) fn draft_changed(&mut self, key: u64, cx: &mut Context<Self>) {
        let Some(composer) = self.writer(key) else { return };
        if !composer.is_new() {
            return self.keep_reply(key, cx);
        }
        if composer.dry || composer.autosave.paused || !composer.autosave.started() {
            return;
        }
        composer.autosave.timer += 1;
        let timer = composer.autosave.timer;
        cx.spawn(async move |this, cx| {
            cx.background_executor().timer(SAVE_DELAY).await;
            let _ = this.update(cx, |this, cx| this.autosave(key, Some(timer), cx));
        })
        .detach();
    }

    /// One round of saving, when there is something to save.
    fn autosave(&mut self, key: u64, timer: Option<u64>, cx: &mut Context<Self>) {
        let Some(composer) = self.composer.as_mut().filter(|composer| composer.key == key) else {
            return;
        };
        if timer.is_some_and(|timer| timer != composer.autosave.timer) || composer.autosave.paused || composer.dry {
            return;
        }
        if composer.autosave.running {
            composer.autosave.again = true;
            return;
        }
        let Some(account) = composer.account.clone() else { return };
        let content = composer.content();
        if !composer.autosave.dirty(&account, &content) {
            return;
        }
        let worth = worth_keeping(composer, &content);
        let previous = composer.autosave.saved.clone();
        let files_changed = composer.autosave.files_changed(&content);
        composer.autosave.status = SaveStatus::Saving;
        composer.autosave.running = true;
        composer.autosave.again = false;
        let saved = (content.key(&account), content.files_key(), content.pictures_key());
        let fallback = previous.clone();
        self.fetch(
            cx,
            move |client| wire::keep_draft(client, &account, &content, worth, previous, files_changed),
            move |this, result, cx| {
                let Some(composer) = this.composer.as_mut().filter(|composer| composer.key == key) else {
                    // Closed meanwhile: what it held then is saved now, as the draft this round made.
                    if let Some(mut parting) = this.writing.parting.remove(&key) {
                        parting.previous = match &result {
                            Ok(draft) => draft.clone(),
                            Err(_) => fallback,
                        };
                        parting.files_changed = true;
                        this.fetch(cx, move |client| parting.keep(client), |this, _, cx| this.load_drafts(cx));
                    } else {
                        this.load_drafts(cx);
                    }
                    return;
                };
                composer.autosave.running = false;
                match result {
                    Ok(draft) => {
                        composer.autosave.status = if draft.is_some() { SaveStatus::Saved } else { SaveStatus::Idle };
                        composer.autosave.saved = draft;
                        composer.autosave.saved_key = Some(saved.0);
                        composer.autosave.saved_files = saved.1;
                        composer.autosave.saved_pictures = saved.2;
                        this.load_drafts(cx);
                    }
                    // Tried again on the next change, or when the message is sent or closed.
                    Err(_) => composer.autosave.status = SaveStatus::Failed,
                }
                let Some(composer) = this.composer.as_mut().filter(|composer| composer.key == key) else {
                    return;
                };
                let after = std::mem::take(&mut composer.autosave.after);
                let again = std::mem::take(&mut composer.autosave.again);
                for run in after {
                    run(this, cx);
                }
                if again {
                    this.autosave(key, None, cx);
                }
            },
        );
        cx.notify();
    }

    /// Stops saving and waits for a running save, before sending or discarding (`pause`).
    pub(super) fn pause_autosave(
        &mut self,
        key: u64,
        cx: &mut Context<Self>,
        then: impl FnOnce(&mut Self, &mut Context<Self>) + 'static,
    ) {
        let Some(composer) = self.composer.as_mut().filter(|composer| composer.key == key) else {
            return;
        };
        composer.autosave.paused = true;
        composer.autosave.timer += 1;
        if composer.autosave.running {
            composer.autosave.after.push(Box::new(then));
        } else {
            then(self, cx);
        }
    }

    pub(super) fn resume_autosave(&mut self, key: u64, cx: &mut Context<Self>) {
        let Some(composer) = self.composer.as_mut().filter(|composer| composer.key == key) else {
            return;
        };
        composer.autosave.paused = false;
        self.autosave(key, None, cx);
    }

    /// Closing the composer or opening another draft keeps what was written.
    pub(super) fn keep_parting(&mut self, composer: &Composer, cx: &mut Context<Self>) {
        let Some(parting) = Parting::of(composer) else { return };
        if composer.autosave.running {
            // After the save that is under way, so the two don't make two drafts.
            self.writing.parting.insert(composer.key, parting);
        } else {
            self.fetch(cx, move |client| parting.keep(client), |this, _, cx| this.load_drafts(cx));
        }
    }

    /// A reply or forward changed: it is kept on this Mac, or forgotten once
    /// nothing is written anymore (`keep` in reply-forms.tsx).
    pub(super) fn keep_reply(&mut self, key: u64, cx: &mut Context<Self>) {
        let Some(answer) = self.writing.answer.as_mut().filter(|answer| answer.key == key && !answer.dry) else {
            return;
        };
        answer.kept += 1;
        let kept = answer.kept;
        cx.spawn(async move |this, cx| {
            cx.background_executor().timer(KEEP_DELAY).await;
            let _ = this.update(cx, |this, _| {
                let Some(answer) = this.writing.answer.as_ref().filter(|answer| answer.key == key && answer.kept == kept)
                else {
                    return;
                };
                let (Some(thread), Some(mode)) = (answer.thread(), answer.mode()) else { return };
                let recipients = answer.to.value();
                let forward = mode == ReplyMode::Forward;
                if answer.body.written || (forward && !recipients.trim().is_empty()) {
                    save_reply_draft(
                        thread,
                        &ReplyDraft {
                            mode,
                            html: answer.body.html.clone(),
                            inline: answer.body.inline.clone(),
                            to: forward.then_some(recipients),
                            saved_at: chrono::Utc::now().timestamp_millis(),
                        },
                    );
                } else {
                    clear_reply_draft(thread);
                }
            });
        })
        .detach();
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(super) enum ReplyMode {
    Reply,
    All,
    Forward,
}

/// A half written reply or forward, kept on this Mac per conversation.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ReplyDraft {
    pub(super) mode: ReplyMode,
    pub(super) html: String,
    #[serde(default)]
    pub(super) inline: Vec<InlineUpload>,
    /// Forwards choose their own recipients.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) to: Option<String>,
    pub(super) saved_at: i64,
}

/// Next to the cache, which signing out deletes (store.rs takes this folder along).
fn folder() -> Option<PathBuf> {
    Some(crate::auth::data_dir()?.join("reply-drafts"))
}

fn file(conversation: &str) -> Option<PathBuf> {
    let name: String = Sha256::digest(conversation.as_bytes()).iter().take(16).map(|byte| format!("{byte:02x}")).collect();
    Some(folder()?.join(format!("{name}.json")))
}

fn read_from(path: &std::path::Path, now: i64) -> Option<ReplyDraft> {
    let draft: ReplyDraft = serde_json::from_slice(&std::fs::read(path).ok()?).ok()?;
    if now - draft.saved_at > MAX_AGE_MS {
        let _ = std::fs::remove_file(path);
        return None;
    }
    Some(draft)
}

pub(super) fn read_reply_draft(conversation: &str) -> Option<ReplyDraft> {
    read_from(&file(conversation)?, chrono::Utc::now().timestamp_millis())
}

fn write_to(path: &std::path::Path, draft: &ReplyDraft) {
    let Ok(json) = serde_json::to_vec(draft) else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    // Full or unwritable disk: the reply just isn't kept.
    if std::fs::write(path, json).is_ok() {
        // It holds mail: only this user may read it.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
        }
    }
}

pub(super) fn save_reply_draft(conversation: &str, draft: &ReplyDraft) {
    if let Some(path) = file(conversation) {
        write_to(&path, draft);
    }
}

pub(super) fn clear_reply_draft(conversation: &str) {
    if let Some(path) = file(conversation) {
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::{read_from, write_to, Autosave, ReplyDraft, ReplyMode, MAX_AGE_MS};
    use crate::mail::compose::wire::{AttachmentRef, Outgoing};

    #[test]
    fn a_draft_is_dirty_once_it_changes() {
        let mut autosave = Autosave::default();
        let mut content = Outgoing::default();
        // Not complete yet: nothing to save.
        assert!(!autosave.dirty("a1", &content));
        autosave.start("a1", &content);
        assert!(!autosave.dirty("a1", &content));
        content.subject = "Hi".into();
        assert!(autosave.dirty("a1", &content));
        autosave.start("a1", &content);
        // Another mailbox moves the draft; a finished file is a change too.
        assert!(autosave.dirty("a2", &content));
        content.attachments.push(AttachmentRef {
            upload_id: "u".into(),
            name: "a".into(),
            content_type: String::new(),
            size: 1,
        });
        assert!(autosave.dirty("a1", &content) && autosave.files_changed(&content));
    }

    #[test]
    fn replies_are_kept_for_a_month() {
        let dir = std::env::temp_dir().join(format!("even-reply-test-{}", std::process::id()));
        let path = dir.join("one.json");
        let draft = ReplyDraft {
            mode: ReplyMode::Forward,
            html: "<p>Hi</p>".into(),
            inline: Vec::new(),
            to: Some("jan@even.nl, ".into()),
            saved_at: 1_000,
        };
        write_to(&path, &draft);
        let read = read_from(&path, 2_000).unwrap();
        assert_eq!(read.mode, ReplyMode::Forward);
        assert_eq!(read.to.as_deref(), Some("jan@even.nl, "));
        // As the web writes it.
        let json = String::from_utf8(std::fs::read(&path).unwrap()).unwrap();
        assert!(json.contains(r#""mode":"forward""#) && json.contains(r#""savedAt":1000"#));
        assert!(read_from(&path, 1_000 + MAX_AGE_MS + 1).is_none());
        assert!(!path.exists());
        let _ = std::fs::remove_dir_all(dir);
    }
}
