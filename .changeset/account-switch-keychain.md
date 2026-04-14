---
'@bookedsolid/reagent': patch
---

fix(account): replace env var token switching with keychain slot swap

`account switch <name>` now writes the target credential directly into the
Claude Code keychain slot instead of exporting CLAUDE_CODE_OAUTH_TOKEN. Claude
Code reads from keychain with its normal refresh path — switched sessions
survive overnight without expiring. `rswitch` updated to use the new command;
no more eval or token-in-env-var. `rswitch --clear` restores the saved default
credential from keychain.
