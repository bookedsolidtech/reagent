import { describe, it, expect } from 'vitest';
import { createPolicyMiddleware } from '../../gateway/middleware/policy.js';
import { AutonomyLevel, InvocationStatus } from '../../types/index.js';
import type { Policy } from '../../types/index.js';
import type { InvocationContext } from '../../gateway/middleware/chain.js';

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

// Policy now re-derives tier from tool_name, so we must use real tool names
function createContext(toolName: string): InvocationContext {
  return {
    tool_name: toolName,
    server_name: 'test-server',
    arguments: {},
    session_id: 'test-session',
    status: InvocationStatus.Allowed,
    start_time: Date.now(),
    metadata: {},
  };
}

describe('policy middleware', () => {
  it('L0 blocks write-tier tools', async () => {
    const mw = createPolicyMiddleware(createPolicy(AutonomyLevel.L0));
    const ctx = createContext('send_message'); // Write-tier

    await mw(ctx, async () => {});

    expect(ctx.status).toBe(InvocationStatus.Denied);
    expect(ctx.error).toContain('L0');
  });

  it('L0 allows read-tier tools', async () => {
    const mw = createPolicyMiddleware(createPolicy(AutonomyLevel.L0));
    const ctx = createContext('get_messages'); // Read-tier
    let nextCalled = false;

    await mw(ctx, async () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(ctx.status).toBe(InvocationStatus.Allowed);
  });

  it('L1 blocks destructive-tier tools', async () => {
    const mw = createPolicyMiddleware(createPolicy(AutonomyLevel.L1));
    const ctx = createContext('delete_channel'); // Destructive-tier

    await mw(ctx, async () => {});

    expect(ctx.status).toBe(InvocationStatus.Denied);
  });

  it('L1 allows write-tier tools', async () => {
    const mw = createPolicyMiddleware(createPolicy(AutonomyLevel.L1));
    const ctx = createContext('send_message'); // Write-tier
    let nextCalled = false;

    await mw(ctx, async () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
  });

  it('L3 allows destructive-tier tools', async () => {
    const mw = createPolicyMiddleware(createPolicy(AutonomyLevel.L3));
    const ctx = createContext('delete_channel'); // Destructive-tier
    let nextCalled = false;

    await mw(ctx, async () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
  });
});
