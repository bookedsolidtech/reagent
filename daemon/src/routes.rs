use std::time::{Duration, UNIX_EPOCH};
use axum::{
    body::Body,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{
        sse::{KeepAlive, Sse},
        IntoResponse, Json, Response,
    },
    routing::get,
    Router,
};
use serde::Serialize;
use tokio_stream::wrappers::ReceiverStream;
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::project::ProjectContext;
use crate::session::{cleanup_session, SessionId, SessionSummary};
use crate::AppState;

/// How long to wait for a child response to a JSON-RPC request before returning
/// 504 Gateway Timeout. MCP operations are typically fast; 30 s is generous.
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(30);

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

/// POST /mcp implements MCP Streamable HTTP for JSON-RPC:
///
///   Header: `X-Project-Root: /abs/path/to/project`
///   Header: `X-Session-Id: <uuid>` (optional — omit to create a new session)
///   Body: JSON-RPC message string
///
/// Response semantics:
///   - JSON-RPC **notification** (no `id`): forwarded to child stdin, returns `202 Accepted`.
///   - JSON-RPC **request** (has `id`): forwarded to child stdin, waits for the matching
///     response from child stdout, returns `200 OK` with `Content-Type: application/json`
///     and the response body. Returns `504 Gateway Timeout` if the child does not respond
///     within 30 seconds.
async fn mcp_post_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: String,
) -> Result<Response, (StatusCode, String)> {
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

    // Parse JSON-RPC to determine if this is a request (has `id`) or notification (no `id`).
    //
    // Per MCP Streamable HTTP spec:
    //   - Notification (no `id`): forward to child, return 202 immediately.
    //   - Request (has `id`): forward to child, await matching response, return 200 with body.
    let rpc_id: Option<serde_json::Value> = serde_json::from_str::<serde_json::Value>(&body)
        .ok()
        .and_then(|v| v.get("id").cloned());

    if let Some(id) = rpc_id {
        // --- JSON-RPC REQUEST: await response before returning ---

        // Clone stdin_tx and pending Arc under a write lock (touch + extract in one pass).
        // INVARIANT: write lock is NOT held across any await point.
        let (stdin_tx, pending) = {
            let mut guard = state.registry.write().await;
            match guard.get_mut(&session_id) {
                Some(ctx) => {
                    ctx.touch();
                    (ctx.stdin_tx.clone(), ctx.pending.clone())
                }
                None => {
                    return Err((
                        StatusCode::NOT_FOUND,
                        format!("Session {} not found", session_id),
                    ));
                }
            }
        };

        // Register the response waiter BEFORE sending to stdin (avoid race where
        // the child responds before we've registered the receiver).
        let (response_tx, response_rx) = tokio::sync::oneshot::channel::<String>();
        {
            let mut pending_map = pending.lock().await;
            pending_map.insert(id.clone(), response_tx);
        }

        // Forward body to child stdin
        let sent = stdin_tx.send(body).await.is_ok();
        if !sent {
            // Child stdin channel closed — clean up our pending entry and the session
            let mut pending_map = pending.lock().await;
            pending_map.remove(&id);
            drop(pending_map);

            warn!(session_id = %session_id, "Child stdin channel closed — cleaning up session");
            cleanup_session(&state.registry, &session_id).await;
            return Err((
                StatusCode::SERVICE_UNAVAILABLE,
                "Child process is no longer running for this session".to_string(),
            ));
        }

        // Await the child's response, with timeout
        match tokio::time::timeout(RESPONSE_TIMEOUT, response_rx).await {
            Ok(Ok(response_body)) => {
                let resp = Response::builder()
                    .status(StatusCode::OK)
                    .header("x-session-id", &session_id)
                    .header("content-type", "application/json")
                    .body(Body::from(response_body))
                    .unwrap();
                Ok(resp)
            }
            Ok(Err(_)) => {
                // oneshot sender dropped — child process likely died
                Err((
                    StatusCode::BAD_GATEWAY,
                    "Child process closed without responding".to_string(),
                ))
            }
            Err(_elapsed) => {
                // Timeout — remove the stale pending entry
                let mut pending_map = pending.lock().await;
                pending_map.remove(&id);
                error!(session_id = %session_id, rpc_id = %id, "MCP response timeout after 30s");
                Err((
                    StatusCode::GATEWAY_TIMEOUT,
                    format!("MCP response timeout: child did not respond to request {} within 30s", id),
                ))
            }
        }
    } else {
        // --- JSON-RPC NOTIFICATION: fire-and-forget ---
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

        let resp = Response::builder()
            .status(StatusCode::ACCEPTED)
            .header("x-session-id", &session_id)
            .body(Body::empty())
            .unwrap();
        Ok(resp)
    }
}

// ---------------------------------------------------------------------------
// GET /mcp — SSE stream delivering child stdout to the editor
// ---------------------------------------------------------------------------

/// GET /mcp expects:
///   Header: `X-Session-Id: <uuid>` — must reference an existing session
///
/// Returns an SSE stream. The editor keeps this connection open to receive
/// server-initiated MCP messages from the child process (notifications, etc.).
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
