---
'@bookedsolid/reagent': patch
---

fix(account): add required -a flag to writeClaudeCodeCredential

macOS `security add-generic-password` requires the `-a account` flag.
`writeClaudeCodeCredential` omitted it, causing the backup restore step
in `reagent account add` to crash. Uses `os.userInfo().username` to
match Claude Code's own convention.
