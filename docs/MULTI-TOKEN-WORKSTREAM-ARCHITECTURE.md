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

**Verified from Claude Code CLI source** (`cli.js` v2.1.74, `Ab()` function). OAuth cascade — first match wins:

| Priority | Source                                          | Type       | Billing              |
| -------- | ----------------------------------------------- | ---------- | -------------------- |
| 1        | `ANTHROPIC_AUTH_TOKEN` env var                  | OAuth      | Max Plan             |
| 2        | `CLAUDE_CODE_OAUTH_TOKEN` env var               | OAuth      | Max Plan (flat rate) |
| 3        | `CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR`       | OAuth (fd) | Max Plan             |
| 4        | `apiKeyHelper` (external command from settings) | Varies     | Varies               |
| 5        | Keychain-stored OAuth (`claude auth login`)     | OAuth      | Max Plan             |

Separately, `ANTHROPIC_API_KEY` is resolved by a different function (`hw()`) for direct API billing. **It overrides subscription auth entirely.**

**For multi-token workstreams, `CLAUDE_CODE_OAUTH_TOKEN` is the correct lever.** It takes precedence over any cached keychain credential without requiring you to clear local auth state. The spawner must **explicitly delete** `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` from the child env to prevent accidental per-token billing.

**Note:** `CLAUDE_CODE_OAUTH_REFRESH_TOKEN` is NOT consumed by Claude Code when `CLAUDE_CODE_OAUTH_TOKEN` is set. Token refresh does not work via env var — tokens expire after ~1 hour. For long-running workstreams, implement pre-flight token validation and re-authentication on auth failure.

**`--bare` flag warning:** The `--bare` flag "skips OAuth and keychain reads" and requires `ANTHROPIC_API_KEY` or `apiKeyHelper`. If your workstreams use `CLAUDE_CODE_OAUTH_TOKEN` (subscription billing), you **cannot** use `--bare`. Omit it and accept slightly slower startup.

### 3.2.1 Config Directory Isolation

Claude Code uses two distinct directories:

| Directory        | Purpose                                            | Override                      |
| ---------------- | -------------------------------------------------- | ----------------------------- |
| `~/.claude/`     | User-level: settings, credentials, session history | `CLAUDE_CONFIG_DIR` env var   |
| `<cwd>/.claude/` | Project-level: CLAUDE.md, project settings, agents | None — always relative to cwd |

Per the official docs, separate config dirs are an officially supported pattern:

```bash
# Official pattern from Anthropic docs:
alias claude-work='CLAUDE_CONFIG_DIR=~/.claude-work claude'
```

For multi-token workstreams, set **both**:

- `CLAUDE_CONFIG_DIR` per workstream — isolates credentials, history, session state
- `cwd` (spawn option) pointing to the worktree — isolates project-level config

### 3.3 Git Worktree Isolation

Git worktrees provide lightweight, isolated working directories from a single repo:

```bash
# Create an isolated checkout for a workstream
git worktree add .reagent/worktrees/acme-review -b ws/acme-review

# The worktree gets its own working directory but shares .git objects
# No full clone needed — disk-efficient, instant creation
```

**Verified properties (tested against this repo):**

- Each worktree is ~2 MB on disk (checked-out files only). The shared `.git/objects/` (23 MB for this repo) is not duplicated.
- **Branch exclusivity is enforced** — a branch checked out in one worktree cannot be checked out in another. Each workstream must get its own branch.
- `git add`, `git commit`, `git push` are safe concurrently (each worktree has its own `index` file).
- **Serialize `git fetch`** — it updates shared `refs/remotes/` and can contend. The coordinator should fetch once.
- Suppress auto-gc in agent processes: `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=gc.auto GIT_CONFIG_VALUE_0=0`.
- `node_modules` is NOT included — use `pnpm install` per worktree (hardlink deduplication via `~/.pnpm-store/`).
- Hooks (`.husky/`, `.git/hooks/`) are shared — all agents run through the same gates.
- **Cleanup requires explicit branch deletion:** `git worktree remove` does NOT delete the associated branch.

**Recommended worktree location:** `.reagent/worktrees/<id>/` (same APFS volume, co-located, add to `.gitignore`).

### 3.4 Session State Isolation

Claude Code stores project-level state in `.claude/` within the project directory. Two concurrent `claude -p` processes writing to the same `.claude/` will corrupt state.

**Solution:** Worktree isolation **automatically** gives us session isolation — each worktree is a separate directory, and Claude Code creates `.claude/` relative to its `cwd`:

```
.reagent/
  worktrees/
    acme-review/           # git worktree (full repo checkout)
      .claude/             # claude session state (isolated per worktree — automatic)
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

No need to override `HOME`. The `cwd` argument to `spawn()` plus `CLAUDE_CONFIG_DIR` is sufficient.

### 3.5 macOS-Specific Considerations

- **Spotlight indexing:** Place `.metadata_never_index` in each worktree root at creation time to prevent `mds_stores` overhead.
- **File descriptors:** Not a concern (limits are 1,048,575).
- **APFS:** Stay on the same volume — cross-volume worktrees lose benefits.
- **File watchers:** Disable watch modes in agents (`vitest --run`, no `tsc --watch`).

### 3.6 Crash Cleanup

PID-based ownership with startup reconciliation:

1. `git worktree list --porcelain` — enumerate worktrees matching `ws/` branch prefix
2. Check `.reagent-agent.pid` in each worktree, verify with `process.kill(pid, 0)`
3. Dead process: `git worktree remove <path> --force`, then `git branch -D <branch>`
4. Run `git worktree prune` as final sweep

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

  // Build config dir for session isolation
  const configDir = path.join(worktreePath, '.reagent-claude-config');
  await fs.mkdir(configDir, { recursive: true });

  // Spawn claude -p with full isolation
  const child = spawn(
    'claude',
    [
      '-p',
      config.prompt,
      '--output-format',
      config.options?.output_format ?? 'json',
      '--dangerously-skip-permissions',
      '--no-session-persistence',
      '--max-turns',
      String(config.options?.max_turns ?? 100),
      '--max-budget-usd',
      String(config.options?.budget_usd ?? 5.0),
    ],
    {
      cwd: worktreePath,
      env: buildWorkstreamEnv({
        baseEnv: process.env,
        oauthToken: tokenValue,
        configDir,
      }),
      timeout: (config.options?.timeout_seconds ?? 3600) * 1000,
    }
  );

  // Stream output, track turns, check budget
  return collectResult(child, config);
}

function buildWorkstreamEnv(opts: {
  baseEnv: NodeJS.ProcessEnv;
  oauthToken: string;
  configDir: string;
}): Record<string, string> {
  const env: Record<string, string> = {};

  // Copy base env, filtering undefined
  for (const [k, v] of Object.entries(opts.baseEnv)) {
    if (v !== undefined) env[k] = v;
  }

  // Set the workstream's OAuth token
  env.CLAUDE_CODE_OAUTH_TOKEN = opts.oauthToken;

  // Isolate config directory (credentials, history, session state)
  env.CLAUDE_CONFIG_DIR = opts.configDir;

  // CRITICAL: Unset keys that override OAuth billing
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;

  // Suppress git auto-gc (can block concurrent worktrees)
  env.GIT_CONFIG_COUNT = '1';
  env.GIT_CONFIG_KEY_0 = 'gc.auto';
  env.GIT_CONFIG_VALUE_0 = '0';

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

**Budget tracking — two layers:**

**Layer 1: Claude Code native enforcement (per-invocation).** The `--max-budget-usd` flag is a real CLI flag that hard-caps spend per `claude -p` invocation. Claude Code tracks token usage internally and stops when the budget is reached. This is the primary safeguard.

**Layer 2: Reagent aggregate tracking (per-account, over time).**

- Claude Code outputs token usage in its JSON output (`usage.input_tokens`, `usage.output_tokens`)
- Reagent parses this and estimates USD cost based on published model pricing
- Running totals stored in `~/.reagent/state/<account>.budget.json`
- When `warn_usd` threshold crossed: log warning + optional Discord notification
- When `halt_usd` threshold crossed: refuse to spawn new workstreams for that account

The combination is robust: `--max-budget-usd` prevents any single invocation from running away, while reagent's aggregate tracking prevents cumulative overspend across multiple workstreams.

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

| Risk                                               | Severity | Mitigation                                                                                     |
| -------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY` overrides OAuth silently       | High     | Spawner deletes both `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` from child env             |
| Two workstreams share `CLAUDE_CONFIG_DIR`          | High     | Each workstream gets its own `CLAUDE_CONFIG_DIR`; concurrent writes to `history.jsonl` corrupt |
| Two workstreams write to same project `.claude/`   | High     | Worktree isolation gives each its own `.claude/` automatically (cwd-relative)                  |
| Spotlight indexing overhead with concurrent agents | Medium   | Place `.metadata_never_index` in each worktree root at creation                                |
| `git fetch` contention on shared refs              | Medium   | Coordinator fetches once; agents inherit via shared object store                               |
| Token in env var visible via `/proc/<pid>/environ` | Medium   | Acceptable for local dev; Docker adds process isolation if needed                              |
| `claude -p` exit codes unreliable                  | Medium   | Use `.done` marker files as primary success signal                                             |
| Orphaned worktrees on crash                        | Medium   | PID file + startup reconciliation routine (see section 3.6)                                    |
| Orphaned branches accumulate                       | Low      | Cleanup must explicitly `git branch -D` — `git worktree remove` does not                       |
| `--bare` flag incompatible with OAuth tokens       | Low      | Do not use `--bare`; accept slightly slower startup                                            |
| Git auto-gc blocks concurrent object creation      | Low      | Suppress with `GIT_CONFIG_COUNT=1 gc.auto=0` per agent process                                 |
| Git worktree disk accumulation                     | Low      | Auto-cleanup after success; `reagent workstream prune` for manual cleanup                      |

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

### 9.1 Per-Workstream Environment Matrix

Each spawned `claude -p` process receives exactly these overrides:

| Env Var                   | Value                               | Purpose                                        |
| ------------------------- | ----------------------------------- | ---------------------------------------------- |
| `CLAUDE_CODE_OAUTH_TOKEN` | Account's token value               | Bills to correct account                       |
| `CLAUDE_CONFIG_DIR`       | `<worktree>/.reagent-claude-config` | Isolates credentials + session history         |
| `ANTHROPIC_API_KEY`       | _(deleted)_                         | Prevents per-token billing override            |
| `ANTHROPIC_AUTH_TOKEN`    | _(deleted)_                         | Prevents auth cascade override                 |
| `GIT_CONFIG_COUNT=1`      | `gc.auto=0`                         | Prevents auto-gc blocking concurrent worktrees |

Plus CLI flags: `--no-session-persistence`, `--max-turns N`, `--max-budget-usd N`, `--dangerously-skip-permissions`.

### 9.2 Alternative: Agent SDK

The `@anthropic-ai/claude-agent-sdk` (v0.2.98) provides a typed, structured alternative to `child_process.spawn()`:

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

for await (const message of query({
  prompt: 'Your prompt here',
  options: {
    allowedTools: ['Read', 'Edit', 'Bash'],
    permissionMode: 'acceptEdits',
  },
})) {
  if ('result' in message) console.log(message.result);
}
```

**Caveat:** The Agent SDK currently requires `ANTHROPIC_API_KEY` (API billing), not OAuth tokens. For subscription-billed workstreams, use the CLI spawn approach. The SDK may add OAuth support in a future release.

---

## 10. CLI Surface

```
reagent workstream run <config.yaml>    Run a workstream from config
reagent workstream list                 List active workstreams and their status
reagent workstream status <name>        Show detailed status of a workstream
reagent workstream stop <name>          Stop a running workstream
reagent workstream prune                Clean up completed worktrees and state
reagent workstream budget [account]     Show budget usage for an account
```

---

## 11. Timeline and Assignments

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
