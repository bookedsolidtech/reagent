---
'@bookedsolid/reagent': patch
---

fix(account): wrap credentials with claudeAiOauth envelope during switch to prevent 401 mid-session token death

Account switch now calls `ensureClaudeCodeWrapper()` before writing to Claude Code's keychain slot, ensuring bare credential blobs are wrapped as `{"claudeAiOauth":{...}}` so Claude Code's token refresh flow can locate `refreshToken`. Also updates keychain tests to match atomic `-U` upsert and consistent `-a` username patterns.
