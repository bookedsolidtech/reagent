---
"@bookedsolid/reagent": minor
---

Remove `reagent daemon` commands entirely.

reagent is an MCP server. Claude Code manages the `reagent serve` process lifecycle
via the stdio transport entry in `.mcp.json`. There is no role for a separate daemon
or process supervisor — Claude Code spawns `reagent serve` when it starts and owns
the process for the session.

Removed: `reagent daemon start`, `stop`, `status`, `restart`, `eject` commands.
Removed: daemon npm scripts (`daemon:start`, `daemon:stop`, etc.).
Removed: `~/.reagent/daemon.yaml` config file support.
Removed: `~/.reagent/daemon.pid` and `~/.reagent/daemon-health.json` runtime files.
