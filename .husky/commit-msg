#!/bin/sh
# .husky/commit-msg — optionally BLOCKS commits that contain AI attribution
#
# OPT-IN: Only enforces when .reagent/policy.yaml contains:
#   block_ai_attribution: true
#
# When disabled (default), this hook does nothing — commits work normally.
# When enabled, rejects (exit 1) commit messages with structural AI attribution
# markers. This teaches agents to stop including attribution by giving clear
# feedback on what went wrong.
#
# IMPORTANT: This does NOT block casual mentions of AI tools.
# "Fix Claude API integration" or "Update OpenAI SDK" are fine.
# What gets blocked are STRUCTURAL ATTRIBUTION MARKERS:
#
#   Co-Authored-By with noreply@ emails (dead giveaway)
#   Co-Authored-By with known AI names (Claude, Copilot, GPT, Gemini, etc.)
#   "Generated with/by [Tool]" footer lines
#   Markdown-linked tool names: [Claude Code](...)
#   Emoji-prefixed attribution: 🤖 Generated...
#
# SAFETY: set -e ensures any unexpected error BLOCKS the commit rather than
# silently passing a message with attribution intact.

set -e

COMMIT_MSG_FILE="$1"

# Validate input
if [ -z "$COMMIT_MSG_FILE" ]; then
  echo "ERROR: commit-msg hook received no file path" >&2
  exit 1
fi
if [ ! -f "$COMMIT_MSG_FILE" ]; then
  echo "ERROR: commit message file not found: $COMMIT_MSG_FILE" >&2
  exit 1
fi

# ── Check if attribution blocking is enabled ───────────────────────────────────
# Look for block_ai_attribution: true in .reagent/policy.yaml
# If not found or not true, exit 0 (normal commit behavior)

POLICY_FILE=".reagent/policy.yaml"
if [ ! -f "$POLICY_FILE" ]; then
  exit 0
fi

# Simple grep — no YAML parser dependency needed for a boolean flag
if ! grep -qE '^block_ai_attribution:[[:space:]]*true' "$POLICY_FILE" 2>/dev/null; then
  exit 0
fi

# ── Attribution blocking is enabled — check patterns ───────────────────────────

BLOCKED=0
MATCHES=""

# Pattern 1: Co-Authored-By with noreply@ email
if grep -qiE 'Co-Authored-By:.*noreply@' "$COMMIT_MSG_FILE" 2>/dev/null; then
  BLOCKED=1
  MATCHES="${MATCHES}$(grep -niE 'Co-Authored-By:.*noreply@' "$COMMIT_MSG_FILE" 2>/dev/null)
"
fi

# Pattern 2: Co-Authored-By with known AI assistant names
if grep -qiE 'Co-Authored-By:.*\b(Claude|Sonnet|Opus|Haiku|Copilot|GPT|ChatGPT|Gemini|Cursor|Codeium|Tabnine|Amazon Q|CodeWhisperer|Devin|Windsurf|Cline|Aider|Anthropic|OpenAI|GitHub Copilot)\b' "$COMMIT_MSG_FILE" 2>/dev/null; then
  BLOCKED=1
  MATCHES="${MATCHES}$(grep -niE 'Co-Authored-By:.*\b(Claude|Sonnet|Opus|Haiku|Copilot|GPT|ChatGPT|Gemini|Cursor|Codeium|Tabnine|CodeWhisperer|Devin|Windsurf|Cline|Aider|Anthropic|OpenAI|GitHub Copilot)\b' "$COMMIT_MSG_FILE" 2>/dev/null)
"
fi

# Pattern 3: "Generated/Built/Powered with/by [AI Tool]" footer lines
if grep -qiE '^\s*(Generated|Created|Built|Powered|Authored|Written|Produced)\s+(with|by)\s+(Claude|Copilot|GPT|ChatGPT|Gemini|Cursor|Codeium|Tabnine|CodeWhisperer|Devin|Windsurf|Cline|Aider|AI|an? AI)\b' "$COMMIT_MSG_FILE" 2>/dev/null; then
  BLOCKED=1
  MATCHES="${MATCHES}$(grep -niE '^\s*(Generated|Created|Built|Powered|Authored|Written|Produced)\s+(with|by)\s+(Claude|Copilot|GPT|ChatGPT|Gemini|Cursor|Codeium|Tabnine|CodeWhisperer|Devin|Windsurf|Cline|Aider|AI|an? AI)\b' "$COMMIT_MSG_FILE" 2>/dev/null)
"
fi

# Pattern 4: Markdown-linked attribution
if grep -qiE '\[Claude Code\]|\[GitHub Copilot\]|\[ChatGPT\]|\[Gemini\]|\[Cursor\]' "$COMMIT_MSG_FILE" 2>/dev/null; then
  BLOCKED=1
  MATCHES="${MATCHES}$(grep -niE '\[Claude Code\]|\[GitHub Copilot\]|\[ChatGPT\]|\[Gemini\]|\[Cursor\]' "$COMMIT_MSG_FILE" 2>/dev/null)
"
fi

# Pattern 5: Emoji-prefixed "Generated" lines
if grep -qE '🤖.*[Gg]enerated' "$COMMIT_MSG_FILE" 2>/dev/null; then
  BLOCKED=1
  MATCHES="${MATCHES}$(grep -nE '🤖.*[Gg]enerated' "$COMMIT_MSG_FILE" 2>/dev/null)
"
fi

# ── Block or allow ─────────────────────────────────────────────────────────────

if [ "$BLOCKED" -eq 1 ]; then
  {
    printf '\n'
    printf '═══════════════════════════════════════════════════════════════════\n'
    printf '  COMMIT BLOCKED: AI attribution detected in commit message\n'
    printf '═══════════════════════════════════════════════════════════════════\n'
    printf '\n'
    printf '  Your commit message contains structural AI attribution markers\n'
    printf '  that must be removed before committing.\n'
    printf '\n'
    printf '  Matched line(s):\n'
    printf '%s' "$MATCHES" | grep -v '^$' | sed 's/^/    /'
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
    printf '  Remove the attribution markers and retry your commit.\n'
    printf '  To disable: set block_ai_attribution: false in .reagent/policy.yaml\n'
    printf '═══════════════════════════════════════════════════════════════════\n'
    printf '\n'
  } >&2
  exit 1
fi

# Normalize trailing newlines (cosmetic, non-fatal)
perl -i -0777 -pe 's/\n+$/\n/' "$COMMIT_MSG_FILE" 2>/dev/null || true

exit 0
