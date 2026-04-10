use anyhow::{Context, Result};
use axum::response::sse::Event;
use std::path::{Path, PathBuf};
use std::time::Instant;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;
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

/// Owns a spawned `reagent serve` child process and the stdio channels bridging
/// it to the SSE transport layer.
pub struct ProjectContext {
    pub project_root: PathBuf,
    pub child: Child,
    /// Send SSE events to the connected editor client.
    pub sse_tx: SseSender,
    /// Send JSON-RPC messages into the child process stdin.
    pub stdin_tx: StdinSender,
    /// Updated on every MCP message; used for TTL eviction.
    pub last_activity: Instant,
}

impl ProjectContext {
    /// Spawn `reagent serve` as a child process in `project_root`, wire up the
    /// stdio bridge tasks, and return a ready `ProjectContext`.
    ///
    /// The caller must already have verified that `project_root` contains a
    /// `.reagent/policy.yaml` before calling this.
    pub async fn spawn(project_root: &Path, session_id: &str) -> Result<(Self, SseReceiver)> {
        info!(
            session_id = %session_id,
            project_root = %project_root.display(),
            "Spawning reagent serve child process"
        );

        let mut child = Command::new("reagent")
            .args(["serve"])
            .current_dir(project_root)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::inherit())
            .spawn()
            .context("Failed to spawn `reagent serve`. Is reagent installed and on PATH?")?;

        let child_stdout = child
            .stdout
            .take()
            .context("Child stdout was not piped — this is a bug")?;

        let child_stdin = child
            .stdin
            .take()
            .context("Child stdin was not piped — this is a bug")?;

        // SSE channel: child stdout → editor client
        let (sse_tx, sse_rx) = mpsc::channel::<Result<Event, std::convert::Infallible>>(SSE_CHANNEL_CAPACITY);

        // Stdin channel: HTTP POST handler → child stdin
        let (stdin_tx, stdin_rx) = mpsc::channel::<String>(64);

        // Spawn the reader task: child stdout → SSE sender
        let sse_tx_clone = sse_tx.clone();
        let sid = session_id.to_string();
        tokio::spawn(async move {
            let mut lines = BufReader::new(child_stdout).lines();
            loop {
                match lines.next_line().await {
                    Ok(Some(line)) => {
                        let event = Event::default().data(line);
                        if sse_tx_clone.send(Ok(event)).await.is_err() {
                            // SSE receiver dropped — client disconnected
                            info!(session_id = %sid, "SSE receiver dropped, stopping stdout reader");
                            break;
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

        let ctx = ProjectContext {
            project_root: project_root.to_path_buf(),
            child,
            sse_tx,
            stdin_tx,
            last_activity: Instant::now(),
        };

        Ok((ctx, sse_rx))
    }

    /// Update the last-activity timestamp. Call on every MCP message.
    pub fn touch(&mut self) {
        self.last_activity = Instant::now();
    }
}
