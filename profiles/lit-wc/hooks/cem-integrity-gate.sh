#!/bin/bash
# profiles/lit-wc/hooks/cem-integrity-gate.sh
# PostToolUse hook for Write — verifies custom elements manifest stays parseable.
# If cem analyze is available and a custom-elements.json exists, validates it.
# Advisory only — exits 0 after printing warnings.

set -euo pipefail

HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
LIB="$HOOK_DIR/../../../hooks/_lib/common.sh"
if [[ -f "$LIB" ]]; then
  source "$LIB"
  check_halt
fi

INPUT=$(cat)
TOOL_NAME=$(printf '%s' "$INPUT" | grep -o '"tool_name":"[^"]*"' | head -1 | cut -d'"' -f4 2>/dev/null || echo "")
FILE_PATH=$(printf '%s' "$INPUT" | grep -o '"path":"[^"]*"' | head -1 | cut -d'"' -f4 2>/dev/null || echo "")

if [[ "$TOOL_NAME" != "Write" && "$TOOL_NAME" != "Edit" ]]; then
  exit 0
fi

# Only care about .ts/.js files (component source changes)
case "$FILE_PATH" in
  *.ts|*.js) ;;
  *) exit 0 ;;
esac

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
CEM_JSON="$PROJECT_DIR/custom-elements.json"

# Only run if a custom-elements.json exists
if [[ ! -f "$CEM_JSON" ]]; then
  exit 0
fi

# Validate the existing manifest is valid JSON
if ! python3 -c "import sys,json; json.load(open('$CEM_JSON'))" 2>/dev/null && \
   ! node -e "require('$CEM_JSON')" 2>/dev/null; then
  printf '[cem-integrity-gate] WARN: custom-elements.json exists but failed JSON validation. Run: npx cem analyze\n' >&2
  exit 0
fi

# Advisory: remind to regenerate after component changes
printf '[cem-integrity-gate] Advisory: Component source changed. Remember to run "npx cem analyze" to keep custom-elements.json in sync.\n' >&2

exit 0
