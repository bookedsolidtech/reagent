#!/bin/bash
# profiles/lit-wc/hooks/shadow-dom-guard.sh
# PostToolUse hook for Write — validates Shadow DOM usage patterns in Lit/Web Components.
# Warns on anti-patterns: direct document queries, missing :host scoping, unsafe customElements.define.
# Advisory only — exits 0 after printing warnings.

set -euo pipefail

HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
LIB="$HOOK_DIR/../../../hooks/_lib/common.sh"
if [[ -f "$LIB" ]]; then
  # shellcheck source=hooks/_lib/common.sh
  source "$LIB"
  check_halt
fi

# Read tool input from stdin
INPUT=$(cat)
TOOL_NAME=$(printf '%s' "$INPUT" | grep -o '"tool_name":"[^"]*"' | head -1 | cut -d'"' -f4 2>/dev/null || echo "")
FILE_PATH=$(printf '%s' "$INPUT" | grep -o '"path":"[^"]*"' | head -1 | cut -d'"' -f4 2>/dev/null || echo "")

# Only run on Write tool
if [[ "$TOOL_NAME" != "Write" && "$TOOL_NAME" != "Edit" ]]; then
  exit 0
fi

# Only target .ts, .js files (web component source)
if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi
case "$FILE_PATH" in
  *.ts|*.js) ;;
  *) exit 0 ;;
esac

# Only warn if file exists (was just written)
if [[ ! -f "$FILE_PATH" ]]; then
  exit 0
fi

CONTENT=$(cat "$FILE_PATH" 2>/dev/null || echo "")
WARNINGS=()

# Check 1: document.querySelector / document.getElementById inside HTMLElement/LitElement subclass
if printf '%s' "$CONTENT" | grep -qE 'extends\s+(HTMLElement|LitElement)'; then
  if printf '%s' "$CONTENT" | grep -qE 'document\.(querySelector|getElementById|getElementsBy)'; then
    WARNINGS+=("SHADOW DOM: 'document.querySelector/getElementById' found inside a web component. Use 'this.shadowRoot?.querySelector()' instead to avoid escaping the shadow boundary.")
  fi
fi

# Check 2: CSS selectors without :host scoping (look for <style> or css`` template literals with bare selectors)
if printf '%s' "$CONTENT" | grep -qE "css\`[^$]*\`|<style>"; then
  # Look for top-level selectors that are NOT :host or :root
  if printf '%s' "$CONTENT" | grep -qE '^\s*(\.[\w-]+|#[\w-]+|\w+\s*\{)' && \
     ! printf '%s' "$CONTENT" | grep -qE '^\s*:host'; then
    WARNINGS+=("SHADOW DOM: CSS without ':host' scoping detected. All styles in web components should be scoped via ':host { }' to prevent style leakage.")
  fi
fi

# Check 3: customElements.define without guard
if printf '%s' "$CONTENT" | grep -qE 'customElements\.define\('; then
  if ! printf '%s' "$CONTENT" | grep -qE 'customElements\.get\(|!customElements\.get\('; then
    WARNINGS+=("SHADOW DOM: 'customElements.define()' called without checking 'customElements.get(name)' first. This will throw if the element is defined twice (e.g., in tests or HMR). Guard with: if (!customElements.get('my-el')) customElements.define('my-el', MyEl)")
  fi
fi

# Print warnings as advisories
if [[ ${#WARNINGS[@]} -gt 0 ]]; then
  printf '\n[shadow-dom-guard] Web Component advisory warnings for %s:\n' "$FILE_PATH" >&2
  for warning in "${WARNINGS[@]}"; do
    printf '  WARN: %s\n' "$warning" >&2
  done
  printf '\n' >&2
fi

exit 0
