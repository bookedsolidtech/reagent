import fs from 'node:fs';
import path from 'node:path';
import { PKG_ROOT } from '../../utils.js';
import type { InstallResult } from './types.js';

export function installHuskyHook(
  targetDir: string,
  hookName: string,
  srcFileName: string,
  dryRun: boolean
): InstallResult[] {
  const srcFile = path.join(PKG_ROOT, 'husky', srcFileName);
  const huskyDir = path.join(targetDir, '.husky');
  const huskyHook = path.join(huskyDir, hookName);

  if (!fs.existsSync(srcFile)) {
    console.error(`  ERROR: husky hook source not found in package: husky/${srcFileName}`);
    return [{ file: `.husky/${hookName}`, status: 'warn' }];
  }

  const srcContent = fs.readFileSync(srcFile, 'utf8');
  const results: InstallResult[] = [];

  if (!dryRun) {
    fs.mkdirSync(huskyDir, { recursive: true });
  }

  const huskyExists = fs.existsSync(huskyHook);
  const huskySame = huskyExists && fs.readFileSync(huskyHook, 'utf8') === srcContent;

  if (!huskySame && !dryRun) {
    fs.writeFileSync(huskyHook, srcContent, { mode: 0o755 });
  }
  results.push({
    file: `.husky/${hookName}`,
    status: huskySame ? 'skipped' : huskyExists ? 'updated' : 'installed',
  });

  // For commit-msg: also install to .git/hooks/ as fallback
  if (hookName === 'commit-msg') {
    const gitHooksDir = path.join(targetDir, '.git', 'hooks');
    if (fs.existsSync(gitHooksDir)) {
      const gitHook = path.join(gitHooksDir, hookName);
      const gitHookExists = fs.existsSync(gitHook);
      const gitHookSame = gitHookExists && fs.readFileSync(gitHook, 'utf8') === srcContent;

      if (!gitHookSame && !dryRun) {
        fs.writeFileSync(gitHook, srcContent, { mode: 0o755 });
      }
      results.push({
        file: '.git/hooks/commit-msg (active git hook)',
        status: gitHookSame ? 'skipped' : gitHookExists ? 'updated' : 'installed',
      });
    }
  }

  // Ensure package.json has husky devDependency and prepare script
  if (hookName === 'commit-msg') {
    const pkgJsonPath = path.join(targetDir, 'package.json');
    if (fs.existsSync(pkgJsonPath) && !dryRun) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
        const scripts = pkg.scripts || {};
        let changed = false;
        if (!scripts.prepare || !scripts.prepare.includes('husky')) {
          scripts.prepare = scripts.prepare ? `${scripts.prepare} && husky` : 'husky';
          pkg.scripts = scripts;
          changed = true;
        }
        const devDeps = pkg.devDependencies || {};
        if (!devDeps.husky) {
          devDeps.husky = '^9.1.7';
          pkg.devDependencies = devDeps;
          changed = true;
        }
        if (changed) {
          fs.writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2) + '\n');
          results.push({ file: 'package.json (added husky)', status: 'updated' });
        }
      } catch (err) {
        console.warn(`  Warning: Could not update package.json: ${(err as Error).message}`);
      }
    }
  }

  return results;
}
