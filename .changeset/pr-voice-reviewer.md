---
'@bookedsolid/reagent': minor
---

feat(agents): add pr-voice-reviewer agent and /review-pr skill

Adds a two-layer PR review system: code-reviewer agent produces structured
technical findings, pr-voice-reviewer agent rewrites them in the project
owner's natural voice, then posts as a single batched GitHub pull review
with inline line comments. Reviews are indistinguishable from a human
going through the diff deliberately.

Closes #49.
