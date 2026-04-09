import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import { ToolProxy } from '../../gateway/tool-proxy.js';
import { createSessionMiddleware } from '../../gateway/middleware/session.js';
import { createKillSwitchMiddleware } from '../../gateway/middleware/kill-switch.js';
import { createTierMiddleware } from '../../gateway/middleware/tier.js';
import { createPolicyMiddleware } from '../../gateway/middleware/policy.js';
import { redactMiddleware } from '../../gateway/middleware/redact.js';
import { createAuditMiddleware } from '../../gateway/middleware/audit.js';
import { Tier, AutonomyLevel } from '../../types/index.js';
import type { Middleware } from '../../gateway/middleware/chain.js';
import type { ClientManager, ManagedClient } from '../../gateway/client-manager.js';
import type { GatewayConfig, Policy } from '../../types/index.js';

/**
 * Creates a mock downstream MCP server with tools of varying tiers,
 * connects it via InMemoryTransport, and returns a fake ManagedClient.
 */
async function createMockDownstream(
  serverName: string
): Promise<{ managed: ManagedClient; downstream: McpServer; cleanup: () => Promise<void> }> {
  const downstream = new McpServer(
    { name: serverName, version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  // Read-tier tool: list_items
  downstream.tool(
    'list_items',
    'Lists items from the database',
    { category: z.string().optional() },
    async ({ category }) => {
      const items = ['apple', 'banana', 'cherry'];
      const filtered = category ? items.filter((i) => i.startsWith(category)) : items;
      return { content: [{ type: 'text' as const, text: JSON.stringify(filtered) }] };
    }
  );

  // Write-tier tool: create_item
  downstream.tool(
    'create_item',
    'Creates a new item',
    { name: z.string(), value: z.number() },
    async ({ name, value }) => {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ id: 'item-001', name, value, created: true }),
          },
        ],
      };
    }
  );

  // Destructive-tier tool: delete_item
  downstream.tool(
    'delete_item',
    'Deletes an item permanently',
    { id: z.string() },
    async ({ id }) => {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ id, deleted: true }) }],
      };
    }
  );

  // Wire up in-memory transport pair
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client(
    { name: `test-client-${serverName}`, version: '1.0.0' },
    { capabilities: {} }
  );

  await downstream.connect(serverTransport);
  await client.connect(clientTransport);

  const managed: ManagedClient = {
    name: serverName,
    client,
    transport: clientTransport as any, // InMemoryTransport satisfies Transport
    config: {
      command: 'node',
      args: [],
      tool_overrides: {
        list_items: { tier: Tier.Read },
        create_item: { tier: Tier.Write },
        delete_item: { tier: Tier.Destructive },
      },
    },
  };

  const cleanup = async () => {
    await client.close();
    await downstream.close();
  };

  return { managed, downstream, cleanup };
}

/**
 * Creates a fake ClientManager backed by in-memory ManagedClients.
 */
function createFakeClientManager(clients: Map<string, ManagedClient>): ClientManager {
  return {
    getAllClients: () => clients,
    getClient: (name: string) => clients.get(name),
    connectAll: async () => clients,
    disconnectAll: async () => {
      for (const [, m] of clients) {
        await m.client.close();
      }
      clients.clear();
    },
  } as unknown as ClientManager;
}

describe('ToolProxy — integration with real downstream MCP server', () => {
  let tmpDir: string;
  let cleanups: Array<() => Promise<void>>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reagent-toolproxy-'));
    fs.mkdirSync(path.join(tmpDir, '.reagent'), { recursive: true });
    cleanups = [];
  });

  afterEach(async () => {
    for (const fn of cleanups) {
      await fn();
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('discovers tools from downstream and namespaces them as servername__toolname', async () => {
    const { managed, cleanup } = await createMockDownstream('testserver');
    cleanups.push(cleanup);

    const clients = new Map<string, ManagedClient>();
    clients.set('testserver', managed);

    const gateway = new McpServer(
      { name: 'reagent-test', version: '0.1.0' },
      { capabilities: { tools: {} } }
    );

    const toolProxy = new ToolProxy();
    const count = await toolProxy.discoverAndRegister(
      gateway,
      createFakeClientManager(clients),
      []
    );

    expect(count).toBe(3);

    const tools = toolProxy.getTools();
    const toolNames = tools.map((t) => t.name).sort();
    expect(toolNames).toEqual([
      'testserver__create_item',
      'testserver__delete_item',
      'testserver__list_items',
    ]);

    // Verify each tool retains its server reference
    for (const tool of tools) {
      expect(tool.serverName).toBe('testserver');
    }
  });

  it('discovers tools from multiple downstream servers with distinct namespaces', async () => {
    const { managed: managed1, cleanup: cleanup1 } = await createMockDownstream('alpha');
    const { managed: managed2, cleanup: cleanup2 } = await createMockDownstream('beta');
    cleanups.push(cleanup1, cleanup2);

    const clients = new Map<string, ManagedClient>();
    clients.set('alpha', managed1);
    clients.set('beta', managed2);

    const gateway = new McpServer(
      { name: 'reagent-test', version: '0.1.0' },
      { capabilities: { tools: {} } }
    );

    const toolProxy = new ToolProxy();
    const count = await toolProxy.discoverAndRegister(
      gateway,
      createFakeClientManager(clients),
      []
    );

    // 3 tools from alpha + 3 tools from beta
    expect(count).toBe(6);

    const tools = toolProxy.getTools();
    const alphaTools = tools.filter((t) => t.serverName === 'alpha');
    const betaTools = tools.filter((t) => t.serverName === 'beta');
    expect(alphaTools).toHaveLength(3);
    expect(betaTools).toHaveLength(3);

    // No collisions — each tool has unique namespaced name
    const allNames = tools.map((t) => t.name);
    expect(new Set(allNames).size).toBe(6);
  });

  it('proxied callTool reaches the downstream and returns real results', async () => {
    const { managed, cleanup } = await createMockDownstream('store');
    cleanups.push(cleanup);

    const clients = new Map<string, ManagedClient>();
    clients.set('store', managed);

    const gateway = new McpServer(
      { name: 'reagent-test', version: '0.1.0' },
      { capabilities: { tools: {} } }
    );

    // No middlewares — just pass-through
    const toolProxy = new ToolProxy();
    await toolProxy.discoverAndRegister(gateway, createFakeClientManager(clients), []);

    // Connect a test client to the gateway
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const testClient = new Client({ name: 'test', version: '1.0.0' }, { capabilities: {} });
    await gateway.connect(serverTransport);
    await testClient.connect(clientTransport);

    // Call the namespaced tool
    const result = await testClient.callTool({
      name: 'store__list_items',
      arguments: {},
    });

    expect(result.content).toBeDefined();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].type).toBe('text');
    const parsed = JSON.parse(content[0].text);
    expect(parsed).toEqual(['apple', 'banana', 'cherry']);

    await testClient.close();
  });

  it('proxied callTool with arguments reaches downstream correctly', async () => {
    const { managed, cleanup } = await createMockDownstream('store');
    cleanups.push(cleanup);

    const clients = new Map<string, ManagedClient>();
    clients.set('store', managed);

    const gateway = new McpServer(
      { name: 'reagent-test', version: '0.1.0' },
      { capabilities: { tools: {} } }
    );

    const toolProxy = new ToolProxy();
    await toolProxy.discoverAndRegister(gateway, createFakeClientManager(clients), []);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const testClient = new Client({ name: 'test', version: '1.0.0' }, { capabilities: {} });
    await gateway.connect(serverTransport);
    await testClient.connect(clientTransport);

    const result = await testClient.callTool({
      name: 'store__create_item',
      arguments: { name: 'widget', value: 42 },
    });

    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.name).toBe('widget');
    expect(parsed.value).toBe(42);
    expect(parsed.created).toBe(true);

    await testClient.close();
  });

  it('full middleware chain executes: tier classification + audit + session', async () => {
    const { managed, cleanup } = await createMockDownstream('store');
    cleanups.push(cleanup);

    const clients = new Map<string, ManagedClient>();
    clients.set('store', managed);

    const gatewayConfig: GatewayConfig = {
      version: '1',
      servers: {
        store: {
          command: 'node',
          args: [],
          tool_overrides: {
            list_items: { tier: Tier.Read },
            create_item: { tier: Tier.Write },
            delete_item: { tier: Tier.Destructive },
          },
        },
      },
    };

    const policy: Policy = {
      version: '1',
      profile: 'test',
      installed_by: 'test',
      installed_at: new Date().toISOString(),
      autonomy_level: AutonomyLevel.L3,
      max_autonomy_level: AutonomyLevel.L3,
      promotion_requires_human_approval: false,
      blocked_paths: [],
      notification_channel: '',
      block_ai_attribution: false,
    };

    const middlewares: Middleware[] = [
      createSessionMiddleware(),
      createKillSwitchMiddleware(tmpDir),
      createTierMiddleware(gatewayConfig),
      createPolicyMiddleware(policy, gatewayConfig),
      redactMiddleware,
      createAuditMiddleware(tmpDir),
    ];

    const gateway = new McpServer(
      { name: 'reagent-test', version: '0.1.0' },
      { capabilities: { tools: {} } }
    );

    const toolProxy = new ToolProxy();
    await toolProxy.discoverAndRegister(gateway, createFakeClientManager(clients), middlewares);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const testClient = new Client({ name: 'test', version: '1.0.0' }, { capabilities: {} });
    await gateway.connect(serverTransport);
    await testClient.connect(clientTransport);

    // Call a read-tier tool
    const result = await testClient.callTool({
      name: 'store__list_items',
      arguments: {},
    });

    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].type).toBe('text');

    // Verify audit record was written
    const auditDir = path.join(tmpDir, '.reagent', 'audit');
    expect(fs.existsSync(auditDir)).toBe(true);
    const auditFiles = fs.readdirSync(auditDir);
    expect(auditFiles.length).toBeGreaterThanOrEqual(1);

    const auditContent = fs.readFileSync(path.join(auditDir, auditFiles[0]), 'utf8').trim();
    const record = JSON.parse(auditContent.split('\n')[0]);
    expect(record.tool_name).toBe('list_items');
    expect(record.server_name).toBe('store');
    expect(record.status).toBe('allowed');
    expect(record.session_id).toBeTruthy();
    expect(record.hash).toBeTruthy();

    await testClient.close();
  });

  it('kill switch denies tool calls when HALT file exists', async () => {
    const { managed, cleanup } = await createMockDownstream('store');
    cleanups.push(cleanup);

    const clients = new Map<string, ManagedClient>();
    clients.set('store', managed);

    const middlewares: Middleware[] = [
      createSessionMiddleware(),
      createKillSwitchMiddleware(tmpDir),
    ];

    const gateway = new McpServer(
      { name: 'reagent-test', version: '0.1.0' },
      { capabilities: { tools: {} } }
    );

    const toolProxy = new ToolProxy();
    await toolProxy.discoverAndRegister(gateway, createFakeClientManager(clients), middlewares);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const testClient = new Client({ name: 'test', version: '1.0.0' }, { capabilities: {} });
    await gateway.connect(serverTransport);
    await testClient.connect(clientTransport);

    // Create the HALT file
    fs.writeFileSync(path.join(tmpDir, '.reagent', 'HALT'), 'Emergency stop for testing');

    const result = await testClient.callTool({
      name: 'store__list_items',
      arguments: {},
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('[DENIED]');
    expect(content[0].text).toContain('Kill switch active');

    await testClient.close();
  });

  it('policy middleware denies destructive tools at L0 autonomy', async () => {
    const { managed, cleanup } = await createMockDownstream('store');
    cleanups.push(cleanup);

    const clients = new Map<string, ManagedClient>();
    clients.set('store', managed);

    const gatewayConfig: GatewayConfig = {
      version: '1',
      servers: {
        store: {
          command: 'node',
          args: [],
          tool_overrides: {
            delete_item: { tier: Tier.Destructive },
          },
        },
      },
    };

    const policy: Policy = {
      version: '1',
      profile: 'test',
      installed_by: 'test',
      installed_at: new Date().toISOString(),
      autonomy_level: AutonomyLevel.L0, // read-only
      max_autonomy_level: AutonomyLevel.L3,
      promotion_requires_human_approval: false,
      blocked_paths: [],
      notification_channel: '',
      block_ai_attribution: false,
    };

    const middlewares: Middleware[] = [
      createSessionMiddleware(),
      createKillSwitchMiddleware(tmpDir),
      createTierMiddleware(gatewayConfig),
      createPolicyMiddleware(policy, gatewayConfig),
    ];

    const gateway = new McpServer(
      { name: 'reagent-test', version: '0.1.0' },
      { capabilities: { tools: {} } }
    );

    const toolProxy = new ToolProxy();
    await toolProxy.discoverAndRegister(gateway, createFakeClientManager(clients), middlewares);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const testClient = new Client({ name: 'test', version: '1.0.0' }, { capabilities: {} });
    await gateway.connect(serverTransport);
    await testClient.connect(clientTransport);

    // Attempt to call destructive tool — should be denied
    const result = await testClient.callTool({
      name: 'store__delete_item',
      arguments: { id: 'item-001' },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('[DENIED]');
    expect(content[0].text).toContain('does not allow destructive-tier');

    await testClient.close();
  });

  it('tools/list returns all namespaced tools from downstream', async () => {
    const { managed, cleanup } = await createMockDownstream('myserver');
    cleanups.push(cleanup);

    const clients = new Map<string, ManagedClient>();
    clients.set('myserver', managed);

    const gateway = new McpServer(
      { name: 'reagent-test', version: '0.1.0' },
      { capabilities: { tools: {} } }
    );

    const toolProxy = new ToolProxy();
    await toolProxy.discoverAndRegister(gateway, createFakeClientManager(clients), []);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const testClient = new Client({ name: 'test', version: '1.0.0' }, { capabilities: {} });
    await gateway.connect(serverTransport);
    await testClient.connect(clientTransport);

    const toolsList = await testClient.listTools();
    const toolNames = toolsList.tools.map((t) => t.name).sort();

    expect(toolNames).toEqual([
      'myserver__create_item',
      'myserver__delete_item',
      'myserver__list_items',
    ]);

    // Verify descriptions were preserved
    const listItemsTool = toolsList.tools.find((t) => t.name === 'myserver__list_items');
    expect(listItemsTool?.description).toBe('Lists items from the database');

    await testClient.close();
  });
});
