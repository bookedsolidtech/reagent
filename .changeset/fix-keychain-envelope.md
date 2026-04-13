---
'@bookedsolid/reagent': patch
---

Fix `reagent account add` failing to read Claude Code's keychain credential. Claude Code wraps credentials in a `{claudeAiOauth: {...}}` envelope — now correctly unwrapped.
