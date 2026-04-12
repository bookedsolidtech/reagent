#!/usr/bin/env bash
# reagent-obsidian-precompact.sh — Knowledge extraction before context compaction
#
# Hook type: PreCompact (fires before Claude Code compacts context)
# Spawns a subprocess to extract durable knowledge from the transcript
# and creates a session knowledge note in Obsidian.
#
# Disabled by default (precompact: false in gateway.yaml).
# Fail-silent: exits 0 even on error (non-blocking).
#
# Requires:
#   - /usr/local/bin/obsidian CLI installed
#   - REAGENT_OBSIDIAN_VAULT env var set
#   - obsidian_vault.sync.precompact: true in .reagent/gateway.yaml

set -euo pipefail

OBSIDIAN_CLI="/usr/local/bin/obsidian"
POLICY_DIR=".reagent"
GATEWAY="${POLICY_DIR}/gateway.yaml"

# ── Guard: CLI available ──────────────────────────────────────────────
if [[ ! -x "$OBSIDIAN_CLI" ]]; then
  exit 0
fi

# ── Guard: gateway.yaml exists ────────────────────────────────────────
if [[ ! -f "$GATEWAY" ]]; then
  exit 0
fi

# ── Guard: precompact sync enabled ───────────────────────────────────
if ! grep -q 'precompact:\s*true' "$GATEWAY" 2>/dev/null; then
  exit 0
fi

# ── Resolve vault name and sessions path ──────────────────────────────
VAULT_NAME=$(grep 'vault_name:' "$GATEWAY" 2>/dev/null | head -1 | sed "s/.*vault_name:\s*['\"]*//" | sed "s/['\"].*//")
if [[ -z "$VAULT_NAME" ]]; then
  exit 0
fi

SESSIONS_PATH=$(grep 'sessions:' "$GATEWAY" 2>/dev/null | head -1 | sed "s/.*sessions:\s*['\"]*//" | sed "s/['\"].*//")
SESSIONS_PATH="${SESSIONS_PATH:-Wiki/Sessions}"

# ── Resolve engine ────────────────────────────────────────────────────
ENGINE=$(grep 'engine:' "$GATEWAY" 2>/dev/null | head -1 | sed "s/.*engine:\s*['\"]*//" | sed "s/['\"].*//")
ENGINE="${ENGINE:-claude}"

PROJECT_NAME=$(basename "$(pwd)")
DATE=$(date '+%Y-%m-%d')
SESSION_ID="${RANDOM}"
NOTE_NAME="${PROJECT_NAME} Session ${DATE} ${SESSION_ID}"

# ── Stub: knowledge extraction ────────────────────────────────────────
# TODO: Implement actual transcript extraction via claude subprocess or ollama
# For now, create a placeholder session note

CONTENT="---
reagent_managed: true
project: ${PROJECT_NAME}
date: ${DATE}
session_id: ${SESSION_ID}
engine: ${ENGINE}
---

# Session Knowledge — ${PROJECT_NAME}

*Auto-extracted at ${DATE} by reagent precompact hook.*

> Knowledge extraction engine: ${ENGINE}
> Status: stub — full extraction not yet implemented

## Decisions

## Discoveries

## Open Questions
"

"$OBSIDIAN_CLI" create \
  --vault "$VAULT_NAME" \
  --path "$SESSIONS_PATH" \
  --name "$NOTE_NAME" \
  -- "$CONTENT" 2>/dev/null || true

exit 0
