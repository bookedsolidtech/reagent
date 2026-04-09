import { describe, it, expect } from 'vitest';
import { createPolicyMiddleware } from '../../gateway/middleware/policy.js';
import { executeChain } from '../../gateway/middleware/chain.js';
import { AutonomyLevel, Tier, InvocationStatus } from '../../types/index.js';
import type { Policy } from '../../types/index.js';
import type { InvocationContext, Middleware } from '../../gateway/middleware/chain.js';
import { classifyTool } from '../../config/tier-map.js';

function createPolicy(level: AutonomyLevel): Policy {
  return {
    version: '1',
    profile: 'test',
    installed_by: 'test',
    installed_at: '2026-01-01T00:00:00Z',
    autonomy_level: level,
    max_autonomy_level: AutonomyLevel.L3,
    promotion_requires_human_approval: true,
    blocked_paths: [],
    notification_channel: '',
    block_ai_attribution: false,
  };
}

function createCtx(overrides: Partial<InvocationContext> = {}): InvocationContext {
  return {
    tool_name: 'send_message',
    server_name: 'test-server',
    arguments: {},
    session_id: 'test-session',
    status: InvocationStatus.Allowed,
    start_time: Date.now(),
    metadata: {},
    ...overrides,
  };
}

describe('adversarial: policy bypass attempts', () => {
  // ── Tool name manipulation ──────────────────────────────────────────

  it('SECURE: re-derives tier from tool_name, ignoring ctx.tier set by attacker', async () => {
    // Attack: set ctx.tier to Read, but tool_name is a destructive tool
    const mw = createPolicyMiddleware(createPolicy(AutonomyLevel.L0));
    const ctx = createCtx({
      tool_name: 'delete_channel', // destructive tool
      tier: Tier.Read, // attacker tries to fake tier
    });

    await mw(ctx, async () => {});

    // SECURE: policy re-derives tier from tool_name — ignores ctx.tier
    expect(ctx.status).toBe(InvocationStatus.Denied);
    expect(ctx.tier).toBe(Tier.Destructive); // overwritten with authoritative tier
  });

  it('SECURE: denies even if attacker swaps tool_name to a read-sounding name with wrong ctx.tier', async () => {
    // Attack: use a read tool name but claim destructive tier
    const mw = createPolicyMiddleware(createPolicy(AutonomyLevel.L0));
    const ctx = createCtx({
      tool_name: 'get_messages', // read-sounding name
      tier: Tier.Destructive, // but attacker sets destructive
    });

    let nextCalled = false;
    await mw(ctx, async () => {
      nextCalled = true;
    });

    // SECURE: policy re-derives from tool_name (get_messages = Read), allows at L0
    expect(nextCalled).toBe(true);
    expect(ctx.tier).toBe(Tier.Read); // overwritten with authoritative tier
  });

  // ── Undefined/null tier ─────────────────────────────────────────────

  it('SECURE: denies when tier was undefined — re-derives from tool_name', async () => {
    const mw = createPolicyMiddleware(createPolicy(AutonomyLevel.L0));
    // tool_name 'send_message' = Write tier, should be denied at L0
    const ctx = createCtx({ tier: undefined, tool_name: 'send_message' });

    let nextCalled = false;
    await mw(ctx, async () => {
      nextCalled = true;
    });

    // SECURE: policy re-derives tier, doesn't skip check
    expect(nextCalled).toBe(false);
    expect(ctx.status).toBe(InvocationStatus.Denied);
  });

  it('should deny when tier is coerced to a non-enum value', async () => {
    const mw = createPolicyMiddleware(createPolicy(AutonomyLevel.L0));
    // Unknown tool_name defaults to Write, denied at L0
    const ctx = createCtx({ tier: 'super_admin' as unknown as Tier, tool_name: 'unknown_tool' });

    let nextCalled = false;
    await mw(ctx, async () => {
      nextCalled = true;
    });

    // SECURE: unknown tier values from tool_name default to Write, denied at L0
    expect(nextCalled).toBe(false);
    expect(ctx.status).toBe(InvocationStatus.Denied);
  });

  // ── Unexpected autonomy_level ───────────────────────────────────────

  it('SECURE: gracefully denies on invalid autonomy_level in policy', async () => {
    const badPolicy = createPolicy('L99' as unknown as AutonomyLevel);
    const mw = createPolicyMiddleware(badPolicy);
    const ctx = createCtx({ tool_name: 'get_messages' });

    await mw(ctx, async () => {});

    // SECURE: unknown autonomy level results in graceful denial, not crash
    expect(ctx.status).toBe(InvocationStatus.Denied);
    expect(ctx.error).toContain('Unknown autonomy level');
  });

  // ── Middleware ordering ─────────────────────────────────────────────

  it('should still enforce policy even if placed after a permissive middleware', async () => {
    const permissiveMw: Middleware = async (ctx, next) => {
      ctx.status = InvocationStatus.Allowed;
      await next();
    };

    const policyMw = createPolicyMiddleware(createPolicy(AutonomyLevel.L0));
    // delete_channel = Destructive, denied at L0
    const ctx = createCtx({ tool_name: 'delete_channel' });

    let terminalCalled = false;
    const terminal: Middleware = async () => {
      terminalCalled = true;
    };

    await executeChain([permissiveMw, policyMw, terminal], ctx);

    // SECURE: policy middleware checks tier regardless of current ctx.status
    expect(ctx.status).toBe(InvocationStatus.Denied);
    expect(terminalCalled).toBe(false);
  });

  it('rearranging middleware so policy runs AFTER terminal allows bypass', async () => {
    const policyMw = createPolicyMiddleware(createPolicy(AutonomyLevel.L0));
    const ctx = createCtx({ tool_name: 'delete_channel' });

    let terminalCalled = false;
    const terminal: Middleware = async (ctx, next) => {
      terminalCalled = true;
      ctx.result = 'executed!';
      await next();
    };

    // Chain: terminal runs first, THEN policy checks
    await executeChain([terminal, policyMw], ctx);

    // NOTE: Middleware ordering is a deployment concern — if you put the tool
    // execution BEFORE policy, the tool runs first. This is expected behavior.
    expect(terminalCalled).toBe(true);
    expect(ctx.status).toBe(InvocationStatus.Denied);
  });

  // ── Double next() call ──────────────────────────────────────────────

  it('should reject if next() is called multiple times', async () => {
    const doubleCallMw: Middleware = async (ctx, next) => {
      await next();
      await next(); // second call
    };

    const ctx = createCtx();
    let _callCount = 0;
    const counter: Middleware = async (_ctx, next) => {
      _callCount++;
      await next();
    };

    // SECURE: executeChain guards against double next() with index tracking
    await expect(executeChain([doubleCallMw, counter], ctx)).rejects.toThrow(
      'next() called multiple times'
    );
  });

  // ── classifyTool: server prefix stripping ───────────────────────────

  it('classifyTool strips server prefix to find base tier', () => {
    const tier = classifyTool('discord-ops__delete_channel', 'discord-ops');
    expect(tier).toBe(Tier.Destructive);
  });

  it('classifyTool defaults unknown tools to Write, not Read', () => {
    const tier = classifyTool('totally_unknown_tool', 'unknown-server');
    expect(tier).toBe(Tier.Write);
  });

  it('SECURE: gateway config override cannot downgrade a destructive tool to read tier', () => {
    // SECURITY: tier downgrade floor prevents tool_overrides from lowering
    // a tool below its static classification. This closes the tier bypass vector.
    const config = {
      version: '1',
      servers: {
        'evil-server': {
          command: 'node',
          args: [],
          tool_overrides: {
            delete_channel: { tier: Tier.Read },
          },
        },
      },
    };
    const tier = classifyTool('delete_channel', 'evil-server', config);
    expect(tier).toBe(Tier.Destructive); // Override blocked — static tier preserved
  });

  it('gateway config override can upgrade a tool tier', () => {
    // Upgrading (making more restrictive) is always allowed.
    const config = {
      version: '1',
      servers: {
        'safe-server': {
          command: 'node',
          args: [],
          tool_overrides: {
            send_message: { tier: Tier.Destructive },
          },
        },
      },
    };
    const tier = classifyTool('send_message', 'safe-server', config);
    expect(tier).toBe(Tier.Destructive); // Override allowed — more restrictive
  });
});
