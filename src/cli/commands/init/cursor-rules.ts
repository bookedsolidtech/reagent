import fs from 'node:fs';
import path from 'node:path';
import { PKG_ROOT } from '../../utils.js';
import type { InstallResult } from './types.js';

export function installCursorRules(
  targetDir: string,
  ruleNames: string[],
  dryRun: boolean
): InstallResult[] {
  const rulesDir = path.join(targetDir, '.cursor', 'rules');
  if (!dryRun) {
    fs.mkdirSync(rulesDir, { recursive: true });
  }

  const results: InstallResult[] = [];
  for (const name of ruleNames) {
    const srcFile = path.join(PKG_ROOT, 'cursor', 'rules', `${name}.mdc`);
    const destFile = path.join(rulesDir, `${name}.mdc`);

    if (!fs.existsSync(srcFile)) {
      console.warn(`  Warning: cursor rule not found in package: ${name}.mdc`);
      continue;
    }

    const srcContent = fs.readFileSync(srcFile, 'utf8');
    const exists = fs.existsSync(destFile);
    const same = exists && fs.readFileSync(destFile, 'utf8') === srcContent;

    if (!same && !dryRun) {
      fs.writeFileSync(destFile, srcContent);
    }

    results.push({
      file: `.cursor/rules/${name}.mdc`,
      status: same ? 'skipped' : exists ? 'updated' : 'installed',
    });
  }
  return results;
}
