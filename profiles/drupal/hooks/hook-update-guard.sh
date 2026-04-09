#!/bin/bash
# profiles/drupal/hooks/hook-update-guard.sh
# PostToolUse hook for Write — additional guard for hook_update_N patterns.
# Specifically watches .install files for update hooks that modify critical schema.
# Advisory only — exits 0 after printing warnings.

set -euo pipefail

HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
LIB="$HOOK_DIR/../../../hooks/_lib/common.sh"
if [[ -f "$LIB" ]]; then
  source "$LIB"
  check_halt
fi

INPUT=$(cat)
TOOL_NAME=$(printf '%s' "$INPUT" | grep -o '"tool_name":"[^"]*"' | head -1 | cut -d'"' -f4 2>/dev/null || echo "")
FILE_PATH=$(printf '%s' "$INPUT" | grep -o '"path":"[^"]*"' | head -1 | cut -d'"' -f4 2>/dev/null || echo "")

if [[ "$TOOL_NAME" != "Write" && "$TOOL_NAME" != "Edit" ]]; then
  exit 0
fi

# Only target .install files
case "$FILE_PATH" in
  *.install) ;;
  *) exit 0 ;;
esac

if [[ ! -f "$FILE_PATH" ]]; then
  exit 0
fi

CONTENT=$(cat "$FILE_PATH" 2>/dev/null || echo "")
WARNINGS=()

# Check: db_drop_table / db_drop_field without backup advisory
if printf '%s' "$CONTENT" | grep -qE 'db_drop_(table|field)\s*\('; then
  WARNINGS+=("DRUPAL SCHEMA: Destructive schema operation (db_drop_table/db_drop_field) detected in update hook. Ensure data migration or backup is handled before dropping. Consider using db_rename_table first if data needs preservation.")
fi

# Check: Multiple update hooks in single file (numbering gaps)
UPDATE_HOOKS=$(printf '%s' "$CONTENT" | grep -oE 'function [a-z_]+_update_([0-9]+)' | grep -oE '[0-9]+$' | sort -n || echo "")
if [[ -n "$UPDATE_HOOKS" ]]; then
  PREV=""
  while IFS= read -r num; do
    if [[ -n "$PREV" ]]; then
      EXPECTED=$((PREV + 1))
      if [[ "$num" -gt "$EXPECTED" ]]; then
        WARNINGS+=("DRUPAL SCHEMA: Gap detected in update hook numbering (after $PREV, next is $num). Verify this is intentional — gaps can confuse module update ordering.")
      fi
    fi
    PREV="$num"
  done <<< "$UPDATE_HOOKS"
fi

if [[ ${#WARNINGS[@]} -gt 0 ]]; then
  printf '\n[hook-update-guard] Advisory warnings for %s:\n' "$FILE_PATH" >&2
  for warning in "${WARNINGS[@]}"; do
    printf '  WARN: %s\n' "$warning" >&2
  done
  printf '\n' >&2
fi

exit 0
