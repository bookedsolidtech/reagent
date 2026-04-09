import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { InstallResult } from './types.js';

export interface DiscordInitOptions {
  guildId?: string;
  alertsChannel?: string;
  releasesChannel?: string;
  tasksChannel?: string;
  devChannel?: string;
}

/**
 * Generate the discord_ops YAML block to append to gateway.yaml.
 */
function buildDiscordOpsYaml(opts: DiscordInitOptions, enabled: boolean): string {
  return `
# Optional: discord-ops integration
# Enables reagent to send notifications to Discord channels.
# Requires DISCORD_BOT_TOKEN env var.
discord_ops:
  enabled: ${enabled}
  guild_id: '${opts.guildId || ''}'
  channels:
    alerts: '${opts.alertsChannel || ''}'       # hook blocks, security alerts
    releases: '${opts.releasesChannel || ''}'     # publish/deploy events
    tasks: '${opts.tasksChannel || ''}'        # task create/complete events
    dev: '${opts.devChannel || ''}'           # commit/PR activity
`;
}

/**
 * Install or update the discord_ops section in .reagent/gateway.yaml.
 *
 * This step is wired into `reagent init --discord`.
 * Non-interactive: reads opts from args; for interactive use, callers should
 * prompt before calling this function.
 */
export function installDiscord(
  targetDir: string,
  opts: DiscordInitOptions,
  dryRun: boolean
): InstallResult[] {
  const results: InstallResult[] = [];
  const gatewayPath = path.join(targetDir, '.reagent', 'gateway.yaml');

  if (!fs.existsSync(gatewayPath)) {
    return [{ file: '.reagent/gateway.yaml (not found — run reagent init first)', status: 'warn' }];
  }

  const raw = fs.readFileSync(gatewayPath, 'utf8');

  // Check if discord_ops block already present
  let parsed: Record<string, unknown>;
  try {
    parsed = parseYaml(raw) as Record<string, unknown>;
  } catch {
    return [{ file: '.reagent/gateway.yaml (YAML parse error)', status: 'warn' }];
  }

  if ('discord_ops' in parsed) {
    // Already has discord_ops — report as skipped (idempotent)
    return [{ file: '.reagent/gateway.yaml (discord_ops already configured)', status: 'skipped' }];
  }

  // Append discord_ops block
  const discordYaml = buildDiscordOpsYaml(opts, Object.keys(opts).length > 0);

  if (!dryRun) {
    fs.appendFileSync(gatewayPath, discordYaml, 'utf8');
  }

  results.push({ file: '.reagent/gateway.yaml (+discord_ops)', status: 'updated' });

  if (!dryRun) {
    console.log('');
    console.log('Discord integration configured.');
    console.log('');
    console.log('To enable notifications, set the DISCORD_BOT_TOKEN environment variable:');
    console.log('');
    console.log('  export DISCORD_BOT_TOKEN=your-bot-token-here');
    console.log('');
    console.log('Then set discord_ops.enabled: true in .reagent/gateway.yaml');
    console.log('');
    console.log('Documentation: https://github.com/bookedsolidtech/reagent#discord-notifications');
  }

  return results;
}

/**
 * Parse --discord flags from CLI args.
 */
export function parseDiscordArgs(args: string[]): DiscordInitOptions {
  const getFlag = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--')) {
      return args[idx + 1];
    }
    return undefined;
  };

  return {
    guildId: getFlag('--guild-id'),
    alertsChannel: getFlag('--alerts-channel'),
    releasesChannel: getFlag('--releases-channel'),
    tasksChannel: getFlag('--tasks-channel'),
    devChannel: getFlag('--dev-channel'),
  };
}
