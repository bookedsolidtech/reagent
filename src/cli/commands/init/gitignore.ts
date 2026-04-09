import fs from 'node:fs';
import path from 'node:path';
import { gitignoreHasEntry } from '../../utils.js';
import type { InstallResult } from './types.js';

export function installGitignoreEntries(
  targetDir: string,
  entries: string[],
  dryRun: boolean
): InstallResult[] {
  const gitignorePath = path.join(targetDir, '.gitignore');
  const missing = entries.filter((e) => !gitignoreHasEntry(targetDir, e));

  if (!missing.length) {
    return [{ file: '.gitignore', status: 'skipped' }];
  }

  if (!dryRun) {
    const additions = [
      '',
      '# reagent — AI tooling (stays on developer machine, not committed)',
      ...missing,
    ].join('\n');
    fs.appendFileSync(gitignorePath, additions + '\n');
  }

  return [{ file: `.gitignore (+${missing.length} entries)`, status: 'updated' }];
}
