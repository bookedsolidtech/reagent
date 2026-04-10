import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RateLimiter } from '../../gateway/rate-limiter.js';
import { createRateLimitMiddleware } from '../../gateway/middleware/rate-limit.js';
import { InvocationStatus } from '../../types/index.js';
import type { InvocationContext } from '../../gateway/middleware/chain.js';
import type { GatewayConfig } from '../../types/index.js';

vi.spyOn(console, 'error').mockImplementation(() => {});

function makeConfig(
  serverName: string,
  opts: { maxConcurrent?: number; callsPerMinute?: number }
): GatewayConfig {
  return {
    version: '1',
    servers: {
      [serverName]: {
        command: 'node',
        args: [],
        max_concurrent_calls: opts.maxConcurrent,
        calls_per_minute: opts.callsPerMinute,
      },
    },
  };
}

function makeCtx(serverName = 'test_server'): InvocationContext {
  return {
    tool_name: 'test_tool',
    server_name: serverName,
    arguments: {},
    session_id: 'test-session',
    status: InvocationStatus.Allowed,
    start_time: Date.now(),
    metadata: {},
  };
}

describe('RateLimiter', () => {
  describe('concurrency limit', () => {
    it('allows calls within the concurrency limit', () => {
      const limiter = new RateLimiter(makeConfig('srv', { maxConcurrent: 2 }));
      expect(limiter.tryAcquire('srv')).toBeNull();
      expect(limiter.tryAcquire('srv')).toBeNull();
    });

    it('tracks active call count', () => {
      const limiter = new RateLimiter(makeConfig('srv', { maxConcurrent: 5 }));
      limiter.tryAcquire('srv');
      limiter.tryAcquire('srv');
      expect(limiter.getState('srv')!.activeCalls).toBe(2);
    });

    it('rejects when at the concurrency limit', () => {
      const limiter = new RateLimiter(makeConfig('srv', { maxConcurrent: 1 }));
      expect(limiter.tryAcquire('srv')).toBeNull(); // first: ok
      const err = limiter.tryAcquire('srv'); // second: over limit
      expect(err).not.toBeNull();
      expect(err!.type).toBe('concurrency');
      expect(err!.serverName).toBe('srv');
      expect(err!.current).toBe(1);
      expect(err!.limit).toBe(1);
    });

    it('releases the slot on release()', () => {
      const limiter = new RateLimiter(makeConfig('srv', { maxConcurrent: 1 }));
      limiter.tryAcquire('srv');
      limiter.release('srv');
      expect(limiter.tryAcquire('srv')).toBeNull(); // slot freed
    });

    it('zero means unlimited concurrency', () => {
      const limiter = new RateLimiter(makeConfig('srv', { maxConcurrent: 0 }));
      for (let i = 0; i < 100; i++) {
        expect(limiter.tryAcquire('srv')).toBeNull();
      }
    });
  });

  describe('rate limit', () => {
    it('allows calls within the rate limit', () => {
      const limiter = new RateLimiter(makeConfig('srv', { callsPerMinute: 10 }));
      for (let i = 0; i < 10; i++) {
        expect(limiter.tryAcquire('srv')).toBeNull();
      }
    });

    it('rejects when rate limit is exceeded', () => {
      const limiter = new RateLimiter(makeConfig('srv', { callsPerMinute: 3 }));
      limiter.tryAcquire('srv');
      limiter.tryAcquire('srv');
      limiter.tryAcquire('srv');
      const err = limiter.tryAcquire('srv'); // 4th call in the window
      expect(err).not.toBeNull();
      expect(err!.type).toBe('rate');
      expect(err!.serverName).toBe('srv');
    });

    it('rate limit resets after the 60s window', () => {
      vi.useFakeTimers();
      try {
        const limiter = new RateLimiter(makeConfig('srv', { callsPerMinute: 2 }));
        limiter.tryAcquire('srv');
        limiter.tryAcquire('srv');
        expect(limiter.tryAcquire('srv')).not.toBeNull(); // at limit

        // Advance past the 60s window
        vi.advanceTimersByTime(61_000);
        expect(limiter.tryAcquire('srv')).toBeNull(); // window reset
      } finally {
        vi.useRealTimers();
      }
    });

    it('zero means unlimited rate', () => {
      const limiter = new RateLimiter(makeConfig('srv', { callsPerMinute: 0 }));
      for (let i = 0; i < 200; i++) {
        expect(limiter.tryAcquire('srv')).toBeNull();
      }
    });
  });

  describe('unknown server', () => {
    it('allows through a server not in config (no limits configured)', () => {
      const limiter = new RateLimiter(makeConfig('known', {}));
      expect(limiter.tryAcquire('unknown_server')).toBeNull();
    });
  });
});

describe('createRateLimitMiddleware', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter(makeConfig('srv', { maxConcurrent: 1, callsPerMinute: 5 }));
  });

  it('calls next() when under limits', async () => {
    const mw = createRateLimitMiddleware(limiter);
    const ctx = makeCtx('srv');
    let called = false;

    await mw(ctx, async () => {
      called = true;
    });

    expect(called).toBe(true);
    expect(ctx.status).toBe(InvocationStatus.Allowed);
  });

  it('denies and does not call next() when concurrency limit is exceeded', async () => {
    const mw = createRateLimitMiddleware(limiter);
    // Acquire the one available slot
    limiter.tryAcquire('srv');

    const ctx = makeCtx('srv');
    let called = false;
    await mw(ctx, async () => {
      called = true;
    });

    expect(called).toBe(false);
    expect(ctx.status).toBe(InvocationStatus.Denied);
    expect(ctx.error).toContain('srv');
  });

  it('returns a structured error in metadata with server name and counts', async () => {
    const mw = createRateLimitMiddleware(limiter);
    limiter.tryAcquire('srv'); // fill the slot

    const ctx = makeCtx('srv');
    await mw(ctx, async () => {});

    expect(ctx.metadata.rate_limit_exceeded).toBeDefined();
    const meta = ctx.metadata.rate_limit_exceeded as { type: string; current: number; limit: number };
    expect(meta.type).toBe('concurrency');
    expect(meta.current).toBe(1);
    expect(meta.limit).toBe(1);
  });

  it('releases the slot after next() resolves', async () => {
    const mw = createRateLimitMiddleware(limiter);
    const ctx = makeCtx('srv');

    await mw(ctx, async () => {});

    // Slot should be released — active count back to 0
    expect(limiter.getState('srv')!.activeCalls).toBe(0);
  });

  it('releases the slot even if next() throws', async () => {
    const mw = createRateLimitMiddleware(limiter);
    const ctx = makeCtx('srv');

    await expect(
      mw(ctx, async () => {
        throw new Error('downstream exploded');
      })
    ).rejects.toThrow('downstream exploded');

    expect(limiter.getState('srv')!.activeCalls).toBe(0);
  });
});
