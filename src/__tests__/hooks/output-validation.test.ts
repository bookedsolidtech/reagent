import { describe, it, expect } from 'vitest';
import { runHook } from './test-utils.js';

// Token fragments assembled at runtime to avoid triggering the secret scanner
// on this test file itself.
function awsKey(): string {
  return 'AKIA' + 'IOSFODNN7EXAMPLE';
}
function ghpToken(): string {
  return 'ghp_' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' + 'abcdefghij';
}
function skKey(): string {
  return 'sk-' + 'proj-abcdefghijklmnopqrstuvwxyz12345678';
}
function bearerToken(): string {
  return 'Bearer ' + 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature';
}
function privateKeyHeader(): string {
  return '-----BEGIN RSA PRIVATE' + ' KEY-----';
}

function bashOutputPayload(output: string) {
  return {
    tool_name: 'Bash',
    tool_response: [{ type: 'text', text: output }],
  };
}

describe('output-validation', () => {
  const hook = 'output-validation';

  // ── Should BLOCK (exit 2) ──────────────────────────────────────────

  describe('blocks credential patterns in output', () => {
    it('blocks AWS access key in stdout', () => {
      const result = runHook(hook, bashOutputPayload(`Access key: ${awsKey()}`));
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('OUTPUT-VALIDATION');
      expect(result.stderr).toContain('AWS Access Key');
    });

    it('blocks GitHub PAT in stdout', () => {
      const result = runHook(hook, bashOutputPayload(`Token: ${ghpToken()}`));
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('OUTPUT-VALIDATION');
    });

    it('blocks sk- API key in stdout', () => {
      const result = runHook(hook, bashOutputPayload(`key=${skKey()}`));
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('OUTPUT-VALIDATION');
    });

    it('blocks Bearer token in stdout', () => {
      const result = runHook(hook, bashOutputPayload(`Authorization: ${bearerToken()}`));
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('OUTPUT-VALIDATION');
    });

    it('blocks private key header in stdout', () => {
      const result = runHook(hook, bashOutputPayload(`${privateKeyHeader()}\nMIIEow...`));
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('OUTPUT-VALIDATION');
    });
  });

  // ── Should ALLOW (exit 0) ──────────────────────────────────────────

  describe('allows clean output', () => {
    it('allows normal command output', () => {
      const result = runHook(hook, bashOutputPayload('Hello world\n3 files changed'));
      expect(result.exitCode).toBe(0);
    });

    it('allows git log output', () => {
      const result = runHook(
        hook,
        bashOutputPayload(
          'commit abc123def456\nAuthor: Dev <dev@example.com>\nDate: Mon Apr 9 2026'
        )
      );
      expect(result.exitCode).toBe(0);
    });

    it('allows empty output', () => {
      const result = runHook(hook, {
        tool_name: 'Bash',
        tool_response: [{ type: 'text', text: '' }],
      });
      expect(result.exitCode).toBe(0);
    });

    it('allows output with no tool_response', () => {
      const result = runHook(hook, { tool_name: 'Bash' });
      expect(result.exitCode).toBe(0);
    });

    it('allows string tool_response', () => {
      const result = runHook(hook, { tool_name: 'Bash', tool_response: 'npm install complete' });
      expect(result.exitCode).toBe(0);
    });
  });
});
