Handle both session spin-down and spin-up for any reagent-managed project.

## Which mode to run — explicit args win, context as fallback

Check `$ARGUMENTS` first:

- `/restart down` → **spin-down** (save state, write RESTART.md, output restart prompt)
- `/restart up` → **spin-up** (read RESTART.md, orient, list Up Next)
- `/restart` with no args → infer from context:
  - If this is clearly early in a fresh session (few messages, no code changes) → **spin-up**
  - If there's meaningful work done this session → **spin-down**
  - If ambiguous → **ask**: "Spin down (save state) or spin up (orient from last session)?"

---

## SPIN-DOWN: Save state and prepare handoff

1. Read `.reagent/policy.yaml` to capture current autonomy level and profile
2. Run `git status` and `git log --oneline -10` to capture repo state
3. Review the conversation for completed work, in-progress items, and next steps
4. Rewrite `RESTART.md` (gitignored) in full:

```markdown
# Session Restart Context

_Last updated: [DATE]_

## Completed This Session

- [bullet list of everything finished — features, fixes, commits, changesets]

## In Progress

- [anything started but not committed/tested — or "Nothing in progress" if clean]

## Up Next

- [ordered list of immediate next steps for the new session]

## Pending Changesets / PRs

- [open changesets, staged changes, PRs awaiting review/merge — or "None"]

## Key Context & Decisions

- [important decisions made, constraints, gotchas, things not to forget]

## Repo State

- Branch: [current branch]
- Last commit: [hash + message]
- Working tree: [clean / list modified files]
- Autonomy level: [from policy.yaml]
- Profile: [from policy.yaml]
```

5. Output this exactly:

---

RESTART.md updated. To resume in a new session:

```
/restart
```

Claude will read RESTART.md automatically and orient itself. Then confirm "Ready — here's where we left off" and list Up Next.

---

## SPIN-UP: Orient from saved state

1. Read `RESTART.md`
2. Read `.reagent/policy.yaml` — confirm autonomy level, check for HALT
3. Run these in parallel:
   - `git status` and `git log --oneline -5` — verify repo state matches RESTART.md
   - Check for `.reagent/HALT` — if present, report FROZEN status and reason
4. Note any drift or issues:
   - New commits since RESTART.md was written
   - Autonomy level changes
   - HALT file present (agent operations blocked)
5. Output a brief orientation:

---

**Resuming session.**

**Health:** [✓ reagent active | ⚠ FROZEN: reason]
**Autonomy:** [L0-L3 from policy.yaml]

**Last session completed:**
[bullet summary from RESTART.md]

**In progress:**
[from RESTART.md, or "Nothing — clean state"]

**Up next:**
[ordered list from RESTART.md]

**Repo state:** branch `[branch]`, last commit `[hash] [message]`
[If drift detected: "Note: [X] new commits since RESTART.md was written"]

Ready to continue — say the word.

---
