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
}

export interface GatewayConfig {
  version: string;
  servers: Record<string, DownstreamServer>;
}
