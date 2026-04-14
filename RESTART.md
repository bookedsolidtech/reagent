# Session Restart Context

_Last updated: 2026-04-13 (late night)_

## Completed This Session

### Claude Code Binary Analysis — `CLAUDE_CODE_OAUTH_TOKEN` Behavior

Reverse-engineered Claude Code CLI v2.1.74 (`D7` credential resolver, `SK` subscription resolver, `UE8` profile fetch) to understand how env var tokens work vs keychain tokens:

- When `CLAUDE_CODE_OAUTH_TOKEN` is set, Claude Code hardcodes `subscriptionType: null`, `rateLimitTier: null`, `refreshToken: null`, `scopes: ["user:inference"]`
- Keychain path returns the full stored credential including `subscriptionType: "max"` and `rateLimitTier`
- **Billing routes correctly** — proven via `GET /api/oauth/profile` with each stored token (3 distinct emails, 3 distinct org UUIDs)
- **Display is wrong** — shows "Claude API" instead of "Claude Max" because `null` maps to "Claude API" in UI
- **Token refresh does NOT work via env var** — `CLAUDE_CODE_OAUTH_REFRESH_TOKEN` is never read by `D7()`
- **Rate limits not reported** — `rate_limits` field is absent from statusline JSON for env var sessions
- **`/usage` command doesn't work** for env var sessions — same root cause (null subscription type)

### Code Changes (uncommitted, ready for v0.15.4)

- **Removed dead `CLAUDE_CODE_OAUTH_REFRESH_TOKEN` export** — Claude Code ignores it; was creating false confidence
- **Added token expiry warnings** on stderr during `account env` — since refresh doesn't work, users need to know when to rotate
- **Added `account verify [--all]`** — hits Anthropic's `/api/oauth/profile` to prove account identity (email, org, plan, tier, billing type)
- **Preserved `subscriptionType` and `rateLimitTier`** in `readClaudeCodeCredential()` — were being dropped during keychain copy
- **Added `Plan:` display** to `account check` output
- **Made `runAccount()` async-compatible** in cli/index.ts for the async `verify` subcommand
- **Updated tests** — 2 tests updated for refresh token removal, 766/766 passing
- **Updated 4 doc files** — honest about display limitation, dead refresh token, rate limit absence
- **Claude Code status bar** (`~/.claude/statusline.sh` + `settings.json`) — shows `[account]` or `[default]`, model, context %, rounded cost; rate limits show when available (keychain sessions only)

### Account Verification Results

All 3 stored tokens verified against Anthropic API:
- `jake` → jake.strawn@gmail.com / claude_max / default_claude_max_20x
- `clarity` → bandy.strawn@clarityhouse.press / claude_max / default_claude_max_20x
- `huge` → jake.strawn@hugeinc.com / claude_enterprise / default_claude_zero

### Previous Sessions (already shipped)

- v0.15.3 — Shell functions use `npx @bookedsolid/reagent@latest`, token preview obscured
- v0.15.2 — `writeClaudeCodeCredential` includes required `-a` flag
- v0.15.1 — `readClaudeCodeCredential` unwraps envelope format
- v0.15.0 — Full multi-credential feature (84 tests)
- Comprehensive docs rewrite (13 files)
- Package-dep auto-install feature
- context_protection in policy.yaml

## In Progress

All code changes are **uncommitted on staging** — 9 modified files ready for v0.15.4 commit + release.

## Up Next

1. **Commit and release v0.15.4** — all changes tested, build clean, 766/766 tests pass
2. **Rotate all 3 credentials** — so they pick up `subscriptionType`/`rateLimitTier` from the fixed `readClaudeCodeCredential()`
3. **Update `~/.zshrc`** — re-run `npx @bookedsolid/reagent@latest account setup-shell` for updated shell functions
4. **Write tests for `package-dep.ts`** — pending from earlier sessions
5. **Re-upgrade all 6 managed projects** to latest
6. **BST website** — update reagent page with multi-credential feature

## Pending Changesets / PRs

- Uncommitted v0.15.4 changes on `staging` (9 modified files)

## Key Context & Decisions

- **`CLAUDE_CODE_OAUTH_TOKEN` display is a Claude Code limitation** — hardcodes `subscriptionType: null` for env var tokens. Billing works; display/usage/rate-limits don't. No fix possible on our side.
- **`CLAUDE_CODE_OAUTH_REFRESH_TOKEN` is dead** — `D7()` never reads it. Tokens expire ~1 hour, must manually rotate.
- **`/api/oauth/profile` is the proof endpoint** — returns email, org UUID, plan type, billing type per token. Zero cost. Baked into `account verify`.
- **Status bar rate limits only appear for keychain sessions** — `rate_limits` field is absent from statusline JSON when using env var tokens.
- **v0.15.0 and v0.15.1 are broken** — always use v0.15.2+
- **npx is the default invocation** — `npx @bookedsolid/reagent@latest` everywhere
- **Claude Code keychain format**: `{"claudeAiOauth": {"accessToken", "refreshToken", "expiresAt", "scopes", "subscriptionType", "rateLimitTier"}}` — must unwrap envelope and preserve ALL fields
- **Self-referencing devDependency uses `"latest"`** not pinned version
- **User wants to spin up next session with the clarity token** via `rswitch clarity`

## Repo State

- Branch: `staging`
- Last commit: `5e6e96e Merge pull request #95 from bookedsolidtech/staging`
- Working tree: dirty (9 modified files for v0.15.4)
- Published: v0.15.3 on npm
- Autonomy level: L3
- Profile: bst-internal
- Test suite: 766/766 passing, build clean

## Key Architecture Facts

- `reagent serve` = the MCP server. Claude Code spawns it via stdio.
- All middleware (policy, redaction, audit) runs inside the `reagent serve` process
- `gateway.yaml` = where you configure additional MCP servers to proxy through reagent
- `policy.yaml` is read fresh on every hook call — changes take effect immediately for hooks
- `reagent serve` reads `policy.yaml` at startup only — restart Claude Code to pick up policy changes
- `reagent account` = standalone CLI, no gateway involvement. Keychain + env vars only.
- `fetchOAuthProfile()` in account.ts hits `https://api.anthropic.com/api/oauth/profile` with Bearer token

## Branch / Release Flow

```
feature branches → dev → staging → main (triggers publish)
```

- Merging to `main` triggers the Publish workflow
- Changesets creates a "version packages" PR on main
- Merging that PR publishes to npm and notifies Discord
