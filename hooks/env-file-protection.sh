#!/bin/bash
# PreToolUse hook: env-file-protection.sh
# Fires BEFORE every Bash tool call.
# Blocks commands that read .env* files via shell text utilities.
#
# Rationale: .env files contain credentials. Reading them via Bash exposes
# the values in command output, logs, and agent transcripts. Load credentials
# in code only (process.env, os.environ, etc.) — never via shell reads.
#
# Trigger: command matches ALL of:
#   1. Uses a text-reading utility: cat, head, tail, less, grep, sed, awk
#   2. References a .env* filename (literal dot required)
#
# NOT triggered by:
#   - ls .env*              (listing, not reading)
#   - grep "KEY" src/env.ts (.env appears in a path component, not a bare .env* file)
#
# Exit codes:
#   0 = allow
#   2 = block (env file read detected)

set -uo pipefail

INPUT=$(cat)
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

if [[ -z "$CMD" ]]; then
  exit 0
fi

truncate_cmd() {
  local STR="$1"
  local MAX=100
  if [[ ${#STR} -gt $MAX ]]; then
    printf '%s' "${STR:0:$MAX}..."
  else
    printf '%s' "$STR"
  fi
}

PATTERN_UTILITY='(cat|head|tail|less|grep|sed|awk)[[:space:]]'
PATTERN_ENV_FILE='\.env[a-zA-Z0-9._-]*([[:space:]]|"|'"'"'|$)'

MATCHES_UTILITY=0
MATCHES_ENV_FILE=0

if printf '%s' "$CMD" | grep -qE "$PATTERN_UTILITY"; then
  MATCHES_UTILITY=1
fi

if printf '%s' "$CMD" | grep -qE "$PATTERN_ENV_FILE"; then
  MATCHES_ENV_FILE=1
fi

if [[ $MATCHES_UTILITY -eq 1 && $MATCHES_ENV_FILE -eq 1 ]]; then
  TRUNCATED_CMD=$(truncate_cmd "$CMD")
  {
    printf 'ENV FILE PROTECTION: Reading .env files via Bash is blocked.\n'
    printf '\n'
    printf '  Command: %s\n' "$TRUNCATED_CMD"
    printf '\n'
    printf '  Rule: Load credentials in code only, never via shell.\n'
    printf '  Use: process.env.VAR_NAME, os.environ["VAR_NAME"], etc.\n'
    printf '  .env files must not be read via cat/grep/sed in agent sessions.\n'
  } >&2
  exit 2
fi

exit 0
