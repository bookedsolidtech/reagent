---
'@bookedsolid/reagent': minor
---

feat(hooks): GitHub workflow gates — changeset security, PR issue linking, configurable disclosure mode

Adds three new capabilities for GitHub-connected projects:

**changeset-security-gate** (PreToolUse Write|Edit on `.changeset/*.md`):
- Blocks GHSA IDs and CVE numbers from being written to changeset files before
  advisory publication — prevents pre-disclosure via git history and CHANGELOG
- Validates changeset frontmatter format and requires a non-empty description
- Enforces the vague-changeset pattern for security fixes

**pr-issue-link-gate** (PreToolUse Bash on `gh pr create`):
- Advisory (non-blocking) when a PR is created without `closes #N` / `fixes #N`
- Ensures issues auto-close on merge and creates traceability through the
  issue → PR → changeset → CHANGELOG → release chain

**Configurable disclosure mode** (`REAGENT_DISCLOSURE_MODE`):
- `advisory` (default) — public OSS repos: blocks public issue creation for
  security findings and redirects to GitHub Security Advisories
- `issues` — private client repos: redirects to labeled internal issue queue
  (`--label security,internal`) instead of Security Advisories
- `disabled` — no gate
- Set via `security.disclosureMode` in the profile JSON; written to
  `.reagent/policy.yaml` and injected into `.claude/settings.json` env

Both new hooks wired into `bst-internal` and `client-engagement` profiles.
Product-owner agent updated with full GitHub workflow: issue creation standards,
PR/issue linking discipline, changeset lifecycle, and security fix disclosure flow.
