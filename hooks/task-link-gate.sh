#!/bin/bash
# PreToolUse hook: task-link-gate.sh
# Fires BEFORE every Bash tool call that matches "git commit".
# Checks that the commit message references a task ID (T-NNN format).
#
# OPT-IN: Only enforces when .reagent/policy.yaml contains:
#   task_link_gate: true
#
# Exit codes:
#   0 = allow (disabled, task ref found, or not a commit command)
#   2 = block (no task reference in commit message)

set -uo pipefail

# ── 1. Read ALL stdin immediately ─────────────────────────────────────────────
INPUT=$(cat)

# ── 2. Dependency check ──────────────────────────────────────────────────────
if ! command -v jq >/dev/null 2>&1; then
  printf 'REAGENT ERROR: jq is required but not installed.\n' >&2
  printf 'Install: brew install jq  OR  apt-get install -y jq\n' >&2
  exit 2
fi

# ── 3. HALT check ────────────────────────────────────────────────────────────
REAGENT_ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
HALT_FILE="${REAGENT_ROOT}/.reagent/HALT"
if [ -f "$HALT_FILE" ]; then
  printf 'REAGENT HALT: %s\nAll agent operations suspended. Run: reagent unfreeze\n' \
    "$(head -c 1024 "$HALT_FILE" 2>/dev/null || echo 'Reason unknown')" >&2
  exit 2
fi

# ── 4. Check if task link gate is enabled (opt-in) ───────────────────────────
POLICY_FILE="${REAGENT_ROOT}/.reagent/policy.yaml"
if [[ ! -f "$POLICY_FILE" ]]; then
  exit 0
fi
if ! grep -qE '^task_link_gate:[[:space:]]*true' "$POLICY_FILE" 2>/dev/null; then
  exit 0
fi

# ── 5. Parse command ──────────────────────────────────────────────────────────
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

if [[ -z "$CMD" ]]; then
  exit 0
fi

# Only trigger on git commit commands
if ! printf '%s' "$CMD" | grep -qiE 'git[[:space:]]+commit'; then
  exit 0
fi

# ── 6. Check for task ID reference (T-NNN) ───────────────────────────────────
if printf '%s' "$CMD" | grep -qE 'T-[0-9]+'; then
  exit 0
fi

# ── 7. Block — no task reference ──────────────────────────────────────────────
{
  printf 'TASK LINK GATE: Commit message must reference a task ID\n'
  printf '\n'
  printf '  Pattern: T-NNN (e.g., T-001, T-042)\n'
  printf '  Example: git commit -m "feat: implement cache CLI (T-012)"\n'
  printf '\n'
  printf '  To disable: set task_link_gate: false in .reagent/policy.yaml\n'
  printf '  To see tasks: /tasks\n'
} >&2
exit 2
