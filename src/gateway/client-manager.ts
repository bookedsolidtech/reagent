import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { GatewayConfig, DownstreamServer } from '../types/index.js';
import { getPkgVersion } from '../cli/utils.js';

export interface ManagedClient {
  name: string;
  client: Client;
  transport: StdioClientTransport;
  config: DownstreamServer;
}

/**
 * Build a clean env record: merge process.env (filtering out undefined) with config env.
 */
function buildEnv(configEnv?: Record<string, string>): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) base[k] = v;
  }
  if (configEnv) Object.assign(base, configEnv);
  return base;
}

/**
 * Manages lifecycle of downstream MCP server connections.
 * Spawns each server as a child process via StdioClientTransport.
 */
export class ClientManager {
  private clients = new Map<string, ManagedClient>();
  private connectTimeoutMs: number;

  constructor(options?: { connectTimeoutMs?: number }) {
    this.connectTimeoutMs = options?.connectTimeoutMs ?? 30_000;
  }

  async connectAll(gatewayConfig: GatewayConfig): Promise<Map<string, ManagedClient>> {
    const entries = Object.entries(gatewayConfig.servers);

    for (const [name, serverConfig] of entries) {
      try {
        const managed = await this.connect(name, serverConfig);
        this.clients.set(name, managed);
        console.error(`[reagent] Connected to downstream: ${name}`);
      } catch (err) {
        console.error(
          `[reagent] Failed to connect to downstream "${name}":`,
          err instanceof Error ? err.message : err
        );
      }
    }

    return this.clients;
  }

  private async connect(name: string, config: DownstreamServer): Promise<ManagedClient> {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: buildEnv(config.env),
    });

    const client = new Client(
      { name: `reagent-proxy-${name}`, version: getPkgVersion() },
      { capabilities: {} }
    );

    // H3: Timeout for downstream server connections
    const connectPromise = client.connect(transport);
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () =>
          reject(new Error(`Connection to "${name}" timed out after ${this.connectTimeoutMs}ms`)),
        this.connectTimeoutMs
      );
    });

    await Promise.race([connectPromise, timeoutPromise]);

    return { name, client, transport, config };
  }

  getClient(name: string): ManagedClient | undefined {
    return this.clients.get(name);
  }

  getAllClients(): Map<string, ManagedClient> {
    return this.clients;
  }

  async disconnectAll(): Promise<void> {
    for (const [name, managed] of this.clients) {
      try {
        await managed.client.close();
        console.error(`[reagent] Disconnected from: ${name}`);
      } catch (err) {
        console.error(
          `[reagent] Error disconnecting "${name}":`,
          err instanceof Error ? err.message : err
        );
      }
    }
    this.clients.clear();
  }
}
