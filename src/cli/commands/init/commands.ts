import fs from 'node:fs';
import path from 'node:path';
import { PKG_ROOT } from '../../utils.js';
import type { InstallResult } from './types.js';

export function installClaudeCommands(targetDir: string, dryRun: boolean): InstallResult[] {
  const commandsSrcDir = path.join(PKG_ROOT, 'commands');
  const commandsDestDir = path.join(targetDir, '.claude', 'commands');

  if (!fs.existsSync(commandsSrcDir)) {
    return [];
  }

  if (!dryRun) {
    fs.mkdirSync(commandsDestDir, { recursive: true });
  }

  const results: InstallResult[] = [];
  const commandFiles = fs.readdirSync(commandsSrcDir).filter((f) => f.endsWith('.md'));

  for (const fileName of commandFiles) {
    const srcFile = path.join(commandsSrcDir, fileName);
    const destFile = path.join(commandsDestDir, fileName);

    const srcContent = fs.readFileSync(srcFile, 'utf8');
    const exists = fs.existsSync(destFile);
    const same = exists && fs.readFileSync(destFile, 'utf8') === srcContent;

    if (!same && !dryRun) {
      fs.writeFileSync(destFile, srcContent, 'utf8');
    }

    results.push({
      file: `.claude/commands/${fileName}`,
      status: same ? 'skipped' : exists ? 'updated' : 'installed',
    });
  }

  return results;
}
