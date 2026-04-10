---
'@bookedsolid/reagent': patch
---

feat(security): add security-disclosure-gate hook and SECURITY.md policy

Adds a new `security-disclosure-gate` Claude Code hook that intercepts
`gh issue create` commands containing ~30 security-sensitive keywords
(bypass, exploit, CVE-, prompt inject, jailbreak, etc.) and blocks them
with instructions to use GitHub Security Advisories for private disclosure.

Also adds SECURITY.md with coordinated disclosure policy, response timeline,
scope definition, and two-layer security architecture documentation.

Hook is wired into `bst-internal` and `client-engagement` profiles.
