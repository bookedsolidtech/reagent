import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createKillSwitchMiddleware } from '../../gateway/middleware/kill-switch.js';
import { InvocationStatus } from '../../types/index.js';
import type { InvocationContext } from '../../gateway/middleware/chain.js';

function createContext(): InvocationContext {
  return {
    tool_name: 'test_tool',
    server_name: 'test-server',
    arguments: {},
    session_id: 'test-session',
    status: InvocationStatus.Allowed,
    start_time: Date.now(),
    metadata: {},
  };
}

describe('kill-switch middleware', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reagent-test-'));
    fs.mkdirSync(path.join(tmpDir, '.reagent'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('allows through when no HALT file', async () => {
    const mw = createKillSwitchMiddleware(tmpDir);
    const ctx = createContext();
    let nextCalled = false;

    await mw(ctx, async () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(ctx.status).toBe(InvocationStatus.Allowed);
  });

  it('denies when HALT file exists', async () => {
    fs.writeFileSync(path.join(tmpDir, '.reagent', 'HALT'), 'Security incident');

    const mw = createKillSwitchMiddleware(tmpDir);
    const ctx = createContext();
    let nextCalled = false;

    await mw(ctx, async () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(ctx.status).toBe(InvocationStatus.Denied);
    expect(ctx.error).toContain('Kill switch active');
    expect(ctx.error).toContain('Security incident');
  });
});
