---
"@bookedsolid/reagent": minor
---

Auto-detect package manager for preflight command during `reagent init`.

The init flow now checks for lockfiles in the target project directory and sets the preflight command accordingly: `pnpm-lock.yaml` → `pnpm preflight`, `yarn.lock` → `yarn preflight`, `bun.lockb` → `bun run preflight`, `package-lock.json` → `npm run preflight`, no lockfile → `npm run preflight` (safe fallback). A `--preflight-cmd` flag overrides detection when needed. The hardcoded `pnpm preflight` in profile JSON files is no longer used directly — detection always wins when a lockfile is present.

Also adds a `SECURITY.md` with the project's vulnerability disclosure policy (security@bookedsolid.tech, 24-hour acknowledge SLA, 7-day patch SLA for critical issues), and updates the README, package.json description, and docs to use "governance layer for Claude Code" framing in place of "zero-trust MCP server".
