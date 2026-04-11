---
"@bookedsolid/reagent": minor
---

Replace Rust daemon with lightweight Node.js process supervisor.

The Rust daemon provided no meaningful session state persistence — all real state
is persisted to disk (tasks.jsonl, audit logs, policy.yaml). The "session" it
maintained was just process lifecycle management, which a simple supervisor delivers
without a custom HTTP/SSE gateway.

The new supervisor keeps `reagent serve` alive between Claude Code sessions, writes
a health file to ~/.reagent/daemon-health.json, and re-spawns on unexpected exit.
All MCP communication uses stdio transport only — no HTTP port, no session registry,
no Rust binary, no CI cross-compilation.

Breaking: `~/.reagent/daemon.yaml` no longer accepts `port`, `bind`, or
`session_ttl_minutes`. Remove these fields if present.
