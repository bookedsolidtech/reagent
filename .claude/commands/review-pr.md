Fetch a pull request diff, run code-reviewer analysis, translate findings to owner voice, and post a single batched inline GitHub review.

## Usage

```
/review-pr <PR#> [--tier standard|senior|chief] [--task T-NNN]
```

**Arguments:**

- `<PR#>` — pull request number (required)
- `--tier` — review depth: `standard` (default), `senior`, or `chief`
- `--task` — optional JSONL task ID to mark `completed` after the review posts (e.g. `--task T-047`)

---

## Step 1 — Check prerequisites

Before anything else:

1. Read `.reagent/policy.yaml` — confirm autonomy level is L1 or higher
2. Check for `.reagent/HALT` — if present, stop immediately
3. Verify `gh` CLI is available: `gh --version`
4. Confirm caller is in a git repo with a GitHub remote: `gh repo view --json nameWithOwner`

Extract `owner/repo` for use in API calls.

---

## Step 2 — Fetch PR context

Run these in parallel:

```bash
gh pr view <PR#> --json title,body,headRefName,baseRefName,state,commits
gh pr diff <PR#>
gh pr view <PR#> --json commits --jq '.commits[-1].oid'
```

Store:

- `COMMIT_SHA` — the latest commit OID (use in the review payload)
- `PR_TITLE` — for context
- `PR_DIFF` — the full diff text (pass to code-reviewer)

If the PR is merged or closed, warn the user: "PR #N is already closed — review will post but won't block a merge."

If `gh pr diff` returns an empty diff, stop and report: "Empty diff — nothing to review."

---

## Step 3 — Run code-reviewer analysis

Invoke the `code-reviewer` agent with the diff and the specified tier.

**Pass this context to code-reviewer:**

```
Tier: <standard|senior|chief>

Review the following git diff and produce structured findings as a JSON array.
Each finding must include:
  - file: string (file path from diff header)
  - line: number (line number in the NEW file)
  - start_line?: number (for multi-line spans, the start line)
  - severity: "high" | "medium" | "low"
  - issue: string (the specific problem — no hedging)
  - suggestion_code?: string (the corrected code, if applicable)

Output ONLY the JSON array. No prose. No markdown wrapper. Example:
[
  {
    "file": "src/gateway/middleware/chain.ts",
    "line": 42,
    "severity": "high",
    "issue": "Non-null assertion will throw if upstream returns undefined",
    "suggestion_code": "const result = upstream ?? defaultValue;"
  }
]

If there are no findings, output: []

DIFF:
<paste full diff here>
```

Capture the JSON array output as `FINDINGS`.

If `FINDINGS` is `[]` or empty, set `FINDINGS = []` and proceed — the voice reviewer will write a clean summary.

---

## Step 4 — Run pr-voice-reviewer

Invoke the `pr-voice-reviewer` agent with `FINDINGS` and `COMMIT_SHA`.

**Pass this context:**

```
Commit SHA: <COMMIT_SHA>

Translate the following code-reviewer findings into a GitHub review payload
written in the project owner's voice. Follow the pr-voice-reviewer agent
instructions exactly.

Findings:
<FINDINGS as JSON>
```

Capture the full JSON payload as `REVIEW_PAYLOAD`.

Validate the payload has:

- `commit_id` matching `COMMIT_SHA`
- `body` (non-empty string)
- `event` one of: `REQUEST_CHANGES`, `COMMENT`, `APPROVE`
- `comments` array (may be empty if findings were empty)

---

## Step 5 — Post batched review

Post the review in a single API call:

```bash
gh api repos/{owner}/{repo}/pulls/<PR#>/reviews \
  --method POST \
  --input - <<'PAYLOAD'
<REVIEW_PAYLOAD as JSON>
PAYLOAD
```

On success (HTTP 200/201):

- Report: "Review posted — <event> on PR #N (<N> inline comments)"
- Print the review URL from the response (`html_url`)

On failure:

- Print the full error response
- Do NOT retry automatically — report to user and stop

---

## Step 6 — Close task (if --task was provided)

If `--task T-NNN` was passed, call `task_update` to mark it resolved:

```
task_update({
  id: "<T-NNN>",
  status: "completed",
  commit_ref: "<COMMIT_SHA>",
  description: "Code review posted — <N> findings on PR #<PR#>. See <html_url>"
})
```

If `task_update` fails (task not found, MCP unavailable), warn the user but do not fail the overall command — the review already posted.

---

## Step 7 — Report summary

Output a clean summary:

```
PR #<N>: <title>
Tier: <standard|senior|chief>
Findings: <count> (<high> high, <medium> medium, <low> low)
Event: REQUEST_CHANGES | COMMENT | APPROVE
Review: <html_url>
Task: T-NNN → completed  (or "no task linked")
```

---

## Error handling

| Situation                          | Action                                                             |
| ---------------------------------- | ------------------------------------------------------------------ |
| PR not found                       | Stop — "PR #N not found. Check the number and repo."               |
| HALT file present                  | Stop — "Agent operations frozen. Check .reagent/HALT."             |
| Empty diff                         | Stop — "Empty diff — nothing to review."                           |
| code-reviewer returns invalid JSON | Stop — "code-reviewer output was not valid JSON. Raw output: ..."  |
| GitHub API error                   | Stop — print full error, do not retry                              |
| Already reviewed this commit       | Warn but continue — GitHub allows multiple reviews per commit      |
| task_update fails                  | Warn but continue — review already posted; close the task manually |
| --task references unknown task ID  | Warn but continue — skip the update, don't block the review        |

---

## Notes

- GitHub suggestion syntax in comment bodies renders as an "Apply suggestion" button in the PR UI. The pr-voice-reviewer agent handles this formatting.
- Multi-line comments require both `start_line` and `line` in the comments array. The `start_line` must be less than `line`. If they're equal, omit `start_line`.
- The review posts as the authenticated `gh` user — make sure `gh auth status` shows the correct account before running.
- For large diffs (>500 lines), the code-reviewer may miss context across files. Consider running `--tier senior` or `--tier chief` for better coverage.
