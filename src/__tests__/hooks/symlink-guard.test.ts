import { describe, it, expect } from 'vitest';
import { runHook, writePayload } from './test-utils.js';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

describe('symlink-guard', () => {
  const hook = 'symlink-guard';

  // ── Should BLOCK (exit 2) ──────────────────────────────────────────

  describe('blocks paths outside project root', () => {
    it('blocks writes to /etc/passwd', () => {
      const result = runHook(hook, writePayload('/etc/passwd', 'content'));
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('SYMLINK-GUARD');
    });

    it('blocks writes to /tmp outside project', () => {
      const result = runHook(hook, writePayload('/tmp/evil-escape.txt', 'content'));
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('escapes project root');
    });

    it('blocks path traversal via ..', () => {
      const escapePath = path.join(PROJECT_ROOT, '..', '..', 'evil.txt');
      const result = runHook(hook, writePayload(escapePath, 'content'));
      expect(result.exitCode).toBe(2);
    });

    it('blocks writes to /root', () => {
      const result = runHook(hook, writePayload('/root/.bashrc', 'malicious'));
      expect(result.exitCode).toBe(2);
    });
  });

  // ── Should ALLOW (exit 0) ──────────────────────────────────────────

  describe('allows paths within project root', () => {
    it('allows writes within project root', () => {
      const safePath = path.join(PROJECT_ROOT, 'src', 'test-output.ts');
      const result = runHook(hook, writePayload(safePath, 'const x = 1;'));
      expect(result.exitCode).toBe(0);
    });

    it('allows writes to project root itself', () => {
      const result = runHook(hook, writePayload(path.join(PROJECT_ROOT, 'README.md'), '# Test'));
      expect(result.exitCode).toBe(0);
    });

    it('allows Edit tool (not applicable)', () => {
      const result = runHook(hook, {
        tool_name: 'Edit',
        tool_input: { file_path: '/etc/passwd', old_string: 'old', new_string: 'new' },
      });
      expect(result.exitCode).toBe(0);
    });

    it('allows empty file_path', () => {
      const result = runHook(hook, {
        tool_name: 'Write',
        tool_input: { content: 'hello' },
      });
      expect(result.exitCode).toBe(0);
    });

    it('allows Write with nested subdirectory path', () => {
      const nested = path.join(PROJECT_ROOT, 'src', 'cli', 'commands', 'init', 'newfile.ts');
      const result = runHook(hook, writePayload(nested, 'export const x = 1;'));
      expect(result.exitCode).toBe(0);
    });
  });
});
