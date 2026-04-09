import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { ProjectType, StackAnalysis } from './types.js';

const FRAMEWORK_CONFIGS: Record<string, string> = {
  astro: 'astro.config.*',
  nextjs: 'next.config.*',
  vite: 'vite.config.*',
};

/**
 * Detect project type(s) from filesystem signals.
 */
function detectProjectTypes(targetDir: string, pkg: Record<string, unknown>): ProjectType[] {
  const types: Set<ProjectType> = new Set();
  const deps: Record<string, string> = {
    ...((pkg.dependencies as Record<string, string>) || {}),
    ...((pkg.devDependencies as Record<string, string>) || {}),
  };

  // Astro
  const hasAstroConfig =
    fs.existsSync(path.join(targetDir, 'astro.config.mjs')) ||
    fs.existsSync(path.join(targetDir, 'astro.config.ts')) ||
    fs.existsSync(path.join(targetDir, 'astro.config.js'));
  if (hasAstroConfig || 'astro' in deps) {
    types.add('astro');
  }

  // Next.js
  const hasNextConfig =
    fs.existsSync(path.join(targetDir, 'next.config.js')) ||
    fs.existsSync(path.join(targetDir, 'next.config.mjs')) ||
    fs.existsSync(path.join(targetDir, 'next.config.ts'));
  if (hasNextConfig || 'next' in deps) {
    types.add('nextjs');
  }

  // Drupal (look for core drupal marker files)
  const hasDrupal =
    fs.existsSync(path.join(targetDir, 'web', 'core')) ||
    fs.existsSync(path.join(targetDir, 'drupal', 'core')) ||
    fs.existsSync(path.join(targetDir, 'core', 'includes', 'bootstrap.inc'));
  if (hasDrupal) {
    types.add('drupal');
  }

  // Lit / Web Components
  const hasLit = 'lit' in deps || '@lit/reactive-element' in deps || 'lit-element' in deps;
  const hasWCConfig =
    fs.existsSync(path.join(targetDir, 'custom-elements-manifest.config.mjs')) ||
    fs.existsSync(path.join(targetDir, 'custom-elements.json'));
  if (hasLit || hasWCConfig) {
    types.add('lit-wc');
  }

  // React (only if not already captured by nextjs or astro island-only)
  const hasReact = 'react' in deps && 'react-dom' in deps;
  if (hasReact && !types.has('nextjs')) {
    types.add('react');
  }

  // Node API (has express, fastify, hono, koa or similar)
  const apiFrameworks = ['express', 'fastify', 'hono', 'koa', '@hapi/hapi', 'restify'];
  if (apiFrameworks.some((f) => f in deps)) {
    types.add('node-api');
  }

  // Monorepo (pnpm workspaces, turborepo, lerna, nx)
  const hasWorkspaces =
    Array.isArray(pkg.workspaces) ||
    fs.existsSync(path.join(targetDir, 'pnpm-workspace.yaml')) ||
    fs.existsSync(path.join(targetDir, 'turbo.json')) ||
    fs.existsSync(path.join(targetDir, 'lerna.json')) ||
    fs.existsSync(path.join(targetDir, 'nx.json'));
  if (hasWorkspaces) {
    types.add('monorepo');
  }

  if (types.size === 0) {
    types.add('unknown');
  }

  return Array.from(types);
}

/**
 * Detect the primary framework and version.
 */
function detectFramework(
  detectedTypes: ProjectType[],
  deps: Record<string, string>
): string | null {
  if (detectedTypes.includes('astro')) {
    const version = deps['astro'] || '';
    return `Astro${version ? ' ' + version : ''}`;
  }
  if (detectedTypes.includes('nextjs')) {
    const version = deps['next'] || '';
    return `Next.js${version ? ' ' + version : ''}`;
  }
  if (detectedTypes.includes('lit-wc')) {
    const version = deps['lit'] || deps['lit-element'] || '';
    return `Lit${version ? ' ' + version : ''}`;
  }
  if (detectedTypes.includes('drupal')) {
    return 'Drupal';
  }
  if (detectedTypes.includes('react')) {
    const version = deps['react'] || '';
    return `React${version ? ' ' + version : ''}`;
  }
  if (detectedTypes.includes('node-api')) {
    const apiFramework = ['express', 'fastify', 'hono', 'koa'].find((f) => f in deps);
    if (apiFramework) {
      return `${apiFramework.charAt(0).toUpperCase()}${apiFramework.slice(1)} ${deps[apiFramework] || ''}`.trim();
    }
  }
  return null;
}

/**
 * Detect active test runner.
 */
function detectTestRunner(targetDir: string, deps: Record<string, string>): string | null {
  const runners: string[] = [];

  if (
    'vitest' in deps ||
    fs.existsSync(path.join(targetDir, 'vitest.config.ts')) ||
    fs.existsSync(path.join(targetDir, 'vitest.config.js'))
  ) {
    runners.push('vitest');
  }
  if (
    '@playwright/test' in deps ||
    fs.existsSync(path.join(targetDir, 'playwright.config.ts')) ||
    fs.existsSync(path.join(targetDir, 'playwright.config.js'))
  ) {
    runners.push('playwright');
  }
  if (
    '@web/test-runner' in deps ||
    fs.existsSync(path.join(targetDir, 'web-test-runner.config.mjs')) ||
    fs.existsSync(path.join(targetDir, 'web-test-runner.config.js'))
  ) {
    runners.push('web-test-runner');
  }
  if ('jest' in deps) {
    runners.push('jest');
  }
  if ('mocha' in deps) {
    runners.push('mocha');
  }

  return runners.length > 0 ? runners.join(', ') : null;
}

/**
 * List installed Claude hook scripts.
 */
function detectInstalledHooks(targetDir: string): string[] {
  const hooksDir = path.join(targetDir, '.claude', 'hooks');
  if (!fs.existsSync(hooksDir)) return [];

  return fs
    .readdirSync(hooksDir)
    .filter((f) => f.endsWith('.sh'))
    .map((f) => f.replace('.sh', ''));
}

/**
 * Find test files matching common patterns (shallow scan, no deep recursion to keep fast).
 */
function detectTestFiles(targetDir: string): string[] {
  const testFiles: string[] = [];
  const dirsToSearch = ['src', 'test', 'tests', '__tests__', 'spec'];

  for (const dir of dirsToSearch) {
    const fullDir = path.join(targetDir, dir);
    if (!fs.existsSync(fullDir)) continue;

    try {
      const walk = (d: string, depth: number): void => {
        if (depth > 4) return;
        const entries = fs.readdirSync(d, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isSymbolicLink()) continue;
          const full = path.join(d, entry.name);
          if (entry.isDirectory()) {
            walk(full, depth + 1);
          } else if (
            entry.name.match(/\.(test|spec)\.(ts|tsx|js|jsx|mjs)$/) ||
            entry.name.match(/\.test\.(php|py)$/)
          ) {
            testFiles.push(full);
          }
        }
      };
      walk(fullDir, 0);
    } catch {
      // Ignore unreadable dirs
    }
  }

  return testFiles;
}

/**
 * Check for OpenAPI spec.
 */
function detectOpenApi(targetDir: string): boolean {
  return (
    fs.existsSync(path.join(targetDir, 'openapi.yaml')) ||
    fs.existsSync(path.join(targetDir, 'openapi.json')) ||
    fs.existsSync(path.join(targetDir, 'swagger.yaml')) ||
    fs.existsSync(path.join(targetDir, 'swagger.json')) ||
    fs.existsSync(path.join(targetDir, 'api', 'openapi.yaml')) ||
    fs.existsSync(path.join(targetDir, 'docs', 'openapi.yaml'))
  );
}

/**
 * Check for custom elements / Shadow DOM usage in source.
 */
function detectCustomElements(targetDir: string, deps: Record<string, string>): boolean {
  if ('lit' in deps || '@lit/reactive-element' in deps) return true;
  return fs.existsSync(path.join(targetDir, 'custom-elements.json'));
}

/**
 * Read policy autonomy level and profile from .reagent/policy.yaml if present.
 */
function readPolicy(targetDir: string): { autonomyLevel: string | null; profile: string | null } {
  const policyPath = path.join(targetDir, '.reagent', 'policy.yaml');
  if (!fs.existsSync(policyPath)) return { autonomyLevel: null, profile: null };
  try {
    const raw = fs.readFileSync(policyPath, 'utf8');
    const parsed = parseYaml(raw) as Record<string, unknown>;
    return {
      autonomyLevel: (parsed['autonomy_level'] as string) || null,
      profile: (parsed['profile'] as string) || null,
    };
  } catch {
    return { autonomyLevel: null, profile: null };
  }
}

/**
 * Main analyzer entry point.
 */
export function analyzeStack(targetDir: string): StackAnalysis {
  // Read package.json
  let pkg: Record<string, unknown> = {};
  let projectName = path.basename(targetDir);
  let projectVersion = '0.0.0';

  const pkgPath = path.join(targetDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (typeof pkg.name === 'string') projectName = pkg.name;
      if (typeof pkg.version === 'string') projectVersion = pkg.version;
    } catch {
      // Malformed package.json — proceed with defaults
    }
  }

  const deps: Record<string, string> = {
    ...((pkg.dependencies as Record<string, string>) || {}),
    ...((pkg.devDependencies as Record<string, string>) || {}),
  };

  // Suppress unused variable warning for FRAMEWORK_CONFIGS
  void FRAMEWORK_CONFIGS;

  const detectedTypes = detectProjectTypes(targetDir, pkg);
  const framework = detectFramework(detectedTypes, deps);
  const testRunner = detectTestRunner(targetDir, deps);
  const installedHooks = detectInstalledHooks(targetDir);
  const testFiles = detectTestFiles(targetDir);
  const hasOpenApi = detectOpenApi(targetDir);
  const hasCustomElements = detectCustomElements(targetDir, deps);
  const hasShadowDom = hasCustomElements;

  const { autonomyLevel, profile } = readPolicy(targetDir);

  return {
    projectName,
    projectVersion,
    targetDir,
    detectedTypes,
    framework,
    testRunner,
    installedHooks,
    testFiles,
    autonomyLevel,
    profile,
    hasOpenApi,
    hasCustomElements,
    hasShadowDom,
  };
}
