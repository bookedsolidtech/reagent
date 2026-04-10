#!/usr/bin/env bash
# security-disclosure-gate.sh — PreToolUse: Bash
#
# Intercepts `gh issue create` commands that contain security-sensitive
# keywords and blocks them. Redirects the agent to private GitHub Security
# Advisory disclosure instead of creating a public issue.
#
# Triggered by: PreToolUse — Bash tool

set -euo pipefail

# shellcheck source=_lib/common.sh
source "$(dirname "$0")/_lib/common.sh"

check_halt

INPUT="$(cat)"
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')

if [[ "$TOOL_NAME" != "Bash" ]]; then
  exit 0
fi

COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

# Only intercept gh issue create
if ! echo "$COMMAND" | grep -qE 'gh\s+issue\s+create'; then
  exit 0
fi

require_jq

# Security-sensitive keywords that should NEVER appear in public issues
# These terms suggest a vulnerability, exploit path, or bypass technique
SECURITY_PATTERNS=(
  # Vulnerability classes
  'bypass'
  'exploit'
  'injection'
  'traversal'
  'exfiltrat'
  'escalat'
  'privilege'
  'rce'
  'remote.code.exec'
  'arbitrary.code'
  'code.execution'
  'zero.day'
  '0day'
  'CVE-'
  'CVSS'
  # Reagent-specific sensitive terms
  'hook.bypass'
  'HALT.bypass'
  'redaction.bypass'
  'policy.bypass'
  'middleware.bypass'
  'skip.*gate'
  'evad'
  # Credential/secret exposure
  'secret.*leak'
  'credential.*leak'
  'token.*leak'
  'key.*expos'
  'expos.*secret'
  # Prompt injection
  'prompt.inject'
  'jailbreak'
  'jail.break'
)

# Extract title and body from the command for scanning
FULL_TEXT=$(echo "$COMMAND" | tr '[:upper:]' '[:lower:]')

MATCHED_PATTERN=""
for PATTERN in "${SECURITY_PATTERNS[@]}"; do
  if echo "$FULL_TEXT" | grep -qiE "$PATTERN"; then
    MATCHED_PATTERN="$PATTERN"
    break
  fi
done

if [[ -z "$MATCHED_PATTERN" ]]; then
  exit 0
fi

# Block the public issue creation
json_output "block" \
  "SECURITY DISCLOSURE GATE: This issue appears to describe a security vulnerability (matched pattern: '${MATCHED_PATTERN}'). Do NOT create a public GitHub issue for security vulnerabilities.

CORRECT DISCLOSURE PATH:
1. Use GitHub Security Advisories (private): go to the repository Security tab → 'Report a vulnerability'
2. Or email the maintainers directly (see SECURITY.md for contact)
3. The issue will be publicly disclosed AFTER a patch is released (coordinated disclosure)

WHY: Public issues expose vulnerabilities to attackers before users can patch. This is enforced by the security-disclosure-gate hook.

If this is NOT a security vulnerability, rephrase the issue title/body to avoid triggering security patterns, then retry."

exit 2
