#!/bin/bash
# PostToolUse hook: output-validation.sh
# Fires AFTER every Bash tool call.
# Scans tool stdout for credential patterns and blocks (exit 2) if found.
#
# Content extraction:
#   PostToolUse → tool_response (stdout from Bash)
#
# Exit codes:
#   0 = no credential patterns detected — allow
#   2 = credential pattern detected     — block

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

# ── Extract tool output ───────────────────────────────────────────────────────
# PostToolUse payload has tool_response field containing the output
OUTPUT=$(printf '%s' "$INPUT" | jq -r '
  if .tool_response then
    if (.tool_response | type) == "array" then
      [.tool_response[] | .text // ""] | join("\n")
    elif (.tool_response | type) == "string" then
      .tool_response
    else
      (.tool_response.content // .tool_response.text // "") | if type == "array" then [.[] | .text // ""] | join("\n") else . end
    end
  else
    ""
  end
' 2>/dev/null)

if [[ -z "$OUTPUT" ]]; then
  exit 0
fi

# ── Scan for credential patterns ──────────────────────────────────────────────
FOUND=0
PATTERN_LABEL=""

# AWS access key (AKIA...)
if printf '%s' "$OUTPUT" | grep -qE 'AKIA[0-9A-Z]{16}'; then
  FOUND=1
  PATTERN_LABEL="AWS Access Key ID (AKIA...)"
fi

# GitHub tokens
if [[ $FOUND -eq 0 ]] && printf '%s' "$OUTPUT" | grep -qE 'gh[puors]_[A-Za-z0-9]{36}'; then
  FOUND=1
  PATTERN_LABEL="GitHub Personal Access Token (ghp_/ghs_/...)"
fi

# GitHub fine-grained PAT
if [[ $FOUND -eq 0 ]] && printf '%s' "$OUTPUT" | grep -qE 'github_pat_[A-Za-z0-9_]{82}'; then
  FOUND=1
  PATTERN_LABEL="GitHub fine-grained PAT (github_pat_...)"
fi

# Generic API key pattern: sk-... (OpenAI, Anthropic, Stripe test)
if [[ $FOUND -eq 0 ]] && printf '%s' "$OUTPUT" | grep -qE 'sk-[A-Za-z0-9_-]{20,}'; then
  FOUND=1
  PATTERN_LABEL="Generic API key (sk-...)"
fi

# Bearer token (with value)
if [[ $FOUND -eq 0 ]] && printf '%s' "$OUTPUT" | grep -qE 'Bearer [A-Za-z0-9._-]{20,}'; then
  FOUND=1
  PATTERN_LABEL="Bearer token"
fi

# Private key header
if [[ $FOUND -eq 0 ]] && printf '%s' "$OUTPUT" | grep -qE -- '-----BEGIN (RSA|EC|OPENSSH|PGP) PRIVATE KEY-----'; then
  FOUND=1
  PATTERN_LABEL="Private key block"
fi

if [[ $FOUND -eq 1 ]]; then
  printf 'OUTPUT-VALIDATION: Credential pattern detected in Bash output\n' >&2
  printf '  Pattern matched: %s\n' "$PATTERN_LABEL" >&2
  printf 'Block reason: Tool output contains what appears to be a live credential.\n' >&2
  printf 'The credential must not be logged, forwarded, or stored. Rotate it immediately if real.\n' >&2
  exit 2
fi

exit 0
