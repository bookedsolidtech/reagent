#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── Paths ──────────────────────────────────────────────────────────────────────

const PKG_ROOT = path.join(__dirname, '..');

// ── CLI routing ────────────────────────────────────────────────────────────────

const [,, cmd, ...rest] = process.argv;

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  printHelp();
  process.exit(0);
}

if (cmd === 'init') {
  runInit(rest);
} else if (cmd === 'check') {
  runCheck(rest);
} else {
  console.error(`\nUnknown command: ${cmd}`);
  printHelp();
  process.exit(1);
}

// ── Commands ───────────────────────────────────────────────────────────────────

function runInit(args) {
  const profileName = parseFlag(args, '--profile') || 'client-engagement';
  const targetDir = process.cwd();
  const dryRun = args.includes('--dry-run');

  console.log(`\n@bookedsolid/reagent init`);
  console.log(`  Profile: ${profileName}`);
  console.log(`  Target:  ${targetDir}`);
  if (dryRun) console.log(`  Mode:    dry-run (no changes written)`);
  console.log('');

  // Load profile
  const profilePath = path.join(PKG_ROOT, 'profiles', `${profileName}.json`);
  if (!fs.existsSync(profilePath)) {
    const available = fs.readdirSync(path.join(PKG_ROOT, 'profiles'))
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
    console.error(`Profile not found: ${profileName}`);
    console.error(`Available profiles: ${available.join(', ')}`);
    process.exit(1);
  }
  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));

  const results = [];

  // ── Step 1: .gitignore entries ─────────────────────────────────────────────
  if (profile.gitignoreEntries?.length) {
    const r = installGitignoreEntries(targetDir, profile.gitignoreEntries, dryRun);
    results.push(...r);
  }

  // ── Step 2: Cursor rules ───────────────────────────────────────────────────
  if (profile.cursorRules?.length) {
    const r = installCursorRules(targetDir, profile.cursorRules, dryRun);
    results.push(...r);
  }

  // ── Step 3: Husky commit-msg hook ──────────────────────────────────────────
  if (profile.huskyCommitMsg) {
    const r = installCommitMsgHook(targetDir, dryRun);
    results.push(...r);
  }

  // ── Step 4: Claude hooks + settings.json ──────────────────────────────────
  if (profile.claudeHooks) {
    const r = installClaudeHooks(targetDir, profile.claudeHooks, dryRun);
    results.push(...r);
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('');
  const installed = results.filter(r => r.status === 'installed');
  const updated   = results.filter(r => r.status === 'updated');
  const skipped   = results.filter(r => r.status === 'skipped');

  if (installed.length) {
    console.log('Installed:');
    installed.forEach(r => console.log(`  + ${r.file}`));
  }
  if (updated.length) {
    console.log('Updated:');
    updated.forEach(r => console.log(`  ~ ${r.file}`));
  }
  if (skipped.length) {
    console.log('Already up-to-date:');
    skipped.forEach(r => console.log(`  = ${r.file}`));
  }

  if (!dryRun) {
    console.log('\n✓ reagent init complete');
    console.log('\nNext steps:');
    console.log('  Commit to repo (safe to commit):');
    console.log('    git add .cursor/rules/ .husky/commit-msg && git commit -m "chore: add reagent zero-trust config"');
    console.log('');
    console.log('  Do NOT commit (gitignored — stays on your machine):');
    console.log('    .claude/hooks/');
    console.log('    .claude/settings.json');
    console.log('    .claude/agents/');
    console.log('');
    console.log('  Test attribution stripping:');
    console.log('    git commit --allow-empty -m "test\\n\\nCo-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"');
    console.log('    git log -1 --format="%B" | grep "Co-Authored"  # should return nothing');
    console.log('');
  }
}

function runCheck(args) {
  const targetDir = process.cwd();
  console.log(`\n@bookedsolid/reagent check`);
  console.log(`  Target: ${targetDir}\n`);

  const checks = [
    {
      label: '.cursor/rules/ installed',
      pass: () => fs.existsSync(path.join(targetDir, '.cursor', 'rules', '001-no-hallucination.mdc')),
    },
    {
      label: '.husky/commit-msg installed',
      pass: () => fs.existsSync(path.join(targetDir, '.husky', 'commit-msg')),
    },
    {
      label: '.git/hooks/commit-msg installed (fallback)',
      pass: () => fs.existsSync(path.join(targetDir, '.git', 'hooks', 'commit-msg')),
    },
    {
      label: '.claude/hooks/ installed',
      pass: () => fs.existsSync(path.join(targetDir, '.claude', 'hooks', 'dangerous-bash-interceptor.sh')),
    },
    {
      label: '.claude/settings.json installed',
      pass: () => fs.existsSync(path.join(targetDir, '.claude', 'settings.json')),
    },
    {
      label: '.gitignore has .claude/agents/',
      pass: () => gitignoreHasEntry(targetDir, '.claude/agents/'),
    },
  ];

  let allPass = true;
  checks.forEach(({ label, pass }) => {
    const ok = pass();
    console.log(`  ${ok ? '✓' : '✗'} ${label}`);
    if (!ok) allPass = false;
  });

  console.log('');
  if (allPass) {
    console.log('All checks passed.');
  } else {
    console.log('Some checks failed. Run: npx @bookedsolid/reagent init');
    process.exit(1);
  }
}

// ── Installation helpers ───────────────────────────────────────────────────────

function installGitignoreEntries(targetDir, entries, dryRun) {
  const gitignorePath = path.join(targetDir, '.gitignore');
  let current = '';
  if (fs.existsSync(gitignorePath)) {
    current = fs.readFileSync(gitignorePath, 'utf8');
  }

  const missing = entries.filter(e => !gitignoreHasEntry(targetDir, e));

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

function installCursorRules(targetDir, ruleNames, dryRun) {
  const rulesDir = path.join(targetDir, '.cursor', 'rules');
  if (!dryRun) {
    fs.mkdirSync(rulesDir, { recursive: true });
  }

  const results = [];
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

function installCommitMsgHook(targetDir, dryRun) {
  const srcFile = path.join(PKG_ROOT, 'husky', 'commit-msg.sh');
  const huskyDir = path.join(targetDir, '.husky');
  const huskyHook = path.join(huskyDir, 'commit-msg');
  const gitHooksDir = path.join(targetDir, '.git', 'hooks');
  const gitHook = path.join(gitHooksDir, 'commit-msg');

  const srcContent = fs.readFileSync(srcFile, 'utf8');
  const results = [];

  // Install to .husky/commit-msg (committed to repo)
  if (!dryRun) {
    fs.mkdirSync(huskyDir, { recursive: true });
  }

  const huskyExists = fs.existsSync(huskyHook);
  const hussySame = huskyExists && fs.readFileSync(huskyHook, 'utf8') === srcContent;

  if (!hussySame && !dryRun) {
    fs.writeFileSync(huskyHook, srcContent, { mode: 0o755 });
  }
  results.push({
    file: '.husky/commit-msg',
    status: hussySame ? 'skipped' : huskyExists ? 'updated' : 'installed',
  });

  // Also install directly to .git/hooks/commit-msg (works without node_modules)
  const gitHooksExists = fs.existsSync(gitHooksDir);
  if (gitHooksExists) {
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

  // If there's a package.json with husky, ensure prepare script exists
  const pkgJsonPath = path.join(targetDir, 'package.json');
  if (fs.existsSync(pkgJsonPath) && !dryRun) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
      const scripts = pkg.scripts || {};
      if (!scripts.prepare || !scripts.prepare.includes('husky')) {
        scripts.prepare = scripts.prepare
          ? `${scripts.prepare} && husky`
          : 'husky';
        pkg.scripts = scripts;

        const devDeps = pkg.devDependencies || {};
        if (!devDeps.husky) {
          devDeps.husky = '^9.1.7';
          pkg.devDependencies = devDeps;
        }

        fs.writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2) + '\n');
        results.push({ file: 'package.json (added husky)', status: 'updated' });
      }
    } catch (e) {
      // Non-fatal: package.json may not be valid JSON
    }
  }

  return results;
}

function installClaudeHooks(targetDir, hooksConfig, dryRun) {
  const claudeHooksDir = path.join(targetDir, '.claude', 'hooks');
  if (!dryRun) {
    fs.mkdirSync(claudeHooksDir, { recursive: true });
  }

  const results = [];
  const allHookNames = new Set();

  // Collect all hook names from all matchers
  const allHookEntries = [
    ...(hooksConfig.PreToolUse || []),
    ...(hooksConfig.PostToolUse || []),
  ];
  for (const entry of allHookEntries) {
    for (const hookName of (entry.hooks || [])) {
      allHookNames.add(hookName);
    }
  }

  // Copy hooks that exist in the package
  for (const hookName of allHookNames) {
    const srcFile = path.join(PKG_ROOT, 'hooks', `${hookName}.sh`);
    const destFile = path.join(claudeHooksDir, `${hookName}.sh`);

    if (!fs.existsSync(srcFile)) {
      // Hook not in package (e.g., BST-internal hooks like lint-after-edit)
      // Skip silently — these will already exist in the target repo's .claude/hooks/
      continue;
    }

    const srcContent = fs.readFileSync(srcFile, 'utf8');
    const exists = fs.existsSync(destFile);
    const same = exists && fs.readFileSync(destFile, 'utf8') === srcContent;

    if (!same && !dryRun) {
      fs.writeFileSync(destFile, srcContent, { mode: 0o755 });
    }

    results.push({
      file: `.claude/hooks/${hookName}.sh`,
      status: same ? 'skipped' : exists ? 'updated' : 'installed',
    });
  }

  // Write settings.json
  const settingsPath = path.join(targetDir, '.claude', 'settings.json');

  const settings = buildSettingsJson(hooksConfig, allHookNames);
  const settingsContent = JSON.stringify(settings, null, 2) + '\n';

  const settingsExists = fs.existsSync(settingsPath);
  const settingsSame = settingsExists && fs.readFileSync(settingsPath, 'utf8') === settingsContent;

  if (!settingsSame && !dryRun) {
    fs.writeFileSync(settingsPath, settingsContent);
  }

  results.push({
    file: '.claude/settings.json',
    status: settingsSame ? 'skipped' : settingsExists ? 'updated' : 'installed',
  });

  return results;
}

function buildSettingsJson(hooksConfig, installedHookNames) {
  const settings = {
    env: {
      ENABLE_TOOL_SEARCH: 'auto:5',
    },
    hooks: {},
  };

  function buildHookEntries(entries) {
    const result = [];
    for (const entry of entries) {
      const availableHooks = entry.hooks.filter(h => {
        // Include hooks that are in the package OR that might already exist in the target
        return true;
      });
      if (!availableHooks.length) continue;

      result.push({
        matcher: entry.matcher,
        hooks: availableHooks.map(hookName => ({
          type: 'command',
          command: `"$CLAUDE_PROJECT_DIR"/.claude/hooks/${hookName}.sh`,
          timeout: getHookTimeout(hookName),
          statusMessage: getHookStatusMessage(hookName),
        })),
      });
    }
    return result;
  }

  if (hooksConfig.PreToolUse?.length) {
    // Merge entries with the same matcher
    const merged = mergeByMatcher(hooksConfig.PreToolUse);
    settings.hooks.PreToolUse = buildHookEntries(merged);
  }

  if (hooksConfig.PostToolUse?.length) {
    const merged = mergeByMatcher(hooksConfig.PostToolUse);
    settings.hooks.PostToolUse = buildHookEntries(merged);
  }

  return settings;
}

function mergeByMatcher(entries) {
  const map = new Map();
  for (const entry of entries) {
    if (map.has(entry.matcher)) {
      map.get(entry.matcher).hooks.push(...entry.hooks);
    } else {
      map.set(entry.matcher, { matcher: entry.matcher, hooks: [...entry.hooks] });
    }
  }
  return Array.from(map.values());
}

function getHookTimeout(hookName) {
  const timeouts = {
    'secret-scanner': 15000,
    'type-check-after-edit': 60000,
    'lint-after-edit': 15000,
    'any-type-detector': 10000,
    'dangerous-bash-interceptor': 10000,
    'env-file-protection': 5000,
    'attribution-advisory': 5000,
  };
  return timeouts[hookName] || 10000;
}

function getHookStatusMessage(hookName) {
  const messages = {
    'dangerous-bash-interceptor': 'Checking command safety...',
    'env-file-protection': 'Checking for .env file reads...',
    'secret-scanner': 'Scanning for credentials...',
    'attribution-advisory': 'Checking for AI attribution...',
    'lint-after-edit': 'Linting edited file...',
    'type-check-after-edit': 'Type-checking edited file...',
    'any-type-detector': "Checking for 'any' type violations...",
  };
  return messages[hookName] || `Running ${hookName}...`;
}

// ── Utility functions ──────────────────────────────────────────────────────────

function parseFlag(args, flag) {
  const eqForm = args.find(a => a.startsWith(`${flag}=`));
  if (eqForm) return eqForm.split('=').slice(1).join('=');
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--')) {
    return args[idx + 1];
  }
  return null;
}

function gitignoreHasEntry(targetDir, entry) {
  const gitignorePath = path.join(targetDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) return false;
  const content = fs.readFileSync(gitignorePath, 'utf8');
  return content.split('\n').some(line => line.trim() === entry.trim());
}

function printHelp() {
  console.log(`
@bookedsolid/reagent — zero-trust agentic infrastructure

Usage:
  npx @bookedsolid/reagent <command> [options]

Commands:
  init     Install reagent config into the current directory
  check    Check what reagent components are installed
  help     Show this help

Options for init:
  --profile <name>    Profile to install (default: client-engagement)
  --dry-run           Preview what would be installed without writing files

Available profiles:
  client-engagement   Zero-trust setup for client engagements (default)
  bst-internal        BST internal project setup

Examples:
  npx @bookedsolid/reagent init
  npx @bookedsolid/reagent init --profile bst-internal
  npx @bookedsolid/reagent init --dry-run
  npx @bookedsolid/reagent check
`);
}
