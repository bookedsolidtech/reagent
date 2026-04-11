---
'@bookedsolid/reagent': patch
---

docs: add project installation guide to README

Documents the complete setup flow for installing reagent in another project:
stdio transport requirement (HTTP transport requires OAuth 2.1 and is not
supported by the daemon), the gateway.yaml proxy pattern for passing tokens
to downstream MCP servers, the ${VAR} env expansion gotcha in .mcp.json
(Claude Code passes the literal string, not the value — only the gateway
resolves ${VAR} at startup), and the upgrade command for re-syncing hooks.

Also fixes the Quick Start .mcp.json snippet to use `npx` instead of bare
`reagent`, which requires a global install.
