import { Tier } from './enums.js';

export interface ToolOverride {
  tier?: Tier;
  blocked?: boolean;
}

export interface DownstreamServer {
  command: string;
  args: string[];
  env?: Record<string, string>;
  tool_overrides?: Record<string, ToolOverride>;
  /** Max concurrent in-flight calls to this server (0 = unlimited) */
  max_concurrent_calls?: number;
  /** Max calls per minute to this server (0 = unlimited) */
  calls_per_minute?: number;
}

export interface GatewayOptions {
  /** Cap on tool result size in KB. Results exceeding this are truncated. Default: 512 */
  max_result_size_kb?: number;
}

export interface GatewayConfig {
  version: string;
  servers: Record<string, DownstreamServer>;
  gateway?: GatewayOptions;
}
