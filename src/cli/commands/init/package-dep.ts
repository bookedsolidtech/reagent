import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getPkgVersion } from '../../utils.js';
import type { InstallResult } from './types.js';

/**
 * Detect which package manager the target project uses.
 * Checks lockfiles first, falls back to npm.
 */
function detectPm(targetDir: string): 'pnpm' | 'yarn' | 'bun' | 'npm' {
  if (fs.existsSync(path.join(targetDir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(targetDir, 'yarn.lock'))) return 'yarn';
  if (
    fs.existsSync(path.join(targetDir, 'bun.lockb')) ||
    fs.existsSync(path.join(targetDir, 'bun.lock'))
  )
    return 'bun';
  return 'npm';
}

/**
 * Check if the project is a pnpm/yarn/npm workspace root.
 */
function isWorkspaceRoot(targetDir: string, pm: string): boolean {
  if (pm === 'pnpm') {
    return fs.existsSync(path.join(targetDir, 'pnpm-workspace.yaml'));
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(targetDir, 'package.json'), 'utf8')) as {
      workspaces?: unknown;
    };
    return Array.isArray(pkg.workspaces) || typeof pkg.workspaces === 'object';
  } catch {
    return false;
  }
}

/**
 * Check if @bookedsolid/reagent is already in package.json devDependencies.
 */
function isAlreadyInstalled(targetDir: string): string | null {
  const pkgPath = path.join(targetDir, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
      devDependencies?: Record<string, string>;
      dependencies?: Record<string, string>;
    };
    return (
      pkg.devDependencies?.['@bookedsolid/reagent'] ||
      pkg.dependencies?.['@bookedsolid/reagent'] ||
      null
    );
  } catch {
    return null;
  }
}

/**
 * Install @bookedsolid/reagent as a devDependency in the target project.
 *
 * Idempotent:
 *  - If already in package.json: skips
 *  - If no package.json exists: warns (not a Node project)
 *  - Otherwise: runs `{pm} add -D @bookedsolid/reagent@^{version}`
 *
 * Handles workspace roots by adding `-w` (pnpm) or `-W` (yarn) flag.
 */
export function installPackageDep(targetDir: string, dryRun: boolean): InstallResult[] {
  const pkgPath = path.join(targetDir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return [
      { file: 'package.json (no package.json found — skip dependency install)', status: 'warn' },
    ];
  }

  const existing = isAlreadyInstalled(targetDir);
  if (existing) {
    return [{ file: `package.json (@bookedsolid/reagent: ${existing})`, status: 'skipped' }];
  }

  const pm = detectPm(targetDir);
  const version = getPkgVersion();
  const isWorkspace = isWorkspaceRoot(targetDir, pm);
  const spec = `@bookedsolid/reagent@^${version}`;

  if (dryRun) {
    const wsFlag = isWorkspace ? ' (workspace root)' : '';
    return [
      {
        file: `package.json (would run: ${pm} add -D ${spec}${wsFlag})`,
        status: 'installed',
      },
    ];
  }

  try {
    const addArgs = ['add', '-D'];

    // Workspace roots need a flag to confirm root-level install
    if (isWorkspace) {
      if (pm === 'pnpm') addArgs.push('-w');
      if (pm === 'yarn') addArgs.push('-W');
    }

    addArgs.push(spec);

    execFileSync(pm, addArgs, {
      cwd: targetDir,
      stdio: 'pipe',
      timeout: 60_000,
    });

    return [{ file: `package.json (+${spec} via ${pm})`, status: 'installed' }];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Extract the useful part of the error (skip Node deprecation warnings)
    const lines = msg.split('\n').filter((l) => !l.includes('DeprecationWarning') && l.trim());
    const summary = lines.slice(-3).join(' ').slice(0, 200);
    return [
      { file: `package.json (${pm} add failed: ${summary || msg.slice(0, 200)})`, status: 'warn' },
    ];
  }
}
