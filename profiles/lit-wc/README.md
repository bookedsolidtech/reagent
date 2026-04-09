# lit-wc profile

Reagent profile for projects using [Lit](https://lit.dev/) and native Web Components (Custom Elements v1, Shadow DOM).

## When to use

Install this profile when your project:

- Uses `LitElement`, `ReactiveElement`, or plain `HTMLElement` subclasses
- Registers custom elements via `customElements.define()`
- Uses Shadow DOM for style encapsulation
- Uses the Custom Elements Manifest (`cem analyze`) for component documentation

## What this profile installs

### Hooks

- **shadow-dom-guard.sh** — PostToolUse/Write: warns on `document.querySelector` inside web components, missing `:host` CSS scoping, and `customElements.define()` without a guard check.
- **cem-integrity-gate.sh** — PostToolUse/Write: advisory reminder to regenerate `custom-elements.json` after component source changes.

### Quality gates (gates.yaml)

| Gate            | Command              | On failure |
| --------------- | -------------------- | ---------- |
| cem-analyze     | `npx cem analyze`    | block      |
| web-test-runner | `npx wtr --coverage` | warn       |
| lit-ts-check    | `npx tsc --noEmit`   | block      |

### Agents

- `lit-specialist` — deep Lit/Web Components expertise
- `accessibility-engineer` — a11y for custom elements and ARIA
- `frontend-specialist` — general frontend patterns
- `design-system-developer` — design token and component API patterns

## Recommended additions

- Visual regression tests (Playwright snapshots or Storybook visual tests)
- `@axe-core/playwright` for accessibility audits per component
- `@web/test-runner-playwright` for real browser test execution

## Installation

```bash
reagent init --profile lit-wc
```

Or during initial setup when `reagent catalyze` detects Lit/Web Components usage.
