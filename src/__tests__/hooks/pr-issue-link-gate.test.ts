import { describe, it, expect } from 'vitest';
import { runHook, bashPayload } from './test-utils.js';

describe('pr-issue-link-gate', () => {
  const hook = 'pr-issue-link-gate';

  // ── ADVISORY (exit 0 with warning) ────────────────────────────────

  describe('emits advisory when closes/fixes/resolves missing', () => {
    it('warns on gh pr create with no issue reference', () => {
      const result = runHook(
        hook,
        bashPayload('gh pr create --title "fix: update thing" --body "Some description"')
      );
      expect(result.exitCode).toBe(0); // advisory — does not block
      expect(result.stderr).toContain('PR ISSUE LINK ADVISORY');
    });

    it('warns when body has no closes keyword', () => {
      const result = runHook(
        hook,
        bashPayload('gh pr create --title "chore: update deps" --body "bumps lodash"')
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain('closes #N');
    });
  });

  // ── SHOULD PASS (exit 0, no output) ──────────────────────────────

  describe('passes when issue reference is present', () => {
    it('passes with "closes #N"', () => {
      const result = runHook(
        hook,
        bashPayload(
          'gh pr create --title "fix: policy loader" --body "Switches to async I/O\\n\\ncloses #34"'
        )
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
    });

    it('passes with "fixes #N"', () => {
      const result = runHook(
        hook,
        bashPayload('gh pr create --title "fix: schema" --body "fixes #37"')
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
    });

    it('passes with "resolves #N"', () => {
      const result = runHook(
        hook,
        bashPayload('gh pr create --title "fix: circuit breaker" --body "resolves #28"')
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
    });

    it('passes with uppercase "Closes #N"', () => {
      const result = runHook(
        hook,
        bashPayload('gh pr create --title "feat: audit cmd" --body "Closes #27"')
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
    });

    it('passes with multiple closes', () => {
      const result = runHook(
        hook,
        bashPayload('gh pr create --title "feat: multiple" --body "closes #25, closes #26"')
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
    });
  });

  // ── SHOULD SKIP ───────────────────────────────────────────────────

  describe('ignores non-pr-create commands', () => {
    it('skips gh pr list', () => {
      const result = runHook(hook, bashPayload('gh pr list'));
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
    });

    it('skips gh pr edit', () => {
      const result = runHook(hook, bashPayload('gh pr edit 24 --body "updated"'));
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
    });

    it('skips gh issue create', () => {
      const result = runHook(hook, bashPayload('gh issue create --title "bug: thing"'));
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
    });

    it('skips non-gh commands', () => {
      const result = runHook(hook, bashPayload('git push origin staging'));
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
    });

    it('skips non-Bash tools', () => {
      const result = runHook(hook, {
        tool_name: 'Write',
        tool_input: { file_path: '/foo/bar.ts', content: 'closes #1' },
      });
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
    });
  });
});
