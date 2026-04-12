#!/usr/bin/env bash
# reagent-obsidian-journal.sh — Session journaling to Obsidian daily note
#
# Hook type: Stop (fires when Claude Code session ends)
# Appends session summary to the project's daily note via Obsidian CLI.
# Fail-silent: exits 0 even on error (non-blocking).
#
# Requires:
#   - /usr/local/bin/obsidian CLI installed
#   - REAGENT_OBSIDIAN_VAULT env var set
#   - obsidian_vault.sync.journal: true in .reagent/gateway.yaml

set -euo pipefail

OBSIDIAN_CLI="/usr/local/bin/obsidian"
POLICY_DIR=".reagent"
GATEWAY="${POLICY_DIR}/gateway.yaml"
TASK_STORE="${POLICY_DIR}/tasks.jsonl"

# ── Guard: CLI available ──────────────────────────────────────────────
if [[ ! -x "$OBSIDIAN_CLI" ]]; then
  exit 0
fi

# ── Guard: gateway.yaml exists ────────────────────────────────────────
if [[ ! -f "$GATEWAY" ]]; then
  exit 0
fi

# ── Guard: journal sync enabled ──────────────────────────────────────
# Simple grep check — avoids YAML parsing dependency
if ! grep -q 'journal:\s*true' "$GATEWAY" 2>/dev/null; then
  exit 0
fi

# ── Resolve vault name ────────────────────────────────────────────────
VAULT_NAME=$(grep 'vault_name:' "$GATEWAY" 2>/dev/null | head -1 | sed "s/.*vault_name:\s*['\"]*//" | sed "s/['\"].*//")
if [[ -z "$VAULT_NAME" ]]; then
  exit 0
fi

# ── Build session summary ─────────────────────────────────────────────
PROJECT_NAME=$(basename "$(pwd)")
TIMESTAMP=$(date '+%Y-%m-%d %H:%M')
SESSION_ID="${RANDOM}"

SUMMARY="### ${PROJECT_NAME} — Session ${SESSION_ID} (${TIMESTAMP})\n"

# Materialize task state if task store exists
if [[ -f "$TASK_STORE" ]]; then
  COMPLETED=$(grep -c '"completed"' "$TASK_STORE" 2>/dev/null || echo "0")
  IN_PROGRESS=$(grep -c '"started"' "$TASK_STORE" 2>/dev/null || echo "0")
  BLOCKED=$(grep -c '"blocked"' "$TASK_STORE" 2>/dev/null || echo "0")
  CREATED=$(grep -c '"created"' "$TASK_STORE" 2>/dev/null || echo "0")

  SUMMARY="${SUMMARY}- Completed: ${COMPLETED}\n"
  SUMMARY="${SUMMARY}- In Progress: ${IN_PROGRESS}\n"
  SUMMARY="${SUMMARY}- Blocked: ${BLOCKED}\n"
  SUMMARY="${SUMMARY}- Backlog: ${CREATED}\n"
else
  SUMMARY="${SUMMARY}- No task store found\n"
fi

SUMMARY="${SUMMARY}\n---\n"

# ── Append to daily note ──────────────────────────────────────────────
"$OBSIDIAN_CLI" daily:append --vault "$VAULT_NAME" -- "$(echo -e "$SUMMARY")" 2>/dev/null || true

exit 0
