import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { InstallResult } from './types.js';

export interface ObsidianInitOptions {
  vaultPath?: string;
}

/**
 * Generate the obsidian_vault YAML block to append to gateway.yaml.
 * Always installs as disabled — user must explicitly enable.
 */
function buildObsidianVaultYaml(opts: ObsidianInitOptions): string {
  return `
# Optional: Obsidian vault integration
# Syncs task state, context, and wiki pages to an Obsidian vault as plain markdown.
# Set REAGENT_OBSIDIAN_VAULT env var to your vault root path, or set vault_path below.
# All sync targets are opt-in and disabled by default.
obsidian_vault:
  enabled: false
  vault_path: '${opts.vaultPath || ''}'
  vault_name: ''
  paths:
    root: 'Projects/Reagent'
    kanban: 'Projects/Reagent/Kanban.md'
    sources: 'Projects/Reagent/Sources'
    wiki: 'Projects/Reagent/Auto'
    tasks: 'Tasks'
    sessions: 'Wiki/Sessions'
  sync:
    kanban: false
    context_dump: false
    wiki_refresh: false
    journal: true
    precompact: false
    tasks: true
  precompact:
    engine: 'claude'
    model: null
`;
}

/**
 * Install or update the obsidian_vault section in .reagent/gateway.yaml.
 *
 * Wired into `reagent init --obsidian`.
 * Non-interactive: reads opts from args.
 */
export function installObsidian(
  targetDir: string,
  opts: ObsidianInitOptions,
  dryRun: boolean
): InstallResult[] {
  const results: InstallResult[] = [];
  const gatewayPath = path.join(targetDir, '.reagent', 'gateway.yaml');

  if (!fs.existsSync(gatewayPath)) {
    return [{ file: '.reagent/gateway.yaml (not found — run reagent init first)', status: 'warn' }];
  }

  const raw = fs.readFileSync(gatewayPath, 'utf8');

  let parsed: Record<string, unknown>;
  try {
    parsed = parseYaml(raw) as Record<string, unknown>;
  } catch {
    return [{ file: '.reagent/gateway.yaml (YAML parse error)', status: 'warn' }];
  }

  if ('obsidian_vault' in parsed) {
    return [
      {
        file: '.reagent/gateway.yaml (obsidian_vault already configured)',
        status: 'skipped',
      },
    ];
  }

  const obsidianYaml = buildObsidianVaultYaml(opts);

  if (!dryRun) {
    fs.appendFileSync(gatewayPath, obsidianYaml, 'utf8');
  }

  results.push({ file: '.reagent/gateway.yaml (+obsidian_vault)', status: 'updated' });

  if (!dryRun) {
    console.log('');
    console.log('Obsidian vault integration configured (disabled by default).');
    console.log('');
    console.log('To enable:');
    console.log('  1. Set your vault path:');
    console.log('     export REAGENT_OBSIDIAN_VAULT="~/path/to/your/vault"');
    console.log('');
    console.log('  2. Enable in .reagent/gateway.yaml:');
    console.log('     obsidian_vault.enabled: true');
    console.log('     obsidian_vault.sync.kanban: true');
    console.log('');
    console.log('  3. Sync: reagent obsidian sync');
    console.log('');
  }

  return results;
}

/**
 * Parse --obsidian flags from CLI args.
 */
export function parseObsidianArgs(args: string[]): ObsidianInitOptions {
  const idx = args.indexOf('--vault-path');
  const vaultPath =
    idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--') ? args[idx + 1] : undefined;

  return { vaultPath };
}
