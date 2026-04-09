#!/bin/bash
# PostToolUse hook: ci-config-protection.sh
# Fires AFTER every Write tool call.
# Scans CI workflow files for dangerous permission or trust-boundary patterns.
# Advisory only (exit 0) — warns loudly but does not block.
#
# Triggers only when file_path matches .github/workflows/
#
# Patterns checked:
#   - permissions: write-all
#   - pull_request_target (trust escalation trigger)
#   - secrets: inherit
#
# Exit codes:
#   0 = OK (including advisory warnings — not blocking)

set -uo pipefail

INPUT=$(cat)

# ── Dependency check ──────────────────────────────────────────────────────────
if ! command -v jq >/dev/null 2>&1; then
  printf 'REAGENT ERROR: jq is required but not installed.\n' >&2
  printf 'Install: brew install jq  OR  apt-get install -y jq\n' >&2
  exit 2
fi

# ── HALT check ────────────────────────────────────────────────────────────────
REAGENT_ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
HALT_FILE="${REAGENT_ROOT}/.reagent/HALT"
if [ -f "$HALT_FILE" ]; then
  printf 'REAGENT HALT: %s\nAll agent operations suspended. Run: reagent unfreeze\n' \
    "$(head -c 1024 "$HALT_FILE" 2>/dev/null || echo 'Reason unknown')" >&2
  exit 2
fi

FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

# ── Only trigger for .github/workflows/ paths ─────────────────────────────────
if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

if [[ "$FILE_PATH" != *".github/workflows/"* ]]; then
  exit 0
fi

# ── Extract written content ───────────────────────────────────────────────────
CONTENT=$(printf '%s' "$INPUT" | jq -r '.tool_input.content // empty' 2>/dev/null)

if [[ -z "$CONTENT" ]]; then
  exit 0
fi

# ── Scan for dangerous CI patterns ───────────────────────────────────────────
WARNINGS=()

if printf '%s' "$CONTENT" | grep -qE 'permissions:[[:space:]]*write-all'; then
  WARNINGS+=("permissions: write-all — grants all GitHub Actions permissions (read+write). Scope to only required permissions.")
fi

if printf '%s' "$CONTENT" | grep -qE 'pull_request_target'; then
  WARNINGS+=("pull_request_target — runs with write permissions from the base repo in context of a PR. Dangerous if combined with checkout of PR head code.")
fi

if printf '%s' "$CONTENT" | grep -qE 'secrets:[[:space:]]*inherit'; then
  WARNINGS+=("secrets: inherit — passes all secrets to called workflow. Only use with trusted reusable workflows in the same org.")
fi

if [[ ${#WARNINGS[@]} -eq 0 ]]; then
  exit 0
fi

# ── Print advisory ────────────────────────────────────────────────────────────
{
  printf 'CI-CONFIG-PROTECTION: Potentially dangerous CI pattern in %s\n' "$(basename "$FILE_PATH")"
  for WARNING in "${WARNINGS[@]}"; do
    printf '  ADVISORY: %s\n' "$WARNING"
  done
  printf 'Note: This is advisory only. Review the workflow carefully before merging.\n'
  printf 'Reference: https://securitylab.github.com/research/github-actions-preventing-pwn-requests/\n'
} >&2

exit 0
