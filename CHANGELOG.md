# @bookedsolid/reagent

## 0.12.2

### Patch Changes

- 659547c: fix(hooks): allow agent writes to tasks.jsonl when .reagent/ is in blocked_paths

  The default blocked_paths included `.reagent/` as a directory, which blocked
  agents from writing to `.reagent/tasks.jsonl`. This broke the PM task store —
  the entire point of the project management layer.

  Two fixes:
  1. blocked-paths-enforcer.sh now has a built-in agent-writable allowlist that
     always permits writes to `tasks.jsonl` and `audit/` regardless of what
     blocked_paths contains. settings-protection.sh still guards the sensitive
     files (policy.yaml, HALT, review-cache.json) explicitly.
  2. The default blocked_paths in new installs now lists specific files instead
     of the whole `.reagent/` directory, so this footgun doesn't recur.

  Existing installs with `.reagent/` in blocked_paths are fixed by the hook
  allowlist — no manual policy.yaml edits required.

## 0.12.1

### Patch Changes

- 20c1f2c: docs: add project installation guide to README

  Documents the complete setup flow for installing reagent in another project:
  stdio transport requirement (HTTP transport requires OAuth 2.1 and is not
  supported by the daemon), the gateway.yaml proxy pattern for passing tokens
  to downstream MCP servers, the ${VAR} env expansion gotcha in .mcp.json
  (Claude Code passes the literal string, not the value — only the gateway
  resolves ${VAR} at startup), and the upgrade command for re-syncing hooks.

  Also fixes the Quick Start .mcp.json snippet to use `npx` instead of bare
  `reagent`, which requires a global install.

## 0.12.0

### Minor Changes

- 0e4e8ac: feat(cli): add `reagent upgrade` command

  Adds a new `reagent upgrade` command that re-syncs installed reagent hooks and
  updates the version stamp in `.reagent/policy.yaml` without running the full
  `reagent init` flow.

  **What it does:**
  - Copies / overwrites all reagent-managed hooks (`commit-msg`, `pre-commit`,
    `pre-push`) from the package's `husky/` directory into the project's `.husky/`
    directory — but only for hooks the project already has installed (respects the
    user's original init choices, never adds new hooks silently)
  - Updates the `installed_by` field in `.reagent/policy.yaml` to reflect the
    current reagent version; all other user config (autonomy levels, blocked paths,
    gateway servers, etc.) is preserved
  - Prints an itemised summary: installed / updated / already up-to-date / warnings
  - Supports `--dry-run` to preview changes without writing files

  **Usage:**

  ```
  npx @bookedsolid/reagent upgrade
  npx @bookedsolid/reagent upgrade --dry-run
  ```

### Patch Changes

- 3cb164f: Add duplicate MCP server detection to `reagent init`. After writing `gateway.yaml`, the init command now reads `.mcp.json` (if present) and warns when any `mcpServers` entry key matches a server name in `gateway.yaml`. This prevents duplicate tool registration and auth failures caused by `${VAR}` env syntax that Claude Code does not expand in direct `.mcp.json` entries.

## 0.11.1

### Patch Changes

- 36cacec: fix(hooks): commit-review-gate now hands off to the agent as reviewer

  Previously the block message told agents to "spawn a code-reviewer agent"
  and gave no clear path forward — causing agents to give up and ask the user
  to run git commit manually instead.

  The gate now makes clear that the agent itself is the reviewer: inspect the
  diff, make a judgement call, cache the result, and retry. Initial commits,
  large refactors, and standard feature work are explicitly called out as
  normal — agents should use judgement, not ceremony. Only escalate to the
  user if there is a genuine problem in the diff.

  Also fixes `daemon:restart` npm script to use `npx reagent` so it works
  without a global install.

## 0.11.0

### Minor Changes

- 2b87a0e: feat(daemon): integration tests, watchdog self-shutdown, eject command, port 3737

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

### Patch Changes

- 7c3e1ce: fix(hooks): commit-review-gate cache bypass now works for all install methods

  The cache check in `commit-review-gate.sh` was silently skipped when reagent
  was installed globally or via npx — `REAGENT_CLI_ARGS` was never populated for
  those cases, causing the gate to permanently block commits >200 lines even after
  a successful code review completed and cached its result.

  Fixes:
  - Add `command -v reagent` PATH lookup as third CLI resolution option (covers
    global `npm install -g @bookedsolid/reagent` installs)
  - Add a `jq`-based direct read of `.reagent/review-cache.json` as a fallback
    when no CLI is found — works in any consumer project regardless of install
    method, no Node.js process spawn required
  - Hoist `STAGED_SHA` / `BRANCH` computation out of the score-specific block
    so both standard and significant tiers share the same variables

## 0.10.0

### Minor Changes

- af9a07b: feat(daemon): add persistent Rust HTTP/SSE multi-project MCP gateway daemon

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

## 0.9.0

### Minor Changes

- 45050b5: feat(agents): add pr-voice-reviewer agent and /review-pr skill

  Adds a two-layer PR review system: code-reviewer agent produces structured
  technical findings, pr-voice-reviewer agent rewrites them in the project
  owner's natural voice, then posts as a single batched GitHub pull review
  with inline line comments. Reviews are indistinguishable from a human
  going through the diff deliberately.

  Closes #49.

## 0.8.0

### Minor Changes

- cb543d6: feat(hooks): GitHub workflow gates — changeset security, PR issue linking, configurable disclosure mode

  Adds three new capabilities for GitHub-connected projects:

  **changeset-security-gate** (PreToolUse Write|Edit on `.changeset/*.md`):
  - Blocks GHSA IDs and CVE numbers from being written to changeset files before
    advisory publication — prevents pre-disclosure via git history and CHANGELOG
  - Validates changeset frontmatter format and requires a non-empty description
  - Enforces the vague-changeset pattern for security fixes

  **pr-issue-link-gate** (PreToolUse Bash on `gh pr create`):
  - Advisory (non-blocking) when a PR is created without `closes #N` / `fixes #N`
  - Ensures issues auto-close on merge and creates traceability through the
    issue → PR → changeset → CHANGELOG → release chain

  **Configurable disclosure mode** (`REAGENT_DISCLOSURE_MODE`):
  - `advisory` (default) — public OSS repos: blocks public issue creation for
    security findings and redirects to GitHub Security Advisories
  - `issues` — private client repos: redirects to labeled internal issue queue
    (`--label security,internal`) instead of Security Advisories
  - `disabled` — no gate
  - Set via `security.disclosureMode` in the profile JSON; written to
    `.reagent/policy.yaml` and injected into `.claude/settings.json` env

  Both new hooks wired into `bst-internal` and `client-engagement` profiles.
  Product-owner agent updated with full GitHub workflow: issue creation standards,
  PR/issue linking discipline, changeset lifecycle, and security fix disclosure flow.

### Patch Changes

- 63aa341: feat(security): add security-disclosure-gate hook and SECURITY.md policy

  Adds a new `security-disclosure-gate` Claude Code hook that intercepts
  `gh issue create` commands containing ~30 security-sensitive keywords
  (bypass, exploit, CVE-, prompt inject, jailbreak, etc.) and blocks them
  with instructions to use GitHub Security Advisories for private disclosure.

  Also adds SECURITY.md with coordinated disclosure policy, response timeline,
  scope definition, and two-layer security architecture documentation.

  Hook is wired into `bst-internal` and `client-engagement` profiles.

## 0.7.2

### Patch Changes

- 208de67: feat(agents): complete persona fields for all remaining agents

  The 8 agents previously skipped by the rename script now carry full
  firstName, middleInitial, lastName, fullName, and inspiration fields.
  All 82 agents in the roster now have complete persona identity metadata.

## 0.7.1

### Patch Changes

- 9d31a61: feat(agents): add persona identity fields to all agents

  All 82 agents now carry `firstName`, `middleInitial`, `lastName`, `fullName`, and `inspiration` frontmatter fields. Each persona is grounded in a real pioneer from the agent's domain — giving the roster a consistent, human-readable identity layer.

## 0.7.0

### Minor Changes

- 7fe8bbe: feat: v0.7.0 — catalyze command, discord-ops integration, and tech stack profiles

  Adds three major features:

  **reagent catalyze** — analyze project stack and generate gap analysis reports
  - Detects project types: astro, nextjs, lit-wc, drupal, react, node-api, monorepo
  - Identifies missing hooks, gates, agents, and tests against a known catalog
  - Generates markdown and HTML reports with ranked gaps
  - Audit mode (--audit) shows drift against previous plan

  **discord-ops integration** — opt-in Discord notifications
  - New discord_ops section in gateway.yaml schema
  - DiscordNotifier class for task, hook block, release, and audit alert events
  - discord_notify MCP tool registered in native-tools
  - reagent init --discord wires Discord config into gateway.yaml
  - All notifications fail silently — never block workflows

  **Tech stack profiles** — installable hooks and gates for specific frameworks
  - profiles/lit-wc: shadow-dom-guard, cem-integrity-gate hooks + cem/wtr gates
  - profiles/drupal: coding standards + hook-update-guard hooks + phpcs/phpunit gates
  - profiles/astro: astro-ssr-guard hook + astro check/build gates
  - profiles/nextjs: server-component-drift hook + next build/lint gates
  - reagent init --profile <name> installs tech profile alongside base profile

## 0.6.0

### Minor Changes

- 756ca1d: v0.6.0: 8 new security hooks, GitHub PM repo scaffolding, and Projects v2 sync

## 0.5.0

### Minor Changes

- e74e265: Quality gates, project management layer, and security hardening hooks

  **Security Hardening (Phase 1):**
  - Hook: settings-protection blocks agent modification of .claude/settings.json, hooks, and policy files
  - Hook: blocked-paths-enforcer reads blocked_paths from policy.yaml and blocks matching writes
  - Hook: dependency-audit-gate verifies npm packages exist before allowing install
  - Hardened dangerous-bash-interceptor: detects --no-verify, core.hooksPath bypass, REAGENT_BYPASS env var

  **Quality Gates (Phase 2):**
  - Hook: commit-review-gate with triage scoring (trivial/standard/significant) and review cache
  - Hook: push-review-gate with full diff analysis and agent-spawning instructions
  - Hook: architecture-review-gate advisory for writes to sensitive paths
  - CLI: `reagent cache check|set|clear` for review cache management
  - Profile extensions: qualityGates config in profile JSON

  **Project Management (Phase 3):**
  - Task store: append-only JSONL event log at .reagent/tasks.jsonl with advisory file locking
  - GitHub bridge: gh CLI integration with rate-limited sync, reagent: label scoping
  - MCP tools: task_create, task_update, task_list, task_get, task_delete, task_sync_github (native gateway tools)
  - Agent: product-owner with guardrails (anti-duplication, creation cap, evidence-required close)
  - Commands: /tasks table view, /plan-work guided task planning
  - Hook: task-link-gate (opt-in) checks for T-NNN task ID in commit messages
  - Init: PM step scaffolds tasks.jsonl and adds to .gitignore

  **Foundation (Phase 0):**
  - Refactored init.ts (717 lines) into modular src/cli/commands/init/ directory (9 step files)
  - Hook test infrastructure: vitest harness with 70+ hook tests across all hooks
  - Shared hook library: hooks/\_lib/common.sh with reagent_root, check_halt, require_jq, json_output, triage_score

  **Tests:** 309 total (up from 204)

## 0.4.0

### Minor Changes

- c077809: Security audit remediation, policy hot-reload, and init improvements
  - Security: tier downgrade floor prevents tool_overrides from lowering classification
  - Security: blocked-paths middleware always protects .reagent/ directory
  - Security: max_autonomy_level clamping in policy loader
  - Security: HALT file read capped at 1024 bytes in shell hooks
  - Security: argument redaction runs pre-execution with circular reference guard
  - Feature: policy hot-reload re-reads policy.yaml per invocation for live autonomy changes
  - Feature: gateway.yaml generated during init (idempotent, commented template)
  - Feature: convention-based tier classification for tools (get*\*, delete*\*, etc.)
  - Fix: audit write queue serialization for consistent log ordering
  - Fix: client-manager timer leak on connection timeout
  - Fix: tool-proxy uses z.unknown() instead of z.any()
  - CI: Discord notification steps marked continue-on-error
  - CI: roll-up status check job for branch protection
  - Tests: 204 total (up from 153), including 45 init tests and 6 policy hot-reload tests

## 0.2.0

### Minor Changes

- b3b3cbd: Add MCP gateway server (`reagent serve`) that proxies downstream MCP servers through a zero-trust middleware chain with policy enforcement, tier classification, secret redaction, and hash-chained audit logging. Migrate CLI from CommonJS to TypeScript ESM.
