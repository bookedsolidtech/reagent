#!/usr/bin/env bash
# pr-issue-link-gate.sh — PreToolUse: Bash
#
# Ensures every `gh pr create` command references at least one GitHub issue
# via closes/fixes/resolves #N syntax in the PR body. When the magic keyword
# is present, GitHub automatically closes the linked issue when the PR merges
# to the default branch and creates a cross-reference in the issue timeline.
#
# This gate is ADVISORY (exit 0) — it warns but does not block. Some PRs
# legitimately have no linked issue (chores, hotfixes, release PRs). The
# advisory gives the agent an opportunity to add the link before proceeding.
#
# Only active for Bash tool calls containing `gh pr create`.
# JSONL-only projects (no GitHub) are unaffected — gh is unavailable there.
#
# Triggered by: PreToolUse — Bash tool

set -euo pipefail

# shellcheck source=_lib/common.sh
source "$(dirname "$0")/_lib/common.sh"

check_halt

INPUT="$(cat)"
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')

if [[ "$TOOL_NAME" != "Bash" ]]; then
  exit 0
fi

COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

# Only intercept gh pr create
if ! echo "$COMMAND" | grep -qE 'gh\s+pr\s+create'; then
  exit 0
fi

require_jq

# Check for closing keywords followed by an issue number
# Accepted: closes #N, fixes #N, resolves #N (case-insensitive, any spacing)
if echo "$COMMAND" | grep -qiE '(closes|fixes|resolves)\s+#[0-9]+'; then
  exit 0
fi

# Advisory — warn but do not block.
# Chore PRs, release PRs, and hotfixes may legitimately have no linked issue.
printf 'PR ISSUE LINK ADVISORY: This PR does not reference a GitHub issue.\n' >&2
printf '\n' >&2
printf 'When a PR body includes a closing reference, GitHub automatically:\n' >&2
printf '  - Closes the issue when the PR merges to the default branch\n' >&2
printf '  - Creates a cross-reference in the issue timeline\n' >&2
printf '  - Links the PR in the CHANGELOG context\n' >&2
printf '\n' >&2
printf 'Add to the --body:\n' >&2
printf '  closes #N    closes one issue\n' >&2
printf '  fixes #N     same effect\n' >&2
printf '  resolves #N  same effect\n' >&2
printf '  closes #N, closes #M   closes multiple issues\n' >&2
printf '\n' >&2
printf 'If this is a chore, release, or hotfix PR with no upstream issue, you may proceed.\n' >&2

# Exit 0 — advisory only, does not block the PR creation
exit 0
