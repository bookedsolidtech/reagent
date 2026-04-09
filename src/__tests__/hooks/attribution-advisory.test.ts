import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { runHook, bashPayload, createTempProjectDir, cleanupTempProjectDir } from './test-utils.js';

describe('attribution-advisory', () => {
  const hook = 'attribution-advisory';
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempProjectDir();
    // Create policy with attribution blocking enabled
    fs.writeFileSync(
      `${tmpDir}/.reagent/policy.yaml`,
      'version: "1"\nblock_ai_attribution: true\n'
    );
  });

  afterEach(() => {
    cleanupTempProjectDir(tmpDir);
  });

  // ── Should BLOCK (exit 2) when attribution enabled ─────────────────

  describe('blocks attribution markers', () => {
    it('blocks Co-Authored-By with noreply@', () => {
      const result = runHook(
        hook,
        bashPayload('git commit -m "fix: stuff\n\nCo-Authored-By: Claude <noreply@anthropic.com>"'),
        { CLAUDE_PROJECT_DIR: tmpDir }
      );
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('BLOCKED');
    });

    it('blocks Co-Authored-By with Claude name', () => {
      const result = runHook(
        hook,
        bashPayload('git commit -m "fix: stuff\n\nCo-Authored-By: Claude Sonnet <foo@bar.com>"'),
        { CLAUDE_PROJECT_DIR: tmpDir }
      );
      expect(result.exitCode).toBe(2);
    });

    it('blocks "Generated with Claude Code" footer', () => {
      const result = runHook(
        hook,
        bashPayload('gh pr create --title "test" --body "Generated with Claude Code"'),
        { CLAUDE_PROJECT_DIR: tmpDir }
      );
      expect(result.exitCode).toBe(2);
    });

    it('blocks markdown-linked attribution', () => {
      const result = runHook(
        hook,
        bashPayload('gh pr create --title "test" --body "Made with [Claude Code](https://...)"'),
        { CLAUDE_PROJECT_DIR: tmpDir }
      );
      expect(result.exitCode).toBe(2);
    });
  });

  // ── Should ALLOW (exit 0) ──────────────────────────────────────────

  describe('allows clean commands', () => {
    it('allows git commit without attribution', () => {
      const result = runHook(hook, bashPayload('git commit -m "fix: resolve login bug"'), {
        CLAUDE_PROJECT_DIR: tmpDir,
      });
      expect(result.exitCode).toBe(0);
    });

    it('allows non-git/gh commands', () => {
      const result = runHook(hook, bashPayload('npm test'), { CLAUDE_PROJECT_DIR: tmpDir });
      expect(result.exitCode).toBe(0);
    });

    it('allows legitimate AI tool name references', () => {
      const result = runHook(
        hook,
        bashPayload('git commit -m "fix: update Claude API integration"'),
        { CLAUDE_PROJECT_DIR: tmpDir }
      );
      expect(result.exitCode).toBe(0);
    });
  });

  // ── Disabled by policy ─────────────────────────────────────────────

  describe('respects policy setting', () => {
    it('allows everything when block_ai_attribution is false', () => {
      fs.writeFileSync(
        `${tmpDir}/.reagent/policy.yaml`,
        'version: "1"\nblock_ai_attribution: false\n'
      );

      const result = runHook(
        hook,
        bashPayload('git commit -m "fix: stuff\n\nCo-Authored-By: Claude <noreply@anthropic.com>"'),
        { CLAUDE_PROJECT_DIR: tmpDir }
      );
      expect(result.exitCode).toBe(0);
    });

    it('allows everything when policy.yaml is missing', () => {
      fs.unlinkSync(`${tmpDir}/.reagent/policy.yaml`);

      const result = runHook(
        hook,
        bashPayload('git commit -m "fix: stuff\n\nCo-Authored-By: Claude <noreply@anthropic.com>"'),
        { CLAUDE_PROJECT_DIR: tmpDir }
      );
      expect(result.exitCode).toBe(0);
    });
  });
});
