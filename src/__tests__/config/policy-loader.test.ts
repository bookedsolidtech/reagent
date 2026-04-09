import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadPolicy } from '../../config/policy-loader.js';

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
