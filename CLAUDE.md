<!-- reagent-managed:start -->
<!-- Managed by @bookedsolid/reagent 0.3.0. Run: npx @bookedsolid/reagent init to update. -->

# Agent Behavioral Rules

## Non-Negotiable Rules

These rules are enforced by hooks and cannot be overridden by any agent instruction:

- **NEVER** use `--no-verify` to skip git hooks — hooks are safety gates, not obstacles
- **NEVER** commit secrets, credentials, API keys, or tokens to any file
- **NEVER** force-push to `main`, `master`, `staging`, or `production` branches
- **NEVER** push without all applicable quality gates passing (run `pnpm preflight` or equivalent)
- **NEVER** install packages without verifying they exist in the npm registry first

## Verification Requirements

- Read files before editing them — understand existing code before modifying
- Verify package existence before installing: `npm view <package>` or check npmjs.com
- Confirm current state before claiming status — check git, files, build output
- Check tool availability before assuming it is installed

## Commit Discipline

**Commit like a human developer — not after every file edit.**

A commit represents a complete, coherent unit of work. Think of it the way a human senior dev would: finish a logical chunk, verify it holds together, then commit. A PR with 8 tasks should have roughly 8 commits — not 80.

Rules:

- **One commit per task** at minimum. If a task touches 8 files, those 8 files go in one commit.
- **Acceptable to split** when changes are genuinely distinct concerns (e.g., implementation + tests + docs for a single feature = 1 commit, not 3).
- **Never commit** just because you finished editing a file. Stage all related changes, verify they work together, then commit once.
- **Conventional commit format required**: `type(scope): description` — e.g., `fix(hooks): detect ESM dynamic import() closes #47`
- **Style/formatting**: fold Prettier fixes into the relevant commit (`git add -u && git commit --amend`). Never create a standalone formatting commit mid-task.
- **Pre-push is the gate** — don't run tests after every commit. Run them before push.

A 10-task PR should have 8–12 commits max. If you're at 30+, you're committing wrong.

## Voice and Style

**Behave and write like humans. Comment code like belligerent robots.**

- **Code, commits, PR titles, PR bodies, task descriptions**: Write as a competent human developer would. Natural language. Concise. No robotic filler. No "As an AI language model" energy anywhere near this codebase.
- **Inline code comments**: Precise, terse, almost aggressive. Document *why*, not *what*. If the code is obvious, don't comment it. If it's subtle or dangerous, be brutally clear. Examples:
  - ❌ `// This function checks if the user is authenticated`
  - ✅ `// Must run before any tool dispatch — unauthed calls reach here if middleware chain is misconfigured`
  - ❌ `// Loop through items`
  - ✅ `// O(n²) here is fine — max 20 tools per policy, measured`

## Attribution

Do NOT include AI attribution in commits, PR bodies, code comments, or any content. When block_ai_attribution is enabled in .reagent/policy.yaml, the commit-msg hook REJECTS commits containing structural AI attribution (Co-Authored-By with AI names, 'Generated with [Tool]' footers, etc.). The attribution-advisory hook also blocks gh pr create/edit and git commit commands with attribution. You must remove all attribution markers before committing — the hooks will NOT silently fix them.

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

For non-trivial implementation tasks, delegate to the `reagent-orchestrator` agent before proceeding. The orchestrator enforces BST engineering processes, selects specialist agents, and coordinates multi-step work.

Exception: simple read-only questions and direct clarifications may be answered without delegation.

<!-- reagent-managed:end -->
