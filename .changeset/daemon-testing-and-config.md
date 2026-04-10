---
'@bookedsolid/reagent': minor
---

feat(daemon): integration tests, watchdog self-shutdown, eject command, port 3737

**Integration tests** — 19 Rust integration tests covering all HTTP routes, session
lifecycle, concurrent sessions, SSE double-connect 409, race conditions, and error paths.
Tests spin the real binary on a random port and auto-clean on drop.

**Watchdog** — background tokio task that logs an idle warning after `idle_warn_hours`
(default 24h) and initiates graceful self-shutdown after `max_uptime_hours` (default 72h,
0 = disabled). Prevents zombie daemons running indefinitely unnoticed.

**Eject command** — `reagent daemon eject` sends SIGKILL via PID file then sweeps orphans
with pkill. Nuclear option when graceful stop is stuck.

**npm scripts** — `daemon:start` (nohup, survives terminal close), `daemon:stop`
(integer-validated PID, no shell injection), `daemon:status`, `daemon:logs`,
`daemon:eject`, `daemon:build`.

**Config improvements** (`~/.reagent/daemon.yaml`):

- Default port changed from 7777 to 3737
- `reagent_bin` — path to reagent CLI; supports `"node /path/to/dist/cli/index.js"` for
  local dev without a global install
- `default_project_root` — fallback when `X-Project-Root` header is absent; enables HTTP
  MCP clients that cannot send per-request headers
- `idle_warn_hours` / `max_uptime_hours` — watchdog thresholds

**CI** — `rust-tests` job added: `cargo clippy --all-targets -D warnings` + `cargo test`;
wired into the `ci-passed` rollup gate.
