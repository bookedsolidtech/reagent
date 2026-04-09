#!/bin/bash
# PreToolUse hook: attribution-advisory.sh
# Fires BEFORE every Bash tool call.
# Advisory only (exit 0 + stderr warning) — CANNOT rewrite tool input.
#
# Detects when a gh pr create / gh pr edit command body may contain AI
# attribution strings and warns Claude to self-correct before submitting.
#
# Hook protocol: PreToolUse hooks can ONLY block (exit 2) or allow (exit 0).
# This hook exits 0 in advisory mode and exits 2 only when HALT is active.
# The commit-msg hook is the mechanical enforcement for git commits.
#
# Exit codes:
#   0 = allow (advisory mode — always, unless HALT is active)
#   2 = block (only when .reagent/HALT is present)

set -uo pipefail

# ── 1. Read ALL stdin immediately before doing anything else ──────────────────
INPUT=$(cat)

# ── 2. Dependency check ───────────────────────────────────────────────────────
if ! command -v jq >/dev/null 2>&1; then
  printf 'REAGENT ERROR: jq is required but not installed.\n' >&2
  printf 'Install: brew install jq  OR  apt-get install -y jq\n' >&2
  exit 2
fi

# ── 3. HALT check ─────────────────────────────────────────────────────────────
REAGENT_ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
HALT_FILE="${REAGENT_ROOT}/.reagent/HALT"
if [ -f "$HALT_FILE" ]; then
  printf 'REAGENT HALT: %s\nAll agent operations suspended. Run: reagent unfreeze\n' \
    "$(cat "$HALT_FILE" 2>/dev/null || echo 'Reason unknown')" >&2
  exit 2
fi

# ── 4. Parse tool_input.command from the hook payload ─────────────────────────
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

if [[ -z "$CMD" ]]; then
  exit 0
fi

# ── 5. Only check gh pr commands ──────────────────────────────────────────────
if ! printf '%s' "$CMD" | grep -qiE 'gh[[:space:]]+pr[[:space:]]+(create|edit)'; then
  exit 0
fi

# ── 6. Check for attribution strings in the command ───────────────────────────
FOUND_ATTRIBUTION=0

if printf '%s' "$CMD" | grep -qiE '(Co-Authored-By:[[:space:]]+Claude|Generated with Claude Code|claude\.ai|🤖[[:space:]]+Generated)'; then
  FOUND_ATTRIBUTION=1
fi

if [[ $FOUND_ATTRIBUTION -eq 1 ]]; then
  {
    printf 'ATTRIBUTION ADVISORY: gh pr command may include AI attribution strings.\n'
    printf '\n'
    printf '  Detected AI attribution pattern in gh pr create/edit command.\n'
    printf '  Review the PR body before proceeding — remove:\n'
    printf '    - Co-Authored-By: Claude ...\n'
    printf '    - Generated with Claude Code\n'
    printf '    - 🤖 Generated with ...\n'
    printf '    - claude.ai references\n'
    printf '\n'
    printf '  Note: commit-msg hook strips attribution from git commits automatically.\n'
    printf '  PR bodies must be cleaned manually — the commit-msg hook does not cover them.\n'
  } >&2
fi

# Always allow in advisory mode
exit 0
