---
"@bookedsolid/reagent": minor
---

v4 Phase 1: zero-trust enforcement, CLAUDE.md behavioral rules, kill switch, CI/CD pipeline, and zero-bad-code quality gates.

**New features:**
- `reagent freeze [--reason]` / `reagent unfreeze` kill switch — creates `.reagent/HALT`, all hooks exit 2 immediately
- CLAUDE.md template installation — actual Claude Code behavioral enforcement (not just Cursor rules)
- `.reagent/policy.yaml` generation — L1/L2 autonomy defaults, blocked paths, promotion gate
- `reagent-orchestrator` agent installed to `.claude/agents/` per Option C
- `husky/pre-commit` — gitleaks staged scan + .env file protection
- `husky/pre-push` — all available quality gates: format:check → lint → type-check → test → build

**Bug fixes:**
- Silent hook skip fixed — init.js now loudly errors and skips `settings.json` for missing hooks
- `bst-internal.json` PostToolUse hooks removed (referenced non-existent scripts)

**CI/CD:**
- `.github/workflows/ci.yml` — Node 22/24 matrix, secret scan, audit, format+lint gates
- `.github/workflows/changeset.yml` — changeset required on PRs with source changes
- `.github/workflows/publish.yml` — npm-publish environment gate, SBOM (400-day retention), provenance attestation, publish audit record, Discord notifications
- `.gitleaks.toml`, `CODEOWNERS`, `scripts/block-local-publish.mjs`, `scripts/preflight.sh`
