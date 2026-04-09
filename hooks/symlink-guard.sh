#!/bin/bash
# PreToolUse hook: symlink-guard.sh
# Fires BEFORE every Write tool call.
# Resolves the target file path and blocks if it escapes the project root.
# Guards against symlink traversal attacks where a path resolves outside the repo.
#
# Content extraction:
#   Write tool → tool_input.file_path
#
# Exit codes:
#   0 = path is within project root — allow
#   2 = path escapes project root  — block

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

TOOL_NAME=$(printf '%s' "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)

# Only applies to Write tool
if [[ "$TOOL_NAME" != "Write" ]]; then
  exit 0
fi

FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

# ── Determine project root ────────────────────────────────────────────────────
# Walk up from CLAUDE_PROJECT_DIR looking for .claude/ directory
PROJECT_ROOT=""
SEARCH_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
while [[ "$SEARCH_DIR" != "/" ]]; do
  if [[ -d "$SEARCH_DIR/.claude" ]] || [[ -d "$SEARCH_DIR/.reagent" ]]; then
    PROJECT_ROOT="$SEARCH_DIR"
    break
  fi
  SEARCH_DIR=$(dirname "$SEARCH_DIR")
done

if [[ -z "$PROJECT_ROOT" ]]; then
  PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
fi

# ── Resolve the file path (no-symlinks) ───────────────────────────────────────
# Use python3 for portable path resolution since realpath --no-symlinks
# is not universally available (macOS ships an older realpath)
if command -v python3 >/dev/null 2>&1; then
  RESOLVED=$(python3 -c "
import os, sys
p = sys.argv[1]
# os.path.realpath resolves symlinks; we use normpath for lexical-only resolution
# to detect path traversal without requiring the path to exist
print(os.path.normpath(os.path.abspath(p)))
" "$FILE_PATH" 2>/dev/null)
elif command -v realpath >/dev/null 2>&1; then
  # Fallback: realpath without --canonicalize-missing may still work on some systems
  RESOLVED=$(realpath -m "$FILE_PATH" 2>/dev/null || realpath "$FILE_PATH" 2>/dev/null || printf '%s' "$FILE_PATH")
else
  # Last resort: use pwd-relative normalization
  RESOLVED=$(cd "$(dirname "$FILE_PATH")" 2>/dev/null && pwd)/$(basename "$FILE_PATH") || printf '%s' "$FILE_PATH"
fi

# ── Check if resolved path is within project root ─────────────────────────────
RESOLVED_PROJECT=$(python3 -c "import os; print(os.path.normpath(os.path.abspath('$PROJECT_ROOT')))" 2>/dev/null || printf '%s' "$PROJECT_ROOT")

# Path must start with project root followed by / or be exactly the root
if [[ "$RESOLVED" != "$RESOLVED_PROJECT"/* ]] && [[ "$RESOLVED" != "$RESOLVED_PROJECT" ]]; then
  printf 'SYMLINK-GUARD: Path escapes project root — blocked\n' >&2
  printf '  Requested path: %s\n' "$FILE_PATH" >&2
  printf '  Resolved path:  %s\n' "$RESOLVED" >&2
  printf '  Project root:   %s\n' "$RESOLVED_PROJECT" >&2
  printf 'Block reason: The resolved path is outside the project directory.\n' >&2
  printf 'This may indicate a symlink traversal attempt or an incorrect absolute path.\n' >&2
  exit 2
fi

exit 0
