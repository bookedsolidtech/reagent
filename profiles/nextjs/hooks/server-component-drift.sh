#!/bin/bash
# profiles/nextjs/hooks/server-component-drift.sh
# PostToolUse hook for Write — detects server component drift in Next.js App Router.
# Warns on client-only hooks in server components, and dangerouslySetInnerHTML.
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

# Only target .tsx and .ts files
if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi
case "$FILE_PATH" in
  *.tsx|*.ts) ;;
  *) exit 0 ;;
esac

if [[ ! -f "$FILE_PATH" ]]; then
  exit 0
fi

CONTENT=$(cat "$FILE_PATH" 2>/dev/null || echo "")
WARNINGS=()

# Check 1: Client hooks in files without 'use client' directive
HAS_USE_CLIENT=0
if printf '%s' "$CONTENT" | head -3 | grep -qE "^['\"]use client['\"]"; then
  HAS_USE_CLIENT=1
fi

if [[ $HAS_USE_CLIENT -eq 0 ]]; then
  if printf '%s' "$CONTENT" | grep -qE '\b(useState|useEffect|useContext|useReducer|useCallback|useMemo|useRef|useTransition|useDeferredValue|useId)\s*[(<(]'; then
    WARNINGS+=("NEXTJS SERVER COMPONENT: React hook (useState/useEffect/etc.) found in file without 'use client' directive at the top. Either add '\"use client\"' as the first line, or move client-side logic to a child component.")
  fi
fi

# Check 2: dangerouslySetInnerHTML anywhere
if printf '%s' "$CONTENT" | grep -qE 'dangerouslySetInnerHTML'; then
  WARNINGS+=("NEXTJS SECURITY: 'dangerouslySetInnerHTML' detected. This is an XSS risk unless the content is explicitly sanitized. If needed, use a sanitization library like DOMPurify and document why this is safe.")
fi

# Check 3: 'use client' in a file that only does data fetching (likely unnecessary)
if [[ $HAS_USE_CLIENT -eq 1 ]]; then
  if printf '%s' "$CONTENT" | grep -qE '\b(fetch|prisma\.|db\.|supabase\.|sql`|pool\.query)\b' && \
     ! printf '%s' "$CONTENT" | grep -qE '\b(useState|useEffect|onClick|onChange|onSubmit)\b'; then
    WARNINGS+=("NEXTJS SERVER COMPONENT: 'use client' is declared but this file appears to only do data fetching with no interactive UI. Consider removing 'use client' and using a Server Component — this avoids sending data-fetching code to the browser.")
  fi
fi

if [[ ${#WARNINGS[@]} -gt 0 ]]; then
  printf '\n[server-component-drift] Next.js advisory warnings for %s:\n' "$FILE_PATH" >&2
  for warning in "${WARNINGS[@]}"; do
    printf '  WARN: %s\n' "$warning" >&2
  done
  printf '\n' >&2
fi

exit 0
