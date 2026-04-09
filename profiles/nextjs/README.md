# nextjs profile

Reagent profile for Next.js projects using the App Router (Next.js 13+).

## When to use

Install this profile when your project:

- Uses Next.js with the App Router (`app/` directory)
- Has a mix of Server and Client Components
- Uses `next build` and `next lint` as quality gates

## What this profile installs

### Hooks

- **server-component-drift.sh** — PostToolUse/Write: warns on React client hooks in files missing `'use client'`, `dangerouslySetInnerHTML` usage, and unnecessary `'use client'` in data-fetching-only files.

### Quality gates (gates.yaml)

| Gate              | Command            | On failure |
| ----------------- | ------------------ | ---------- |
| next-build        | `npx next build`   | block      |
| next-lint         | `npx next lint`    | block      |
| nextjs-type-check | `npx tsc --noEmit` | block      |

### Agents

- `nextjs-specialist` — Next.js App Router, RSC, streaming
- `frontend-specialist` — general frontend patterns
- `performance-engineer` — Core Web Vitals and bundle optimization
- `security-engineer-appsec` — XSS, CSRF, and Next.js security headers

## Recommended additions

- Playwright e2e tests (`npx playwright test`)
- `@next/bundle-analyzer` for bundle analysis
- Lighthouse CI for CWV regression

## Installation

```bash
reagent init --profile nextjs
```
