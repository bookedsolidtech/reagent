import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const CLI_ENTRY = path.join(PROJECT_ROOT, 'dist', 'cli', 'index.js');

/**
 * PKG_ROOT in utils.ts is computed as:
 *   path.join(__dirname, '..', '..')
 * where __dirname is derived from import.meta.url.
 *
 * When running from dist/cli/utils.js, that resolves to the project root.
 * This is the trickiest part of ESM migration because __dirname does not
 * exist natively in ESM — it must be derived from import.meta.url.
 */
describe('PKG_ROOT resolution via import.meta.url', () => {
  it('dist/cli/utils.js derives __dirname from import.meta.url', () => {
    const utilsPath = path.join(PROJECT_ROOT, 'dist', 'cli', 'utils.js');
    const content = fs.readFileSync(utilsPath, 'utf8');
    // Must use import.meta.url (ESM pattern) not __dirname (CJS)
    expect(content).toContain('import.meta.url');
    expect(content).toContain('fileURLToPath');
  });

  it('PKG_ROOT resolves to repo root — profiles/ is reachable', () => {
    // Use the CLI to verify: init --dry-run reads profiles/<name>.json via PKG_ROOT
    // If PKG_ROOT is wrong, this will fail with "Profile not found"
    const stdout = execFileSync(
      process.execPath,
      [CLI_ENTRY, 'init', '--dry-run', '--profile', 'client-engagement'],
      {
        encoding: 'utf8',
        timeout: 15_000,
        cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'reagent-pkgroot-')),
      }
    );
    expect(stdout).toContain('Profile: client-engagement');
    // Should NOT contain "Profile not found" which would indicate PKG_ROOT is broken
    expect(stdout).not.toContain('Profile not found');
  });

  it('PKG_ROOT resolves to repo root — templates/CLAUDE.md is reachable', () => {
    // templates/CLAUDE.md must exist at PKG_ROOT/templates/CLAUDE.md
    const templatePath = path.join(PROJECT_ROOT, 'templates', 'CLAUDE.md');
    expect(fs.existsSync(templatePath)).toBe(true);

    // Also verify via init --dry-run that CLAUDE.md template is found
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reagent-template-'));
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), '', 'utf8');

    const stdout = execFileSync(process.execPath, [CLI_ENTRY, 'init', '--dry-run'], {
      encoding: 'utf8',
      timeout: 15_000,
      cwd: tmpDir,
    });
    // Should mention CLAUDE.md in the output (installed or skipped)
    expect(stdout).toContain('CLAUDE.md');
    // Should NOT contain the error message for missing template
    expect(stdout).not.toContain('templates/CLAUDE.md not found');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('PKG_ROOT resolves to repo root — package.json version is readable', () => {
    // getPkgVersion reads PKG_ROOT/package.json — if broken, version shows "0.0.0"
    const { stdout } = (() => {
      try {
        return {
          stdout: execFileSync(process.execPath, [CLI_ENTRY, '--help'], {
            encoding: 'utf8',
            timeout: 15_000,
          }),
        };
      } catch (e: unknown) {
        return { stdout: (e as { stdout?: string }).stdout ?? '' };
      }
    })();

    // Version should be the real version from package.json, not the fallback "0.0.0"
    const pkgVersion = JSON.parse(
      fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8')
    ).version;
    expect(stdout).toContain(`v${pkgVersion}`);
    expect(stdout).not.toContain('v0.0.0');
  });

  it('running from repo root via "node dist/cli/index.js" works', () => {
    // This simulates running the CLI directly (not via npx symlink)
    const stdout = execFileSync(process.execPath, ['dist/cli/index.js', '--help'], {
      encoding: 'utf8',
      timeout: 15_000,
      cwd: PROJECT_ROOT,
    });
    expect(stdout).toContain('@bookedsolid/reagent');
  });

  it('profiles directory contains expected profile files', () => {
    const profilesDir = path.join(PROJECT_ROOT, 'profiles');
    expect(fs.existsSync(profilesDir)).toBe(true);
    const files = fs.readdirSync(profilesDir);
    expect(files).toContain('client-engagement.json');
    expect(files).toContain('bst-internal.json');
  });
});
