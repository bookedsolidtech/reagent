#!/bin/bash
# hooks/_lib/discord.sh — Discord notification helpers for local git hooks
# Source this file; do not execute it directly.
#
# Requires: curl (for webhook delivery), gateway.yaml (for channel config)
# Design: always silently no-ops when Discord isn't configured — hooks must
# never block or add perceptible latency because of a missing notification setup.

# Post an embed message to a Discord webhook.
# Usage: discord_notify <channel_type> <message> [<color>]
#   channel_type: dev | alert | release | task
#   color:        green | red | yellow | blue  (default: blue)
#
# Webhook resolution order:
#   1. REAGENT_DISCORD_WEBHOOK env var (overrides everything)
#   2. Per-channel env vars: REAGENT_DISCORD_WEBHOOK_DEV, _ALERT, _RELEASE, _TASK
#   3. gateway.yaml channel webhook entries (parsed with grep/awk, no jq needed)
#
# The curl call runs in the background so it never stalls the hook.
discord_notify() {
  local channel_type="$1"
  local message="$2"
  local color="${3:-blue}"

  # Bail immediately if curl isn't present — no point continuing
  if ! command -v curl >/dev/null 2>&1; then
    return 0
  fi

  local repo_root
  repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || return 0

  local gateway_yaml="${repo_root}/.reagent/gateway.yaml"

  # Resolve webhook: env override first, then per-channel env, then gateway.yaml
  local webhook="${REAGENT_DISCORD_WEBHOOK:-}"

  if [ -z "$webhook" ]; then
    local upper_type
    upper_type="$(printf '%s' "$channel_type" | tr '[:lower:]' '[:upper:]')"
    local env_var="REAGENT_DISCORD_WEBHOOK_${upper_type}"
    webhook="${!env_var:-}"
  fi

  if [ -z "$webhook" ] && [ -f "$gateway_yaml" ]; then
    # Expect a block like:
    #   dev_channel:
    #     webhook: "https://discord.com/api/webhooks/..."
    webhook=$(grep -A2 "${channel_type}_channel:" "$gateway_yaml" 2>/dev/null \
      | grep "webhook:" \
      | awk '{print $2}' \
      | tr -d '"'"'" 2>/dev/null || true)
  fi

  # Nothing configured for this channel — silent no-op
  [ -z "$webhook" ] && return 0

  local color_int
  case "$color" in
    green)  color_int=3066993  ;;
    red)    color_int=15158332 ;;
    yellow) color_int=16776960 ;;
    *)      color_int=3447003  ;;   # blue
  esac

  # Escape the message for JSON: backslashes, double-quotes, and control chars
  local escaped_message
  escaped_message="$(printf '%s' "$message" | sed 's/\\/\\\\/g; s/"/\\"/g' 2>/dev/null || printf '%s' "$message")"

  # Fire-and-forget: run in the background so the hook returns immediately
  curl -s -X POST "$webhook" \
    -H "Content-Type: application/json" \
    -d "{\"embeds\":[{\"description\":\"${escaped_message}\",\"color\":${color_int}}]}" \
    >/dev/null 2>&1 &
}
