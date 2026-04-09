---
'@bookedsolid/reagent': minor
---

Quality gates, project management layer, and security hardening hooks

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
- Shared hook library: hooks/_lib/common.sh with reagent_root, check_halt, require_jq, json_output, triage_score

**Tests:** 309 total (up from 204)
