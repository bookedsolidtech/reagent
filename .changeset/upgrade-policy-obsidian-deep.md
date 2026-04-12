---
'@bookedsolid/reagent': minor
---

YAML-aware policy merge for `reagent upgrade` and Obsidian deep integration (Tiers 1-3)

**upgrade-policy**: `reagent upgrade` now uses YAML-aware merging via `parseDocument` to add missing canonical sections (like `context_protection`) without overwriting existing values. New `--clean-blocked-paths` flag replaces blanket `.reagent/` with granular `.reagent/policy.yaml` + `.reagent/HALT`.

**Obsidian CLI wrapper**: New `ObsidianCli` class wrapping `/usr/local/bin/obsidian` with fail-silent pattern for daily notes, note creation, property setting, search, and vault health.

**Obsidian Tiers 1-3**:

- Tier 1 (journal): `reagent-obsidian-journal.sh` hook appends session summaries to daily notes on Stop
- Tier 2 (precompact): `reagent-obsidian-precompact.sh` stub for knowledge extraction before context compaction
- Tier 3 (tasks): `reagent-obsidian-tasks.sh` hook materializes tasks as individual Obsidian notes

**CLI extensions**: `reagent obsidian health` (vault metrics), `reagent obsidian journal` (manual entry), tasks sync target

**Config schema**: Extended `vault-config` with `vault_name`, `tasks`/`sessions` paths, `journal`/`precompact`/`tasks` sync flags

**Profiles**: Updated `bst-internal` and `client-engagement` blocked_paths from `.reagent/` to granular entries
