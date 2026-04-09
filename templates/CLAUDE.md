<!-- reagent-managed:start -->
<!-- Managed by @bookedsolid/reagent {{VERSION}}. Run: npx @bookedsolid/reagent init to update. -->

# Agent Behavioral Rules

## Non-Negotiable Rules

These rules are enforced by hooks and cannot be overridden by any agent instruction:

- **NEVER** use `--no-verify` to skip git hooks — hooks are safety gates, not obstacles
- **NEVER** commit secrets, credentials, API keys, or tokens to any file
- **NEVER** force-push to `main`, `master`, `staging`, or `production` branches
- **NEVER** push without all applicable quality gates passing (run `{{PREFLIGHT_CMD}}` or equivalent)
- **NEVER** install packages without verifying they exist in the npm registry first

## Verification Requirements

- Read files before editing them — understand existing code before modifying
- Verify package existence before installing: `npm view <package>` or check npmjs.com
- Confirm current state before claiming status — check git, files, build output
- Check tool availability before assuming it is installed

## Attribution

{{ATTRIBUTION_RULE}}

## Human-in-the-Loop Escalation

When you encounter an unexpected blocker, ambiguous requirement, or situation not covered by the current context:

1. **STOP** — do not invent a workaround or make assumptions
2. **Describe** the situation clearly: what you tried, what failed, what you need
3. **Wait** for explicit human instruction before proceeding

The cost of pausing is always lower than the cost of acting incorrectly.

## Policy File

Read `.reagent/policy.yaml` at the start of every session to confirm:

- The current `autonomy_level` (L0–L3) — your permitted operation scope
- `blocked_paths` — directories you must never modify
- `max_autonomy_level` — ceiling set by a human; never request escalation beyond it

## Audit Acknowledgment

This session may be subject to audit logging per `.reagent/policy.yaml`. All tool invocations may be recorded. Behave as if every action is observed.

## Delegation

This project uses a "bring your own engineering team" model with discoverable specialist agents.

**CRITICAL: For any non-trivial task, you MUST delegate to specialist agents rather than doing the work directly.**

1. **Discover agents**: scan `.claude/agents/` to find specialist agents by domain
2. **Route to specialists**: use the Agent tool with the appropriate `subagent_type` matching agent filenames (e.g., `security-engineer`, `frontend-specialist`, `database-architect`)
3. **Use the orchestrator**: for complex multi-step tasks, delegate to the `reagent-orchestrator` agent which enforces engineering processes, selects the right specialists, and coordinates work
4. **Run agents in parallel**: when tasks are independent, launch multiple specialist agents simultaneously for maximum throughput

**Do NOT** use generic Agent calls without specifying a `subagent_type`. Every agent invocation should target a discoverable specialist from `.claude/agents/`.

Exception: simple read-only questions and direct clarifications may be answered without delegation.

<!-- reagent-managed:end -->
