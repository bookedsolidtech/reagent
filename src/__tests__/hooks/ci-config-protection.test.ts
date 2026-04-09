import { describe, it, expect } from 'vitest';
import { runHook } from './test-utils.js';

function writeWorkflowPayload(filePath: string, content: string) {
  return {
    tool_name: 'Write',
    tool_input: { file_path: filePath, content },
  };
}

describe('ci-config-protection', () => {
  const hook = 'ci-config-protection';

  // ── Should WARN (exit 0 with stderr) ──────────────────────────────

  describe('warns on dangerous CI patterns', () => {
    it('warns on permissions: write-all', () => {
      const result = runHook(
        hook,
        writeWorkflowPayload(
          '/repo/.github/workflows/deploy.yml',
          'permissions: write-all\njobs:\n  build:\n    runs-on: ubuntu-latest'
        )
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain('CI-CONFIG-PROTECTION');
      expect(result.stderr).toContain('write-all');
    });

    it('warns on pull_request_target', () => {
      const result = runHook(
        hook,
        writeWorkflowPayload(
          '/repo/.github/workflows/pr.yml',
          'on:\n  pull_request_target:\n    types: [opened]'
        )
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain('CI-CONFIG-PROTECTION');
      expect(result.stderr).toContain('pull_request_target');
    });

    it('warns on secrets: inherit', () => {
      const result = runHook(
        hook,
        writeWorkflowPayload(
          '/repo/.github/workflows/call.yml',
          'jobs:\n  call:\n    uses: org/repo/.github/workflows/shared.yml@main\n    secrets: inherit'
        )
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain('CI-CONFIG-PROTECTION');
      expect(result.stderr).toContain('secrets: inherit');
    });

    it('warns on multiple patterns at once', () => {
      const result = runHook(
        hook,
        writeWorkflowPayload(
          '/repo/.github/workflows/bad.yml',
          'permissions: write-all\non:\n  pull_request_target:\njobs:\n  build:\n    secrets: inherit'
        )
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain('CI-CONFIG-PROTECTION');
    });
  });

  // ── Should ALLOW silently (exit 0 no stderr) ──────────────────────

  describe('allows safe CI configs', () => {
    it('allows safe workflow with minimal permissions', () => {
      const result = runHook(
        hook,
        writeWorkflowPayload(
          '/repo/.github/workflows/test.yml',
          'on:\n  push:\n    branches: [main]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4'
        )
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
    });

    it('ignores non-workflow files', () => {
      const result = runHook(
        hook,
        writeWorkflowPayload(
          '/repo/src/config.ts',
          'permissions: write-all\npull_request_target\nsecrets: inherit'
        )
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
    });

    it('ignores files without matching path', () => {
      const result = runHook(
        hook,
        writeWorkflowPayload('/repo/.github/dependabot.yml', 'version: 2\nupdates: []')
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
    });

    it('allows empty content for workflow file', () => {
      const result = runHook(hook, {
        tool_name: 'Write',
        tool_input: { file_path: '/repo/.github/workflows/empty.yml' },
      });
      expect(result.exitCode).toBe(0);
    });
  });
});
