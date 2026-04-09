#!/bin/bash
# PreToolUse hook: dependency-audit-gate.sh
# Fires BEFORE every Bash tool call.
# Detects package install commands (npm install, pnpm add, yarn add) and
# verifies the package exists on the registry before allowing the install.
#
# Exit codes:
#   0 = allow (not an install command, or package verified)
#   2 = block (package not found on registry)

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

# ── 5. Detect package install commands ────────────────────────────────────────
# Match: npm install <pkg>, npm i <pkg>, pnpm add <pkg>, yarn add <pkg>
# Skip: npm install (no args), npm ci, npm install --save-dev (without new pkg)

extract_packages() {
  local cmd="$1"

  # npm install/add with packages (skip flags and local paths)
  if printf '%s' "$cmd" | grep -qiE '(npm[[:space:]]+(install|i|add)|pnpm[[:space:]]+(add|install)|yarn[[:space:]]+add)[[:space:]]'; then
    # Extract the part after the install command
    local after_cmd
    after_cmd=$(printf '%s' "$cmd" | sed -E 's/.*(npm[[:space:]]+(install|i|add)|pnpm[[:space:]]+(add|install)|yarn[[:space:]]+add)[[:space:]]+//')

    # Split on spaces and filter
    for token in $after_cmd; do
      # Skip flags
      if [[ "$token" == -* ]]; then continue; fi
      # Skip local paths
      if [[ "$token" == ./* || "$token" == /* || "$token" == ../* ]]; then continue; fi
      # Skip empty
      if [[ -z "$token" ]]; then continue; fi
      # Strip version specifier for lookup
      local pkg_name
      pkg_name=$(printf '%s' "$token" | sed -E 's/@[^@/]+$//')
      # Handle scoped packages (@scope/name)
      if [[ -z "$pkg_name" ]]; then
        pkg_name="$token"
      fi
      printf '%s\n' "$pkg_name"
    done
  fi
}

PACKAGES=$(extract_packages "$CMD")

if [[ -z "$PACKAGES" ]]; then
  exit 0
fi

# ── 6. Verify packages exist on registry ──────────────────────────────────────
FAILED=""
CHECKED=0

while IFS= read -r pkg; do
  [[ -z "$pkg" ]] && continue
  CHECKED=$((CHECKED + 1))

  # Cap at 5 packages per command to avoid slow hook
  if [[ $CHECKED -gt 5 ]]; then
    break
  fi

  # Use npm view to check if package exists
  # macOS doesn't have `timeout` by default, use a background process with kill
  if command -v timeout >/dev/null 2>&1; then
    if ! timeout 5 npm view "$pkg" name >/dev/null 2>&1; then
      FAILED="${FAILED}  - ${pkg}\n"
    fi
  else
    # Fallback: run npm view without timeout (still fast for simple checks)
    if ! npm view "$pkg" name >/dev/null 2>&1; then
      FAILED="${FAILED}  - ${pkg}\n"
    fi
  fi
done <<< "$PACKAGES"

if [[ -n "$FAILED" ]]; then
  {
    printf 'DEPENDENCY AUDIT: Package not found on npm registry\n'
    printf '\n'
    printf '  The following packages could not be verified:\n'
    printf '%b' "$FAILED"
    printf '\n'
    printf '  Rule: All packages must exist on the npm registry before installation.\n'
    printf '  Check: Is the package name spelled correctly? Does it exist on npmjs.com?\n'
  } >&2
  exit 2
fi

exit 0
