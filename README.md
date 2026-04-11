# @bookedsolid/reagent

Zero-trust MCP gateway and agentic infrastructure for AI-assisted development.

Reagent is four things:

1. **MCP Gateway** (`reagent serve`) — a proxy server that sits between your AI assistant (Claude Code, Cursor, etc.) and downstream MCP tool servers. Every tool call flows through a zero-trust middleware chain: policy enforcement, tier classification, blocked path enforcement, secret redaction, and hash-chained audit logging.

2. **Config Scaffolder** (`reagent init`) — installs safety hooks, behavioral policies, quality gates, agent teams, and developer tooling into any project.

3. **Stack Analyzer** (`reagent catalyze`) — detects your project's tech stack and generates a gap analysis report showing which hooks, gates, and agents are missing. Produces Markdown and HTML reports.

4. **Project Management Layer** — lightweight task tracking with JSONL event store, native MCP tools, GitHub issue sync, and a product-owner agent for task planning.

## Why Reagent?

AI coding assistants are powerful but unconstrained. Reagent adds the missing governance layer:

- **Policy enforcement** — graduated autonomy levels (L0 read-only through L3 full access) control which tiers of tools an agent can invoke
- **Kill switch** — `reagent freeze` immediately blocks all tool calls across every connected MCP server
- **Blocked path enforcement** — tool arguments referencing protected paths (including `.reagent/` itself) are denied before execution
- **Secret redaction** — tool arguments and outputs are scanned for AWS keys, GitHub tokens, API keys, PEM private keys, Discord tokens, and more — redacted before they reach the AI or the downstream tool
- **Audit trail** — every tool invocation is logged as hash-chained JSONL with serialized writes for chain integrity
- **Tool blocking** — individual tools can be permanently blocked regardless of autonomy level
- **Tier downgrade protection** — `tool_overrides` cannot lower a tool's tier below its static or convention-based classification
- **Security hooks** — 20 Claude Code hooks enforce settings protection, secret scanning, dangerous command interception, blocked path enforcement, symlink traversal prevention, network exfiltration blocking, and more
- **Quality gates** — commit and push review gates with triage scoring, review caching, and agent-spawned code review
- **Task management** — native MCP tools for task CRUD, GitHub issue sync, and a product-owner agent with guardrails

## Quick Start

### As an MCP Gateway

```bash
npm install -g @bookedsolid/reagent

# Initialize a project with policy and gateway config
reagent init --profile bst-internal

# Configure your downstream MCP servers in .reagent/gateway.yaml
# Then start the gateway
reagent serve
```

Point your AI assistant's MCP configuration at the gateway:

```json
{
  "mcpServers": {
    "reagent": {
      "command": "npx",
      "args": ["-y", "@bookedsolid/reagent", "serve"]
    }
  }
}
```

All downstream tool calls now flow through Reagent's middleware chain.

### As a Config Scaffolder

```bash
npx @bookedsolid/reagent init

# With a base profile
npx @bookedsolid/reagent init --profile bst-internal
npx @bookedsolid/reagent init --profile client-engagement

# With a tech stack profile
npx @bookedsolid/reagent init --profile nextjs
npx @bookedsolid/reagent init --profile lit-wc

# With optional integrations
npx @bookedsolid/reagent init --github    # scaffold GitHub labels + milestones
npx @bookedsolid/reagent init --discord   # configure Discord notifications

# Preview without changes
npx @bookedsolid/reagent init --dry-run
```

## Installing Reagent in Your Project

This section documents the end-to-end setup for a new project — including the nuances of MCP transport, token passing, and env var expansion that aren't obvious from first principles.

### Step 1 — Run `reagent init`

```bash
cd /path/to/your-project
npx @bookedsolid/reagent init --profile bst-internal
```

This installs hooks, policy, agent team, gateway config template, and Claude settings. It also writes a managed block into `CLAUDE.md` with agent behavioral rules.

To pick up an updated hook suite after a reagent version bump:

```bash
npx @bookedsolid/reagent upgrade
```

`upgrade` re-syncs hooks that are already installed and bumps `installed_by` in `policy.yaml`. It never adds new hooks without consent.

### Step 2 — Configure `.mcp.json`

**Use stdio transport — not HTTP.** Claude Code's HTTP MCP transport requires OAuth 2.1, which the reagent server does not implement. The stdio transport is what works:

```json
{
  "mcpServers": {
    "reagent": {
      "command": "npx",
      "args": ["-y", "@bookedsolid/reagent", "serve"]
    }
  }
}
```

> **Why `npx` instead of `reagent`?** Using the bare `reagent` command requires a global install. `npx` works from any project, always uses the registry version, and avoids "command not found" errors on machines where reagent isn't globally installed.

> **Env vars in `.mcp.json`:** Claude Code does **not** expand `${VAR}` syntax in `.mcp.json` env values — the literal string `${MY_TOKEN}` is passed to the process, not the value. If reagent needs tokens to pass to downstream MCP servers (e.g., Discord bots), use the gateway proxy pattern instead (see Step 3). The gateway **does** expand `${VAR}` from the shell environment at startup.

If you need to pass env vars to `reagent serve` itself (e.g., tokens used by native tools like `discord_notify`), set them in your shell environment rather than in `.mcp.json`:

```bash
# In your shell profile or .env (never committed):
export BOOKED_DISCORD_BOT_TOKEN="..."
```

### Step 3 — Configure downstream MCP servers (gateway proxy)

If your project uses other MCP servers that need secrets (API keys, bot tokens, etc.), proxy them through reagent's gateway rather than adding them directly to `.mcp.json`. This is the **only** way to pass env vars reliably from Claude Code.

Edit `.reagent/gateway.yaml`:

```yaml
version: '1'

servers:
  discord-ops:
    command: npx
    args: ['-y', 'discord-ops@latest']
    env:
      BOOKED_DISCORD_BOT_TOKEN: '${BOOKED_DISCORD_BOT_TOKEN}'
      CLARITY_DISCORD_BOT_TOKEN: '${CLARITY_DISCORD_BOT_TOKEN}'
```

The `${VAR}` syntax here is resolved by reagent from `process.env` at gateway startup — it works because reagent inherits the shell environment from Claude Code's process. The spawned child MCP server receives the resolved values.

Do **not** add the same server to both `gateway.yaml` and `.mcp.json` directly — `reagent init` warns about this. Direct `.mcp.json` entries with `${VAR}` env values will pass the literal string, not the token.

### Step 4 — Commit the config files

`reagent init` generates files in two categories:

| File                         | Commit?                                             |
| ---------------------------- | --------------------------------------------------- |
| `.reagent/policy.yaml`       | Yes — defines autonomy level for the team           |
| `.reagent/gateway.yaml`      | Yes — documents which MCP servers this project uses |
| `.claude/settings.json`      | Yes — permission gates for Claude Code              |
| `.claude/hooks/`             | Yes — safety and quality hooks                      |
| `.claude/agents/`            | Yes — agent team definitions                        |
| `CLAUDE.md` (managed block)  | Yes — behavioral rules for AI agents                |
| `.reagent/tasks.jsonl`       | No — gitignored, local task store                   |
| `.reagent/audit/`            | No — gitignored, local audit log                    |
| `.reagent/review-cache.json` | No — gitignored, local review cache                 |

### Upgrading an existing install

When a new version of reagent ships with updated hooks or agents:

```bash
npx @bookedsolid/reagent upgrade
```

This re-syncs all hooks in `.claude/hooks/` and `.husky/` that were installed by a previous `reagent init`. It will not add hooks that weren't installed originally.

### How `reagent serve` runs in Claude Code

When Claude Code reads `.mcp.json`, it spawns `npx -y @bookedsolid/reagent serve` as a child process. The MCP protocol runs over stdio between Claude Code and the reagent process. Reagent then spawns its own child processes for each entry in `gateway.yaml`, also over stdio.

The resulting process tree:

```
Claude Code
  └── reagent serve (stdio MCP to Claude Code)
        └── discord-ops (stdio MCP, proxied through reagent)
        └── other-server (stdio MCP, proxied through reagent)
```

All tool calls from Claude Code go through reagent's middleware chain before reaching downstream servers.

## Commands

| Command                         | Description                                       |
| ------------------------------- | ------------------------------------------------- |
| `reagent serve`                 | Start the MCP gateway server (stdio transport)    |
| `reagent serve`                 | Start the MCP gateway server (stdio transport)    |
| `reagent init`                  | Install reagent config into the current directory |
| `reagent upgrade`               | Re-sync hooks and bump installed_by in policy     |
| `reagent catalyze`              | Analyze project stack and generate gap report     |
| `reagent check`                 | Verify what reagent components are installed      |
| `reagent freeze --reason "..."` | Create `.reagent/HALT` — suspends all tool calls  |
| `reagent unfreeze`              | Remove `.reagent/HALT` — resumes tool calls       |
| `reagent cache check <sha>`     | Check review cache for a file SHA                 |
| `reagent cache set <sha> <res>` | Store a review result (pass/fail/advisory)        |
| `reagent cache clear`           | Clear all cached review results                   |
| `reagent help`                  | Show usage help                                   |

### `reagent init` Options

| Flag                      | Description                                    | Default             |
| ------------------------- | ---------------------------------------------- | ------------------- |
| `--profile <name>`        | Profile to install                             | `client-engagement` |
| `--dry-run`               | Preview what would be installed without writes | —                   |
| `--github`                | Scaffold GitHub labels, milestones, and topics | —                   |
| `--discord`               | Configure Discord notifications in gateway     | —                   |
| `--guild-id <id>`         | Discord server ID (used with `--discord`)      | —                   |
| `--alerts-channel <id>`   | Discord channel for security alerts            | —                   |
| `--tasks-channel <id>`    | Discord channel for task events                | —                   |
| `--releases-channel <id>` | Discord channel for release events             | —                   |
| `--dev-channel <id>`      | Discord channel for dev activity               | —                   |

### `reagent upgrade` Options

| Flag        | Description                                  | Default |
| ----------- | -------------------------------------------- | ------- |
| `--dry-run` | Preview what would be updated without writes | —       |

Re-syncs hooks in `.claude/hooks/` and `.husky/` that were installed by a previous `reagent init`. Updates `installed_by` in `.reagent/policy.yaml`. Never adds hooks that weren't originally installed.

### `reagent catalyze` Options

| Flag          | Description                                          | Default |
| ------------- | ---------------------------------------------------- | ------- |
| `--plan`      | Analyze stack and generate gap report (default)      | ✓       |
| `--audit`     | Compare current state against last plan, show drift  | —       |
| `--dry-run`   | Print analysis without writing files                 | —       |
| `[targetDir]` | Directory to analyze (defaults to current directory) | `cwd`   |

`--plan` generates `catalyze-report.md` and `catalyze-report.html` listing gaps by severity. `--audit` re-runs analysis and diffs against the previous report to surface new or resolved gaps.

### `reagent freeze` Options

| Flag              | Description                        | Default         |
| ----------------- | ---------------------------------- | --------------- |
| `--reason <text>` | Reason for freeze (stored in HALT) | `Manual freeze` |

### `reagent cache` Subcommands

The review cache stores code review results to avoid redundant agent reviews on unchanged code.

```bash
# Check if a file has a cached review
reagent cache check abc123 --branch main --base def456

# Store a review result
reagent cache set abc123 pass --branch main --reviewer code-reviewer --findings 0 --ttl 86400

# Clear all cache entries
reagent cache clear
```

| Flag                | Description               | Default   |
| ------------------- | ------------------------- | --------- |
| `--branch <name>`   | Branch name for cache key | `""`      |
| `--base <commit>`   | Base commit for cache key | `""`      |
| `--reviewer <name>` | Reviewer agent name       | `unknown` |
| `--findings <n>`    | Number of findings        | `0`       |
| `--ttl <seconds>`   | Cache entry TTL           | `86400`   |

Cache file: `.reagent/review-cache.json`, keyed on `${branch}:${baseCommit}:${fileSHA256}`.

## MCP Gateway

### How It Works

```
AI Assistant (Claude Code, Cursor, etc.)
    |
    |  stdio (MCP protocol)
    v
+-----------------------------+
|       Reagent Gateway       |
|                             |
|  +------------------------+ |
|  |   Middleware Chain      | |
|  |                        | |
|  |  1. Audit (outermost)  | |
|  |  2. Session context    | |
|  |  3. Kill switch        | |
|  |  4. Tier classify      | |
|  |  5. Policy enforce     | |
|  |  6. Blocked paths      | |
|  |  7. Secret redaction   | |
|  |  8. [Execute]          | |
|  +------------------------+ |
|                             |
|  Native Tools:              |
|    task_create, task_update |
|    task_list, task_get      |
|    task_delete              |
|    task_sync_github         |
|    repo_scaffold            |
|    project_sync             |
|    discord_notify           |
|                             |
+----------+------------------+
           |  stdio (MCP protocol)
           v
    Downstream MCP Servers
    (discord-ops, filesystem, etc.)
```

The gateway:

1. Connects to all downstream MCP servers defined in `.reagent/gateway.yaml`
2. Discovers their tools via MCP `tools/list`
3. Re-registers each tool on the gateway with namespace prefixes (`servername__toolname`)
4. Registers native first-party tools through the same middleware chain
5. Wraps every tool call in the middleware chain
6. Listens on stdio for incoming MCP requests from the AI assistant

### Native MCP Tools

Reagent registers 9 first-party tools directly on the gateway. These go through the same middleware chain (audit, policy, blocked paths, redaction) as proxied tools.

| Tool               | Description                                             |
| ------------------ | ------------------------------------------------------- |
| `task_create`      | Create a new task in `.reagent/tasks.jsonl`             |
| `task_update`      | Update a task's status, title, urgency, or fields       |
| `task_list`        | List tasks with optional status/urgency/phase filter    |
| `task_get`         | Get a single task by ID (T-NNN format)                  |
| `task_delete`      | Cancel a task (soft delete via cancelled event)         |
| `task_sync_github` | Sync local tasks to GitHub issues (requires `gh`)       |
| `repo_scaffold`    | Set GitHub repo description, topics, labels, milestones |
| `project_sync`     | Sync tasks to a GitHub Project board                    |
| `discord_notify`   | Send a notification to a configured Discord channel     |

### Gateway Configuration

Create `.reagent/gateway.yaml`:

```yaml
version: '1'
servers:
  discord-ops:
    command: node
    args:
      - /path/to/discord-ops/dist/index.js
    env:
      DISCORD_BOT_TOKEN: '${DISCORD_BOT_TOKEN}'
    tool_overrides:
      get_messages:
        tier: read
      send_message:
        tier: write
      purge_messages:
        tier: destructive
      delete_channel:
        tier: destructive
        blocked: true
```

**Environment variable resolution:** Use `${VAR_NAME}` syntax in env values — Reagent resolves them from `process.env` at startup. Missing env vars produce a warning and resolve to empty string.

**Tool overrides:** Each downstream tool can be assigned a tier (`read`, `write`, `destructive`) and optionally blocked entirely. Overrides cannot lower a tool's tier below its static or convention-based classification (the override is ignored with a warning if attempted).

#### Discord Notifications (optional)

When `--discord` is passed to `reagent init`, a `discord_ops` block is appended to gateway.yaml:

```yaml
discord_ops:
  guild_id: '1234567890'
  channels:
    alerts: '111'
    tasks: '222'
    releases: '333'
    dev: '444'
```

The `discord_notify` native tool reads this config to route notifications. All Discord notifications are fire-and-forget (fail-silent).

### Tool Namespacing

Downstream tools are namespaced as `servername__toolname` to prevent collisions:

```
discord-ops__send_message
discord-ops__get_messages
filesystem__read_file
filesystem__write_file
```

### Multiple Downstream Servers

```yaml
version: '1'
servers:
  discord-ops:
    command: node
    args: [/path/to/discord-ops/dist/index.js]
  filesystem:
    command: npx
    args: [-y, '@modelcontextprotocol/server-filesystem', '/allowed/path']
  github:
    command: npx
    args: [-y, '@modelcontextprotocol/server-github']
    env:
      GITHUB_PERSONAL_ACCESS_TOKEN: '${GITHUB_TOKEN}'
```

All tools from all servers are aggregated into a single gateway.

## Middleware Chain

Every tool call passes through the middleware chain in onion (Koa-style) order. The chain is designed with security invariants:

### 1. Audit (outermost)

Records every invocation — including denials and errors — as a hash-chained JSONL entry. Written to `.reagent/audit/YYYY-MM-DD.jsonl`. Each record contains:

```json
{
  "timestamp": "2026-04-09T12:00:00.000Z",
  "session_id": "a1b2c3d4-...",
  "tool_name": "send_message",
  "server_name": "discord-ops",
  "tier": "write",
  "status": "allowed",
  "autonomy_level": "L1",
  "duration_ms": 42,
  "prev_hash": "0000...0000",
  "hash": "abc123..."
}
```

The `prev_hash` field chains records together — tamper with one record and every subsequent hash becomes invalid. Audit writes are serialized via a queue to maintain hash chain linearity under concurrent invocations. The `autonomy_level` is sourced from the loaded policy object, not from mutable invocation context.

### 2. Session Context

Attaches a unique session ID (UUID via `crypto.randomUUID()`) to every invocation. Each gateway instance generates one session ID at startup.

### 3. Kill Switch

Checks for `.reagent/HALT` file. If present, the invocation is immediately denied. The HALT file contents become the denial reason. Reads are capped at 1024 bytes. The file is validated as a regular file (symlinks outside `.reagent/` are rejected).

```bash
# Emergency stop — all tool calls blocked immediately
reagent freeze --reason "security incident at 2026-04-09T12:00:00Z"

# Resume
reagent unfreeze
```

### 4. Tier Classification

Classifies the tool into one of three tiers using a layered approach:

| Source           | Priority | Description                                |
| ---------------- | -------- | ------------------------------------------ |
| Static map       | 1st      | Known tools with explicit tier assignments |
| Convention-based | 2nd      | Prefix patterns for unknown tools          |
| Default          | 3rd      | Falls back to `write`                      |

**Convention-based classification** allows non-Discord downstream servers to get sensible defaults:

| Prefix pattern                                                                                               | Tier          |
| ------------------------------------------------------------------------------------------------------------ | ------------- |
| `get_`, `list_`, `search_`, `query_`, `read_`, `fetch_`, `check_`, `health_`, `describe_`, `show_`, `count_` | `read`        |
| `delete_`, `drop_`, `purge_`, `remove_`, `destroy_`, `ban_`, `kick_`, `revoke_`, `truncate_`                 | `destructive` |
| Everything else                                                                                              | `write`       |

**Tier levels:**

| Tier          | Description                     | Examples                                         |
| ------------- | ------------------------------- | ------------------------------------------------ |
| `read`        | Observes state, no side effects | `get_messages`, `list_channels`, `health_check`  |
| `write`       | Modifies state                  | `send_message`, `create_channel`, `edit_message` |
| `destructive` | Irreversible state changes      | `delete_channel`, `purge_messages`, `ban_member` |

### 5. Policy Enforcement

Checks the tool's tier against the project's autonomy level. The policy middleware re-derives the tier from the tool name independently — it never trusts `ctx.tier` from prior middleware.

| Autonomy Level     | Allowed Tiers                    |
| ------------------ | -------------------------------- |
| `L0` (read-only)   | `read`                           |
| `L1` (standard)    | `read` + `write`                 |
| `L2` (elevated)    | `read` + `write`                 |
| `L3` (full access) | `read` + `write` + `destructive` |

Also checks for explicitly blocked tools — a tool marked `blocked: true` in gateway config is denied regardless of autonomy level.

### 6. Blocked Paths

Scans all string-valued tool arguments for references to paths listed in the policy's `blocked_paths`. The `.reagent/` directory is always protected regardless of policy configuration. Matching uses normalized path containment (backslashes converted to forward slashes, relative path variants checked).

### 7. Secret Redaction

Operates both **pre-execution** (scanning tool arguments before they reach the downstream tool) and **post-execution** (scanning tool output before it reaches the AI). Detected patterns are replaced with `[REDACTED]`:

- AWS Access Keys (`AKIA...`)
- AWS Secret Keys
- GitHub Tokens (`ghp_...`, `gho_...`, `ghs_...`, `ghu_...`, `ghr_...`)
- Generic API Keys
- Bearer Tokens
- PEM Private Keys (RSA, EC, DSA)
- Discord Bot Tokens
- Base64-encoded AWS Keys

Redaction uses `redactDeep` to walk object structures in-place with a circular reference guard (WeakSet). Input is sanitized (null bytes and control characters stripped) before pattern matching.

### Security Invariants

- **Denial is permanent** — once any middleware denies an invocation, no subsequent middleware can revert it (enforced by `executeChain`)
- **Audit records everything** — audit is outermost, so even kill-switch denials are recorded
- **Policy re-derives tier** — never trusts mutable context; always re-classifies from tool name
- **Fail-closed** — errors in kill-switch or policy checks result in denial, not passthrough
- **All logging to stderr** — stdout is reserved for the MCP stdio transport
- **Per-tool timeout** — each downstream tool call has a 30-second timeout with timer cleanup to prevent leaks
- **Graceful shutdown** — `process.exitCode = 0` (not `process.exit(0)`) to allow event loop drain

## Claude Code Hooks

Reagent installs 20 Claude Code hooks that enforce security, quality, and project management policies. Hooks are shell scripts that run as PreToolUse or PostToolUse interceptors.

### Hook Architecture

Hooks use a shared library (`hooks/_lib/common.sh`) providing:

| Function       | Purpose                                               |
| -------------- | ----------------------------------------------------- |
| `reagent_root` | Find the `.reagent/` directory by walking up from cwd |
| `check_halt`   | Exit with code 2 if `.reagent/HALT` exists            |
| `require_jq`   | Verify jq is available                                |
| `json_output`  | Build structured JSON response (block/allow/advisory) |
| `triage_score` | Score a diff as trivial/standard/significant          |

### Exit Code Convention

| Code | Meaning             |
| ---- | ------------------- |
| `0`  | Allow the tool call |
| `2`  | Block the tool call |

### Security Hooks

#### `settings-protection.sh` (PreToolUse: Write, Edit)

**P0 Critical.** Prevents agents from modifying their own safety rails. Blocks writes to:

- `.claude/settings.json`, `.claude/settings.local.json`
- `.claude/hooks/*`
- `.husky/*`
- `.reagent/policy.yaml`, `.reagent/HALT`, `.reagent/review-cache.json`

Includes case-insensitive bypass detection and URL-decode normalization to prevent encoding attacks.

#### `blocked-paths-enforcer.sh` (PreToolUse: Write, Edit)

**P0 Critical.** Reads `blocked_paths` from `.reagent/policy.yaml` and blocks writes to matching paths. Handles both inline YAML arrays (`[a, b]`) and block sequences. Supports directory prefix matching, glob patterns, and exact match.

#### `dangerous-bash-interceptor.sh` (PreToolUse: Bash)

Intercepts dangerous shell commands before execution:

| Detection | Blocked Command Pattern                                                             |
| --------- | ----------------------------------------------------------------------------------- |
| H1        | `git push --force` / `-f` to protected branches (main, master, staging, production) |
| H2        | `rm -rf /` or `rm -rf ~`                                                            |
| H3        | `chmod 777`                                                                         |
| H4        | `curl \| sh`, `wget \| sh` (pipe-to-shell)                                          |
| H5        | `> /dev/sda` (disk overwrite)                                                       |
| H6        | `:(){ :\|:& };:` (fork bomb)                                                        |
| H7        | `mkfs` (disk format)                                                                |
| H8        | `dd if=` (disk copy)                                                                |
| H9        | `.env` file access via cat/less/head/tail                                           |
| H10       | `shutdown`, `reboot`, `halt`, `poweroff`                                            |
| H11       | `kill -9`, `killall`, `pkill`                                                       |
| H12       | `iptables` / `ufw` (firewall modification)                                          |
| H13       | `git push --no-verify`                                                              |
| H14       | `git -c core.hooksPath=` (hook path override)                                       |
| H15       | `REAGENT_BYPASS` environment variable                                               |
| H16       | Alias/function definitions containing bypass strings                                |

#### `secret-scanner.sh` (PreToolUse: Write, Edit)

Scans file content being written for secrets:

- AWS Access Keys (`AKIA...`)
- PEM private key headers (RSA, EC, DSA)
- GitHub PATs (`ghp_`, `gho_`, `ghs_`, `ghu_`, `ghr_` with 36+ chars)
- Stripe live keys (`sk_live_`)
- Generic `SECRET=`/`PASSWORD=`/`TOKEN=`/`API_KEY=` assignments with real values

Allows placeholders (`<your_key_here>`, `changeme`, `xxx`), `process.env` references, and `.env.example` files.

#### `env-file-protection.sh` (PreToolUse: Write, Edit)

Blocks writes to `.env` files (`.env`, `.env.local`, `.env.production`, etc.). Allows `.env.example` and `.env.template` files.

#### `attribution-advisory.sh` (PreToolUse: Bash)

When `block_ai_attribution` is enabled in policy.yaml, blocks `gh pr create`, `gh pr edit`, and `git commit` commands containing AI attribution patterns:

- `Co-Authored-By` with AI names (Claude, Copilot, GPT, Cursor, etc.)
- `Generated with [Tool]` footers
- `AI-generated` markers

#### `symlink-guard.sh` (PreToolUse: Write, Edit)

Detects symlink traversal attempts — blocks writes to paths that resolve through a symlink outside the project root.

#### `network-exfil-guard.sh` (PreToolUse: Bash)

Blocks `curl`/`wget`/`fetch` commands targeting non-allowlisted external hosts from within Claude tool calls. Prevents data exfiltration via outbound HTTP.

#### `import-guard.sh` (PreToolUse: Write, Edit)

Flags dangerous import patterns being written to source files — `eval`, `Function()`, dynamic `require()` with user-controlled input, and known supply-chain risk patterns.

#### `git-config-guard.sh` (PreToolUse: Bash)

Blocks `git config` commands that override hook paths, rewrite signing, or modify credential helpers in ways that could bypass security controls.

#### `ci-config-protection.sh` (PreToolUse: Write, Edit)

Blocks writes to `.github/workflows/` and other CI configuration files. Prevents agents from modifying pipeline definitions that run in elevated contexts.

### Quality Gate Hooks

#### `commit-review-gate.sh` (PreToolUse: Bash)

Intercepts `git commit` commands and applies triage-based review:

| Triage Level    | Criteria                              | Action                                         |
| --------------- | ------------------------------------- | ---------------------------------------------- |
| **Trivial**     | <20 changed lines, no sensitive paths | Pass immediately                               |
| **Standard**    | 20-200 changed lines                  | Check review cache; pass if cached             |
| **Significant** | >200 lines OR sensitive paths         | Block; instruct agent to spawn `code-reviewer` |

Sensitive paths: `.reagent/`, `.claude/`, `.env`, `auth`, `security`, `.github/workflows`.

Returns `additionalContext` instructing the agent to spawn a `code-reviewer` specialist agent when blocked.

#### `push-review-gate.sh` (PreToolUse: Bash)

Intercepts `git push` commands. Analyzes the full diff against the target branch:

1. Computes triage score of all commits being pushed
2. Checks review cache for cached results
3. On cache miss for standard/significant changes: blocks with instructions to spawn `code-reviewer` and `security-engineer` agents

#### `architecture-review-gate.sh` (PostToolUse: Write, Edit)

**Advisory only (never blocks).** Flags writes to architecture-sensitive paths:

- `src/types/`, `src/gateway/`, `src/config/`
- `src/cli/commands/init/`
- `package.json`, `tsconfig*.json`
- `.github/workflows/`

Returns a stderr advisory suggesting the agent consider architectural implications.

### Project Management Hooks

#### `task-link-gate.sh` (PreToolUse: Bash)

**Opt-in** (requires `task_link_gate: true` in policy.yaml). Intercepts `git commit` commands and checks that the commit message contains a task ID reference (`T-NNN` format). Allows merge commits, version bumps, and `chore:`/`style:`/`ci:` prefixed commits without task references.

#### `dependency-audit-gate.sh` (PreToolUse: Bash)

Intercepts `npm install`, `pnpm add`, `yarn add`, and `npx` commands. Extracts package names and verifies each exists in the npm registry via `npm view` before allowing the install.

### Safety Hooks

#### `output-validation.sh` (PostToolUse)

Scans tool output returned to the AI for secrets before they enter the model's context. Same pattern set as `secret-scanner.sh`.

#### `file-size-guard.sh` (PreToolUse: Write)

Blocks writes of files exceeding a configurable size threshold. Prevents runaway code generation from creating oversized blobs.

#### `rate-limit-guard.sh` (PreToolUse)

Tracks tool call frequency per session and blocks when a per-minute threshold is exceeded. Logged to `.reagent/rate-limit.log`.

## Policy File

`.reagent/policy.yaml` controls agent behavior:

```yaml
version: '1'
profile: bst-internal
installed_by: 'reagent@0.7.2'
installed_at: '2026-04-09T00:00:00.000Z'
autonomy_level: L1
max_autonomy_level: L2
promotion_requires_human_approval: true
block_ai_attribution: true
blocked_paths:
  - '.reagent/'
  - '.env'
  - '.env.*'
notification_channel: ''
task_link_gate: false
```

| Field                               | Type       | Description                                                   |
| ----------------------------------- | ---------- | ------------------------------------------------------------- |
| `version`                           | `string`   | Schema version (currently `"1"`)                              |
| `profile`                           | `string`   | Profile name used during init                                 |
| `installed_by`                      | `string`   | Tool and version that generated this file                     |
| `installed_at`                      | `string`   | ISO 8601 timestamp of installation                            |
| `autonomy_level`                    | `enum`     | Current level (L0-L3) — controls which tool tiers are allowed |
| `max_autonomy_level`                | `enum`     | Ceiling — `autonomy_level` is clamped to this on load         |
| `promotion_requires_human_approval` | `boolean`  | Whether level changes need human sign-off                     |
| `block_ai_attribution`              | `boolean`  | When true, commit-msg hook rejects AI attribution markers     |
| `blocked_paths`                     | `string[]` | Paths the agent must never modify (`.reagent/` always added)  |
| `notification_channel`              | `string`   | Optional notification channel identifier                      |
| `task_link_gate`                    | `boolean`  | When true, commits must reference a task ID (T-NNN)           |

The `max_autonomy_level` field is enforced at config load time: if `autonomy_level` exceeds `max_autonomy_level`, it is clamped down with a warning.

## Project Management

Reagent includes a lightweight project management layer for tracking tasks alongside code.

### Task Store

Tasks are stored as an append-only event log in `.reagent/tasks.jsonl`. Each line is a JSON event:

```json
{"id":"T-001","type":"created","title":"Implement review cache","urgency":"normal","phase":"Phase 2","timestamp":"2026-04-09T12:00:00.000Z"}
{"id":"T-001","type":"started","title":"Implement review cache","timestamp":"2026-04-09T13:00:00.000Z"}
{"id":"T-001","type":"completed","title":"Implement review cache","commit_refs":["abc123"],"timestamp":"2026-04-09T14:00:00.000Z"}
```

The current state of each task is materialized by replaying events — the latest event for each task ID determines its status. This append-only design means no data is ever lost and concurrent writes are safe with advisory file locking.

#### Task Schema

| Field          | Type                                              | Required | Description                   |
| -------------- | ------------------------------------------------- | -------- | ----------------------------- |
| `id`           | `string` (T-NNN)                                  | Yes      | Auto-incrementing task ID     |
| `type`         | `created\|started\|completed\|blocked\|cancelled` | Yes      | Event type                    |
| `title`        | `string` (1-200 chars)                            | Yes      | Task title                    |
| `description`  | `string`                                          | No       | Detailed description          |
| `urgency`      | `critical\|normal\|low`                           | No       | Defaults to `normal`          |
| `phase`        | `string`                                          | No       | Project phase                 |
| `milestone`    | `string`                                          | No       | Milestone reference           |
| `assignee`     | `string`                                          | No       | Assigned agent or person      |
| `parent_id`    | `string` (T-NNN)                                  | No       | Parent task for hierarchy     |
| `commit_refs`  | `string[]`                                        | No       | Related commit SHAs           |
| `pr_ref`       | `string`                                          | No       | Related PR reference          |
| `blocked_by`   | `string`                                          | No       | What's blocking this task     |
| `github_issue` | `number`                                          | No       | Linked GitHub issue number    |
| `timestamp`    | `string` (ISO 8601)                               | Yes      | Event timestamp               |
| `session_id`   | `string`                                          | No       | Agent session that created it |

All fields are validated with Zod on read. Malformed lines are skipped with a stderr warning.

### GitHub Bridge

The GitHub bridge syncs local tasks to GitHub issues:

- **Detection:** checks for `gh` CLI with `gh auth status`. Falls back to `local-only` mode if unavailable.
- **Sync scope:** only creates issues with the `reagent:` label. Never imports all repository issues.
- **Rate limiting:** 300-second cooldown between sync operations.
- **Conflict resolution:** local JSONL is the source of truth; GitHub is the display layer.
- **Auto-close:** when a task is marked completed and has a linked `github_issue`, the corresponding issue is closed via `gh issue close`.

### MCP Tools

The 9 native tools are registered directly on the gateway and go through the full middleware chain:

```
task_create       — Create a task: title (required), description, urgency, phase, milestone, assignee, parent_id
task_update       — Update a task: id (required), type (started|completed|blocked|cancelled), plus any updatable fields
task_list         — List tasks: optional filters for status, urgency, phase
task_get          — Get one task by ID (T-NNN format)
task_delete       — Soft-delete (cancelled event) a task by ID
task_sync_github  — Trigger GitHub issue sync (requires gh CLI)
repo_scaffold     — Set GitHub repo description, topics, labels, and milestones
project_sync      — Sync tasks to a GitHub Project board
discord_notify    — Send a notification to a configured Discord channel
```

### Slash Commands

| Command      | Description                                                      |
| ------------ | ---------------------------------------------------------------- |
| `/tasks`     | Render a markdown table of current tasks from tasks.jsonl        |
| `/plan-work` | Invoke the product-owner agent to propose tasks for a goal       |
| `/restart`   | Session handoff command for agent continuity                     |
| `/rea`       | Invoke the REA (Reactive Execution Agent) for team orchestration |

## Config Scaffolder

`reagent init` configures your repository with:

- **Git hooks** — commit-msg validation, pre-commit checks, and pre-push quality gates (via Husky)
- **Cursor rules** — AI behavioral constraints for Cursor IDE (no-hallucination, verify-before-act, attribution)
- **Claude hooks** — 20 safety and quality hooks (see [Claude Code Hooks](#claude-code-hooks) section)
- **Claude settings** — permission boundaries for Claude Code (`.claude/settings.json`)
- **Policy file** — `.reagent/policy.yaml` with graduated autonomy levels
- **CLAUDE.md** — project-level AI agent instructions (managed block with markers)
- **Agent team** — 89 AI agent definitions installed to `.claude/agents/` (see [AGENTS.md](./AGENTS.md))
- **Commands** — `/restart`, `/rea`, `/tasks`, `/plan-work` slash commands
- **Gateway config** — `.reagent/gateway.yaml` template for MCP server configuration
- **Task store** — `.reagent/tasks.jsonl` (empty, gitignored) for project management

### What Gets Installed

| Path                         | Committed       | Purpose                              |
| ---------------------------- | --------------- | ------------------------------------ |
| `.reagent/policy.yaml`       | Yes             | Autonomy levels and agent policy     |
| `.reagent/gateway.yaml`      | Yes             | MCP gateway downstream server config |
| `.reagent/audit/`            | No (gitignored) | Hash-chained JSONL audit logs        |
| `.reagent/tasks.jsonl`       | No (gitignored) | Task event store                     |
| `.reagent/review-cache.json` | No (gitignored) | Review cache for quality gates       |
| `.cursor/rules/`             | Yes             | Cursor IDE behavioral rules          |
| `.husky/commit-msg`          | Yes             | Git commit message validation        |
| `.husky/pre-commit`          | Yes             | Pre-commit checks                    |
| `.husky/pre-push`            | Yes             | Pre-push quality gates               |
| `.claude/hooks/`             | No (gitignored) | Claude Code safety hooks             |
| `.claude/settings.json`      | No (gitignored) | Claude Code permissions              |
| `.claude/agents/`            | No (gitignored) | Agent team definitions (89 agents)   |
| `.claude/commands/`          | Yes             | Slash commands                       |
| `CLAUDE.md`                  | Yes             | AI agent project instructions        |

### Profiles

#### Base Profiles

| Profile             | Use Case                   | Default Autonomy | Blocked Paths                                       |
| ------------------- | -------------------------- | ---------------- | --------------------------------------------------- |
| `client-engagement` | Client consulting projects | L1 / max L2      | `.reagent/`, `.github/workflows/`, `.env`, `.env.*` |
| `bst-internal`      | BST's own repositories     | L1 / max L2      | `.reagent/`, `.env`                                 |

Both profiles install the full hook suite, quality gates, Cursor rules, and Claude commands.

#### Tech Stack Profiles

Tech stack profiles extend the base installation with domain-specific hooks and gates. Pass them with `--profile`:

| Profile  | Stack              | Extra Hooks                                           |
| -------- | ------------------ | ----------------------------------------------------- |
| `nextjs` | Next.js App Router | `server-component-drift.sh` — RSC boundary violations |
| `lit-wc` | Lit/Web Components | `shadow-dom-guard.sh`, `cem-integrity-gate.sh`        |
| `drupal` | Drupal CMS         | `drupal-coding-standards.sh`, `hook-update-guard.sh`  |
| `astro`  | Astro              | `astro-ssr-guard.sh` — SSR/static boundary violations |

Each tech profile also ships a `gates.yaml` (preflight checks for CI) and a recommended agent list.

```bash
# Install with a tech stack profile
npx @bookedsolid/reagent init --profile nextjs
npx @bookedsolid/reagent init --profile lit-wc
```

### Idempotent

Run `reagent init` as many times as you want. It skips files that are already up-to-date and only updates what has changed. Policy files are never overwritten if they already exist.

### Verify Installation

```bash
reagent check
```

## Agent Team

Reagent installs 89 AI agent definitions into `.claude/agents/` covering engineering, AI platforms, and project management roles. Each agent has:

- A domain-specific system prompt and tool access list
- Zero-trust protocol (read before writing, verify before claiming, HALT compliance)
- Persona metadata (name, inspiration) grounded in real domain pioneers

See **[AGENTS.md](./AGENTS.md)** for the full roster with descriptions.

Key agents available in every project:

| Agent                  | Role                                                                    |
| ---------------------- | ----------------------------------------------------------------------- |
| `reagent-orchestrator` | Team orchestrator — routes tasks to specialists, governs AI operations  |
| `product-owner`        | Task backlog management with built-in guardrails                        |
| `code-reviewer`        | Code review with TypeScript, accessibility, performance, security focus |
| `security-engineer`    | Application security, OWASP, penetration testing                        |
| `principal-engineer`   | Architecture decisions and cross-cutting concerns                       |

## Removing Reagent

To remove reagent from a project:

```bash
# Remove reagent-managed files
rm -rf .cursor/rules/ .claude/hooks/ .claude/settings.json .claude/agents/
rm -rf .claude/commands/restart.md .claude/commands/rea.md
rm -rf .claude/commands/tasks.md .claude/commands/plan-work.md
rm -rf .reagent/

# Remove the reagent-managed block from CLAUDE.md (between the marker comments)
# Then remove husky hooks if no longer needed:
rm -f .husky/commit-msg .husky/pre-commit .husky/pre-push
```

## Architecture

```
@bookedsolid/reagent
├── src/
│   ├── cli/                           # CLI entry point and commands
│   │   ├── index.ts                   # ESM entry point, routes to commands
│   │   ├── commands/
│   │   │   ├── init/                  # Modular init step-runner (14 steps)
│   │   │   │   ├── index.ts           # Step sequencer
│   │   │   │   ├── types.ts           # InstallResult, ProfileConfig
│   │   │   │   ├── gitignore.ts       # .gitignore entries
│   │   │   │   ├── cursor-rules.ts    # Cursor IDE rules
│   │   │   │   ├── husky-hooks.ts     # Git hooks (Husky)
│   │   │   │   ├── claude-hooks.ts    # Claude Code hooks + settings.json
│   │   │   │   ├── claude-md.ts       # CLAUDE.md template
│   │   │   │   ├── policy.ts          # policy.yaml generation
│   │   │   │   ├── gateway-config.ts  # gateway.yaml generation
│   │   │   │   ├── agents.ts          # Agent file installation
│   │   │   │   ├── commands.ts        # Slash command installation
│   │   │   │   ├── pm.ts             # Task store scaffolding
│   │   │   │   ├── profiles.ts        # Tech stack profile installer
│   │   │   │   ├── github.ts          # GitHub repo scaffolding (--github)
│   │   │   │   └── discord.ts         # Discord config (--discord)
│   │   │   ├── catalyze/              # Stack analyzer and gap detector
│   │   │   │   ├── index.ts           # --plan / --audit / --dry-run modes
│   │   │   │   ├── stack-analyzer.ts  # Detects project type from package.json
│   │   │   │   ├── gap-detector.ts    # Per-stack hook/gate/agent catalog
│   │   │   │   ├── report-generator.ts # Markdown + HTML report output
│   │   │   │   └── types.ts           # ProjectType, Gap, GapAnalysis
│   │   │   ├── cache.ts               # Review cache CLI (check/set/clear)
│   │   │   ├── check.ts               # Installation verification
│   │   │   ├── freeze.ts              # Kill switch (freeze/unfreeze)
│   │   │   └── serve.ts               # Gateway server launcher
│   │   └── utils.ts                   # Shared CLI utilities
│   ├── config/                        # Configuration loaders
│   │   ├── policy-loader.ts           # Zod-validated policy.yaml parser
│   │   ├── gateway-config.ts          # Zod-validated gateway.yaml parser
│   │   └── tier-map.ts               # Tool tier classification
│   ├── gateway/                       # MCP gateway core
│   │   ├── server.ts                  # Gateway orchestrator (startup, shutdown)
│   │   ├── client-manager.ts          # Downstream MCP server connections
│   │   ├── tool-proxy.ts              # Tool discovery, namespacing, registration
│   │   ├── native-tools.ts            # 9 first-party MCP tools
│   │   └── middleware/                # Middleware chain
│   │       ├── chain.ts               # Onion-style middleware executor
│   │       ├── session.ts             # Session ID attachment
│   │       ├── kill-switch.ts         # HALT file check
│   │       ├── tier.ts                # Tier classification
│   │       ├── policy.ts              # Autonomy level enforcement
│   │       ├── blocked-paths.ts       # Blocked path enforcement
│   │       ├── redact.ts              # Secret pattern redaction
│   │       └── audit.ts               # Hash-chained JSONL logging
│   ├── pm/                            # Project management layer
│   │   ├── types.ts                   # Zod task schema (single source of truth)
│   │   ├── task-store.ts              # JSONL event store with advisory locking
│   │   ├── github-bridge.ts           # GitHub CLI integration (issues + projects)
│   │   └── discord-notifier.ts        # Discord notification dispatch
│   └── types/                         # TypeScript type definitions
├── hooks/                             # Claude Code hook scripts (20 total)
│   ├── _lib/
│   │   └── common.sh                 # Shared hook library
│   ├── settings-protection.sh
│   ├── blocked-paths-enforcer.sh
│   ├── dangerous-bash-interceptor.sh
│   ├── secret-scanner.sh
│   ├── env-file-protection.sh
│   ├── attribution-advisory.sh
│   ├── symlink-guard.sh
│   ├── network-exfil-guard.sh
│   ├── import-guard.sh
│   ├── git-config-guard.sh
│   ├── ci-config-protection.sh
│   ├── commit-review-gate.sh
│   ├── push-review-gate.sh
│   ├── architecture-review-gate.sh
│   ├── dependency-audit-gate.sh
│   ├── task-link-gate.sh
│   ├── output-validation.sh
│   ├── file-size-guard.sh
│   └── rate-limit-guard.sh
├── profiles/                          # Init profiles
│   ├── client-engagement.json         # Base profile
│   ├── bst-internal.json             # Base profile
│   ├── nextjs/                        # Tech stack profile
│   │   ├── hooks/server-component-drift.sh
│   │   ├── gates.yaml
│   │   └── agents.txt
│   ├── lit-wc/                        # Tech stack profile
│   │   ├── hooks/{shadow-dom-guard,cem-integrity-gate}.sh
│   │   ├── gates.yaml
│   │   └── agents.txt
│   ├── drupal/                        # Tech stack profile
│   │   ├── hooks/{drupal-coding-standards,hook-update-guard}.sh
│   │   ├── gates.yaml
│   │   └── agents.txt
│   └── astro/                         # Tech stack profile
│       ├── hooks/astro-ssr-guard.sh
│       ├── gates.yaml
│       └── agents.txt
├── agents/                            # 89 agent definitions (see AGENTS.md)
│   ├── product-owner.md
│   ├── reagent-orchestrator.md
│   ├── engineering/                   # 64 engineering specialist agents
│   └── ai-platforms/                  # 25 AI platform specialist agents
├── templates/                         # Template files for scaffolding
├── husky/                             # Husky git hook scripts
├── cursor/                            # Cursor IDE rules
└── commands/                          # Claude slash commands
    ├── restart.md
    ├── rea.md
    ├── tasks.md
    └── plan-work.md
```

## Package Exports

```json
{
  ".": "types/index.js",
  "./config": "config/policy-loader.js",
  "./middleware": "gateway/middleware/chain.js"
}
```

## Requirements

- Node.js >= 22
- Git repository (for hooks and init)
- `jq` (for hook scripts that parse JSON)
- `gh` CLI (optional, for GitHub issue sync and repo scaffolding)

## Dependencies

3 runtime dependencies:

- `@modelcontextprotocol/sdk` — MCP client/server protocol
- `yaml` — YAML parsing for policy and gateway config
- `zod` — Schema validation for all configuration files

## Testing

```bash
pnpm test
```

462 tests across 41 test files covering:

- CLI commands (init step-runner, catalyze, cache, check, freeze, profiles)
- Middleware chain (session, kill-switch, tier, policy, blocked-paths, redact, audit)
- Tier classification (static map, convention-based, overrides)
- Policy enforcement (autonomy levels, blocked tools, max clamping)
- Secret redaction (AWS, GitHub, PEM, Discord, generic patterns)
- Hook scripts (all 20 hooks, including v0.6.0 additions)
- Project management (task store CRUD, event materialization, advisory locking, Discord notifier)
- End-to-end gateway smoke tests (native + proxied tools)

Quality gates (run via `pnpm preflight`):

1. Secret scan (gitleaks)
2. Format check (prettier)
3. Lint (eslint)
4. Type check (tsc --noEmit)
5. Tests (vitest)
6. Pack dry-run (npm pack)

## Scope

Reagent is a **local CLI tool** and **MCP gateway server**. It configures files in your repository and proxies MCP tool calls on your machine. It does not collect data, phone home, or operate as a hosted service.

## License

MIT
