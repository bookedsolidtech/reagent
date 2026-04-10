use std::sync::Arc;
use std::time::{Duration, UNIX_EPOCH};
use axum::{
    extract::{State, Query},
    http::{HeaderMap, StatusCode},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Json,
    },
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tokio_stream::wrappers::ReceiverStream;
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::project::ProjectContext;
use crate::session::{cleanup_session, SessionId, SessionRegistry, SessionSummary};
use crate::AppState;

/// Build the axum Router with all reagent daemon routes.
pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health_handler))
        .route("/sessions", get(sessions_handler))
        .route("/mcp", get(mcp_sse_handler).post(mcp_post_handler))
        .with_state(state)
}

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    version: &'static str,
    sessions: usize,
    uptime_seconds: u64,
}

async fn health_handler(State(state): State<AppState>) -> Json<HealthResponse> {
    let session_count = {
        let guard = state.registry.read().await;
        guard.len()
    };

    let uptime_seconds = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs().saturating_sub(state.started_at))
        .unwrap_or(0);

    Json(HealthResponse {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
        sessions: session_count,
        uptime_seconds,
    })
}

// ---------------------------------------------------------------------------
// GET /sessions
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct SessionsResponse {
    sessions: Vec<SessionSummary>,
}

async fn sessions_handler(State(state): State<AppState>) -> Json<SessionsResponse> {
    let guard = state.registry.read().await;
    Json(SessionsResponse {
        sessions: guard.summaries(),
    })
}

// ---------------------------------------------------------------------------
// POST /mcp — receive JSON-RPC from editor, route to child process stdin
// ---------------------------------------------------------------------------

/// POST /mcp expects:
///   Header: `X-Project-Root: /abs/path/to/project`
///   Header: `X-Session-Id: <uuid>` (optional — omit to create a new session)
///   Body: JSON-RPC message string
async fn mcp_post_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: String,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let project_root = headers
        .get("x-project-root")
        .and_then(|v| v.to_str().ok())
        .filter(|v| !v.is_empty())
        .map(|v| v.to_string())
        .or_else(|| state.config.default_project_root.clone())
        .ok_or_else(|| (
            StatusCode::BAD_REQUEST,
            "Missing X-Project-Root header and no default_project_root set in ~/.reagent/daemon.yaml".to_string(),
        ))?;
    let project_path = std::path::PathBuf::from(&project_root);

    if !project_path.is_absolute() {
        return Err((
            StatusCode::BAD_REQUEST,
            "X-Project-Root must be an absolute path".to_string(),
        ));
    }

    // Validate project has reagent config
    let policy_path = project_path.join(".reagent").join("policy.yaml");
    if !policy_path.exists() {
        return Err((
            StatusCode::BAD_REQUEST,
            format!(
                "No .reagent/policy.yaml found at {}. Is reagent initialized in this project?",
                project_root
            ),
        ));
    }

    // Resolve or create session
    let session_id: SessionId = match headers.get("x-session-id").and_then(|v| v.to_str().ok()) {
        Some(id) if !id.is_empty() => id.to_string(),
        _ => {
            // Create new session — spawn child and store sse_rx inside the context
            let new_id = Uuid::new_v4().to_string();
            let ctx = ProjectContext::spawn(&project_path, &new_id, state.config.reagent_bin.as_deref())
                .await
                .map_err(|e| {
                    error!(session_id = %new_id, "Failed to spawn child: {}", e);
                    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
                })?;

            {
                let mut guard = state.registry.write().await;
                guard.insert(new_id.clone(), ctx);
            }

            info!(session_id = %new_id, project_root = %project_root, "New session created");
            new_id
        }
    };

    // Forward the body to child stdin and update last_activity
    let sent = {
        let mut guard = state.registry.write().await;
        match guard.get_mut(&session_id) {
            Some(ctx) => {
                ctx.touch();
                let tx = ctx.stdin_tx.clone();
                drop(guard); // release write lock before await
                tx.send(body).await.is_ok()
            }
            None => {
                return Err((
                    StatusCode::NOT_FOUND,
                    format!("Session {} not found", session_id),
                ));
            }
        }
    };

    if !sent {
        warn!(session_id = %session_id, "Child stdin channel closed — cleaning up session");
        cleanup_session(&state.registry, &session_id).await;
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            "Child process is no longer running for this session".to_string(),
        ));
    }

    Ok((
        StatusCode::ACCEPTED,
        [("x-session-id", session_id)],
        "",
    ))
}

// ---------------------------------------------------------------------------
// GET /mcp — SSE stream delivering child stdout to the editor
// ---------------------------------------------------------------------------

/// GET /mcp expects:
///   Header: `X-Session-Id: <uuid>` — must reference an existing session
///
/// Returns an SSE stream. The editor keeps this connection open to receive
/// server-initiated MCP messages from the child process.
///
/// The session must first be created via POST /mcp (which spawns the child and
/// stores the SSE receiver inside the session context). This handler takes the
/// receiver out of the session and wraps it in an SSE stream.
async fn mcp_sse_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let session_id = extract_header(&headers, "x-session-id")?;

    // Take the SSE receiver from the session under a write lock.
    // The receiver was stored in ProjectContext when POST /mcp created the session.
    // INVARIANT: write lock is not held across any await point.
    let sse_rx = {
        let mut guard = state.registry.write().await;
        match guard.get_mut(&session_id) {
            None => {
                return Err((
                    StatusCode::NOT_FOUND,
                    format!(
                        "Session {} not found. Send POST /mcp with X-Project-Root first.",
                        session_id
                    ),
                ));
            }
            Some(ctx) => match ctx.take_sse_rx() {
                Some(rx) => rx,
                None => {
                    return Err((
                        StatusCode::CONFLICT,
                        format!(
                            "Session {} already has an active SSE stream. \
                             Disconnect the existing stream first.",
                            session_id
                        ),
                    ));
                }
            },
        }
    };

    let stream = ReceiverStream::new(sse_rx);
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

fn extract_header(headers: &HeaderMap, name: &'static str) -> Result<String, (StatusCode, String)> {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .filter(|v| !v.is_empty())
        .map(|v| v.to_string())
        .ok_or_else(|| {
            (
                StatusCode::BAD_REQUEST,
                format!("Missing or empty required header: {}", name),
            )
        })
}
