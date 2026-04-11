---
'@bookedsolid/reagent': minor
---

feat(cli): add `reagent upgrade` command

Adds a new `reagent upgrade` command that re-syncs installed reagent hooks and
updates the version stamp in `.reagent/policy.yaml` without running the full
`reagent init` flow.

**What it does:**

- Copies / overwrites all reagent-managed hooks (`commit-msg`, `pre-commit`,
  `pre-push`) from the package's `husky/` directory into the project's `.husky/`
  directory — but only for hooks the project already has installed (respects the
  user's original init choices, never adds new hooks silently)
- Updates the `installed_by` field in `.reagent/policy.yaml` to reflect the
  current reagent version; all other user config (autonomy levels, blocked paths,
  gateway servers, etc.) is preserved
- Prints an itemised summary: installed / updated / already up-to-date / warnings
- Supports `--dry-run` to preview changes without writing files

**Usage:**

```
npx @bookedsolid/reagent upgrade
npx @bookedsolid/reagent upgrade --dry-run
```
