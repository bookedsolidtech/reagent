---
'@bookedsolid/reagent': patch
---

Remove `.claude/agents/` from `client-engagement` profile gitignore — agent definitions are project configuration and should be committed to the repo, not gitignored. This ensures agent teams are available to all contributors and persist through `reagent upgrade`.
