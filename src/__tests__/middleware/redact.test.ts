import { describe, it, expect } from 'vitest';
import { redactSecrets, redactMiddleware } from '../../gateway/middleware/redact.js';
import { InvocationStatus } from '../../types/index.js';
import type { InvocationContext } from '../../gateway/middleware/chain.js';

describe('redactSecrets', () => {
  it('redacts AWS access keys', () => {
    const input = 'key is AKIAIOSFODNN7EXAMPLE';
    const { output, redacted } = redactSecrets(input);
    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(redacted).toContain('AWS Access Key');
  });

  it('redacts GitHub tokens', () => {
    const input = 'token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij';
    const { output, redacted } = redactSecrets(input);
    expect(output).toContain('[REDACTED]');
    expect(redacted).toContain('GitHub Token');
  });

  it('passes through clean text', () => {
    const input = 'This is a normal message with no secrets';
    const { output, redacted } = redactSecrets(input);
    expect(output).toBe(input);
    expect(redacted).toHaveLength(0);
  });

  it('redacts private keys', () => {
    const input = '-----BEGIN RSA PRIVATE KEY----- data here';
    const { output, redacted } = redactSecrets(input);
    expect(output).toContain('[REDACTED]');
    expect(redacted).toContain('Private Key');
  });
});

describe('redactMiddleware', () => {
  it('redacts secrets from string results', async () => {
    const ctx: InvocationContext = {
      tool_name: 'test',
      server_name: 'test',
      arguments: {},
      session_id: 'test',
      status: InvocationStatus.Allowed,
      start_time: Date.now(),
      metadata: {},
    };

    await redactMiddleware(ctx, async () => {
      ctx.result = 'key: AKIAIOSFODNN7EXAMPLE';
    });

    expect(ctx.result).toContain('[REDACTED]');
    expect(ctx.redacted_fields).toContain('AWS Access Key');
  });
});
