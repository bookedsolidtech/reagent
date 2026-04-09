import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, type ExecFileSyncOptions } from 'node:child_process';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const CLI_ENTRY = path.join(PROJECT_ROOT, 'dist', 'cli', 'index.js');

function run(
  args: string[],
  opts: ExecFileSyncOptions = {}
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const result = execFileSync(process.execPath, [CLI_ENTRY, ...args], {
      encoding: 'utf8',
      timeout: 15_000,
      ...opts,
    });
    const stdout = typeof result === 'string' ? result : result.toString('utf8');
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: (e.stdout as string) ?? '',
      stderr: (e.stderr as string) ?? '',
      exitCode: e.status ?? 1,
    };
  }
}

describe('ESM entry point (dist/cli/index.js)', () => {
  it('exists after build', () => {
    expect(fs.existsSync(CLI_ENTRY)).toBe(true);
  });

  it('starts with a node shebang', () => {
    const content = fs.readFileSync(CLI_ENTRY, 'utf8');
    expect(content.startsWith('#!/usr/bin/env node')).toBe(true);
  });

  it('is valid ESM — contains import statements', () => {
    const content = fs.readFileSync(CLI_ENTRY, 'utf8');
    expect(content).toMatch(/\bimport\b/);
  });

  it('is valid ESM — does not use require()', () => {
    const content = fs.readFileSync(CLI_ENTRY, 'utf8');
    // Ignore source map comments and strings — look for actual require() calls
    const lines = content.split('\n').filter((l) => !l.startsWith('//'));
    const hasRequire = lines.some((l) => /\brequire\s*\(/.test(l));
    expect(hasRequire).toBe(false);
  });

  it('--help outputs help text and exits 0', () => {
    const { stdout, exitCode } = run(['--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('@bookedsolid/reagent');
    expect(stdout).toContain('Commands:');
    expect(stdout).toContain('init');
    expect(stdout).toContain('check');
    expect(stdout).toContain('freeze');
    expect(stdout).toContain('unfreeze');
  });

  it('"help" command outputs help text and exits 0', () => {
    const { stdout, exitCode } = run(['help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Usage:');
  });

  it('no arguments outputs help text and exits 0', () => {
    const { stdout, exitCode } = run([]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Commands:');
  });

  it('check command runs without crashing', () => {
    // check will likely exit 1 (failed checks) but should not crash
    const { stdout, stderr } = run(['check']);
    const combined = stdout + stderr;
    expect(combined).toContain('check');
    // Should not contain a Node.js crash / unhandled error
    expect(combined).not.toMatch(/SyntaxError/);
    expect(combined).not.toMatch(/Cannot find module/);
    expect(combined).not.toMatch(/ERR_MODULE_NOT_FOUND/);
  });

  it('unknown command exits with code 1', () => {
    const { stderr, exitCode } = run(['nonexistent-command']);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('Unknown command');
  });

  describe('freeze / unfreeze lifecycle', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reagent-freeze-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('freeze creates HALT file and unfreeze removes it', () => {
      const freezeResult = run(['freeze', '--reason', 'test-freeze'], { cwd: tmpDir });
      expect(freezeResult.exitCode).toBe(0);
      expect(freezeResult.stdout).toContain('REAGENT FROZEN');

      const haltFile = path.join(tmpDir, '.reagent', 'HALT');
      expect(fs.existsSync(haltFile)).toBe(true);
      expect(fs.readFileSync(haltFile, 'utf8')).toContain('test-freeze');

      const unfreezeResult = run(['unfreeze'], { cwd: tmpDir });
      expect(unfreezeResult.exitCode).toBe(0);
      expect(unfreezeResult.stdout).toContain('UNFROZEN');
      expect(fs.existsSync(haltFile)).toBe(false);
    });
  });

  describe('init --dry-run (exercises PKG_ROOT resolution)', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reagent-init-'));
      // init expects a .gitignore to exist for entry checks
      fs.writeFileSync(path.join(tmpDir, '.gitignore'), '', 'utf8');
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('init --dry-run runs without crashing and shows profile info', () => {
      const { stdout, stderr, exitCode } = run(['init', '--dry-run'], { cwd: tmpDir });
      const combined = stdout + stderr;
      // Should not crash with ESM resolution errors
      expect(combined).not.toMatch(/ERR_MODULE_NOT_FOUND/);
      expect(combined).not.toMatch(/Cannot find module/);
      expect(combined).not.toMatch(/SyntaxError/);
      // Should output something about init
      expect(stdout).toContain('init');
      expect(exitCode).toBe(0);
    });

    it('init --dry-run does not write files', () => {
      run(['init', '--dry-run'], { cwd: tmpDir });
      // .reagent/policy.yaml should NOT be created in dry-run
      expect(fs.existsSync(path.join(tmpDir, '.reagent', 'policy.yaml'))).toBe(false);
    });
  });
});
