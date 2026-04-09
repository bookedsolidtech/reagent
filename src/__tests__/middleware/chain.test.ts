import { describe, it, expect } from 'vitest';
import {
  executeChain,
  type InvocationContext,
  type Middleware,
} from '../../gateway/middleware/chain.js';
import { InvocationStatus } from '../../types/index.js';

function createContext(overrides?: Partial<InvocationContext>): InvocationContext {
  return {
    tool_name: 'test_tool',
    server_name: 'test-server',
    arguments: {},
    session_id: 'test-session',
    status: InvocationStatus.Allowed,
    start_time: Date.now(),
    metadata: {},
    ...overrides,
  };
}

describe('executeChain', () => {
  it('executes middlewares in order', async () => {
    const order: number[] = [];

    const mw1: Middleware = async (_ctx, next) => {
      order.push(1);
      await next();
      order.push(4);
    };
    const mw2: Middleware = async (_ctx, next) => {
      order.push(2);
      await next();
      order.push(3);
    };

    await executeChain([mw1, mw2], createContext());
    expect(order).toEqual([1, 2, 3, 4]);
  });

  it('allows short-circuiting by not calling next', async () => {
    const order: number[] = [];

    const blocker: Middleware = async (ctx) => {
      order.push(1);
      ctx.status = InvocationStatus.Denied;
      // Do not call next
    };
    const unreached: Middleware = async (_ctx, next) => {
      order.push(2);
      await next();
    };

    const ctx = createContext();
    await executeChain([blocker, unreached], ctx);

    expect(order).toEqual([1]);
    expect(ctx.status).toBe(InvocationStatus.Denied);
  });

  it('propagates errors', async () => {
    const failing: Middleware = async () => {
      throw new Error('middleware failure');
    };

    await expect(executeChain([failing], createContext())).rejects.toThrow('middleware failure');
  });

  it('handles empty chain', async () => {
    const ctx = createContext();
    await executeChain([], ctx);
    expect(ctx.status).toBe(InvocationStatus.Allowed);
  });
});
