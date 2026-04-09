# @bookedsolid/reagent

Zero-trust agentic infrastructure for AI-assisted development.

Reagent installs safety hooks, behavioral policies, and developer tooling into any project — enforcing zero-trust principles across AI agent operations.

## What It Does

`reagent init` configures your repository with:

- **Git hooks** — commit-msg validation (Co-Authored-By attribution, secret detection) and pre-push quality gates
- **Cursor rules** — AI behavioral constraints for Cursor IDE
- **Claude hooks** — dangerous command interception, env file protection, secret scanning
- **Claude settings** — permission boundaries for Claude Code
- **Policy file** — `.reagent/policy.yaml` with graduated autonomy levels (L0-L3)
- **CLAUDE.md** — project-level AI agent instructions
- **Commands** — `/restart` (session handoff) and `/rea` (AI team orchestration)

## Quick Start

```bash
npx @bookedsolid/reagent init
```

### With a profile

```bash
# For BST internal projects
npx @bookedsolid/reagent init --profile bst-internal

# For client engagements
npx @bookedsolid/reagent init --profile client-engagement
```

### Verify installation

```bash
npx @bookedsolid/reagent check
```

### Dry run (preview without changes)

```bash
npx @bookedsolid/reagent init --dry-run
```

## Commands

| Command                         | Description                                            |
| ------------------------------- | ------------------------------------------------------ |
| `reagent init`                  | Install reagent config into the current directory      |
| `reagent check`                 | Verify what reagent components are installed           |
| `reagent freeze --reason "..."` | Create `.reagent/HALT` — suspends all agent operations |
| `reagent unfreeze`              | Remove `.reagent/HALT` — resumes agent operations      |
| `reagent help`                  | Show usage help                                        |

### Kill switch

Freeze halts all Claude Code hooks immediately. Every hook checks for `.reagent/HALT` before executing — when present, all tool calls are blocked.

```bash
# Emergency stop
npx @bookedsolid/reagent freeze --reason "security incident"

# Resume
npx @bookedsolid/reagent unfreeze
```

## Profiles

| Profile             | Use Case                   | Hooks                             |
| ------------------- | -------------------------- | --------------------------------- |
| `bst-internal`      | BST's own repositories     | Full hook suite + Claude commands |
| `client-engagement` | Client consulting projects | Full hook suite + Claude commands |

## Idempotent

Run `reagent init` as many times as you want. It skips files that are already up-to-date and only updates what has changed.

## What Gets Installed

| Path                    | Committed       | Purpose                          |
| ----------------------- | --------------- | -------------------------------- |
| `.cursor/rules/`        | Yes             | Cursor IDE behavioral rules      |
| `.husky/commit-msg`     | Yes             | Git commit message validation    |
| `.claude/hooks/`        | No (gitignored) | Claude Code safety hooks         |
| `.claude/settings.json` | No (gitignored) | Claude Code permissions          |
| `.claude/commands/`     | Yes             | Slash commands (restart, rea)    |
| `.reagent/policy.yaml`  | Yes             | Autonomy levels and agent policy |
| `CLAUDE.md`             | Yes             | AI agent project instructions    |

## Removing Reagent

To remove reagent from a project, delete the installed files:

```bash
# Remove reagent-managed files
rm -rf .cursor/rules/ .claude/hooks/ .claude/settings.json .claude/agents/
rm -rf .claude/commands/restart.md .claude/commands/rea.md
rm -rf .reagent/

# Remove the reagent-managed block from CLAUDE.md (between the marker comments)
# Then remove husky hooks if no longer needed:
rm -f .husky/commit-msg .husky/pre-commit .husky/pre-push
```

## Scope

Reagent is a **local CLI tool**. It configures files in your repository and runs entirely on your machine. It does not collect data, phone home, or operate as a hosted service.

## Requirements

- Node.js >= 22
- Git repository

## License

MIT
