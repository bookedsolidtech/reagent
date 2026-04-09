#!/bin/bash
# PostToolUse hook: architecture-review-gate.sh
# Fires AFTER every Write or Edit tool call.
# Lightweight advisory: flags when writing to architecture-sensitive paths.
# Does NOT block — only returns advisory context.
#
# Exit codes:
#   0 = always (advisory only, never blocks)

set -uo pipefail

# ── 1. Read ALL stdin immediately ─────────────────────────────────────────────
INPUT=$(cat)

# ── 2. Dependency check ──────────────────────────────────────────────────────
if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

# ── 3. HALT check ────────────────────────────────────────────────────────────
REAGENT_ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
HALT_FILE="${REAGENT_ROOT}/.reagent/HALT"
if [ -f "$HALT_FILE" ]; then
  printf 'REAGENT HALT: %s\nAll agent operations suspended. Run: reagent unfreeze\n' \
    "$(head -c 1024 "$HALT_FILE" 2>/dev/null || echo 'Reason unknown')" >&2
  exit 2
fi

# ── 4. Check if enabled ──────────────────────────────────────────────────────
POLICY_FILE="${REAGENT_ROOT}/.reagent/policy.yaml"
if [[ -f "$POLICY_FILE" ]]; then
  if grep -qE 'architecture_advisory:[[:space:]]*false' "$POLICY_FILE" 2>/dev/null; then
    exit 0
  fi
fi

# ── 5. Extract file path ─────────────────────────────────────────────────────
FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

# Normalize to relative path
if [[ "$FILE_PATH" == "$REAGENT_ROOT"/* ]]; then
  FILE_PATH="${FILE_PATH#$REAGENT_ROOT/}"
fi

# ── 6. Check architecture-sensitive paths ─────────────────────────────────────
ARCH_PATTERNS=(
  'src/types/'
  'src/gateway/'
  'src/config/'
  'src/cli/commands/init/'
  'hooks/_lib/'
  'templates/'
  'profiles/'
)

MATCHED=""
for pattern in "${ARCH_PATTERNS[@]}"; do
  if [[ "$FILE_PATH" == "$pattern"* ]]; then
    MATCHED="$pattern"
    break
  fi
done

if [[ -z "$MATCHED" ]]; then
  exit 0
fi

# ── 7. Advisory output ───────────────────────────────────────────────────────
{
  printf 'ARCHITECTURE ADVISORY: Sensitive path modified\n'
  printf '\n'
  printf '  File: %s\n' "$FILE_PATH"
  printf '  Category: %s\n' "$MATCHED"
  printf '\n'
  printf '  This file is in an architecture-sensitive directory.\n'
  printf '  Consider: Does this change maintain backward compatibility?\n'
  printf '  Consider: Should this be reviewed by the principal-engineer agent?\n'
} >&2

exit 0
