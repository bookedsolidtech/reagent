import { describe, it, expect } from 'vitest';
import { runHook, writePayload, editPayload } from './test-utils.js';

describe('settings-protection', () => {
  const hook = 'settings-protection';

  describe('blocks protected paths', () => {
    it('blocks .claude/settings.json', () => {
      const result = runHook(hook, writePayload('.claude/settings.json', '{}'));
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('SETTINGS PROTECTION');
    });

    it('blocks .claude/settings.local.json', () => {
      const result = runHook(hook, writePayload('.claude/settings.local.json', '{}'));
      expect(result.exitCode).toBe(2);
    });

    it('blocks .claude/hooks/ files', () => {
      const result = runHook(hook, writePayload('.claude/hooks/my-hook.sh', '#!/bin/bash'));
      expect(result.exitCode).toBe(2);
    });

    it('blocks .husky/ files', () => {
      const result = runHook(hook, writePayload('.husky/pre-commit', '#!/bin/bash'));
      expect(result.exitCode).toBe(2);
    });

    it('blocks .reagent/policy.yaml', () => {
      const result = runHook(hook, writePayload('.reagent/policy.yaml', 'version: 1'));
      expect(result.exitCode).toBe(2);
    });

    it('blocks .reagent/HALT', () => {
      const result = runHook(hook, writePayload('.reagent/HALT', 'frozen'));
      expect(result.exitCode).toBe(2);
    });

    it('blocks Edit tool on protected paths', () => {
      const result = runHook(hook, editPayload('.claude/settings.json', '"old"', '"new"'));
      expect(result.exitCode).toBe(2);
    });

    it('blocks case-manipulated paths', () => {
      const result = runHook(hook, writePayload('.Claude/Settings.json', '{}'));
      expect(result.exitCode).toBe(2);
    });

    it('blocks absolute paths that resolve to protected files', () => {
      const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
      const result = runHook(hook, writePayload(`${projectDir}/.claude/settings.json`, '{}'));
      expect(result.exitCode).toBe(2);
    });
  });

  describe('allows non-protected paths', () => {
    it('allows src/ files', () => {
      const result = runHook(hook, writePayload('src/index.ts', 'export {};'));
      expect(result.exitCode).toBe(0);
    });

    it('allows .reagent/gateway.yaml', () => {
      const result = runHook(hook, writePayload('.reagent/gateway.yaml', 'version: 1'));
      expect(result.exitCode).toBe(0);
    });

    it('allows .reagent/review-cache.json (operational cache, not a security control)', () => {
      const result = runHook(hook, writePayload('.reagent/review-cache.json', '{}'));
      expect(result.exitCode).toBe(0);
    });

    it('allows .reagent/tasks.jsonl', () => {
      const result = runHook(hook, writePayload('.reagent/tasks.jsonl', ''));
      expect(result.exitCode).toBe(0);
    });

    it('allows package.json', () => {
      const result = runHook(hook, writePayload('package.json', '{}'));
      expect(result.exitCode).toBe(0);
    });

    it('allows empty file_path', () => {
      const result = runHook(hook, { tool_name: 'Write', tool_input: {} });
      expect(result.exitCode).toBe(0);
    });
  });
});
