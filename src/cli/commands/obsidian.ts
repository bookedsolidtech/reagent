import { VaultWriter } from '../../obsidian/vault-writer.js';
import { ObsidianCli } from '../../obsidian/cli.js';
import { parseFlag } from '../utils.js';

const VALID_TARGETS = ['kanban', 'context', 'wiki', 'tasks'] as const;
type SyncTarget = (typeof VALID_TARGETS)[number];

export function runObsidian(args: string[]): void {
  const subcommand = args[0];

  if (!subcommand || subcommand === 'help' || subcommand === '--help') {
    printObsidianHelp();
    return;
  }

  switch (subcommand) {
    case 'sync':
      runObsidianSync(args.slice(1));
      break;
    case 'status':
      runObsidianStatus();
      break;
    case 'health':
      runObsidianHealth();
      break;
    case 'journal':
      runObsidianJournal();
      break;
    default:
      console.error(`Unknown obsidian subcommand: ${subcommand}`);
      printObsidianHelp();
      process.exit(1);
  }
}

function runObsidianSync(args: string[]): void {
  const dryRun = args.includes('--dry-run');
  const targetFlag = parseFlag(args, '--target') as SyncTarget | undefined;

  if (targetFlag && !VALID_TARGETS.includes(targetFlag)) {
    console.error(`Invalid sync target: ${targetFlag}`);
    console.error(`Valid targets: ${VALID_TARGETS.join(', ')}`);
    process.exit(1);
  }

  const writer = new VaultWriter(process.cwd());

  if (!writer.isEnabled()) {
    console.log('Obsidian vault integration is not configured or disabled.');
    console.log('');
    console.log('To enable:');
    console.log('  1. Set REAGENT_OBSIDIAN_VAULT env var to your vault path');
    console.log('  2. Run: reagent init --obsidian');
    console.log('  3. Set obsidian_vault.enabled: true in .reagent/gateway.yaml');
    return;
  }

  if (dryRun) {
    console.log('Dry run — no files will be written.\n');
  }

  if (targetFlag) {
    const result =
      targetFlag === 'kanban'
        ? writer.syncKanban(dryRun)
        : targetFlag === 'context'
          ? writer.syncContextDump(dryRun)
          : targetFlag === 'wiki'
            ? writer.syncWiki(dryRun)
            : writer.syncTasks(dryRun);

    printSyncResult(result);
  } else {
    const results = writer.syncAll(dryRun);
    for (const result of results) {
      printSyncResult(result);
    }
  }
}

function runObsidianStatus(): void {
  const writer = new VaultWriter(process.cwd());
  const config = writer.getConfig();

  if (!config) {
    console.log('Obsidian vault: not configured');
    return;
  }

  console.log('Obsidian vault: enabled');
  console.log(`  Vault path: ${config.vault_path}`);
  if (config.vault_name) {
    console.log(`  Vault name: ${config.vault_name}`);
  }

  // CLI availability
  const cliAvailable = ObsidianCli.isAvailable();
  console.log(`  Obsidian CLI: ${cliAvailable ? 'available' : 'not found'}`);

  console.log('  Paths:');
  console.log(`    root:     ${config.paths.root}`);
  console.log(`    kanban:   ${config.paths.kanban}`);
  console.log(`    sources:  ${config.paths.sources}`);
  console.log(`    wiki:     ${config.paths.wiki}`);
  console.log(`    tasks:    ${config.paths.tasks}`);
  console.log(`    sessions: ${config.paths.sessions}`);
  console.log('  Sync targets:');
  console.log(`    kanban:       ${config.sync.kanban ? 'enabled' : 'disabled'}`);
  console.log(`    context_dump: ${config.sync.context_dump ? 'enabled' : 'disabled'}`);
  console.log(`    wiki_refresh: ${config.sync.wiki_refresh ? 'enabled' : 'disabled'}`);
  console.log(`    journal:      ${config.sync.journal ? 'enabled' : 'disabled'}`);
  console.log(`    precompact:   ${config.sync.precompact ? 'enabled' : 'disabled'}`);
  console.log(`    tasks:        ${config.sync.tasks ? 'enabled' : 'disabled'}`);
}

function runObsidianHealth(): void {
  const writer = new VaultWriter(process.cwd());
  const config = writer.getConfig();

  if (!config) {
    console.log('Obsidian vault: not configured');
    return;
  }

  if (!ObsidianCli.isAvailable()) {
    console.log('Obsidian CLI not found at /usr/local/bin/obsidian');
    return;
  }

  if (!config.vault_name) {
    console.log('vault_name not set in gateway.yaml — required for CLI commands');
    return;
  }

  const cli = new ObsidianCli(config.vault_name);
  const health = cli.vaultHealth();

  if (!health) {
    console.log('Failed to get vault health metrics');
    return;
  }

  console.log(`Vault health — ${config.vault_name}:`);
  console.log(`  Orphans:    ${health.orphans}`);
  console.log(`  Unresolved: ${health.unresolved}`);
  console.log(`  Dead ends:  ${health.deadends}`);
}

function runObsidianJournal(): void {
  const writer = new VaultWriter(process.cwd());
  const config = writer.getConfig();

  if (!config) {
    console.log('Obsidian vault: not configured');
    return;
  }

  if (!ObsidianCli.isAvailable()) {
    console.log('Obsidian CLI not found at /usr/local/bin/obsidian');
    return;
  }

  if (!config.vault_name) {
    console.log('vault_name not set in gateway.yaml — required for CLI commands');
    return;
  }

  if (!config.sync.journal) {
    console.log('Journal sync not enabled in gateway.yaml');
    return;
  }

  const cli = new ObsidianCli(config.vault_name);
  const projectName = process.cwd().split('/').pop() || 'unknown';
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 16);

  const content = `### ${projectName} — Manual journal entry (${timestamp})\n\n- Triggered via \`reagent obsidian journal\`\n\n---\n`;

  const success = cli.dailyAppend(content);
  if (success) {
    console.log('Session journal entry appended to daily note');
  } else {
    console.log('Failed to append journal entry');
  }
}

function printSyncResult(result: {
  target: string;
  written: boolean;
  path?: string;
  error?: string;
}): void {
  if (result.written) {
    console.log(`  [synced] ${result.target} → ${result.path}`);
  } else if (result.error) {
    console.log(`  [skip]   ${result.target}: ${result.error}`);
  } else {
    console.log(`  [skip]   ${result.target}: not configured`);
  }
}

function printObsidianHelp(): void {
  console.log(`
reagent obsidian — Obsidian vault integration

Usage:
  reagent obsidian sync [--target kanban|context|wiki|tasks] [--dry-run]
  reagent obsidian status
  reagent obsidian health
  reagent obsidian journal

Commands:
  sync     Sync enabled targets to the Obsidian vault
  status   Show current Obsidian configuration and CLI availability
  health   Show vault health metrics (orphans, unresolved links, dead ends)
  journal  Manually trigger a session journal entry in the daily note

Options:
  --target <name>   Sync a specific target only (kanban, context, wiki, tasks)
  --dry-run         Preview what would be written without writing files
`);
}
