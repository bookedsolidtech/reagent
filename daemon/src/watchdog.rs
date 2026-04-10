//! Self-protection watchdog for the reagent-daemon.
//!
//! Runs as a background tokio task. Checks every 60 seconds:
//!
//! - If uptime exceeds `idle_warn_hours` AND the session registry is empty,
//!   logs a warning so operators know the daemon is idle.
//! - If uptime exceeds `max_uptime_hours`, sends a signal on `shutdown_tx`
//!   to initiate graceful self-shutdown. This prevents zombie daemons that
//!   have been running for days unnoticed.
//!
//! Thresholds are read from `DaemonConfig` (daemon.yaml fields
//! `idle_warn_hours` and `max_uptime_hours`).

use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{oneshot, RwLock};
use tracing::{info, warn};

use crate::session::SessionRegistry;

/// Spawn the watchdog background task.
///
/// `started_at` — Unix timestamp (seconds) when the daemon started.
/// `registry`   — shared session registry for idle detection.
/// `idle_warn_hours` — hours before logging an idle warning.
/// `max_uptime_hours` — hours before initiating graceful shutdown.
/// `shutdown_tx` — oneshot sender; firing it triggers graceful shutdown.
pub fn spawn_watchdog(
    started_at: u64,
    registry: Arc<RwLock<SessionRegistry>>,
    idle_warn_hours: u64,
    max_uptime_hours: u64,
    shutdown_tx: oneshot::Sender<()>,
) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(60));
        // Consume the first (immediate) tick so the watchdog does not fire at t=0.
        ticker.tick().await;

        let idle_warn_secs = idle_warn_hours * 3600;
        // max_uptime_hours == 0 means watchdog self-shutdown is disabled.
        let max_uptime_secs = if max_uptime_hours == 0 { u64::MAX } else { max_uptime_hours * 3600 };

        // shutdown_tx is consumed on first use — wrap in Option to track that.
        let mut shutdown_tx = Some(shutdown_tx);

        loop {
            ticker.tick().await;

            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(started_at);
            let uptime_secs = now.saturating_sub(started_at);

            if uptime_secs >= max_uptime_secs {
                warn!(
                    uptime_hours = uptime_secs / 3600,
                    max_uptime_hours,
                    "Watchdog: daemon has exceeded max_uptime_hours — initiating graceful self-shutdown"
                );
                if let Some(tx) = shutdown_tx.take() {
                    let _ = tx.send(());
                }
                // Task is done once shutdown is signalled.
                break;
            }

            if uptime_secs >= idle_warn_secs {
                let session_count = {
                    let guard = registry.read().await;
                    guard.len()
                };
                if session_count == 0 {
                    warn!(
                        uptime_hours = uptime_secs / 3600,
                        idle_warn_hours,
                        "Watchdog: daemon is idle (no active sessions) — consider restarting"
                    );
                } else {
                    info!(
                        uptime_hours = uptime_secs / 3600,
                        session_count,
                        "Watchdog: long-running daemon has {} active session(s)",
                        session_count
                    );
                }
            }
        }
    });
}
