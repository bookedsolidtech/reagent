import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

describe('package.json exports and packaging', () => {
  const pkgJson = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));

  // Run npm pack once and share output across tests to avoid concurrent pack collisions
  let packOutput: string;
  beforeAll(() => {
    packOutput = execSync('npm pack --dry-run 2>&1', {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      timeout: 30_000,
    });
  });

  it('"type" is set to "module"', () => {
    expect(pkgJson.type).toBe('module');
  });

  it('"files" array includes "dist/"', () => {
    expect(pkgJson.files).toContain('dist/');
  });

  it('"bin.reagent" points to "dist/cli/index.js"', () => {
    expect(pkgJson.bin?.reagent).toBe('dist/cli/index.js');
  });

  it('the bin target file actually exists on disk', () => {
    const binPath = path.join(PROJECT_ROOT, pkgJson.bin.reagent);
    expect(fs.existsSync(binPath)).toBe(true);
  });

  it('"engines.node" requires >=22', () => {
    expect(pkgJson.engines?.node).toMatch(/>=\s*22/);
  });

  it('npm pack --dry-run includes dist/ files', () => {
    expect(packOutput).toContain('dist/cli/index.js');
    expect(packOutput).toContain('dist/cli/utils.js');
  });

  it('npm pack --dry-run includes profiles/', () => {
    expect(packOutput).toContain('profiles/');
  });

  it('npm pack --dry-run includes templates/', () => {
    expect(packOutput).toContain('templates/');
  });

  it('no stale bin/ directory reference in package.json', () => {
    const binValues = Object.values(pkgJson.bin || {}) as string[];
    for (const binPath of binValues) {
      expect(binPath).not.toMatch(/^bin\//);
    }
  });

  it('no stale bin/ directory on disk', () => {
    const oldBinDir = path.join(PROJECT_ROOT, 'bin');
    if (fs.existsSync(oldBinDir)) {
      expect(fs.existsSync(path.join(oldBinDir, 'init.js'))).toBe(false);
    }
  });
});
