import fs from 'node:fs';
import path from 'node:path';
import { PKG_ROOT, getPkgVersion, parseFlag, gitignoreHasEntry } from '../utils.js';

interface InstallResult {
  file: string;
  status: 'installed' | 'updated' | 'skipped' | 'warn';
}

export function runInit(args: string[]): void {
  const profileName = parseFlag(args, '--profile') || 'client-engagement';
  const targetDir = process.cwd();
  const dryRun = args.includes('--dry-run');
  const PKG_VERSION = getPkgVersion();

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

  const results: InstallResult[] = [];

  // Step 1: .gitignore entries
  if (profile.gitignoreEntries?.length) {
    results.push(...installGitignoreEntries(targetDir, profile.gitignoreEntries, dryRun));
  }

  // Step 2: Cursor rules
  if (profile.cursorRules?.length) {
    results.push(...installCursorRules(targetDir, profile.cursorRules, dryRun));
  }

  // Step 3-5: Husky hooks
  if (profile.huskyCommitMsg) {
    results.push(...installHuskyHook(targetDir, 'commit-msg', 'commit-msg.sh', dryRun));
  }
  if (profile.huskyPreCommit) {
    results.push(...installHuskyHook(targetDir, 'pre-commit', 'pre-commit.sh', dryRun));
  }
  if (profile.huskyPrePush) {
    results.push(...installHuskyHook(targetDir, 'pre-push', 'pre-push.sh', dryRun));
  }

  // Step 6: Claude hooks
  if (profile.claudeHooks) {
    results.push(...installClaudeHooks(targetDir, profile.claudeHooks, dryRun));
  }

  // Step 7: CLAUDE.md
  if (profile.claudeMd) {
    results.push(...installClaudeMd(targetDir, profile.claudeMd, dryRun));
  }

  // Step 8: Policy
  results.push(...installPolicy(targetDir, profileName, profile, dryRun));

  // Step 9: Gateway config
  results.push(...installGatewayConfig(targetDir, dryRun));

  // Step 10: Agent team
  results.push(...installAgents(targetDir, dryRun));

  // Step 11: Claude commands
  results.push(...installClaudeCommands(targetDir, dryRun));

  // Summary
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
      '  git add .cursor/rules/ .husky/ .claude/commands/ CLAUDE.md .reagent/policy.yaml .reagent/gateway.yaml && git commit -m "chore: add reagent zero-trust config"'
    );
    console.log('');
    console.log('Do NOT commit (gitignored — stays on your machine):');
    console.log('  .claude/hooks/');
    console.log('  .claude/settings.json');
    console.log('  .claude/agents/');
    console.log('');
    console.log('Test kill switch:');
    console.log('  reagent freeze --reason "testing"');
    console.log('  reagent unfreeze');
    console.log('');
  }
}

// ── Installation helpers ──────────────────────────────────────────────────────

function installGitignoreEntries(
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

function installCursorRules(
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

interface HookEntry {
  matcher: string;
  hooks: string[];
}

interface HooksConfig {
  PreToolUse?: HookEntry[];
  PostToolUse?: HookEntry[];
}

interface ClaudeMdConfig {
  preflightCmd?: string;
  attributionRule?: string;
}

function installHuskyHook(
  targetDir: string,
  hookName: string,
  srcFileName: string,
  dryRun: boolean
): InstallResult[] {
  const srcFile = path.join(PKG_ROOT, 'husky', srcFileName);
  const huskyDir = path.join(targetDir, '.husky');
  const huskyHook = path.join(huskyDir, hookName);

  if (!fs.existsSync(srcFile)) {
    console.error(`  ERROR: husky hook source not found in package: husky/${srcFileName}`);
    return [{ file: `.husky/${hookName}`, status: 'warn' }];
  }

  const srcContent = fs.readFileSync(srcFile, 'utf8');
  const results: InstallResult[] = [];

  if (!dryRun) {
    fs.mkdirSync(huskyDir, { recursive: true });
  }

  const huskyExists = fs.existsSync(huskyHook);
  const huskySame = huskyExists && fs.readFileSync(huskyHook, 'utf8') === srcContent;

  if (!huskySame && !dryRun) {
    fs.writeFileSync(huskyHook, srcContent, { mode: 0o755 });
  }
  results.push({
    file: `.husky/${hookName}`,
    status: huskySame ? 'skipped' : huskyExists ? 'updated' : 'installed',
  });

  // For commit-msg: also install to .git/hooks/ as fallback
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
        console.warn(`  Warning: Could not update package.json: ${(err as Error).message}`);
      }
    }
  }

  return results;
}

function installClaudeHooks(
  targetDir: string,
  hooksConfig: HooksConfig,
  dryRun: boolean
): InstallResult[] {
  const claudeHooksDir = path.join(targetDir, '.claude', 'hooks');
  if (!dryRun) {
    fs.mkdirSync(claudeHooksDir, { recursive: true });
  }

  const results: InstallResult[] = [];
  const installedHookNames = new Set<string>();

  const allHookEntries = [...(hooksConfig.PreToolUse || []), ...(hooksConfig.PostToolUse || [])];
  for (const entry of allHookEntries) {
    for (const hookName of entry.hooks || []) {
      const srcFile = path.join(PKG_ROOT, 'hooks', `${hookName}.sh`);

      if (!fs.existsSync(srcFile)) {
        console.error(
          `  ERROR: Hook '${hookName}' referenced in profile but not found in package.`
        );
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

  // Write settings.json
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

function installClaudeMd(
  targetDir: string,
  claudeMdConfig: ClaudeMdConfig,
  dryRun: boolean
): InstallResult[] {
  const PKG_VERSION = getPkgVersion();
  const claudeMdPath = path.join(targetDir, 'CLAUDE.md');
  const templatePath = path.join(PKG_ROOT, 'templates', 'CLAUDE.md');

  if (!fs.existsSync(templatePath)) {
    console.error('  ERROR: templates/CLAUDE.md not found in package.');
    return [{ file: 'CLAUDE.md', status: 'warn' }];
  }

  let template = fs.readFileSync(templatePath, 'utf8');
  const safe = (val: string) => String(val).replace(/\{\{[^}]*\}\}/g, '');

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
  const hasBlock = existingContent.includes(MARKER_START);

  let newContent: string;
  if (hasBlock) {
    const startIdx = existingContent.indexOf(MARKER_START);
    const endIdx = existingContent.indexOf(MARKER_END);
    if (endIdx === -1) {
      const stripped = (
        existingContent.slice(0, startIdx) + existingContent.slice(startIdx + MARKER_START.length)
      ).trim();
      newContent = stripped ? template.trimEnd() + '\n\n' + stripped.trimStart() : template;
    } else {
      const endAfter = endIdx + MARKER_END.length;
      const withoutBlock = (
        existingContent.slice(0, startIdx) + existingContent.slice(endAfter)
      ).trim();
      newContent = withoutBlock ? template.trimEnd() + '\n\n' + withoutBlock.trimStart() : template;
    }
  } else {
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

interface ProfileConfig {
  blockAiAttribution?: boolean;
  blockedPaths?: string[];
  [key: string]: unknown;
}

function installPolicy(
  targetDir: string,
  profileName: string,
  profile: ProfileConfig,
  dryRun: boolean
): InstallResult[] {
  const PKG_VERSION = getPkgVersion();
  const reagentDir = path.join(targetDir, '.reagent');
  const policyPath = path.join(reagentDir, 'policy.yaml');

  if (fs.existsSync(policyPath)) {
    return [{ file: '.reagent/policy.yaml', status: 'skipped' }];
  }

  if (!dryRun) {
    fs.mkdirSync(reagentDir, { recursive: true });
    const now = new Date().toISOString();
    const blockAttribution = profile.blockAiAttribution === true;
    const blockedPaths = profile.blockedPaths ?? [
      '.reagent/',
      '.github/workflows/',
      '.env',
      '.env.*',
    ];
    const blockedPathsYaml = blockedPaths.length
      ? '\n' + blockedPaths.map((p: string) => `  - "${p}"`).join('\n')
      : ' []';
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

# Block AI attribution in commits and PRs (opt-in)
# When true, the commit-msg hook rejects commits containing AI attribution
# markers (Co-Authored-By, "Generated with [Tool]", etc.) and the
# attribution-advisory hook blocks gh pr create/edit commands with attribution.
# Casual mentions of AI tools in commit messages are still allowed.
block_ai_attribution: ${blockAttribution}

# Paths hooks and agents must never modify
blocked_paths:${blockedPathsYaml}

# Optional: Discord webhook for halt/promote notifications
notification_channel: ""
`;
    fs.writeFileSync(policyPath, content, 'utf8');
  }

  return [{ file: '.reagent/policy.yaml', status: 'installed' }];
}

function installGatewayConfig(targetDir: string, dryRun: boolean): InstallResult[] {
  const PKG_VERSION = getPkgVersion();
  const reagentDir = path.join(targetDir, '.reagent');
  const gatewayPath = path.join(reagentDir, 'gateway.yaml');

  // Idempotent: skip if gateway.yaml already exists
  if (fs.existsSync(gatewayPath)) {
    return [{ file: '.reagent/gateway.yaml', status: 'skipped' }];
  }

  if (!dryRun) {
    fs.mkdirSync(reagentDir, { recursive: true });
    const content = `# .reagent/gateway.yaml — generated by @bookedsolid/reagent v${PKG_VERSION}
# Defines downstream MCP servers that reagent proxies through its middleware chain.
#
# Usage:
#   reagent serve
#
# Each server entry spawns a child process and communicates over stdio MCP.
# Tool names are namespaced as: <server-name>__<tool-name>
#
# Tier classification (convention-based, overridable):
#   read:        get_*, list_*, search_*, query_*, read_*, fetch_*, check_*, health_*, describe_*, show_*, count_*
#   destructive: delete_*, drop_*, purge_*, remove_*, destroy_*, ban_*, kick_*, revoke_*, truncate_*
#   write:       everything else (default)

version: "1"

# To add a server, replace "servers: {}" with:
#
# servers:
#   my-server:
#     command: npx
#     args: ['-y', 'my-mcp-server@latest']
#     env:
#       API_KEY: '\${MY_API_KEY}'
#     tool_overrides:
#       dangerous_action:
#         tier: destructive
#       admin_delete:
#         tier: destructive
#         blocked: true

servers: {}
`;
    fs.writeFileSync(gatewayPath, content, 'utf8');
  }

  return [{ file: '.reagent/gateway.yaml', status: 'installed' }];
}

function installAgents(targetDir: string, dryRun: boolean): InstallResult[] {
  const agentsSrcDir = path.join(PKG_ROOT, 'agents');
  const agentsDestDir = path.join(targetDir, '.claude', 'agents');

  if (!fs.existsSync(agentsSrcDir)) {
    return [{ file: '.claude/agents/ (no agents directory in package)', status: 'warn' }];
  }

  if (!dryRun) {
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

function installClaudeCommands(targetDir: string, dryRun: boolean): InstallResult[] {
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

// ── Settings builder ──────────────────────────────────────────────────────────

function buildSettingsJson(
  hooksConfig: HooksConfig,
  installedHookNames: Set<string>
): Record<string, unknown> {
  const settings: Record<string, unknown> = {
    env: { ENABLE_TOOL_SEARCH: 'auto:5' },
    hooks: {} as Record<string, unknown>,
  };

  function buildHookEntries(entries: HookEntry[]) {
    const result = [];
    for (const entry of entries) {
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

  const hooks = settings.hooks as Record<string, unknown>;

  if (hooksConfig.PreToolUse?.length) {
    const merged = mergeByMatcher(hooksConfig.PreToolUse);
    const entries = buildHookEntries(merged);
    if (entries.length) hooks.PreToolUse = entries;
  }

  if (hooksConfig.PostToolUse?.length) {
    const merged = mergeByMatcher(hooksConfig.PostToolUse);
    const entries = buildHookEntries(merged);
    if (entries.length) hooks.PostToolUse = entries;
  }

  return settings;
}

function mergeByMatcher(entries: HookEntry[]): HookEntry[] {
  const map = new Map<string, HookEntry>();
  for (const entry of entries) {
    if (map.has(entry.matcher)) {
      map.get(entry.matcher)!.hooks.push(...entry.hooks);
    } else {
      map.set(entry.matcher, { matcher: entry.matcher, hooks: [...entry.hooks] });
    }
  }
  return Array.from(map.values());
}

function getHookTimeout(hookName: string): number {
  const timeouts: Record<string, number> = {
    'secret-scanner': 15000,
    'dangerous-bash-interceptor': 10000,
    'env-file-protection': 5000,
    'attribution-advisory': 5000,
  };
  return timeouts[hookName] || 10000;
}

function getHookStatusMessage(hookName: string): string {
  const messages: Record<string, string> = {
    'dangerous-bash-interceptor': 'Checking command safety...',
    'env-file-protection': 'Checking for .env file reads...',
    'secret-scanner': 'Scanning for credentials...',
    'attribution-advisory': 'Checking for AI attribution...',
  };
  return messages[hookName] || `Running ${hookName}...`;
}
