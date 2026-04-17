import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: 'src',
    include: ['**/*.test.ts'],
    pool: 'threads',
    teardownTimeout: 30_000,
    // In CI: emit JUnit XML for test result upload + annotations
    // Locally: verbose only (no file output)
    reporters: process.env.CI
      ? ['verbose', ['junit', { outputFile: 'test-results.xml' }]]
      : ['verbose'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      // Exclude test files, generated types, and thin entry points
      exclude: [
        '**/*.test.ts',
        '**/index.ts', // CLI entry — tested via e2e
        '**/cli/commands/**', // CLI command handlers — thin orchestrators, covered by e2e smoke tests
        '**/gateway/server.ts', // Gateway server orchestrator — covered by e2e smoke tests
        '**/gateway/client-manager.ts', // Downstream client manager — covered by e2e smoke tests
        '**/gateway/native-tools.ts', // MCP tool registrations — covered by e2e smoke tests
        '**/pm/github-bridge.ts', // GitHub CLI bridge — integration tested, no unit test surface
        '**/__tests__/**',
      ],
      // Thresholds — enforced when --coverage is passed
      // Override via COVERAGE_THRESHOLD env var (set by pre-push gate from policy.yaml)
      thresholds: {
        lines: Number(process.env.COVERAGE_THRESHOLD ?? 60),
        functions: Number(process.env.COVERAGE_THRESHOLD ?? 60),
        branches: Number(process.env.COVERAGE_THRESHOLD ?? 50),
        statements: Number(process.env.COVERAGE_THRESHOLD ?? 60),
      },
    },
  },
});
