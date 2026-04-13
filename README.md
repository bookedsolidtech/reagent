# @bookedsolid/reagent

Governance layer for Claude Code — policy enforcement, hook-based safety gates, and audit logging for AI-assisted projects.

reagent enforces policy, prevents dangerous operations, and audits AI agent activity in Claude Code projects. One command (`reagent init`) installs 26 safety hooks and a full engineering team of AI specialists into your project. Every tool call — from every AI agent — is governed by your `policy.yaml`. It's Claude Code + accountability.

## What it is

reagent is an MCP server. You declare it in `.mcp.json` and Claude Code spawns it via
stdio transport when a session starts. Every tool call — whether to reagent's own native
tools or to any downstream MCP server you've configured — flows through a 12-layer
middleware chain before it executes.

reagent can also proxy tool calls to other MCP servers. Instead of listing your
filesystem server, GitHub server, and other tools directly in `.mcp.json`, you list them
in `.reagent/gateway.yaml`. reagent connects to each one on startup, discovers their
tools, and re-registers those tools on itself under namespaced names. Every proxied call
goes through the same middleware chain as native tool calls — policy, redaction, audit,
rate-limiting, and the kill switch all apply.

`reagent init` scaffolds a project with the full safety infrastructure: Claude Code hooks,
`policy.yaml`, `gateway.yaml`, agent team files, cursor rules, and quality gates. Profiles
let you start from a base configuration (client-engagement or bst-internal) and layer in
tech-stack-specific hooks (astro, nextjs, lit-wc, drupal).

The kill switch is a file: `.reagent/HALT`. When it exists, every hook and every tool call
returns an immediate denial with the reason from the file. `reagent freeze` creates it;
`reagent unfreeze` removes it.

## Quick Start

```bash
npm install -g @bookedsolid/reagent
cd your-project
reagent init
```

That's it. `reagent init` installs reagent as a devDependency (detecting your package manager
automatically) and writes `.mcp.json` to your project root:

```json
{
  "mcpServers": {
    "reagent": {
      "type": "stdio",
      "command": "node",
      "args": ["node_modules/@bookedsolid/reagent/dist/cli/index.js", "serve"]
    }
  }
}
```

The direct `node` path works across npm, yarn, pnpm, and bun. If reagent is not yet installed
locally, init falls back to `npx @bookedsolid/reagent serve`; run `reagent upgrade` after
installing the package to migrate.

Restart Claude Code. It will pick up `.mcp.json` and spawn `reagent serve` automatically.
reagent loads your `.reagent/policy.yaml` and `.reagent/gateway.yaml`, connects to any
downstream servers, and starts listening on stdio.

To verify the installation:

```bash
reagent check
```

## How it works

```
Claude Code ──stdio──▶ reagent serve (MCP server)
                            │
                            ├─ native tools: task_create, task_list, task_update, ...
                            │
                            └─ proxied tools from .reagent/gateway.yaml
                                 └─ every tool call through the middleware chain
```

### The middleware chain

Every tool call — whether native or proxied — passes through this chain in order:

```
audit → session → kill-switch → tier → policy → blocked-paths →
rate-limit → circuit-breaker → redact → injection → result-size-cap → execute
```

**audit** — Outermost layer. Records every invocation as a hash-chained JSONL entry
in `.reagent/audit.jsonl` before anything else runs. Denials are logged too. The chain
integrity means no entry can be modified without invalidating all subsequent hashes.

**session** — Associates the call with a session UUID. Sessions are in-memory for the
lifetime of the `reagent serve` process.

**kill-switch** — Reads `.reagent/HALT` on every call. If the file exists, the call is
immediately denied with the reason from the file. No exceptions.

**tier** — Classifies the tool call as `read`, `write`, or `destructive` using the tool
name and the tier map from `gateway.yaml` tool overrides. Tier determines which autonomy
levels can call it.

**policy** — Enforces `autonomy_level` from `policy.yaml`. L0 allows reads only. L1
allows reads and writes. L2 allows reads, writes, and PR creation. L3 allows everything.
A tool at a tier above the configured level is denied.

**blocked-paths** — Scans tool arguments for references to paths listed in
`policy.yaml:blocked_paths`. If an argument contains a blocked path, the call is denied.
This protects `.reagent/`, `.github/workflows/`, `.env`, and whatever else you configure.

**rate-limit** — Enforces per-server `calls_per_minute` limits from `gateway.yaml`.
Calls that exceed the limit are denied. Legitimate calls don't burn rate budget for
calls already denied by earlier middleware.

**circuit-breaker** — Tracks downstream server failures. After a configurable threshold
of consecutive errors, the breaker opens and calls to that server are denied until it
resets. Prevents cascading failures when a downstream MCP server is unhealthy.

**redact** — Scans tool arguments and results for secrets: AWS keys, GitHub tokens,
API keys, PEM private keys, Discord tokens, Stripe keys, generic bearer tokens, and
more. Matching values are replaced with `[REDACTED]` before they reach the model or
the downstream server.

**injection** — Scans tool results from downstream servers for prompt injection patterns.
In `block` mode (default), detected injection attempts are denied. In `warn` mode, they
are flagged in the audit log but allowed through.

**result-size-cap** — Caps tool results at `gateway.options.max_result_size_kb` (default:
1 MB). Oversized responses are truncated with a note. Prevents large downstream responses
from bloating context.

**execute** — The innermost layer. Calls the actual tool. For native tools, runs the
handler directly. For proxied tools, forwards the call to the downstream MCP server via
its stdio transport.

### Policy and autonomy levels

`reagent init` writes `.reagent/policy.yaml` to your project:

```yaml
version: '1'
profile: 'client-engagement'
installed_by: 'reagent@0.10.0'
installed_at: '2026-04-01T00:00:00.000Z'

# Autonomy levels:
#   L0 — Read-only; every write requires explicit user approval
#   L1 — Writes allowed to non-blocked paths; destructive operations blocked
#   L2 — Writes + PR creation allowed; destructive tier blocked
#   L3 — All writes allowed; advisory on anomalous patterns
autonomy_level: L2
max_autonomy_level: L3

# Human must approve any autonomy level increase
promotion_requires_human_approval: true

# Block AI attribution in commits and PRs
block_ai_attribution: true

# Paths hooks and agents must never modify
blocked_paths:
  - '.reagent/'
  - '.github/workflows/'
  - '.env'
  - '.env.*'

# Optional: Discord webhook for halt/promote notifications
notification_channel: ''

quality_gates:
  push_review: false

# Prompt injection detection for proxied tool results
injection_detection: block  # 'block' (default) or 'warn'

# Context protection — delegate expensive commands to subagents
context_protection:
  delegate_to_subagent:
    - 'pnpm run preflight'
    - 'pnpm run test'
    - 'pnpm run build'
  max_bash_output_lines: 100
```

The `autonomy_level` controls what tier of tools an agent can call. Raise it to give
an agent more authority; lower it (or freeze) to restrict it. `max_autonomy_level` is a
ceiling set by a human — no agent instruction can escalate beyond it.

`block_ai_attribution: true` causes the `commit-msg` hook to reject commits that contain
`Co-Authored-By` lines with AI names, `Generated with [Tool]` footers, or similar
structural attribution markers. Casual mentions of AI tools in commit messages are
still allowed.

### The kill switch

Create a HALT file to immediately block all agent operations:

```bash
reagent freeze --reason "releasing to production — no agent changes"
```

This creates `.reagent/HALT` with your reason as the content. Every hook checks for this
file at the top of its script. Every tool call checks it at the kill-switch middleware
layer. Nothing gets through.

Remove it when you're ready to resume:

```bash
reagent unfreeze
```

The HALT file is a plain text file in your project. You can also create or delete it
manually, or add it to your release process as a safety gate.

## Connecting additional MCP servers

Instead of listing servers directly in `.mcp.json` (which would bypass reagent's
middleware), add them to `.reagent/gateway.yaml`:

```yaml
version: '1'

servers:
  filesystem:
    command: npx
    args: ['@modelcontextprotocol/server-filesystem', '/home/user/projects']

  github:
    command: npx
    args: ['@modelcontextprotocol/server-github']
    env:
      GITHUB_TOKEN: '${GITHUB_PERSONAL_ACCESS_TOKEN}'

  postgres:
    command: npx
    args: ['@modelcontextprotocol/server-postgres', '${DATABASE_URL}']
    calls_per_minute: 60
    max_concurrent_calls: 5
    tool_overrides:
      execute_query:
        tier: destructive

gateway:
  max_result_size_kb: 512
```

When `reagent serve` starts, it connects to each server, discovers its tools, and
re-registers them on the reagent MCP server with namespaced names
(e.g., `filesystem__read_file`, `github__create_issue`). Every call to a proxied tool
goes through the full middleware chain before forwarding.

**`tool_overrides`** let you reclassify a tool's tier or block it entirely:

```yaml
tool_overrides:
  execute_query:
    tier: destructive # Treat this tool as destructive regardless of its name
  drop_table:
    blocked: true # Always deny calls to this tool, regardless of autonomy level
```

**`calls_per_minute`** and **`max_concurrent_calls`** are per-server rate limits enforced
by the rate-limit middleware.

`${ENV_VAR}` references in `env` blocks are resolved at startup from the environment
where `reagent serve` runs.

## Profiles

`reagent init` accepts a `--profile` flag to install a pre-built configuration:

```bash
# Base profiles (full setup — install one or the other)
reagent init                                    # client-engagement (default)
reagent init --profile bst-internal            # BST internal projects

# Tech stack profiles (add to a base profile)
reagent init --profile lit-wc                  # Lit/Web Components hooks
reagent init --profile astro                   # Astro framework hooks
reagent init --profile nextjs                  # Next.js App Router hooks
reagent init --profile drupal                  # Drupal CMS hooks
```

Tech stack profiles compose on top of the `client-engagement` base by default. You can
specify a different base:

```bash
reagent init --profile lit-wc --base-profile bst-internal
```

The `client-engagement` profile installs:

- Claude Code hooks for dangerous bash interception, secret scanning, env file protection,
  dependency auditing, commit review, push review, security disclosure gates, settings
  protection, blocked path enforcement, changeset security, and architecture review
- Cursor rules: no-hallucination, verify-before-act, attribution
- `block_ai_attribution: true` in `policy.yaml`
- `blocked_paths: ['.reagent/', '.github/workflows/', '.env', '.env.*']`
- Quality gates: commit review (trivial threshold: 20 lines, significant: 200 lines),
  push review, architecture advisory
- PM layer enabled with max 50 open tasks

## Hooks

reagent installs 26 Claude Code hooks into `.claude/hooks/`. Every hook checks for
`.reagent/HALT` at the top — if it exists, the hook returns exit code 2 (hard block)
immediately.

**Pre-tool-use hooks (Bash matcher):**

- `dangerous-bash-interceptor` — Blocks `rm -rf` with broad targets, `curl | bash`,
  `chmod 777`, force-push to protected branches, and other high-risk bash patterns.
  Uses a severity tiering system: HIGH blocks outright, MEDIUM warns.
- `env-file-protection` — Prevents reads and writes to `.env`, `.env.*`, and other
  secret-bearing files.
- `dependency-audit-gate` — Intercepts `npm install`, `pnpm add`, and similar commands.
  Verifies the package exists in the npm registry before allowing installation.
- `commit-review-gate` — Before a `git commit`, checks the diff size. Significant
  changes trigger a structured review request that the agent must satisfy.
- `push-review-gate` — Before `git push`, performs a final quality gate check.
- `security-disclosure-gate` — Intercepts `gh issue create` and similar commands. Blocks
  public disclosure of security vulnerabilities; routes to the configured disclosure mode
  (issues, security advisories, etc.).
- `pr-issue-link-gate` — Requires every PR to reference a GitHub issue.
- `attribution-advisory` — When `block_ai_attribution` is enabled, blocks `git commit`
  and `gh pr create/edit` commands that include AI attribution markers in their content.

**Pre-tool-use hooks (Write|Edit matcher):**

- `secret-scanner` — Scans file content being written or edited for secrets: AWS keys,
  GitHub tokens, PEM private keys, Discord tokens, Stripe keys, and more. Blocks the
  write if a secret is detected.
- `settings-protection` — Prevents writes to `.claude/settings.json` that would disable
  hooks or add risky permissions. Allows agent writes to task files and non-security
  operational files.
- `blocked-paths-enforcer` — Enforces `blocked_paths` from `policy.yaml` for file
  writes and edits. The middleware chain enforces this for tool calls; this hook enforces
  it for direct file operations.
- `changeset-security-gate` — Validates changeset files before they are written. Prevents
  injection of malicious content into the changeset workflow.

**Post-tool-use hooks (Write|Edit matcher):**

- `architecture-review-gate` — After significant file edits, checks the change against
  the project's architecture plan and flags deviations.

**Integration hooks:**

- `reagent-notify` — Sends Discord notifications on significant events (commits, PR
  creation, pushes). Requires `discord_ops` in `gateway.yaml`.
- `reagent-obsidian-journal` — Fires on session end. Appends a session summary to the
  daily note in your Obsidian vault.
- `reagent-obsidian-precompact` — Fires before context compaction. Creates a knowledge
  extraction note in the vault's sessions directory.
- `reagent-obsidian-tasks` — Fires after `task_create`/`task_update`. Materializes tasks
  as individual Obsidian notes with typed frontmatter.

**Additional hooks installed by tech stack profiles:**

- `commit-msg` (husky) — Enforces commit message format and rejects AI attribution
  markers when `block_ai_attribution: true`.
- `pre-commit` (husky) — Runs quality checks before each commit.
- `pre-push` (husky) — Runs the full preflight before push.

The hooks in `.claude/hooks/` use a shared `_lib/` directory for common functions
including HALT checking, policy loading, and output formatting.

## Task management

reagent includes a lightweight project management layer with native MCP tools. Tasks
are stored as append-only JSONL in `.reagent/tasks.jsonl`. Each line is a JSON event
(created, started, completed, blocked, cancelled) with a task ID in `T-NNN` format.

**Native MCP tools:**

- `task_create` — Create a task with title, description, urgency (critical/normal/low),
  phase, milestone, assignee, and optional parent task ID.
- `task_update` — Update a task's status (started, completed, blocked, cancelled) and
  fields. When a task is completed and has a `github_issue` reference, the linked issue
  is closed automatically.
- `task_list` — List tasks with optional filters for status, urgency, and phase.
- `task_get` — Get a single task by ID.
- `task_delete` — Soft-delete a task (appends a `cancelled` event).
- `task_sync_github` — Sync local tasks to GitHub issues (requires `gh` CLI).
- `repo_scaffold` — Scaffold GitHub repo metadata: description, topics, labels
  (`reagent:task`, `reagent:critical`, `reagent:blocked`), and milestones.
- `project_sync` — Sync tasks with GitHub issues to a GitHub Projects v2 board.
- `discord_notify` — Send a notification to a configured Discord channel
  (alerts, releases, tasks, dev). Requires `discord_ops` in `gateway.yaml` and
  `DISCORD_BOT_TOKEN` in the environment.

All native tools go through the same middleware chain as proxied tools — the kill switch,
policy, blocked paths, redaction, and audit all apply.

Slash commands provide quick access to the task board and team orchestration from within
Claude Code conversations:

| Command       | Description                                                                |
| ------------- | -------------------------------------------------------------------------- |
| `/tasks`      | Render a markdown table of current tasks from tasks.jsonl                  |
| `/plan-work`  | Invoke the product-owner agent to propose and create tasks for a goal      |
| `/restart`    | Session handoff — save state on spin-down, orient from saved state on spin-up |
| `/rea`        | Invoke the REA (Reactive Execution Agent) for autonomous team orchestration |
| `/pm-status`  | Scan open PRs, report pipeline state, merge ready work, staging promotion  |
| `/review-pr`  | Fetch a PR diff, run code-reviewer analysis, post findings in owner voice  |

**Example `tasks.jsonl` entries:**

```jsonl
{"id":"T-001","type":"created","title":"Implement login flow","urgency":"critical","timestamp":"2026-04-01T10:00:00.000Z"}
{"id":"T-001","type":"started","title":"Implement login flow","assignee":"frontend-specialist","timestamp":"2026-04-01T10:05:00.000Z"}
{"id":"T-001","type":"completed","title":"Implement login flow","commit_refs":["abc1234"],"pr_ref":"#42","timestamp":"2026-04-01T14:30:00.000Z"}
```

## Obsidian vault integration

reagent can integrate with [Obsidian](https://obsidian.md) vaults for project knowledge
management. Session journaling, task sync, knowledge extraction before context compaction,
and vault health monitoring — all driven by hooks and the CLI.

The integration is **opt-in by default**. Nothing Obsidian-related activates unless you
explicitly configure it. Every Obsidian operation is fail-silent: if the CLI is missing,
the vault path is wrong, or a sync target is disabled, reagent exits cleanly with no
errors and no blocked operations.

### Prerequisites

- **Obsidian CLI** installed at `/usr/local/bin/obsidian`
- An Obsidian vault directory for each project you want to integrate

### Setup

Enable the integration during init:

```bash
reagent init --obsidian --vault-path /path/to/vault
```

Or set the vault path via environment variable:

```bash
export REAGENT_OBSIDIAN_VAULT=/path/to/vault
```

Both methods write an `obsidian_vault` block to `.reagent/gateway.yaml`:

```yaml
obsidian_vault:
  enabled: true
  vault_path: '/path/to/vault'
  vault_name: 'MyProject'
  paths:
    root: 'Projects/Reagent'
    kanban: 'Projects/Reagent/Kanban.md'
    sources: 'Projects/Reagent/Sources'
    wiki: 'Projects/Reagent/Auto'
    tasks: 'Tasks'
    sessions: 'Wiki/Sessions'
  sync:
    kanban: false
    context_dump: false
    wiki_refresh: false
    journal: true # Tier 1 — on by default when integration is enabled
    precompact: false # Tier 2 — opt-in
    tasks: true # Tier 3 — on by default when integration is enabled
  precompact:
    engine: 'claude' # 'claude' or 'ollama'
    model: null # null = use default model for the engine
```

Vault path resolution order:

1. `REAGENT_OBSIDIAN_VAULT` environment variable (absolute path)
2. `obsidian_vault.vault_path` in `gateway.yaml`
3. Not set — integration disabled

### Three-tier hook architecture

Obsidian sync is organized into three tiers, each backed by a dedicated Claude Code hook.
Each tier operates independently and can be enabled or disabled individually.

**Tier 1 — Session Journal** (`reagent-obsidian-journal.sh`)

Fires when a Claude Code session ends. Appends a session summary to the daily note in
your vault via `obsidian daily:append`. The summary includes the project name, a session
identifier, timestamp, and task state counts (completed, in progress, blocked, backlog)
pulled from `.reagent/tasks.jsonl`.

Enable: `sync.journal: true` (default when integration is enabled).

**Tier 2 — PreCompact Knowledge Extraction** (`reagent-obsidian-precompact.sh`)

Fires before Claude Code compacts context. Creates a session knowledge note in
`Wiki/Sessions/` (or your configured `paths.sessions` directory) with frontmatter
tagging the project, date, session ID, and extraction engine.

This tier is a stub — the knowledge extraction engine is not yet fully implemented.
The hook creates a structured placeholder note with sections for Decisions, Discoveries,
and Open Questions. The `precompact.engine` field (`claude` or `ollama`) determines which
backend will perform extraction when the implementation is complete.

Enable: `sync.precompact: true` (disabled by default).

**Tier 3 — Task Materialization** (`reagent-obsidian-tasks.sh`)

Fires after `task_create` and `task_update` MCP tool calls. Materializes each task as an
individual Obsidian note in the `Tasks/` directory with typed frontmatter:

```yaml
---
reagent_managed: true
task_id: T-001
project: my-project
status: started
urgency: critical
assignee: frontend-specialist
---
```

Sync is one-way: JSONL to Obsidian. The hook extracts the task ID from the tool result,
reads the latest event for that task from `.reagent/tasks.jsonl`, and creates or overwrites
the corresponding note.

Enable: `sync.tasks: true` (default when integration is enabled).

### CLI commands

```
reagent obsidian sync [--target kanban|context|wiki|tasks] [--dry-run]
  Sync enabled targets to the Obsidian vault. Without --target, syncs all
  enabled targets. --dry-run previews what would be written.

reagent obsidian status
  Show current Obsidian configuration: vault path, CLI availability,
  configured paths, and which sync targets are enabled or disabled.

reagent obsidian health
  Show vault health metrics: orphan notes, unresolved links, and dead ends.
  Requires vault_name set in gateway.yaml and the Obsidian CLI installed.

reagent obsidian journal
  Manually trigger a session journal entry in the daily note. Useful for
  ad-hoc journaling outside of the automatic session-end hook.
```

### Vault-per-project mapping

Each project maps to its own Obsidian vault. The vault path is resolved per-project from
that project's `.reagent/gateway.yaml` or `REAGENT_OBSIDIAN_VAULT` environment variable.
There is no global vault registry — each project is self-contained.

## CLI reference

```
reagent init [options]
  --profile <name>      Profile to install (default: client-engagement)
  --base-profile <name> Base profile to use with a tech stack profile
  --dry-run             Preview what would be installed without writing files
  --github              Configure GitHub integration in gateway.yaml
  --discord             Configure Discord notifications in gateway.yaml
  --guild-id <id>       Discord guild ID
  --alerts-channel <id> Discord channel ID for security alerts
  --tasks-channel <id>  Discord channel ID for task events
  --releases-channel    Discord channel ID for release events
  --dev-channel <id>    Discord channel ID for dev activity
  --obsidian            Enable Obsidian vault integration in gateway.yaml
  --vault-path <path>   Absolute path to the Obsidian vault directory

reagent serve
  Starts the MCP server on stdio. Loaded by Claude Code via .mcp.json.
  Reads .reagent/policy.yaml and .reagent/gateway.yaml from the current directory.

reagent check
  Checks which reagent components are installed in the current project.

reagent freeze --reason "<reason>"
  Creates .reagent/HALT with the provided reason. Immediately blocks all
  agent tool calls and hook-guarded bash commands.

reagent unfreeze
  Removes .reagent/HALT. Resumes agent operations.

reagent catalyze [targetDir]
  --plan    Analyze project stack and generate a gap analysis report (default)
  --audit   Compare current state against the last plan and show drift
  --dry-run Print analysis without writing files

reagent upgrade [--dry-run] [--clean-blocked-paths]
  Re-syncs husky hooks, merges new policy fields into policy.yaml, ensures
  reagent is a devDependency, and migrates .mcp.json from the legacy npx
  pattern to the direct node path (for pnpm compatibility).
  --clean-blocked-paths replaces the blanket '.reagent/' blocked path with
  granular entries, allowing agents to write to operational files (tasks,
  review cache) while keeping policy and audit files protected.

reagent cache <set|get|del> <key> [value]
  Manages the review cache used by commit-review-gate and push-review-gate.

reagent obsidian <sync|status|health|journal>
  Obsidian vault integration commands. See the Obsidian vault integration
  section above for full documentation.
```

## Configuration

### `.reagent/policy.yaml`

The primary policy file. Committed to the repo. Describes the autonomy level, blocked
paths, and quality gate settings for this project.

```yaml
version: '1'
profile: 'client-engagement'
autonomy_level: L2 # L0 | L1 | L2 | L3
max_autonomy_level: L3 # ceiling — agents cannot escalate beyond this
promotion_requires_human_approval: true
block_ai_attribution: true # reject AI attribution in commits and PRs
blocked_paths:
  - '.reagent/'
  - '.github/workflows/'
  - '.env'
  - '.env.*'
notification_channel: '' # Discord webhook for halt/promote events
quality_gates:
  push_review: false
```

### `.reagent/gateway.yaml`

Declares downstream MCP servers and global gateway options.

```yaml
version: '1'

servers:
  filesystem:
    command: npx
    args: ['@modelcontextprotocol/server-filesystem', '/path/to/project']

  github:
    command: npx
    args: ['@modelcontextprotocol/server-github']
    env:
      GITHUB_TOKEN: '${GITHUB_PERSONAL_ACCESS_TOKEN}'
    calls_per_minute: 120
    tool_overrides:
      delete_repository:
        blocked: true

gateway:
  max_result_size_kb: 512
```

Fields per server entry:

| Field                  | Description                                         |
| ---------------------- | --------------------------------------------------- |
| `command`              | The executable to spawn                             |
| `args`                 | Arguments passed to the command                     |
| `env`                  | Environment variables (supports `${VAR}` expansion) |
| `tool_overrides`       | Per-tool tier overrides or hard blocks              |
| `calls_per_minute`     | Rate limit for this server (0 = unlimited)          |
| `max_concurrent_calls` | Concurrency limit (0 = unlimited)                   |

### `~/.reagent/daemon.yaml`

Removed. reagent no longer uses a daemon or process supervisor. Claude Code owns the
`reagent serve` process lifecycle via stdio transport in `.mcp.json`.

## Contributing / Development

```bash
pnpm install
pnpm build          # compile TypeScript to dist/
pnpm tsc --noEmit   # type-check without emitting
pnpm test           # run all tests with vitest
pnpm preflight      # full quality gate (build + typecheck + test + lint + format)
```

Changesets workflow:

```bash
pnpm changeset          # create a new changeset
pnpm changeset:version  # bump versions and update CHANGELOG
pnpm changeset:publish  # publish to npm
```

There is no Rust code in this project. The `daemon/` directory has been removed. The
project is pure TypeScript targeting Node.js 22+, compiled to ESM.

The test suite lives in `src/__tests__/` and covers the middleware chain, all hooks,
the CLI init flow, config loaders, the task store, GitHub and Discord integrations,
and an end-to-end smoke test that spawns a real `reagent serve` process.
