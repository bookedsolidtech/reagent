/**
 * DaemonConfig — global daemon settings loaded from ~/.reagent/daemon.yaml.
 *
 * This file is the source of truth for daemon configuration shape on the
 * TypeScript side. The Rust daemon reads the same YAML file; keep field names
 * in sync with daemon/src/config.rs.
 */
export interface DaemonConfig {
  /** TCP port the daemon listens on. Default: 7777 */
  port: number;
  /** Bind address. Default: '127.0.0.1' */
  bind: string;
  /** Idle session TTL in minutes. Default: 30 */
  session_ttl_minutes: number;
  /** Log verbosity passed to the Rust daemon via RUST_LOG. Default: 'info' */
  log_level: 'debug' | 'info' | 'warn' | 'error';
  /** Optional API key authentication for the daemon HTTP surface. */
  auth?: DaemonAuth;
}

export interface DaemonAuth {
  /** List of accepted bearer tokens. If empty or absent, auth is disabled. */
  api_keys?: readonly string[];
}

/** Represents a single active session as returned by GET /sessions. */
export interface DaemonSession {
  session_id: string;
  project_root: string;
  /** ISO-8601 timestamp of last MCP activity on this session. */
  last_activity: string;
  /** Seconds remaining before TTL eviction. */
  ttl_remaining_seconds: number;
}

/** Shape of GET /health response body. */
export interface DaemonHealthResponse {
  status: 'ok';
  version: string;
  sessions: number;
  uptime_seconds: number;
}

/** Shape of GET /sessions response body. */
export interface DaemonSessionsResponse {
  sessions: readonly DaemonSession[];
}
