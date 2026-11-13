//! Updates, as the Tauri app has them (apps/desktop/src-tauri/src/updates.rs
//! and apps/desktop/src/updates.ts): looked for shortly after launch and every
//! hour, downloaded in the background, and then offered as "Restart to
//! update", so Even never quits by itself in the middle of a message.
//!
//! The native app has its own channel, apart from the Tauri app's
//! `even-updates` release: a `latest.json` of the same shape on the
//! `even-native-updates` release. Nothing is published there yet, and there is
//! no key to check a download against, so for now every check finds nothing.

use std::collections::HashMap;
use std::io::Read as _;
use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{anyhow, bail, Context as _, Result};
use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use gpui_kit::{Context, Task};
use serde::Deserialize;

/// Where the newest version is described. `EVEN_UPDATE_URL` names another place.
const MANIFEST_URL: &str = "https://github.com/JornBoerema/jornboerema/releases/download/even-native-updates/latest.json";

/// The minisign public key downloads are signed with, as Tauri's `pubkey`:
/// the key file in base64. Empty: updates stay off until a key is set, since
/// nothing may be installed that cannot be checked. It must not be the Tauri
/// app's key: that one signs another app.
const PUBLIC_KEY: &str = "";

/// updates.rs: how long after launch the first look is, and how often after it.
const FIRST_CHECK_AFTER: Duration = Duration::from_secs(10);
const CHECK_EVERY: Duration = Duration::from_secs(60 * 60);

/// No app is this big; a download that is, is not ours.
const MAX_DOWNLOAD: u64 = 1024 * 1024 * 1024;

/// `EVEN_UPDATE_DEBUG=ready`: the version that pretends to wait.
const PRETEND: &str = "9.9.9";

/// Tauri's latest.json.
#[derive(Debug, Deserialize)]
struct Manifest {
    version: String,
    #[allow(dead_code)]
    #[serde(default)]
    notes: Option<String>,
    #[allow(dead_code)]
    #[serde(default)]
    pub_date: Option<String>,
    #[serde(default)]
    platforms: HashMap<String, Download>,
}

#[derive(Debug, Deserialize)]
struct Download {
    url: String,
    /// The minisign signature file of the download, in base64.
    signature: String,
}

/// This computer in latest.json's words.
fn platform() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "darwin-aarch64"
    } else {
        "darwin-x86_64"
    }
}

fn version(text: &str) -> Option<semver::Version> {
    semver::Version::parse(text.trim().trim_start_matches('v')).ok()
}

/// Whether `candidate` is a later version than `current`. Anything that is not
/// a version is not newer.
fn is_newer(candidate: &str, current: &str) -> bool {
    match (version(candidate), version(current)) {
        (Some(candidate), Some(current)) => candidate > current,
        _ => false,
    }
}

/// The download for this computer, when the manifest names a later version.
fn offered<'a>(manifest: &'a Manifest, current: &str, platform: &str) -> Option<&'a Download> {
    if !is_newer(&manifest.version, current) {
        return None;
    }
    manifest.platforms.get(platform)
}

fn manifest_url() -> String {
    std::env::var("EVEN_UPDATE_URL")
        .ok()
        .filter(|url| !url.trim().is_empty())
        .unwrap_or_else(|| MANIFEST_URL.to_string())
}

/// The `.app` this runs from; nothing from `cargo run`.
fn bundle() -> Option<PathBuf> {
    let binary = std::env::current_exe().ok()?.canonicalize().ok()?;
    let macos = binary.parent()?;
    let contents = macos.parent()?;
    let bundle = contents.parent()?;
    let inside = macos.file_name()? == "MacOS" && contents.file_name()? == "Contents";
    (inside && bundle.extension()? == "app").then(|| bundle.to_path_buf())
}

/// Updates only reach a release build in a bundle, with a key to check them
/// against. A development build would "update" itself into the release.
fn enabled() -> bool {
    !cfg!(debug_assertions) && !PUBLIC_KEY.is_empty() && bundle().is_some()
}

/// Checks a download against its signature, as Tauri's updater does: the key
/// and the signature are minisign files in base64.
fn verify(bytes: &[u8], signature: &str, public_key: &str) -> Result<()> {
    let text = |encoded: &str| -> Result<String> { Ok(String::from_utf8(STANDARD.decode(encoded.trim())?)?) };
    let key = minisign_verify::PublicKey::decode(&text(public_key)?).map_err(|error| anyhow!("public key: {error}"))?;
    let signature =
        minisign_verify::Signature::decode(&text(signature)?).map_err(|error| anyhow!("signature: {error}"))?;
    key.verify(bytes, &signature, true)
        .map_err(|error| anyhow!("the download does not match its signature: {error}"))
}

/// A downloaded update, waiting to be installed.
#[derive(Clone, Debug)]
struct Ready {
    version: String,
    /// The checked `.app.tar.gz`; none for the pretend one.
    archive: Option<PathBuf>,
}

fn downloads() -> PathBuf {
    std::env::temp_dir().join("even-native-update")
}

/// Looks for a later version and downloads it. Nothing published (a 404), or
/// nothing later: `None`. Blocking: run it on the background executor.
fn fetch(have: Option<String>) -> Result<Option<Ready>> {
    let response = match ureq::get(&manifest_url()).timeout(Duration::from_secs(30)).call() {
        Ok(response) => response,
        // No release on the channel yet.
        Err(ureq::Error::Status(404, _)) => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    let manifest: Manifest = response.into_json().context("latest.json")?;
    let Some(download) = offered(&manifest, env!("CARGO_PKG_VERSION"), platform()) else {
        return Ok(None);
    };
    if have.as_deref() == Some(manifest.version.as_str()) {
        return Ok(None);
    }
    let mut bytes = Vec::new();
    ureq::get(&download.url)
        .timeout(Duration::from_secs(30 * 60))
        .call()?
        .into_reader()
        .take(MAX_DOWNLOAD + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_DOWNLOAD {
        bail!("the download is too big");
    }
    verify(&bytes, &download.signature, PUBLIC_KEY)?;
    let folder = downloads();
    // Earlier downloads are of older versions.
    let _ = std::fs::remove_dir_all(&folder);
    std::fs::create_dir_all(&folder)?;
    let archive = folder.join(format!("Even-{}.app.tar.gz", manifest.version));
    std::fs::write(&archive, bytes)?;
    Ok(Some(Ready {
        version: manifest.version,
        archive: Some(archive),
    }))
}

/// Puts the app from `archive` where `bundle` is. The old one is only gone once
/// the new one is in place; when that fails it is put back.
fn install(archive: &Path, bundle: &Path) -> Result<()> {
    let parent = bundle.parent().ok_or_else(|| anyhow!("the app has no folder"))?;
    let name = bundle
        .file_name()
        .ok_or_else(|| anyhow!("the app has no name"))?
        .to_string_lossy();
    // Beside the app, so both moves stay on one disk.
    let staging = parent.join(format!(".{name}.update-{}", std::process::id()));
    let old = parent.join(format!(".{name}.old-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&staging);
    let result = (|| -> Result<()> {
        std::fs::create_dir_all(&staging)?;
        let file = std::fs::File::open(archive)?;
        // `unpack` writes nothing outside the folder it is given.
        tar::Archive::new(flate2::read::GzDecoder::new(file)).unpack(&staging)?;
        let fresh = std::fs::read_dir(&staging)?
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .find(|path| path.extension().is_some_and(|extension| extension == "app") && path.is_dir())
            .ok_or_else(|| anyhow!("no app in the download"))?;
        std::fs::rename(bundle, &old)?;
        if let Err(error) = std::fs::rename(&fresh, bundle) {
            let _ = std::fs::rename(&old, bundle);
            return Err(error.into());
        }
        Ok(())
    })();
    let _ = std::fs::remove_dir_all(&staging);
    let _ = std::fs::remove_dir_all(&old);
    result
}

/// What "Check for updates" last found, for the About page (AboutSettings'
/// `status`).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Status {
    Idle,
    Checking,
    /// Looked, and this is the newest.
    Current,
    Failed,
}

/// The web's `DesktopApp`: the version that is ready, checking and installing.
/// Observe it to hear when any of that changes.
pub struct Updates {
    ready: Option<Ready>,
    status: Status,
    restarting: bool,
    /// A look is under way (the hourly one, or the button's).
    looking: bool,
    /// `EVEN_UPDATE_DEBUG=ready`: shows the button and the row, installs nothing.
    pretend: bool,
}

impl Updates {
    pub fn new(cx: &mut Context<Self>) -> Self {
        let pretend = std::env::var("EVEN_UPDATE_DEBUG").is_ok_and(|value| value == "ready");
        let updates = Self {
            ready: pretend.then(|| Ready {
                version: PRETEND.to_string(),
                archive: None,
            }),
            status: Status::Idle,
            restarting: false,
            looking: false,
            pretend,
        };
        if enabled() && !pretend {
            Self::watch(cx);
        }
        updates
    }

    /// updates.rs, `watch`: shortly after launch and then every hour.
    fn watch(cx: &mut Context<Self>) {
        cx.spawn(async move |this, cx| {
            cx.background_executor().timer(FIRST_CHECK_AFTER).await;
            loop {
                let Ok(look) = this.update(cx, |this, cx| this.look(cx)) else {
                    return;
                };
                if let Some(Err(error)) = look.await {
                    eprintln!("Update check failed: {error}");
                }
                cx.background_executor().timer(CHECK_EVERY).await;
            }
        })
        .detach();
    }

    /// The version that is downloaded and waits for a restart.
    pub fn ready(&self) -> Option<&str> {
        self.ready.as_ref().map(|ready| ready.version.as_str())
    }

    pub fn status(&self) -> Status {
        self.status
    }

    pub fn restarting(&self) -> bool {
        self.restarting
    }

    /// Looks for a later version and downloads it. `None` when a look is
    /// already under way or there is nothing to look for; otherwise whether
    /// one is ready now.
    fn look(&mut self, cx: &mut Context<Self>) -> Task<Option<Result<bool>>> {
        if self.looking || self.pretend || !enabled() {
            return Task::ready(None);
        }
        self.looking = true;
        let have = self.ready.as_ref().map(|ready| ready.version.clone());
        let fetch = cx.background_executor().spawn(async move { fetch(have) });
        cx.spawn(async move |this, cx| {
            let found = fetch.await;
            this.update(cx, |this, cx| {
                this.looking = false;
                match found {
                    Ok(Some(ready)) => {
                        this.ready = Some(ready);
                        cx.notify();
                        Ok(true)
                    }
                    Ok(None) => Ok(this.ready.is_some()),
                    Err(error) => Err(error),
                }
            })
            .ok()
        })
    }

    /// "Check for updates" in the settings.
    pub fn check(&mut self, cx: &mut Context<Self>) {
        if self.status == Status::Checking {
            return;
        }
        self.status = Status::Checking;
        cx.notify();
        let look = self.look(cx);
        cx.spawn(async move |this, cx| {
            let found = look.await;
            let _ = this.update(cx, |this, cx| {
                this.status = match found {
                    Some(Ok(true)) => Status::Idle,
                    // Nothing later, or nowhere to look from (a development build).
                    Some(Ok(false)) | None => Status::Current,
                    Some(Err(error)) => {
                        eprintln!("Update check failed: {error}");
                        Status::Failed
                    }
                };
                cx.notify();
            });
        })
        .detach();
    }

    /// "Restart to update": installs the downloaded version and restarts into it.
    pub fn install(&mut self, cx: &mut Context<Self>) {
        // The pretend version is only there to be looked at.
        if self.pretend || self.restarting {
            return;
        }
        let (Some(archive), Some(bundle)) = (self.ready.as_ref().and_then(|ready| ready.archive.clone()), bundle())
        else {
            return;
        };
        self.restarting = true;
        cx.notify();
        let target = bundle.clone();
        let swap = cx.background_executor().spawn(async move { install(&archive, &target) });
        cx.spawn(async move |this, cx| {
            let result = swap.await;
            let _ = this.update(cx, |this, cx| match result {
                Ok(()) => {
                    let _ = std::fs::remove_dir_all(downloads());
                    crate::window::save();
                    cx.set_restart_path(bundle);
                    cx.restart();
                }
                Err(error) => {
                    eprintln!("Could not install the update: {error}");
                    this.restarting = false;
                    cx.notify();
                }
            });
        })
        .detach();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// As Tauri writes it for the desktop app.
    const LATEST: &str = r#"{
        "version": "0.2.0",
        "notes": "Faster.",
        "pub_date": "2026-11-13T10:00:00Z",
        "platforms": {
            "darwin-aarch64": { "url": "https://example.nl/Even_aarch64.app.tar.gz", "signature": "c2lnLWFybQ==" },
            "darwin-x86_64": { "url": "https://example.nl/Even_x64.app.tar.gz", "signature": "c2lnLXg2NA==" },
            "windows-x86_64": { "url": "https://example.nl/Even.exe", "signature": "c2lnLXdpbg==" }
        }
    }"#;

    #[test]
    fn later_versions_are_newer() {
        assert!(is_newer("0.1.1", "0.1.0"));
        assert!(is_newer("0.2.0", "0.1.24"));
        assert!(is_newer("0.10.0", "0.9.9"));
        assert!(is_newer("1.0.0", "0.99.99"));
        assert!(is_newer("v0.1.1", "0.1.0"));
        // A release is later than its own pre-releases.
        assert!(is_newer("1.0.0", "1.0.0-beta.2"));
        assert!(is_newer("1.0.0-beta.2", "1.0.0-beta.1"));
    }

    #[test]
    fn the_same_or_older_is_not_newer() {
        assert!(!is_newer("0.1.0", "0.1.0"));
        assert!(!is_newer("0.1.0", "0.1.1"));
        assert!(!is_newer("0.9.9", "0.10.0"));
        assert!(!is_newer("1.0.0-beta.1", "1.0.0"));
    }

    #[test]
    fn what_is_not_a_version_is_not_newer() {
        assert!(!is_newer("", "0.1.0"));
        assert!(!is_newer("latest", "0.1.0"));
        assert!(!is_newer("1.0", "0.1.0"));
        assert!(!is_newer("9.9.9", "unknown"));
    }

    #[test]
    fn reads_tauris_latest_json() {
        let manifest: Manifest = serde_json::from_str(LATEST).unwrap();
        assert_eq!(manifest.version, "0.2.0");
        assert_eq!(manifest.notes.as_deref(), Some("Faster."));
        assert_eq!(manifest.pub_date.as_deref(), Some("2026-11-13T10:00:00Z"));
        let arm = &manifest.platforms["darwin-aarch64"];
        assert_eq!(arm.url, "https://example.nl/Even_aarch64.app.tar.gz");
        assert_eq!(arm.signature, "c2lnLWFybQ==");
        assert_eq!(manifest.platforms["darwin-x86_64"].url, "https://example.nl/Even_x64.app.tar.gz");
    }

    #[test]
    fn reads_a_manifest_without_notes() {
        let manifest: Manifest = serde_json::from_str(r#"{"version":"1.0.0","platforms":{}}"#).unwrap();
        assert_eq!(manifest.notes, None);
        assert!(manifest.platforms.is_empty());
        assert!(serde_json::from_str::<Manifest>(r#"{"platforms":{}}"#).is_err());
        assert!(serde_json::from_str::<Manifest>("<html>Not Found</html>").is_err());
    }

    #[test]
    fn offers_a_later_version_for_this_computer_only() {
        let manifest: Manifest = serde_json::from_str(LATEST).unwrap();
        let download = offered(&manifest, "0.1.0", "darwin-aarch64").unwrap();
        assert_eq!(download.url, "https://example.nl/Even_aarch64.app.tar.gz");
        assert!(offered(&manifest, "0.1.0", "darwin-x86_64").is_some());
        assert!(offered(&manifest, "0.1.0", "linux-x86_64").is_none());
        assert!(offered(&manifest, "0.2.0", "darwin-aarch64").is_none());
        assert!(offered(&manifest, "0.3.0", "darwin-aarch64").is_none());
        assert!(manifest.platforms.contains_key(platform()));
    }

    #[test]
    fn nothing_installs_without_a_key_or_a_good_signature() {
        assert!(verify(b"an app", "c2lnLWFybQ==", "").is_err());
        assert!(verify(b"an app", "not base64!", PUBLIC_KEY).is_err());
        // Until there is a key, and always from `cargo test`, updates are off.
        assert!(!enabled());
    }

    #[test]
    fn cargo_run_is_not_a_bundle() {
        assert_eq!(bundle(), None);
    }

    fn archive_of(folder: &Path, app: &str, marker: &str) -> PathBuf {
        let source = folder.join("source").join(app).join("Contents");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::write(source.join("Info.plist"), marker).unwrap();
        let archive = folder.join("update.app.tar.gz");
        let file = std::fs::File::create(&archive).unwrap();
        let mut tar = tar::Builder::new(flate2::write::GzEncoder::new(file, flate2::Compression::default()));
        tar.append_dir_all(app, folder.join("source").join(app)).unwrap();
        tar.into_inner().unwrap().finish().unwrap();
        archive
    }

    #[test]
    fn installing_swaps_the_app_and_leaves_nothing_behind() {
        let folder = std::env::temp_dir().join(format!("even-native-update-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&folder);
        let installed = folder.join("Applications").join("Even Native.app");
        std::fs::create_dir_all(installed.join("Contents")).unwrap();
        std::fs::write(installed.join("Contents/Info.plist"), "old").unwrap();
        // Whatever the app is called inside the download, it lands where the old one was.
        let archive = archive_of(&folder, "Even.app", "new");

        install(&archive, &installed).unwrap();
        assert_eq!(std::fs::read_to_string(installed.join("Contents/Info.plist")).unwrap(), "new");
        let left: Vec<_> = std::fs::read_dir(folder.join("Applications"))
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(left, ["Even Native.app"]);

        // A download without an app in it changes nothing.
        let empty = folder.join("empty.tar.gz");
        let file = std::fs::File::create(&empty).unwrap();
        tar::Builder::new(flate2::write::GzEncoder::new(file, flate2::Compression::default()))
            .into_inner()
            .unwrap()
            .finish()
            .unwrap();
        assert!(install(&empty, &installed).is_err());
        assert_eq!(std::fs::read_to_string(installed.join("Contents/Info.plist")).unwrap(), "new");
        let _ = std::fs::remove_dir_all(&folder);
    }
}
