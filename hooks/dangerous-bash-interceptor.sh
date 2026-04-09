#!/bin/bash
# PreToolUse hook: dangerous-bash-interceptor.sh
# Fires BEFORE every Bash tool call.
# Detects destructive shell commands and blocks them (exit 2) or warns (exit 0).
#
# Compatible with: interactive sessions + headless Docker (no TTY required).
# All diagnostic output goes to stderr only.
#
# Content extraction:
#   Bash tool → tool_input.command
#
# Exit codes:
#   0 = safe or advisory-only — allow the command to run
#   2 = HIGH severity danger detected — block the command with feedback

set -uo pipefail

# ── 1. Read ALL stdin immediately before doing anything else ──────────────────
INPUT=$(cat)

# ── 2. Dependency check ───────────────────────────────────────────────────────
if ! command -v jq >/dev/null 2>&1; then
  printf 'REAGENT ERROR: jq is required but not installed.\n' >&2
  printf 'Install: brew install jq  OR  apt-get install -y jq\n' >&2
  exit 2
fi

# ── 3. HALT check ─────────────────────────────────────────────────────────────
REAGENT_ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
HALT_FILE="${REAGENT_ROOT}/.reagent/HALT"
if [ -f "$HALT_FILE" ]; then
  printf 'REAGENT HALT: %s\nAll agent operations suspended. Run: reagent unfreeze\n' \
    "$(head -c 1024 "$HALT_FILE" 2>/dev/null || echo 'Reason unknown')" >&2
  exit 2
fi

# ── 4. Parse tool_input.command from the hook payload ─────────────────────────
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

if [[ -z "$CMD" ]]; then
  exit 0
fi

# ── 5. Helper: truncate command for display ────────────────────────────────────
truncate_cmd() {
  local STR="$1"
  local MAX=200
  if [[ ${#STR} -gt $MAX ]]; then
    printf '%s' "${STR:0:$MAX}..."
  else
    printf '%s' "$STR"
  fi
}

# ── 6. Violation accumulators ──────────────────────────────────────────────────
HIGH_FILE=$(mktemp "${TMPDIR:-/tmp}/reagent-bash-high-XXXXXX")
MEDIUM_FILE=$(mktemp "${TMPDIR:-/tmp}/reagent-bash-medium-XXXXXX")

cleanup_violations() {
  rm -f "$HIGH_FILE" "$MEDIUM_FILE"
}
trap cleanup_violations EXIT

add_high() {
  local LABEL="$1"
  local DETAIL="$2"
  shift 2
  printf 'HIGH|%s|%s\n' "$LABEL" "$DETAIL" >> "$HIGH_FILE"
  for ALT in "$@"; do
    printf 'ALT:%s\n' "$ALT" >> "$HIGH_FILE"
  done
  printf 'END_VIOLATION\n' >> "$HIGH_FILE"
}

add_medium() {
  local LABEL="$1"
  local DETAIL="$2"
  shift 2
  printf 'MEDIUM|%s|%s\n' "$LABEL" "$DETAIL" >> "$MEDIUM_FILE"
  for ALT in "$@"; do
    printf 'ALT:%s\n' "$ALT" >> "$MEDIUM_FILE"
  done
  printf 'END_VIOLATION\n' >> "$MEDIUM_FILE"
}

# ── 7. Per-segment evaluation helper ──────────────────────────────────────────
# Split on &&, ||, ;, and newlines and test a pattern against each segment.
# Returns 0 if ANY segment matches the pattern.
any_segment_matches() {
  local PATTERN="$1"
  while IFS= read -r SEG; do
    if printf '%s' "$SEG" | grep -qiE "$PATTERN"; then
      return 0
    fi
  done < <(printf '%s' "$CMD" | sed 's/&&/\n/g; s/||/\n/g; s/;/\n/g')
  return 1
}

# ── 8. Smart exclusion flags ──────────────────────────────────────────────────
CMD_IS_REBASE_SAFE=0
if printf '%s' "$CMD" | grep -qiE 'git[[:space:]]+(rebase)[[:space:]].*(--abort|--continue)'; then
  CMD_IS_REBASE_SAFE=1
fi

CMD_IS_CLEAN_DRY=0
if printf '%s' "$CMD" | grep -qiE 'git[[:space:]]+clean.*([ \t]-n|--dry-run)'; then
  CMD_IS_CLEAN_DRY=1
fi

# ── 9. HIGH severity checks ────────────────────────────────────────────────────

# H1: git push --force or -f (per-segment — prevents --force-with-lease poisoning)
# A segment containing --force-with-lease is excluded; other segments are not.
while IFS= read -r SEGMENT; do
  SEGMENT=$(printf '%s' "$SEGMENT" | sed 's/^[[:space:]]*//')
  [[ -z "$SEGMENT" ]] && continue
  # Skip segments that use the safe --force-with-lease
  if printf '%s' "$SEGMENT" | grep -qiE 'git[[:space:]]+push.*--force-with-lease'; then
    continue
  fi
  if printf '%s' "$SEGMENT" | grep -qiE 'git[[:space:]]+push.*(--force|-f[[:space:]])' || \
     printf '%s' "$SEGMENT" | grep -qiE 'git[[:space:]]+push.*(--force|-f)$'; then
    add_high \
      "git push --force — force push detected" \
      "Force-pushing rewrites public history and breaks collaborators' local copies." \
      "Alt: Use 'git push --force-with-lease' — blocks if upstream has new commits you haven't pulled."
    break
  fi
done < <(printf '%s' "$CMD" | sed 's/&&/\n/g; s/||/\n/g; s/;/\n/g')

# H2: git rebase — advisory (MEDIUM)
if [[ $CMD_IS_REBASE_SAFE -eq 0 ]]; then
  if printf '%s' "$CMD" | grep -qiE 'git[[:space:]]+rebase([[:space:]]|$)'; then
    add_medium \
      "git rebase — rewrites commit history (advisory)" \
      "Rebase changes commit SHAs. Safe on local feature branches; dangerous on shared/published branches." \
      "Alt: 'git merge origin/main' preserves history (creates merge commit)." \
      "     'git rebase --abort' to cancel if in progress."
  fi
fi

# H3: git checkout -- .
if printf '%s' "$CMD" | grep -qiE 'git[[:space:]]+checkout[[:space:]]+--[[:space:]]+\.'; then
  add_high \
    "git checkout -- . — discards all uncommitted changes" \
    "Overwrites working tree changes with HEAD. Uncommitted work is lost permanently." \
    "Alt: 'git stash' to temporarily shelve changes, 'git restore <file>' for individual files."
fi

# H4: git restore . (any form — with or without --staged flag)
if printf '%s' "$CMD" | grep -qiE 'git[[:space:]]+restore[[:space:]].*[[:space:]]\.([[:space:]]|$)' || \
   printf '%s' "$CMD" | grep -qiE 'git[[:space:]]+restore[[:space:]]+\.[[:space:]]*$'; then
  add_high \
    "git restore . — discards all uncommitted changes" \
    "Restores every tracked file to HEAD, permanently discarding all working tree modifications." \
    "Alt: 'git stash' to save changes temporarily, or restore individual files: 'git restore <file>'."
fi

# H5: git clean -f
if [[ $CMD_IS_CLEAN_DRY -eq 0 ]]; then
  if printf '%s' "$CMD" | grep -qiE 'git[[:space:]]+clean[[:space:]]+-[a-zA-Z]*f'; then
    add_high \
      "git clean -f — removes untracked files" \
      "Permanently deletes untracked files from the working tree. Cannot be undone via git." \
      "Alt: 'git clean -n' (dry-run) to preview what would be deleted before committing."
  fi
fi

# H6: DROP TABLE or DROP DATABASE in psql
if printf '%s' "$CMD" | grep -qiE '(psql|pgcli)[^|&;]*DROP[[:space:]]+(TABLE|DATABASE|SCHEMA)'; then
  add_high \
    "DROP TABLE/DATABASE via psql — destructive DDL" \
    "Running destructive DDL directly in psql bypasses migration pipeline safety checks." \
    "Alt: Use your project's migration tool. Never run DROP via ad-hoc psql."
fi

# H7: kill -9 with pgrep subshell
if printf '%s' "$CMD" | grep -qiE 'kill[[:space:]]+-9[[:space:]]+(\$\(|`)'; then
  add_high \
    "kill -9 with pgrep subshell — aggressive process termination" \
    "Sends SIGKILL to processes matched by name, which may kill unintended processes." \
    "Alt: 'kill -15 <pid>' (SIGTERM) for graceful shutdown."
fi

# H8: killall -9
if printf '%s' "$CMD" | grep -qiE 'killall[[:space:]]+-9[[:space:]]+\S'; then
  add_high \
    "killall -9 — SIGKILL all matching processes" \
    "Immediately terminates all processes with the given name without cleanup." \
    "Alt: 'killall -15 <name>' (SIGTERM) allows graceful shutdown."
fi

# H9: git commit --no-verify
if printf '%s' "$CMD" | grep -qiE 'git[[:space:]]+commit.*--no-verify'; then
  add_high \
    "git commit --no-verify — skipping pre-commit hooks" \
    "Bypasses all pre-commit safety gates including secret scanning and linting." \
    "Alt: Fix the underlying hook failure rather than bypassing it."
fi

# H10: HUSKY=0 bypass — suppresses all git hooks without --no-verify
if printf '%s' "$CMD" | grep -qiE '(^|[[:space:];]|&&|\|\|)HUSKY=0[[:space:]]+git[[:space:]]+(commit|push|tag)'; then
  add_high \
    "HUSKY=0 — bypasses all husky git hooks" \
    "Setting HUSKY=0 disables pre-commit, commit-msg, and pre-push safety gates without --no-verify." \
    "Alt: Fix the underlying hook failure rather than suppressing all hooks."
fi

# H11: rm -rf with broad targets
# Covers combined flags (rm -rf, rm -fr), split flags (rm -r -f), and long flags (rm --recursive --force)
BROAD_TARGETS='(\/|~\/|\.\/\*|\*|\.|src|dist|build|node_modules)'
if printf '%s' "$CMD" | grep -qiE "rm[[:space:]]+-[a-zA-Z]*r[a-zA-Z]*f[[:space:]]+${BROAD_TARGETS}" || \
   printf '%s' "$CMD" | grep -qiE "rm[[:space:]]+-[a-zA-Z]*f[a-zA-Z]*r[[:space:]]+${BROAD_TARGETS}" || \
   printf '%s' "$CMD" | grep -qiE "rm[[:space:]]+-[a-zA-Z]*r[[:space:]]+-[a-zA-Z]*f[[:space:]]+${BROAD_TARGETS}" || \
   printf '%s' "$CMD" | grep -qiE "rm[[:space:]]+-[a-zA-Z]*f[[:space:]]+-[a-zA-Z]*r[[:space:]]+${BROAD_TARGETS}" || \
   printf '%s' "$CMD" | grep -qiE "rm[[:space:]]+--recursive[[:space:]]+--force[[:space:]]+${BROAD_TARGETS}" || \
   printf '%s' "$CMD" | grep -qiE "rm[[:space:]]+--force[[:space:]]+--recursive[[:space:]]+${BROAD_TARGETS}"; then
  add_high \
    "rm -rf with broad target — mass file deletion" \
    "Permanently deletes files and directories. Cannot be undone." \
    "Alt: Move to a temp location first, or use 'rm -ri' for interactive deletion."
fi

# H12: curl/wget piped directly to shell (supply chain attack vector)
if printf '%s' "$CMD" | grep -qiE '(curl|wget)[^|]*\|[[:space:]]*(bash|sh|zsh|fish)'; then
  add_high \
    "curl/wget piped to shell — remote code execution" \
    "Executing remote scripts without inspection is a major supply chain risk." \
    "Alt: Download first, inspect the script, then execute: curl -o script.sh URL && cat script.sh && bash script.sh"
fi

# ── 10. MEDIUM severity checks ────────────────────────────────────────────────

# M1: npm install --force
if printf '%s' "$CMD" | grep -qiE 'npm[[:space:]]+(install|i)[[:space:]].*--force'; then
  add_medium \
    "npm install --force — bypasses dependency resolution" \
    "--force skips conflict checks and can install incompatible package versions." \
    "Alt: Resolve the dependency conflict explicitly. Use --legacy-peer-deps if needed."
fi

# ── 11. Evaluate and report ───────────────────────────────────────────────────

TRUNCATED_CMD=$(truncate_cmd "$CMD")

print_violations() {
  local VF="$1"
  local NOTE_LABEL="$2"
  while IFS= read -r LINE; do
    case "$LINE" in
      HIGH\|*|MEDIUM\|*)
        local SEV LABEL DETAIL
        SEV=$(printf '%s' "$LINE" | cut -d'|' -f1)
        LABEL=$(printf '%s' "$LINE" | cut -d'|' -f2)
        DETAIL=$(printf '%s' "$LINE" | cut -d'|' -f3)
        printf '  %s: %s\n' "$SEV" "$LABEL"
        printf '  %s: %s\n' "$NOTE_LABEL" "$DETAIL"
        ;;
      ALT:*)
        printf '  %s\n' "${LINE#ALT:}"
        ;;
      END_VIOLATION)
        printf '\n'
        ;;
    esac
  done < "$VF"
}

if [[ -s "$HIGH_FILE" ]]; then
  {
    printf 'BASH INTERCEPTED: Dangerous command blocked\n'
    print_violations "$HIGH_FILE" "Reason"
    printf '  BLOCKED COMMAND: %s\n' "$TRUNCATED_CMD"
  } >&2
  exit 2
fi

if [[ -s "$MEDIUM_FILE" ]]; then
  {
    printf 'BASH ADVISORY: Potentially risky command (not blocked)\n'
    print_violations "$MEDIUM_FILE" "Note"
    printf '  COMMAND: %s\n' "$TRUNCATED_CMD"
  } >&2
  exit 0
fi

exit 0
