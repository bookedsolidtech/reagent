#!/bin/bash
# profiles/drupal/hooks/drupal-coding-standards.sh
# PostToolUse hook for Write — warns on Drupal anti-patterns in PHP/module/theme files.
# Checks for: raw superglobals, hardcoded entity IDs, hook_update_N without schema bump.
# Advisory only — exits 0 after printing warnings.

set -euo pipefail

HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
LIB="$HOOK_DIR/../../../hooks/_lib/common.sh"
if [[ -f "$LIB" ]]; then
  source "$LIB"
  check_halt
  check_project_type "drupal"
fi

INPUT=$(cat)
TOOL_NAME=$(printf '%s' "$INPUT" | grep -o '"tool_name":"[^"]*"' | head -1 | cut -d'"' -f4 2>/dev/null || echo "")
FILE_PATH=$(printf '%s' "$INPUT" | grep -o '"path":"[^"]*"' | head -1 | cut -d'"' -f4 2>/dev/null || echo "")

if [[ "$TOOL_NAME" != "Write" && "$TOOL_NAME" != "Edit" ]]; then
  exit 0
fi

# Only target Drupal PHP files
if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi
case "$FILE_PATH" in
  *.php|*.module|*.theme|*.install) ;;
  *) exit 0 ;;
esac

if [[ ! -f "$FILE_PATH" ]]; then
  exit 0
fi

CONTENT=$(cat "$FILE_PATH" 2>/dev/null || echo "")
WARNINGS=()

# Check 1: Raw superglobal access — should use \Drupal::request()
if printf '%s' "$CONTENT" | grep -qE '\$_(GET|POST|REQUEST|SERVER)\['; then
  WARNINGS+=("DRUPAL: Direct superglobal access (\$_GET, \$_POST, \$_REQUEST, \$_SERVER) detected. Use \\Drupal::request()->query->get() or \\Drupal::request()->request->get() for proper sanitization and testability.")
fi

# Check 2: Hardcoded numeric node/entity IDs in templates or module files
if printf '%s' "$CONTENT" | grep -qE "(Node::load|\\\\Drupal::entityTypeManager\(\)->getStorage\('node'\)->load\(|nid\s*=\s*[0-9]+|->load\([0-9]+\))"; then
  WARNINGS+=("DRUPAL: Hardcoded numeric entity/node ID detected. Use configuration, a content reference field, or \Drupal::config() instead of load(42) — hardcoded IDs break between environments.")
fi

# Check 3: hook_update_N without schema version bump check
if printf '%s' "$CONTENT" | grep -qE 'function [a-z_]+_update_[0-9]+'; then
  if ! printf '%s' "$CONTENT" | grep -qE 'schema_version|hook_update_dependencies|db_change_table|Schema::'; then
    WARNINGS+=("DRUPAL: hook_update_N() found without apparent schema version management. Ensure \$sandbox['#finished'] logic is correct for batched updates, and verify schema version alignment via hook_update_dependencies() if needed.")
  fi
fi

# Check 4: t() with concatenated strings (breaks localization)
if printf '%s' "$CONTENT" | grep -qE "t\(['\"].*\\\$[a-zA-Z_]|t\(['\"].*'\s*\.\s*\\\$"; then
  WARNINGS+=("DRUPAL: String concatenation inside t() detected. Use placeholders ('@var', '%var', ':url') instead: t('Hello @name', ['@name' => \$name]). Concatenation breaks translation extraction.")
fi

if [[ ${#WARNINGS[@]} -gt 0 ]]; then
  printf '\n[drupal-coding-standards] Advisory warnings for %s:\n' "$FILE_PATH" >&2
  for warning in "${WARNINGS[@]}"; do
    printf '  WARN: %s\n' "$warning" >&2
  done
  printf '\n' >&2
fi

exit 0
