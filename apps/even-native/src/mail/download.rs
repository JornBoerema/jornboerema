//! Attachments saved to Downloads when their chip in the mail is clicked.

use std::fs::OpenOptions;
use std::io::{self, Write as _};
use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::Context as _;

use super::*;

/// How long the toolbar says how a download went.
const STATUS_FOR: Duration = Duration::from_secs(6);

impl MailView {
    /// A chip clicked in the document. The numbers come from the webview, so
    /// they only count for the document on screen and a file it really has.
    pub(super) fn download(&mut self, view: u64, part: usize, file: usize, cx: &mut Context<Self>) {
        if view != self.view {
            return;
        }
        let Some((thread_id, _)) = self.shown.clone() else {
            return;
        };
        let Some(Reading::Ready(conversation)) = self.reading.get(&thread_id) else {
            return;
        };
        let Some(files) = conversation.files.get(part) else {
            return;
        };
        let Some(attachment) = files.attachments.get(file).filter(|a| !a.id.is_empty()) else {
            return;
        };
        let message_id = files.message_id.clone();
        let attachment = attachment.clone();
        self.set_status(format!("{} downloaden…", attachment.name), false, cx);
        let client = self.client.clone();
        let task = cx.background_executor().spawn(async move {
            let bytes = client.attachment(&thread_id, &message_id, &attachment.id)?;
            let dir = dirs::download_dir()
                .or_else(|| dirs::home_dir().map(|home| home.join("Downloads")))
                .context("geen map Downloads")?;
            let path = save(&dir, &attachment.name, &bytes)?;
            reveal(&path);
            anyhow::Ok(path)
        });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |this, cx| match result {
                Ok(path) => {
                    let name = path
                        .file_name()
                        .map(|n| n.to_string_lossy().into_owned())
                        .unwrap_or_default();
                    this.set_status(format!("{name} staat in Downloads"), false, cx);
                }
                Err(error) if error.downcast_ref::<Unauthorized>().is_some() => cx.emit(SignedOut),
                Err(error) => this.set_status(format!("Downloaden mislukt: {error}"), true, cx),
            });
        })
        .detach();
    }

    /// A short line in the reader's toolbar, gone after a while unless a newer one replaced it.
    pub(super) fn set_status(&mut self, text: String, failed: bool, cx: &mut Context<Self>) {
        self.status_serial += 1;
        let serial = self.status_serial;
        self.status = Some((text.into(), failed));
        cx.notify();
        cx.spawn(async move |this, cx| {
            cx.background_executor().timer(STATUS_FOR).await;
            let _ = this.update(cx, |this, cx| {
                if this.status_serial == serial {
                    this.status = None;
                    cx.notify();
                }
            });
        })
        .detach();
    }
}

/// A name that stays inside the folder it is saved in: no path separators,
/// no hidden or parent names, no characters that hide the real extension.
pub(super) fn safe_name(name: &str) -> String {
    const MAX_BYTES: usize = 200;
    let cleaned: String = name
        .chars()
        .filter(|c| !matches!(c, '\u{200e}' | '\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}'))
        .map(|c| match c {
            '/' | '\\' | ':' | '<' | '>' | '"' | '|' | '?' | '*' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    let trimmed = cleaned
        .trim()
        .trim_start_matches('.')
        .trim_end_matches(['.', ' '])
        .trim();
    if trimmed.is_empty() {
        return "bijlage".into();
    }
    if trimmed.len() <= MAX_BYTES {
        return trimmed.to_string();
    }
    // Too long for the disk: shorten the name, keep the extension.
    let (stem, extension) = split_extension(trimmed);
    let extension = if extension.len() <= 16 { extension } else { "" };
    let mut out = String::new();
    for c in stem.chars() {
        if out.len() + c.len_utf8() + extension.len() > MAX_BYTES {
            break;
        }
        out.push(c);
    }
    out.push_str(extension);
    out
}

/// "rapport.pdf" into "rapport" and ".pdf"; a name without one has none.
fn split_extension(name: &str) -> (&str, &str) {
    match name.rfind('.') {
        Some(dot) if dot > 0 => name.split_at(dot),
        _ => (name, ""),
    }
}

/// Saves under a name nothing in the folder has yet: "rapport (1).pdf" next
/// to "rapport.pdf". Never overwrites, also not a file that appears meanwhile.
pub(super) fn save(dir: &Path, name: &str, bytes: &[u8]) -> io::Result<PathBuf> {
    let name = safe_name(name);
    let (stem, extension) = split_extension(&name);
    for n in 0..1000 {
        let candidate = if n == 0 {
            name.clone()
        } else {
            format!("{stem} ({n}){extension}")
        };
        let path = dir.join(candidate);
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                if let Err(error) = file.write_all(bytes) {
                    let _ = std::fs::remove_file(&path);
                    return Err(error);
                }
                return Ok(path);
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "te veel bestanden met deze naam",
    ))
}

/// Shows the file in Finder. It came from a stranger, so macOS gets to check it
/// before it opens, as with anything a browser downloads.
fn reveal(path: &Path) {
    #[cfg(target_os = "macos")]
    {
        let seconds = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let _ = std::process::Command::new("/usr/bin/xattr")
            .args(["-w", "com.apple.quarantine", &format!("0081;{seconds:x};Even;")])
            .arg(path)
            .status();
        let _ = std::process::Command::new("/usr/bin/open").arg("-R").arg(path).spawn();
    }
    #[cfg(not(target_os = "macos"))]
    if let Some(dir) = path.parent() {
        let _ = open::that_detached(dir);
    }
}

#[cfg(test)]
mod tests {
    use super::{safe_name, save};

    #[test]
    fn names_stay_in_their_folder() {
        assert_eq!(safe_name("rapport.pdf"), "rapport.pdf");
        assert_eq!(safe_name("../../etc/passwd"), "_.._etc_passwd");
        assert_eq!(safe_name("..\\x.exe"), "_x.exe");
        assert_eq!(safe_name(".hidden"), "hidden");
        assert_eq!(safe_name(".."), "bijlage");
        assert_eq!(safe_name("  "), "bijlage");
        assert_eq!(safe_name("a\nb:c.txt"), "a_b_c.txt");
        // Right-to-left override: "invoice\u{202e}fdp.exe" would read as "invoiceexe.pdf".
        assert_eq!(safe_name("invoice\u{202e}fdp.exe"), "invoicefdp.exe");
        let long = format!("{}.pdf", "a".repeat(300));
        let short = safe_name(&long);
        assert!(short.len() <= 200 && short.ends_with(".pdf"));
    }

    #[test]
    fn saving_never_overwrites() {
        let dir = std::env::temp_dir().join(format!("even-native-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let first = save(&dir, "rapport.pdf", b"1").unwrap();
        let second = save(&dir, "rapport.pdf", b"2").unwrap();
        let third = save(&dir, "../rapport.pdf", b"3").unwrap();
        let plain = save(&dir, "LEESMIJ", b"4").unwrap();
        let plain_again = save(&dir, "LEESMIJ", b"5").unwrap();
        assert_eq!(first, dir.join("rapport.pdf"));
        assert_eq!(second, dir.join("rapport (1).pdf"));
        assert_eq!(third, dir.join("_rapport.pdf"));
        assert_eq!(plain_again, dir.join("LEESMIJ (1)"));
        assert_eq!(std::fs::read(&first).unwrap(), b"1");
        assert_eq!(std::fs::read(&second).unwrap(), b"2");
        assert_eq!(std::fs::read(&plain).unwrap(), b"4");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
