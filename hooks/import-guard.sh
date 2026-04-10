#!/bin/bash
# PostToolUse hook: import-guard.sh
# Fires AFTER every Write tool call.
# Scans written JS/TS/MJS content for dangerous import and eval patterns.
# Advisory only (exit 0) — warns loudly but does not block.
#
# Triggers only for .ts, .js, .mjs files.
#
# Patterns checked:
#   - require('child_process') or require("child_process")
#   - require('vm') or require("vm")
#   - eval(
#   - new Function(
#   - dynamic require with variable: require(variable)
#
# Exit codes:
#   0 = OK (including advisory warnings — not blocking)

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
    "$(head -c 1024 "$HALT_FILE" 2>/dev/null || echo 'Reason unknown')" >&2
  exit 2
fi

FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

# ── Only trigger for .ts, .js, .mjs files ────────────────────────────────────
if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

case "$FILE_PATH" in
  *.ts|*.js|*.mjs) ;;
  *) exit 0 ;;
esac

# ── Extract written content ───────────────────────────────────────────────────
CONTENT=$(printf '%s' "$INPUT" | jq -r '.tool_input.content // empty' 2>/dev/null)

if [[ -z "$CONTENT" ]]; then
  exit 0
fi

# ── Scan for dangerous patterns ───────────────────────────────────────────────
WARNINGS=()

# require('child_process') or require("child_process")
if printf '%s' "$CONTENT" | grep -qE "require\(['\"]child_process['\"]"; then
  WARNINGS+=("require('child_process') — grants shell execution capability. Use safer alternatives or document the necessity.")
fi

# require('vm') or require("vm")
if printf '%s' "$CONTENT" | grep -qE "require\(['\"]vm['\"]"; then
  WARNINGS+=("require('vm') — Node.js VM module allows dynamic code execution. Ensure input is fully trusted and sandboxed.")
fi

# eval(
if printf '%s' "$CONTENT" | grep -qE '\beval\('; then
  WARNINGS+=("eval( — dynamic code evaluation is a code injection risk. Avoid unless the input is fully controlled and sanitized.")
fi

# new Function(
if printf '%s' "$CONTENT" | grep -qE '\bnew[[:space:]]+Function\('; then
  WARNINGS+=("new Function( — dynamic function construction is equivalent to eval. Avoid unless the input is fully controlled.")
fi

# Dynamic require with variable: require(variable) — not require('literal')
if printf '%s' "$CONTENT" | grep -qE "require\([^'\"][^)]*\)"; then
  WARNINGS+=("Dynamic require(variable) — loading modules by variable name can be exploited for path traversal. Prefer static imports.")
fi

# ESM dynamic import() of dangerous modules: await import('child_process'), import('vm').then(...)
if printf '%s' "$CONTENT" | grep -qE "import\(['\"]child_process['\"]"; then
  WARNINGS+=("import('child_process') — ESM dynamic import grants shell execution capability. Use safer alternatives or document the necessity.")
fi

if printf '%s' "$CONTENT" | grep -qE "import\(['\"]vm['\"]"; then
  WARNINGS+=("import('vm') — ESM dynamic import of Node.js VM module allows dynamic code execution. Ensure input is fully trusted and sandboxed.")
fi

# Dynamic import() with a variable or template literal: import(variable), import(\`...\`)
if printf '%s' "$CONTENT" | grep -qE "import\([^'\"(][^)]*\)"; then
  WARNINGS+=("Dynamic import(variable) — loading modules by variable name or template literal can be exploited for path traversal. Prefer static imports.")
fi

if [[ ${#WARNINGS[@]} -eq 0 ]]; then
  exit 0
fi

# ── Print advisory ────────────────────────────────────────────────────────────
{
  printf 'IMPORT-GUARD: Potentially dangerous import pattern in %s\n' "$(basename "$FILE_PATH")"
  for WARNING in "${WARNINGS[@]}"; do
    printf '  ADVISORY: %s\n' "$WARNING"
  done
  printf 'Note: This is advisory only. These patterns are not always unsafe but require review.\n'
} >&2

exit 0
