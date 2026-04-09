#!/bin/bash
# PreToolUse hook: settings-protection.sh
# Fires BEFORE every Write or Edit tool call.
# Blocks modifications to critical configuration files that, if tampered with,
# would disable the entire hook safety layer.
#
# Protected paths:
#   .claude/settings.json       — hook configuration
#   .claude/settings.local.json — local hook overrides
#   .claude/hooks/*             — hook scripts themselves
#   .husky/*                    — git hook scripts
#   .reagent/policy.yaml        — autonomy/blocking policy
#   .reagent/HALT               — kill switch file
#   .reagent/review-cache.json  — review cache (integrity-sensitive)
#
# Exit codes:
#   0 = allow (path not protected)
#   2 = block (protected path modification attempt)

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

# ── 4. Extract file path from payload ─────────────────────────────────────────
FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

# ── 5. Normalize path for comparison ──────────────────────────────────────────
# Convert to relative path from project root for consistent matching
normalize_path() {
  local p="$1"
  local root="$REAGENT_ROOT"

  # Strip project root prefix if present
  if [[ "$p" == "$root"/* ]]; then
    p="${p#$root/}"
  fi

  # URL decode common sequences
  p=$(printf '%s' "$p" | sed 's/%2[Ff]/\//g; s/%2[Ee]/./g; s/%20/ /g')

  # Collapse path traversals
  # Remove ./ components
  p=$(printf '%s' "$p" | sed 's|\./||g')

  # Remove leading ./
  p="${p#./}"

  printf '%s' "$p"
}

NORMALIZED=$(normalize_path "$FILE_PATH")

# ── 6. Protected path patterns ────────────────────────────────────────────────
PROTECTED_PATTERNS=(
  '.claude/settings.json'
  '.claude/settings.local.json'
  '.claude/hooks/'
  '.husky/'
  '.reagent/policy.yaml'
  '.reagent/HALT'
  '.reagent/review-cache.json'
)

for pattern in "${PROTECTED_PATTERNS[@]}"; do
  # Exact match
  if [[ "$NORMALIZED" == "$pattern" ]]; then
    {
      printf 'SETTINGS PROTECTION: Modification blocked\n'
      printf '\n'
      printf '  File: %s\n' "$FILE_PATH"
      printf '  Rule: This file is protected from agent modification.\n'
      printf '\n'
      printf '  Protected files include hook scripts, settings, policy,\n'
      printf '  and kill switch files. These must be modified by humans\n'
      printf '  via reagent CLI or direct editing.\n'
      printf '\n'
      printf '  Use: reagent init (to update hooks/settings)\n'
      printf '       reagent freeze/unfreeze (for HALT file)\n'
      printf '       Edit .reagent/policy.yaml manually\n'
    } >&2
    exit 2
  fi

  # Directory prefix match (patterns ending in /)
  if [[ "$pattern" == */ ]] && [[ "$NORMALIZED" == "$pattern"* ]]; then
    {
      printf 'SETTINGS PROTECTION: Modification blocked\n'
      printf '\n'
      printf '  File: %s\n' "$FILE_PATH"
      printf '  Rule: Files under %s are protected from agent modification.\n' "$pattern"
      printf '\n'
      printf '  These files control the hook safety layer and must be\n'
      printf '  modified by humans via reagent CLI or direct editing.\n'
    } >&2
    exit 2
  fi
done

# ── 7. Case-insensitive fallback check ────────────────────────────────────────
# Catch case-manipulation bypass attempts (e.g., .Claude/Settings.json)
LOWER_NORM=$(printf '%s' "$NORMALIZED" | tr '[:upper:]' '[:lower:]')
for pattern in "${PROTECTED_PATTERNS[@]}"; do
  LOWER_PATTERN=$(printf '%s' "$pattern" | tr '[:upper:]' '[:lower:]')
  if [[ "$LOWER_NORM" == "$LOWER_PATTERN" ]]; then
    {
      printf 'SETTINGS PROTECTION: Modification blocked (case-insensitive match)\n'
      printf '\n'
      printf '  File: %s\n' "$FILE_PATH"
      printf '  Matched: %s\n' "$pattern"
    } >&2
    exit 2
  fi
  if [[ "$LOWER_PATTERN" == */ ]] && [[ "$LOWER_NORM" == "$LOWER_PATTERN"* ]]; then
    {
      printf 'SETTINGS PROTECTION: Modification blocked (case-insensitive match)\n'
      printf '\n'
      printf '  File: %s\n' "$FILE_PATH"
      printf '  Matched: %s*\n' "$pattern"
    } >&2
    exit 2
  fi
done

exit 0
