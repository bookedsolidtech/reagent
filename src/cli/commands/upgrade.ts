import fs from 'node:fs';
import path from 'node:path';
import { PKG_ROOT, getPkgVersion } from '../utils.js';
import type { InstallResult } from './init/types.js';
import { installHuskyHook } from './init/husky-hooks.js';
import { mergePolicy } from './upgrade-policy.js';

// All hook names managed by reagent, mapped to their source file names
const HOOK_MAP: Array<{ hookName: string; srcFileName: string }> = [
  { hookName: 'commit-msg', srcFileName: 'commit-msg.sh' },
  { hookName: 'pre-commit', srcFileName: 'pre-commit.sh' },
  { hookName: 'pre-push', srcFileName: 'pre-push.sh' },
];

export function runUpgrade(args: string[]): void {
  const targetDir = process.cwd();
  const dryRun = args.includes('--dry-run');
  const cleanBlockedPaths = args.includes('--clean-blocked-paths');
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
  }

  // Step 2: YAML-aware policy merge — updates version stamp, adds missing
  // canonical sections, and optionally cleans blocked_paths.
  const policyResults = mergePolicy(targetDir, PKG_VERSION, dryRun, {
    cleanBlockedPaths,
  });
  results.push(...policyResults);

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
