---
'@bookedsolid/reagent': minor
---

feat(daemon): add persistent Rust HTTP/SSE multi-project MCP gateway daemon

Adds `reagent daemon` — a persistent Rust (axum/tokio) daemon that serves
multiple simultaneous editor sessions over HTTP/SSE, each isolated to their
own project context loaded from that project's `.reagent/` config.

**Architecture:**

- Rust daemon (~5MB RAM idle) handles HTTP, SSE, session registry, and process
  lifecycle; TypeScript gateway handles all existing middleware (untouched)
- Per-session `reagent serve` child process spawned on first POST /mcp
- SSE receiver stored in `ProjectContext` until claimed by GET /mcp
- Session TTL eviction runs every 60s in a background tokio task

**Routes:**

- `GET /health` — liveness check with version, session count, uptime
- `GET /sessions` — list active sessions with project roots and idle times
- `POST /mcp` — receive JSON-RPC, create or resume session, forward to child stdin
- `GET /mcp` — SSE stream delivering child stdout to the editor

**CLI (`reagent daemon`):**

- `start` — spawn daemon binary in background, write PID to `~/.reagent/daemon.pid`
- `stop` — SIGTERM + poll for process exit
- `restart` — graceful stop then start (waits for confirmed exit before re-launch)
- `status` — hit `/health` + `/sessions`, pretty-print with elapsed idle times

**Configuration (`~/.reagent/daemon.yaml`):**

- `port` (default 7777), `bind` (default 127.0.0.1), `session_ttl_minutes` (default 30)
- `log_level` passed through as `RUST_LOG`
- Binary path overridable via `REAGENT_BIN` env var

**Graceful shutdown:**

- SIGTERM/SIGINT handlers (with ctrl-c fallback if registration fails)
- Broadcasts SSE close event to all open streams
- 5s drain window, then kills child processes
