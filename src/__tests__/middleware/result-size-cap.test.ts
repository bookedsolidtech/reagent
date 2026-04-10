import { describe, it, expect, vi } from 'vitest';
import { createResultSizeCapMiddleware } from '../../gateway/middleware/result-size-cap.js';
import { InvocationStatus } from '../../types/index.js';
import type { InvocationContext } from '../../gateway/middleware/chain.js';
import type { GatewayConfig } from '../../types/index.js';

vi.spyOn(console, 'error').mockImplementation(() => {});

function makeCtx(result?: unknown): InvocationContext {
  return {
    tool_name: 'test_tool',
    server_name: 'test_server',
    arguments: {},
    session_id: 'test-session',
    status: InvocationStatus.Allowed,
    start_time: Date.now(),
    result,
    metadata: {},
  };
}

function makeConfig(maxKb: number): GatewayConfig {
  return {
    version: '1',
    servers: {},
    gateway: { max_result_size_kb: maxKb },
  };
}

/** Generate a string of approximately `kb` kilobytes */
function kbString(kb: number): string {
  return 'x'.repeat(kb * 1024);
}

describe('createResultSizeCapMiddleware', () => {
  it('passes a result within the default 512KB limit', async () => {
    const mw = createResultSizeCapMiddleware();
    const result = kbString(100);
    const ctx = makeCtx(result);

    await mw(ctx, async () => {});

    expect(ctx.result).toBe(result);
    expect(ctx.status).toBe(InvocationStatus.Allowed);
  });

  it('passes a result at exactly the limit', async () => {
    const capKb = 10;
    const mw = createResultSizeCapMiddleware(makeConfig(capKb));
    // 10 * 1024 bytes exactly — the notice would push it over, but we only truncate if OVER
    const result = 'x'.repeat(capKb * 1024);
    const ctx = makeCtx(result);

    await mw(ctx, async () => {});

    // Should pass through unmodified
    expect(ctx.result).toBe(result);
  });

  it('truncates a result over the limit and appends a notice', async () => {
    const capKb = 10;
    const mw = createResultSizeCapMiddleware(makeConfig(capKb));
    const result = kbString(capKb + 5); // 5KB over the limit
    const ctx = makeCtx(result);

    await mw(ctx, async () => {});

    expect(typeof ctx.result).toBe('string');
    const truncated = ctx.result as string;
    expect(truncated).toContain('[TRUNCATED:');
    expect(truncated).toContain(`${capKb}KB limit`);
    // Final result must fit within the cap
    expect(Buffer.byteLength(truncated, 'utf8')).toBeLessThanOrEqual(capKb * 1024);
  });

  it('notice includes how many KB were removed', async () => {
    const capKb = 10;
    const mw = createResultSizeCapMiddleware(makeConfig(capKb));
    const result = kbString(capKb + 20); // 20KB over
    const ctx = makeCtx(result);

    await mw(ctx, async () => {});

    expect(ctx.result as string).toMatch(/\d+KB removed/);
  });

  it('respects a configurable limit smaller than the default', async () => {
    const capKb = 2;
    const mw = createResultSizeCapMiddleware(makeConfig(capKb));
    const result = kbString(5); // well over 2KB
    const ctx = makeCtx(result);

    await mw(ctx, async () => {});

    expect(ctx.result as string).toContain('[TRUNCATED:');
    expect(Buffer.byteLength(ctx.result as string, 'utf8')).toBeLessThanOrEqual(capKb * 1024);
  });

  it('truncates the serialized form of structured (object) results', async () => {
    const capKb = 1;
    const mw = createResultSizeCapMiddleware(makeConfig(capKb));
    // An object whose JSON representation exceeds 1KB
    const result = { data: 'x'.repeat(2000) };
    const ctx = makeCtx(result);

    await mw(ctx, async () => {});

    expect(ctx.result as string).toContain('[TRUNCATED:');
  });

  it('does not modify a null/undefined result', async () => {
    const mw = createResultSizeCapMiddleware(makeConfig(1));
    const ctx = makeCtx(undefined);

    await mw(ctx, async () => {});

    expect(ctx.result).toBeUndefined();
    expect(ctx.status).toBe(InvocationStatus.Allowed);
  });

  it('runs PostToolUse — operates on the result set by next()', async () => {
    const capKb = 1;
    const mw = createResultSizeCapMiddleware(makeConfig(capKb));
    const ctx = makeCtx(undefined);

    await mw(ctx, async () => {
      ctx.result = kbString(5); // set by the "tool" inside next()
    });

    expect(ctx.result as string).toContain('[TRUNCATED:');
  });
});
