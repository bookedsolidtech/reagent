import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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

  it('stores autonomy_level in ctx.metadata', async () => {
    const mw = createPolicyMiddleware(createPolicy(AutonomyLevel.L1));
    const ctx = createContext('get_status'); // Read-tier
    await mw(ctx, async () => {});
    expect(ctx.metadata.autonomy_level).toBe(AutonomyLevel.L1);
  });
});

describe('policy hot-reload', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reagent-policy-reload-'));
    const reagentDir = path.join(tmpDir, '.reagent');
    fs.mkdirSync(reagentDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writePolicyFile(level: AutonomyLevel): void {
    fs.writeFileSync(
      path.join(tmpDir, '.reagent', 'policy.yaml'),
      `version: "1"
profile: test-reload
installed_by: test
installed_at: "2026-01-01T00:00:00Z"
autonomy_level: ${level}
max_autonomy_level: L3
promotion_requires_human_approval: false
blocked_paths: []
notification_channel: ""
`
    );
  }

  it('re-reads policy.yaml per invocation when baseDir provided', async () => {
    // Start with L3 (allows everything)
    writePolicyFile(AutonomyLevel.L3);
    const initialPolicy = createPolicy(AutonomyLevel.L3);
    const mw = createPolicyMiddleware(initialPolicy, undefined, tmpDir);

    // First call: L3 allows destructive
    const ctx1 = createContext('delete_channel');
    await mw(ctx1, async () => {});
    expect(ctx1.status).toBe(InvocationStatus.Allowed);

    // Change policy to L0 on disk
    writePolicyFile(AutonomyLevel.L0);

    // Second call: should now deny destructive (re-read L0 from disk)
    const ctx2 = createContext('delete_channel');
    await mw(ctx2, async () => {});
    expect(ctx2.status).toBe(InvocationStatus.Denied);
    expect(ctx2.error).toContain('L0');
  });

  it('falls back to last-good policy if file is deleted', async () => {
    writePolicyFile(AutonomyLevel.L3);
    const initialPolicy = createPolicy(AutonomyLevel.L1);
    const mw = createPolicyMiddleware(initialPolicy, undefined, tmpDir);

    // First call reads L3 from disk — this becomes the cached last-good
    const ctx1 = createContext('delete_channel');
    await mw(ctx1, async () => {});
    expect(ctx1.status).toBe(InvocationStatus.Allowed);

    // Delete policy file
    fs.unlinkSync(path.join(tmpDir, '.reagent', 'policy.yaml'));

    // Falls back to last-good (L3), NOT initial (L1)
    const ctx2 = createContext('delete_channel');
    await mw(ctx2, async () => {});
    expect(ctx2.status).toBe(InvocationStatus.Allowed);
  });

  it('falls back to last-good policy if file becomes malformed', async () => {
    // Start at L0 on disk
    writePolicyFile(AutonomyLevel.L0);
    const initialPolicy = createPolicy(AutonomyLevel.L3);
    const mw = createPolicyMiddleware(initialPolicy, undefined, tmpDir);

    // First call reads L0 — caches it as last-good
    const ctx1 = createContext('send_message'); // Write-tier
    await mw(ctx1, async () => {});
    expect(ctx1.status).toBe(InvocationStatus.Denied);
    expect(ctx1.error).toContain('L0');

    // Corrupt the file
    fs.writeFileSync(path.join(tmpDir, '.reagent', 'policy.yaml'), 'not: valid: yaml: {{{}}}');

    // Falls back to last-good (L0), NOT initial (L3)
    const ctx2 = createContext('send_message');
    await mw(ctx2, async () => {});
    expect(ctx2.status).toBe(InvocationStatus.Denied);
    expect(ctx2.error).toContain('L0');
  });

  it('uses initial policy as last-good when no successful reload has occurred', async () => {
    // No policy file on disk at all
    const initialPolicy = createPolicy(AutonomyLevel.L1);
    const mw = createPolicyMiddleware(initialPolicy, undefined, tmpDir);

    // Falls back to initial (L1) — denies destructive
    const ctx = createContext('delete_channel');
    await mw(ctx, async () => {});
    expect(ctx.status).toBe(InvocationStatus.Denied);
  });

  it('does not hot-reload when baseDir is not provided', async () => {
    writePolicyFile(AutonomyLevel.L3);
    const initialPolicy = createPolicy(AutonomyLevel.L3);
    // No baseDir — no hot-reload
    const mw = createPolicyMiddleware(initialPolicy);

    // Change policy on disk
    writePolicyFile(AutonomyLevel.L0);

    // Should still use initial policy (L3), not the disk version
    const ctx = createContext('delete_channel');
    await mw(ctx, async () => {});
    expect(ctx.status).toBe(InvocationStatus.Allowed);
  });

  it('hot-reload updates autonomy_level in metadata', async () => {
    writePolicyFile(AutonomyLevel.L1);
    const initialPolicy = createPolicy(AutonomyLevel.L3);
    const mw = createPolicyMiddleware(initialPolicy, undefined, tmpDir);

    const ctx = createContext('get_status'); // Read-tier (allowed at any level)
    await mw(ctx, async () => {});
    // Should reflect disk policy (L1), not initial (L3)
    expect(ctx.metadata.autonomy_level).toBe(AutonomyLevel.L1);
  });
});
