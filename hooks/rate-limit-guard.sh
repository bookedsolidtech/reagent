#!/bin/bash
# PreToolUse hook: rate-limit-guard.sh
# Fires BEFORE every Bash and Write tool call.
# Blocks if more than 20 calls to the same tool occur within 60 seconds.
# Uses a log file per tool in $HOME/.reagent/rate-limits/{tool}.log.
#
# Exit codes:
#   0 = within rate limit — allow
#   2 = rate limit exceeded — block

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

if [[ -z "$TOOL_NAME" ]]; then
  exit 0
fi

# Sanitize tool name for use in filename
SAFE_TOOL=$(printf '%s' "$TOOL_NAME" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-')

# ── Counter directory: prefer user-owned $HOME/.reagent/rate-limits/ ──────────
# Storing counters in /tmp is world-writable and allows symlink attacks.
# Use a user-owned directory with mode 700 instead.
RATE_LIMIT_DIR="${HOME}/.reagent/rate-limits"

if [[ -n "${HOME:-}" ]] && mkdir -p "$RATE_LIMIT_DIR" 2>/dev/null && chmod 700 "$RATE_LIMIT_DIR" 2>/dev/null; then
  LOG_FILE="${RATE_LIMIT_DIR}/${SAFE_TOOL}.log"
else
  # $HOME not writable — fall back to a session-scoped tmpdir (not /tmp root)
  if [[ -z "${REAGENT_RATE_LIMIT_TMPDIR:-}" ]]; then
    REAGENT_RATE_LIMIT_TMPDIR=$(mktemp -d 2>/dev/null || true)
    export REAGENT_RATE_LIMIT_TMPDIR
    if [[ -n "$REAGENT_RATE_LIMIT_TMPDIR" ]]; then
      printf 'RATE-LIMIT-GUARD WARN: $HOME not writable — using session tmpdir for rate-limit counters: %s\n' \
        "$REAGENT_RATE_LIMIT_TMPDIR" >&2
    fi
  fi
  if [[ -n "${REAGENT_RATE_LIMIT_TMPDIR:-}" ]]; then
    LOG_FILE="${REAGENT_RATE_LIMIT_TMPDIR}/${SAFE_TOOL}.log"
  else
    # Last resort: skip rate limiting rather than failing noisily
    exit 0
  fi
fi

LIMIT=20
WINDOW=60  # seconds

NOW=$(date +%s)
CUTOFF=$(( NOW - WINDOW ))

# ── Prune old entries and count recent calls ──────────────────────────────────
RECENT_COUNT=0

if [[ -f "$LOG_FILE" ]]; then
  # Filter to only entries within the window, count them
  RECENT_LINES=$(awk -v cutoff="$CUTOFF" '$1 > cutoff' "$LOG_FILE" 2>/dev/null || true)
  RECENT_COUNT=$(printf '%s' "$RECENT_LINES" | grep -c '[0-9]' 2>/dev/null || echo "0")

  # Rewrite log file with only recent entries (prune old ones)
  printf '%s\n' "$RECENT_LINES" > "$LOG_FILE" 2>/dev/null || true
else
  # Create log file
  touch "$LOG_FILE" 2>/dev/null || true
fi

# ── Check rate limit ──────────────────────────────────────────────────────────
if [[ "$RECENT_COUNT" -ge "$LIMIT" ]]; then
  printf 'RATE-LIMIT-GUARD: Tool call rate limit exceeded\n' >&2
  printf '  Tool: %s\n' "$TOOL_NAME" >&2
  printf '  Calls in last 60s: %d (limit: %d)\n' "$RECENT_COUNT" "$LIMIT" >&2
  printf 'Block reason: More than %d %s calls within 60 seconds indicates a runaway loop.\n' "$LIMIT" "$TOOL_NAME" >&2
  printf 'The session will resume normally once the rate window resets.\n' >&2
  exit 2
fi

# ── Record this invocation ────────────────────────────────────────────────────
printf '%d\n' "$NOW" >> "$LOG_FILE" 2>/dev/null || true

exit 0
