import { InvocationStatus } from '../../types/index.js';
import type { RateLimiter } from '../rate-limiter.js';
import type { Middleware } from './chain.js';

/**
 * PreToolUse + PostToolUse middleware: enforces per-server concurrency and rate limits.
 *
 * On entry: tries to acquire a slot. If over limit, denies the call immediately
 * without ever reaching the downstream server.
 *
 * On exit (finally): releases the concurrency slot so the next queued call can proceed.
 * The slot is released even if the downstream call errors — we track capacity, not success.
 */
export function createRateLimitMiddleware(limiter: RateLimiter): Middleware {
  return async (ctx, next) => {
    const err = limiter.tryAcquire(ctx.server_name);

    if (err !== null) {
      ctx.status = InvocationStatus.Denied;
      ctx.error = err.message;
      ctx.metadata.rate_limit_exceeded = {
        type: err.type,
        current: err.current,
        limit: err.limit,
      };
      return; // Do not call next() — gate is closed
    }

    try {
      await next();
    } finally {
      limiter.release(ctx.server_name);
    }
  };
}
