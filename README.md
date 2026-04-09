# @bookedsolid/reagent

Zero-trust MCP gateway and agentic infrastructure for AI-assisted development.

Reagent is two things:

1. **MCP Gateway** (`reagent serve`) — a proxy server that sits between your AI assistant (Claude Code, Cursor, etc.) and downstream MCP tool servers. Every tool call flows through a zero-trust middleware chain: policy enforcement, tier classification, secret redaction, and hash-chained audit logging.

2. **Config Scaffolder** (`reagent init`) — installs safety hooks, behavioral policies, and developer tooling into any project.

## Why Reagent?

AI coding assistants are powerful but unconstrained. Reagent adds the missing governance layer:

- **Policy enforcement** — graduated autonomy levels (L0 read-only → L3 full access) control which tiers of tools an agent can invoke
- **Kill switch** — `reagent freeze` immediately blocks all tool calls across every connected MCP server
- **Secret redaction** — tool outputs are scanned for AWS keys, GitHub tokens, API keys, PEM private keys, Discord tokens, and more — redacted before they reach the AI
- **Audit trail** — every tool invocation is logged as hash-chained JSONL, providing tamper-evident compliance records
- **Tool blocking** — individual tools can be permanently blocked regardless of autonomy level

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
      "command": "reagent",
      "args": ["serve"]
    }
  }
}
```

All downstream tool calls now flow through Reagent's middleware chain.

### As a Config Scaffolder

```bash
npx @bookedsolid/reagent init

# With a profile
npx @bookedsolid/reagent init --profile bst-internal
npx @bookedsolid/reagent init --profile client-engagement

# Preview without changes
npx @bookedsolid/reagent init --dry-run
```

## Commands

| Command                         | Description                                       |
| ------------------------------- | ------------------------------------------------- |
| `reagent serve`                 | Start the MCP gateway server (stdio transport)    |
| `reagent init`                  | Install reagent config into the current directory |
| `reagent check`                 | Verify what reagent components are installed      |
| `reagent freeze --reason "..."` | Create `.reagent/HALT` — suspends all tool calls  |
| `reagent unfreeze`              | Remove `.reagent/HALT` — resumes tool calls       |
| `reagent help`                  | Show usage help                                   |

## MCP Gateway

### How It Works

```
AI Assistant (Claude Code, Cursor, etc.)
    │
    │  stdio (MCP protocol)
    ▼
┌─────────────────────────────┐
│       Reagent Gateway       │
│                             │
│  ┌───────────────────────┐  │
│  │   Middleware Chain     │  │
│  │                       │  │
│  │  1. Audit (outermost) │  │
│  │  2. Session context   │  │
│  │  3. Kill switch       │  │
│  │  4. Tier classify     │  │
│  │  5. Policy enforce    │  │
│  │  6. Secret redaction  │  │
│  │  7. [Execute]         │  │
│  └───────────────────────┘  │
│                             │
└──────────┬──────────────────┘
           │  stdio (MCP protocol)
           ▼
    Downstream MCP Servers
    (discord-ops, filesystem, etc.)
```

The gateway:

1. Connects to all downstream MCP servers defined in `.reagent/gateway.yaml`
2. Discovers their tools via MCP `tools/list`
3. Re-registers each tool on the gateway with namespace prefixes (`servername__toolname`)
4. Wraps every tool call in the middleware chain
5. Listens on stdio for incoming MCP requests from the AI assistant

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

**Environment variable resolution:** Use `${VAR_NAME}` syntax in env values — Reagent resolves them from `process.env` at startup.

**Tool overrides:** Each downstream tool can be assigned a tier (`read`, `write`, `destructive`) and optionally blocked entirely.

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

Records every invocation — including denials — as a hash-chained JSONL entry. Written to `.reagent/audit/YYYY-MM-DD.jsonl`. Each record contains:

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

The `prev_hash` field chains records together — tamper with one record and every subsequent hash becomes invalid.

### 2. Session Context

Attaches a unique session ID (UUID) to every invocation. Each gateway instance generates one session ID at startup.

### 3. Kill Switch

Checks for `.reagent/HALT` file. If present, the invocation is immediately denied. The HALT file contents become the denial reason.

```bash
# Emergency stop — all tool calls blocked immediately
reagent freeze --reason "security incident at 2026-04-09T12:00:00Z"

# Resume
reagent unfreeze
```

### 4. Tier Classification

Classifies the tool into one of three tiers:

| Tier          | Description                     | Examples                                         |
| ------------- | ------------------------------- | ------------------------------------------------ |
| `read`        | Observes state, no side effects | `get_messages`, `list_channels`, `health_check`  |
| `write`       | Modifies state                  | `send_message`, `create_channel`, `edit_message` |
| `destructive` | Irreversible state changes      | `delete_channel`, `purge_messages`, `ban_member` |

Tiers are assigned via `tool_overrides` in gateway config. Unknown tools default to `write`.

### 5. Policy Enforcement

Checks the tool's tier against the project's autonomy level:

| Autonomy Level     | Allowed Tiers                    |
| ------------------ | -------------------------------- |
| `L0` (read-only)   | `read` only                      |
| `L1` (standard)    | `read` + `write`                 |
| `L2` (elevated)    | `read` + `write` + `destructive` |
| `L3` (full access) | All tiers                        |

Also checks for explicitly blocked tools — a tool marked `blocked: true` in gateway config is denied regardless of autonomy level.

### 6. Secret Redaction

Post-execution: scans tool output for sensitive patterns and replaces them with `[REDACTED]`:

- AWS Access Keys (`AKIA...`)
- AWS Secret Keys
- GitHub Tokens (`ghp_...`, `gho_...`, `ghs_...`, `ghu_...`, `ghr_...`)
- Generic API Keys
- Bearer Tokens
- PEM Private Keys
- Discord Bot Tokens
- Base64-encoded AWS Keys

Redaction operates on individual string values within structured results — it never corrupts JSON structure.

### Security Invariants

- **Denial is permanent** — once any middleware denies an invocation, no subsequent middleware can revert it
- **Audit records everything** — audit is outermost, so even kill-switch denials are recorded
- **Policy re-derives tier** — never trusts mutable context; always re-classifies from tool name
- **Fail-closed** — errors in kill-switch or policy checks result in denial, not passthrough
- **All logging to stderr** — stdout is reserved for the MCP stdio transport

## Policy File

`.reagent/policy.yaml` controls agent behavior:

```yaml
version: '1'
profile: bst-internal
installed_by: 'reagent init'
installed_at: '2026-04-09T00:00:00.000Z'
autonomy_level: L1
max_autonomy_level: L3
promotion_requires_human_approval: true
blocked_paths:
  - .github/workflows/
  - .env
notification_channel: '#reagent-alerts'
```

| Field                               | Description                                                   |
| ----------------------------------- | ------------------------------------------------------------- |
| `autonomy_level`                    | Current level (L0-L3) — controls which tool tiers are allowed |
| `max_autonomy_level`                | Ceiling — agents cannot request escalation beyond this        |
| `promotion_requires_human_approval` | Whether level changes need human sign-off                     |
| `blocked_paths`                     | Directories the agent must never modify                       |

## Config Scaffolder

`reagent init` configures your repository with:

- **Git hooks** — commit-msg validation (Co-Authored-By attribution, secret detection) and pre-push quality gates
- **Cursor rules** — AI behavioral constraints for Cursor IDE
- **Claude hooks** — dangerous command interception, env file protection, secret scanning
- **Claude settings** — permission boundaries for Claude Code
- **Policy file** — `.reagent/policy.yaml` with graduated autonomy levels
- **CLAUDE.md** — project-level AI agent instructions
- **Commands** — `/restart` (session handoff) and `/rea` (AI team orchestration)

### What Gets Installed

| Path                    | Committed       | Purpose                              |
| ----------------------- | --------------- | ------------------------------------ |
| `.reagent/policy.yaml`  | Yes             | Autonomy levels and agent policy     |
| `.reagent/gateway.yaml` | Yes             | MCP gateway downstream server config |
| `.reagent/audit/`       | No (gitignored) | Hash-chained JSONL audit logs        |
| `.cursor/rules/`        | Yes             | Cursor IDE behavioral rules          |
| `.husky/commit-msg`     | Yes             | Git commit message validation        |
| `.claude/hooks/`        | No (gitignored) | Claude Code safety hooks             |
| `.claude/settings.json` | No (gitignored) | Claude Code permissions              |
| `.claude/commands/`     | Yes             | Slash commands (restart, rea)        |
| `CLAUDE.md`             | Yes             | AI agent project instructions        |

### Profiles

| Profile             | Use Case                   | Hooks                             |
| ------------------- | -------------------------- | --------------------------------- |
| `bst-internal`      | BST's own repositories     | Full hook suite + Claude commands |
| `client-engagement` | Client consulting projects | Full hook suite + Claude commands |

### Idempotent

Run `reagent init` as many times as you want. It skips files that are already up-to-date and only updates what has changed.

### Verify Installation

```bash
reagent check
```

## Removing Reagent

To remove reagent from a project:

```bash
# Remove reagent-managed files
rm -rf .cursor/rules/ .claude/hooks/ .claude/settings.json .claude/agents/
rm -rf .claude/commands/restart.md .claude/commands/rea.md
rm -rf .reagent/

# Remove the reagent-managed block from CLAUDE.md (between the marker comments)
# Then remove husky hooks if no longer needed:
rm -f .husky/commit-msg .husky/pre-commit .husky/pre-push
```

## Architecture

```
@bookedsolid/reagent
├── src/
│   ├── cli/                    # CLI entry point and commands
│   │   ├── index.ts            # ESM entry point, routes to commands
│   │   ├── commands/           # init, check, freeze, unfreeze, serve
│   │   └── utils.ts            # Shared CLI utilities
│   ├── config/                 # Configuration loaders
│   │   ├── policy-loader.ts    # Zod-validated policy.yaml parser
│   │   ├── gateway-config.ts   # Zod-validated gateway.yaml parser
│   │   └── tier-map.ts         # Tool tier classification
│   ├── gateway/                # MCP gateway core
│   │   ├── server.ts           # Gateway orchestrator (startup, shutdown)
│   │   ├── client-manager.ts   # Downstream MCP server connections
│   │   ├── tool-proxy.ts       # Tool discovery, namespacing, registration
│   │   └── middleware/         # Middleware chain
│   │       ├── chain.ts        # Onion-style middleware executor
│   │       ├── session.ts      # Session ID attachment
│   │       ├── kill-switch.ts  # HALT file check
│   │       ├── tier.ts         # Tier classification
│   │       ├── policy.ts       # Autonomy level enforcement
│   │       ├── redact.ts       # Secret pattern redaction
│   │       └── audit.ts        # Hash-chained JSONL logging
│   └── types/                  # TypeScript type definitions
├── profiles/                   # Init profiles (bst-internal, client-engagement)
├── templates/                  # Template files for scaffolding
├── hooks/                      # Git hook scripts
├── cursor/                     # Cursor IDE rules
└── agents/                     # Agent definitions
```

## Requirements

- Node.js >= 22
- Git repository

## Scope

Reagent is a **local CLI tool** and **MCP gateway server**. It configures files in your repository and proxies MCP tool calls on your machine. It does not collect data, phone home, or operate as a hosted service.

## License

MIT
