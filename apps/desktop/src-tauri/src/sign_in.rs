//! Signing in through the browser. The window asks for a port, opens the
//! account site with it, and waits; the account site sends the browser back to
//! http://127.0.0.1:<port>/callback with a one-time code. This answers that one
//! request by sending the browser on to the account site's "done" page, and
//! hands the query to the window, which redeems the code (with its PKCE
//! verifier) for a session.

use std::io::{ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager};

/// How long a sign-in waits for the browser.
const WAIT: Duration = Duration::from_secs(10 * 60);

/// Each sign-in gets a number; starting another one ends the one before.
static ATTEMPT: AtomicU64 = AtomicU64::new(0);

/// Starts listening on a free port on 127.0.0.1 and returns it. When the
/// browser arrives, the window hears `sign-in-callback` with the query string.
#[tauri::command]
pub fn listen_for_sign_in(app: AppHandle, done_url: String) -> Result<u16, String> {
    if !(done_url.starts_with("https://") || done_url.starts_with("http://localhost:")) {
        return Err("Unexpected done page".into());
    }
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let attempt = ATTEMPT.fetch_add(1, Ordering::SeqCst) + 1;
    thread::spawn(move || {
        let deadline = Instant::now() + WAIT;
        while Instant::now() < deadline && ATTEMPT.load(Ordering::SeqCst) == attempt {
            match listener.accept() {
                Ok((stream, _)) => {
                    if let Some(query) = answer(stream, &done_url) {
                        let _ = app.emit("sign-in-callback", query);
                        if let Some(window) = app.get_webview_window("main") {
                            crate::show(&window);
                        }
                        return;
                    }
                }
                Err(error) if error.kind() == ErrorKind::WouldBlock => thread::sleep(Duration::from_millis(150)),
                Err(_) => return,
            }
        }
    });
    Ok(port)
}

/// Stops waiting, e.g. when the window cancels.
#[tauri::command]
pub fn cancel_sign_in() {
    ATTEMPT.fetch_add(1, Ordering::SeqCst);
}

/// Reads one request. The callback gets a redirect to the done page and its
/// query back; anything else (a favicon) a plain 404.
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
    use super::answer;
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};

    fn request(raw: &str) -> (Option<String>, String) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let mut client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        client.write_all(raw.as_bytes()).unwrap();
        let (server, _) = listener.accept().unwrap();
        let query = answer(server, "https://auth.example.nl/desktop/done");
        let mut response = String::new();
        client.read_to_string(&mut response).unwrap();
        (query, response)
    }

    #[test]
    fn callback_hands_over_the_query_and_redirects() {
        let (query, response) = request("GET /callback?code=abc&state=xyz HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
        assert_eq!(query.as_deref(), Some("code=abc&state=xyz"));
        assert!(response.starts_with("HTTP/1.1 302"));
        assert!(response.contains("Location: https://auth.example.nl/desktop/done\r\n"));
    }

    #[test]
    fn anything_else_is_not_found() {
        let (query, response) = request("GET /favicon.ico HTTP/1.1\r\n\r\n");
        assert!(query.is_none());
        assert!(response.starts_with("HTTP/1.1 404"));
        let (query, _) = request("POST /callback?code=abc HTTP/1.1\r\n\r\n");
        assert!(query.is_none());
    }
}
