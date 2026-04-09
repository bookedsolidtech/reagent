import { describe, it, expect } from 'vitest';
import { createBlockedPathsMiddleware } from '../../gateway/middleware/blocked-paths.js';
import { InvocationStatus } from '../../types/index.js';
import type { Policy } from '../../types/index.js';
import type { InvocationContext } from '../../gateway/middleware/chain.js';

function createPolicy(blockedPaths: string[] = []): Policy {
  return {
    version: '1',
    profile: 'test',
    installed_by: 'test',
    installed_at: '2026-01-01T00:00:00Z',
    autonomy_level: 'L3' as Policy['autonomy_level'],
    max_autonomy_level: 'L3' as Policy['max_autonomy_level'],
    promotion_requires_human_approval: false,
    blocked_paths: blockedPaths,
    notification_channel: '',
    block_ai_attribution: false,
  };
}

function createContext(args: Record<string, unknown>): InvocationContext {
  return {
    tool_name: 'test_tool',
    server_name: 'test-server',
    arguments: args,
    session_id: 'test-session',
    status: InvocationStatus.Allowed,
    start_time: Date.now(),
    metadata: {},
  };
}

describe('blocked-paths middleware', () => {
  it('always blocks .reagent/ even with empty blocked_paths', async () => {
    const mw = createBlockedPathsMiddleware(createPolicy([]));
    const ctx = createContext({ path: '.reagent/policy.yaml' });
    await mw(ctx, async () => {});
    expect(ctx.status).toBe(InvocationStatus.Denied);
    expect(ctx.error).toContain('.reagent/');
  });

  it('blocks paths from policy.blocked_paths', async () => {
    const mw = createBlockedPathsMiddleware(createPolicy(['.env']));
    const ctx = createContext({ file: '.env.local' });
    await mw(ctx, async () => {});
    expect(ctx.status).toBe(InvocationStatus.Denied);
    expect(ctx.error).toContain('.env');
  });

  it('allows non-blocked paths', async () => {
    const mw = createBlockedPathsMiddleware(createPolicy([]));
    const ctx = createContext({ file: 'src/index.ts' });
    let nextCalled = false;
    await mw(ctx, async () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    expect(ctx.status).toBe(InvocationStatus.Allowed);
  });

  // ── Encoding bypass prevention ─────────────────────────────────────

  describe('encoding bypass prevention', () => {
    it('blocks URL-encoded path separators (%2F)', async () => {
      const mw = createBlockedPathsMiddleware(createPolicy([]));
      const ctx = createContext({ path: '.reagent%2Fpolicy.yaml' });
      await mw(ctx, async () => {});
      expect(ctx.status).toBe(InvocationStatus.Denied);
    });

    it('blocks lowercase URL-encoded path separators (%2f)', async () => {
      const mw = createBlockedPathsMiddleware(createPolicy([]));
      const ctx = createContext({ path: '.reagent%2fpolicy.yaml' });
      await mw(ctx, async () => {});
      expect(ctx.status).toBe(InvocationStatus.Denied);
    });

    it('blocks URL-encoded dot characters (%2E)', async () => {
      const mw = createBlockedPathsMiddleware(createPolicy([]));
      const ctx = createContext({ path: '%2Ereagent/policy.yaml' });
      await mw(ctx, async () => {});
      expect(ctx.status).toBe(InvocationStatus.Denied);
    });

    it('blocks case-insensitive path variants (.Reagent/)', async () => {
      const mw = createBlockedPathsMiddleware(createPolicy([]));
      const ctx = createContext({ path: '.Reagent/policy.yaml' });
      await mw(ctx, async () => {});
      expect(ctx.status).toBe(InvocationStatus.Denied);
    });

    it('blocks uppercase path variants (.REAGENT/)', async () => {
      const mw = createBlockedPathsMiddleware(createPolicy([]));
      const ctx = createContext({ path: '.REAGENT/policy.yaml' });
      await mw(ctx, async () => {});
      expect(ctx.status).toBe(InvocationStatus.Denied);
    });

    it('blocks path traversal with ../ prefix', async () => {
      const mw = createBlockedPathsMiddleware(createPolicy([]));
      const ctx = createContext({ path: 'foo/../../.reagent/policy.yaml' });
      await mw(ctx, async () => {});
      expect(ctx.status).toBe(InvocationStatus.Denied);
    });

    it('blocks backslash path variants', async () => {
      const mw = createBlockedPathsMiddleware(createPolicy([]));
      const ctx = createContext({ path: '.reagent\\policy.yaml' });
      await mw(ctx, async () => {});
      expect(ctx.status).toBe(InvocationStatus.Denied);
    });
  });

  // ── Nested argument scanning ───────────────────────────────────────

  describe('nested argument scanning', () => {
    it('blocks paths in nested objects', async () => {
      const mw = createBlockedPathsMiddleware(createPolicy([]));
      const ctx = createContext({
        config: { target: { path: '.reagent/policy.yaml' } },
      });
      await mw(ctx, async () => {});
      expect(ctx.status).toBe(InvocationStatus.Denied);
    });

    it('blocks paths in arrays', async () => {
      const mw = createBlockedPathsMiddleware(createPolicy([]));
      const ctx = createContext({
        paths: ['src/index.ts', '.reagent/HALT', 'README.md'],
      });
      await mw(ctx, async () => {});
      expect(ctx.status).toBe(InvocationStatus.Denied);
    });

    it('blocks paths in deeply nested arrays of objects', async () => {
      const mw = createBlockedPathsMiddleware(createPolicy([]));
      const ctx = createContext({
        operations: [{ files: [{ name: '.reagent/gateway.yaml' }] }],
      });
      await mw(ctx, async () => {});
      expect(ctx.status).toBe(InvocationStatus.Denied);
    });

    it('allows nested non-blocked paths', async () => {
      const mw = createBlockedPathsMiddleware(createPolicy([]));
      const ctx = createContext({
        config: { files: ['src/index.ts', 'package.json'] },
      });
      let nextCalled = false;
      await mw(ctx, async () => {
        nextCalled = true;
      });
      expect(nextCalled).toBe(true);
    });
  });
});
