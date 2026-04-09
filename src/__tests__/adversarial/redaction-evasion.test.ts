import { describe, it, expect } from 'vitest';
import { redactSecrets, redactMiddleware } from '../../gateway/middleware/redact.js';
import { InvocationStatus } from '../../types/index.js';
import type { InvocationContext } from '../../gateway/middleware/chain.js';

function createCtx(result: unknown): InvocationContext {
  return {
    tool_name: 'test_tool',
    server_name: 'test-server',
    arguments: {},
    session_id: 'test-session',
    status: InvocationStatus.Allowed,
    start_time: Date.now(),
    metadata: {},
    result,
  };
}

describe('adversarial: redaction evasion', () => {
  // ── Plain-text baseline (should be caught) ──────────────────────────

  it('redacts plain AWS access key', () => {
    const { output, redacted } = redactSecrets('key=AKIAIOSFODNN7EXAMPLE');
    expect(output).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(redacted).toContain('AWS Access Key');
  });

  it('redacts GitHub token', () => {
    const { output, redacted } = redactSecrets('token=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl');
    expect(output).not.toContain('ghp_');
    expect(redacted).toContain('GitHub Token');
  });

  // ── Base64 encoded secrets ──────────────────────────────────────────

  it('SECURE: detects base64-encoded AWS key', () => {
    const encoded = Buffer.from('AKIAIOSFODNN7EXAMPLE').toString('base64');
    const { output, redacted } = redactSecrets(`secret=${encoded}`);

    // SECURE: base64 AWS key pattern (QUtJQ prefix) is now detected
    expect(redacted.length).toBeGreaterThan(0);
    expect(output).not.toContain(encoded);
  });

  // ── URL-encoded secrets (known limitation) ────────────────────────

  it('KNOWN LIMITATION: does NOT detect URL-encoded AWS key', () => {
    const urlEncoded = 'AKIA%49OSFODNN7EXAMPLE';
    const { output, redacted } = redactSecrets(`key=${urlEncoded}`);

    // Known limitation: URL-encoded secrets evade regex. Would need URL-decode
    // preprocessing to catch these. Documented as accepted risk.
    expect(redacted).toHaveLength(0);
    expect(output).toContain(urlEncoded);
  });

  // ── Split secrets across fields ─────────────────────────────────────

  it('KNOWN LIMITATION: does NOT detect secrets split across multiple JSON fields', () => {
    const payload = JSON.stringify({
      part1: 'AKIAIOSF',
      part2: 'ODNN7EXAMPLE',
    });
    const { redacted } = redactSecrets(payload);
    expect(redacted).toHaveLength(0);
  });

  // ── Unicode homoglyph substitution ──────────────────────────────────

  it('KNOWN LIMITATION: does NOT detect homoglyph-substituted key patterns', () => {
    const homoglyph = '\u0410PI_KEY=mysecretkeythatis20charslong';
    const { redacted } = redactSecrets(homoglyph);
    expect(redacted).toHaveLength(0);
  });

  // ── Deeply nested JSON ──────────────────────────────────────────────

  it('SECURE: detects secrets in deeply nested JSON', () => {
    const deep = {
      level1: { level2: { level3: { level4: { level5: { key: 'AKIAIOSFODNN7EXAMPLE' } } } } },
    };
    const { output, redacted } = redactSecrets(JSON.stringify(deep));
    expect(redacted).toContain('AWS Access Key');
    expect(output).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  // ── Numeric-looking secrets ─────────────────────────────────────────

  it('detects numeric API key with api_key prefix', () => {
    const { redacted } = redactSecrets('api_key = "12345678901234567890"');
    expect(redacted.length).toBeGreaterThan(0);
  });

  // ── Very long strings (ReDoS) ───────────────────────────────────────

  it('SECURE: does not hang on very long input (ReDoS resistance)', () => {
    const longString = 'A'.repeat(1_000_000);
    const start = Date.now();
    redactSecrets(longString);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000);
  });

  it('SECURE: does not hang on pathological input for generic API key pattern', () => {
    const pathological = 'api_key=' + 'a'.repeat(100_000) + '!';
    const start = Date.now();
    redactSecrets(pathological);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000);
  });

  // ── Null bytes and control characters ───────────────────────────────

  it('SECURE: detects secret with null bytes injected (sanitized first)', () => {
    const withNull = 'AKIA\x00IOSFODNN7EXAMPLE';
    const { redacted } = redactSecrets(withNull);

    // SECURE: null bytes are stripped before pattern matching
    expect(redacted).toContain('AWS Access Key');
  });

  it('SECURE: detects secret with surrounding control characters', () => {
    const withControl = '\t\nAKIAIOSFODNN7EXAMPLE\r\n';
    const { redacted } = redactSecrets(withControl);
    expect(redacted).toContain('AWS Access Key');
  });

  // ── Private key detection ───────────────────────────────────────────

  it('SECURE: redacts PEM private key header', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAK...';
    const { redacted } = redactSecrets(pem);
    expect(redacted).toContain('Private Key');
  });

  it('SECURE: redacts private key with extra spaces in header', () => {
    const pem = '-----BEGIN  RSA  PRIVATE  KEY-----';
    const { redacted } = redactSecrets(pem);

    // SECURE: \\s+ pattern matches multiple spaces
    expect(redacted).toContain('Private Key');
  });

  // ── Middleware integration: non-string results ──────────────────────

  it('SECURE: redacts secrets in object results via JSON serialization', async () => {
    const ctx = createCtx({ data: { key: 'AKIAIOSFODNN7EXAMPLE' } });
    await redactMiddleware(ctx, async () => {});

    const resultStr = JSON.stringify(ctx.result);
    expect(resultStr).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('handles null result without throwing', async () => {
    const ctx = createCtx(null);
    await expect(redactMiddleware(ctx, async () => {})).resolves.not.toThrow();
  });

  it('handles undefined result without throwing', async () => {
    const ctx = createCtx(undefined);
    await expect(redactMiddleware(ctx, async () => {})).resolves.not.toThrow();
  });

  // ── Bearer token ────────────────────────────────────────────────────

  it('SECURE: redacts Bearer token', () => {
    const { redacted } = redactSecrets(
      'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
    );
    expect(redacted).toContain('Bearer Token');
  });

  it('SECURE: detects bearer token in lowercase', () => {
    const { redacted } = redactSecrets(
      'authorization: bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123'
    );

    // SECURE: case-insensitive flag catches lowercase "bearer"
    expect(redacted).toContain('Bearer Token');
  });

  // ── Discord token ──────────────────────────────────────────────────

  it('SECURE: redacts Discord bot token', () => {
    // Fake token matching Discord pattern: [MN]<24+>.<6>.<27+>
    const token = 'NFAKE0FAKE0FAKE0FAKE0FAKE.FAKExy.FAKE0FAKE0FAKE0FAKE0FAKE0FA';
    const { redacted } = redactSecrets(`token: ${token}`);
    expect(redacted).toContain('Discord Token');
  });

  // ── AWS secret key ────────────────────────────────────────────────

  it('SECURE: redacts aws_secret_access_key in config format', () => {
    const config = 'aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
    const { output, redacted } = redactSecrets(config);
    expect(redacted).toContain('AWS Secret Key');
    expect(output).not.toContain('wJalrXUtnFEMI');
  });

  // ── Combined attack ───────────────────────────────────────────────

  it('SECURE: catches all secrets including base64-encoded ones', () => {
    const payload = [
      'AKIAIOSFODNN7EXAMPLE', // plain
      Buffer.from('AKIAIOSFODNN7EXAMPLE').toString('base64'), // base64
      'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl', // plain
    ].join('\n');

    const { output, redacted } = redactSecrets(payload);

    expect(redacted).toContain('AWS Access Key');
    expect(redacted).toContain('GitHub Token');
    expect(redacted).toContain('Base64 AWS Key');
    expect(output).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });
});
