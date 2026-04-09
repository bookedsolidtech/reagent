#!/bin/bash
# PreToolUse hook: env-file-protection.sh
# Fires BEFORE every Bash tool call.
# Blocks commands that read .env* / .envrc files via shell text utilities.
#
# Rationale: .env files contain credentials. Reading them via Bash exposes
# the values in command output, logs, and agent transcripts. Load credentials
# in code only (process.env, os.environ, etc.) — never via shell reads.
#
# Trigger: command matches ALL of:
#   1. Uses a text-reading utility (list below)
#   2. References a .env* or .envrc filename
#
# Exit codes:
#   0 = allow
#   2 = block (env file read detected)

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

# Text-reading utilities (shell and common alternatives)
# Defense-in-depth: this list catches the most common shell-based exfiltration
# vectors. It is NOT exhaustive. Known gaps include:
#   - Docker volume mounts (docker run -v .env:/...) — separate concern
#   - Editor commands (vim, nano, code) — not typically used by agents
#   - Redirects/process substitution (< .env) without a listed utility
#   - Network tools (curl file://, nc) — low-risk in agent context
# The goal is to block casual and accidental reads, not defeat a determined
# adversary with shell access.
PATTERN_UTILITY='(cat|head|tail|less|more|grep|sed|awk|bat|strings|printf|xargs|tee|jq|python3?[[:space:]]+-c|ruby[[:space:]]+-e)[[:space:]]'
# Also catch: source/., cp (reads then writes elsewhere)
PATTERN_SOURCE='(source|\.)[[:space:]]+[^;|&]*\.env'
PATTERN_CP_ENV='cp[[:space:]]+[^;|&]*\.env'
# .env* files or .envrc (direnv)
PATTERN_ENV_FILE='(\.env[a-zA-Z0-9._-]*|\.envrc)([[:space:]]|"|'"'"'|$)'

MATCHES_UTILITY=0
MATCHES_ENV_FILE=0

if printf '%s' "$CMD" | grep -qE "$PATTERN_UTILITY"; then
  MATCHES_UTILITY=1
fi

if printf '%s' "$CMD" | grep -qE "$PATTERN_ENV_FILE"; then
  MATCHES_ENV_FILE=1
fi

# Direct source/cp of .env files — always block
if printf '%s' "$CMD" | grep -qE "$PATTERN_SOURCE" || \
   printf '%s' "$CMD" | grep -qE "$PATTERN_CP_ENV"; then
  TRUNCATED_CMD=$(truncate_cmd "$CMD")
  {
    printf 'ENV FILE PROTECTION: Direct sourcing or copying of .env files is blocked.\n'
    printf '\n'
    printf '  Command: %s\n' "$TRUNCATED_CMD"
    printf '\n'
    printf '  Rule: Load credentials in code only — never via shell source or cp.\n'
    printf '  Use: process.env.VAR_NAME, os.environ["VAR_NAME"], etc.\n'
  } >&2
  exit 2
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
    printf '  .env files must not be read via shell utilities in agent sessions.\n'
  } >&2
  exit 2
fi

exit 0
