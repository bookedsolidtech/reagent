import { InvocationStatus } from '../../types/index.js';
import type { CircuitBreaker } from '../circuit-breaker.js';
import type { Middleware } from './chain.js';

/**
 * PreToolUse + PostToolUse middleware: wraps downstream calls with a circuit breaker.
 *
 * On entry: if the circuit is open, denies the call immediately and returns the
 * structured error without hitting the downstream server.
 *
 * On exit: records success or failure so the breaker can track state transitions.
 */
export function createCircuitBreakerMiddleware(breaker: CircuitBreaker): Middleware {
  return async (ctx, next) => {
    const status = breaker.isAllowed(ctx.server_name);

    if (status !== null) {
      // Circuit is open — fail fast
      ctx.status = InvocationStatus.Denied;
      ctx.error =
        `Circuit breaker open for server "${status.serverName}": downstream is unavailable. ` +
        `State: ${status.state}. Will retry at ${status.retryAt ?? 'unknown'}.`;
      ctx.metadata.circuit_breaker = {
        state: status.state,
        serverName: status.serverName,
        retryAt: status.retryAt,
      };
      return;
    }

    try {
      await next();

      // A Denied status from the middleware chain (policy, rate-limit, etc.) is not a
      // downstream failure — only Error status means the server itself failed.
      if (ctx.status === InvocationStatus.Error) {
        breaker.recordFailure(ctx.server_name);
      } else {
        breaker.recordSuccess(ctx.server_name);
      }
    } catch (err) {
      // Unhandled exceptions from inner middlewares also count as failures
      breaker.recordFailure(ctx.server_name);
      throw err;
    }
  };
}
