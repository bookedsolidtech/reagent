#!/bin/bash
# PreToolUse hook: file-size-guard.sh
# Fires BEFORE every Write or Edit tool call.
# Blocks writes where content byte length exceeds 512KB (524288 bytes).
#
# Content extraction:
#   Write tool → tool_input.content
#   Edit tool  → tool_input.new_string (checks the replacement only)
#
# Exit codes:
#   0 = file size within limits — allow
#   2 = file size exceeds limit — block

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

TOOL_NAME=$(printf '%s' "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

# Extract content based on tool type
if [[ "$TOOL_NAME" == "Write" ]]; then
  CONTENT=$(printf '%s' "$INPUT" | jq -r '.tool_input.content // empty' 2>/dev/null)
elif [[ "$TOOL_NAME" == "Edit" ]]; then
  CONTENT=$(printf '%s' "$INPUT" | jq -r '.tool_input.new_string // empty' 2>/dev/null)
else
  exit 0
fi

if [[ -z "$CONTENT" ]]; then
  exit 0
fi

# ── Byte length check ─────────────────────────────────────────────────────────
LIMIT=524288  # 512KB

# Use printf + wc for portable byte counting
BYTE_LENGTH=$(printf '%s' "$CONTENT" | wc -c | tr -d ' ')

if [[ "$BYTE_LENGTH" -gt "$LIMIT" ]]; then
  printf 'File size guard: %s bytes exceeds 512KB limit\n' "$BYTE_LENGTH" >&2
  printf '  File: %s\n' "${FILE_PATH:-unknown}" >&2
  printf 'Block reason: Writing files larger than 512KB risks memory issues and slow tool calls.\n' >&2
  printf 'Fix: Split the content into multiple smaller files or chunks.\n' >&2
  exit 2
fi

exit 0
