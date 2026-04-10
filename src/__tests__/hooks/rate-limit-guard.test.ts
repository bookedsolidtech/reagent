import { describe, it, expect, beforeEach } from 'vitest';
import { runHook, bashPayload, writePayload } from './test-utils.js';
import fs from 'node:fs';

describe('rate-limit-guard', () => {
  const hook = 'rate-limit-guard';

  beforeEach(() => {
    // Clear rate limit log files before each test
    const logFiles = [
      '/tmp/reagent-rate-limit-bash.log',
      '/tmp/reagent-rate-limit-write.log',
      '/tmp/reagent-rate-limit-edit.log',
    ];
    for (const f of logFiles) {
      try {
        fs.unlinkSync(f);
      } catch {
        // File may not exist — that's fine
      }
    }
  });

  // ── Should BLOCK (exit 2) ──────────────────────────────────────────

  describe('blocks when rate limit exceeded', () => {
    it('blocks when log already shows 20+ calls in window', () => {
      // Pre-populate the log file with 20 recent timestamps
      const now = Math.floor(Date.now() / 1000);
      const lines = Array.from({ length: 20 }, () => String(now)).join('\n') + '\n';
      fs.writeFileSync('/tmp/reagent-rate-limit-bash.log', lines);

      const result = runHook(hook, bashPayload('git status'));
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('RATE-LIMIT-GUARD');
      expect(result.stderr).toContain('rate limit exceeded');
    });

    it('includes tool name in error message', () => {
      const now = Math.floor(Date.now() / 1000);
      const lines = Array.from({ length: 20 }, () => String(now)).join('\n') + '\n';
      fs.writeFileSync('/tmp/reagent-rate-limit-bash.log', lines);

      const result = runHook(hook, bashPayload('ls'));
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('Bash');
    });
  });

  // ── Should ALLOW (exit 0) ──────────────────────────────────────────

  describe('allows calls within rate limit', () => {
    it('allows first call (no log file)', () => {
      const result = runHook(hook, bashPayload('git status'));
      expect(result.exitCode).toBe(0);
    });

    it('allows calls when log has only old timestamps', () => {
      // Timestamps from 2 minutes ago — outside the 60s window
      const old = Math.floor(Date.now() / 1000) - 180;
      const lines = Array.from({ length: 25 }, () => String(old)).join('\n') + '\n';
      fs.writeFileSync('/tmp/reagent-rate-limit-bash.log', lines);

      const result = runHook(hook, bashPayload('git status'));
      expect(result.exitCode).toBe(0);
    });

    it('allows 19 calls (below limit)', () => {
      const now = Math.floor(Date.now() / 1000);
      const lines = Array.from({ length: 19 }, () => String(now)).join('\n') + '\n';
      fs.writeFileSync('/tmp/reagent-rate-limit-bash.log', lines);

      const result = runHook(hook, bashPayload('git status'));
      expect(result.exitCode).toBe(0);
    });

    it('allows Write tool calls within limit', () => {
      const result = runHook(hook, writePayload('/tmp/test.ts', 'const x = 1;'));
      expect(result.exitCode).toBe(0);
    });

    it('allows missing tool name (no tracking)', () => {
      const result = runHook(hook, { tool_input: { command: 'echo hello' } });
      expect(result.exitCode).toBe(0);
    });
  });
});
