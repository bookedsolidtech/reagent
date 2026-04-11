use anyhow::{Context, Result};
use axum::response::sse::Event;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot, Mutex};
use tracing::{error, info, warn};

/// A bounded SSE sender channel. Capacity 64 — a slow client causes message
/// drops, not unbounded memory growth. Never apply backpressure to child stdout.
const SSE_CHANNEL_CAPACITY: usize = 64;

/// Type alias for the SSE event sender half.
pub type SseSender = mpsc::Sender<Result<Event, std::convert::Infallible>>;

/// Type alias for the SSE event receiver half used by axum's Sse handler.
pub type SseReceiver = mpsc::Receiver<Result<Event, std::convert::Infallible>>;

/// Sender used to write JSON-RPC messages into the child's stdin.
pub type StdinSender = mpsc::Sender<String>;

/// Pending request-response waiters: JSON-RPC `id` → oneshot response sender.
///
/// When a POST /mcp body contains a JSON-RPC request (has an `id`), the handler
/// registers a oneshot sender here before forwarding to child stdin. The stdout
/// reader task routes matching responses back to the waiter, bypassing SSE.
pub type PendingResponses = Arc<Mutex<HashMap<serde_json::Value, oneshot::Sender<String>>>>;

/// Owns a spawned `reagent serve` child process and the stdio channels bridging
/// it to the SSE transport layer.
pub struct ProjectContext {
    pub project_root: PathBuf,
    pub child: Child,
    /// Send SSE events to the connected editor client.
    pub sse_tx: SseSender,
    /// Pending SSE receiver — held until claimed by the GET /mcp SSE handler.
    /// Becomes None once the first SSE connection takes it. A new (sse_tx, sse_rx)
    /// pair would be needed to support reconnects (future work).
    sse_rx: Option<SseReceiver>,
    /// Send JSON-RPC messages into the child process stdin.
    pub stdin_tx: StdinSender,
    /// Updated on every MCP message; used for TTL eviction.
    pub last_activity: Instant,
    /// Pending request-response correlation map (shared with stdout reader task).
    pub pending: PendingResponses,
}

impl ProjectContext {
    /// Spawn `reagent serve` as a child process in `project_root`, wire up the
    /// stdio bridge tasks, and return a ready `ProjectContext`.
    ///
    /// The caller must already have verified that `project_root` contains a
    /// `.reagent/policy.yaml` before calling this.
    ///
    /// `reagent_bin` overrides the binary path; defaults to `"reagent"` (resolved
    /// via PATH). Set `REAGENT_BIN` env var or pass explicitly for tests / dev.
    pub async fn spawn(project_root: &Path, session_id: &str, reagent_bin_override: Option<&str>) -> Result<Self> {
        // Resolution order: explicit override (from config) → REAGENT_BIN env → "reagent"
        let reagent_bin = reagent_bin_override
            .map(|s| s.to_string())
            .or_else(|| std::env::var("REAGENT_BIN").ok())
            .unwrap_or_else(|| "reagent".to_string());

        // Support "node /path/to/script.js" style values by splitting on first space
        let (cmd, extra_args): (&str, Vec<&str>) = if reagent_bin.contains(' ') {
            let mut parts = reagent_bin.splitn(2, ' ');
            let cmd = parts.next().unwrap();
            let rest = parts.next().unwrap_or("");
            (cmd, rest.split_whitespace().collect())
        } else {
            (&reagent_bin, vec![])
        };

        info!(
            session_id = %session_id,
            project_root = %project_root.display(),
            binary = %reagent_bin,
            "Spawning reagent serve child process"
        );

        let mut child = Command::new(cmd)
            .args(extra_args)
            .args(["serve"])
            .current_dir(project_root)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::inherit())
            .spawn()
            .with_context(|| {
                format!(
                    "Failed to spawn `{reagent_bin} serve`. \
                     Is reagent installed and on PATH, or set REAGENT_BIN?"
                )
            })?;

        let child_stdout = child
            .stdout
            .take()
            .context("Child stdout was not piped — this is a bug")?;

        let child_stdin = child
            .stdin
            .take()
            .context("Child stdin was not piped — this is a bug")?;

        // SSE channel: child stdout → editor client (for server-initiated events)
        let (sse_tx, sse_rx) =
            mpsc::channel::<Result<Event, std::convert::Infallible>>(SSE_CHANNEL_CAPACITY);

        // Stdin channel: HTTP POST handler → child stdin
        let (stdin_tx, stdin_rx) = mpsc::channel::<String>(64);

        // Pending response map: JSON-RPC id → oneshot sender (shared with reader task)
        let pending: PendingResponses = Arc::new(Mutex::new(HashMap::new()));
        let pending_clone = Arc::clone(&pending);

        // Spawn the reader task: child stdout → (pending response OR SSE)
        //
        // Routing priority:
        //   1. If the line is valid JSON with an `id` field AND a waiter is registered
        //      in `pending`, route to the waiter's oneshot channel (Streamable HTTP response).
        //   2. Otherwise, forward to the SSE channel for server-initiated delivery.
        //
        // IMPORTANT: SSE send failures do NOT terminate the reader. The child may still
        // produce responses for in-flight requests even after the SSE client disconnects.
        let sse_tx_clone = sse_tx.clone();
        let sid = session_id.to_string();
        tokio::spawn(async move {
            let mut lines = BufReader::new(child_stdout).lines();
            loop {
                match lines.next_line().await {
                    Ok(Some(line)) => {
                        // Attempt to route to a pending request waiter first
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
                            if let Some(id) = v.get("id").cloned() {
                                let mut pending_map = pending_clone.lock().await;
                                if let Some(tx) = pending_map.remove(&id) {
                                    // Route response to awaiting POST handler
                                    let _ = tx.send(line);
                                    continue;
                                }
                            }
                        }
                        // Forward to SSE (server-initiated events, unmatched lines)
                        let event = Event::default().data(line);
                        if let Err(e) = sse_tx_clone.send(Ok(event)).await {
                            // SSE receiver dropped — client disconnected. Keep reading
                            // child stdout so pending request waiters still get routed.
                            warn!(session_id = %sid, "SSE send failed (client likely disconnected): {}", e);
                        }
                    }
                    Ok(None) => {
                        // Child stdout closed (process exited)
                        info!(session_id = %sid, "Child process stdout closed");
                        break;
                    }
                    Err(e) => {
                        error!(session_id = %sid, "Error reading child stdout: {}", e);
                        break;
                    }
                }
            }
        });

        // Spawn the writer task: stdin channel → child stdin
        let sid = session_id.to_string();
        tokio::spawn(async move {
            let mut stdin = child_stdin;
            let mut rx = stdin_rx;
            while let Some(msg) = rx.recv().await {
                let line = if msg.ends_with('\n') {
                    msg
                } else {
                    format!("{}\n", msg)
                };
                if let Err(e) = stdin.write_all(line.as_bytes()).await {
                    warn!(session_id = %sid, "Failed to write to child stdin: {}", e);
                    break;
                }
            }
            // rx closed — flush and close stdin so the child can exit cleanly
            let _ = stdin.flush().await;
        });

        Ok(ProjectContext {
            project_root: project_root.to_path_buf(),
            child,
            sse_tx,
            sse_rx: Some(sse_rx),
            stdin_tx,
            last_activity: Instant::now(),
            pending,
        })
    }

    /// Update the last-activity timestamp. Call on every MCP message.
    pub fn touch(&mut self) {
        self.last_activity = Instant::now();
    }

    /// Take the pending SSE receiver for streaming to a connected client.
    ///
    /// Returns `Some(receiver)` on the first call (new connection), then `None`
    /// on all subsequent calls (stream already claimed). The caller is responsible
    /// for serving the stream until the client disconnects.
    pub fn take_sse_rx(&mut self) -> Option<SseReceiver> {
        self.sse_rx.take()
    }
}
