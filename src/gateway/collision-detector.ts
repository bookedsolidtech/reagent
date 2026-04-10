import type { ClientManager } from './client-manager.js';

export interface CollisionEntry {
  toolName: string;
  /** Server that "owns" the original name */
  primaryServer: string;
  /** Server whose tool is shadowed and will be prefixed */
  shadowedServer: string;
  /** The namespaced name the shadowed tool will be registered under */
  namespacedName: string;
}

export interface CollisionReport {
  collisions: CollisionEntry[];
  /**
   * Maps `serverName/toolName` → registered name.
   * For primary tools: registered name equals toolName.
   * For shadowed tools: registered name is `serverName/toolName`.
   */
  nameMap: Map<string, string>;
}

/**
 * Detects tool name collisions across all downstream servers.
 *
 * When two servers expose the same bare tool name, the first server encountered
 * wins and keeps the original name. The second server's tool gets prefixed as
 * `{serverName}/{toolName}`. This is deterministic (Map insertion order).
 *
 * Runs before the gateway starts accepting connections so admins know about
 * shadowed tools at startup rather than silently losing one.
 */
export async function detectToolCollisions(clientManager: ClientManager): Promise<CollisionReport> {
  // toolName → first server to register it
  const seen = new Map<string, string>();
  const collisions: CollisionEntry[] = [];
  // key = `serverName::toolName`, value = what name it will be registered as
  const nameMap = new Map<string, string>();

  for (const [serverName, managed] of clientManager.getAllClients()) {
    let tools: Array<{ name: string }>;
    try {
      const result = await managed.client.listTools();
      tools = result.tools;
    } catch (err) {
      console.error(
        `[reagent] collision-detector: could not list tools from "${serverName}":`,
        err instanceof Error ? err.message : err
      );
      continue;
    }

    for (const tool of tools) {
      const key = `${serverName}::${tool.name}`;
      const prior = seen.get(tool.name);

      if (prior !== undefined) {
        // This tool name was already claimed by `prior` server
        const namespacedName = `${serverName}/${tool.name}`;
        collisions.push({
          toolName: tool.name,
          primaryServer: prior,
          shadowedServer: serverName,
          namespacedName,
        });
        nameMap.set(key, namespacedName);

        // Warn with enough detail that an admin can act on it
        console.error(
          `[reagent] WARN [GHSA-4j9r] tool name collision: "${tool.name}" is exposed by ` +
            `both "${prior}" (primary, keeps original name) and "${serverName}" ` +
            `(shadowed, will be registered as "${namespacedName}")`
        );
      } else {
        seen.set(tool.name, serverName);
        nameMap.set(key, tool.name);
      }
    }
  }

  return { collisions, nameMap };
}
