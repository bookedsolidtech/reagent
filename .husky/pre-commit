#!/bin/bash
# .husky/pre-commit — secret scan on staged files before commit
#
# Gates (in order):
#   1. gitleaks protect --staged (REQUIRED — hard fail if not installed)
#   2. .env and .envrc staged file check (always — no gitleaks dependency)
#
# Exit codes:
#   0 = all gates passed
#   1 = gate failed — commit blocked

set -euo pipefail

# ── Gate 1: gitleaks staged scan ──────────────────────────────────────────────
if command -v gitleaks >/dev/null 2>&1; then
  echo "pre-commit: running gitleaks on staged files..."
  if ! gitleaks protect --staged --no-banner 2>&1; then
    echo ""
    echo "ERROR: gitleaks detected potential secrets in staged files."
    echo "Review the output above, remove credentials, then re-stage."
    echo ""
    echo "To allowlist a false positive, add it to .gitleaks.toml [allowlist]"
    exit 1
  fi
  echo "pre-commit: gitleaks scan passed"
else
  echo ""
  echo "ERROR: gitleaks is required but not installed."
  echo "Install: https://github.com/gitleaks/gitleaks#installing"
  echo "  macOS:  brew install gitleaks"
  echo "  Linux:  download from GitHub releases"
  echo ""
  echo "Secret scanning is mandatory. Install gitleaks and retry."
  exit 1
fi

# ── Gate 2: .env / .envrc staged file check ───────────────────────────────────
# Check for .env* or .envrc files anywhere in the repo (including subdirectories)
STAGED_ENV=$(git diff --cached --name-only 2>/dev/null \
  | grep -E '(^|/)\.env(rc|$|\.)' \
  | grep -v '\.example$' \
  | grep -v '\.sample$' \
  || true)

if [ -n "$STAGED_ENV" ]; then
  echo ""
  echo "ERROR: Staged files include credential files:"
  echo "$STAGED_ENV" | while IFS= read -r f; do echo "  $f"; done
  echo ""
  echo "These files must not be committed. Add them to .gitignore:"
  echo "  echo '.env' >> .gitignore"
  echo "  echo '.envrc' >> .gitignore"
  echo ""
  exit 1
fi

exit 0
