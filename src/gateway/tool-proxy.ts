import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ClientManager, ManagedClient } from './client-manager.js';
import type { Middleware, InvocationContext } from './middleware/chain.js';
import { executeChain } from './middleware/chain.js';
import { InvocationStatus } from '../types/index.js';

interface DiscoveredTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverName: string;
  client: ManagedClient;
}

/**
 * Convert a JSON Schema properties object to a Zod record of `z.any().optional()`.
 * This preserves the downstream tool's top-level parameter names so the MCP caller
 * sends them directly (not wrapped in `{ args: ... }`).
 */
function jsonSchemaToZodParams(inputSchema: Record<string, unknown>): Record<string, z.ZodType> {
  const zodParams: Record<string, z.ZodType> = {};
  const properties = inputSchema.properties as Record<string, unknown> | undefined;
  const required = (inputSchema.required as string[]) ?? [];

  if (properties) {
    for (const key of Object.keys(properties)) {
      zodParams[key] = required.includes(key) ? z.any() : z.any().optional();
    }
  }

  // If no properties defined, accept arbitrary keys
  if (Object.keys(zodParams).length === 0) {
    return { _passthrough: z.any().optional() };
  }

  return zodParams;
}

/**
 * Discovers tools from all downstream clients and registers them on the gateway McpServer.
 * Tool names are namespaced as `servername__toolname` to avoid collisions.
 */
export class ToolProxy {
  private tools: DiscoveredTool[] = [];

  async discoverAndRegister(
    gateway: McpServer,
    clientManager: ClientManager,
    middlewares: Middleware[]
  ): Promise<number> {
    const clients = clientManager.getAllClients();

    for (const [serverName, managed] of clients) {
      try {
        const result = await managed.client.listTools();
        for (const tool of result.tools) {
          const namespacedName = `${serverName}__${tool.name}`;

          this.tools.push({
            name: namespacedName,
            description: tool.description ?? '',
            inputSchema: tool.inputSchema as Record<string, unknown>,
            serverName,
            client: managed,
          });

          // Build Zod schema from downstream tool's inputSchema
          const zodParams = jsonSchemaToZodParams(tool.inputSchema as Record<string, unknown>);

          // Register on gateway with middleware-wrapped handler
          gateway.tool(namespacedName, tool.description ?? '', zodParams, async (params) => {
            // Params are now flat top-level properties, not wrapped in { args: ... }
            const args = { ...params } as Record<string, unknown>;
            // Remove internal _passthrough if present
            delete args._passthrough;

            const ctx: InvocationContext = {
              tool_name: tool.name,
              server_name: serverName,
              arguments: args,
              session_id: '',
              status: InvocationStatus.Allowed,
              start_time: Date.now(),
              metadata: {},
            };

            // Build middleware chain with the actual call as the innermost function
            const fullChain: Middleware[] = [
              ...middlewares,
              async (innerCtx) => {
                // This is the actual downstream call
                if (innerCtx.status !== InvocationStatus.Allowed) {
                  return; // Short-circuited by a prior middleware
                }

                try {
                  const callResult = await managed.client.callTool({
                    name: tool.name,
                    arguments: innerCtx.arguments,
                  });
                  innerCtx.result = callResult;
                  innerCtx.status = InvocationStatus.Allowed;
                } catch (err) {
                  innerCtx.status = InvocationStatus.Error;
                  innerCtx.error = err instanceof Error ? err.message : String(err);
                }
              },
            ];

            await executeChain(fullChain, ctx);

            // Return result or error to the MCP caller
            if (ctx.status === InvocationStatus.Denied) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: `[DENIED] ${ctx.error}`,
                  },
                ],
                isError: true,
              };
            }

            if (ctx.status === InvocationStatus.Error) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: `[ERROR] ${ctx.error}`,
                  },
                ],
                isError: true,
              };
            }

            // Pass through the downstream result
            const callResult = ctx.result as { content?: unknown[] } | undefined;
            if (callResult?.content) {
              return callResult as { content: Array<{ type: 'text'; text: string }> };
            }

            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify(ctx.result),
                },
              ],
            };
          });
        }

        console.error(`[reagent] Registered ${result.tools.length} tools from "${serverName}"`);
      } catch (err) {
        console.error(
          `[reagent] Failed to discover tools from "${serverName}":`,
          err instanceof Error ? err.message : err
        );
      }
    }

    return this.tools.length;
  }

  getTools(): DiscoveredTool[] {
    return this.tools;
  }
}
