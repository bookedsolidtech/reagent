Invoke the product-owner agent to plan and propose tasks for a goal.

## Instructions

1. First, read `.reagent/tasks.jsonl` to understand the current backlog
2. Ask the user what they want to accomplish (if not already provided as an argument)
3. Spawn the `product-owner` agent to:
   - Review existing tasks to avoid duplication
   - Propose a set of new tasks for the goal
   - Show the proposed tasks in a table format
4. Wait for user confirmation before creating any tasks
5. Only create tasks the user explicitly approves

## Important

- NEVER auto-create tasks without user approval
- Show proposed tasks as a preview table first
- Respect the product-owner agent's guardrails (max 10 tasks, no critical urgency without approval, parent grouping for 5+)
- If the goal is vague, ask clarifying questions before proposing tasks
