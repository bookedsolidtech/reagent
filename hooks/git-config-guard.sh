#!/bin/bash
# PreToolUse hook: git-config-guard.sh
# Fires BEFORE every Bash tool call.
# Blocks git config commands that modify security-critical git settings.
#
# Blocked patterns:
#   - git config core.hooksPath  (redirects/disables hooks)
#   - git config http.sslVerify  (disables TLS verification)
#   - git config safe.directory  (bypasses ownership checks)
#   - git config user.email/user.name (alters identity for commit signing)
#
# Exit codes:
#   0 = safe — allow the command
#   2 = dangerous git config detected — block

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

# Only proceed if git config is present
if ! printf '%s' "$CMD" | grep -qiE 'git[[:space:]]+(config|(-[a-zA-Z]+[[:space:]]+)*config)'; then
  exit 0
fi

# ── Check for dangerous settings ──────────────────────────────────────────────
BLOCKED_REASON=""

# core.hooksPath — redirects or disables git hooks
if printf '%s' "$CMD" | grep -qiE 'git[[:space:]].*config.*core\.hookspath'; then
  BLOCKED_REASON="core.hooksPath — redirecting the hooks directory disables all safety gates"
fi

# http.sslVerify false — disables TLS cert verification
if [[ -z "$BLOCKED_REASON" ]] && printf '%s' "$CMD" | grep -qiE 'git[[:space:]].*config.*http\.sslverify'; then
  if printf '%s' "$CMD" | grep -qiE 'http\.sslverify[[:space:]]+(false|0)'; then
    BLOCKED_REASON="http.sslVerify false — disabling TLS verification enables MITM attacks"
  fi
fi

# safe.directory — bypasses ownership safety checks
if [[ -z "$BLOCKED_REASON" ]] && printf '%s' "$CMD" | grep -qiE 'git[[:space:]].*config.*safe\.directory'; then
  BLOCKED_REASON="safe.directory — modifying this setting bypasses git ownership security checks"
fi

# user.email or user.name — altering commit identity
if [[ -z "$BLOCKED_REASON" ]] && printf '%s' "$CMD" | grep -qiE 'git[[:space:]].*config[[:space:]].*(--global|--system)[[:space:]].*user\.(email|name)'; then
  BLOCKED_REASON="user.email/user.name with --global/--system flag — alters git identity globally, affecting all repos"
fi

if [[ -n "$BLOCKED_REASON" ]]; then
  printf 'GIT-CONFIG-GUARD: Dangerous git config command blocked\n' >&2
  printf '  Reason: %s\n' "$BLOCKED_REASON" >&2
  printf '  Command: %s\n' "$(printf '%s' "$CMD" | head -c 200)" >&2
  printf 'Block reason: Modifying this git setting undermines repository security.\n' >&2
  printf 'If you need to change this setting, request human escalation.\n' >&2
  exit 2
fi

exit 0
