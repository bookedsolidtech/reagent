import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CircuitBreaker } from '../../gateway/circuit-breaker.js';
import { createCircuitBreakerMiddleware } from '../../gateway/middleware/circuit-breaker.js';
import { InvocationStatus } from '../../types/index.js';
import type { InvocationContext } from '../../gateway/middleware/chain.js';

vi.spyOn(console, 'error').mockImplementation(() => {});

function makeCtx(serverName = 'srv'): InvocationContext {
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

describe('CircuitBreaker', () => {
  describe('initial state', () => {
    it('starts closed — isAllowed returns null', () => {
      const cb = new CircuitBreaker();
      expect(cb.isAllowed('srv')).toBeNull();
    });
  });

  describe('closed → open transition', () => {
    it('tracks consecutive failures', () => {
      const cb = new CircuitBreaker({ failureThreshold: 3 });
      cb.recordFailure('srv');
      cb.recordFailure('srv');
      expect(cb.getCircuit('srv')!.consecutiveFailures).toBe(2);
      expect(cb.getCircuit('srv')!.state).toBe('closed');
    });

    it('opens after reaching the failure threshold', () => {
      const cb = new CircuitBreaker({ failureThreshold: 3 });
      cb.recordFailure('srv');
      cb.recordFailure('srv');
      cb.recordFailure('srv'); // threshold hit
      expect(cb.getCircuit('srv')!.state).toBe('open');
    });

    it('returns an error when circuit is open', () => {
      const cb = new CircuitBreaker({ failureThreshold: 1 });
      cb.recordFailure('srv');
      const status = cb.isAllowed('srv');
      expect(status).not.toBeNull();
      expect(status!.state).toBe('open');
      expect(status!.serverName).toBe('srv');
    });

    it('includes retryAt in the open status', () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 30_000 });
      cb.recordFailure('srv');
      const status = cb.isAllowed('srv');
      expect(status!.retryAt).toBeDefined();
      // retryAt should be ~30s in the future
      const retryMs = new Date(status!.retryAt!).getTime();
      expect(retryMs).toBeGreaterThan(Date.now());
    });

    it('resets failure counter on success in closed state', () => {
      const cb = new CircuitBreaker({ failureThreshold: 5 });
      cb.recordFailure('srv');
      cb.recordFailure('srv');
      cb.recordSuccess('srv');
      expect(cb.getCircuit('srv')!.consecutiveFailures).toBe(0);
    });
  });

  describe('open → half-open transition', () => {
    it('transitions to half-open after cooldown elapses', () => {
      vi.useFakeTimers();
      try {
        const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1_000 });
        cb.recordFailure('srv');
        expect(cb.isAllowed('srv')).not.toBeNull(); // still open

        vi.advanceTimersByTime(1_001);
        expect(cb.isAllowed('srv')).toBeNull(); // half-open — probe allowed
        expect(cb.getCircuit('srv')!.state).toBe('half-open');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('half-open transitions', () => {
    function openThenCooldown(cb: CircuitBreaker): void {
      vi.useFakeTimers();
      cb.recordFailure('srv'); // opens circuit
      vi.advanceTimersByTime(31_000); // cooldown passes
      cb.isAllowed('srv'); // probe — triggers half-open transition
    }

    it('closes on success from half-open', () => {
      vi.useFakeTimers();
      try {
        const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 30_000 });
        openThenCooldown(cb);
        cb.recordSuccess('srv');
        expect(cb.getCircuit('srv')!.state).toBe('closed');
      } finally {
        vi.useRealTimers();
      }
    });

    it('reopens on failure from half-open', () => {
      vi.useFakeTimers();
      try {
        const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 30_000 });
        openThenCooldown(cb);
        cb.recordFailure('srv');
        expect(cb.getCircuit('srv')!.state).toBe('open');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('independent circuits per server', () => {
    it('tracks each server independently', () => {
      const cb = new CircuitBreaker({ failureThreshold: 1 });
      cb.recordFailure('serverA');
      expect(cb.isAllowed('serverA')).not.toBeNull(); // A is open
      expect(cb.isAllowed('serverB')).toBeNull(); // B is still closed
    });
  });
});

describe('createCircuitBreakerMiddleware', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 30_000 });
  });

  it('calls next() when circuit is closed', async () => {
    const mw = createCircuitBreakerMiddleware(breaker);
    const ctx = makeCtx();
    let called = false;

    await mw(ctx, async () => {
      called = true;
    });

    expect(called).toBe(true);
    expect(ctx.status).toBe(InvocationStatus.Allowed);
  });

  it('returns immediate error when circuit is open, without calling next()', async () => {
    // Force circuit open
    breaker.recordFailure('srv');
    breaker.recordFailure('srv');
    breaker.recordFailure('srv');

    const mw = createCircuitBreakerMiddleware(breaker);
    const ctx = makeCtx();
    let called = false;

    await mw(ctx, async () => {
      called = true;
    });

    expect(called).toBe(false);
    expect(ctx.status).toBe(InvocationStatus.Denied);
    expect(ctx.error).toContain('srv');
    expect(ctx.error).toContain('open');
  });

  it('error includes server name, circuit state, and retryAt', async () => {
    breaker.recordFailure('srv');
    breaker.recordFailure('srv');
    breaker.recordFailure('srv');

    const mw = createCircuitBreakerMiddleware(breaker);
    const ctx = makeCtx();
    await mw(ctx, async () => {});

    const meta = ctx.metadata.circuit_breaker as {
      state: string;
      serverName: string;
      retryAt: string;
    };
    expect(meta.state).toBe('open');
    expect(meta.serverName).toBe('srv');
    expect(meta.retryAt).toBeDefined();
  });

  it('records failure when next() results in Error status', async () => {
    const mw = createCircuitBreakerMiddleware(breaker);
    const ctx = makeCtx();

    await mw(ctx, async () => {
      ctx.status = InvocationStatus.Error;
      ctx.error = 'downstream timeout';
    });

    expect(breaker.getCircuit('srv')!.consecutiveFailures).toBe(1);
  });

  it('records success when next() resolves with Allowed status', async () => {
    const mw = createCircuitBreakerMiddleware(breaker);
    const ctx = makeCtx();

    // Accumulate some failures first, then succeed
    breaker.recordFailure('srv');
    await mw(ctx, async () => {
      ctx.status = InvocationStatus.Allowed;
    });

    expect(breaker.getCircuit('srv')!.consecutiveFailures).toBe(0);
  });

  it('records failure when next() throws', async () => {
    const mw = createCircuitBreakerMiddleware(breaker);
    const ctx = makeCtx();

    await expect(
      mw(ctx, async () => {
        throw new Error('network error');
      })
    ).rejects.toThrow('network error');

    expect(breaker.getCircuit('srv')!.consecutiveFailures).toBe(1);
  });

  it('does not count policy Denied as a downstream failure', async () => {
    const mw = createCircuitBreakerMiddleware(breaker);
    const ctx = makeCtx();

    await mw(ctx, async () => {
      ctx.status = InvocationStatus.Denied; // policy or rate-limit denial
    });

    // Denied is not a server failure — circuit should not count it
    expect(breaker.getCircuit('srv')!.consecutiveFailures).toBe(0);
  });
});
