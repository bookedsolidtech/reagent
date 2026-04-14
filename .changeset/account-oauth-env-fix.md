---
'@bookedsolid/reagent': patch
---

fix(account): strip inherited OAuth env vars before claude auth login

When `CLAUDE_CODE_OAUTH_REFRESH_TOKEN` is set in the shell without
`CLAUDE_CODE_OAUTH_SCOPES`, Claude Code rejects the `auth login` invocation
with an error. `account add` and `account rotate` now build a clean env that
strips `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CODE_OAUTH_REFRESH_TOKEN`, and
`CLAUDE_CODE_OAUTH_SCOPES` before spawning the subprocess so the login flow
always starts fresh regardless of parent shell state.
