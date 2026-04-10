Read the task store at `.reagent/tasks.jsonl` and render a clean summary table.

## Instructions

1. Read `.reagent/tasks.jsonl` — each line is a JSON event with fields: id, type, title, urgency, phase, assignee, timestamp
2. Materialize the current state: for each task ID, the latest event determines its status
3. Group by status: active (created, started, blocked) first, then completed/cancelled
4. Render as a markdown table with columns: ID | Status | Urgency | Title | Assignee | Phase

## Output Format

```
## Active Tasks

| ID    | Status  | Urgency | Title                        | Assignee | Phase   |
|-------|---------|---------|------------------------------|----------|---------|
| T-001 | started | normal  | Implement review cache CLI   | —        | Phase 2 |

## Completed Tasks (last 10)

| ID    | Title                        | Completed     |
|-------|------------------------------|---------------|
| T-002 | Refactor init.ts             | 2026-04-09    |
```

If the file doesn't exist or is empty, say: "No tasks found. Use /plan-work to create tasks."
