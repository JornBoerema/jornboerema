//! The files on a message (apps/mail-web/src/components/attachment-picker.tsx
//! and lib/uploads.ts): picked files upload in chunks straight away, and the
//! message carries only the finished ones, by id. Removing one stops its upload.

use std::io::Read as _;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use futures::channel::mpsc::unbounded;

use crate::i18n::{lang, Lang};

use super::wire::{self, AttachmentRef, MAX_ATTACHMENTS_BYTES, UPLOAD_CHUNK_BYTES};
use super::*;

/// A file in a composer: uploading, uploaded, or failed (`ComposerFile`).
pub(super) struct ComposerFile {
    /// Stable while the file is in the composer, also before it has an upload id.
    pub(super) key: u64,
    pub(super) name: String,
    pub(super) content_type: String,
    pub(super) size: u64,
    pub(super) upload_id: Option<String>,
    /// 0 to 1.
    pub(super) progress: f32,
    pub(super) failed: bool,
    /// Set when the file is removed or the composer closes: the upload stops.
    stop: Arc<AtomicBool>,
}

impl ComposerFile {
    fn uploaded(&self) -> bool {
        self.upload_id.is_some() && self.progress >= 1. && !self.failed
    }

    /// A file a draft already had, copied into uploads when it was opened (`fromRefs`).
    pub(super) fn of(file: AttachmentRef, key: u64) -> Self {
        Self {
            key,
            name: file.name,
            content_type: file.content_type,
            size: file.size,
            upload_id: Some(file.upload_id),
            progress: 1.,
            failed: false,
            stop: Arc::default(),
        }
    }

    /// For looking at the chips without uploading anything (`EVEN_MAIL_DEBUG=attachments`).
    pub(super) fn sample(key: u64, name: &str, content_type: &str, size: u64, progress: f32, failed: bool) -> Self {
        Self {
            key,
            name: name.into(),
            content_type: content_type.into(),
            size,
            upload_id: None,
            progress,
            failed,
            stop: Arc::default(),
        }
    }

    /// The Hugeicon for its kind (`iconFor`).
    pub(super) fn icon(&self) -> &'static str {
        let name = self.name.to_lowercase();
        let ends = |extensions: &[&str]| extensions.iter().any(|extension| name.ends_with(extension));
        if self.failed {
            "alert-02"
        } else if self.content_type == "application/pdf" || name.ends_with(".pdf") {
            "pdf-02"
        } else if self.content_type.starts_with("image/") {
            "image-02"
        } else if self.content_type.starts_with("video/") {
            "video-02"
        } else if self.content_type.starts_with("audio/") {
            "music-note-02"
        } else if ends(&[".zip", ".rar", ".7z", ".gz", ".tar"]) {
            "zip-02"
        } else if ends(&[".xls", ".xlsx", ".csv", ".numbers"]) {
            "xls-02"
        } else if ends(&[".doc", ".docx", ".pages", ".rtf", ".odt"]) {
            "doc-02"
        } else {
            "file-02"
        }
    }
}

impl Drop for ComposerFile {
    fn drop(&mut self) {
        // Leaving the composer stops what is still uploading; the server drops the rest later.
        self.stop.store(true, Ordering::Relaxed);
    }
}

pub(super) fn is_uploading(files: &[ComposerFile]) -> bool {
    files.iter().any(|file| !file.failed && file.progress < 1.)
}

/// The finished files, as the message names them (`toRefs`).
pub(super) fn refs(files: &[ComposerFile]) -> Vec<AttachmentRef> {
    files
        .iter()
        .filter(|file| file.uploaded())
        .map(|file| AttachmentRef {
            upload_id: file.upload_id.clone().unwrap_or_default(),
            name: file.name.clone(),
            content_type: file.content_type.clone(),
            size: file.size,
        })
        .collect()
}

/// "1.5 MB" or "12 KB", with the language's own decimal sign (`sizeLabel`).
pub(super) fn size_label(bytes: u64) -> String {
    const KB: f64 = 1024.;
    const MB: f64 = KB * 1024.;
    let bytes = bytes as f64;
    if bytes >= MB {
        let tenths = (bytes / MB * 10.).round() / 10.;
        let text = if tenths.fract() == 0. { format!("{tenths:.0}") } else { format!("{tenths:.1}") };
        match lang() {
            Lang::En => format!("{text} MB"),
            Lang::Nl => format!("{} MB", text.replace('.', ",")),
        }
    } else {
        format!("{} KB", super::super::format::number((bytes / KB).round().max(1.) as u64))
    }
}

/// What the browser would call a file's type; the API only shows it back.
pub(super) fn content_type_of(path: &Path) -> &'static str {
    let extension = path.extension().and_then(|extension| extension.to_str()).unwrap_or_default().to_lowercase();
    match extension.as_str() {
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "heic" => "image/heic",
        "txt" | "log" => "text/plain",
        "md" => "text/markdown",
        "csv" => "text/csv",
        "html" | "htm" => "text/html",
        "ics" => "text/calendar",
        "json" => "application/json",
        "xml" => "application/xml",
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
        "wav" => "audio/wav",
        "m4a" => "audio/mp4",
        _ => "application/octet-stream",
    }
}

/// How an upload is doing, told from its thread.
enum Step {
    Started(String),
    Progress(f32),
    Failed(anyhow::Error),
}

impl MailView {
    /// The paperclip: the system's file dialog, then the picked files are attached.
    pub(super) fn pick_attachments(&mut self, key: u64, window: &mut Window, cx: &mut Context<Self>) {
        let picked = cx.prompt_for_paths(PathPromptOptions {
            files: true,
            directories: false,
            multiple: true,
            prompt: None,
        });
        cx.spawn_in(window, async move |this, cx| {
            if let Ok(Ok(Some(paths))) = picked.await {
                let _ = this.update(cx, |this, cx| this.attach(key, paths, cx));
            }
        })
        .detach();
    }

    /// Attaches files, up to the limit together, and starts their uploads (`add`).
    pub(super) fn attach(&mut self, key: u64, paths: Vec<PathBuf>, cx: &mut Context<Self>) {
        let Some(composer) = self.writer(key) else { return };
        if !composer.takes_files() {
            return;
        }
        let mut picked: Vec<(PathBuf, u64)> = Vec::new();
        for path in paths {
            match std::fs::metadata(&path) {
                Ok(found) if found.is_file() => picked.push((path, found.len())),
                _ => {
                    return self.complain(
                        t("That file couldn't be read.", "Dat bestand kon niet worden gelezen."),
                        cx,
                    );
                }
            }
        }
        let current: u64 = composer.files.iter().filter(|file| !file.failed).map(|file| file.size).sum();
        let adding: u64 = picked.iter().map(|(_, size)| size).sum();
        if current + adding > MAX_ATTACHMENTS_BYTES {
            let limit = format!("{} MB", MAX_ATTACHMENTS_BYTES / (1024 * 1024));
            let text = t(
                format!("Attachments can be {limit} in total."),
                format!("Bijlagen mogen samen {limit} zijn."),
            );
            return self.complain(text, cx);
        }
        let dry = composer.dry;
        let mut started = Vec::new();
        for (path, size) in picked {
            self.writing.serial += 1;
            let file_key = self.writing.serial;
            let name = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
            let content_type = content_type_of(&path).to_string();
            let stop = Arc::new(AtomicBool::new(false));
            let Some(composer) = self.writer(key) else { return };
            composer.files.push(ComposerFile {
                key: file_key,
                name: name.clone(),
                content_type: content_type.clone(),
                size,
                upload_id: None,
                // A debug composer uploads nothing: the chip shows as finished.
                progress: if dry { 1. } else { 0. },
                failed: false,
                stop: stop.clone(),
            });
            started.push((file_key, path, name, content_type, size, stop));
        }
        if !dry {
            for (file_key, path, name, content_type, size, stop) in started {
                self.upload(key, file_key, path, name, content_type, size, stop, cx);
            }
        }
        cx.notify();
    }

    #[allow(clippy::too_many_arguments)]
    fn upload(
        &mut self,
        key: u64,
        file_key: u64,
        path: PathBuf,
        name: String,
        content_type: String,
        size: u64,
        stop: Arc<AtomicBool>,
        cx: &mut Context<Self>,
    ) {
        let client = self.client.clone();
        let (tell, mut told) = unbounded::<Step>();
        let stopped = stop.clone();
        cx.background_executor()
            .spawn(async move {
                let run = || -> anyhow::Result<()> {
                    let id = wire::create_upload(&client, &name, &content_type, size)?;
                    let _ = tell.unbounded_send(Step::Started(id.clone()));
                    let mut file = std::fs::File::open(&path)?;
                    let chunks = (size as usize).div_ceil(UPLOAD_CHUNK_BYTES).max(1);
                    let mut part = vec![0u8; UPLOAD_CHUNK_BYTES];
                    for index in 0..chunks {
                        let mut filled = 0;
                        while filled < part.len() {
                            match file.read(&mut part[filled..])? {
                                0 => break,
                                read => filled += read,
                            }
                        }
                        if stop.load(Ordering::Relaxed) {
                            // Removed meanwhile: what was sent goes too.
                            wire::delete_upload(&client, &id);
                            return Ok(());
                        }
                        wire::put_chunk(&client, &id, index, &part[..filled])?;
                        let _ = tell.unbounded_send(Step::Progress((index + 1) as f32 / chunks as f32));
                    }
                    Ok(())
                };
                if let Err(error) = run() {
                    let _ = tell.unbounded_send(Step::Failed(error));
                }
            })
            .detach();
        cx.spawn(async move |this, cx| {
            while let Some(step) = told.next().await {
                let alive = this.update(cx, |this, cx| {
                    if stopped.load(Ordering::Relaxed) {
                        return;
                    }
                    let failure = {
                        let Some(file) = this
                            .writer(key)
                            .and_then(|composer| composer.files.iter_mut().find(|file| file.key == file_key))
                        else {
                            return;
                        };
                        match step {
                            Step::Started(id) => {
                                file.upload_id = Some(id);
                                None
                            }
                            Step::Progress(progress) => {
                                file.progress = progress;
                                None
                            }
                            Step::Failed(error) => {
                                file.failed = true;
                                Some(error)
                            }
                        }
                    };
                    match failure {
                        Some(error) if error.downcast_ref::<Unauthorized>().is_some() => cx.emit(SignedOut),
                        Some(error) => this.toast_error(error, cx),
                        // A finished file is part of the message from now on.
                        None => this.draft_changed(key, cx),
                    }
                    cx.notify();
                });
                if alive.is_err() {
                    break;
                }
            }
        })
        .detach();
    }

    /// Takes a file off the message: its upload stops, and what was uploaded goes (`remove`).
    pub(super) fn remove_attachment(&mut self, key: u64, file_key: u64, cx: &mut Context<Self>) {
        let Some(composer) = self.writer(key) else { return };
        let Some(index) = composer.files.iter().position(|file| file.key == file_key) else { return };
        let file = composer.files.remove(index);
        let dry = composer.dry;
        if let (Some(id), false) = (file.upload_id.clone(), dry) {
            let client = self.client.clone();
            cx.background_executor().spawn(async move { wire::delete_upload(&client, &id) }).detach();
        }
        self.draft_changed(key, cx);
        cx.notify();
    }
}

#[cfg(test)]
mod tests {
    use super::{content_type_of, is_uploading, refs, size_label, ComposerFile};
    use std::path::Path;

    #[test]
    fn only_finished_files_go_along() {
        let mut files = vec![
            ComposerFile::sample(1, "a.pdf", "application/pdf", 10, 1., false),
            ComposerFile::sample(2, "b.png", "image/png", 10, 0.4, false),
            ComposerFile::sample(3, "c.zip", "application/zip", 10, 0.2, true),
        ];
        // Finished, but the server has not named it yet.
        assert!(refs(&files).is_empty());
        files[0].upload_id = Some("u1".into());
        files[1].upload_id = Some("u2".into());
        assert_eq!(refs(&files).iter().map(|file| file.upload_id.as_str()).collect::<Vec<_>>(), ["u1"]);
        assert!(is_uploading(&files));
        files.remove(1);
        // A failed one is not waited for.
        assert!(!is_uploading(&files));
        assert_eq!(files[0].icon(), "pdf-02");
        assert_eq!(files[1].icon(), "alert-02");
    }

    #[test]
    fn names_kinds_and_sizes() {
        assert_eq!(content_type_of(Path::new("/x/Report.PDF")), "application/pdf");
        assert_eq!(content_type_of(Path::new("/x/unknown.bin")), "application/octet-stream");
        assert_eq!(ComposerFile::sample(1, "a.xlsx", "application/x", 1, 1., false).icon(), "xls-02");
        assert_eq!(ComposerFile::sample(1, "a.mov", "video/quicktime", 1, 1., false).icon(), "video-02");
        assert_eq!(ComposerFile::sample(1, "a", "", 1, 1., false).icon(), "file-02");
        assert_eq!(size_label(10), "1 KB");
        assert_eq!(size_label(200 * 1024), "200 KB");
        assert!(["1.5 MB", "1,5 MB"].contains(&size_label(1024 * 1024 * 3 / 2).as_str()));
        assert!(size_label(2 * 1024 * 1024).starts_with("2 MB"));
    }
}
