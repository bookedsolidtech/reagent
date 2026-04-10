# Contributing to reagent

Thank you for considering a contribution to reagent. This guide covers dev setup, testing, changeset requirements, branch workflow, and PR expectations.

---

## Dev Setup

**Prerequisites:** Node.js >= 22, pnpm >= 9.

```bash
# Clone the repo
git clone https://github.com/bookedsolidtech/reagent.git
cd reagent

# Install dependencies (pnpm is the canonical package manager for this repo)
pnpm install

# Build the TypeScript source
pnpm build

# Run all tests
pnpm test

# Type-check without emitting
pnpm type-check

# Lint
pnpm lint

# Format
pnpm format
```

`npm install` also works if you do not have pnpm — but pnpm is preferred to ensure the lockfile stays in sync.

### Running a single test file

```bash
# Using vitest directly
pnpm exec vitest run src/__tests__/middleware/policy.test.ts
```

---

## Hook Testing

Hooks live in `hooks/*.sh`. Each hook is a standalone Bash script that reads a JSON payload from stdin and exits non-zero to block the tool call.

The test harness is in `src/__tests__/hooks/test-utils.ts`. It provides:

- `runHook(hookName, payload, env?)` — spawns a hook script with a JSON payload piped to stdin and returns `{ exitCode, stdout, stderr }`.
- `createTempProjectDir()` / `cleanupTempProjectDir()` — create and destroy a temporary directory with a `.reagent/` subdirectory for hooks that inspect the project structure.
- `bashPayload(command)`, `writePayload(filePath, content)`, `editPayload(...)` — convenience builders for common Claude Code tool payloads.

Example test:

```typescript
import { runHook, bashPayload } from '../hooks/test-utils.js';

it('blocks rm -rf /', () => {
  const result = runHook('dangerous-bash-interceptor', bashPayload('rm -rf /'));
  expect(result.exitCode).toBe(2);
  expect(result.stderr).toContain('BLOCKED');
});
```

Hook tests live alongside their counterpart scripts:

```
src/__tests__/hooks/dangerous-bash-interceptor.test.ts  →  hooks/dangerous-bash-interceptor.sh
src/__tests__/hooks/secret-scanner.test.ts              →  hooks/secret-scanner.sh
```

To add a new hook, write the `.sh` file in `hooks/` and a corresponding `.test.ts` file in `src/__tests__/hooks/`.

---

## Changeset Requirements

Every pull request that changes behavior, adds a feature, or fixes a bug requires a changeset entry. Documentation-only PRs are exempt.

```bash
# Run the changeset CLI and follow the prompts
pnpm changeset
```

This creates a file in `.changeset/`. Commit it with your changes. At release time the changeset is consumed to bump the version and update CHANGELOG.md.

Changeset docs: https://github.com/changesets/changesets/blob/main/docs/adding-a-changeset.md

---

## Branch Workflow

```
feat/*  →  dev  →  staging  →  main
```

- **feat/** — feature and fix branches; all PR targets point to `dev`.
- **dev** — integration branch; automated tests run here.
- **staging** — release candidate branch; manual review before merge to main.
- **main** — production; only merge from staging. Never force-push to main.

Create your branch from `dev` (or `staging` for hotfixes on a current release):

```bash
git checkout -b feat/my-feature dev
```

---

## PR Checklist

Before opening a pull request, confirm:

- [ ] `pnpm preflight` passes locally (or `pnpm test && pnpm build && pnpm lint`)
- [ ] A changeset is included (if applicable)
- [ ] The PR body references a GitHub issue: `closes #N` is required
- [ ] `--no-verify` was not used to bypass hooks at any point
- [ ] No secrets, credentials, or API keys are included in any commit
- [ ] New public APIs have TypeScript types and are exported correctly
- [ ] New hooks have corresponding tests in `src/__tests__/hooks/`

---

## Security Findings

Do not open a public GitHub issue for security vulnerabilities. Use [GitHub Security Advisories](https://github.com/bookedsolidtech/reagent/security/advisories/new) or email security@bookedsolid.tech. See [SECURITY.md](SECURITY.md) for the full disclosure policy and response timeline.

---

## Code Style

- TypeScript strict mode is enforced across all source files.
- Prettier and ESLint configs are checked in. Run `pnpm format` before committing.
- Prefer `node:` protocol imports for built-ins (e.g., `import fs from 'node:fs'`).
- No circular dependencies between packages.
- Security-sensitive code should include a `SECURITY:` comment explaining the invariant being protected.
