import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { TaskView } from './types.js';

export interface DiscordOpsConfig {
  enabled: boolean;
  guild_id: string;
  channels: {
    alerts?: string;
    releases?: string;
    tasks?: string;
    dev?: string;
  };
}

export interface DiscordGatewayYaml {
  discord_ops?: DiscordOpsConfig;
}

/**
 * Load discord_ops config from .reagent/gateway.yaml.
 * Returns null if not configured or disabled.
 */
export function loadDiscordConfig(baseDir: string): DiscordOpsConfig | null {
  const gatewayPath = path.join(baseDir, '.reagent', 'gateway.yaml');
  if (!fs.existsSync(gatewayPath)) return null;

  try {
    const raw = fs.readFileSync(gatewayPath, 'utf8');
    const parsed = parseYaml(raw) as DiscordGatewayYaml;

    const discordOps = parsed?.discord_ops;
    if (!discordOps?.enabled) return null;

    return discordOps;
  } catch {
    return null;
  }
}

/**
 * Send a message to a Discord channel via the discord-ops CLI.
 * Fails silently — Discord notification failures must never block workflows.
 */
function sendDiscordMessage(
  config: DiscordOpsConfig,
  channelKey: keyof DiscordOpsConfig['channels'],
  content: string,
  title?: string
): void {
  const channelId = config.channels[channelKey];
  if (!channelId || !config.guild_id) return;

  const token = process.env['DISCORD_BOT_TOKEN'];
  if (!token) return;

  try {
    const args = [
      '-y',
      '@bookedsolid/discord-ops@latest',
      'send_message',
      '--channel-id',
      channelId,
      '--guild-id',
      config.guild_id,
      '--content',
      title ? `**${title}**\n${content}` : content,
    ];

    execFileSync('npx', args, {
      encoding: 'utf8',
      timeout: 10_000,
      stdio: 'pipe',
      env: { ...process.env, DISCORD_BOT_TOKEN: token },
    });
  } catch {
    // Fail silently — Discord notification failure must never block anything
  }
}

/**
 * Discord notifier — sends structured notifications to configured channels.
 * All methods fail silently when Discord is not configured or unavailable.
 */
export class DiscordNotifier {
  private readonly config: DiscordOpsConfig | null;

  constructor(baseDir: string) {
    this.config = loadDiscordConfig(baseDir);
  }

  /**
   * Check whether Discord notifications are enabled.
   */
  isEnabled(): boolean {
    return this.config !== null && this.config.enabled;
  }

  /**
   * Notify Discord that a task was created.
   */
  async notifyTaskCreated(task: TaskView): Promise<void> {
    if (!this.config) return;
    const content =
      `Task created: **${task.id}** — ${task.title}` +
      (task.urgency !== 'normal' ? ` [${task.urgency}]` : '') +
      (task.assignee ? ` (assigned to ${task.assignee})` : '');
    sendDiscordMessage(this.config, 'tasks', content, 'Task Created');
  }

  /**
   * Notify Discord that a task was completed.
   */
  async notifyTaskCompleted(task: TaskView): Promise<void> {
    if (!this.config) return;
    const content = `Task completed: **${task.id}** — ${task.title}`;
    sendDiscordMessage(this.config, 'tasks', content, 'Task Completed');
  }

  /**
   * Notify Discord that a hook blocked an action.
   */
  async notifyHookBlocked(hookName: string, tool: string, reason: string): Promise<void> {
    if (!this.config) return;
    const content = `Hook **${hookName}** blocked tool \`${tool}\`\nReason: ${reason}`;
    sendDiscordMessage(this.config, 'alerts', content, 'Hook Block');
  }

  /**
   * Notify Discord of a release.
   */
  async notifyRelease(version: string, changelog: string): Promise<void> {
    if (!this.config) return;
    const truncated = changelog.length > 500 ? changelog.slice(0, 497) + '...' : changelog;
    const content = `Version **${version}** released\n\n${truncated}`;
    sendDiscordMessage(this.config, 'releases', content, 'Release');
  }

  /**
   * Notify Discord of a security/audit alert.
   */
  async notifyAuditAlert(message: string): Promise<void> {
    if (!this.config) return;
    sendDiscordMessage(this.config, 'alerts', message, 'Audit Alert');
  }
}
