---
'@bookedsolid/reagent': patch
---

fix(hooks): allow agent writes to tasks.jsonl when .reagent/ is in blocked_paths

The default blocked_paths included `.reagent/` as a directory, which blocked
agents from writing to `.reagent/tasks.jsonl`. This broke the PM task store —
the entire point of the project management layer.

Two fixes:

1. blocked-paths-enforcer.sh now has a built-in agent-writable allowlist that
   always permits writes to `tasks.jsonl` and `audit/` regardless of what
   blocked_paths contains. settings-protection.sh still guards the sensitive
   files (policy.yaml, HALT, review-cache.json) explicitly.

2. The default blocked_paths in new installs now lists specific files instead
   of the whole `.reagent/` directory, so this footgun doesn't recur.

Existing installs with `.reagent/` in blocked_paths are fixed by the hook
allowlist — no manual policy.yaml edits required.
