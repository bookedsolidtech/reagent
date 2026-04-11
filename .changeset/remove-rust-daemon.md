---
'@bookedsolid/reagent': minor
---

Remove daemon — reagent is an MCP server, not a gateway.

reagent is an MCP server. Claude Code connects to it via stdio transport, declared
in `.mcp.json`. Claude Code owns the process lifecycle — it spawns `reagent serve`
when the session starts and manages the process for the duration of the session.

There is no role for a separate daemon or process supervisor. The previous Node.js
supervisor kept `reagent serve` alive between sessions via a PID file and health
polling — this is not needed when Claude Code manages the process directly.

Removed: `reagent daemon start`, `stop`, `status`, `restart`, `eject` commands.
Removed: daemon npm scripts (`daemon:start`, `daemon:stop`, etc.).
Removed: `~/.reagent/daemon.yaml` config file support.
Removed: `~/.reagent/daemon.pid` and `~/.reagent/daemon-health.json` runtime files.
Removed: Rust daemon binary and cross-compilation CI.
