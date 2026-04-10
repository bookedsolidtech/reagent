---
'@bookedsolid/reagent': patch
---

fix(hooks): commit-review-gate cache bypass now works for all install methods

The cache check in `commit-review-gate.sh` was silently skipped when reagent
was installed globally or via npx — `REAGENT_CLI_ARGS` was never populated for
those cases, causing the gate to permanently block commits >200 lines even after
a successful code review completed and cached its result.

Fixes:

- Add `command -v reagent` PATH lookup as third CLI resolution option (covers
  global `npm install -g @bookedsolid/reagent` installs)
- Add a `jq`-based direct read of `.reagent/review-cache.json` as a fallback
  when no CLI is found — works in any consumer project regardless of install
  method, no Node.js process spawn required
- Hoist `STAGED_SHA` / `BRANCH` computation out of the score-specific block
  so both standard and significant tiers share the same variables
