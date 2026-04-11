import fs from 'node:fs';
import path from 'node:path';
import { PKG_ROOT, getPkgVersion } from '../utils.js';
import type { InstallResult } from './init/types.js';
import { installHuskyHook } from './init/husky-hooks.js';

// All hook names managed by reagent, mapped to their source file names
const HOOK_MAP: Array<{ hookName: string; srcFileName: string }> = [
  { hookName: 'commit-msg', srcFileName: 'commit-msg.sh' },
  { hookName: 'pre-commit', srcFileName: 'pre-commit.sh' },
  { hookName: 'pre-push', srcFileName: 'pre-push.sh' },
];

export function runUpgrade(args: string[]): void {
  const targetDir = process.cwd();
  const dryRun = args.includes('--dry-run');
  const PKG_VERSION = getPkgVersion();

  console.log(`\n@bookedsolid/reagent v${PKG_VERSION} upgrade`);
  console.log(`  Target: ${targetDir}`);
  if (dryRun) console.log(`  Mode:   dry-run (no changes written)`);
  console.log('');

  const results: InstallResult[] = [];

  // Step 1: Re-sync husky hooks present in the project's .husky/ directory.
  // We only overwrite hooks that reagent manages AND that already exist in the
  // project — we never add new hooks that the user didn't opt into via init.
  const huskyDir = path.join(targetDir, '.husky');
  const huskyDirExists = fs.existsSync(huskyDir);

  if (!huskyDirExists) {
    console.log(
      'No .husky/ directory found. Run `reagent init` first to install hooks for this project.'
    );
    process.exit(1);
  }

  let hooksUpdated = 0;

  for (const { hookName, srcFileName } of HOOK_MAP) {
    const huskyHookPath = path.join(huskyDir, hookName);
    const srcFile = path.join(PKG_ROOT, 'husky', srcFileName);

    // Skip hooks the project has not installed (respect user's init choices)
    if (!fs.existsSync(huskyHookPath)) {
      continue;
    }

    // Verify the source exists in the package (guard against partial installs)
    if (!fs.existsSync(srcFile)) {
      results.push({ file: `.husky/${hookName}`, status: 'warn' });
      continue;
    }

    const hookResults = installHuskyHook(targetDir, hookName, srcFileName, dryRun);
    results.push(...hookResults);

    const anyChanged = hookResults.some((r) => r.status === 'updated' || r.status === 'installed');
    if (anyChanged) hooksUpdated++;
  }

  // Step 2: Update installed_by in .reagent/policy.yaml to reflect current version.
  // Only touches the installed_by line — all other user config is preserved.
  const policyPath = path.join(targetDir, '.reagent', 'policy.yaml');

  if (!fs.existsSync(policyPath)) {
    results.push({ file: '.reagent/policy.yaml', status: 'warn' });
    console.warn('  Warning: .reagent/policy.yaml not found. Run `reagent init` to create it.');
  } else {
    const policyContent = fs.readFileSync(policyPath, 'utf8');
    const updatedContent = policyContent.replace(
      /^installed_by:\s*['"]?reagent@[^'">\n]+['"]?/m,
      `installed_by: 'reagent@${PKG_VERSION}'`
    );

    if (updatedContent === policyContent) {
      // Line didn't match the expected pattern — still show as skipped, don't corrupt the file
      results.push({ file: '.reagent/policy.yaml', status: 'skipped' });
    } else if (!dryRun) {
      fs.writeFileSync(policyPath, updatedContent, 'utf8');
      results.push({ file: '.reagent/policy.yaml (installed_by updated)', status: 'updated' });
    } else {
      // dry-run: report what would change
      results.push({
        file: '.reagent/policy.yaml (installed_by would be updated)',
        status: 'updated',
      });
    }
  }

  printSummary(results, dryRun);
}

function printSummary(results: InstallResult[], dryRun: boolean): void {
  console.log('');

  const installed = results.filter((r) => r.status === 'installed');
  const updated = results.filter((r) => r.status === 'updated');
  const skipped = results.filter((r) => r.status === 'skipped');
  const warned = results.filter((r) => r.status === 'warn');

  if (installed.length) {
    console.log('Installed:');
    installed.forEach((r) => console.log(`  + ${r.file}`));
  }
  if (updated.length) {
    console.log('Updated:');
    updated.forEach((r) => console.log(`  ~ ${r.file}`));
  }
  if (skipped.length) {
    console.log('Already up-to-date:');
    skipped.forEach((r) => console.log(`  = ${r.file}`));
  }
  if (warned.length) {
    console.log('Warnings:');
    warned.forEach((r) => console.log(`  ! ${r.file}`));
  }

  if (!dryRun) {
    console.log('\nreagent upgrade complete');
    console.log('\nCommit the updated hooks to keep the team in sync:');
    console.log(
      '  git add .husky/ .reagent/policy.yaml && git commit -m "chore: upgrade reagent hooks"'
    );
    console.log('');
  }
}
