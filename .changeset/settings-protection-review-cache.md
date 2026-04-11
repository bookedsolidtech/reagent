---
"@bookedsolid/reagent": patch
---

fix(hooks): remove review-cache.json from settings-protection hard block

The `settings-protection.sh` hook was over-protecting `.reagent/review-cache.json`
as if it were a security control file. It is operational cache data — the review
CLI and agents need to write it. Only true security controls belong in the protected
list: hook scripts, settings.json, policy.yaml, and the HALT kill switch.

The hook comment now explicitly documents what is and isn't protected, and why.
