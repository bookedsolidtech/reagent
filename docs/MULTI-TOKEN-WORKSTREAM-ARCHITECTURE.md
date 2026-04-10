# Multi-Token Workstream Architecture

## Local Process Isolation for Claude Code Agent Workstreams

**Status:** Proposal — requires proof-of-concept validation
**Authors:** BST Engineering
**Date:** 2026-04-09

---

## 1. Problem Statement

Today, every Claude Code session on a machine shares a single OAuth token. This means:

- All work bills to one account, making client billing impossible
- No isolation between projects — a runaway agent in Project A can affect Project B
- No budget controls per client or per task
- No way to track token usage per workstream

**The goal:** Run multiple Claude Code agent processes locally, each with its own OAuth token, its own git worktree, and its own session state — all orchestrated by reagent. No Docker required.

---

## 2. Architecture Overview

```
Your Terminal (Personal Token — Max Plan)
  └── claude (your interactive session)
       └── reagent serve (MCP gateway — middleware chain)
            │
            ├── Workstream: "acme-review" ─────────────────────────┐
            │   token: ACME_CLAUDE_OAUTH_TOKEN                     │
            │   worktree: ~/.reagent/worktrees/acme-review/        │
            │   claude_dir: ~/.reagent/sessions/acme-review/.claude │
            │   process: claude -p "Review the auth module..."     │
            │                                                       │
            ├── Workstream: "internal-refactor" ───────────────────┐
            │   token: CLAUDE_CODE_OAUTH_TOKEN (your default)      │
            │   worktree: ~/.reagent/worktrees/internal-refactor/  │
            │   claude_dir: ~/.reagent/sessions/internal-refactor/ │
            │   process: claude -p "Refactor the middleware..."    │
            │                                                       │
            └── Workstream: "client-beta-fix" ─────────────────────┐
                token: BETA_CLIENT_CLAUDE_TOKEN                    │
                worktree: ~/.reagent/worktrees/client-beta-fix/    │
                claude_dir: ~/.reagent/sessions/client-beta-fix/   │
                process: claude -p "Fix the payment bug..."        │
```

Each workstream is a **separate OS process** with:

- Its own `CLAUDE_CODE_OAUTH_TOKEN` env var (bills to that account)
- Its own git worktree (isolated filesystem)
- Its own `.claude/` directory (no session state collision)
- Its own budget tracking (advisory, logged by reagent)

---

## 3. The Mechanism — Why This Works Without Docker

### 3.1 Process-Level Environment Isolation

Unix processes inherit environment variables from their parent. Node.js `child_process.spawn()` accepts an `env` object that **completely replaces** the child's environment:

```typescript
import { spawn } from 'node:child_process';

const child = spawn('claude', ['-p', prompt, '--output-format', 'json'], {
  cwd: worktreePath,
  env: {
    ...baseEnv,
    CLAUDE_CODE_OAUTH_TOKEN: clientToken, // different token per workstream
    HOME: sessionHome, // isolated .claude/ directory
  },
});
```

Claude Code reads `CLAUDE_CODE_OAUTH_TOKEN` from its process environment. Two processes, two tokens, two billing accounts. The "heavy compute" is on Anthropic's servers — locally each `claude -p` process is a lightweight Node.js process making HTTP requests.

### 3.2 Claude Code Auth Token Precedence

**Verified against official Claude Code docs** ([authentication](https://code.claude.com/docs/en/authentication), [env-vars](https://code.claude.com/docs/en/env-vars)). Full auth cascade, first match wins:

| Priority | Source                                            | Type           | Billing             |
| -------- | ------------------------------------------------- | -------------- | ------------------- |
| 1        | Cloud provider (`USE_BEDROCK` / `USE_VERTEX` etc) | Provider creds | Provider billing    |
| 2        | `ANTHROPIC_AUTH_TOKEN` env var                    | Bearer token   | Gateway/proxy       |
| 3        | `ANTHROPIC_API_KEY` env var                       | API key        | Per-token (Console) |
| 4        | `apiKeyHelper` (external command from settings)   | Varies         | Varies              |
| 5        | `CLAUDE_CODE_OAUTH_TOKEN` env var                 | OAuth token    | Max Plan (flat)     |
| 6        | Subscription OAuth from `/login` (keychain)       | Cached OAuth   | Max Plan            |

**Critical:** `ANTHROPIC_API_KEY` (priority 3) is **higher** than `CLAUDE_CODE_OAUTH_TOKEN` (priority 5). In `-p` mode, the API key is always used when present. The spawner must **explicitly delete** both `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` from the child env.

Additionally, `CLAUDE_CODE_OAUTH_REFRESH_TOKEN` (paired with `CLAUDE_CODE_OAUTH_SCOPES`) enables auto-refreshing for long-running sessions.

**`--bare` flag warning:** Per [headless docs](https://code.claude.com/docs/en/headless), `--bare` "skips OAuth and keychain reads" and explicitly does not read `CLAUDE_CODE_OAUTH_TOKEN`. If your workstreams use OAuth subscription billing, you **cannot** use `--bare`.

### 3.2.1 Config Directory Isolation

Claude Code uses two distinct directories ([claude-directory docs](https://code.claude.com/docs/en/claude-directory)):

| Directory        | Purpose                                            | Override                     |
| ---------------- | -------------------------------------------------- | ---------------------------- |
| `~/.claude/`     | User-level: settings, credentials, session history | `CLAUDE_CONFIG_DIR` env var  |
| `<cwd>/.claude/` | Project-level: CLAUDE.md, project settings, agents | None, always relative to cwd |

Per the [official docs](https://code.claude.com/docs/en/env-vars), separate config dirs are a supported pattern:

```bash
alias claude-work='CLAUDE_CONFIG_DIR=~/.claude-work claude'
```

**Concurrency safety:** Using separate `CLAUDE_CONFIG_DIR` values per workstream also avoids an [OAuth token refresh race condition](https://github.com/anthropics/claude-code/issues/27933) that can occur when multiple processes share `~/.claude/.credentials.json`.

For multi-token workstreams, set **both**:

- `CLAUDE_CONFIG_DIR` per workstream — isolates credentials, history, session state
- `cwd` (spawn option) pointing to the worktree — isolates project-level config

### 3.3 Git Worktree Isolation

Git worktrees provide lightweight, isolated working directories from a single repo:

```bash
# Create an isolated checkout for a workstream
git worktree add ~/.reagent/worktrees/acme-review -b ws/acme-review

# The worktree gets its own working directory but shares .git objects
# No full clone needed — disk-efficient, instant creation
```

Properties:

- Each worktree can be on a different branch
- Git operations (commit, push) are safe concurrently across worktrees
- Worktrees share the object store — no duplicate disk usage for repo history
- Cleanup: `git worktree remove <path>` or `git worktree prune` for stale entries

### 3.4 Session State Isolation

Claude Code stores project-level state in `.claude/` within the project directory. Two concurrent `claude -p` processes writing to the same `.claude/` will corrupt state.

**Solution:** Each workstream gets its own session directory by setting `HOME` or using a project-level `.claude/` within the worktree:

```
~/.reagent/
  worktrees/
    acme-review/           # git worktree (full repo checkout)
      .claude/             # claude session state (isolated per worktree)
      src/
      package.json
    internal-refactor/
      .claude/
      src/
      package.json
  state/
    acme-review.json       # reagent's own tracking (tokens used, budget, timing)
    internal-refactor.json
```

Since each worktree is a separate directory, and Claude Code creates `.claude/` relative to the project root, worktree isolation **automatically** gives us session isolation.

---

## 4. Configuration Schema

### 4.1 Account Definitions

New file: `.reagent/accounts.yaml`

```yaml
# .reagent/accounts.yaml — Named account contexts
# Maps logical names to environment variables containing OAuth tokens.
# Reagent references accounts by name; tokens live ONLY in env vars.

version: '1'

accounts:
  personal:
    env_var: CLAUDE_CODE_OAUTH_TOKEN
    description: 'BST engineering — personal Max Plan'

  client-acme:
    env_var: ACME_CLAUDE_OAUTH_TOKEN
    description: 'ACME Corp project — client-provided token'
    budget:
      warn_usd: 40.00 # log warning at this threshold
      halt_usd: 50.00 # stop workstream at this threshold
      period: monthly # reset period (monthly | weekly | per-run)

  client-beta:
    env_var: BETA_CLAUDE_OAUTH_TOKEN
    description: 'Beta Inc — retainer account'
    budget:
      warn_usd: 100.00
      halt_usd: 150.00
      period: monthly
```

**Security invariants:**

- Tokens live **only** in environment variables — never in config files
- Reagent stores the env var **name**, never the value
- The existing `secret-scanner.sh` hook prevents committing actual tokens
- The existing `redactMiddleware` in the gateway chain prevents logging token values
- Audit logs record which account **name** was used, never the token

### 4.2 Workstream Definitions

New file or extension to pipeline configs:

```yaml
# workstreams/acme-review.yaml
workstream:
  name: acme-review
  account: client-acme # references accounts.yaml
  profile: client-engagement # which reagent profile to apply

  source:
    repo: . # current repo (or a path)
    branch: feature/acme-auth-module # branch to work on
    base_branch: main # for diff context

  prompt: |
    Review the authentication module in src/auth/ for security issues.
    Focus on: input validation, token handling, session management.
    Write findings to .workstream-results/acme-review-findings.md

  options:
    max_turns: 100 # advisory turn limit
    timeout_seconds: 1800 # hard wall-clock limit
    output_format: json # claude -p output format
    dangerously_skip_permissions: true # required for headless

  success:
    marker: .workstream-results/acme-review-findings.md.done
    # The prompt must write this marker file on completion
```

### 4.3 Profile Extension

Profiles gain an optional `default_account` field:

```json
{
  "name": "client-engagement",
  "description": "Zero-trust setup for client project engagements",
  "defaultAccount": "client-acme",
  "blockAiAttribution": true,
  ...
}
```

---

## 5. Implementation Plan

### Phase 1: Account Context System (No Docker, No Worktrees)

**Goal:** Reagent can reference named accounts and validate they exist in the environment.

**Files to create/modify:**

| File                                    | Action | Description                               |
| --------------------------------------- | ------ | ----------------------------------------- |
| `src/config/accounts.ts`                | Create | Zod schema + loader for `accounts.yaml`   |
| `src/types/accounts.ts`                 | Create | `Account`, `AccountBudget` interfaces     |
| `src/types/index.ts`                    | Modify | Re-export account types                   |
| `src/cli/commands/init/accounts.ts`     | Create | Init step: scaffold `accounts.yaml`       |
| `src/gateway/middleware/account.ts`     | Create | Middleware: validate account, log context |
| `src/__tests__/config/accounts.test.ts` | Create | Unit tests for account loading            |

**Zod schema (draft):**

```typescript
const AccountBudgetSchema = z.object({
  warn_usd: z.number().positive().optional(),
  halt_usd: z.number().positive().optional(),
  period: z.enum(['monthly', 'weekly', 'per-run']).default('monthly'),
});

const AccountSchema = z.object({
  env_var: z.string().min(1),
  description: z.string().optional(),
  budget: AccountBudgetSchema.optional(),
});

const AccountsConfigSchema = z.object({
  version: z.string(),
  accounts: z.record(AccountSchema),
});
```

**Acceptance criteria:**

- [ ] `reagent init` offers to create `accounts.yaml` with a `personal` account
- [ ] `reagent check` validates that referenced env vars are actually set
- [ ] Account middleware logs which account context is active per gateway session
- [ ] Budget thresholds trigger warnings in audit log (advisory only — no server-side enforcement)
- [ ] No token values appear in any log, config, or error message

### Phase 2: Workstream Spawner (Local Process Isolation)

**Goal:** Reagent can spawn `claude -p` as a child process with a specific account's token.

**Files to create/modify:**

| File                                       | Action | Description                                 |
| ------------------------------------------ | ------ | ------------------------------------------- |
| `src/workstream/spawner.ts`                | Create | Core: spawn `claude -p` with env isolation  |
| `src/workstream/types.ts`                  | Create | `WorkstreamConfig`, `WorkstreamResult`      |
| `src/workstream/state.ts`                  | Create | Per-workstream state tracking (JSON)        |
| `src/workstream/worktree.ts`               | Create | Git worktree create/cleanup helpers         |
| `src/cli/commands/workstream.ts`           | Create | CLI: `reagent workstream run <config.yaml>` |
| `src/__tests__/workstream/spawner.test.ts` | Create | Unit tests with mock claude process         |

**Core spawner logic (draft):**

```typescript
export async function spawnWorkstream(config: WorkstreamConfig): Promise<WorkstreamResult> {
  const account = resolveAccount(config.account);

  // Validate token exists (by name, never by value)
  const tokenValue = process.env[account.env_var];
  if (!tokenValue) {
    throw new Error(
      `Account "${config.account}" references env var "${account.env_var}" which is not set`
    );
  }

  // Create or reuse worktree
  const worktreePath = await ensureWorktree(config);

  // Build isolated environment
  const env = buildWorkstreamEnv({
    baseEnv: process.env,
    oauthToken: tokenValue,
    worktreePath,
  });

  // Spawn claude -p
  const child = spawn(
    'claude',
    [
      '-p',
      config.prompt,
      '--output-format',
      config.options?.output_format ?? 'json',
      '--dangerously-skip-permissions',
    ],
    {
      cwd: worktreePath,
      env,
      timeout: (config.options?.timeout_seconds ?? 3600) * 1000,
    }
  );

  // Stream output, track turns, check budget
  return collectResult(child, config);
}

function buildWorkstreamEnv(opts: {
  baseEnv: NodeJS.ProcessEnv;
  oauthToken: string;
  worktreePath: string;
}): Record<string, string> {
  const env: Record<string, string> = {};

  // Copy base env, filtering undefined
  for (const [k, v] of Object.entries(opts.baseEnv)) {
    if (v !== undefined) env[k] = v;
  }

  // Set the workstream's OAuth token
  env.CLAUDE_CODE_OAUTH_TOKEN = opts.oauthToken;

  // CRITICAL: Unset API key to prevent per-token billing override
  delete env.ANTHROPIC_API_KEY;

  return env;
}
```

**Acceptance criteria:**

- [ ] `reagent workstream run acme-review.yaml` spawns `claude -p` with the correct token
- [ ] Each workstream runs in its own git worktree
- [ ] Session state (`.claude/`) is isolated per worktree
- [ ] Workstream result includes: exit code, turn count, duration, output path
- [ ] `ANTHROPIC_API_KEY` is explicitly unset in workstream env
- [ ] Concurrent workstreams do not interfere with each other
- [ ] Cleanup: worktree removed on success (configurable retain)

### Phase 3: Budget Tracking and Observability

**Goal:** Reagent tracks estimated spend per account and emits warnings.

| File                        | Action | Description                                    |
| --------------------------- | ------ | ---------------------------------------------- |
| `src/workstream/budget.ts`  | Create | Per-account spend estimation + thresholds      |
| `src/workstream/monitor.ts` | Create | Real-time workstream status (optional Discord) |

**Budget tracking approach:**

- Claude Code outputs token usage in its JSON output (`usage.input_tokens`, `usage.output_tokens`)
- Reagent parses this and estimates USD cost based on published model pricing
- Running totals stored in `~/.reagent/state/<account>.budget.json`
- When `warn_usd` threshold crossed: log warning + optional Discord notification
- When `halt_usd` threshold crossed: kill the workstream process + notify

**Note:** Budget tracking is **advisory**. Reagent cannot enforce server-side spend limits. The circuit breaker is process-level: kill the child process if the budget is exceeded.

---

## 6. Proof-of-Concept Test Plan

### POC-1: Multi-Token Process Isolation

**Engineer:** TBD
**Time estimate:** 2-4 hours
**Goal:** Prove that two `claude -p` processes with different tokens bill to different accounts.

```bash
# Terminal 1 — Token A
CLAUDE_CODE_OAUTH_TOKEN=$TOKEN_A claude -p "What account am I using? Print the first 8 chars of your auth context." --output-format json > /tmp/poc-token-a.json

# Terminal 2 — Token B (simultaneously)
CLAUDE_CODE_OAUTH_TOKEN=$TOKEN_B claude -p "What account am I using? Print the first 8 chars of your auth context." --output-format json > /tmp/poc-token-b.json
```

**Verify:**

- [ ] Both processes run concurrently without error
- [ ] Output JSON is valid from both
- [ ] Usage dashboard shows activity on both accounts
- [ ] No cross-contamination of session state

### POC-2: Git Worktree Isolation

**Engineer:** TBD
**Time estimate:** 2-4 hours
**Goal:** Prove that `claude -p` works correctly inside a git worktree.

```bash
# Create worktree
git worktree add /tmp/reagent-poc-worktree -b poc/worktree-test

# Run claude -p inside the worktree
cd /tmp/reagent-poc-worktree
CLAUDE_CODE_OAUTH_TOKEN=$TOKEN_A claude -p "List the files in this repo. Create a file called poc-proof.txt with the current timestamp." --output-format json --dangerously-skip-permissions

# Verify
cat /tmp/reagent-poc-worktree/poc-proof.txt   # should exist
cat poc-proof.txt                               # should NOT exist in main worktree
git -C /tmp/reagent-poc-worktree log --oneline  # should show commit if auto-committed

# Cleanup
git worktree remove /tmp/reagent-poc-worktree
```

**Verify:**

- [ ] `claude -p` runs correctly in the worktree
- [ ] File changes are isolated to the worktree
- [ ] Git operations (status, diff, commit) work in the worktree
- [ ] `.claude/` is created inside the worktree (not the main repo)
- [ ] Worktree cleanup is clean (`git worktree prune` shows nothing stale)

### POC-3: Node.js Spawner Integration

**Engineer:** TBD
**Time estimate:** 2-4 hours
**Goal:** Prove the spawner pattern works from Node.js.

```typescript
// poc-spawner.ts
import { spawn } from 'node:child_process';
import { execSync } from 'node:child_process';

const WORKTREE_PATH = '/tmp/reagent-poc-spawn';
const TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN!;

// Create worktree
execSync(`git worktree add ${WORKTREE_PATH} -b poc/spawn-test 2>/dev/null || true`);

const child = spawn(
  'claude',
  [
    '-p',
    'Create a file called spawner-proof.txt containing "spawned successfully"',
    '--output-format',
    'json',
    '--dangerously-skip-permissions',
  ],
  {
    cwd: WORKTREE_PATH,
    env: {
      ...process.env,
      CLAUDE_CODE_OAUTH_TOKEN: TOKEN,
      // Explicitly unset API key
    },
  }
);

let output = '';
child.stdout.on('data', (d) => {
  output += d.toString();
});
child.stderr.on('data', (d) => {
  process.stderr.write(d);
});
child.on('close', (code) => {
  console.log(`Exit code: ${code}`);
  console.log(`Output length: ${output.length}`);
  try {
    const result = JSON.parse(output);
    console.log('Parsed result:', JSON.stringify(result, null, 2).slice(0, 500));
  } catch {
    console.log('Raw output:', output.slice(0, 500));
  }
  // Cleanup
  execSync(`git worktree remove ${WORKTREE_PATH} --force 2>/dev/null || true`);
});
```

**Verify:**

- [ ] `spawn()` successfully launches `claude -p`
- [ ] stdout captures valid JSON output
- [ ] stderr shows Claude Code's progress messages
- [ ] The child process respects `cwd` (operates in the worktree)
- [ ] The child process respects the env token (correct account billed)
- [ ] Process cleanup is clean on success
- [ ] Timeout kills the process correctly on hang

### POC-4: Concurrent Workstreams (Stress Test)

**Engineer:** TBD
**Time estimate:** 4-6 hours
**Goal:** Run 3 concurrent workstreams, each with a different token, prove no interference.

```bash
# Requires 3 tokens: TOKEN_A, TOKEN_B, TOKEN_C
# Run from the repo root

# Create 3 worktrees
git worktree add /tmp/ws-a -b ws/poc-a
git worktree add /tmp/ws-b -b ws/poc-b
git worktree add /tmp/ws-c -b ws/poc-c

# Launch 3 concurrent claude -p processes
CLAUDE_CODE_OAUTH_TOKEN=$TOKEN_A claude -p "Create /tmp/ws-a/proof-a.txt" --dangerously-skip-permissions &
PID_A=$!

CLAUDE_CODE_OAUTH_TOKEN=$TOKEN_B claude -p "Create /tmp/ws-b/proof-b.txt" --dangerously-skip-permissions &
PID_B=$!

CLAUDE_CODE_OAUTH_TOKEN=$TOKEN_C claude -p "Create /tmp/ws-c/proof-c.txt" --dangerously-skip-permissions &
PID_C=$!

# Wait for all
wait $PID_A $PID_B $PID_C

# Verify isolation
ls -la /tmp/ws-a/proof-a.txt  # exists
ls -la /tmp/ws-b/proof-b.txt  # exists
ls -la /tmp/ws-c/proof-c.txt  # exists

# Verify no cross-contamination
test ! -f /tmp/ws-a/proof-b.txt && echo "PASS: no cross-contamination"
test ! -f /tmp/ws-b/proof-a.txt && echo "PASS: no cross-contamination"

# Cleanup
git worktree remove /tmp/ws-a /tmp/ws-b /tmp/ws-c
```

**Verify:**

- [ ] All 3 processes complete successfully
- [ ] Each worktree has only its own output files
- [ ] No lock contention on `.git/` objects
- [ ] Rate limits are per-token (not shared across processes)
- [ ] Usage dashboards show activity on all 3 accounts

---

## 7. Known Risks and Mitigations

| Risk                                                     | Severity | Mitigation                                                                    |
| -------------------------------------------------------- | -------- | ----------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY` overrides OAuth silently             | High     | Spawner explicitly deletes it from child env                                  |
| Two workstreams write to same `.claude/` dir             | High     | Worktree isolation gives each its own `.claude/` automatically                |
| Token in env var visible via `/proc/<pid>/environ`       | Medium   | Acceptable for local dev; Docker adds process isolation if needed             |
| Budget tracking is advisory (no server-side enforcement) | Medium   | Circuit breaker kills process at threshold; user acknowledges advisory nature |
| `claude -p` exit codes unreliable                        | Medium   | Use `.done` marker files as primary success signal                            |
| Git worktree accumulation (disk space)                   | Low      | Auto-cleanup after success; `reagent workstream prune` for manual cleanup     |
| Claude Code CLI version changes break headless mode      | Low      | Abstract CLI args behind an interface; pin version in package.json            |
| Onboarding bypass (`~/.claude.json`) is brittle          | Low      | Document as known technique; check on each Claude Code update                 |

---

## 8. What Docker Adds (Later, Opt-In)

Local process isolation covers the billing and session isolation use cases. Docker adds value only for:

| Capability                        | Local               | Docker |
| --------------------------------- | ------------------- | ------ |
| Token isolation (billing)         | Yes                 | Yes    |
| Session state isolation           | Yes (via worktrees) | Yes    |
| Filesystem isolation (sandboxing) | No                  | Yes    |
| Network isolation (firewall)      | No                  | Yes    |
| Reproducible environment          | No                  | Yes    |
| Resource limits (CPU/memory)      | No                  | Yes    |

Docker becomes relevant when you need an agent that **cannot** access files outside its workspace or **cannot** make unauthorized network calls. For pure billing/tracking separation, local worktree isolation is sufficient.

---

## 9. Relationship to Existing Reagent Architecture

This feature builds directly on existing infrastructure:

| Existing Component                            | How It's Used                                         |
| --------------------------------------------- | ----------------------------------------------------- |
| `gateway-config.ts` `resolveEnvVars()`        | Same `${VAR}` pattern for account env resolution      |
| `client-manager.ts` `buildEnv()`              | Same per-process env injection pattern                |
| `policy.yaml` autonomy levels                 | Workstream operations respect current autonomy level  |
| `secret-scanner.sh` hook                      | Prevents committing tokens to accounts.yaml           |
| `redactMiddleware`                            | Prevents token values in audit logs                   |
| `rate-limit-guard.sh` hook                    | Extends to per-account rate tracking                  |
| Discord notifications (`discord-notifier.ts`) | Workstream status updates, budget warnings            |
| Audit middleware (`audit.ts`)                 | Records which account context was used per invocation |

No new dependencies required. The workstream spawner uses only `node:child_process` (built-in).

---

## 10. Worktree Lifecycle Management

Worktree bloat is the primary operational risk. Each worktree is ~2 MB of checked-out files, but with `pnpm install` that grows to ~270 MB. Ten stale worktrees = 2.7 GB of dead weight. This section defines when and how worktrees are created, retained, and destroyed.

### 10.1 Worktree State Machine

Every worktree transitions through these states:

```
                                    ┌──────────────────────────┐
                                    │                          │
  ┌──────────┐    ┌──────────┐    ┌▼─────────┐    ┌──────────┐│   ┌───────────┐
  │ CREATING │───▶│ RUNNING  │───▶│ PUSHED   │───▶│ MERGED   │└──▶│ DESTROYED │
  └──────────┘    └────┬─────┘    └────┬─────┘    └──────────┘    └───────────┘
                       │               │                ▲
                       │          CI fails /            │
                       │          review feedback       │
                       │               │                │
                       │          ┌────▼─────┐          │
                       │          │ FIX-UP   │──────────┘
                       │          └────┬─────┘
                       │               │ max retries
                       ▼               ▼
                  ┌──────────┐    ┌──────────┐
                  │ FAILED   │    │ STALE    │
                  └────┬─────┘    └────┬─────┘
                       │               │
                       └───────┬───────┘
                               ▼
                         ┌───────────┐
                         │ DESTROYED │
                         └───────────┘
```

| State     | Worktree exists? | node_modules? | When to clean up                       |
| --------- | :--------------: | :-----------: | -------------------------------------- |
| CREATING  |       Yes        |  Installing   | Never (in progress)                    |
| RUNNING   |       Yes        |      Yes      | Never (agent active)                   |
| PUSHED    |       Yes        |      Yes      | **After merge** or after TTL           |
| FIX-UP    |       Yes        |      Yes      | Never (agent re-entered)               |
| MERGED    |       Yes        |      Yes      | **Immediately** — safe to destroy      |
| FAILED    |       Yes        |      Yes      | After human review or after TTL        |
| STALE     |       Yes        |     Maybe     | **Immediately** — max retries exceeded |
| DESTROYED |        No        |      No       | Already gone                           |

### 10.2 The Key Decision: When Can We Delete?

**After push?** No. The PR may need fixes:

- CI fails → agent needs the worktree to fix
- Reviewer requests changes → agent re-enters to address
- Merge conflicts with base branch → agent rebases

**After merge?** Yes. Once the PR is merged, the worktree has no further purpose. The branch is also safe to delete.

**After push + TTL?** Yes, as a fallback. If a PR sits idle for N hours with no activity, the worktree can be cleaned up. If the agent needs to re-enter later, it recreates the worktree from the remote branch (cheap — just `git worktree add` + `pnpm install`).

### 10.3 Cleanup Triggers

Three cleanup mechanisms, layered for defense in depth:

**Trigger 1: Post-merge hook (immediate, automatic)**

When a PR is merged, the worktree and branch are cleaned up immediately. This is the primary cleanup path.

```typescript
// Pseudocode for the merge watcher
async function onPrMerged(prNumber: number, branchName: string) {
  const worktree = findWorktreeByBranch(branchName);
  if (!worktree) return; // already cleaned up

  await exec('git', ['worktree', 'remove', worktree.path, '--force']);
  await exec('git', ['branch', '-D', branchName]);

  // Clean up state file
  await fs.rm(stateFilePath(worktree.name));
  log(`Worktree ${worktree.name} destroyed (PR #${prNumber} merged)`);
}
```

**How to detect merge:** Two options depending on where reagent runs:

| Method                                       | Latency      | Requires                          |
| -------------------------------------------- | ------------ | --------------------------------- |
| GitHub webhook (via MCP server)              | Seconds      | Discord-ops or a webhook listener |
| `gh pr view` polling                         | Minutes      | GitHub CLI, periodic check        |
| Post-push hook + `gh pr list --state merged` | On next push | Husky hook                        |

The simplest for v1: **a post-push husky hook** that checks for merged branches and cleans up their worktrees. This piggybacks on existing git operations — no polling, no webhooks.

```bash
#!/bin/bash
# hooks/post-push-worktree-cleanup.sh
# Runs after every `git push` — checks for worktrees whose PRs are merged

WORKTREE_DIR=".reagent/worktrees"
[ -d "$WORKTREE_DIR" ] || exit 0

for state_file in .reagent/state/ws-*.json; do
  [ -f "$state_file" ] || continue
  branch=$(jq -r '.branch' "$state_file")
  worktree_path=$(jq -r '.worktree_path' "$state_file")

  # Check if branch still exists on remote
  if ! git ls-remote --heads origin "$branch" | grep -q "$branch"; then
    # Branch is gone (merged or deleted) — clean up
    echo "[reagent] Cleaning up worktree for deleted branch: $branch"
    git worktree remove "$worktree_path" --force 2>/dev/null
    git branch -D "$branch" 2>/dev/null
    rm "$state_file"
  fi
done

# Final sweep for any orphaned metadata
git worktree prune
```

**Trigger 2: TTL-based expiry (deferred, automatic)**

Worktrees that have been idle (no agent process, no git activity) for longer than a configurable TTL are eligible for cleanup. Default: 72 hours.

```yaml
# In workstream config or accounts.yaml
worktree:
  ttl_hours: 72 # delete idle worktrees after 72h
  ttl_after_push: 48 # delete pushed-but-unmerged worktrees after 48h
  max_concurrent: 5 # refuse to create if 5+ worktrees exist
```

The TTL check runs as part of `reagent workstream prune` or as a pre-create check before spawning a new workstream.

```typescript
async function enforceWorktreeLimits() {
  const worktrees = await listReagentWorktrees();

  for (const wt of worktrees) {
    const state = await readState(wt.name);
    const idleHours = (Date.now() - state.last_activity_at) / 3600000;

    if (state.status === 'merged') {
      // Always clean up merged worktrees immediately
      await destroyWorktree(wt);
    } else if (state.status === 'pushed' && idleHours > config.ttl_after_push) {
      // PR is open but idle — safe to clean, can recreate from remote
      await destroyWorktree(wt);
    } else if (idleHours > config.ttl_hours) {
      // Any worktree idle beyond TTL
      await destroyWorktree(wt);
    }
  }

  // Enforce max concurrent
  const active = worktrees.filter((wt) => wt.status === 'running' || wt.status === 'pushed');
  if (active.length >= config.max_concurrent) {
    throw new Error(
      `Max concurrent worktrees (${config.max_concurrent}) reached. ` +
        `Run 'reagent workstream prune' or wait for merges.`
    );
  }
}
```

**Trigger 3: Manual prune (on-demand)**

```bash
reagent workstream prune              # clean up all eligible worktrees
reagent workstream prune --force      # clean up ALL worktrees (including running)
reagent workstream prune --dry-run    # show what would be cleaned
```

### 10.4 Recreating a Worktree from Remote

When an agent needs to re-enter a worktree that was cleaned up (e.g., to fix CI), it recreates from the remote branch:

```typescript
async function recreateWorktree(branchName: string): Promise<string> {
  // Fetch latest
  await exec('git', ['fetch', 'origin', branchName]);

  // Create worktree from the remote branch
  const worktreePath = `.reagent/worktrees/${branchName.replace('/', '-')}`;
  await exec('git', ['worktree', 'add', '-B', branchName, worktreePath, `origin/${branchName}`]);

  // Reinstall dependencies (fast with pnpm hardlinks)
  await exec('pnpm', ['install', '--frozen-lockfile'], { cwd: worktreePath });

  // Place Spotlight exclusion marker
  await fs.writeFile(path.join(worktreePath, '.metadata_never_index'), '');

  return worktreePath;
}
```

Cost of recreation: `git worktree add` is instant. `pnpm install` with a warm store is ~5-10 seconds. Total: under 15 seconds. This is fast enough that aggressive cleanup is fine.

### 10.5 node_modules Strategy

`node_modules` is the biggest contributor to worktree disk usage (~266 MB per worktree for this repo). Options:

| Strategy                          |  Disk per worktree  |      Install time       | Agent can run immediately? |
| --------------------------------- | :-----------------: | :---------------------: | :------------------------: |
| Full `pnpm install` per worktree  | ~266 MB (hardlinks) |      5-10s (warm)       |            Yes             |
| Shared `node_modules` via symlink |        ~0 MB        |           0s            |      Yes, but fragile      |
| No install, read-only workstreams |        0 MB         |           0s            |   Only for review tasks    |
| Install on-demand (lazy)          |      0-266 MB       | 5-10s on first tool use |       Delayed start        |

**Recommendation:** Full `pnpm install` per worktree. With pnpm's content-addressable store, the actual disk cost is near-zero (hardlinks to `~/.pnpm-store/`). The ~266 MB reported by `du` is the logical size, not the physical size. Running `du --apparent-size` vs `du` will show the difference.

For **read-only review workstreams** (no writes, no tests), skip the install entirely — Claude Code can read files without `node_modules`.

### 10.6 Worktree State File

Each worktree gets a state file at `.reagent/state/ws-<name>.json`:

```json
{
  "name": "acme-review",
  "branch": "ws/acme-review",
  "worktree_path": ".reagent/worktrees/acme-review",
  "account": "client-acme",
  "status": "pushed",
  "created_at": "2026-04-09T10:00:00Z",
  "last_activity_at": "2026-04-09T11:30:00Z",
  "pushed_at": "2026-04-09T11:25:00Z",
  "pr_number": 42,
  "pid": null,
  "total_turns": 47,
  "estimated_cost_usd": 2.35
}
```

This file is the source of truth for cleanup decisions. It persists across process restarts and is not inside the worktree (so it survives worktree deletion).

### 10.7 Cleanup Summary

| Event                                | Action                                |          Automatic?          |
| ------------------------------------ | ------------------------------------- | :--------------------------: |
| PR merged                            | Destroy worktree + branch immediately |     Yes (post-push hook)     |
| PR closed without merge              | Destroy worktree + branch             |     Yes (post-push hook)     |
| Branch deleted on remote             | Destroy worktree + branch             |     Yes (post-push hook)     |
| Worktree idle > `ttl_hours`          | Destroy worktree + branch             |    Yes (pre-create check)    |
| Pushed PR idle > `ttl_after_push`    | Destroy worktree, keep remote branch  |    Yes (pre-create check)    |
| Max concurrent worktrees reached     | Refuse to create new, suggest prune   |    Yes (pre-create check)    |
| Agent process dies                   | Mark as stale, clean on next prune    | Yes (startup reconciliation) |
| User runs `reagent workstream prune` | Destroy all eligible worktrees        |            Manual            |

---

## 11. CLI Surface

```
reagent workstream run <config.yaml>    Run a workstream from config
reagent workstream list                 List active workstreams and their status
reagent workstream status <name>        Show detailed status of a workstream
reagent workstream stop <name>          Stop a running workstream
reagent workstream prune                Clean up completed worktrees and state
reagent workstream prune --dry-run      Show what would be cleaned without acting
reagent workstream prune --force        Clean up ALL worktrees including running
reagent workstream budget [account]     Show budget usage for an account
```

---

## 12. Timeline and Assignments

| Phase   | Scope                         | Dependencies          | Engineer |
| ------- | ----------------------------- | --------------------- | -------- |
| POC-1   | Multi-token process isolation | Two Claude Max tokens | TBD      |
| POC-2   | Git worktree with claude -p   | One token, git        | TBD      |
| POC-3   | Node.js spawner integration   | One token, Node.js    | TBD      |
| POC-4   | Concurrent stress test        | Three tokens          | TBD      |
| Phase 1 | Account context system        | POC-1 passes          | TBD      |
| Phase 2 | Workstream spawner            | POC-2, POC-3 pass     | TBD      |
| Phase 3 | Budget tracking               | Phase 2 complete      | TBD      |

**POCs should be completed before any production code is written.** If any POC fails, the architecture must be revised before proceeding.

---

_Part of the [reagent](https://github.com/bookedsolidtech/reagent) project by Booked Solid Technology._
