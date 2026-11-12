//! Signing in through the browser, as the Tauri app does: the account site
//! hands a one-time code to http://127.0.0.1:<port>/callback, and the app
//! redeems it with its PKCE verifier for a session token of its own.

use std::io::{ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use anyhow::{anyhow, bail, Result};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use rand::RngCore as _;
use sha2::{Digest, Sha256};

use crate::api::{api_url, auth_url};

/// How long a sign-in waits for the browser.
const WAIT: Duration = Duration::from_secs(10 * 60);

/// Where the app keeps what it remembers: the session and the mail cache.
pub fn data_dir() -> Option<std::path::PathBuf> {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("APPDATA"))?;
    let dir = std::path::PathBuf::from(home);
    #[cfg(target_os = "macos")]
    let dir = dir.join("Library/Application Support/nl.jornboerema.even-native");
    #[cfg(not(target_os = "macos"))]
    let dir = dir.join("even-native");
    Some(dir)
}

/// The session lives in a file only this user can read, as the Tauri app keeps
/// it in its webview storage. Not the keychain: macOS asks for the password
/// there again after every build of an unsigned app.
fn session_file() -> Option<std::path::PathBuf> {
    Some(data_dir()?.join("session"))
}

pub fn stored_token() -> Option<String> {
    let token = std::fs::read_to_string(session_file()?).ok()?;
    let token = token.trim().to_string();
    (!token.is_empty()).then_some(token)
}

pub fn store_token(token: &str) {
    let Some(path) = session_file() else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    match options.open(&path) {
        Ok(mut file) => {
            if let Err(error) = file.write_all(token.as_bytes()) {
                eprintln!("Could not keep the session: {error}");
            }
        }
        Err(error) => eprintln!("Could not keep the session: {error}"),
    }
}

pub fn forget_token() {
    if let Some(path) = session_file() {
        let _ = std::fs::remove_file(path);
    }
}

fn random_value(bytes: usize) -> String {
    let mut buffer = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut buffer);
    URL_SAFE_NO_PAD.encode(buffer)
}

fn challenge_for(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// A sign-in that has its port and waits for the browser.
pub struct Attempt {
    listener: TcpListener,
    verifier: String,
    state: String,
    pub url: String,
}

impl Attempt {
    pub fn start() -> Result<Self> {
        let listener = TcpListener::bind(("127.0.0.1", 0))?;
        listener.set_nonblocking(true)?;
        let port = listener.local_addr()?.port();
        let verifier = random_value(48);
        let state = random_value(24);
        let mut url = url::Url::parse(&format!("{}/desktop", auth_url()))?;
        url.query_pairs_mut()
            .append_pair("port", &port.to_string())
            .append_pair("state", &state)
            .append_pair("challenge", &challenge_for(&verifier));
        Ok(Self {
            listener,
            verifier,
            state,
            url: url.to_string(),
        })
    }

    /// Waits for the browser, then trades the code for a session token.
    /// Stops early when `cancelled` turns true.
    pub fn finish(self, cancelled: Arc<AtomicBool>) -> Result<String> {
        let deadline = Instant::now() + WAIT;
        let done = format!("{}/desktop/done", auth_url());
        let query = loop {
            if cancelled.load(Ordering::SeqCst) {
                bail!("cancelled");
            }
            if Instant::now() > deadline {
                bail!("the browser took too long");
            }
            match self.listener.accept() {
                Ok((stream, _)) => {
                    if let Some(query) = answer(stream, &done) {
                        break query;
                    }
                }
                Err(error) if error.kind() == ErrorKind::WouldBlock => thread::sleep(Duration::from_millis(150)),
                Err(error) => return Err(error.into()),
            }
        };
        let params: std::collections::HashMap<String, String> =
            url::form_urlencoded::parse(query.as_bytes()).into_owned().collect();
        if params.get("state") != Some(&self.state) {
            bail!("the browser answered for another sign-in");
        }
        let code = params.get("code").ok_or_else(|| anyhow!("no code"))?;
        let response = ureq::post(&format!("{}/api/auth/desktop/token", api_url()))
            .set("Origin", "tauri://localhost")
            .send_json(serde_json::json!({ "code": code, "verifier": self.verifier }))
            .map_err(|error| anyhow!("signing in failed: {error}"))?;
        let token = response
            .header("set-auth-token")
            .filter(|token| !token.is_empty())
            .ok_or_else(|| anyhow!("no session in the answer"))?;
        Ok(token.to_string())
    }
}

/// Reads one request. The callback gets a redirect to the done page and hands
/// back its query; anything else (a favicon) gets a plain 404.
fn answer(mut stream: TcpStream, done_url: &str) -> Option<String> {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let mut buffer = [0u8; 8192];
    let read = stream.read(&mut buffer).unwrap_or(0);
    let request = String::from_utf8_lossy(&buffer[..read]);
    let target = request.lines().next().and_then(|line| {
        let mut parts = line.split(' ');
        (parts.next() == Some("GET")).then(|| parts.next()).flatten()
    });
    match target.and_then(|target| target.strip_prefix("/callback?")) {
        Some(query) => {
            let _ = write!(
                stream,
                "HTTP/1.1 302 Found\r\nLocation: {done_url}\r\nCache-Control: no-store\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            );
            Some(query.to_string())
        }
        None => {
            let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_values_fit_the_api() {
        let verifier = random_value(48);
        assert_eq!(verifier.len(), 64);
        assert!(verifier
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        // RFC 7636, appendix B.
        assert_eq!(
            challenge_for("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn callback_hands_over_the_query() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let mut client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        client
            .write_all(b"GET /callback?code=abc&state=xyz HTTP/1.1\r\n\r\n")
            .unwrap();
        let (server, _) = listener.accept().unwrap();
        assert_eq!(
            answer(server, "https://auth.example.nl/desktop/done").as_deref(),
            Some("code=abc&state=xyz")
        );
        let mut response = String::new();
        client.read_to_string(&mut response).unwrap();
        assert!(response.starts_with("HTTP/1.1 302"));
    }
}
