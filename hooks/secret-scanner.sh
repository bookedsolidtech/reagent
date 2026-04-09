#!/bin/bash
# PreToolUse hook: secret-scanner.sh
# Fires BEFORE every Write or Edit tool call.
# Scans content about to be written for credential patterns and blocks (exit 2)
# if real secrets are detected — before they ever touch disk.
#
# Content extraction:
#   Write tool → tool_input.content
#   Edit tool  → tool_input.new_string
#
# Exit codes:
#   0 = no secrets detected — allow the tool to proceed
#   2 = secrets detected    — block the tool call

set -uo pipefail

INPUT=$(cat)

FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
CONTENT_WRITE=$(printf '%s' "$INPUT" | jq -r '.tool_input.content // empty' 2>/dev/null)
CONTENT_EDIT=$(printf '%s' "$INPUT"  | jq -r '.tool_input.new_string // empty' 2>/dev/null)

if [[ -n "$CONTENT_WRITE" ]]; then
  CONTENT="$CONTENT_WRITE"
elif [[ -n "$CONTENT_EDIT" ]]; then
  CONTENT="$CONTENT_EDIT"
else
  exit 0
fi

# Smart file-path exclusions
if [[ -n "$FILE_PATH" ]]; then
  if [[ "$FILE_PATH" == *.env.example || "$FILE_PATH" == *.env.sample ]]; then
    exit 0
  fi
  if [[ "$FILE_PATH" == *.test.ts  || "$FILE_PATH" == *.test.tsx  || \
        "$FILE_PATH" == *.spec.ts  || "$FILE_PATH" == *.spec.tsx  || \
        "$FILE_PATH" == *.test.js  || "$FILE_PATH" == *.spec.js ]]; then
    exit 0
  fi
  if [[ "$FILE_PATH" == */__tests__/* || "$FILE_PATH" == */test/* ]]; then
    exit 0
  fi
fi

# Build line-filtered content (strip comments and process.env references)
FILTERED_FILE=$(mktemp /tmp/reagent-secret-scan-XXXXXX) || {
  printf 'SECRET-SCAN WARN: Failed to create temp file — skipping scan\n' >&2
  exit 0
}

VIOLATIONS_FILE=""

cleanup() {
  rm -f "$FILTERED_FILE"
  [[ -n "$VIOLATIONS_FILE" ]] && rm -f "$VIOLATIONS_FILE"
}
trap cleanup EXIT

printf '%s' "$CONTENT" | awk '
{
  line = $0
  trimmed = line
  sub(/^[[:space:]]+/, "", trimmed)
  if (substr(trimmed, 1, 1) == "#") next
  if (trimmed ~ /process\.env\./) next
  if (trimmed ~ /os\.environ/) next
  print line
}
' > "$FILTERED_FILE" 2>/dev/null

if [[ ! -s "$FILTERED_FILE" ]]; then
  exit 0
fi

is_placeholder() {
  local MATCH
  MATCH=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')
  [[ "$MATCH" =~ \<[a-z_]+\> ]] && return 0
  [[ "$MATCH" =~ your_key_here  ]] && return 0
  [[ "$MATCH" =~ your_api_key   ]] && return 0
  [[ "$MATCH" =~ your_secret    ]] && return 0
  [[ "$MATCH" =~ placeholder    ]] && return 0
  [[ "$MATCH" =~ test_key       ]] && return 0
  [[ "$MATCH" =~ dummy          ]] && return 0
  [[ "$MATCH" =~ changeme       ]] && return 0
  [[ "$MATCH" =~ insert.*here   ]] && return 0
  [[ "$MATCH" =~ ^mock          ]] && return 0
  [[ "$MATCH" =~ ^test          ]] && return 0
  [[ "$MATCH" =~ ^example       ]] && return 0
  [[ "$MATCH" =~ ^demo          ]] && return 0
  [[ "$MATCH" =~ ^fake          ]] && return 0
  if printf '%s' "$MATCH" | grep -qE '^(.)\1{7,}$'; then return 0; fi
  return 1
}

VIOLATIONS_FILE=$(mktemp /tmp/reagent-secret-violations-XXXXXX) || {
  printf 'SECRET-SCAN WARN: Failed to create violations file — skipping scan\n' >&2
  exit 0
}

scan_pattern() {
  local SEVERITY="$1"
  local LABEL="$2"
  local PATTERN="$3"
  local MATCHES GREP_EXIT MATCH SNIPPET
  MATCHES=$(grep -oE -e "$PATTERN" "$FILTERED_FILE" 2>/dev/null)
  GREP_EXIT=$?
  [[ $GREP_EXIT -ne 0 ]] && return 0
  [[ -z "$MATCHES" ]]    && return 0
  MATCHES=$(printf '%s\n' "$MATCHES" | head -5)
  while IFS= read -r MATCH; do
    [[ -z "$MATCH" ]] && continue
    if is_placeholder "$MATCH"; then continue; fi
    if [[ ${#MATCH} -gt 60 ]]; then
      SNIPPET="${MATCH:0:60}..."
    else
      SNIPPET="$MATCH"
    fi
    printf '%s|%s|%s\n' "$SEVERITY" "$LABEL" "$SNIPPET" >> "$VIOLATIONS_FILE"
  done <<< "$MATCHES"
}

# HIGH severity patterns
scan_pattern "HIGH" "AWS Access Key ID" \
  'AKIA[0-9A-Z]{16}'

scan_pattern "HIGH" "AWS Secret Access Key" \
  '[Aa][Ww][Ss]_SECRET_ACCESS_KEY[[:space:]]*=[[:space:]]*[A-Za-z0-9/+]{40}'

scan_pattern "HIGH" "Private key block" \
  '-----BEGIN (RSA|EC|OPENSSH|PGP) PRIVATE KEY-----'

scan_pattern "HIGH" "Anthropic API key" \
  'sk-ant-api03-[A-Za-z0-9_-]{93}'

scan_pattern "HIGH" "Anthropic OAuth token" \
  'sk-ant-oat01-[A-Za-z0-9_-]{86}'

scan_pattern "HIGH" "GitHub Personal Access Token" \
  'gh[puors]_[A-Za-z0-9]{36}'

scan_pattern "HIGH" "Stripe live API key" \
  '(sk|pk)_live_[A-Za-z0-9]{24,}'

scan_pattern "HIGH" "Generic secret assignment (double-quoted)" \
  '(SECRET|PASSWORD|PRIVATE_KEY|API_SECRET)[[:space:]]*=[[:space:]]*"[^"]{20,}"'

scan_pattern "HIGH" "Generic secret assignment (single-quoted)" \
  "(SECRET|PASSWORD|PRIVATE_KEY|API_SECRET)[[:space:]]*=[[:space:]]*'[^']{20,}'"

# MEDIUM severity patterns
scan_pattern "MEDIUM" ".env credential assignment" \
  '^(ANTHROPIC_API_KEY|SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|STRIPE_SECRET)[[:space:]]*=[[:space:]]*[^[:space:]]+'

scan_pattern "MEDIUM" "Hardcoded DB connection string with password" \
  'postgresql://[^:]+:[^@]{8,}@'

if [[ ! -s "$VIOLATIONS_FILE" ]]; then
  exit 0
fi

FILE_BASENAME=$(basename "${FILE_PATH:-unknown}")
HIGH_COUNT=$(grep -cF 'HIGH|' "$VIOLATIONS_FILE" 2>/dev/null || true)
: "${HIGH_COUNT:=0}"

if [[ "$HIGH_COUNT" -gt 0 ]]; then
  {
    printf 'SECRET DETECTED: Potential credential in %s\n' "$FILE_BASENAME"
    COUNT=0
    while IFS='|' read -r SEVERITY LABEL SNIPPET; do
      [[ -z "$SEVERITY" ]] && continue
      COUNT=$(( COUNT + 1 ))
      if [[ $COUNT -gt 5 ]]; then break; fi
      printf '  %s: %s — '"'"'%s'"'"'\n' "$SEVERITY" "$LABEL" "$SNIPPET"
    done < "$VIOLATIONS_FILE"
    printf 'Block reason: Writing credentials to disk risks exposure via git history.\n'
    printf 'Fix: Load credentials from environment variables — never hardcode secrets.\n'
  } >&2
  exit 2
fi

{
  printf 'SECRET-SCAN WARN: Low-confidence credential pattern in %s (advisory — not blocking)\n' "$FILE_BASENAME"
  while IFS='|' read -r SEVERITY LABEL SNIPPET; do
    [[ -z "$SEVERITY" ]] && continue
    printf '  %s: %s — '"'"'%s'"'"'\n' "$SEVERITY" "$LABEL" "$SNIPPET"
  done < "$VIOLATIONS_FILE"
  printf 'Note: Heuristic match — may be a false positive. If real, load from environment.\n'
} >&2
exit 0
