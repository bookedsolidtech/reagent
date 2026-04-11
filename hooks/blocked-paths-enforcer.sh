#!/bin/bash
# PreToolUse hook: blocked-paths-enforcer.sh
# Fires BEFORE every Write or Edit tool call.
# Reads blocked_paths from .reagent/policy.yaml and blocks matching writes.
#
# This enforces the policy layer at the hook level — even if an agent ignores
# the CLAUDE.md rules or skips the orchestrator, the hook will catch it.
#
# Exit codes:
#   0 = allow (path not blocked)
#   2 = block (path matches a blocked_paths entry)

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

# ── 5. Load blocked_paths from policy ─────────────────────────────────────────
POLICY_FILE="${REAGENT_ROOT}/.reagent/policy.yaml"

if [[ ! -f "$POLICY_FILE" ]]; then
  exit 0
fi

# Parse blocked_paths using grep + sed (avoid yaml parser dependency)
# Handles both inline array [] and block sequence - "..." formats
BLOCKED_PATHS=()
IN_BLOCK=0
while IFS= read -r line; do
  # Check if we're entering blocked_paths section
  if printf '%s' "$line" | grep -qE '^blocked_paths:'; then
    # Check for inline empty array
    if printf '%s' "$line" | grep -qE 'blocked_paths:[[:space:]]*\[\]'; then
      break
    fi
    # Check for inline array with values
    if printf '%s' "$line" | grep -qE 'blocked_paths:[[:space:]]*\['; then
      # Extract inline array items
      items=$(printf '%s' "$line" | sed 's/.*\[//; s/\].*//; s/,/ /g')
      for item in $items; do
        cleaned=$(printf '%s' "$item" | sed "s/^[[:space:]]*[\"']//; s/[\"'][[:space:]]*$//")
        if [[ -n "$cleaned" ]]; then
          BLOCKED_PATHS+=("$cleaned")
        fi
      done
      break
    fi
    IN_BLOCK=1
    continue
  fi

  if [[ $IN_BLOCK -eq 1 ]]; then
    # Block sequence items start with "  - "
    if printf '%s' "$line" | grep -qE '^[[:space:]]+-'; then
      cleaned=$(printf '%s' "$line" | sed 's/^[[:space:]]*-[[:space:]]*//; s/^"//; s/"$//; s/^'"'"'//; s/'"'"'$//')
      if [[ -n "$cleaned" ]]; then
        BLOCKED_PATHS+=("$cleaned")
      fi
    else
      # Non-indented line means we've left the block
      break
    fi
  fi
done < "$POLICY_FILE"

if [[ ${#BLOCKED_PATHS[@]} -eq 0 ]]; then
  exit 0
fi

# ── 6. Agent-writable allowlist ───────────────────────────────────────────────
# These paths under .reagent/ must always be writable by agents regardless of
# what blocked_paths says. Blocking the whole .reagent/ directory in policy
# is a common default, but tasks.jsonl is the PM data store — agents must
# write there. Settings-protection.sh guards the sensitive files explicitly.
AGENT_WRITABLE=(
  '.reagent/tasks.jsonl'
  '.reagent/audit/'
)

normalize_path() {
  local p="$1"
  local root="$REAGENT_ROOT"
  if [[ "$p" == "$root"/* ]]; then
    p="${p#$root/}"
  fi
  p=$(printf '%s' "$p" | sed 's/%2[Ff]/\//g; s/%2[Ee]/./g; s/%20/ /g')
  p="${p#./}"
  printf '%s' "$p"
}

NORMALIZED=$(normalize_path "$FILE_PATH")

for writable in "${AGENT_WRITABLE[@]}"; do
  if [[ "$NORMALIZED" == "$writable" ]] || [[ "$NORMALIZED" == "$writable"* && "$writable" == */ ]]; then
    exit 0
  fi
done

# ── 7. Match against blocked_paths ───────────────────────────────────────────
LOWER_NORM=$(printf '%s' "$NORMALIZED" | tr '[:upper:]' '[:lower:]')

for blocked in "${BLOCKED_PATHS[@]}"; do
  LOWER_BLOCKED=$(printf '%s' "$blocked" | tr '[:upper:]' '[:lower:]')

  # Directory match (blocked path ends with /)
  if [[ "$LOWER_BLOCKED" == */ ]]; then
    if [[ "$LOWER_NORM" == "$LOWER_BLOCKED"* ]] || [[ "$LOWER_NORM" == "${LOWER_BLOCKED%/}" ]]; then
      {
        printf 'BLOCKED PATH: Write denied by policy\n'
        printf '\n'
        printf '  File: %s\n' "$FILE_PATH"
        printf '  Blocked by: %s\n' "$blocked"
        printf '  Source: .reagent/policy.yaml → blocked_paths\n'
        printf '\n'
        printf '  This path is protected by policy. To modify it, a human must\n'
        printf '  either update blocked_paths in policy.yaml or edit the file directly.\n'
      } >&2
      exit 2
    fi
    continue
  fi

  # Glob pattern match (contains *)
  if [[ "$blocked" == *'*'* ]]; then
    # Convert glob to regex: . → \., * → .*
    regex=$(printf '%s' "$LOWER_BLOCKED" | sed 's/\./\\./g; s/\*/.*/g')
    if printf '%s' "$LOWER_NORM" | grep -qE "^${regex}$"; then
      {
        printf 'BLOCKED PATH: Write denied by policy\n'
        printf '\n'
        printf '  File: %s\n' "$FILE_PATH"
        printf '  Blocked by: %s (glob pattern)\n' "$blocked"
        printf '  Source: .reagent/policy.yaml → blocked_paths\n'
      } >&2
      exit 2
    fi
    continue
  fi

  # Exact match
  if [[ "$LOWER_NORM" == "$LOWER_BLOCKED" ]]; then
    {
      printf 'BLOCKED PATH: Write denied by policy\n'
      printf '\n'
      printf '  File: %s\n' "$FILE_PATH"
      printf '  Blocked by: %s\n' "$blocked"
      printf '  Source: .reagent/policy.yaml → blocked_paths\n'
    } >&2
    exit 2
  fi
done

exit 0
