import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadPolicy } from '../config/policy-loader.js';
import { loadGatewayConfig } from '../config/gateway-config.js';
import { getPkgVersion } from '../cli/utils.js';
import { ClientManager } from './client-manager.js';
import { ToolProxy } from './tool-proxy.js';
import { createSessionMiddleware } from './middleware/session.js';
import { createKillSwitchMiddleware } from './middleware/kill-switch.js';
import { createTierMiddleware } from './middleware/tier.js';
import { createPolicyMiddleware } from './middleware/policy.js';
import { redactMiddleware } from './middleware/redact.js';
import { createInjectionMiddleware } from './middleware/injection.js';
import { createAuditMiddleware } from './middleware/audit.js';
import { createBlockedPathsMiddleware } from './middleware/blocked-paths.js';
import { createResultSizeCapMiddleware } from './middleware/result-size-cap.js';
import { registerNativeTools } from './native-tools.js';
import { detectToolCollisions } from './collision-detector.js';
import type { Middleware } from './middleware/chain.js';

export interface ServeOptions {
  baseDir: string;
}

/**
 * Starts the MCP gateway server.
 *
 * 1. Loads policy and gateway config
 * 2. Connects to all downstream MCP servers
 * 3. Discovers their tools
 * 4. Re-registers tools on the gateway with middleware-wrapped handlers
 * 5. Listens on stdio for incoming MCP requests
 */
export async function startGateway(options: ServeOptions): Promise<void> {
  const { baseDir } = options;

  // Load configuration
  console.error('[reagent] Loading configuration...');
  const policy = loadPolicy(baseDir);
  const gatewayConfig = loadGatewayConfig(baseDir);

  console.error(`[reagent] Policy: autonomy=${policy.autonomy_level}, profile=${policy.profile}`);
  console.error(
    `[reagent] Gateway: ${Object.keys(gatewayConfig.servers).length} downstream server(s)`
  );

  // Build middleware chain
  // SECURITY: Audit is outermost so it records ALL invocations, including kill-switch denials.
  // SECURITY: blocked-paths runs before tool execution to prevent writes to protected paths.
  // SECURITY: injection runs PostToolUse (after redact) to scan downstream results for prompt injection.
  // SECURITY: result-size-cap runs PostToolUse after injection so it caps already-scanned output.
  // Order (onion): audit → session → kill-switch → tier → policy → blocked-paths → redact → injection → result-size-cap → [execute]
  const injectionAction =
    (policy as unknown as Record<string, unknown>).injection_detection === 'warn'
      ? ('warn' as const)
      : ('block' as const);

  const middlewares: Middleware[] = [
    createAuditMiddleware(baseDir, policy),
    createSessionMiddleware(),
    createKillSwitchMiddleware(baseDir),
    createTierMiddleware(gatewayConfig),
    createPolicyMiddleware(policy, gatewayConfig, baseDir),
    createBlockedPathsMiddleware(policy, baseDir),
    redactMiddleware,
    createInjectionMiddleware(injectionAction),
    createResultSizeCapMiddleware(gatewayConfig),
  ];

  // Create gateway MCP server
  const gateway = new McpServer(
    { name: 'reagent', version: getPkgVersion() },
    { capabilities: { tools: {} } }
  );

  // Connect to downstream servers
  const clientManager = new ClientManager();
  await clientManager.connectAll(gatewayConfig);

  // Detect tool name collisions before accepting connections (GHSA-4j9r)
  const { collisions } = await detectToolCollisions(clientManager);
  if (collisions.length > 0) {
    console.error(
      `[reagent] ${collisions.length} tool name collision(s) detected — shadowed tools will be registered with server-prefixed names`
    );
  }

  // Register native (first-party) tools
  const nativeCount = registerNativeTools(gateway, baseDir, middlewares);

  // Discover and register proxied tools
  const toolProxy = new ToolProxy();
  const proxyCount = await toolProxy.discoverAndRegister(gateway, clientManager, middlewares);
  const toolCount = nativeCount + proxyCount;

  console.error(
    `[reagent] Gateway ready: ${toolCount} tools registered (${nativeCount} native, ${proxyCount} proxied)`
  );

  // Listen on stdio
  const transport = new StdioServerTransport();
  await gateway.connect(transport);

  console.error('[reagent] Listening on stdio...');

  // Graceful shutdown — guard against double-invocation
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error('[reagent] Shutting down...');
    try {
      await clientManager.disconnectAll();
    } catch (err) {
      console.error(
        '[reagent] Error during client disconnect:',
        err instanceof Error ? err.message : err
      );
    }
    try {
      await gateway.close();
    } catch (err) {
      console.error(
        '[reagent] Error during gateway close:',
        err instanceof Error ? err.message : err
      );
    }
    process.exitCode = 0;
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
