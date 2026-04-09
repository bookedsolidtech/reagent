import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createAuditMiddleware } from '../../gateway/middleware/audit.js';
import { Tier, InvocationStatus } from '../../types/index.js';
import type { InvocationContext } from '../../gateway/middleware/chain.js';

describe('audit middleware', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reagent-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes JSONL audit record', async () => {
    const mw = createAuditMiddleware(tmpDir);
    const ctx: InvocationContext = {
      tool_name: 'send_message',
      server_name: 'discord-ops',
      arguments: {},
      session_id: 'test-session',
      tier: Tier.Write,
      status: InvocationStatus.Allowed,
      start_time: Date.now(),
      metadata: { autonomy_level: 'L1' },
    };

    await mw(ctx, async () => {});

    const auditDir = path.join(tmpDir, '.reagent', 'audit');
    const files = fs.readdirSync(auditDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}\.jsonl$/);

    const content = fs.readFileSync(path.join(auditDir, files[0]), 'utf8').trim();
    const record = JSON.parse(content);
    expect(record.tool_name).toBe('send_message');
    expect(record.server_name).toBe('discord-ops');
    expect(record.tier).toBe('write');
    expect(record.status).toBe('allowed');
    expect(record.hash).toBeTruthy();
    expect(record.prev_hash).toBeTruthy();
  });

  it('hash chains consecutive records', async () => {
    const mw = createAuditMiddleware(tmpDir);

    const makeCtx = (): InvocationContext => ({
      tool_name: 'send_message',
      server_name: 'discord-ops',
      arguments: {},
      session_id: 'test-session',
      tier: Tier.Write,
      status: InvocationStatus.Allowed,
      start_time: Date.now(),
      metadata: { autonomy_level: 'L1' },
    });

    await mw(makeCtx(), async () => {});
    await mw(makeCtx(), async () => {});

    const auditDir = path.join(tmpDir, '.reagent', 'audit');
    const files = fs.readdirSync(auditDir);
    const lines = fs.readFileSync(path.join(auditDir, files[0]), 'utf8').trim().split('\n');

    expect(lines.length).toBe(2);
    const record1 = JSON.parse(lines[0]);
    const record2 = JSON.parse(lines[1]);
    expect(record2.prev_hash).toBe(record1.hash);
  });
});
