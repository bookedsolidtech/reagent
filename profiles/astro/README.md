# astro profile

Reagent profile for projects built with [Astro](https://astro.build/) (v3+, including v5).

## When to use

Install this profile when your project:

- Is built with Astro (any rendering mode: SSG, SSR, hybrid)
- Uses Astro components (`.astro` files)
- Has island-architecture client components (React, Vue, Svelte, Lit, etc.)
- Uses `astro check` and `astro build` as quality gates

## What this profile installs

### Hooks

- **astro-ssr-guard.sh** — PostToolUse/Write: warns on React hooks used in `.astro` frontmatter without a `client:*` directive, and `document`/`window` access in SSR context (frontmatter runs server-side).

### Quality gates (gates.yaml)

| Gate             | Command            | On failure |
| ---------------- | ------------------ | ---------- |
| astro-check      | `npx astro check`  | block      |
| astro-build      | `npx astro build`  | block      |
| astro-type-check | `npx tsc --noEmit` | block      |

### Agents

- `astro-specialist` — Astro architecture, islands, content collections
- `frontend-specialist` — general frontend and component patterns
- `performance-engineer` — Core Web Vitals, Astro partial hydration strategies

## Recommended additions

- Playwright e2e tests for rendered pages
- `@astrojs/check` for enhanced type checking
- Lighthouse CI for CWV regression on static output

## Installation

```bash
reagent init --profile astro
```
