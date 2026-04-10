mod config;
mod project;
mod routes;
mod session;

use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::RwLock;
use tracing::{error, info};
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
        let mut sigterm = signal(SignalKind::terminate()).expect("SIGTERM handler failed");
        let mut sigint = signal(SignalKind::interrupt()).expect("SIGINT handler failed");

        tokio::select! {
            _ = sigterm.recv() => { info!("SIGTERM received"); }
            _ = sigint.recv()  => { info!("SIGINT received"); }
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
    for ctx in guard.sessions.values_mut() {
        // Send close event — receiver (SSE handler) will terminate its stream
        let _ = ctx
            .sse_tx
            .send(Ok(axum::response::sse::Event::default()
                .event("close")
                .data("restarting")));

        // Give in-flight requests a moment before killing children
    }
    drop(guard);

    // Wait up to 5 seconds for in-flight requests to complete.
    tokio::time::sleep(std::time::Duration::from_secs(5)).await;

    // Kill remaining child processes.
    let mut guard = state.registry.write().await;
    for ctx in guard.sessions.values_mut() {
        if let Err(e) = ctx.child.kill().await {
            tracing::warn!("Failed to kill child process: {}", e);
        }
    }
    guard.sessions.clear();

    info!("Graceful shutdown complete");
}
