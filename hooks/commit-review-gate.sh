#!/bin/bash
# PreToolUse hook: commit-review-gate.sh
# Fires BEFORE every Bash tool call that matches "git commit".
# Implements a triage-based review gate:
#   - trivial (<20 changed lines, non-sensitive paths) → pass immediately
#   - standard (20-200 lines) → check review cache, pass if cached
#   - significant (>200 lines or sensitive paths) → block, request agent review
#
# Exit codes:
#   0 = allow (trivial change, or cached review found)
#   2 = block (needs review — returns additionalContext for agent)

set -uo pipefail

# ── 1. Read ALL stdin immediately ─────────────────────────────────────────────
INPUT=$(cat)

# ── 2. Dependency check ──────────────────────────────────────────────────────
if ! command -v jq >/dev/null 2>&1; then
  printf 'REAGENT ERROR: jq is required but not installed.\n' >&2
  printf 'Install: brew install jq  OR  apt-get install -y jq\n' >&2
  exit 2
fi

# ── 3. HALT check ────────────────────────────────────────────────────────────
REAGENT_ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
HALT_FILE="${REAGENT_ROOT}/.reagent/HALT"
if [ -f "$HALT_FILE" ]; then
  printf 'REAGENT HALT: %s\nAll agent operations suspended. Run: reagent unfreeze\n' \
    "$(head -c 1024 "$HALT_FILE" 2>/dev/null || echo 'Reason unknown')" >&2
  exit 2
fi

# ── 4. Parse command ──────────────────────────────────────────────────────────
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

if [[ -z "$CMD" ]]; then
  exit 0
fi

# Only trigger on git commit commands
if ! printf '%s' "$CMD" | grep -qiE 'git[[:space:]]+commit'; then
  exit 0
fi

# Skip --amend (reviewing amendments is a future feature)
if printf '%s' "$CMD" | grep -qiE 'git[[:space:]]+commit.*--amend'; then
  exit 0
fi

# ── 5. Check if quality gates are enabled ─────────────────────────────────────
# Fail-open if policy doesn't exist or doesn't have quality_gates
POLICY_FILE="${REAGENT_ROOT}/.reagent/policy.yaml"
if [[ -f "$POLICY_FILE" ]]; then
  if grep -qE '^quality_gates:' "$POLICY_FILE" 2>/dev/null; then
    if grep -qE 'commit_review:[[:space:]]*false' "$POLICY_FILE" 2>/dev/null; then
      exit 0
    fi
  fi
fi

# ── 6. Compute diff stats ────────────────────────────────────────────────────
# Get staged diff (what would be committed)
DIFF_OUTPUT=$(cd "$REAGENT_ROOT" && git diff --cached --stat 2>/dev/null || echo "")
DIFF_FULL=$(cd "$REAGENT_ROOT" && git diff --cached 2>/dev/null || echo "")

if [[ -z "$DIFF_OUTPUT" ]]; then
  # No staged changes — let git commit handle the error
  exit 0
fi

# Count changed lines (additions + deletions)
LINE_COUNT=$(printf '%s' "$DIFF_FULL" | grep -cE '^\+[^+]|^-[^-]' 2>/dev/null || echo "0")

# Check for sensitive paths
SENSITIVE=0
SENSITIVE_FILES=""
if printf '%s' "$DIFF_FULL" | grep -qE '^\+\+\+ .*(\.reagent/|\.claude/|\.env|auth|security|\.github/workflows)'; then
  SENSITIVE=1
  SENSITIVE_FILES=$(printf '%s' "$DIFF_FULL" | grep -oE '^\+\+\+ .*(\.reagent/|\.claude/|\.env|auth|security|\.github/workflows)[^ ]*' | sed 's/^\+\+\+ [ab]\//  /' | head -5)
fi

# ── 7. Triage scoring ────────────────────────────────────────────────────────
TRIVIAL_THRESHOLD=20
SIGNIFICANT_THRESHOLD=200

if [[ $SENSITIVE -eq 1 ]] || [[ $LINE_COUNT -gt $SIGNIFICANT_THRESHOLD ]]; then
  SCORE="significant"
elif [[ $LINE_COUNT -ge $TRIVIAL_THRESHOLD ]]; then
  SCORE="standard"
else
  SCORE="trivial"
fi

# ── 8. Trivial → pass immediately ─────────────────────────────────────────────
if [[ "$SCORE" == "trivial" ]]; then
  exit 0
fi

# ── 9. Resolve reagent CLI ────────────────────────────────────────────────────
# Try local installs first, then dist build, then global PATH install.
REAGENT_CLI_ARGS=()
if [[ -f "${REAGENT_ROOT}/node_modules/.bin/reagent" ]]; then
  REAGENT_CLI_ARGS=(node "${REAGENT_ROOT}/node_modules/.bin/reagent")
elif [[ -f "${REAGENT_ROOT}/dist/cli/index.js" ]]; then
  REAGENT_CLI_ARGS=(node "${REAGENT_ROOT}/dist/cli/index.js")
elif command -v reagent >/dev/null 2>&1; then
  REAGENT_CLI_ARGS=(reagent)
fi

# ── 10. Check review cache for all non-trivial commits ────────────────────────
# Compute SHA and branch here so both standard and significant tiers share them.
STAGED_SHA=$(cd "$REAGENT_ROOT" && git diff --cached | shasum -a 256 | cut -d' ' -f1 2>/dev/null || echo "")
BRANCH=$(cd "$REAGENT_ROOT" && git branch --show-current 2>/dev/null || echo "")
CACHE_FILE="${REAGENT_ROOT}/.reagent/review-cache.json"

if [[ -n "$STAGED_SHA" ]]; then
  CACHE_HIT=false

  # Primary: use CLI when available — handles TTL, expiry, and branch-scoped keys
  if [[ ${#REAGENT_CLI_ARGS[@]} -gt 0 ]]; then
    CACHE_RESULT=$("${REAGENT_CLI_ARGS[@]}" cache check "$STAGED_SHA" --branch "$BRANCH" 2>/dev/null || echo '{"hit":false}')
    if printf '%s' "$CACHE_RESULT" | jq -e '.hit == true' >/dev/null 2>&1; then
      CACHE_HIT=true
    fi
  fi

  # Fallback: read cache JSON directly — works when reagent is not on PATH.
  # Checks branch-scoped key ("branch:sha") first, then bare SHA (empty-branch case).
  if [[ "$CACHE_HIT" == "false" ]] && [[ -f "$CACHE_FILE" ]]; then
    CACHE_KEY="${BRANCH}:${STAGED_SHA}"
    DIRECT_HIT=$(jq -r --arg k1 "$CACHE_KEY" --arg k2 "$STAGED_SHA" \
      '(.entries[$k1] // .entries[$k2]) | if . == null then "miss" elif .result == "pass" then "hit" else "miss" end' \
      "$CACHE_FILE" 2>/dev/null || echo "miss")
    if [[ "$DIRECT_HIT" == "hit" ]]; then
      CACHE_HIT=true
    fi
  fi

  if [[ "$CACHE_HIT" == "true" ]]; then
    exit 0
  fi
fi

# ── 10. Block and request review ──────────────────────────────────────────────
{
  printf 'COMMIT REVIEW GATE: Review required before committing\n'
  printf '\n'
  printf '  Score: %s (%s changed lines)\n' "$SCORE" "$LINE_COUNT"
  if [[ $SENSITIVE -eq 1 ]]; then
    printf '  Sensitive paths detected:\n'
    printf '%s\n' "$SENSITIVE_FILES"
  fi
  printf '\n'
  printf '  Action required: Spawn a code-reviewer agent to review the staged changes.\n'
  printf '  The reviewer should produce structured JSON output with findings.\n'
  printf '  After review, cache the result with: reagent cache set <sha> pass\n'
  printf '\n'
  printf '  To review staged changes: git diff --cached\n'
} >&2
exit 2
