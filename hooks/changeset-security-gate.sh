#!/usr/bin/env bash
# changeset-security-gate.sh — PreToolUse: Write|Edit
#
# Guards .changeset/*.md files against two failure modes:
#
# 1. SECURITY DISCLOSURE LEAK — GHSA IDs or CVE numbers written to a changeset
#    file before the advisory is published. Changeset files are committed to git
#    and appear verbatim in CHANGELOG.md — referencing a GHSA ID pre-publish
#    creates public pre-disclosure in git history.
#
# 2. MISSING OR MALFORMED FRONTMATTER — changeset files without proper frontmatter
#    are silently ignored by the changesets tool, wasting the release entry.
#
# Triggered by: PreToolUse — Write and Edit tools

set -euo pipefail

# shellcheck source=_lib/common.sh
source "$(dirname "$0")/_lib/common.sh"

check_halt

INPUT="$(cat)"
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')

# Only handle Write and Edit
if [[ "$TOOL_NAME" != "Write" && "$TOOL_NAME" != "Edit" ]]; then
  exit 0
fi

FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')

# Only care about .changeset/*.md files (not README.md in .changeset/)
if ! echo "$FILE_PATH" | grep -qE '\.changeset/[^/]+\.md$'; then
  exit 0
fi

require_jq

# Extract the content being written
if [[ "$TOOL_NAME" == "Write" ]]; then
  CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // ""')
else
  # For Edit: check the new_string being inserted
  CONTENT=$(echo "$INPUT" | jq -r '.tool_input.new_string // ""')
fi

# ─── 1. SECURITY DISCLOSURE CHECK ───────────────────────────────────────────
#
# These patterns in a changeset mean security details are about to be committed
# to git history BEFORE the advisory is published — creating pre-disclosure.
# GHSA IDs and CVE numbers must NEVER appear in changeset files.

DISCLOSURE_PATTERNS=(
  'GHSA-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}'
  'CVE-[0-9]{4}-[0-9]+'
)

MATCHED_PATTERN=""
for PATTERN in "${DISCLOSURE_PATTERNS[@]}"; do
  if echo "$CONTENT" | grep -qE "$PATTERN"; then
    MATCHED_PATTERN="$PATTERN"
    break
  fi
done

if [[ -n "$MATCHED_PATTERN" ]]; then
  json_output "block" \
    "CHANGESET SECURITY GATE: This changeset contains a security advisory identifier (matched: '${MATCHED_PATTERN}').

Do NOT reference GHSA IDs or CVE numbers in changeset files before the advisory is published.
Changeset files are committed to git — this creates pre-disclosure in public history and CHANGELOG.

CORRECT approach for security fix changesets:
  Use vague language only — no identifiers, no vulnerability details.

  WRONG:  'fix(hooks): patch GHSA-3w3m-7gg4-f82g — symlink-guard now covers Edit tool'
  RIGHT:  'security: extend symlink protection to cover all write-capable tools'

  WRONG:  'security: fix CVE-2026-1234 prompt injection via tool descriptions'
  RIGHT:  'security: harden middleware chain against indirect instruction attacks'

After the release ships:
  1. Publish the GitHub Security Advisory (Security tab → Advisories → Publish)
  2. The GHSA becomes the detailed public disclosure document
  3. Optionally update CHANGELOG.md post-publish to add the GHSA reference"
fi

# ─── 2. FRONTMATTER VALIDATION ───────────────────────────────────────────────
#
# A changeset without valid frontmatter is silently ignored by the changesets
# tool — the package bump and CHANGELOG entry never appear in the release.

# Must start with ---
if ! echo "$CONTENT" | head -1 | grep -qE '^---'; then
  json_output "block" \
    "CHANGESET FORMAT GATE: Missing frontmatter block.

Every changeset must start with a frontmatter block specifying which package to bump:

---
'@bookedsolid/reagent': patch
---

Brief description of what changed and why (close #N if applicable).

Bump types: patch (bug fix/security), minor (new feature), major (breaking change)"
fi

# Must have at least one package bump entry and a closing ---
FRONTMATTER=$(echo "$CONTENT" | awk '/^---/{count++; if(count==2){exit} next} count==1{print}')
if ! echo "$FRONTMATTER" | grep -qE "^'.+': (patch|minor|major)"; then
  json_output "block" \
    "CHANGESET FORMAT GATE: Frontmatter does not contain a valid package bump entry.

The frontmatter must include at least one package/bump pair:

---
'@bookedsolid/reagent': patch
---

Valid bump types: patch | minor | major"
fi

# Must have a non-empty description after the closing ---
DESCRIPTION=$(echo "$CONTENT" | awk 'BEGIN{count=0} /^---/{count++; next} count>=2{print}' | grep -v '^[[:space:]]*$' | head -1)
if [[ -z "$DESCRIPTION" ]]; then
  json_output "block" \
    "CHANGESET FORMAT GATE: Missing description after frontmatter.

Add a meaningful description explaining what changed and why:

---
'@bookedsolid/reagent': patch
---

fix(gateway): policy-loader now uses async I/O with 500ms TTL cache

Previously, loadPolicy used fs.readFileSync on every tool invocation, blocking
the event loop under concurrency. Closes #34."
fi

exit 0
