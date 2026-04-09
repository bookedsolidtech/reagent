import { Tier } from '../types/index.js';
import type { GatewayConfig } from '../types/index.js';

/** Numeric severity for tier comparison — higher = more dangerous. */
const TIER_SEVERITY: Record<Tier, number> = {
  [Tier.Read]: 0,
  [Tier.Write]: 1,
  [Tier.Destructive]: 2,
};

/**
 * Static tier classifications for known tool patterns.
 * Tools not in this map default to Tier.Write (safe default).
 */
const STATIC_TIER_MAP: Record<string, Tier> = {
  // Read-tier tools (safe, no side effects)
  get_messages: Tier.Read,
  get_channel: Tier.Read,
  get_guild: Tier.Read,
  get_member: Tier.Read,
  get_webhook: Tier.Read,
  list_channels: Tier.Read,
  list_guilds: Tier.Read,
  list_members: Tier.Read,
  list_roles: Tier.Read,
  list_threads: Tier.Read,
  list_webhooks: Tier.Read,
  list_projects: Tier.Read,
  search_messages: Tier.Read,
  query_audit_log: Tier.Read,
  health_check: Tier.Read,

  // Write-tier tools (create or modify)
  send_message: Tier.Write,
  send_embed: Tier.Write,
  edit_message: Tier.Write,
  add_reaction: Tier.Write,
  create_thread: Tier.Write,
  create_channel: Tier.Write,
  create_role: Tier.Write,
  create_invite: Tier.Write,
  create_webhook: Tier.Write,
  execute_webhook: Tier.Write,
  edit_channel: Tier.Write,
  edit_role: Tier.Write,
  edit_webhook: Tier.Write,
  set_slowmode: Tier.Write,
  set_permissions: Tier.Write,
  assign_role: Tier.Write,
  move_channel: Tier.Write,
  archive_thread: Tier.Write,
  timeout_member: Tier.Write,

  // Destructive-tier tools (irreversible or high-impact)
  delete_message: Tier.Destructive,
  delete_channel: Tier.Destructive,
  delete_role: Tier.Destructive,
  delete_webhook: Tier.Destructive,
  purge_messages: Tier.Destructive,
  ban_member: Tier.Destructive,
  unban_member: Tier.Destructive,
  kick_member: Tier.Destructive,
};

/**
 * Derive the base tier for a tool using the static map and naming conventions.
 * This is the "floor" — overrides cannot go below this.
 */
function deriveBaseTier(baseName: string): Tier {
  // Check static map first
  if (STATIC_TIER_MAP[baseName]) {
    return STATIC_TIER_MAP[baseName];
  }

  // Convention-based classification for tools not in the static map.
  // This allows non-Discord downstream servers to get sensible defaults.
  if (
    /^(get_|list_|search_|query_|read_|fetch_|check_|health_|describe_|show_|count_)/.test(baseName)
  ) {
    return Tier.Read;
  }
  if (/^(delete_|drop_|purge_|remove_|destroy_|ban_|kick_|revoke_|truncate_)/.test(baseName)) {
    return Tier.Destructive;
  }

  // Default: Write (fail-safe — requires at least L1)
  return Tier.Write;
}

/**
 * Classify a tool by its tier. Checks gateway config overrides first,
 * then static map, then naming conventions, then defaults to Write.
 */
export function classifyTool(
  toolName: string,
  serverName: string,
  gatewayConfig?: GatewayConfig
): Tier {
  // Strip server prefix for base lookup (e.g., "discord-ops__send_message" -> "send_message")
  const baseName = toolName.includes('__') ? toolName.split('__').pop()! : toolName;
  const baseTier = deriveBaseTier(baseName);

  // Check per-server overrides in gateway config
  const serverConfig = gatewayConfig?.servers[serverName];
  const override = serverConfig?.tool_overrides?.[toolName];
  if (override?.tier) {
    const overrideTier = override.tier;

    // SECURITY: Prevent tier downgrades — overrides cannot lower a tool below its base tier.
    if (TIER_SEVERITY[overrideTier] < TIER_SEVERITY[baseTier]) {
      console.error(
        `[reagent] WARNING: tool_override for "${toolName}" attempted to downgrade tier from ${baseTier} to ${overrideTier} — ignoring override`
      );
      return baseTier;
    }
    return overrideTier;
  }

  return baseTier;
}

/**
 * Check if a tool is explicitly blocked in gateway config.
 */
export function isToolBlocked(
  toolName: string,
  serverName: string,
  gatewayConfig?: GatewayConfig
): boolean {
  const serverConfig = gatewayConfig?.servers[serverName];
  const override = serverConfig?.tool_overrides?.[toolName];
  return override?.blocked === true;
}
