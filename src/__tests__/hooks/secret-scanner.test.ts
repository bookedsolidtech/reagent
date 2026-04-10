import { describe, it, expect } from 'vitest';
import { runHook, writePayload, editPayload } from './test-utils.js';

// Test secrets are constructed at runtime to avoid triggering the secret scanner
// on this test file itself. These are well-known AWS example keys from AWS docs.
function awsKey(): string {
  return 'AKIA' + 'IOSFODNN7EXAMPLE';
}
function ghpToken(): string {
  return 'ghp_' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' + 'abcdefgh' + 'ij';
}
function stripeLiveKey(): string {
  return 'sk_live_' + 'ABCDEFGHIJKLMNOPQRSTUVWXyz';
}
function privateKeyHeader(): string {
  return '-----BEGIN RSA PRIVATE' + ' KEY-----';
}
function longSecret(): string {
  return 'aVeryRealSecretValueThatIsLongEnoughToTrigger';
}

describe('secret-scanner', () => {
  const hook = 'secret-scanner';

  // ── Should BLOCK (exit 2) ──────────────────────────────────────────

  describe('blocks real secrets', () => {
    it('blocks AWS access key', () => {
      const result = runHook(hook, writePayload('/tmp/test.ts', `const key = "${awsKey()}";`));
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('SECRET DETECTED');
    });

    it('blocks private key block', () => {
      const result = runHook(
        hook,
        writePayload(
          '/tmp/test.pem',
          `${privateKeyHeader()}\nMIIEow...\n-----END RSA PRIVATE KEY-----`
        )
      );
      expect(result.exitCode).toBe(2);
    });

    it('blocks GitHub PAT (classic)', () => {
      const result = runHook(hook, writePayload('/tmp/test.ts', `const token = "${ghpToken()}";`));
      expect(result.exitCode).toBe(2);
    });

    it('blocks Stripe live secret key', () => {
      const result = runHook(
        hook,
        writePayload('/tmp/test.ts', `const key = "${stripeLiveKey()}";`)
      );
      expect(result.exitCode).toBe(2);
    });

    it('blocks generic SECRET= assignment with real value', () => {
      const result = runHook(hook, writePayload('/tmp/test.ts', `SECRET="${longSecret()}"`));
      expect(result.exitCode).toBe(2);
    });

    it('blocks in Edit tool payloads too', () => {
      const result = runHook(
        hook,
        editPayload('/tmp/test.ts', 'old', `const key = "${awsKey()}";`)
      );
      expect(result.exitCode).toBe(2);
    });
  });

  // ── Should ALLOW (exit 0) ──────────────────────────────────────────

  describe('allows safe content', () => {
    it('allows normal code', () => {
      const result = runHook(hook, writePayload('/tmp/test.ts', 'const greeting = "hello world";'));
      expect(result.exitCode).toBe(0);
    });

    it('allows placeholder values', () => {
      const result = runHook(hook, writePayload('/tmp/test.ts', 'SECRET="<your_key_here>"'));
      expect(result.exitCode).toBe(0);
    });

    it('allows process.env references', () => {
      const result = runHook(
        hook,
        writePayload('/tmp/test.ts', 'const key = process.env.API_KEY;')
      );
      expect(result.exitCode).toBe(0);
    });

    it('allows .env.example files', () => {
      const result = runHook(hook, writePayload('/tmp/.env.example', 'API_KEY=changeme'));
      expect(result.exitCode).toBe(0);
    });

    it('allows empty content', () => {
      const result = runHook(hook, {
        tool_name: 'Write',
        tool_input: { file_path: '/tmp/test.ts' },
      });
      expect(result.exitCode).toBe(0);
    });
  });
});
