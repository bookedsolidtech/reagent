import { describe, it, expect } from 'vitest';
import { runHook, bashPayload } from './test-utils.js';

describe('git-config-guard', () => {
  const hook = 'git-config-guard';

  // ── Should BLOCK (exit 2) ──────────────────────────────────────────

  describe('blocks dangerous git config commands', () => {
    it('blocks git config core.hooksPath', () => {
      const result = runHook(hook, bashPayload('git config core.hooksPath /tmp/hooks'));
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('GIT-CONFIG-GUARD');
      expect(result.stderr).toContain('core.hooksPath');
    });

    it('blocks git config --global core.hooksPath', () => {
      const result = runHook(hook, bashPayload('git config --global core.hooksPath ""'));
      expect(result.exitCode).toBe(2);
    });

    it('blocks git config http.sslVerify false', () => {
      const result = runHook(hook, bashPayload('git config http.sslVerify false'));
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('sslVerify');
    });

    it('blocks git config http.sslVerify 0', () => {
      const result = runHook(hook, bashPayload('git config http.sslVerify 0'));
      expect(result.exitCode).toBe(2);
    });

    it('blocks git config safe.directory', () => {
      const result = runHook(hook, bashPayload('git config --global safe.directory /some/path'));
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('safe.directory');
    });

    it('blocks git config --global user.email change', () => {
      const result = runHook(hook, bashPayload('git config --global user.email attacker@evil.com'));
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('user.email');
    });

    it('blocks git config --system user.name change', () => {
      const result = runHook(hook, bashPayload('git config --system user.name "Attacker"'));
      expect(result.exitCode).toBe(2);
    });
  });

  // ── Should ALLOW (exit 0) ──────────────────────────────────────────

  describe('allows safe git commands', () => {
    it('allows git status', () => {
      const result = runHook(hook, bashPayload('git status'));
      expect(result.exitCode).toBe(0);
    });

    it('allows git config --list', () => {
      const result = runHook(hook, bashPayload('git config --list'));
      expect(result.exitCode).toBe(0);
    });

    it('allows git config --get user.email', () => {
      const result = runHook(hook, bashPayload('git config --get user.email'));
      expect(result.exitCode).toBe(0);
    });

    it('allows git config http.sslVerify true', () => {
      const result = runHook(hook, bashPayload('git config http.sslVerify true'));
      expect(result.exitCode).toBe(0);
    });

    it('allows local user.email (no --global/--system)', () => {
      // Local user.email changes are for the repo only — not blocked
      const result = runHook(hook, bashPayload('git config user.email dev@example.com'));
      expect(result.exitCode).toBe(0);
    });

    it('allows git commit', () => {
      const result = runHook(hook, bashPayload('git commit -m "chore: update"'));
      expect(result.exitCode).toBe(0);
    });

    it('allows empty command', () => {
      const result = runHook(hook, { tool_name: 'Bash', tool_input: {} });
      expect(result.exitCode).toBe(0);
    });
  });
});
