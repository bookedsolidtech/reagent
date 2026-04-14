---
'@bookedsolid/reagent': patch
---

fix(account): sync refreshed OAuth tokens back before keychain switch

Claude Code refreshes access tokens in-place (rotating the refresh token),
but only updates its own keychain slot. `account switch` was always writing
the original stored credential — which contained a stale, already-rotated
refresh token — causing 401 errors when Claude Code next attempted a refresh.

The switch command now:

- Tracks the active account in `~/.reagent/active-account`
- Syncs Claude Code's current credential back to the previously active
  account's keychain entry before overwriting
- Uses an advisory file lock to prevent concurrent switches from corrupting
  credential entries
- Validates the active-account file contents on read
- Warns when sync-back is expected but cannot complete
