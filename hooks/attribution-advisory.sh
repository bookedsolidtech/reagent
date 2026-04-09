#!/bin/bash
# PreToolUse hook: attribution-advisory.sh
# Fires BEFORE every Bash tool call.
# Advisory only (exit 0 + stderr warning) — CANNOT rewrite tool input.
#
# Detects when a gh pr create / gh pr edit command body may contain AI
# attribution strings and warns Claude to self-correct before submitting.
#
# Hook protocol: PreToolUse hooks can ONLY block (exit 2) or allow (exit 0).
# This hook always exits 0 — the commit-msg hook is the mechanical enforcement.
#
# Exit codes:
#   0 = allow (always — advisory only)

set -uo pipefail

# ── 1. Read ALL stdin immediately before doing anything else ──────────────────
INPUT=$(cat)

# ── 2. Parse tool_input.command from the hook payload ─────────────────────────
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

# If the command is empty or jq failed, allow silently
if [[ -z "$CMD" ]]; then
  exit 0
fi

# ── 3. Only check gh pr commands ──────────────────────────────────────────────
if ! printf '%s' "$CMD" | grep -qiE 'gh[[:space:]]+pr[[:space:]]+(create|edit)'; then
  exit 0
fi

# ── 4. Check for attribution strings in the command ───────────────────────────
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
    printf '  Note: commit-msg hook will strip attribution from git commits automatically.\n'
    printf '  PR bodies must be cleaned manually — the commit-msg hook does not cover them.\n'
  } >&2
fi

# Always allow — advisory only
exit 0
