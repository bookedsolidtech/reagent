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
# NOTE: This hook is a last-resort pre-write guard. The primary secret gate is
# gitleaks running in the pre-commit hook. This hook stops obvious credentials
# before they hit disk. It cannot catch all encoding tricks — rely on gitleaks
# for comprehensive coverage.
#
# Exit codes:
#   0 = no secrets detected — allow the tool to proceed
#   2 = secrets detected    — block the tool call

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
    "$(cat "$HALT_FILE" 2>/dev/null || echo 'Reason unknown')" >&2
  exit 2
fi

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

# Smart file-path exclusions (suffix-based only — no directory exclusions)
if [[ -n "$FILE_PATH" ]]; then
  if [[ "$FILE_PATH" == *.env.example || "$FILE_PATH" == *.env.sample ]]; then
    exit 0
  fi
  # Test files are NOT excluded — real secrets in test files must be caught.
  # The is_placeholder() function handles false positives from test fixtures.
fi

# Build line-filtered content
# Strip: shell comment lines (#) and lines where process.env.VAR is the RHS of an assignment
# NOT stripped: lines that merely mention process.env somewhere (bypass vector if too broad)
FILTERED_FILE=$(mktemp "${TMPDIR:-/tmp}/reagent-secret-scan-XXXXXX") || {
  printf 'SECRET-SCAN ERROR: Failed to create temp file — blocking write (fail-secure)\n' >&2
  exit 2
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
  # Skip shell comment lines only
  if (substr(trimmed, 1, 1) == "#") next
  # Skip lines where process.env.VAR is the RHS of an assignment
  # Pattern: = process.env.SOMETHING  (not just any mention of process.env)
  if (trimmed ~ /=[[:space:]]*process\.env\.[A-Z_]+[^a-zA-Z]?$/) next
  if (trimmed ~ /=[[:space:]]*process\.env\.[A-Z_]+[[:space:]]*[;,)]/) next
  if (trimmed ~ /os\.environ\[/) next
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
  [[ "$MATCH" =~ changeme       ]] && return 0
  [[ "$MATCH" =~ insert.*here   ]] && return 0
  # Prefix checks: require full placeholder compound, not just a prefix
  [[ "$MATCH" =~ ^(test|fake|mock|demo|example)_(key|token|secret|credential|api)$ ]] && return 0
  [[ "$MATCH" =~ ^test_[a-z_]+_key$ ]] && return 0
  # Repeated-character dummies (aaaaaaa, 1111111, etc.)
  if printf '%s' "$MATCH" | grep -qE '^(.)\1{7,}$'; then return 0; fi
  return 1
}

VIOLATIONS_FILE=$(mktemp "${TMPDIR:-/tmp}/reagent-secret-violations-XXXXXX") || {
  printf 'SECRET-SCAN ERROR: Failed to create violations file — blocking write (fail-secure)\n' >&2
  exit 2
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

# ── HIGH severity patterns ─────────────────────────────────────────────────────

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

scan_pattern "HIGH" "GitHub classic Personal Access Token" \
  'gh[puors]_[A-Za-z0-9]{36}'

scan_pattern "HIGH" "GitHub fine-grained Personal Access Token" \
  'github_pat_[A-Za-z0-9_]{82}'

scan_pattern "HIGH" "Stripe live secret/restricted key" \
  '(sk|rk)_live_[A-Za-z0-9]{24,}'

scan_pattern "HIGH" "Stripe webhook signing secret" \
  'whsec_[A-Za-z0-9+/]{40,}'

scan_pattern "HIGH" "Generic secret assignment (double-quoted)" \
  '(SECRET|PASSWORD|PRIVATE_KEY|API_SECRET)[[:space:]]*=[[:space:]]*"[^"]{20,}"'

scan_pattern "HIGH" "Generic secret assignment (single-quoted)" \
  "(SECRET|PASSWORD|PRIVATE_KEY|API_SECRET)[[:space:]]*=[[:space:]]*'[^']{20,}'"

scan_pattern "HIGH" "Supabase service role key (JWT)" \
  'SUPABASE_SERVICE_ROLE_KEY[[:space:]]*=[[:space:]]*["\'"'"']eyJ[A-Za-z0-9._-]{50,}'

# ── MEDIUM severity patterns ───────────────────────────────────────────────────

scan_pattern "MEDIUM" ".env credential assignment" \
  '^(ANTHROPIC_API_KEY|SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|STRIPE_SECRET)[[:space:]]*=[[:space:]]*[^[:space:]]+'

scan_pattern "MEDIUM" "Stripe test API key (real credential, test env)" \
  '(sk|pk|rk)_test_[A-Za-z0-9]{24,}'

scan_pattern "MEDIUM" "Stripe live publishable key" \
  'pk_live_[A-Za-z0-9]{24,}'

scan_pattern "MEDIUM" "Hardcoded DB connection string with password" \
  'postgresql://[^:]+:[^@]{8,}@'

scan_pattern "MEDIUM" "Supabase anon key in non-client context" \
  'SUPABASE_ANON_KEY[[:space:]]*=[[:space:]]*["\'"'"']eyJ[A-Za-z0-9._-]{50,}'

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
