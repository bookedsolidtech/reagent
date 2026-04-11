---
'@bookedsolid/reagent': patch
---

fix(hooks): commit-review-gate now hands off to the agent as reviewer

Previously the block message told agents to "spawn a code-reviewer agent"
and gave no clear path forward — causing agents to give up and ask the user
to run git commit manually instead.

The gate now makes clear that the agent itself is the reviewer: inspect the
diff, make a judgement call, cache the result, and retry. Initial commits,
large refactors, and standard feature work are explicitly called out as
normal — agents should use judgement, not ceremony. Only escalate to the
user if there is a genuine problem in the diff.

Also fixes `daemon:restart` npm script to use `npx reagent` so it works
without a global install.
