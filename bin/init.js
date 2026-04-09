#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

// ── Package metadata ─────────────────────────────────────────────────────────

const PKG_ROOT = path.join(__dirname, '..');
const PKG_VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')).version;
  } catch {
    return '0.0.0';
  }
})();

// ── CLI routing ──────────────────────────────────────────────────────────────

const [, , cmd, ...rest] = process.argv;

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  printHelp();
  process.exit(0);
}

if (cmd === 'init') {
  runInit(rest);
} else if (cmd === 'check') {
  runCheck(rest);
} else if (cmd === 'freeze') {
  runFreeze(rest);
} else if (cmd === 'unfreeze') {
  runUnfreeze(rest);
} else {
  console.error(`\nUnknown command: ${cmd}`);
  printHelp();
  process.exit(1);
}

// ── Commands ─────────────────────────────────────────────────────────────────

function runInit(args) {
  const profileName = parseFlag(args, '--profile') || 'client-engagement';
  const targetDir = process.cwd();
  const dryRun = args.includes('--dry-run');

  console.log(`\n@bookedsolid/reagent v${PKG_VERSION} init`);
  console.log(`  Profile: ${profileName}`);
  console.log(`  Target:  ${targetDir}`);
  if (dryRun) console.log(`  Mode:    dry-run (no changes written)`);
  console.log('');

  // Load profile — validate name to prevent path traversal
  if (!/^[a-z0-9][a-z0-9-]*$/.test(profileName)) {
    console.error(
      `Invalid profile name: "${profileName}" (only lowercase letters, numbers, hyphens allowed)`
    );
    process.exit(1);
  }
  const profilesDir = path.join(PKG_ROOT, 'profiles');
  const profilePath = path.resolve(profilesDir, `${profileName}.json`);
  if (!profilePath.startsWith(profilesDir + path.sep)) {
    console.error(`Invalid profile name: "${profileName}" (path traversal detected)`);
    process.exit(1);
  }
  if (!fs.existsSync(profilePath)) {
    const available = fs
      .readdirSync(path.join(PKG_ROOT, 'profiles'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace('.json', ''));
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
    const r = installHuskyHook(targetDir, 'commit-msg', 'commit-msg.sh', dryRun);
    results.push(...r);
  }

  // ── Step 4: Husky pre-commit hook ─────────────────────────────────────────
  if (profile.huskyPreCommit) {
    const r = installHuskyHook(targetDir, 'pre-commit', 'pre-commit.sh', dryRun);
    results.push(...r);
  }

  // ── Step 5: Husky pre-push hook ───────────────────────────────────────────
  if (profile.huskyPrePush) {
    const r = installHuskyHook(targetDir, 'pre-push', 'pre-push.sh', dryRun);
    results.push(...r);
  }

  // ── Step 6: Claude hooks + settings.json ──────────────────────────────────
  if (profile.claudeHooks) {
    const r = installClaudeHooks(targetDir, profile.claudeHooks, dryRun);
    results.push(...r);
  }

  // ── Step 7: CLAUDE.md ─────────────────────────────────────────────────────
  if (profile.claudeMd) {
    const r = installClaudeMd(targetDir, profile.claudeMd, profileName, dryRun);
    results.push(...r);
  }

  // ── Step 8: .reagent/policy.yaml ──────────────────────────────────────────
  const r = installPolicy(targetDir, profileName, dryRun);
  results.push(...r);

  // ── Step 9: Orchestrator agent ────────────────────────────────────────────
  const ra = installOrchestratorAgent(targetDir, dryRun);
  results.push(...ra);

  // ── Step 10: Claude commands (/restart, /rea) ───────────────────────────
  const rc = installClaudeCommands(targetDir, dryRun);
  results.push(...rc);

  // ── Summary ────────────────────────────────────────────────────────────────
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
    console.log('\n✓ reagent init complete');
    console.log('\nCommit these files (safe to commit):');
    console.log(
      '  git add .cursor/rules/ .husky/ .claude/commands/ CLAUDE.md .reagent/policy.yaml && git commit -m "chore: add reagent zero-trust config"'
    );
    console.log('');
    console.log('Do NOT commit (gitignored — stays on your machine):');
    console.log('  .claude/hooks/');
    console.log('  .claude/settings.json');
    console.log('  .claude/agents/');
    console.log('');
    console.log('Test attribution stripping:');
    console.log(
      '  git commit --allow-empty -m "test\\n\\nCo-Authored-By: Claude <noreply@anthropic.com>"'
    );
    console.log('  git log -1 --format="%B" | grep "Co-Authored"  # should return nothing');
    console.log('');
    console.log('Test kill switch:');
    console.log('  reagent freeze --reason "testing"');
    console.log('  reagent unfreeze');
    console.log('');
  }
}

function runCheck(_args) {
  const targetDir = process.cwd();
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

function runFreeze(args) {
  const targetDir = process.cwd();
  const rawReason =
    parseFlag(args, '--reason') || args.find((a) => !a.startsWith('--')) || 'Manual freeze';
  // Strip control characters (terminal escape injection defense)
  const reason = rawReason.replace(/[\x00-\x1f\x7f]/g, '');

  const reagentDir = path.join(targetDir, '.reagent');
  const haltFile = path.join(reagentDir, 'HALT');

  if (!fs.existsSync(reagentDir)) {
    fs.mkdirSync(reagentDir, { recursive: true });
  }

  const timestamp = new Date().toISOString();
  const content = `${reason} (frozen at ${timestamp})`;
  fs.writeFileSync(haltFile, content, 'utf8');

  console.log(`\nREAGENT FROZEN`);
  console.log(`  Reason:  ${reason}`);
  console.log(`  File:    .reagent/HALT`);
  console.log(`  Effect:  All PreToolUse hooks will exit 2 — agent operations blocked.`);
  console.log(`\n  To resume: reagent unfreeze`);
  console.log('');
}

function runUnfreeze(_args) {
  const targetDir = process.cwd();
  const haltFile = path.join(targetDir, '.reagent', 'HALT');

  if (!fs.existsSync(haltFile)) {
    console.log('\nNot frozen — no .reagent/HALT file found.\n');
    return;
  }

  fs.unlinkSync(haltFile);
  console.log('\nREAGENT UNFROZEN');
  console.log('  .reagent/HALT removed — agent operations resumed.\n');
}

// ── Installation helpers ──────────────────────────────────────────────────────

function installGitignoreEntries(targetDir, entries, dryRun) {
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

function installHuskyHook(targetDir, hookName, srcFileName, dryRun) {
  const srcFile = path.join(PKG_ROOT, 'husky', srcFileName);
  const huskyDir = path.join(targetDir, '.husky');
  const huskyHook = path.join(huskyDir, hookName);

  if (!fs.existsSync(srcFile)) {
    console.error(`  ERROR: husky hook source not found in package: husky/${srcFileName}`);
    return [{ file: `.husky/${hookName}`, status: 'warn' }];
  }

  const srcContent = fs.readFileSync(srcFile, 'utf8');
  const results = [];

  if (!dryRun) {
    fs.mkdirSync(huskyDir, { recursive: true });
  }

  const huskyExists = fs.existsSync(huskyHook);
  const hussySame = huskyExists && fs.readFileSync(huskyHook, 'utf8') === srcContent;

  if (!hussySame && !dryRun) {
    fs.writeFileSync(huskyHook, srcContent, { mode: 0o755 });
  }
  results.push({
    file: `.husky/${hookName}`,
    status: hussySame ? 'skipped' : huskyExists ? 'updated' : 'installed',
  });

  // For commit-msg: also install to .git/hooks/ as fallback (works without node_modules)
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
        console.warn(`  Warning: Could not update package.json: ${err.message}`);
      }
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
  const installedHookNames = new Set();

  // Collect all hook names from all matchers
  const allHookEntries = [...(hooksConfig.PreToolUse || []), ...(hooksConfig.PostToolUse || [])];
  for (const entry of allHookEntries) {
    for (const hookName of entry.hooks || []) {
      const srcFile = path.join(PKG_ROOT, 'hooks', `${hookName}.sh`);

      if (!fs.existsSync(srcFile)) {
        // LOUDLY warn: hook referenced in profile does not exist in package
        console.error(
          `  ERROR: Hook '${hookName}' referenced in profile but not found in package.`
        );
        console.error(`         Skipping — will NOT be written to .claude/settings.json.`);
        results.push({
          file: `.claude/hooks/${hookName}.sh (MISSING — not installed)`,
          status: 'warn',
        });
        continue;
      }

      installedHookNames.add(hookName);

      const srcContent = fs.readFileSync(srcFile, 'utf8');
      const destFile = path.join(claudeHooksDir, `${hookName}.sh`);
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
  }

  // Write settings.json with ONLY hooks that actually exist
  const settingsPath = path.join(targetDir, '.claude', 'settings.json');
  const settings = buildSettingsJson(hooksConfig, installedHookNames);
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

function installClaudeMd(targetDir, claudeMdConfig, profileName, dryRun) {
  const claudeMdPath = path.join(targetDir, 'CLAUDE.md');
  const templatePath = path.join(PKG_ROOT, 'templates', 'CLAUDE.md');

  if (!fs.existsSync(templatePath)) {
    console.error('  ERROR: templates/CLAUDE.md not found in package.');
    return [{ file: 'CLAUDE.md', status: 'warn' }];
  }

  let template = fs.readFileSync(templatePath, 'utf8');

  // Sanitize profile values to prevent template double-substitution
  const safe = (val) => String(val).replace(/\{\{[^}]*\}\}/g, '');

  // Interpolate profile-specific values
  template = template
    .replace(/\{\{VERSION\}\}/g, PKG_VERSION)
    .replace(/\{\{PREFLIGHT_CMD\}\}/g, safe(claudeMdConfig.preflightCmd || 'pnpm preflight'))
    .replace(
      /\{\{ATTRIBUTION_RULE\}\}/g,
      safe(
        claudeMdConfig.attributionRule || 'Do not include AI attribution in client-facing content.'
      )
    );

  const MARKER_START = '<!-- reagent-managed:start -->';
  const MARKER_END = '<!-- reagent-managed:end -->';

  const existingContent = fs.existsSync(claudeMdPath) ? fs.readFileSync(claudeMdPath, 'utf8') : '';

  // Check if reagent block already exists
  const hasBlock = existingContent.includes(MARKER_START);

  let newContent;
  if (hasBlock) {
    const startIdx = existingContent.indexOf(MARKER_START);
    const endIdx = existingContent.indexOf(MARKER_END);
    if (endIdx === -1) {
      // Orphaned start marker — strip it, prepend fresh block
      const stripped = (
        existingContent.slice(0, startIdx) + existingContent.slice(startIdx + MARKER_START.length)
      ).trim();
      newContent = stripped ? template.trimEnd() + '\n\n' + stripped.trimStart() : template;
    } else {
      // Remove old block entirely, prepend new template
      const endAfter = endIdx + MARKER_END.length;
      const withoutBlock = (
        existingContent.slice(0, startIdx) + existingContent.slice(endAfter)
      ).trim();
      newContent = withoutBlock ? template.trimEnd() + '\n\n' + withoutBlock.trimStart() : template;
    }
  } else {
    // Prepend to existing CLAUDE.md (or create new)
    newContent = existingContent
      ? template.trimEnd() + '\n\n' + existingContent.trimStart()
      : template;
  }

  const same = existingContent === newContent;
  if (!same && !dryRun) {
    fs.writeFileSync(claudeMdPath, newContent, 'utf8');
  }

  return [
    {
      file: 'CLAUDE.md',
      status: same ? 'skipped' : existingContent ? 'updated' : 'installed',
    },
  ];
}

function installPolicy(targetDir, profileName, dryRun) {
  const reagentDir = path.join(targetDir, '.reagent');
  const policyPath = path.join(reagentDir, 'policy.yaml');

  if (fs.existsSync(policyPath)) {
    return [{ file: '.reagent/policy.yaml', status: 'skipped' }];
  }

  if (!dryRun) {
    fs.mkdirSync(reagentDir, { recursive: true });
    const now = new Date().toISOString();
    const content = `# .reagent/policy.yaml — generated by @bookedsolid/reagent v${PKG_VERSION}
# Commit this file. Edit autonomy_level and max_autonomy_level as needed.
# Run 'reagent freeze --reason "..."' to halt all agent operations.

version: "1"
profile: "${profileName}"
installed_by: "reagent@${PKG_VERSION}"
installed_at: "${now}"

# Autonomy levels:
#   L0 — Read-only; every write requires explicit user approval
#   L1 — Writes allowed to non-blocked paths; destructive operations blocked
#   L2 — Writes + PR creation allowed; destructive tier blocked
#   L3 — All writes allowed; advisory on anomalous patterns
autonomy_level: L1
max_autonomy_level: L2

# Human must approve any autonomy level increase
promotion_requires_human_approval: true

# Paths hooks and agents must never modify
blocked_paths:
  - ".reagent/"
  - ".github/workflows/"
  - ".env"
  - ".env.*"

# Optional: Discord webhook for halt/promote notifications
notification_channel: ""
`;
    fs.writeFileSync(policyPath, content, 'utf8');
  }

  return [{ file: '.reagent/policy.yaml', status: 'installed' }];
}

function installOrchestratorAgent(targetDir, dryRun) {
  const agentsSrcDir = path.join(PKG_ROOT, 'agents');
  const agentsDestDir = path.join(targetDir, '.claude', 'agents');
  const srcFile = path.join(agentsSrcDir, 'reagent-orchestrator.md');
  const destFile = path.join(agentsDestDir, 'reagent-orchestrator.md');

  if (!fs.existsSync(srcFile)) {
    return [{ file: '.claude/agents/reagent-orchestrator.md (MISSING)', status: 'warn' }];
  }

  if (!dryRun) {
    fs.mkdirSync(agentsDestDir, { recursive: true });
  }

  const srcContent = fs.readFileSync(srcFile, 'utf8');
  const exists = fs.existsSync(destFile);
  const same = exists && fs.readFileSync(destFile, 'utf8') === srcContent;

  if (!same && !dryRun) {
    fs.writeFileSync(destFile, srcContent, 'utf8');
  }

  return [
    {
      file: '.claude/agents/reagent-orchestrator.md',
      status: same ? 'skipped' : exists ? 'updated' : 'installed',
    },
  ];
}

function installClaudeCommands(targetDir, dryRun) {
  const commandsSrcDir = path.join(PKG_ROOT, 'commands');
  const commandsDestDir = path.join(targetDir, '.claude', 'commands');

  if (!fs.existsSync(commandsSrcDir)) {
    return [];
  }

  if (!dryRun) {
    fs.mkdirSync(commandsDestDir, { recursive: true });
  }

  const results = [];
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
      // Only include hooks that were actually installed (exist in package)
      const availableHooks = entry.hooks.filter((h) => installedHookNames.has(h));
      if (!availableHooks.length) continue;

      result.push({
        matcher: entry.matcher,
        hooks: availableHooks.map((hookName) => ({
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
    const merged = mergeByMatcher(hooksConfig.PreToolUse);
    const entries = buildHookEntries(merged);
    if (entries.length) settings.hooks.PreToolUse = entries;
  }

  if (hooksConfig.PostToolUse?.length) {
    const merged = mergeByMatcher(hooksConfig.PostToolUse);
    const entries = buildHookEntries(merged);
    if (entries.length) settings.hooks.PostToolUse = entries;
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
  };
  return messages[hookName] || `Running ${hookName}...`;
}

// ── Utility functions ─────────────────────────────────────────────────────────

function parseFlag(args, flag) {
  const eqForm = args.find((a) => a.startsWith(`${flag}=`));
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
  return content.split('\n').some((line) => line.trim() === entry.trim());
}

function printHelp() {
  console.log(`
@bookedsolid/reagent v${PKG_VERSION} — zero-trust agentic infrastructure

Usage:
  npx @bookedsolid/reagent <command> [options]

Commands:
  init       Install reagent config into the current directory
  check      Check what reagent components are installed
  freeze     Create .reagent/HALT to suspend all agent operations
  unfreeze   Remove .reagent/HALT to resume agent operations
  help       Show this help

Options for init:
  --profile <name>    Profile to install (default: client-engagement)
  --dry-run           Preview what would be installed without writing files

Options for freeze:
  --reason <text>     Reason for freeze (stored in HALT file)

Available profiles:
  client-engagement   Zero-trust setup for client engagements (default)
  bst-internal        BST internal project setup

Examples:
  npx @bookedsolid/reagent init
  npx @bookedsolid/reagent init --profile bst-internal
  npx @bookedsolid/reagent init --dry-run
  npx @bookedsolid/reagent check
  npx @bookedsolid/reagent freeze --reason "security incident"
  npx @bookedsolid/reagent unfreeze
`);
}
