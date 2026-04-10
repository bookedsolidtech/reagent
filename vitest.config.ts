import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: 'src',
    include: ['**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      // Exclude test files, generated types, and thin entry points
      exclude: [
        '**/*.test.ts',
        '**/index.ts', // CLI entry — tested via e2e
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
