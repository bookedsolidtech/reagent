# @bookedsolid/reagent

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
