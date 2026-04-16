---
'@bookedsolid/reagent': patch
---

fix(account): prevent 401 mid-session token death and credential contamination

Three root causes fixed:

1. **Merge, don't overwrite** — account switch now preserves `mcpOAuth` and other sibling keys in Claude Code's keychain slot instead of nuking them. MCP server auth (Supabase, GitHub) survives switching.

2. **Identity guard with `_reagentAccount` marker** — injected at the top level of the credential blob during switch. Survives Claude Code's token refresh (which only touches `claudeAiOauth`). Prevents `syncBack` from contaminating stored credentials with the wrong account's data when CC's slot is externally overwritten.

3. **Background credential sync daemon** — periodically syncs refreshed tokens (with rotated refresh tokens) back to reagent's stored copy, preventing stale refresh token buildup when sessions end without a clean switch.
