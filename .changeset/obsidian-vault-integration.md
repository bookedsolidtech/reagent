---
"@bookedsolid/reagent": minor
---

Add opt-in Obsidian vault integration for syncing project state as plain markdown

- New `reagent obsidian sync` and `reagent obsidian status` CLI commands
- New `obsidian_sync` MCP tool for gateway consumers
- New `reagent init --obsidian --vault-path <path>` init step
- Kanban board generation from task store (Obsidian Kanban plugin compatible)
- Vault path configurable via `REAGENT_OBSIDIAN_VAULT` env var or gateway.yaml
- Disabled by default — zero side effects when not configured
- Context dump and wiki refresh stubbed for future phases
