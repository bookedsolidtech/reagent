import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createKillSwitchMiddleware } from '../../gateway/middleware/kill-switch.js';
import { InvocationStatus, Tier } from '../../types/index.js';
import type { InvocationContext } from '../../gateway/middleware/chain.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reagent-ks-adv-'));
  fs.mkdirSync(path.join(tmpDir, '.reagent'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function createCtx(overrides: Partial<InvocationContext> = {}): InvocationContext {
  return {
    tool_name: 'test_tool',
    server_name: 'test-server',
    arguments: {},
    session_id: 'test-session',
    tier: Tier.Read,
    status: InvocationStatus.Allowed,
    start_time: Date.now(),
    metadata: {},
    ...overrides,
  };
}

function writeHalt(content: string = 'emergency stop') {
  fs.writeFileSync(path.join(tmpDir, '.reagent', 'HALT'), content);
}

function removeHalt() {
  const haltPath = path.join(tmpDir, '.reagent', 'HALT');
  if (fs.existsSync(haltPath)) fs.unlinkSync(haltPath);
}

describe('adversarial: kill switch race conditions', () => {
  it('denies when HALT file exists', async () => {
    writeHalt('manual stop');
    const mw = createKillSwitchMiddleware(tmpDir);
    const ctx = createCtx();

    await mw(ctx, async () => {});

    expect(ctx.status).toBe(InvocationStatus.Denied);
    expect(ctx.error).toContain('Kill switch active');
    expect(ctx.error).toContain('manual stop');
  });

  it('allows when HALT file does not exist', async () => {
    const mw = createKillSwitchMiddleware(tmpDir);
    const ctx = createCtx();
    let nextCalled = false;

    await mw(ctx, async () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(ctx.status).toBe(InvocationStatus.Allowed);
  });

  it('TOCTOU: HALT created after check but before downstream completes — tool still executes', async () => {
    const mw = createKillSwitchMiddleware(tmpDir);
    const ctx = createCtx();
    let toolExecuted = false;

    await mw(ctx, async () => {
      writeHalt('late halt');
      toolExecuted = true;
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    // Known TOCTOU limitation: kill switch checks once at entry
    expect(toolExecuted).toBe(true);
    expect(ctx.status).toBe(InvocationStatus.Allowed);
  });

  it('handles HALT file with empty content', async () => {
    writeHalt('');
    const mw = createKillSwitchMiddleware(tmpDir);
    const ctx = createCtx();

    await mw(ctx, async () => {});

    expect(ctx.status).toBe(InvocationStatus.Denied);
    expect(ctx.error).toContain('Kill switch active');
  });

  it('SECURE: caps HALT file read size to prevent oversized error strings', async () => {
    writeHalt('X'.repeat(1_000_000));
    const mw = createKillSwitchMiddleware(tmpDir);
    const ctx = createCtx();

    await mw(ctx, async () => {});

    expect(ctx.status).toBe(InvocationStatus.Denied);
    // SECURE: error message is capped (1024 bytes max for HALT content)
    expect(ctx.error!.length).toBeLessThan(2000);
  });

  it('handles HALT file with binary content', async () => {
    const binaryContent = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x00, 0x80]);
    fs.writeFileSync(path.join(tmpDir, '.reagent', 'HALT'), binaryContent);

    const mw = createKillSwitchMiddleware(tmpDir);
    const ctx = createCtx();

    await mw(ctx, async () => {});

    expect(ctx.status).toBe(InvocationStatus.Denied);
  });

  it('handles HALT file with newlines and special chars', async () => {
    writeHalt('line1\nline2\r\n\ttabbed');
    const mw = createKillSwitchMiddleware(tmpDir);
    const ctx = createCtx();

    await mw(ctx, async () => {});

    expect(ctx.status).toBe(InvocationStatus.Denied);
  });

  it('rapid HALT toggle: delete then recreate between checks', async () => {
    const mw = createKillSwitchMiddleware(tmpDir);

    const ctx1 = createCtx();
    let call1Executed = false;
    await mw(ctx1, async () => {
      call1Executed = true;
    });
    expect(call1Executed).toBe(true);

    writeHalt('stop');

    const ctx2 = createCtx();
    let call2Executed = false;
    await mw(ctx2, async () => {
      call2Executed = true;
    });
    expect(call2Executed).toBe(false);
    expect(ctx2.status).toBe(InvocationStatus.Denied);

    removeHalt();

    const ctx3 = createCtx();
    let call3Executed = false;
    await mw(ctx3, async () => {
      call3Executed = true;
    });
    expect(call3Executed).toBe(true);
  });

  it('SECURE: symlinked HALT within .reagent/ denies with content', async () => {
    // Symlink points to a file INSIDE .reagent/ — should be allowed and content read
    const realHaltPath = path.resolve(path.join(tmpDir, '.reagent', 'real_halt'));
    fs.writeFileSync(realHaltPath, 'symlinked stop');
    const haltPath = path.join(tmpDir, '.reagent', 'HALT');
    fs.symlinkSync(realHaltPath, haltPath);

    const mw = createKillSwitchMiddleware(tmpDir);
    const ctx = createCtx();

    await mw(ctx, async () => {});

    expect(ctx.status).toBe(InvocationStatus.Denied);
    // Either reads the content or detects as symlink — either way, denied
    expect(ctx.error).toContain('Kill switch active');
  });

  it('SECURE: symlinked HALT to file outside .reagent/ does NOT leak content', async () => {
    const sensitivePath = path.join(tmpDir, 'secret_config');
    fs.writeFileSync(sensitivePath, 'db_password=hunter2');
    const haltPath = path.join(tmpDir, '.reagent', 'HALT');
    fs.symlinkSync(sensitivePath, haltPath);

    const mw = createKillSwitchMiddleware(tmpDir);
    const ctx = createCtx();

    await mw(ctx, async () => {});

    // SECURE: symlink outside .reagent/ is detected, content NOT leaked
    expect(ctx.status).toBe(InvocationStatus.Denied);
    expect(ctx.error).not.toContain('db_password');
    expect(ctx.error).toContain('symlink outside');
  });

  it('SECURE: HALT as directory denies gracefully instead of crashing', async () => {
    const haltPath = path.join(tmpDir, '.reagent', 'HALT');
    fs.mkdirSync(haltPath, { recursive: true });

    const mw = createKillSwitchMiddleware(tmpDir);
    const ctx = createCtx();

    // SECURE: directory is detected, graceful denial instead of crash
    await mw(ctx, async () => {});
    expect(ctx.status).toBe(InvocationStatus.Denied);
    expect(ctx.error).toContain('non-file');
  });

  it('allows execution when .reagent directory does not exist', async () => {
    const noReagentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reagent-ks-empty-'));
    try {
      const mw = createKillSwitchMiddleware(noReagentDir);
      const ctx = createCtx();
      let nextCalled = false;

      await mw(ctx, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
    } finally {
      fs.rmSync(noReagentDir, { recursive: true, force: true });
    }
  });
});
