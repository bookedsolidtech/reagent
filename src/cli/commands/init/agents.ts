import fs from 'node:fs';
import path from 'node:path';
import { PKG_ROOT } from '../../utils.js';
import type { InstallResult } from './types.js';

export function installAgents(targetDir: string, dryRun: boolean): InstallResult[] {
  const agentsSrcDir = path.join(PKG_ROOT, 'agents');
  const agentsDestDir = path.join(targetDir, '.claude', 'agents');

  if (!fs.existsSync(agentsSrcDir)) {
    return [{ file: '.claude/agents/ (no agents directory in package)', status: 'warn' }];
  }

  if (!dryRun) {
    // Remove stale symlink if present (e.g. from a retired .clarity submodule)
    try {
      const stat = fs.lstatSync(agentsDestDir);
      if (stat.isSymbolicLink()) fs.unlinkSync(agentsDestDir);
    } catch {
      /* doesn't exist yet — fine */
    }
    fs.mkdirSync(agentsDestDir, { recursive: true });
  }

  const results: InstallResult[] = [];

  // Recursively walk agents/ for all .md files
  function walkDir(dir: string, relativeBase: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue; // skip symlinks for safety
      const srcPath = path.join(dir, entry.name);
      const relativePath = path.join(relativeBase, entry.name);

      if (entry.isDirectory()) {
        const destSubDir = path.join(agentsDestDir, relativeBase, entry.name);
        if (!dryRun) {
          fs.mkdirSync(destSubDir, { recursive: true });
        }
        walkDir(srcPath, relativePath);
      } else if (entry.name.endsWith('.md')) {
        const destPath = path.join(agentsDestDir, relativePath);

        const srcContent = fs.readFileSync(srcPath, 'utf8');
        const exists = fs.existsSync(destPath);
        const same = exists && fs.readFileSync(destPath, 'utf8') === srcContent;

        if (!same && !dryRun) {
          fs.writeFileSync(destPath, srcContent, 'utf8');
        }

        results.push({
          file: `.claude/agents/${relativePath}`,
          status: same ? 'skipped' : exists ? 'updated' : 'installed',
        });
      }
    }
  }

  walkDir(agentsSrcDir, '');
  return results;
}
