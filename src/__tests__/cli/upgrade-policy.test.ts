import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { mergePolicy } from '../../cli/commands/upgrade-policy.js';

describe('mergePolicy', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reagent-upgrade-policy-'));
    fs.mkdirSync(path.join(tmpDir, '.reagent'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writePolicy(content: string): void {
    fs.writeFileSync(path.join(tmpDir, '.reagent', 'policy.yaml'), content, 'utf8');
  }

  function readPolicy(): string {
    return fs.readFileSync(path.join(tmpDir, '.reagent', 'policy.yaml'), 'utf8');
  }

  it('warns when policy.yaml does not exist', () => {
    fs.rmSync(path.join(tmpDir, '.reagent'), { recursive: true, force: true });
    const results = mergePolicy(tmpDir, '1.0.0', false);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('warn');
  });

  it('updates installed_by version', () => {
    writePolicy(`version: "1"\ninstalled_by: "reagent@0.5.0"\n`);
    const results = mergePolicy(tmpDir, '1.0.0', false);
    const content = readPolicy();
    expect(content).toContain('reagent@1.0.0');
    expect(results.some((r) => r.status === 'updated')).toBe(true);
  });

  it('adds missing context_protection section', () => {
    writePolicy(`version: "1"\ninstalled_by: "reagent@1.0.0"\n`);
    const results = mergePolicy(tmpDir, '1.0.0', false);
    const content = readPolicy();
    expect(content).toContain('context_protection');
    expect(content).toContain('delegate_to_subagent');
    expect(content).toContain('max_bash_output_lines');
    expect(results.some((r) => r.file.includes('added context_protection'))).toBe(true);
  });

  it('does not overwrite existing context_protection', () => {
    writePolicy(
      `version: "1"\ninstalled_by: "reagent@1.0.0"\ncontext_protection:\n  max_bash_output_lines: 200\n`
    );
    const results = mergePolicy(tmpDir, '1.0.0', false);
    const content = readPolicy();
    expect(content).toContain('max_bash_output_lines: 200');
    expect(results.some((r) => r.file.includes('added context_protection'))).toBe(false);
  });

  it('preserves existing YAML comments', () => {
    writePolicy(`# My custom comment\nversion: "1"\ninstalled_by: "reagent@0.5.0"\n`);
    mergePolicy(tmpDir, '1.0.0', false);
    const content = readPolicy();
    expect(content).toContain('# My custom comment');
  });

  it('cleans blocked_paths when --clean-blocked-paths', () => {
    writePolicy(
      `version: "1"\ninstalled_by: "reagent@1.0.0"\nblocked_paths:\n  - ".reagent/"\n  - ".env"\n`
    );
    const results = mergePolicy(tmpDir, '1.0.0', false, { cleanBlockedPaths: true });
    const content = readPolicy();
    expect(content).not.toMatch(/- ['"]?\.reagent\/['"]?\n/);
    expect(content).toContain('.reagent/policy.yaml');
    expect(content).toContain('.reagent/HALT');
    expect(content).toContain('.env');
    expect(results.some((r) => r.file.includes('granular'))).toBe(true);
  });

  it('no-ops clean when .reagent/ not in blocked_paths', () => {
    writePolicy(`version: "1"\ninstalled_by: "reagent@1.0.0"\nblocked_paths:\n  - ".env"\n`);
    const results = mergePolicy(tmpDir, '1.0.0', false, { cleanBlockedPaths: true });
    expect(results.some((r) => r.file.includes('granular'))).toBe(false);
  });

  it('dry-run does not write changes', () => {
    writePolicy(`version: "1"\ninstalled_by: "reagent@0.5.0"\n`);
    const results = mergePolicy(tmpDir, '1.0.0', true);
    const content = readPolicy();
    expect(content).toContain('reagent@0.5.0');
    expect(results.some((r) => r.file.includes('would be updated'))).toBe(true);
  });

  it('is idempotent — running twice produces no extra changes', () => {
    writePolicy(`version: "1"\ninstalled_by: "reagent@0.5.0"\n`);
    mergePolicy(tmpDir, '1.0.0', false);
    const afterFirst = readPolicy();

    const results = mergePolicy(tmpDir, '1.0.0', false);
    const afterSecond = readPolicy();

    expect(afterSecond).toBe(afterFirst);
    expect(results.every((r) => r.status === 'skipped')).toBe(true);
  });
});
