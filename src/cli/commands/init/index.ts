import fs from 'node:fs';
import path from 'node:path';
import { PKG_ROOT, getPkgVersion, parseFlag } from '../../utils.js';
import type { InstallResult, ProfileConfig } from './types.js';
import { installGitignoreEntries } from './gitignore.js';
import { installCursorRules } from './cursor-rules.js';
import { installHuskyHook } from './husky-hooks.js';
import { installClaudeHooks } from './claude-hooks.js';
import { installClaudeMd, detectPreflightCmd } from './claude-md.js';
import { installPolicy } from './policy.js';
import { installGatewayConfig, checkMcpDuplicates } from './gateway-config.js';
import { installMcpJson } from './mcp-config.js';
import { installAgents } from './agents.js';
import { installClaudeCommands } from './commands.js';
import { installPm } from './pm.js';
import { installPackageDep } from './package-dep.js';
import { installGitHub } from './github.js';
import { installProfile, listTechProfiles } from './profiles.js';
import { installDiscord, parseDiscordArgs } from './discord.js';
import { installObsidian, parseObsidianArgs } from './obsidian.js';

export function runInit(args: string[]): void {
  const profileName = parseFlag(args, '--profile') || 'client-engagement';
  const targetDir = process.cwd();
  const dryRun = args.includes('--dry-run');
  const withGitHub = args.includes('--github');
  const withDiscord = args.includes('--discord');
  const withObsidian = args.includes('--obsidian');
  const PKG_VERSION = getPkgVersion();
  // --preflight-cmd overrides lockfile detection; used to inject a custom preflight command
  const preflightCmdOverride = parseFlag(args, '--preflight-cmd');

  // Validate profile name format
  if (!/^[a-z0-9][a-z0-9-]*$/.test(profileName)) {
    console.error(
      `Invalid profile name: "${profileName}" (only lowercase letters, numbers, hyphens allowed)`
    );
    process.exit(1);
  }

  const profilesDir = path.join(PKG_ROOT, 'profiles');
  const techProfiles = listTechProfiles();
  const isTechProfile = techProfiles.includes(profileName);

  // Tech profiles layer on top of a base JSON profile.
  // --base-profile selects which base to use; defaults to client-engagement.
  const baseProfileName = isTechProfile
    ? parseFlag(args, '--base-profile') || 'client-engagement'
    : profileName;

  console.log(`\n@bookedsolid/reagent v${PKG_VERSION} init`);
  if (isTechProfile) {
    console.log(`  Profile: ${baseProfileName} + ${profileName}`);
  } else {
    console.log(`  Profile: ${profileName}`);
  }
  console.log(`  Target:  ${targetDir}`);
  if (dryRun) console.log(`  Mode:    dry-run (no changes written)`);
  console.log('');

  // Load base JSON profile — validate path to prevent traversal
  const profilePath = path.resolve(profilesDir, `${baseProfileName}.json`);
  if (!profilePath.startsWith(profilesDir + path.sep)) {
    console.error(`Invalid profile name: "${baseProfileName}" (path traversal detected)`);
    process.exit(1);
  }
  if (!fs.existsSync(profilePath)) {
    const availableJson = fs
      .readdirSync(profilesDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace('.json', ''));
    console.error(
      isTechProfile
        ? `Base profile not found: ${baseProfileName} (override with --base-profile)`
        : `Profile not found: ${baseProfileName}`
    );
    console.error(`Available base profiles: ${availableJson.join(', ')}`);
    console.error(`Available tech profiles: ${techProfiles.join(', ')}`);
    process.exit(1);
  }
  const profile: ProfileConfig = JSON.parse(fs.readFileSync(profilePath, 'utf8'));

  const results: InstallResult[] = [];

  // Ensure .claude/ base directory exists before any step tries to create subdirs within it
  if (!dryRun) {
    fs.mkdirSync(path.join(targetDir, '.claude'), { recursive: true });
  }

  // Step 0: Install @bookedsolid/reagent as devDependency (before MCP config needs node_modules)
  results.push(...installPackageDep(targetDir, dryRun));

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
    // Build env vars to inject into .claude/settings.json for hook configuration
    const hookEnv: Record<string, string> = {};
    const disclosureMode = profile.security?.disclosureMode ?? 'advisory';
    hookEnv['REAGENT_DISCLOSURE_MODE'] = disclosureMode;
    results.push(...installClaudeHooks(targetDir, profile.claudeHooks, dryRun, hookEnv));
  }

  // Step 7: CLAUDE.md
  if (profile.claudeMd) {
    // Resolve preflight command: CLI flag > lockfile detection > profile default > safe fallback
    const resolvedPreflightCmd = preflightCmdOverride || detectPreflightCmd(targetDir);
    const claudeMdConfig = { ...profile.claudeMd, preflightCmd: resolvedPreflightCmd };
    results.push(...installClaudeMd(targetDir, claudeMdConfig, dryRun));
  }

  // Step 8: Policy
  results.push(
    ...installPolicy(
      targetDir,
      profileName,
      profile,
      dryRun,
      isTechProfile ? profileName : undefined
    )
  );

  // Step 9: MCP server config (.mcp.json — tells Claude Code how to connect to reagent serve)
  results.push(...installMcpJson(targetDir, dryRun));

  // Step 9a: Gateway config (.reagent/gateway.yaml — downstream servers proxied through reagent)
  results.push(...installGatewayConfig(targetDir, dryRun));

  // Step 9b: Warn about duplicate MCP server entries (skip in dry-run — files may not exist)
  if (!dryRun) {
    checkMcpDuplicates(targetDir);
  }

  // Step 10: Agent team
  results.push(...installAgents(targetDir, dryRun));

  // Step 11: Claude commands
  results.push(...installClaudeCommands(targetDir, dryRun));

  // Step 12: Project management
  results.push(
    ...installPm(
      targetDir,
      profile.pm as
        | { enabled?: boolean; taskLinkGate?: boolean; maxOpenTasks?: number }
        | undefined,
      dryRun
    )
  );

  // Step 13: GitHub repo scaffold (opt-in via --github flag)
  if (withGitHub) {
    const description = typeof profile.description === 'string' ? profile.description : undefined;
    results.push(
      ...installGitHub({
        targetDir,
        description,
        dryRun,
      })
    );
  }

  // Step 14: Discord notifications (opt-in via --discord flag)
  if (withDiscord) {
    const discordOpts = parseDiscordArgs(args);
    results.push(...installDiscord(targetDir, discordOpts, dryRun));
  }

  // Step 15: Obsidian vault integration (opt-in via --obsidian flag)
  if (withObsidian) {
    const obsidianOpts = parseObsidianArgs(args);
    results.push(...installObsidian(targetDir, obsidianOpts, dryRun));
  }

  // Step 16: Tech profile overlay (hooks, gates, agents) — runs after base init
  if (isTechProfile) {
    const profileResult = installProfile(profileName, targetDir, dryRun);
    results.push(...profileResult.results);

    if (profileResult.gatesInstalled.length > 0) {
      console.log(`Tech profile "${profileName}" gates (add to your preflight script):`);
      for (const gate of profileResult.gatesInstalled) {
        console.log(`  [${gate.on_failure}] ${gate.name}: ${gate.command}`);
      }
      console.log('');
    }

    if (profileResult.agentsInstalled.length > 0) {
      console.log(`Recommended agents for "${profileName}":`);
      for (const agent of profileResult.agentsInstalled) {
        console.log(`  - ${agent}`);
      }
      console.log('');
    }
  }

  printSummary(results, dryRun, true);
}

function printSummary(
  results: InstallResult[],
  dryRun: boolean,
  showCommitInstructions: boolean
): void {
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
    if (showCommitInstructions) {
      console.log('\nCommit these files (safe to commit):');
      console.log(
        '  git add .mcp.json .cursor/rules/ .husky/ .claude/commands/ CLAUDE.md .reagent/policy.yaml .reagent/gateway.yaml && git commit -m "chore: add reagent governance config"'
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
}
