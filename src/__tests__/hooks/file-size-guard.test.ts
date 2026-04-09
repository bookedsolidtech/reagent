import { describe, it, expect } from 'vitest';
import { runHook, writePayload, editPayload } from './test-utils.js';

describe('file-size-guard', () => {
  const hook = 'file-size-guard';

  // ── Should BLOCK (exit 2) ──────────────────────────────────────────

  describe('blocks oversized content', () => {
    it('blocks Write with content over 512KB', () => {
      // Generate 513KB of content
      const large = 'x'.repeat(513 * 1024);
      const result = runHook(hook, writePayload('/tmp/large.ts', large));
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('512KB limit');
    });

    it('blocks Edit with new_string over 512KB', () => {
      const large = 'a'.repeat(525000);
      const result = runHook(hook, editPayload('/tmp/large.ts', 'old', large));
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('512KB limit');
    });

    it('includes byte count in error message', () => {
      const large = 'x'.repeat(600000);
      const result = runHook(hook, writePayload('/tmp/big.ts', large));
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toMatch(/\d+ bytes/);
    });
  });

  // ── Should ALLOW (exit 0) ──────────────────────────────────────────

  describe('allows content within limits', () => {
    it('allows small Write', () => {
      const result = runHook(hook, writePayload('/tmp/small.ts', 'const x = 1;'));
      expect(result.exitCode).toBe(0);
    });

    it('allows content at exactly 512KB', () => {
      const exactly = 'x'.repeat(524288);
      const result = runHook(hook, writePayload('/tmp/exact.ts', exactly));
      expect(result.exitCode).toBe(0);
    });

    it('allows empty content', () => {
      const result = runHook(hook, {
        tool_name: 'Write',
        tool_input: { file_path: '/tmp/empty.ts' },
      });
      expect(result.exitCode).toBe(0);
    });

    it('allows Bash tool (not applicable)', () => {
      const result = runHook(hook, {
        tool_name: 'Bash',
        tool_input: { command: 'echo hello' },
      });
      expect(result.exitCode).toBe(0);
    });

    it('allows normal Edit', () => {
      const result = runHook(hook, editPayload('/tmp/test.ts', 'old text', 'new text'));
      expect(result.exitCode).toBe(0);
    });
  });
});
