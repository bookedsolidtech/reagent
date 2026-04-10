use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Global daemon configuration loaded from `~/.reagent/daemon.yaml`.
///
/// All fields have defaults matching the TypeScript `DaemonConfig` interface in
/// `src/types/daemon.ts` — keep them in sync.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DaemonConfig {
    /// TCP port the daemon listens on. Default: 7777.
    #[serde(default = "default_port")]
    pub port: u16,

    /// Bind address. Default: "127.0.0.1".
    #[serde(default = "default_bind")]
    pub bind: String,

    /// Idle session TTL in minutes before eviction. Default: 30.
    #[serde(default = "default_session_ttl_minutes")]
    pub session_ttl_minutes: u64,

    /// Log level passed to RUST_LOG. Default: "info".
    #[serde(default = "default_log_level")]
    pub log_level: String,

    /// Optional API key authentication. If absent, auth is disabled.
    #[serde(default)]
    pub auth: Option<DaemonAuth>,
}

/// API key authentication config. Sensitive — never logged via Debug.
#[derive(Clone, Serialize, Deserialize)]
pub struct DaemonAuth {
    /// Accepted bearer tokens. Empty list disables auth.
    #[serde(default)]
    pub api_keys: Vec<String>,
}

// Manually implement Debug to avoid printing tokens in logs.
impl std::fmt::Debug for DaemonAuth {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DaemonAuth")
            .field("api_keys", &format!("[{} key(s) redacted]", self.api_keys.len()))
            .finish()
    }
}

impl DaemonConfig {
    /// Load from `~/.reagent/daemon.yaml`. Returns defaults if the file is absent.
    pub fn load() -> Result<Self> {
        let path = daemon_config_path().context("Could not resolve home directory")?;

        if !path.exists() {
            return Ok(Self::default());
        }

        let raw = std::fs::read_to_string(&path)
            .with_context(|| format!("Failed to read {}", path.display()))?;

        // Empty file → use defaults
        if raw.trim().is_empty() {
            return Ok(Self::default());
        }

        let config: Self = serde_yaml::from_str(&raw)
            .with_context(|| format!("Failed to parse YAML at {}", path.display()))?;

        Ok(config)
    }
}

impl Default for DaemonConfig {
    fn default() -> Self {
        Self {
            port: default_port(),
            bind: default_bind(),
            session_ttl_minutes: default_session_ttl_minutes(),
            log_level: default_log_level(),
            auth: None,
        }
    }
}

/// Resolve `~/.reagent/daemon.yaml`.
fn daemon_config_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".reagent").join("daemon.yaml"))
}

fn default_port() -> u16 {
    // Allow override via env var for `reagent daemon start --port`
    std::env::var("REAGENT_DAEMON_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(7777)
}

fn default_bind() -> String {
    std::env::var("REAGENT_DAEMON_BIND").unwrap_or_else(|_| "127.0.0.1".to_string())
}

fn default_session_ttl_minutes() -> u64 {
    std::env::var("REAGENT_DAEMON_SESSION_TTL")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(30)
}

fn default_log_level() -> String {
    "info".to_string()
}
