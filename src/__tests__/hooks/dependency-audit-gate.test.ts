import { describe, it, expect } from 'vitest';
import { runHook, bashPayload } from './test-utils.js';

describe('dependency-audit-gate', () => {
  const hook = 'dependency-audit-gate';

  describe('allows valid packages', () => {
    it('allows npm install of real package', () => {
      const result = runHook(hook, bashPayload('npm install zod'));
      expect(result.exitCode).toBe(0);
    });

    it('allows pnpm add of real package', () => {
      const result = runHook(hook, bashPayload('pnpm add yaml'));
      expect(result.exitCode).toBe(0);
    });

    it('allows npm install with no arguments (project install)', () => {
      const result = runHook(hook, bashPayload('npm install'));
      expect(result.exitCode).toBe(0);
    });

    it('allows npm ci', () => {
      const result = runHook(hook, bashPayload('npm ci'));
      expect(result.exitCode).toBe(0);
    });

    it('allows non-install commands', () => {
      const result = runHook(hook, bashPayload('npm test'));
      expect(result.exitCode).toBe(0);
    });

    it('allows empty command', () => {
      const result = runHook(hook, { tool_name: 'Bash', tool_input: {} });
      expect(result.exitCode).toBe(0);
    });
  });

  describe('blocks non-existent packages', () => {
    it('blocks npm install of fake package', () => {
      const result = runHook(
        hook,
        bashPayload('npm install this-package-definitely-does-not-exist-reagent-test-xyz')
      );
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('DEPENDENCY AUDIT');
    });
  });
});
