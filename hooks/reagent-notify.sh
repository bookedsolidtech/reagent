#!/bin/bash
# hooks/reagent-notify.sh — post a one-off Discord notification about a repo event
#
# Useful for CI steps, post-merge automation, or manual release announcements.
# Sources the shared discord library so webhook resolution is consistent with
# the other hooks.
#
# Usage: hooks/reagent-notify.sh <event_type> <message>
#   event_type: push | merge | release | alert
#
# Event-to-channel routing:
#   push    → dev
#   merge   → dev
#   release → release
#   alert   → alert
#   (anything else) → dev

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=/dev/null
source "${SCRIPT_DIR}/_lib/discord.sh"

EVENT_TYPE="${1:-}"
MESSAGE="${2:-}"

if [ -z "$EVENT_TYPE" ] || [ -z "$MESSAGE" ]; then
  printf 'Usage: %s <event_type> <message>\n' "$(basename "$0")" >&2
  printf '  event_type: push | merge | release | alert\n' >&2
  exit 1
fi

# Route event to the appropriate channel and pick a sensible default color
channel_type="dev"
color="blue"

case "$EVENT_TYPE" in
  push)
    channel_type="dev"
    color="green"
    ;;
  merge)
    channel_type="dev"
    color="green"
    ;;
  release)
    channel_type="release"
    color="blue"
    ;;
  alert)
    channel_type="alert"
    color="red"
    ;;
  *)
    channel_type="dev"
    color="blue"
    ;;
esac

discord_notify "$channel_type" "$MESSAGE" "$color"

# Wait for the background curl before the script exits so the caller gets
# a clean exit code even in scripted pipelines.
wait
