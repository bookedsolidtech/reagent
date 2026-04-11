#!/bin/bash
# profiles/astro/hooks/astro-ssr-guard.sh
# PostToolUse hook for Write — warns on Astro SSR anti-patterns in .astro files.
# Checks for: React hooks in non-client context, document/window in frontmatter.
# Advisory only — exits 0 after printing warnings.

set -euo pipefail

HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
LIB="$HOOK_DIR/../../../hooks/_lib/common.sh"
if [[ -f "$LIB" ]]; then
  source "$LIB"
  check_halt
  check_project_type "astro"
fi

INPUT=$(cat)
TOOL_NAME=$(printf '%s' "$INPUT" | grep -o '"tool_name":"[^"]*"' | head -1 | cut -d'"' -f4 2>/dev/null || echo "")
FILE_PATH=$(printf '%s' "$INPUT" | grep -o '"path":"[^"]*"' | head -1 | cut -d'"' -f4 2>/dev/null || echo "")

if [[ "$TOOL_NAME" != "Write" && "$TOOL_NAME" != "Edit" ]]; then
  exit 0
fi

# Only target .astro files
case "$FILE_PATH" in
  *.astro) ;;
  *) exit 0 ;;
esac

if [[ ! -f "$FILE_PATH" ]]; then
  exit 0
fi

CONTENT=$(cat "$FILE_PATH" 2>/dev/null || echo "")
WARNINGS=()

# Extract frontmatter (between --- delimiters)
FRONTMATTER=""
if printf '%s' "$CONTENT" | grep -q '^---'; then
  FRONTMATTER=$(printf '%s' "$CONTENT" | awk '/^---/{if(f)exit; f=1; next} f{print}')
fi

# Check 1: React hooks in .astro files — only valid in client:* components
if printf '%s' "$CONTENT" | grep -qE '\b(useState|useEffect|useContext|useReducer|useCallback|useMemo|useRef)\s*[(<(]'; then
  # Check if it's inside a component tag with client: directive
  if ! printf '%s' "$CONTENT" | grep -qE 'client:(load|idle|visible|media|only)'; then
    WARNINGS+=("ASTRO SSR: React hook (useState/useEffect/etc.) found but no 'client:*' directive detected in this file. React hooks only run in client-rendered components. Add 'client:load' (or other hydration strategy) to the component tag, or move hooks to a .tsx component used with 'client:load'.")
  fi
fi

# Check 2: document or window in frontmatter (SSR context — not available server-side)
if [[ -n "$FRONTMATTER" ]]; then
  if printf '%s' "$FRONTMATTER" | grep -qE '\b(document|window)\b'; then
    WARNINGS+=("ASTRO SSR: 'document' or 'window' accessed in Astro frontmatter (the --- block). Frontmatter runs at build time / server-side where these globals are not available. Move browser API calls into a <script> tag or a client:* component.")
  fi
fi

# Check 3: import of useState/useEffect at top of frontmatter without client usage
if printf '%s' "$FRONTMATTER" | grep -qE "import.*\{.*(useState|useEffect).*\}.*from\s+['\"]react['\"]"; then
  if ! printf '%s' "$CONTENT" | grep -qE 'client:(load|idle|visible|media|only)'; then
    WARNINGS+=("ASTRO SSR: React state/effect hooks imported in frontmatter without a 'client:*' component. This import will likely cause an error at runtime in SSR mode.")
  fi
fi

if [[ ${#WARNINGS[@]} -gt 0 ]]; then
  printf '\n[astro-ssr-guard] Astro SSR advisory warnings for %s:\n' "$FILE_PATH" >&2
  for warning in "${WARNINGS[@]}"; do
    printf '  WARN: %s\n' "$warning" >&2
  done
  printf '\n' >&2
fi

exit 0
