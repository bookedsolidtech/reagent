---
'@bookedsolid/reagent': patch
---

Add duplicate MCP server detection to `reagent init`. After writing `gateway.yaml`, the init command now reads `.mcp.json` (if present) and warns when any `mcpServers` entry key matches a server name in `gateway.yaml`. This prevents duplicate tool registration and auth failures caused by `${VAR}` env syntax that Claude Code does not expand in direct `.mcp.json` entries.
