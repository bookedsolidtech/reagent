import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadPolicy, loadPolicyAsync, invalidatePolicyCache } from '../../config/policy-loader.js';

describe('loadPolicy', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reagent-test-'));
    fs.mkdirSync(path.join(tmpDir, '.reagent'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parses a valid policy.yaml', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.reagent', 'policy.yaml'),
      `
version: "1"
profile: "bst-internal"
installed_by: "reagent@0.1.0"
installed_at: "2026-04-09T00:00:00Z"
autonomy_level: L1
max_autonomy_level: L2
promotion_requires_human_approval: true
blocked_paths:
  - ".reagent/"
  - ".env"
notification_channel: ""
`
    );

    const policy = loadPolicy(tmpDir);
    expect(policy.version).toBe('1');
    expect(policy.autonomy_level).toBe('L1');
    expect(policy.max_autonomy_level).toBe('L2');
    expect(policy.blocked_paths).toContain('.reagent/');
    expect(policy.promotion_requires_human_approval).toBe(true);
  });

  it('throws if policy file is missing', () => {
    expect(() => loadPolicy(tmpDir + '/nonexistent')).toThrow('Policy file not found');
  });

  it('throws on invalid autonomy level', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.reagent', 'policy.yaml'),
      `
version: "1"
profile: "test"
installed_by: "reagent@0.1.0"
installed_at: "2026-04-09T00:00:00Z"
autonomy_level: L99
max_autonomy_level: L2
promotion_requires_human_approval: true
blocked_paths: []
`
    );

    expect(() => loadPolicy(tmpDir)).toThrow();
  });
});

const VALID_POLICY_YAML = `
version: "1"
profile: "bst-internal"
installed_by: "reagent@0.1.0"
installed_at: "2026-04-09T00:00:00Z"
autonomy_level: L1
max_autonomy_level: L2
promotion_requires_human_approval: true
blocked_paths: []
notification_channel: ""
`;

describe('loadPolicyAsync', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reagent-async-test-'));
    fs.mkdirSync(path.join(tmpDir, '.reagent'), { recursive: true });
    invalidatePolicyCache(tmpDir);
  });

  afterEach(() => {
    invalidatePolicyCache(tmpDir);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parses a valid policy.yaml asynchronously', async () => {
    fs.writeFileSync(path.join(tmpDir, '.reagent', 'policy.yaml'), VALID_POLICY_YAML);
    const policy = await loadPolicyAsync(tmpDir);
    expect(policy.autonomy_level).toBe('L1');
    expect(policy.max_autonomy_level).toBe('L2');
  });

  it('throws if policy file is missing', async () => {
    await expect(loadPolicyAsync(tmpDir + '/nonexistent')).rejects.toThrow('Policy file not found');
  });

  it('returns cached result on second call (cache hit)', async () => {
    fs.writeFileSync(path.join(tmpDir, '.reagent', 'policy.yaml'), VALID_POLICY_YAML);
    const first = await loadPolicyAsync(tmpDir);
    // Do NOT re-write the file — mtime stays the same, so cache returns the same object
    const second = await loadPolicyAsync(tmpDir);
    expect(first).toBe(second); // Same object reference — cache hit
  });

  it('invalidates cache when file mtime changes', async () => {
    const policyPath = path.join(tmpDir, '.reagent', 'policy.yaml');
    fs.writeFileSync(policyPath, VALID_POLICY_YAML);
    const first = await loadPolicyAsync(tmpDir);
    expect(first.autonomy_level).toBe('L1');

    // Write new content, then explicitly set mtime forward — utimesSync is the
    // only reliable way to guarantee a different mtime on HFS+ (1s resolution).
    // A sleep before writeFileSync is not sufficient and is an anti-pattern.
    const updatedYaml = VALID_POLICY_YAML.replace('autonomy_level: L1', 'autonomy_level: L0');
    fs.writeFileSync(policyPath, updatedYaml);

    const futureTime = new Date(Date.now() + 2000);
    fs.utimesSync(policyPath, futureTime, futureTime);

    const second = await loadPolicyAsync(tmpDir);
    expect(second.autonomy_level).toBe('L0');
  });

  it('invalidatePolicyCache clears the cache for a specific baseDir', async () => {
    fs.writeFileSync(path.join(tmpDir, '.reagent', 'policy.yaml'), VALID_POLICY_YAML);
    const first = await loadPolicyAsync(tmpDir);
    invalidatePolicyCache(tmpDir);
    const second = await loadPolicyAsync(tmpDir);
    // After invalidation, a fresh read occurs — same content, but not the same object reference
    expect(second.autonomy_level).toBe(first.autonomy_level);
    expect(second).not.toBe(first); // Different object — cache was cleared
  });
});
