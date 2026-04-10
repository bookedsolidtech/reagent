mod config;
mod project;
mod routes;
mod session;

use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::RwLock;
use tracing::{error, info, warn};
use tracing_subscriber::{fmt, EnvFilter};

use crate::config::DaemonConfig;
use crate::routes::build_router;
use crate::session::SessionRegistry;

/// Shared application state threaded through all axum route handlers.
#[derive(Clone)]
pub struct AppState {
    pub registry: Arc<RwLock<SessionRegistry>>,
    pub config: DaemonConfig,
    /// Unix timestamp (seconds since epoch) when the daemon started.
    pub started_at: u64,
}

#[tokio::main]
async fn main() {
    // Initialise tracing — respects RUST_LOG env var; defaults to "info".
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    // Load configuration from ~/.reagent/daemon.yaml (falls back to defaults).
    let config = match DaemonConfig::load() {
        Ok(c) => c,
        Err(e) => {
            error!("Failed to load daemon config: {}", e);
            std::process::exit(1);
        }
    };

    info!(
        port = config.port,
        bind = %config.bind,
        session_ttl_minutes = config.session_ttl_minutes,
        "reagent-daemon starting"
    );

    let registry = Arc::new(RwLock::new(SessionRegistry::new()));

    // Launch background TTL eviction task.
    session::spawn_eviction_task(Arc::clone(&registry), config.session_ttl_minutes);

    let started_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let state = AppState {
        registry,
        config: config.clone(),
        started_at,
    };

    let app = build_router(state.clone());

    let addr = format!("{}:{}", config.bind, config.port);
    let listener = match TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            error!(addr = %addr, "Failed to bind TCP listener: {}", e);
            std::process::exit(1);
        }
    };

    info!(addr = %addr, "Listening");

    // Write PID file so `reagent daemon stop` can find us.
    write_pid_file();

    // Serve with graceful shutdown on SIGTERM / SIGINT.
    let shutdown = shutdown_signal(state);
    if let Err(e) = axum::serve(listener, app)
        .with_graceful_shutdown(shutdown)
        .await
    {
        error!("Server error: {}", e);
        std::process::exit(1);
    }

    info!("reagent-daemon exited cleanly");
    remove_pid_file();
}

fn write_pid_file() {
    if let Some(home) = dirs::home_dir() {
        let pid_path = home.join(".reagent").join("daemon.pid");
        let pid = std::process::id();
        if let Err(e) = std::fs::write(&pid_path, pid.to_string()) {
            tracing::warn!(path = %pid_path.display(), "Could not write PID file: {}", e);
        }
    }
}

fn remove_pid_file() {
    if let Some(home) = dirs::home_dir() {
        let pid_path = home.join(".reagent").join("daemon.pid");
        let _ = std::fs::remove_file(&pid_path);
    }
}

async fn shutdown_signal(state: AppState) {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};

        let sigterm = signal(SignalKind::terminate());
        let sigint = signal(SignalKind::interrupt());

        match (sigterm, sigint) {
            (Ok(mut st), Ok(mut si)) => {
                tokio::select! {
                    _ = st.recv() => { info!("SIGTERM received"); }
                    _ = si.recv() => { info!("SIGINT received"); }
                }
            }
            _ => {
                warn!("Failed to register Unix signal handlers — falling back to ctrl-c");
                tokio::signal::ctrl_c().await.ok();
                info!("Ctrl-C received");
            }
        }
    }
    #[cfg(not(unix))]
    {
        tokio::signal::ctrl_c().await.ok();
        info!("Ctrl-C received");
    }

    info!("Initiating graceful shutdown — notifying active sessions");

    // Broadcast close event to all open SSE streams, then kill child processes.
    let mut guard = state.registry.write().await;
    for ctx in guard.values_mut() {
        // Send close event — receiver (SSE handler) will terminate its stream.
        // Use try_send (non-blocking) because we hold a write lock and cannot await.
        // The SSE channel has capacity 64 so this will succeed unless the client
        // is extremely slow; on failure we proceed with the kill anyway.
        let _ = ctx.sse_tx.try_send(Ok(axum::response::sse::Event::default()
            .event("close")
            .data("restarting")));
    }
    drop(guard);

    // Wait up to 5 seconds for in-flight requests to complete.
    tokio::time::sleep(std::time::Duration::from_secs(5)).await;

    // Kill remaining child processes.
    let mut guard = state.registry.write().await;
    for ctx in guard.values_mut() {
        if let Err(e) = ctx.child.kill().await {
            tracing::warn!("Failed to kill child process: {}", e);
        }
    }
    guard.clear();

    info!("Graceful shutdown complete");
}
