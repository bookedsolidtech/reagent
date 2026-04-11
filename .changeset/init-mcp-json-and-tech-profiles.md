---
"@bookedsolid/reagent": minor
---

Fix `reagent init` to write `.mcp.json`, fix tech profile composability, fix daemon Streamable HTTP, and add profile-specific hook self-skipping.

**`reagent init` now writes `.mcp.json` (stdio transport)**

Every `reagent init` run now creates or merges `.mcp.json` with a `reagent` stdio entry that spawns `npx reagent serve`. This is the root cause of "installation never works on a new project" — the MCP server entry was never written. The file is idempotent: existing entries are preserved.

**Tech profiles now compose with base profiles**

Previously `reagent init --profile lit-wc` ran _only_ the tech-specific hook overlay, silently skipping all 14 base init steps (CLAUDE.md, policy.yaml, husky hooks, agents, commands, `.mcp.json`, etc.). Now tech profiles run the full base init first (`client-engagement` by default), then layer the tech hooks on top. Override the base with `--base-profile bst-internal`. Output now shows `Profile: client-engagement + lit-wc`.

**Daemon Streamable HTTP compliance fix**

The daemon's `mcp_post_handler` previously returned `202 Accepted` with an empty body for all messages — including JSON-RPC requests that require a response. Claude Code received an empty body, failed the handshake, and reported "connected but failed". Fixed:

- JSON-RPC **requests** (has `id`): forwarded to child stdin, daemon waits for the matching response from child stdout (correlated by `id`), returns `200 OK` with `Content-Type: application/json` and the response body.
- JSON-RPC **notifications** (no `id`): returns `202 Accepted` immediately (unchanged).
- 30-second timeout with `504 Gateway Timeout` if child does not respond.
- SSE client disconnect no longer terminates the stdout reader — in-flight request responses still route correctly.

**Profile-specific hooks self-skip**

Tech profile hooks (`cem-integrity-gate`, `shadow-dom-guard`, `astro-ssr-guard`, `drupal-coding-standards`, `hook-update-guard`, `server-component-drift`) now call `check_project_type "<profile>"` at startup. If the project's `tech_profile` field in `.reagent/policy.yaml` does not match, the hook exits 0 silently. `reagent init --profile lit-wc` writes `tech_profile: "lit-wc"` to policy.yaml. New `check_project_type()` helper added to `hooks/_lib/common.sh`.
