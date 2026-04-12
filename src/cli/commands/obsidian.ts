import { VaultWriter } from '../../obsidian/vault-writer.js';
import { parseFlag } from '../utils.js';

const VALID_TARGETS = ['kanban', 'context', 'wiki'] as const;
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
          : writer.syncWiki(dryRun);

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
  console.log('  Paths:');
  console.log(`    root:    ${config.paths.root}`);
  console.log(`    kanban:  ${config.paths.kanban}`);
  console.log(`    sources: ${config.paths.sources}`);
  console.log(`    wiki:    ${config.paths.wiki}`);
  console.log('  Sync targets:');
  console.log(`    kanban:       ${config.sync.kanban ? 'enabled' : 'disabled'}`);
  console.log(`    context_dump: ${config.sync.context_dump ? 'enabled' : 'disabled'}`);
  console.log(`    wiki_refresh: ${config.sync.wiki_refresh ? 'enabled' : 'disabled'}`);
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
  reagent obsidian sync [--target kanban|context|wiki] [--dry-run]
  reagent obsidian status

Commands:
  sync     Sync enabled targets to the Obsidian vault
  status   Show current Obsidian configuration

Options:
  --target <name>   Sync a specific target only (kanban, context, wiki)
  --dry-run         Preview what would be written without writing files
`);
}
