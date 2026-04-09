import type { Tier } from '../../types/index.js';
import { InvocationStatus } from '../../types/index.js';

export interface InvocationContext {
  tool_name: string;
  server_name: string;
  arguments: Record<string, unknown>;
  session_id: string;
  tier?: Tier;
  status: InvocationStatus;
  error?: string;
  result?: unknown;
  start_time: number;
  redacted_fields?: string[];
  metadata: Record<string, unknown>;
}

export type NextFn = () => Promise<void>;
export type Middleware = (ctx: InvocationContext, next: NextFn) => Promise<void>;

/**
 * Execute a middleware chain in onion (koa-style) order.
 * Each middleware calls `next()` to pass control to the next one.
 * The innermost middleware is the actual tool execution.
 *
 * SECURITY: Once status is set to Denied, it is locked for the remainder
 * of the chain. No middleware can revert a denial.
 */
export function executeChain(middlewares: Middleware[], ctx: InvocationContext): Promise<void> {
  let index = -1;
  let deniedOnce = false;
  let savedError: string | undefined;

  function dispatch(i: number): Promise<void> {
    if (i <= index) {
      return Promise.reject(new Error('next() called multiple times'));
    }
    index = i;

    const mw = middlewares[i];
    if (!mw) {
      return Promise.resolve();
    }

    return Promise.resolve(mw(ctx, () => dispatch(i + 1))).then(() => {
      // SECURITY: If any middleware ever set Denied, lock it permanently
      if (ctx.status === InvocationStatus.Denied && !deniedOnce) {
        deniedOnce = true;
        savedError = ctx.error;
      }

      if (deniedOnce && ctx.status !== InvocationStatus.Denied) {
        ctx.status = InvocationStatus.Denied;
        ctx.error = savedError || 'Denial status was tampered with — re-locked';
      }
    });
  }

  return dispatch(0);
}
