#!/bin/bash
# PreToolUse hook: attribution-advisory.sh
# Fires BEFORE every Bash tool call.
#
# OPT-IN: Only enforces when .reagent/policy.yaml contains:
#   block_ai_attribution: true
#
# When disabled (default), this hook does nothing.
# When enabled, BLOCKS (exit 2) gh pr create/edit and git commit commands
# that contain structural AI attribution markers.
#
# Exit codes:
#   0 = allow (disabled, no attribution found, or not a relevant command)
#   2 = block (attribution detected, or HALT is active)

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
    "$(cat "$HALT_FILE" 2>/dev/null || echo 'Reason unknown')" >&2
  exit 2
fi

# ── 4. Check if attribution blocking is enabled ──────────────────────────────
POLICY_FILE="${REAGENT_ROOT}/.reagent/policy.yaml"
if [ ! -f "$POLICY_FILE" ]; then
  exit 0
fi
if ! grep -qE '^block_ai_attribution:[[:space:]]*true' "$POLICY_FILE" 2>/dev/null; then
  exit 0
fi

# ── 5. Parse tool_input.command from the hook payload ─────────────────────────
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

if [[ -z "$CMD" ]]; then
  exit 0
fi

# ── 6. Check if this is a relevant command ────────────────────────────────────
IS_RELEVANT=0

if printf '%s' "$CMD" | grep -qiE 'gh[[:space:]]+pr[[:space:]]+(create|edit)'; then
  IS_RELEVANT=1
fi

if printf '%s' "$CMD" | grep -qiE 'git[[:space:]]+commit'; then
  IS_RELEVANT=1
fi

if [[ $IS_RELEVANT -eq 0 ]]; then
  exit 0
fi

# ── 7. Check for structural AI attribution markers ───────────────────────────

FOUND=0

# Co-Authored-By with noreply@ email
if printf '%s' "$CMD" | grep -qiE 'Co-Authored-By:.*noreply@'; then
  FOUND=1
fi

# Co-Authored-By with known AI names
if printf '%s' "$CMD" | grep -qiE 'Co-Authored-By:.*\b(Claude|Sonnet|Opus|Haiku|Copilot|GPT|ChatGPT|Gemini|Cursor|Codeium|Tabnine|Amazon Q|CodeWhisperer|Devin|Windsurf|Cline|Aider|Anthropic|OpenAI|GitHub Copilot)\b'; then
  FOUND=1
fi

# "Generated/Built/Powered with/by [AI Tool]" lines
if printf '%s' "$CMD" | grep -qiE '(Generated|Created|Built|Powered|Authored|Written|Produced)[[:space:]]+(with|by)[[:space:]]+(Claude|Copilot|GPT|ChatGPT|Gemini|Cursor|Codeium|Tabnine|CodeWhisperer|Devin|Windsurf|Cline|Aider|AI|an? AI)\b'; then
  FOUND=1
fi

# Markdown-linked attribution
if printf '%s' "$CMD" | grep -qiE '\[Claude Code\]|\[GitHub Copilot\]|\[ChatGPT\]|\[Gemini\]|\[Cursor\]'; then
  FOUND=1
fi

# Emoji attribution
if printf '%s' "$CMD" | grep -qE '🤖.*[Gg]enerated'; then
  FOUND=1
fi

if [[ $FOUND -eq 1 ]]; then
  {
    printf '\n'
    printf '═══════════════════════════════════════════════════════════════════\n'
    printf '  BLOCKED: AI attribution detected in command\n'
    printf '═══════════════════════════════════════════════════════════════════\n'
    printf '\n'
    printf '  Your command contains structural AI attribution markers.\n'
    printf '\n'
    printf '  What gets BLOCKED (structural attribution):\n'
    printf '    - Co-Authored-By with AI names or noreply@ emails\n'
    printf '    - "Generated with/by [AI Tool]" footer lines\n'
    printf '    - Markdown-linked tool names: [Claude Code](...)\n'
    printf '    - Emoji attribution: 🤖 Generated...\n'
    printf '\n'
    printf '  What is ALLOWED (legitimate references):\n'
    printf '    - "Fix Claude API integration"\n'
    printf '    - "Update OpenAI SDK version"\n'
    printf '    - "Add Copilot config"\n'
    printf '\n'
    printf '  Remove the attribution markers and rewrite the command.\n'
    printf '  To disable: set block_ai_attribution: false in .reagent/policy.yaml\n'
    printf '═══════════════════════════════════════════════════════════════════\n'
    printf '\n'
  } >&2
  exit 2
fi

# No attribution found — allow
exit 0
