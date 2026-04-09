import { describe, it, expect } from 'vitest';
import { createTierMiddleware } from '../../gateway/middleware/tier.js';
import { Tier, InvocationStatus } from '../../types/index.js';
import type { InvocationContext } from '../../gateway/middleware/chain.js';

function createContext(): InvocationContext {
  return {
    tool_name: 'get_messages',
    server_name: 'discord-ops',
    arguments: {},
    session_id: 'test-session',
    status: InvocationStatus.Allowed,
    start_time: Date.now(),
    metadata: {},
  };
}

describe('tier middleware', () => {
  it('classifies tool and attaches tier to context', async () => {
    const mw = createTierMiddleware();
    const ctx = createContext();

    await mw(ctx, async () => {});

    expect(ctx.tier).toBe(Tier.Read);
  });

  it('classifies unknown tools as Write', async () => {
    const mw = createTierMiddleware();
    const ctx = createContext();
    ctx.tool_name = 'unknown_tool';

    await mw(ctx, async () => {});

    expect(ctx.tier).toBe(Tier.Write);
  });
});
