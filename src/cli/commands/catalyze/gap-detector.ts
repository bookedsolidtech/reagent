import type { StackAnalysis, Gap, GapAnalysis } from './types.js';

// All hooks recommended for every project (base catalog)
const BASE_HOOKS = [
  'secret-scanner',
  'dangerous-bash-interceptor',
  'env-file-protection',
  'blocked-paths-enforcer',
  'dependency-audit-gate',
  'attribution-advisory',
  'commit-review-gate',
  'push-review-gate',
  'settings-protection',
  // v0.6.0 additions
  'output-validation',
  'file-size-guard',
  'symlink-guard',
  'git-config-guard',
  'network-exfil-guard',
  'rate-limit-guard',
  'ci-config-protection',
  'import-guard',
];

let gapCounter = 0;
function nextId(): string {
  return `G-${String(++gapCounter).padStart(3, '0')}`;
}

/**
 * Detect gaps against the base hook catalog.
 */
function detectBaseHookGaps(analysis: StackAnalysis): Gap[] {
  const gaps: Gap[] = [];
  const installed = new Set(analysis.installedHooks);

  for (const hook of BASE_HOOKS) {
    if (!installed.has(hook)) {
      const isCritical = [
        'secret-scanner',
        'dangerous-bash-interceptor',
        'output-validation',
        'env-file-protection',
      ].includes(hook);

      gaps.push({
        id: nextId(),
        severity: isCritical ? 'critical' : 'high',
        category: 'hook',
        title: `Missing hook: ${hook}.sh`,
        description: `The '${hook}' hook is not installed. It is part of the reagent base security catalog.`,
        suggestion: `Run 'reagent init' to install all base hooks.`,
      });
    }
  }

  return gaps;
}

/**
 * Detect Astro-specific gaps.
 */
function detectAstroGaps(analysis: StackAnalysis): Gap[] {
  const gaps: Gap[] = [];
  const installed = new Set(analysis.installedHooks);

  // Hook: astro-ssr-guard
  if (!installed.has('astro-ssr-guard')) {
    gaps.push({
      id: nextId(),
      severity: 'high',
      category: 'hook',
      title: 'Missing hook: astro-ssr-guard.sh',
      description:
        'Warns when React hooks or browser globals (document/window) appear in Astro frontmatter (SSR context).',
      suggestion: `Run 'reagent init --profile astro' to install the Astro profile hooks.`,
      projectTypes: ['astro'],
    });
  }

  // Gate: astro check
  gaps.push({
    id: nextId(),
    severity: 'critical',
    category: 'gate',
    title: 'Missing gate: astro check',
    description: `'npx astro check' should be part of your preflight script to catch type errors in .astro files before commit.`,
    suggestion: `Add 'npx astro check' to your preflight.sh or package.json scripts.`,
    projectTypes: ['astro'],
  });

  // Gate: astro build
  gaps.push({
    id: nextId(),
    severity: 'high',
    category: 'gate',
    title: 'Missing gate: astro build smoke test',
    description: `'npx astro build' should run as a quality gate to catch build failures before push.`,
    suggestion: `Add 'npx astro build' to your preflight.sh.`,
    projectTypes: ['astro'],
  });

  return gaps;
}

/**
 * Detect Next.js-specific gaps.
 */
function detectNextjsGaps(analysis: StackAnalysis): Gap[] {
  const gaps: Gap[] = [];
  const installed = new Set(analysis.installedHooks);

  if (!installed.has('server-component-drift')) {
    gaps.push({
      id: nextId(),
      severity: 'high',
      category: 'hook',
      title: 'Missing hook: server-component-drift.sh',
      description:
        "Warns when React client hooks appear in Server Components missing 'use client', and on dangerouslySetInnerHTML usage.",
      suggestion: `Run 'reagent init --profile nextjs' to install the Next.js profile.`,
      projectTypes: ['nextjs'],
    });
  }

  gaps.push({
    id: nextId(),
    severity: 'critical',
    category: 'gate',
    title: 'Missing gate: next build',
    description: `'npx next build' should be a preflight gate to catch build failures.`,
    suggestion: `Add 'npx next build' to your preflight script.`,
    projectTypes: ['nextjs'],
  });

  gaps.push({
    id: nextId(),
    severity: 'high',
    category: 'gate',
    title: 'Missing gate: next lint',
    description: `'npx next lint' should run to catch ESLint issues in Next.js projects.`,
    suggestion: `Add 'npx next lint' to your preflight script.`,
    projectTypes: ['nextjs'],
  });

  return gaps;
}

/**
 * Detect Lit/Web Components-specific gaps.
 */
function detectLitWcGaps(analysis: StackAnalysis): Gap[] {
  const gaps: Gap[] = [];
  const installed = new Set(analysis.installedHooks);

  if (!installed.has('shadow-dom-guard')) {
    gaps.push({
      id: nextId(),
      severity: 'high',
      category: 'hook',
      title: 'Missing hook: shadow-dom-guard.sh',
      description:
        'Warns on document.querySelector inside web components, missing :host CSS scoping, and unsafe customElements.define() calls.',
      suggestion: `Run 'reagent init --profile lit-wc' to install the Lit/WC profile.`,
      projectTypes: ['lit-wc'],
    });
  }

  if (!installed.has('cem-integrity-gate')) {
    gaps.push({
      id: nextId(),
      severity: 'normal',
      category: 'hook',
      title: 'Missing hook: cem-integrity-gate.sh',
      description:
        'Reminds to regenerate custom-elements.json after component source changes and validates manifest integrity.',
      suggestion: `Run 'reagent init --profile lit-wc' to install the Lit/WC profile.`,
      projectTypes: ['lit-wc'],
    });
  }

  gaps.push({
    id: nextId(),
    severity: 'critical',
    category: 'gate',
    title: 'Missing gate: cem analyze (Custom Elements Manifest)',
    description: `'npx cem analyze' must pass to keep the custom elements manifest valid and in sync with component source.`,
    suggestion: `Add 'npx cem analyze' to your preflight script and run 'reagent init --profile lit-wc'.`,
    projectTypes: ['lit-wc'],
  });

  gaps.push({
    id: nextId(),
    severity: 'high',
    category: 'gate',
    title: 'Missing gate: Web Test Runner component tests',
    description: `Component-level tests with @web/test-runner or equivalent are not detected.`,
    suggestion: `Add 'npx wtr --coverage' to your preflight script.`,
    projectTypes: ['lit-wc'],
  });

  gaps.push({
    id: nextId(),
    severity: 'high',
    category: 'agent',
    title: 'Missing agent: lit-specialist',
    description: `A Lit/Web Component specialist agent is recommended for Shadow DOM and custom element architecture.`,
    suggestion: `Run 'reagent init --profile lit-wc' to install specialist agents.`,
    projectTypes: ['lit-wc'],
  });

  gaps.push({
    id: nextId(),
    severity: 'normal',
    category: 'agent',
    title: 'Missing agent: accessibility-engineer',
    description: 'An accessibility specialist is recommended for web component a11y reviews.',
    suggestion: `Run 'reagent init --profile lit-wc'.`,
    projectTypes: ['lit-wc'],
  });

  if (analysis.testFiles.length === 0) {
    gaps.push({
      id: nextId(),
      severity: 'high',
      category: 'test',
      title: 'Missing: visual regression tests',
      description:
        'No Playwright snapshots or visual regression tests detected. Components should have visual snapshots.',
      suggestion: `Add Playwright component tests with visual snapshot assertions.`,
      projectTypes: ['lit-wc'],
    });

    gaps.push({
      id: nextId(),
      severity: 'normal',
      category: 'test',
      title: 'Missing: a11y test suite',
      description:
        'No axe-core or @axe-core/playwright detected. Accessibility should be tested automatically.',
      suggestion: `Add @axe-core/playwright to your test suite.`,
      projectTypes: ['lit-wc'],
    });
  }

  return gaps;
}

/**
 * Detect Drupal-specific gaps.
 */
function detectDrupalGaps(analysis: StackAnalysis): Gap[] {
  const gaps: Gap[] = [];
  const installed = new Set(analysis.installedHooks);

  if (!installed.has('drupal-coding-standards')) {
    gaps.push({
      id: nextId(),
      severity: 'high',
      category: 'hook',
      title: 'Missing hook: drupal-coding-standards.sh',
      description:
        'Warns on raw superglobals, hardcoded entity IDs, hook_update_N issues, and t() misuse.',
      suggestion: `Run 'reagent init --profile drupal'.`,
      projectTypes: ['drupal'],
    });
  }

  if (!installed.has('hook-update-guard')) {
    gaps.push({
      id: nextId(),
      severity: 'normal',
      category: 'hook',
      title: 'Missing hook: hook-update-guard.sh',
      description:
        'Guards .install files for destructive schema operations and update hook numbering gaps.',
      suggestion: `Run 'reagent init --profile drupal'.`,
      projectTypes: ['drupal'],
    });
  }

  gaps.push({
    id: nextId(),
    severity: 'critical',
    category: 'gate',
    title: 'Missing gate: PHPCS Drupal coding standards',
    description: `'vendor/bin/phpcs --standard=Drupal' must pass to enforce coding standards.`,
    suggestion: `Install drupal/coder and run 'reagent init --profile drupal'.`,
    projectTypes: ['drupal'],
  });

  gaps.push({
    id: nextId(),
    severity: 'high',
    category: 'agent',
    title: 'Missing agent: drupal-specialist',
    description:
      'A Drupal architecture specialist is recommended for module and theme development.',
    suggestion: `Run 'reagent init --profile drupal'.`,
    projectTypes: ['drupal'],
  });

  gaps.push({
    id: nextId(),
    severity: 'normal',
    category: 'test',
    title: 'Missing: Behat/PHPUnit behavioral tests',
    description:
      'No Behat or PHPUnit test files detected. Drupal modules should have test coverage.',
    suggestion: `Add Behat behavioral tests for content workflows.`,
    projectTypes: ['drupal'],
  });

  return gaps;
}

/**
 * Detect React-specific gaps (when not already nextjs).
 */
function detectReactGaps(_analysis: StackAnalysis): Gap[] {
  const gaps: Gap[] = [];

  gaps.push({
    id: nextId(),
    severity: 'high',
    category: 'gate',
    title: 'Missing gate: Playwright or Cypress e2e coverage',
    description: 'No e2e test runner detected. React apps should have e2e coverage.',
    suggestion: `Add Playwright e2e tests and include 'npx playwright test' in preflight.`,
    projectTypes: ['react'],
  });

  return gaps;
}

/**
 * Detect Node API-specific gaps.
 */
function detectNodeApiGaps(analysis: StackAnalysis): Gap[] {
  const gaps: Gap[] = [];

  if (analysis.hasOpenApi) {
    gaps.push({
      id: nextId(),
      severity: 'high',
      category: 'gate',
      title: 'Missing gate: OpenAPI/Swagger spec validation',
      description: 'An OpenAPI spec is present but no validation gate is configured.',
      suggestion: `Add 'npx @redocly/cli lint openapi.yaml' to your preflight script.`,
      projectTypes: ['node-api'],
    });
  }

  gaps.push({
    id: nextId(),
    severity: 'normal',
    category: 'gate',
    title: 'Missing gate: load test baseline',
    description: 'No load testing tool (k6, autocannon) detected for API performance baseline.',
    suggestion: `Add a k6 or autocannon load test script to your preflight or CI pipeline.`,
    projectTypes: ['node-api'],
  });

  return gaps;
}

/**
 * Run full gap detection against a stack analysis.
 */
export function detectGaps(analysis: StackAnalysis): GapAnalysis {
  gapCounter = 0; // Reset counter for this run
  const gaps: Gap[] = [];

  // Base gaps (apply to all projects)
  gaps.push(...detectBaseHookGaps(analysis));

  // Type-specific gaps
  for (const projectType of analysis.detectedTypes) {
    switch (projectType) {
      case 'astro':
        gaps.push(...detectAstroGaps(analysis));
        break;
      case 'nextjs':
        gaps.push(...detectNextjsGaps(analysis));
        break;
      case 'lit-wc':
        gaps.push(...detectLitWcGaps(analysis));
        break;
      case 'drupal':
        gaps.push(...detectDrupalGaps(analysis));
        break;
      case 'react':
        gaps.push(...detectReactGaps(analysis));
        break;
      case 'node-api':
        gaps.push(...detectNodeApiGaps(analysis));
        break;
    }
  }

  // Sort: critical first, then high, then normal
  const severityOrder: Record<string, number> = { critical: 0, high: 1, normal: 2 };
  gaps.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return {
    stack: analysis,
    gaps,
    totalRecommendedHooks: BASE_HOOKS.length,
    installedHookCount: analysis.installedHooks.length,
    totalRecommendedGates: gaps.filter((g) => g.category === 'gate').length,
  };
}
