---
'@bookedsolid/reagent': minor
---

Add context_protection policy to prevent coordinator context window exhaustion

- New `context_protection.delegate_to_subagent` in policy.yaml — lists commands that must run in subagents
- Hook H17 in dangerous-bash-interceptor blocks matching Bash commands with delegation instructions
- Default patterns: `pnpm run preflight`, `pnpm run test`, `pnpm run build`
- Prevents verbose test/build output from consuming coordinator context (root cause of HELiX 3.0.0 session death)
