#!/bin/bash
# PreToolUse hook: push-review-gate.sh
# Fires BEFORE every Bash tool call that matches "git push".
# Runs a full diff analysis against the target branch and requests
# security + code review before allowing the push.
#
# Exit codes:
#   0 = allow (no meaningful diff, or review cached)
#   2 = block (needs review)

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

# Only trigger on git push commands
if ! printf '%s' "$CMD" | grep -qiE 'git[[:space:]]+push'; then
  exit 0
fi

# ── 5. Check if quality gates are enabled ─────────────────────────────────────
POLICY_FILE="${REAGENT_ROOT}/.reagent/policy.yaml"
if [[ -f "$POLICY_FILE" ]]; then
  if grep -qE 'push_review:[[:space:]]*false' "$POLICY_FILE" 2>/dev/null; then
    exit 0
  fi
fi

# ── 6. Determine target branch ───────────────────────────────────────────────
CURRENT_BRANCH=$(cd "$REAGENT_ROOT" && git branch --show-current 2>/dev/null || echo "")
TARGET_BRANCH="main"

# Try to extract target from push command (git push origin <branch>)
PUSH_TARGET=$(printf '%s' "$CMD" | grep -oE 'git[[:space:]]+push[[:space:]]+[a-zA-Z_-]+[[:space:]]+([a-zA-Z0-9/_-]+)' | awk '{print $NF}' 2>/dev/null || echo "")
if [[ -n "$PUSH_TARGET" ]]; then
  TARGET_BRANCH="$PUSH_TARGET"
fi

# ── 7. Get diff against target ───────────────────────────────────────────────
MERGE_BASE=$(cd "$REAGENT_ROOT" && git merge-base "$TARGET_BRANCH" HEAD 2>/dev/null || echo "")

if [[ -z "$MERGE_BASE" ]]; then
  # Can't determine merge base — fail-open
  exit 0
fi

DIFF_FULL=$(cd "$REAGENT_ROOT" && git diff "$MERGE_BASE"...HEAD 2>/dev/null || echo "")

if [[ -z "$DIFF_FULL" ]]; then
  # No diff — nothing to review
  exit 0
fi

LINE_COUNT=$(printf '%s' "$DIFF_FULL" | grep -cE '^\+[^+]|^-[^-]' 2>/dev/null || echo "0")

# ── 8. Check review cache ────────────────────────────────────────────────────
PUSH_SHA=$(printf '%s' "$DIFF_FULL" | shasum -a 256 | cut -d' ' -f1 2>/dev/null || echo "")

if [[ -n "$PUSH_SHA" ]]; then
  CACHE_RESULT=$(node "${REAGENT_ROOT}/node_modules/.bin/reagent" cache check "$PUSH_SHA" --branch "$CURRENT_BRANCH" --base "$TARGET_BRANCH" 2>/dev/null || echo '{"hit":false}')
  if printf '%s' "$CACHE_RESULT" | jq -e '.hit == true' >/dev/null 2>&1; then
    exit 0
  fi
fi

# ── 9. Block and request review ──────────────────────────────────────────────
FILE_COUNT=$(printf '%s' "$DIFF_FULL" | grep -c '^\+\+\+ ' 2>/dev/null || echo "0")

{
  printf 'PUSH REVIEW GATE: Review required before pushing\n'
  printf '\n'
  printf '  Branch: %s → %s\n' "$CURRENT_BRANCH" "$TARGET_BRANCH"
  printf '  Scope: %s files changed, %s lines\n' "$FILE_COUNT" "$LINE_COUNT"
  printf '\n'
  printf '  Action required:\n'
  printf '  1. Spawn a code-reviewer agent to review: git diff %s...HEAD\n' "$MERGE_BASE"
  printf '  2. Spawn a security-engineer agent for security review\n'
  printf '  3. After both pass, cache the result:\n'
  printf '     reagent cache set %s pass --branch %s --base %s\n' "$PUSH_SHA" "$CURRENT_BRANCH" "$TARGET_BRANCH"
  printf '\n'
} >&2
exit 2
