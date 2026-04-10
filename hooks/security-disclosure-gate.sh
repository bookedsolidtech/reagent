#!/usr/bin/env bash
# security-disclosure-gate.sh — PreToolUse: Bash
#
# Intercepts `gh issue create` commands that contain security-sensitive
# keywords and blocks them. Routing depends on REAGENT_DISCLOSURE_MODE:
#
#   advisory (default) — redirect to GitHub Security Advisories (private)
#                        Use for public OSS repos
#   issues             — redirect to gh issue create with security + internal labels
#                        Use for permanently private client repos
#   disabled           — pass through (not recommended)
#
# Set REAGENT_DISCLOSURE_MODE in .reagent/policy.yaml (written to settings.json
# env by reagent init). Defaults to "advisory" when unset.
#
# Triggered by: PreToolUse — Bash tool

set -euo pipefail

# shellcheck source=_lib/common.sh
source "$(dirname "$0")/_lib/common.sh"

check_halt

# Read disclosure mode — default to advisory
DISCLOSURE_MODE="${REAGENT_DISCLOSURE_MODE:-advisory}"

# Disabled mode: pass through entirely
if [[ "$DISCLOSURE_MODE" == "disabled" ]]; then
  exit 0
fi

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

# Security-sensitive keywords that should not appear in public issues —
# these terms suggest a vulnerability, exploit path, or bypass technique
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
  'GHSA-'
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

# Scan the full command text (title + body + flags) for sensitive patterns
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

# ─── Route based on disclosure mode ──────────────────────────────────────────

if [[ "$DISCLOSURE_MODE" == "issues" ]]; then
  # Private repo mode: redirect to labeled internal issue
  json_output "block" \
    "SECURITY DISCLOSURE GATE: This issue appears to describe a security finding (matched: '${MATCHED_PATTERN}').

This project is configured for PRIVATE disclosure (REAGENT_DISCLOSURE_MODE=issues).

CORRECT PATH for security findings in this private repo:
  Use: gh issue create --label 'security,internal' --title '...' --body '...'

The 'security' and 'internal' labels keep this off public project boards and
mark it for maintainer-only triage. Do NOT use the public issue queue without
these labels for security findings.

If this is NOT a security finding, rephrase the title/body to avoid triggering
security patterns, then retry."

else
  # Advisory mode (default): redirect to GitHub Security Advisories
  json_output "block" \
    "SECURITY DISCLOSURE GATE: This issue appears to describe a security vulnerability (matched: '${MATCHED_PATTERN}'). Do NOT create a public GitHub issue for security vulnerabilities.

CORRECT DISCLOSURE PATH:
1. Use GitHub Security Advisories (private):
   gh api repos/{owner}/{repo}/security-advisories --method POST --input - <<'JSON'
   { \"summary\": \"...\", \"description\": \"...\", \"severity\": \"medium|high|critical\",
     \"vulnerabilities\": [{\"package\": {\"name\": \"@pkg\", \"ecosystem\": \"npm\"}}] }
   JSON
2. Or navigate to: Security tab → Advisories → 'Report a vulnerability'
3. Or email security@bookedsolid.tech (see SECURITY.md)

The finding will be publicly disclosed AFTER a patch is released (coordinated disclosure).

WHY: Public issues expose vulnerabilities before users can patch. This is enforced by the
security-disclosure-gate hook (REAGENT_DISCLOSURE_MODE=${DISCLOSURE_MODE}).

If this is NOT a security vulnerability, rephrase the issue to avoid triggering
security patterns, then retry."
fi

exit 2
