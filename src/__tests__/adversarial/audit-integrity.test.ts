import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { createAuditMiddleware } from '../../gateway/middleware/audit.js';
import { InvocationStatus, Tier } from '../../types/index.js';
import type { InvocationContext } from '../../gateway/middleware/chain.js';
import type { AuditRecord } from '../../types/index.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reagent-audit-adv-'));
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
    metadata: { autonomy_level: 'L1' },
    ...overrides,
  };
}

function readAuditRecords(baseDir: string): AuditRecord[] {
  const auditDir = path.join(baseDir, '.reagent', 'audit');
  if (!fs.existsSync(auditDir)) return [];
  const files = fs.readdirSync(auditDir).filter((f) => f.endsWith('.jsonl'));
  const records: AuditRecord[] = [];
  for (const file of files) {
    const lines = fs.readFileSync(path.join(auditDir, file), 'utf8').trim().split('\n');
    for (const line of lines) {
      if (line) records.push(JSON.parse(line));
    }
  }
  return records;
}

describe('adversarial: audit chain integrity', () => {
  it('produces different hashes for different tool names', async () => {
    const mw = createAuditMiddleware(tmpDir);

    const ctx1 = createCtx({ tool_name: 'tool_alpha' });
    await mw(ctx1, async () => {});

    const ctx2 = createCtx({ tool_name: 'tool_beta' });
    await mw(ctx2, async () => {});

    const records = readAuditRecords(tmpDir);
    expect(records[0].hash).not.toBe(records[1].hash);
  });

  it('hash chain links records via prev_hash', async () => {
    const mw = createAuditMiddleware(tmpDir);

    const ctx1 = createCtx();
    await mw(ctx1, async () => {});

    const ctx2 = createCtx();
    await mw(ctx2, async () => {});

    const records = readAuditRecords(tmpDir);
    expect(records[1].prev_hash).toBe(records[0].hash);
  });

  it('can independently verify a record hash', async () => {
    const mw = createAuditMiddleware(tmpDir);
    const ctx = createCtx();
    await mw(ctx, async () => {});

    const records = readAuditRecords(tmpDir);
    const record = records[0];

    const { hash, ...rest } = record;
    const recomputed = crypto.createHash('sha256').update(JSON.stringify(rest)).digest('hex');
    expect(recomputed).toBe(hash);
  });

  it('detects forged record (modified tool_name)', async () => {
    const mw = createAuditMiddleware(tmpDir);
    const ctx = createCtx({ tool_name: 'real_tool' });
    await mw(ctx, async () => {});

    const records = readAuditRecords(tmpDir);
    const record = records[0];

    const forged = { ...record, tool_name: 'forged_tool' };
    const { hash, ...rest } = forged;
    const recomputed = crypto.createHash('sha256').update(JSON.stringify(rest)).digest('hex');

    expect(recomputed).not.toBe(hash);
  });

  it('survives audit file deletion mid-chain (creates new file)', async () => {
    const mw = createAuditMiddleware(tmpDir);

    const ctx1 = createCtx();
    await mw(ctx1, async () => {});

    const auditDir = path.join(tmpDir, '.reagent', 'audit');
    fs.rmSync(auditDir, { recursive: true, force: true });

    const ctx2 = createCtx();
    await mw(ctx2, async () => {});

    const records = readAuditRecords(tmpDir);
    expect(records).toHaveLength(1);
  });

  it('hash chain breaks after file deletion (prev_hash references deleted record)', async () => {
    const mw = createAuditMiddleware(tmpDir);

    const ctx1 = createCtx();
    await mw(ctx1, async () => {});

    const recordsBefore = readAuditRecords(tmpDir);
    const firstHash = recordsBefore[0].hash;

    const auditDir = path.join(tmpDir, '.reagent', 'audit');
    fs.rmSync(auditDir, { recursive: true, force: true });

    const ctx2 = createCtx();
    await mw(ctx2, async () => {});

    const recordsAfter = readAuditRecords(tmpDir);
    // SECURE: in-memory chain is maintained even if file is deleted
    expect(recordsAfter[0].prev_hash).toBe(firstHash);
  });

  it('corrupted file does not affect new writes (append-only)', async () => {
    const mw = createAuditMiddleware(tmpDir);

    const ctx1 = createCtx();
    await mw(ctx1, async () => {});

    const auditDir = path.join(tmpDir, '.reagent', 'audit');
    const files = fs.readdirSync(auditDir);
    fs.appendFileSync(path.join(auditDir, files[0]), 'CORRUPTED_GARBAGE\n');

    const ctx2 = createCtx();
    await mw(ctx2, async () => {});

    const raw = fs.readFileSync(path.join(auditDir, files[0]), 'utf8').trim().split('\n');
    expect(raw).toHaveLength(3);
    expect(() => JSON.parse(raw[1])).toThrow();
  });

  it('SECURE: prevHash is per-instance (not shared across middleware instances)', async () => {
    // Each createAuditMiddleware call now has its own prevHash closure
    const mw1 = createAuditMiddleware(tmpDir);
    const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'reagent-audit-adv2-'));

    try {
      const mw2 = createAuditMiddleware(tmpDir2);

      const ctx1 = createCtx({ tool_name: 'tool_a' });
      await mw1(ctx1, async () => {});

      const ctx2 = createCtx({ tool_name: 'tool_b' });
      await mw2(ctx2, async () => {});

      const records1 = readAuditRecords(tmpDir);
      const records2 = readAuditRecords(tmpDir2);

      // SECURE: separate instances have independent hash chains
      // Both start from the genesis zero hash
      const genesisHash = '0000000000000000000000000000000000000000000000000000000000000000';
      expect(records1[0].prev_hash).toBe(genesisHash);
      expect(records2[0].prev_hash).toBe(genesisHash);
    } finally {
      fs.rmSync(tmpDir2, { recursive: true, force: true });
    }
  });

  it('concurrent writes produce valid JSONL', async () => {
    const mw = createAuditMiddleware(tmpDir);

    const promises: Promise<void>[] = [];
    for (let i = 0; i < 20; i++) {
      const ctx = createCtx({ tool_name: `concurrent_tool_${i}` });
      promises.push(mw(ctx, async () => {}));
    }
    await Promise.all(promises);

    const records = readAuditRecords(tmpDir);
    expect(records).toHaveLength(20);
  });

  it('SECURE: does not crash if audit directory is read-only (graceful failure)', async () => {
    const reagentDir = path.join(tmpDir, '.reagent');
    fs.mkdirSync(reagentDir, { recursive: true });
    fs.chmodSync(reagentDir, 0o444);

    const mw = createAuditMiddleware(tmpDir);
    const ctx = createCtx();

    try {
      // SECURE: audit write failure is caught, does not crash
      await mw(ctx, async () => {});
      // Should complete without throwing
    } finally {
      fs.chmodSync(reagentDir, 0o755);
    }
  });

  it('audit records tier as Write when ctx.tier is undefined', async () => {
    const mw = createAuditMiddleware(tmpDir);
    const ctx = createCtx({ tier: undefined });
    await mw(ctx, async () => {});

    const records = readAuditRecords(tmpDir);
    expect(records[0].tier).toBe('write');
  });
});
