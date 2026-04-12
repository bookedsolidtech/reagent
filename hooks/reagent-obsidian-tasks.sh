#!/usr/bin/env bash
# reagent-obsidian-tasks.sh — Task sync to Obsidian individual notes
#
# Hook type: PostToolUse (fires after task_create, task_update MCP tools)
# Materializes task events as individual Obsidian notes with typed frontmatter.
# One-way sync: JSONL → Obsidian. Reverse sync deferred.
#
# Fail-silent: exits 0 even on error (non-blocking).
#
# Requires:
#   - /usr/local/bin/obsidian CLI installed
#   - REAGENT_OBSIDIAN_VAULT env var set
#   - obsidian_vault.sync.tasks: true in .reagent/gateway.yaml

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

# ── Guard: tasks sync enabled ────────────────────────────────────────
# Match sync.tasks specifically — use awk to only match within the sync: block
if ! awk '/^\s+sync:/{found=1} found && /tasks:\s*true/{exit 0} END{exit 1}' "$GATEWAY" 2>/dev/null; then
  exit 0
fi

# ── Guard: task store exists ──────────────────────────────────────────
if [[ ! -f "$TASK_STORE" ]]; then
  exit 0
fi

# ── Resolve vault name and tasks path ─────────────────────────────────
VAULT_NAME=$(grep 'vault_name:' "$GATEWAY" 2>/dev/null | head -1 | sed "s/.*vault_name:\s*['\"]*//" | sed "s/['\"].*//")
if [[ -z "$VAULT_NAME" ]]; then
  exit 0
fi

# Extract paths.tasks — use awk to match only within the paths: block (not sync:)
TASKS_PATH=$(awk '/^\s+paths:/{found=1} found && /tasks:/{print; exit}' "$GATEWAY" 2>/dev/null | sed "s/.*tasks:\s*['\"]*//" | sed "s/['\"].*//")
TASKS_PATH="${TASKS_PATH:-Tasks}"

PROJECT_NAME=$(basename "$(pwd)")

# ── Read tool result from stdin (Claude hook protocol) ────────────────
TOOL_RESULT=""
if [[ ! -t 0 ]]; then
  TOOL_RESULT=$(cat 2>/dev/null || true)
fi

# Extract task ID from the tool result JSON
TASK_ID=""
if [[ -n "$TOOL_RESULT" ]]; then
  TASK_ID=$(echo "$TOOL_RESULT" | grep -o '"id"\s*:\s*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
fi

# If we don't have a specific task ID, sync the most recent task
if [[ -z "$TASK_ID" ]]; then
  TASK_ID=$(tail -1 "$TASK_STORE" | grep -o '"id"\s*:\s*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
fi

if [[ -z "$TASK_ID" ]]; then
  exit 0
fi

# ── Extract task data from JSONL ──────────────────────────────────────
# Get the latest event for this task
TASK_LINE=$(grep "\"$TASK_ID\"" "$TASK_STORE" | tail -1)

if [[ -z "$TASK_LINE" ]]; then
  exit 0
fi

# Extract fields (simple grep — avoids jq dependency)
TITLE=$(echo "$TASK_LINE" | grep -o '"title"\s*:\s*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
STATUS=$(echo "$TASK_LINE" | grep -o '"status"\s*:\s*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
URGENCY=$(echo "$TASK_LINE" | grep -o '"urgency"\s*:\s*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
ASSIGNEE=$(echo "$TASK_LINE" | grep -o '"assignee"\s*:\s*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')

TITLE="${TITLE:-Untitled Task}"
STATUS="${STATUS:-created}"
URGENCY="${URGENCY:-normal}"

# ── Create/update note via Obsidian CLI ───────────────────────────────
NOTE_NAME="${TASK_ID} ${TITLE}"

CONTENT="---
reagent_managed: true
task_id: ${TASK_ID}
project: ${PROJECT_NAME}
status: ${STATUS}
urgency: ${URGENCY}
assignee: ${ASSIGNEE:-unassigned}
---

# ${TITLE}

- **ID:** ${TASK_ID}
- **Status:** ${STATUS}
- **Urgency:** ${URGENCY}
- **Assignee:** ${ASSIGNEE:-unassigned}
- **Project:** ${PROJECT_NAME}
"

# Create note (overwrites if exists)
"$OBSIDIAN_CLI" create \
  --vault "$VAULT_NAME" \
  --path "$TASKS_PATH" \
  --name "$NOTE_NAME" \
  -- "$CONTENT" 2>/dev/null || true

# Set properties via CLI for proper frontmatter handling
"$OBSIDIAN_CLI" property:set --vault "$VAULT_NAME" --file "${TASKS_PATH}/${NOTE_NAME}.md" \
  --name "status" --value "$STATUS" 2>/dev/null || true

exit 0
