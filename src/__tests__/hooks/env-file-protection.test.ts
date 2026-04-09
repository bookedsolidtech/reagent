import { describe, it, expect } from 'vitest';
import { runHook, bashPayload } from './test-utils.js';

describe('env-file-protection', () => {
  const hook = 'env-file-protection';

  // ── Should BLOCK (exit 2) ──────────────────────────────────────────

  describe('blocks .env file reads', () => {
    it('blocks cat .env', () => {
      const result = runHook(hook, bashPayload('cat .env'));
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('ENV FILE PROTECTION');
    });

    it('blocks head .env.local', () => {
      const result = runHook(hook, bashPayload('head -20 .env.local'));
      expect(result.exitCode).toBe(2);
    });

    it('blocks grep in .env', () => {
      const result = runHook(hook, bashPayload('grep API_KEY .env'));
      expect(result.exitCode).toBe(2);
    });

    it('blocks source .env', () => {
      const result = runHook(hook, bashPayload('source .env'));
      expect(result.exitCode).toBe(2);
    });

    it('blocks . .env (dot-source)', () => {
      const result = runHook(hook, bashPayload('. .env'));
      expect(result.exitCode).toBe(2);
    });

    it('blocks cp .env', () => {
      const result = runHook(hook, bashPayload('cp .env .env.backup'));
      expect(result.exitCode).toBe(2);
    });

    it('blocks cat .envrc', () => {
      const result = runHook(hook, bashPayload('cat .envrc'));
      expect(result.exitCode).toBe(2);
    });
  });

  // ── Should ALLOW (exit 0) ──────────────────────────────────────────

  describe('allows safe commands', () => {
    it('allows cat on non-env files', () => {
      const result = runHook(hook, bashPayload('cat README.md'));
      expect(result.exitCode).toBe(0);
    });

    it('allows grep on non-env files', () => {
      const result = runHook(hook, bashPayload('grep function src/index.ts'));
      expect(result.exitCode).toBe(0);
    });

    it('allows git commands', () => {
      const result = runHook(hook, bashPayload('git status'));
      expect(result.exitCode).toBe(0);
    });

    it('allows npm commands', () => {
      const result = runHook(hook, bashPayload('npm test'));
      expect(result.exitCode).toBe(0);
    });

    it('allows empty command', () => {
      const result = runHook(hook, { tool_name: 'Bash', tool_input: {} });
      expect(result.exitCode).toBe(0);
    });
  });
});
