# Session Restart Context

_Last updated: 2026-04-11_

## Current State

- **Version:** `@bookedsolid/reagent@0.13.1` — live on npm
- **Branch:** `staging`
- **Autonomy level:** L3 / max L3
- **Profile:** `bst-internal`

## What Was Done This Session

### Client-engagement profile verification and doc updates (v0.13.1 → 0.13.2 pending)

- **`client-engagement` profile verified** — L1/max L2 autonomy, correct hooks, attribution blocking enabled
- **`.claude/agents/` removed from gitignoreEntries** in `client-engagement.json` — agents are project config, not machine-local; should be committed so they're available to all team members
- **`connection-lifecycle.mdx` updated** — added "Manual Reconnect" subsection explaining `/mcp` command as the reconnect UX; added circuit-breaker behavior note on reconnect
- **Pending changeset** — `governance-scope-and-connection-lifecycle-docs.md` + new profile fix changeset

### Architecture overhaul (v0.11.0 → v0.13.1)

- **Rust daemon removed entirely** — `daemon/` directory deleted, all `reagent daemon` CLI subcommands removed
- **Reagent is now a pure MCP server** — `reagent serve` is what Claude Code connects to via stdio; no daemon, no HTTP transport, no port 3737
- **`.mcp.json` written by `reagent init`** — previously never written; new projects couldn't connect; fixed
- **Tech profile composability fixed** — `--profile lit-wc` now runs all 14 base init steps THEN overlays the tech profile; previously skipped everything
- **Rust daemon CI job removed** from `.github/workflows/ci.yml`
- **`graydon` and `niko` agents deleted** from `.claude/agents/engineering/` (Rust daemon agents, now obsolete)

### `.mcp.json` for this project

This project uses the locally-built dist for development:

```json
{
  "mcpServers": {
    "reagent": {
      "type": "stdio",
      "command": "node",
      "args": ["dist/cli/index.js", "serve"]
    },
    "discord-ops": {
      "command": "npx",
      "args": ["-y", "discord-ops@latest"],
      "env": {
        "BOOKED_DISCORD_BOT_TOKEN": "${BOOKED_DISCORD_BOT_TOKEN}",
        "CLARITY_DISCORD_BOT_TOKEN": "${CLARITY_DISCORD_BOT_TOKEN}"
      }
    }
  }
}
```

After changes to `src/`, run `npm run build` to rebuild `dist/`, then restart Claude Code.

### Documentation overhaul

- **Full docs audit completed** — all 20 content pages aligned with current platform
- **Major rewrites:** quick-start, middleware-chain, mcp-gateway guide, cli-commands reference
- **Key fixes:** daemon references removed, "MCP gateway" → "MCP server" throughout, hook count corrected (23), 12-layer chain documented correctly, `upgrade` command added to reference
- **GitHub Pages fixed** — was broken due to `github-pages` environment only allowing `staging` branch; `main` added to allowed deployment branches
- **Homepage link fixed** — hero "Get Started" button used absolute `/getting-started/installation/` (missing base path); corrected to relative path so Astro's `base: '/reagent/'` applies correctly
- **Docs live at:** https://bookedsolidtech.github.io/reagent/

### MCP configs updated across projects

All projects on this machine updated to remove old HTTP daemon config:

| Project | Status |
|---------|--------|
| `discord-ops` | Fixed: now stdio + discord-ops server |
| `helix` | Fixed: added discord-ops server, updated to @latest |
| `booked-solid-tech` | Already correct |
| `reagent` (this project) | Fixed: added discord-ops server |

## First Steps on Restart

1. **Build:** `npm run build` — ensures `dist/` is current before reagent serves
2. **Restart Claude Code** — picks up updated `.mcp.json` (reagent + discord-ops)
3. **Verify docs:** https://bookedsolidtech.github.io/reagent/
4. **Run tests:** `npm test` — 620 tests, all should pass
5. **Pending release:** changeset exists for v0.13.2 — run `pnpm changeset:version && pnpm changeset:publish` after merging to main

## Repo State

- **No open PRs** — work ships via changeset flow through staging → main
- **No HALT file** — system operational
- **Working tree:** clean after docs + RESTART commit

## Key Architecture Facts

- `reagent serve` = the MCP server. Claude Code spawns it via stdio. No external process needed.
- All middleware (policy, redaction, audit, etc.) runs inside the `reagent serve` process
- `gateway.yaml` = where you configure additional MCP servers to proxy through reagent
- `policy.yaml` is read fresh on every hook call — changes take effect immediately for hooks
- `reagent serve` reads `policy.yaml` at startup only — restart Claude Code to pick up policy changes in the MCP server

## Branch / Release Flow

```
feature branches → dev → staging → main (triggers publish)
```

- Merging to `main` triggers the Publish workflow
- Changesets creates a "version packages" PR on main
- Merging that PR publishes to npm and notifies Discord

## Key Config Files

| File | Purpose |
|------|---------|
| `.reagent/policy.yaml` | Autonomy level, blocked paths, kill switch |
| `.reagent/gateway.yaml` | Downstream MCP servers to proxy |
| `.mcp.json` | How Claude Code connects to reagent (stdio) + discord-ops |
| `hooks/` | Source for all 23 Claude Code hooks |
| `.claude/hooks/` | Gitignored — symlinked/installed copies of hooks |
| `.claude/agents/` | Agent definitions for this project's team |

## Pending Human Review (docs)

- `architecture/multi-token-workstream.mdx` — proposal doc, may be abandoned; review if still relevant
- `reference/hooks.mdx` — lists ~18-19 hooks; count says 23; verify full list against `hooks/` directory
