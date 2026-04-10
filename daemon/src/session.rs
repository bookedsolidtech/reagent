use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use tracing::{info, warn};

use crate::project::ProjectContext;

/// Opaque session identifier — a UUID v4 string.
pub type SessionId = String;

/// All active sessions. Held behind `Arc<RwLock<...>>` so SSE reader tasks
/// can hold a read guard concurrently while session create/destroy takes a
/// brief write lock.
///
/// INVARIANT: Never hold a write guard across an `.await` point.
pub struct SessionRegistry {
    sessions: HashMap<SessionId, ProjectContext>,
}

impl SessionRegistry {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    /// Insert a new session. Caller must hold the write lock.
    pub fn insert(&mut self, id: SessionId, ctx: ProjectContext) {
        self.sessions.insert(id, ctx);
    }

    /// Remove a session by ID. Does NOT kill the child — use
    /// `cleanup_session` for that.
    pub fn remove(&mut self, id: &SessionId) -> Option<ProjectContext> {
        self.sessions.remove(id)
    }

    /// Number of active sessions.
    pub fn len(&self) -> usize {
        self.sessions.len()
    }

    /// Mutable reference to a session by ID, or None if not found.
    pub fn get_mut(&mut self, id: &SessionId) -> Option<&mut ProjectContext> {
        self.sessions.get_mut(id)
    }

    /// Iterator over mutable references to all session contexts.
    /// Used during graceful shutdown to broadcast close events and kill children.
    pub fn values_mut(&mut self) -> impl Iterator<Item = &mut ProjectContext> {
        self.sessions.values_mut()
    }

    /// Remove all sessions. Used at the end of graceful shutdown after children
    /// have already been killed.
    pub fn clear(&mut self) {
        self.sessions.clear();
    }

    /// Return session IDs whose last_activity exceeds `ttl`.
    pub fn expired_ids(&self, ttl: Duration) -> Vec<SessionId> {
        self.sessions
            .iter()
            .filter(|(_, ctx)| ctx.last_activity.elapsed() > ttl)
            .map(|(id, _)| id.clone())
            .collect()
    }

    /// Return a summary of all sessions for the /sessions endpoint.
    pub fn summaries(&self) -> Vec<SessionSummary> {
        self.sessions
            .iter()
            .map(|(id, ctx)| SessionSummary {
                session_id: id.clone(),
                project_root: ctx.project_root.display().to_string(),
                last_activity_elapsed_secs: ctx.last_activity.elapsed().as_secs(),
            })
            .collect()
    }
}

/// Lightweight session summary returned by GET /sessions.
#[derive(serde::Serialize)]
pub struct SessionSummary {
    pub session_id: String,
    pub project_root: String,
    pub last_activity_elapsed_secs: u64,
}

/// Cleanly terminate a session: kill child process, remove from registry.
/// Safe to call even if the session has already been removed.
pub async fn cleanup_session(registry: &Arc<RwLock<SessionRegistry>>, id: &SessionId) {
    // Extract the context with a write lock (brief — no await while held).
    let ctx = {
        let mut guard = registry.write().await;
        guard.remove(id)
    };

    if let Some(mut ctx) = ctx {
        info!(session_id = %id, project_root = %ctx.project_root.display(), "Cleaning up session");
        if let Err(e) = ctx.child.kill().await {
            warn!(session_id = %id, "Failed to kill child process: {}", e);
        }
    }
}

/// Spawn a background tokio task that evicts sessions exceeding `ttl_minutes`.
/// Runs every 60 seconds; uses a read lock to collect expired IDs before
/// awaiting cleanup (never holds a write lock across await).
pub fn spawn_eviction_task(registry: Arc<RwLock<SessionRegistry>>, ttl_minutes: u64) {
    let ttl = Duration::from_secs(ttl_minutes * 60);

    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(60));
        loop {
            ticker.tick().await;

            // Collect expired IDs under a read lock — no await while held.
            let expired: Vec<SessionId> = {
                let guard = registry.read().await;
                guard.expired_ids(ttl)
            };

            for id in expired {
                info!(session_id = %id, "Evicting idle session (TTL exceeded)");
                cleanup_session(&registry, &id).await;
            }
        }
    });
}
