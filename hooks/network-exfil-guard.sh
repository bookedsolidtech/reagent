#!/bin/bash
# PreToolUse hook: network-exfil-guard.sh
# Fires BEFORE every Bash tool call.
# Blocks curl/wget commands that could exfiltrate data or execute remote code.
#
# Blocked patterns:
#   - curl/wget piped to sh/bash (remote code execution)
#   - curl/wget -d @file (posting file contents)
#   - curl/wget to hosts not in the allowlist
#
# Allowlisted hosts:
#   registry.npmjs.org, github.com, api.github.com, raw.githubusercontent.com
#
# Exit codes:
#   0 = safe — allow the command
#   2 = dangerous network pattern — block

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

# Only proceed if curl or wget is present
if ! printf '%s' "$CMD" | grep -qiE '(^|[[:space:];]|&&|\|\|)(curl|wget)[[:space:]]'; then
  exit 0
fi

# ── Check 1: Piped to shell (remote code execution) ───────────────────────────
if printf '%s' "$CMD" | grep -qiE '(curl|wget)[^|]*\|[[:space:]]*(bash|sh|zsh|fish|dash)'; then
  printf 'NETWORK-EXFIL-GUARD: Remote code execution pattern blocked\n' >&2
  printf '  Pattern: curl/wget output piped to shell interpreter\n' >&2
  printf '  Command: %s\n' "$(printf '%s' "$CMD" | head -c 200)" >&2
  printf 'Block reason: Executing remote scripts without inspection is a supply chain risk.\n' >&2
  printf 'Fix: Download first, inspect the script, then execute manually.\n' >&2
  exit 2
fi

# ── Check 2: Posting file contents (-d @filename) ─────────────────────────────
if printf '%s' "$CMD" | grep -qiE '(curl|wget).*-d[[:space:]]+@'; then
  printf 'NETWORK-EXFIL-GUARD: File content upload pattern blocked\n' >&2
  printf '  Pattern: curl -d @file posts file contents to remote host\n' >&2
  printf '  Command: %s\n' "$(printf '%s' "$CMD" | head -c 200)" >&2
  printf 'Block reason: Uploading local file contents to a remote host may exfiltrate sensitive data.\n' >&2
  exit 2
fi

# ── Check 3: Host allowlist ───────────────────────────────────────────────────
ALLOWLIST=(
  "registry.npmjs.org"
  "github.com"
  "api.github.com"
  "raw.githubusercontent.com"
  "objects.githubusercontent.com"
  "codeload.github.com"
)

# Extract URLs/hosts from the command
# Look for http/https URLs and bare hostnames after curl/wget flags
URLS=$(printf '%s' "$CMD" | grep -oE 'https?://[^[:space:]"'"'"']+' | head -20)

if [[ -z "$URLS" ]]; then
  # No parseable URLs — allow (could be a variable-based URL we can't inspect)
  exit 0
fi

BLOCKED_HOST=""
while IFS= read -r URL; do
  [[ -z "$URL" ]] && continue
  # Extract hostname
  HOST=$(printf '%s' "$URL" | sed -E 's|https?://([^/:?#]+).*|\1|')

  # Check against allowlist
  ALLOWED=0
  for ALLOWED_HOST in "${ALLOWLIST[@]}"; do
    if [[ "$HOST" == "$ALLOWED_HOST" ]] || [[ "$HOST" == *".$ALLOWED_HOST" ]]; then
      ALLOWED=1
      break
    fi
  done

  if [[ $ALLOWED -eq 0 ]]; then
    BLOCKED_HOST="$HOST"
    break
  fi
done <<< "$URLS"

if [[ -n "$BLOCKED_HOST" ]]; then
  printf 'NETWORK-EXFIL-GUARD: Request to non-allowlisted host blocked\n' >&2
  printf '  Host: %s\n' "$BLOCKED_HOST" >&2
  printf '  Command: %s\n' "$(printf '%s' "$CMD" | head -c 200)" >&2
  printf 'Block reason: Network requests are restricted to known safe registries and GitHub.\n' >&2
  printf 'Allowlisted hosts: registry.npmjs.org, github.com, api.github.com, raw.githubusercontent.com\n' >&2
  printf 'If this host is needed, request human escalation to update the allowlist.\n' >&2
  exit 2
fi

exit 0
