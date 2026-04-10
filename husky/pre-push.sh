#!/bin/bash
# .husky/pre-push — full quality gate before push
#
# Enforces zero-bad-code policy: NOTHING reaches the remote without passing
# all available quality gates. Every gate that exists in the project runs.
#
# Gates (skipped gracefully if script not present in package.json):
#   1. Format check  (prettier --check .)
#   2. Lint          (eslint .)
#   3. Type check    (tsc --noEmit)
#   4. Tests         (vitest run / jest / node --test)
#   5. Build         (build script)
#
# Exit codes:
#   0 = all applicable gates passed
#   1 = a gate failed — push blocked

set -euo pipefail

if [ ! -f "package.json" ]; then
  echo "pre-push: no package.json found — quality gates skipped (non-npm project)"
  echo "pre-push: consider adding project-specific gates to .husky/pre-push"
  exit 0
fi

# Detect package manager
PKG_MANAGER="npm"
if [ -f "pnpm-lock.yaml" ]; then
  PKG_MANAGER="pnpm"
elif [ -f "yarn.lock" ]; then
  PKG_MANAGER="yarn"
fi

FAILED=""
OUT=$(mktemp)
cleanup() { rm -f "$OUT"; }
trap cleanup EXIT

script_exists() {
  local SCRIPT_NAME="$1"
  node -e "const p=require('./package.json');if(!p.scripts||!p.scripts[process.argv[1]])process.exit(1);" "$SCRIPT_NAME" 2>/dev/null
}

run_gate() {
  local SCRIPT_NAME="$1"
  local LABEL="$2"

  if script_exists "$SCRIPT_NAME"; then
    echo "pre-push: running ${LABEL}..."
    if ! $PKG_MANAGER run "$SCRIPT_NAME" > "$OUT" 2>&1; then
      echo ""
      echo "GATE FAILED: ${LABEL}"
      cat "$OUT"
      echo ""
      FAILED="${FAILED} ${SCRIPT_NAME}"
    fi
  fi
}

# ── Gates ─────────────────────────────────────────────────────────────────────
run_gate "format:check" "Prettier format check"
run_gate "lint"         "ESLint"
run_gate "type-check"   "TypeScript type check"
run_gate "test"         "Test suite"
run_gate "build"        "Build"

# ── Optional: coverage threshold gate ─────────────────────────────────────────
# Enabled via .reagent/policy.yaml:
#   coverage:
#     enabled: true
#     threshold: 80   # line/function/statement coverage percentage (branches: threshold - 10)
#
# Only runs if coverage.enabled is true AND the project has a test script.
POLICY_FILE=".reagent/policy.yaml"
COVERAGE_ENABLED="false"
COVERAGE_THRESHOLD=80

if [ -f "$POLICY_FILE" ]; then
  # Extract coverage.enabled — look for "enabled: true" within the coverage block
  if awk '/^coverage:/{in_block=1} in_block && /enabled: true/{found=1; exit} in_block && /^[^ ]/{in_block=0}' "$POLICY_FILE" | grep -q "enabled: true" 2>/dev/null || \
     grep -A5 "^coverage:" "$POLICY_FILE" 2>/dev/null | grep -q "enabled: true"; then
    COVERAGE_ENABLED="true"
  fi

  # Extract coverage.threshold (default 80)
  THRESHOLD_LINE=$(grep -A5 "^coverage:" "$POLICY_FILE" 2>/dev/null | grep "threshold:" | head -1)
  if [ -n "$THRESHOLD_LINE" ]; then
    EXTRACTED=$(echo "$THRESHOLD_LINE" | awk '{print $2}' | tr -d '"' | tr -d "'")
    if [ -n "$EXTRACTED" ] && [ "$EXTRACTED" -eq "$EXTRACTED" ] 2>/dev/null; then
      COVERAGE_THRESHOLD="$EXTRACTED"
    fi
  fi
fi

if [ "$COVERAGE_ENABLED" = "true" ] && script_exists "test"; then
  echo "pre-push: running Coverage threshold (≥${COVERAGE_THRESHOLD}%)..."
  if ! COVERAGE_THRESHOLD="$COVERAGE_THRESHOLD" $PKG_MANAGER run test -- --coverage > "$OUT" 2>&1; then
    echo ""
    echo "GATE FAILED: Coverage threshold (${COVERAGE_THRESHOLD}%)"
    cat "$OUT"
    echo ""
    FAILED="${FAILED} coverage"
  fi
fi

# ── Report ────────────────────────────────────────────────────────────────────
if [ -n "$FAILED" ]; then
  echo "pre-push: FAILED gates:${FAILED}"
  echo "All quality gates must pass before push. Fix failures and retry."
  exit 1
fi

echo "pre-push: all quality gates passed"
exit 0
