import fs from 'node:fs';
import path from 'node:path';
import { getPkgVersion, gitignoreHasEntry } from '../utils.js';

export function runCheck(_args: string[]): void {
  const targetDir = process.cwd();
  const PKG_VERSION = getPkgVersion();

  console.log(`\n@bookedsolid/reagent v${PKG_VERSION} check`);
  console.log(`  Target: ${targetDir}\n`);

  const checks = [
    {
      label: '.cursor/rules/ installed',
      pass: () =>
        fs.existsSync(path.join(targetDir, '.cursor', 'rules', '001-no-hallucination.mdc')),
    },
    {
      label: '.husky/commit-msg installed',
      pass: () => fs.existsSync(path.join(targetDir, '.husky', 'commit-msg')),
    },
    {
      label: '.husky/pre-commit installed',
      pass: () => fs.existsSync(path.join(targetDir, '.husky', 'pre-commit')),
    },
    {
      label: '.husky/pre-push installed',
      pass: () => fs.existsSync(path.join(targetDir, '.husky', 'pre-push')),
    },
    {
      label: '.git/hooks/commit-msg installed (fallback)',
      pass: () => fs.existsSync(path.join(targetDir, '.git', 'hooks', 'commit-msg')),
    },
    {
      label: '.claude/hooks/ installed',
      pass: () =>
        fs.existsSync(path.join(targetDir, '.claude', 'hooks', 'dangerous-bash-interceptor.sh')),
    },
    {
      label: '.claude/settings.json installed',
      pass: () => fs.existsSync(path.join(targetDir, '.claude', 'settings.json')),
    },
    {
      label: 'CLAUDE.md has reagent block',
      pass: () => {
        const p = path.join(targetDir, 'CLAUDE.md');
        if (!fs.existsSync(p)) return false;
        return fs.readFileSync(p, 'utf8').includes('<!-- reagent-managed:start -->');
      },
    },
    {
      label: '.reagent/policy.yaml installed',
      pass: () => fs.existsSync(path.join(targetDir, '.reagent', 'policy.yaml')),
    },
    {
      label: '.gitignore has .claude/agents/',
      pass: () => gitignoreHasEntry(targetDir, '.claude/agents/'),
    },
    {
      label: '.claude/commands/restart.md installed',
      pass: () => fs.existsSync(path.join(targetDir, '.claude', 'commands', 'restart.md')),
    },
    {
      label: '.claude/commands/rea.md installed',
      pass: () => fs.existsSync(path.join(targetDir, '.claude', 'commands', 'rea.md')),
    },
  ];

  let allPass = true;
  checks.forEach(({ label, pass }) => {
    const ok = pass();
    console.log(`  ${ok ? '✓' : '✗'} ${label}`);
    if (!ok) allPass = false;
  });

  // Check HALT status
  const haltFile = path.join(targetDir, '.reagent', 'HALT');
  if (fs.existsSync(haltFile)) {
    const reason = fs.readFileSync(haltFile, 'utf8').trim();
    console.log(`\n  ⚠ HALT ACTIVE: ${reason}`);
    console.log(`  Run 'reagent unfreeze' to resume agent operations.`);
  }

  console.log('');
  if (allPass) {
    console.log('All checks passed.');
  } else {
    console.log('Some checks failed. Run: npx @bookedsolid/reagent init');
    process.exit(1);
  }
}
