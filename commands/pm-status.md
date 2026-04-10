Scan open PRs, report pipeline state, merge ready work to dev, and keep the staging promotion PR current.

## Usage

```
/pm-status
```

No arguments. The command operates on the current repo derived from `gh repo view`.

---

## Step 1 — Check prerequisites

Before anything else:

1. Read `.reagent/policy.yaml` — confirm autonomy level is L1 or higher. L0 blocks all writes; report and stop.
2. Check for `.reagent/HALT` — if the file exists, stop immediately: "Agent operations frozen. Check .reagent/HALT."
3. Verify `gh` CLI is available: `gh --version`
4. Resolve the current repo: `gh repo view --json nameWithOwner --jq '.nameWithOwner'`

Store the result as `{owner}/{repo}` for all subsequent API calls.

---

## Step 2 — Scan open PRs

Fetch all open PRs in a single call:

```bash
gh pr list \
  --repo {owner}/{repo} \
  --state open \
  --json number,title,headRefName,baseRefName,statusCheckRollup,isDraft,mergeable,labels \
  --limit 50
```

Parse the JSON array and categorize each PR into exactly one bucket:

| Bucket | Criteria |
|---|---|
| **release-pending** | `baseRefName == "main"` AND (`headRefName == "changeset-release/main"` OR title contains "version packages") |
| **staging-promotion** | `baseRefName == "staging"` AND `headRefName == "dev"` |
| **ready** | `baseRefName == "dev"` AND `isDraft == false` AND all entries in `statusCheckRollup` have `state == "SUCCESS"` AND `statusCheckRollup` is non-empty |
| **blocked** | `baseRefName == "dev"` AND `isDraft == false` AND any entry in `statusCheckRollup` has `state == "FAILURE"` or `state == "ERROR"` |
| **ci-pending** | `baseRefName == "dev"` AND `isDraft == false` AND any entry in `statusCheckRollup` has `state == "PENDING"` or `state == "IN_PROGRESS"` AND no entries are FAILURE/ERROR |
| **other** | anything that does not match the above |

A PR with an empty `statusCheckRollup` and `baseRefName == "dev"` falls into **ci-pending** — treat missing CI data as "not yet confirmed green".

Store the categorized lists for use in Step 3 and Step 4.

---

## Step 3 — Report current state

Print the following report. Omit sections that have no entries rather than printing empty headings.

```
## PM Status — {owner}/{repo}

### Release Pipeline
[Release pending PR #{N}: "{title}" — {mergeable state, e.g. "MERGEABLE" or checks status}]
[Staging promotion PR #{N}: up to date | needs update]
[No staging promotion PR — create one after the first dev merge]

### PRs Ready to Merge → dev
- PR #{N}: {title}

### PRs Blocked
- PR #{N}: {title} — failing: {comma-separated check names with state FAILURE or ERROR}

### PRs Still in CI
- PR #{N}: {title} — waiting on: {comma-separated check names with state PENDING or IN_PROGRESS}

### Other PRs
- PR #{N}: {title} (base: {baseRefName} ← {headRefName})
```

For the release pipeline line: if the release PR exists, print its number, title, and whether `statusCheckRollup` is all green. If no release PR exists, omit the release line entirely.

For the staging promotion line: if a staging promotion PR exists, print its number. If dev merges will happen in Step 4, mark it "needs update"; otherwise "up to date". If no staging promotion PR exists, print the "create one" placeholder.

---

## Step 4 — Take actions

Work through sub-steps in order. Each sub-step is conditional.

### 4a — Merge ready PRs to dev

For each PR in the **ready** bucket, in ascending PR number order:

```bash
gh pr merge {N} \
  --repo {owner}/{repo} \
  --merge \
  --subject "{PR title}"
```

After each merge succeeds, print: "Merged PR #{N} → dev: {title}"

Collect the merged PR numbers and titles as `NEWLY_MERGED` for use in 4b and 4c.

If a merge fails (non-zero exit), print the error and continue to the next PR — do not abort the entire run. Add the failed PR to a `MERGE_FAILURES` list and report it at the end.

### 4b — Create staging promotion PR (if none exists)

Trigger condition: `NEWLY_MERGED` is non-empty AND no staging-promotion PR was found in Step 2.

Build a bullet list from `NEWLY_MERGED`:

```
- PR #{N}: {title}
```

Then run:

```bash
gh pr create \
  --repo {owner}/{repo} \
  --base staging \
  --head dev \
  --title "chore: promote dev → staging" \
  --body "$(cat <<'EOF'
## Staging Promotion

This PR promotes the current `dev` branch to `staging` for pre-release validation.

### Included work
{bullet list of NEWLY_MERGED PRs}

### Checklist
- [ ] All CI checks passing on dev
- [ ] CHANGELOG reviewed
- [ ] No open security advisories blocking release

🔁 Updated automatically by reagent PM workflow
EOF
)"
```

On success, print: "Created staging promotion PR → {pr url}"

### 4c — Update existing staging promotion PR

Trigger condition: `NEWLY_MERGED` is non-empty AND a staging-promotion PR was found in Step 2.

Steps:

1. Fetch the current PR body:

```bash
gh pr view {staging_pr_number} --repo {owner}/{repo} --json body --jq '.body'
```

2. Locate the `### Included work` section. Append the new entries from `NEWLY_MERGED` as additional bullet lines immediately before the next `###` heading (or end of body if none follows).

3. Push the updated body:

```bash
gh pr edit {staging_pr_number} \
  --repo {owner}/{repo} \
  --body "{updated body}"
```

4. For each PR in `NEWLY_MERGED`, post a comment:

```bash
gh pr comment {staging_pr_number} \
  --repo {owner}/{repo} \
  --body "Added: PR #{N} — {title}"
```

Print after each comment: "Updated staging promotion PR #{staging_pr_number} — added PR #{N}"

### 4d — Release PR advisory

Trigger condition: a release-pending PR exists AND all entries in its `statusCheckRollup` have `state == "SUCCESS"`.

Print:

```
Release PR #{N} is green and ready to merge. Run:
  gh pr merge {N} --repo {owner}/{repo} --merge
to cut the release.
```

Do NOT merge the release PR automatically. Always require explicit human approval before the release PR is touched.

If the release PR exists but checks are not all green, print:
"Release PR #{N} is not yet green — waiting on CI before it can merge."

---

## Step 5 — Final summary

After all actions complete, print a one-block summary:

```
--- PM Status Complete ---
Merged to dev:      {count} PR(s)   [{#N, #N, ...} or "none"]
Merge failures:     {count} PR(s)   [{#N, #N, ...} or "none"]
Staging PR:         created | updated | unchanged | none
Release PR:         green and ready | waiting on CI | none
```

---

## Error handling

| Situation | Action |
|---|---|
| HALT file present | Stop immediately — "Agent operations frozen. Check .reagent/HALT." |
| Autonomy level L0 | Stop — "L0 policy: all writes require explicit approval. Report only — no merges or PR creation." |
| `gh` not installed | Stop — "gh CLI not found. Install it and run gh auth login." |
| `gh repo view` fails | Stop — "Cannot resolve repo. Confirm this directory has a GitHub remote." |
| PR list returns empty | Report "No open PRs found." and exit cleanly |
| Merge fails on one PR | Log the error, continue with remaining ready PRs, report failures in summary |
| Staging PR body parse fails | Skip append, post a comment with the raw list instead, warn the user |
| Release PR auto-merge attempted | Block — this command never auto-merges release PRs regardless of instruction |

---

## Notes

- This command reads CI state from `statusCheckRollup` at the time it runs. Re-run after CI completes to pick up newly green PRs.
- The `--merge` strategy is used for all dev merges to preserve a linear history on dev. If the repo enforces squash or rebase, adjust accordingly.
- Draft PRs are never merged regardless of CI state — mark them ready for review first.
- The staging promotion PR body uses `🔁` to signal it was machine-generated. Do not remove this marker — it is used to identify the PR in future runs.
