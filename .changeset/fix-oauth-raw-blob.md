---
"@bookedsolid/reagent": patch
---

fix(account): preserve full OAuth credential blob to fix token refresh after ~2 hours

Previously, `readClaudeCodeCredential()` extracted only 6 known fields from Claude Code's keychain entry, stripping OAuth metadata (tokenEndpoint, clientId, etc.) needed for token refresh. After the access token expired (~1-2 hours), Claude Code could not refresh it, causing persistent 401 errors.

All credential storage and restoration now uses raw blob passthrough — no field extraction or re-wrapping. Existing accounts must be rotated once (`reagent account rotate <name>`) to re-capture the full credential blob.
