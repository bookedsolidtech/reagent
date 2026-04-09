#!/usr/bin/env bash
# ==============================================================================
# Reagent Preflight — Local quality gates before push
# ==============================================================================
# All gates must pass before any push to remote. This is enforced by the
# pre-push husky hook, but run this manually to check without pushing.
#
# Usage:
#   ./scripts/preflight.sh
#
# Exit codes:
#   0 = all gates passed
#   1 = a gate failed
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

PASS=0
FAIL=0
GATE_OUT=$(mktemp /tmp/reagent-preflight-XXXXXX) || { echo "ERROR: mktemp failed"; exit 1; }
trap 'rm -f "$GATE_OUT"' EXIT

gate() {
  local LABEL="$1"
  shift
  printf '  %-32s' "$LABEL..."
  if "$@" > "$GATE_OUT" 2>&1; then
    echo "PASS"
    PASS=$((PASS + 1))
  else
    echo "FAIL"
    FAIL=$((FAIL + 1))
    cat "$GATE_OUT"
    echo ""
  fi
}

echo ""
echo "@bookedsolid/reagent preflight"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── Gate 1: Secret scan ───────────────────────────────────────────────────────
if command -v gitleaks >/dev/null 2>&1; then
  gate "Secret scan (gitleaks)" gitleaks detect --config .gitleaks.toml --no-git --source . --no-banner
else
  echo "  Secret scan (gitleaks)          SKIP (not installed)"
fi

# ── Gate 2: Format check ──────────────────────────────────────────────────────
if command -v prettier >/dev/null 2>&1; then
  gate "Format check (prettier)" prettier --check .
elif [ -f node_modules/.bin/prettier ]; then
  gate "Format check (prettier)" node_modules/.bin/prettier --check .
else
  echo "  Format check (prettier)         SKIP (not installed)"
fi

# ── Gate 3: Lint ──────────────────────────────────────────────────────────────
if [ -f node_modules/.bin/eslint ]; then
  gate "Lint (eslint)" node_modules/.bin/eslint . --max-warnings 0
elif command -v eslint >/dev/null 2>&1; then
  gate "Lint (eslint)" eslint . --max-warnings 0
else
  echo "  Lint (eslint)                   SKIP (not installed)"
fi

# ── Gate 4: Type check ────────────────────────────────────────────────────────
if [ -f tsconfig.json ]; then
  gate "Type check (tsc)" npm run type-check
fi

# ── Gate 5: Tests ─────────────────────────────────────────────────────────────
if [ -f vitest.config.ts ] || [ -f vitest.config.js ]; then
  gate "Tests (vitest)" npm test
fi

# ── Gate 6: Pack dry-run ──────────────────────────────────────────────────────
gate "Pack dry-run" npm pack --dry-run

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Passed: $PASS"
if [[ $FAIL -gt 0 ]]; then
  echo "  Failed: $FAIL"
  echo ""
  echo "Fix failures before pushing."
  exit 1
fi
echo ""
echo "All gates passed. Ready to push."
exit 0
