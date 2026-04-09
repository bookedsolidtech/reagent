import fs from 'node:fs';
import path from 'node:path';
import { gitignoreHasEntry } from '../../utils.js';
import type { InstallResult } from './types.js';

interface PmConfig {
  enabled?: boolean;
  taskLinkGate?: boolean;
  maxOpenTasks?: number;
}

export function installPm(
  targetDir: string,
  pmConfig: PmConfig | undefined,
  dryRun: boolean
): InstallResult[] {
  if (!pmConfig?.enabled) {
    return [];
  }

  const results: InstallResult[] = [];
  const reagentDir = path.join(targetDir, '.reagent');
  const tasksPath = path.join(reagentDir, 'tasks.jsonl');

  // Scaffold empty tasks.jsonl
  if (!fs.existsSync(tasksPath)) {
    if (!dryRun) {
      fs.mkdirSync(reagentDir, { recursive: true });
      fs.writeFileSync(tasksPath, '', 'utf8');
    }
    results.push({ file: '.reagent/tasks.jsonl', status: 'installed' });
  } else {
    results.push({ file: '.reagent/tasks.jsonl', status: 'skipped' });
  }

  // Add tasks.jsonl to .gitignore (it's local state, not committed)
  const gitignorePath = path.join(targetDir, '.gitignore');
  const entry = '.reagent/tasks.jsonl';
  if (!gitignoreHasEntry(targetDir, entry)) {
    if (!dryRun) {
      fs.appendFileSync(gitignorePath, `\n# reagent task store (local state)\n${entry}\n`);
    }
    results.push({ file: `.gitignore (+${entry})`, status: 'updated' });
  }

  // Add tasks.lock to .gitignore
  const lockEntry = '.reagent/tasks.lock';
  if (!gitignoreHasEntry(targetDir, lockEntry)) {
    if (!dryRun) {
      fs.appendFileSync(gitignorePath, `${lockEntry}\n`);
    }
  }

  return results;
}
