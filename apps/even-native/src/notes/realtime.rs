//! Word from the API that something in the user's workspaces changed, as the
//! web hears it (apps/notes-web/src/hooks/use-workspace.ts, through Ably). The
//! web uses Ably's websocket client; this listens to the same channel over
//! Ably's event stream, with the same subscribe-only token from /api/realtime.
//! Messages carry no data: each one only says "ask again".

use std::io::{BufRead as _, BufReader};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Context as _, Result};
use futures::channel::mpsc::{unbounded, UnboundedReceiver, UnboundedSender};

use crate::api::Client;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Signal {
    /// Listening. Ask once now: something may have changed while away.
    Connected,
    /// Something changed in one of the user's workspaces.
    Changed,
    /// The stream ended; trying again shortly.
    Disconnected,
}

/// Stops listening when dropped.
pub struct Realtime {
    stop: Arc<AtomicBool>,
}

impl Drop for Realtime {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

/// Listens on its own thread (the calls block) until the handle is dropped.
pub fn start(client: Client, user_id: String) -> (Realtime, UnboundedReceiver<Signal>) {
    let (sender, receiver) = unbounded();
    let stop = Arc::new(AtomicBool::new(false));
    let stopped = stop.clone();
    std::thread::Builder::new()
        .name("notes-realtime".into())
        .spawn(move || {
            let mut wait = 2;
            while !stopped.load(Ordering::Relaxed) {
                let connected = listen(&client, &user_id, &sender, &stopped).unwrap_or(false);
                if sender.unbounded_send(Signal::Disconnected).is_err() {
                    return;
                }
                // A stream that worked comes straight back (its token ran out);
                // one that didn't waits longer each time.
                wait = if connected { 2 } else { (wait * 2).min(60) };
                for _ in 0..wait * 4 {
                    if stopped.load(Ordering::Relaxed) {
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(250));
                }
            }
        })
        .ok();
    (Realtime { stop }, receiver)
}

/// One connection, until it ends. `Ok(true)` when it got as far as listening.
fn listen(client: &Client, user_id: &str, sender: &UnboundedSender<Signal>, stop: &AtomicBool) -> Result<bool> {
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(10))
        // Ably sends a keep-alive well within this; silence means the line is dead.
        .timeout_read(Duration::from_secs(90))
        .build();
    // The API signs a request for a token; Ably turns it into the token (15 minutes).
    let request: serde_json::Value = client.get_json("/api/realtime")?;
    let key = request
        .get("keyName")
        .and_then(|key| key.as_str())
        .context("no key name")?;
    let token: serde_json::Value = agent
        .post(&format!("https://rest.ably.io/keys/{key}/requestToken"))
        .send_json(&request)
        .map_err(|error| anyhow!(error))?
        .into_json()?;
    let token = token.get("token").and_then(|token| token.as_str()).context("no token")?;
    let response = agent
        .get("https://realtime.ably.io/sse")
        .query("v", "1.2")
        .query("channels", &format!("workspace:{user_id}"))
        .query("accessToken", token)
        .call()
        .map_err(|error| anyhow!(error))?;
    if sender.unbounded_send(Signal::Connected).is_err() {
        return Ok(true);
    }
    let mut event = String::new();
    let mut has_data = false;
    for line in BufReader::new(response.into_reader()).lines() {
        let Ok(line) = line else { break };
        if stop.load(Ordering::Relaxed) {
            break;
        }
        if let Some(name) = line.strip_prefix("event:") {
            event = name.trim().to_string();
        } else if line.starts_with("data:") {
            has_data = true;
        } else if line.is_empty() {
            // A blank line ends an event; one without a name is a message.
            if has_data && (event.is_empty() || event == "message") {
                if sender.unbounded_send(Signal::Changed).is_err() {
                    break;
                }
            } else if event == "error" {
                break;
            }
            event.clear();
            has_data = false;
        }
    }
    Ok(true)
}
