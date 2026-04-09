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
import type { GatewayConfig, Policy, AuditRecord } from '../../types/index.js';

/**
 * Helper: create a downstream MCP server with tools spanning all three tiers.
 */
async function createDownstream(serverName: string) {
  const downstream = new McpServer(
    { name: serverName, version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  // Read-tier
  downstream.tool('get_status', 'Returns system status', {}, async () => ({
    content: [
      { type: 'text' as const, text: JSON.stringify({ status: 'healthy', uptime: 12345 }) },
    ],
  }));

  downstream.tool(
    'search_records',
    'Search records by query',
    { query: z.string() },
    async ({ query }) => ({
      content: [
        { type: 'text' as const, text: JSON.stringify({ query, results: ['rec-1', 'rec-2'] }) },
      ],
    })
  );

  // Write-tier
  downstream.tool(
    'send_notification',
    'Send a notification',
    { message: z.string(), channel: z.string() },
    async ({ message, channel }) => ({
      content: [{ type: 'text' as const, text: JSON.stringify({ sent: true, message, channel }) }],
    })
  );

  // Destructive-tier
  downstream.tool(
    'purge_records',
    'Permanently delete all records',
    { confirm: z.boolean() },
    async ({ confirm }) => ({
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ purged: confirm, count: confirm ? 42 : 0 }),
        },
      ],
    })
  );

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: `proxy-${serverName}`, version: '1.0.0' },
    { capabilities: {} }
  );

  await downstream.connect(serverTransport);
  await client.connect(clientTransport);

  const managed: ManagedClient = {
    name: serverName,
    client,
    transport: clientTransport as any,
    config: {
      command: 'node',
      args: [],
      tool_overrides: {
        get_status: { tier: Tier.Read },
        search_records: { tier: Tier.Read },
        send_notification: { tier: Tier.Write },
        purge_records: { tier: Tier.Destructive },
      },
    },
  };

  return {
    managed,
    downstream,
    cleanup: async () => {
      await client.close();
      await downstream.close();
    },
  };
}

function makeFakeClientManager(clients: Map<string, ManagedClient>): ClientManager {
  return {
    getAllClients: () => clients,
    getClient: (name: string) => clients.get(name),
    connectAll: async () => clients,
    disconnectAll: async () => {
      for (const [, m] of clients) {
        await m.client.close();
      }
    },
  } as unknown as ClientManager;
}

/**
 * Builds a fully configured gateway (McpServer + ToolProxy + middleware chain)
 * and returns a test MCP client connected to it.
 */
async function buildGatewayStack(opts: {
  tmpDir: string;
  gatewayConfig: GatewayConfig;
  policy: Policy;
  clients: Map<string, ManagedClient>;
}) {
  const { tmpDir, gatewayConfig, policy, clients } = opts;

  // SECURITY: Audit is outermost so it records ALL invocations, including denials.
  const middlewares: Middleware[] = [
    createAuditMiddleware(tmpDir),
    createSessionMiddleware(),
    createKillSwitchMiddleware(tmpDir),
    createTierMiddleware(gatewayConfig),
    createPolicyMiddleware(policy, gatewayConfig),
    redactMiddleware,
  ];

  const gateway = new McpServer(
    { name: 'reagent', version: '0.2.0' },
    { capabilities: { tools: {} } }
  );

  const toolProxy = new ToolProxy();
  const toolCount = await toolProxy.discoverAndRegister(
    gateway,
    makeFakeClientManager(clients),
    middlewares
  );

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const testClient = new Client(
    { name: 'integration-test', version: '1.0.0' },
    { capabilities: {} }
  );
  await gateway.connect(serverTransport);
  await testClient.connect(clientTransport);

  return { gateway, testClient, toolProxy, toolCount };
}

describe('Gateway server — full integration', () => {
  let tmpDir: string;
  let cleanups: Array<() => Promise<void>>;

  const defaultPolicy: Policy = {
    version: '1',
    profile: 'test',
    installed_by: 'test-runner',
    installed_at: new Date().toISOString(),
    autonomy_level: AutonomyLevel.L3,
    max_autonomy_level: AutonomyLevel.L3,
    promotion_requires_human_approval: false,
    blocked_paths: [],
    notification_channel: '',
    block_ai_attribution: false,
  };

  const defaultGatewayConfig: GatewayConfig = {
    version: '1',
    servers: {
      backend: {
        command: 'node',
        args: [],
        tool_overrides: {
          get_status: { tier: Tier.Read },
          search_records: { tier: Tier.Read },
          send_notification: { tier: Tier.Write },
          purge_records: { tier: Tier.Destructive },
        },
      },
    },
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reagent-server-'));
    fs.mkdirSync(path.join(tmpDir, '.reagent'), { recursive: true });
    cleanups = [];
  });

  afterEach(async () => {
    for (const fn of cleanups) {
      await fn();
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('tools/list returns all namespaced downstream tools', async () => {
    const { managed, cleanup } = await createDownstream('backend');
    cleanups.push(cleanup);

    const clients = new Map<string, ManagedClient>();
    clients.set('backend', managed);

    const { testClient, toolCount } = await buildGatewayStack({
      tmpDir,
      gatewayConfig: defaultGatewayConfig,
      policy: defaultPolicy,
      clients,
    });
    cleanups.push(async () => testClient.close());

    expect(toolCount).toBe(4);

    const toolsList = await testClient.listTools();
    const toolNames = toolsList.tools.map((t) => t.name).sort();
    expect(toolNames).toEqual([
      'backend__get_status',
      'backend__purge_records',
      'backend__search_records',
      'backend__send_notification',
    ]);
  });

  it('callTool goes through full middleware chain and returns downstream result', async () => {
    const { managed, cleanup } = await createDownstream('backend');
    cleanups.push(cleanup);

    const clients = new Map<string, ManagedClient>();
    clients.set('backend', managed);

    const { testClient } = await buildGatewayStack({
      tmpDir,
      gatewayConfig: defaultGatewayConfig,
      policy: defaultPolicy,
      clients,
    });
    cleanups.push(async () => testClient.close());

    // Call read-tier tool
    const result = await testClient.callTool({
      name: 'backend__get_status',
      arguments: {},
    });

    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.status).toBe('healthy');
    expect(parsed.uptime).toBe(12345);
  });

  it('callTool with arguments passes them through to downstream', async () => {
    const { managed, cleanup } = await createDownstream('backend');
    cleanups.push(cleanup);

    const clients = new Map<string, ManagedClient>();
    clients.set('backend', managed);

    const { testClient } = await buildGatewayStack({
      tmpDir,
      gatewayConfig: defaultGatewayConfig,
      policy: defaultPolicy,
      clients,
    });
    cleanups.push(async () => testClient.close());

    const result = await testClient.callTool({
      name: 'backend__search_records',
      arguments: { query: 'test-query' },
    });

    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.query).toBe('test-query');
    expect(parsed.results).toEqual(['rec-1', 'rec-2']);
  });

  it('audit JSONL file is written with correct fields after a tool call', async () => {
    const { managed, cleanup } = await createDownstream('backend');
    cleanups.push(cleanup);

    const clients = new Map<string, ManagedClient>();
    clients.set('backend', managed);

    const { testClient } = await buildGatewayStack({
      tmpDir,
      gatewayConfig: defaultGatewayConfig,
      policy: defaultPolicy,
      clients,
    });
    cleanups.push(async () => testClient.close());

    // Make a call to generate an audit record
    await testClient.callTool({
      name: 'backend__send_notification',
      arguments: { message: 'hello', channel: '#general' },
    });

    // Read audit file
    const auditDir = path.join(tmpDir, '.reagent', 'audit');
    expect(fs.existsSync(auditDir)).toBe(true);

    const auditFiles = fs.readdirSync(auditDir).filter((f) => f.endsWith('.jsonl'));
    expect(auditFiles.length).toBeGreaterThanOrEqual(1);

    const lines = fs.readFileSync(path.join(auditDir, auditFiles[0]), 'utf8').trim().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(1);

    const record: AuditRecord = JSON.parse(lines[lines.length - 1]);
    expect(record.tool_name).toBe('send_notification');
    expect(record.server_name).toBe('backend');
    expect(record.tier).toBe('write');
    expect(record.status).toBe('allowed');
    expect(record.session_id).toBeTruthy();
    expect(record.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(record.duration_ms).toBeGreaterThanOrEqual(0);
    expect(record.hash).toHaveLength(64);
    expect(record.prev_hash).toHaveLength(64);
  });

  it('audit records are hash-chained across multiple calls', async () => {
    const { managed, cleanup } = await createDownstream('backend');
    cleanups.push(cleanup);

    const clients = new Map<string, ManagedClient>();
    clients.set('backend', managed);

    const { testClient } = await buildGatewayStack({
      tmpDir,
      gatewayConfig: defaultGatewayConfig,
      policy: defaultPolicy,
      clients,
    });
    cleanups.push(async () => testClient.close());

    // Make two calls
    await testClient.callTool({ name: 'backend__get_status', arguments: {} });
    await testClient.callTool({ name: 'backend__search_records', arguments: { query: 'foo' } });

    const auditDir = path.join(tmpDir, '.reagent', 'audit');
    const auditFiles = fs.readdirSync(auditDir).filter((f) => f.endsWith('.jsonl'));
    const lines = fs.readFileSync(path.join(auditDir, auditFiles[0]), 'utf8').trim().split('\n');

    // Find at least 2 records
    expect(lines.length).toBeGreaterThanOrEqual(2);

    const lastTwo = lines.slice(-2).map((l) => JSON.parse(l) as AuditRecord);
    expect(lastTwo[1].prev_hash).toBe(lastTwo[0].hash);
  });

  it('kill switch denies all tool calls when HALT file exists', async () => {
    const { managed, cleanup } = await createDownstream('backend');
    cleanups.push(cleanup);

    const clients = new Map<string, ManagedClient>();
    clients.set('backend', managed);

    const { testClient } = await buildGatewayStack({
      tmpDir,
      gatewayConfig: defaultGatewayConfig,
      policy: defaultPolicy,
      clients,
    });
    cleanups.push(async () => testClient.close());

    // Activate kill switch
    fs.writeFileSync(
      path.join(tmpDir, '.reagent', 'HALT'),
      'Security incident (frozen at 2026-04-09T00:00:00.000Z)'
    );

    // Attempt tool call
    const result = await testClient.callTool({
      name: 'backend__get_status',
      arguments: {},
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('[DENIED]');
    expect(content[0].text).toContain('Kill switch active');
    expect(content[0].text).toContain('Security incident');
  });

  it('kill switch denial is still audited (audit is outermost middleware)', async () => {
    const { managed, cleanup } = await createDownstream('backend');
    cleanups.push(cleanup);

    const clients = new Map<string, ManagedClient>();
    clients.set('backend', managed);

    const { testClient } = await buildGatewayStack({
      tmpDir,
      gatewayConfig: defaultGatewayConfig,
      policy: defaultPolicy,
      clients,
    });
    cleanups.push(async () => testClient.close());

    // First make a successful call so audit dir exists
    await testClient.callTool({ name: 'backend__get_status', arguments: {} });

    const auditDir = path.join(tmpDir, '.reagent', 'audit');
    const auditFiles = fs.readdirSync(auditDir).filter((f) => f.endsWith('.jsonl'));
    const linesBefore = fs
      .readFileSync(path.join(auditDir, auditFiles[0]), 'utf8')
      .trim()
      .split('\n');
    const countBefore = linesBefore.length;

    // Activate kill switch
    fs.writeFileSync(path.join(tmpDir, '.reagent', 'HALT'), 'test halt');

    const result = await testClient.callTool({ name: 'backend__get_status', arguments: {} });

    // The call was denied
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('[DENIED]');

    // SECURITY: Audit is now outermost middleware, so kill-switch denials ARE audited.
    // This is critical for compliance — every invocation must be recorded.
    const linesAfter = fs
      .readFileSync(path.join(auditDir, auditFiles[0]), 'utf8')
      .trim()
      .split('\n');
    expect(linesAfter.length).toBe(countBefore + 1);

    // The new audit record should show the denial
    const deniedRecord = JSON.parse(linesAfter[linesAfter.length - 1]) as AuditRecord;
    expect(deniedRecord.status).toBe('denied');
    expect(deniedRecord.error).toContain('Kill switch active');
  });

  it('policy denies destructive tools at L0 and allows read tools', async () => {
    const { managed, cleanup } = await createDownstream('backend');
    cleanups.push(cleanup);

    const clients = new Map<string, ManagedClient>();
    clients.set('backend', managed);

    const restrictedPolicy: Policy = {
      ...defaultPolicy,
      autonomy_level: AutonomyLevel.L0,
    };

    const { testClient } = await buildGatewayStack({
      tmpDir,
      gatewayConfig: defaultGatewayConfig,
      policy: restrictedPolicy,
      clients,
    });
    cleanups.push(async () => testClient.close());

    // Read should work
    const readResult = await testClient.callTool({
      name: 'backend__get_status',
      arguments: {},
    });
    expect(readResult.isError).toBeFalsy();

    // Write should be denied at L0
    const writeResult = await testClient.callTool({
      name: 'backend__send_notification',
      arguments: { message: 'test', channel: '#test' },
    });
    expect(writeResult.isError).toBe(true);
    const writeContent = writeResult.content as Array<{ type: string; text: string }>;
    expect(writeContent[0].text).toContain('[DENIED]');

    // Destructive should be denied at L0
    const destructiveResult = await testClient.callTool({
      name: 'backend__purge_records',
      arguments: { confirm: true },
    });
    expect(destructiveResult.isError).toBe(true);
    const destructiveContent = destructiveResult.content as Array<{ type: string; text: string }>;
    expect(destructiveContent[0].text).toContain('[DENIED]');
    expect(destructiveContent[0].text).toContain('destructive-tier');
  });

  it('policy at L1 allows read+write but denies destructive', async () => {
    const { managed, cleanup } = await createDownstream('backend');
    cleanups.push(cleanup);

    const clients = new Map<string, ManagedClient>();
    clients.set('backend', managed);

    const l1Policy: Policy = {
      ...defaultPolicy,
      autonomy_level: AutonomyLevel.L1,
    };

    const { testClient } = await buildGatewayStack({
      tmpDir,
      gatewayConfig: defaultGatewayConfig,
      policy: l1Policy,
      clients,
    });
    cleanups.push(async () => testClient.close());

    // Read: allowed
    const readResult = await testClient.callTool({
      name: 'backend__get_status',
      arguments: {},
    });
    expect(readResult.isError).toBeFalsy();

    // Write: allowed
    const writeResult = await testClient.callTool({
      name: 'backend__send_notification',
      arguments: { message: 'test', channel: '#test' },
    });
    expect(writeResult.isError).toBeFalsy();

    // Destructive: denied
    const destructiveResult = await testClient.callTool({
      name: 'backend__purge_records',
      arguments: { confirm: true },
    });
    expect(destructiveResult.isError).toBe(true);
  });

  it('blocked tool is denied even at L3 autonomy', async () => {
    const { managed, cleanup } = await createDownstream('backend');
    cleanups.push(cleanup);

    const clients = new Map<string, ManagedClient>();
    clients.set('backend', managed);

    const configWithBlocked: GatewayConfig = {
      version: '1',
      servers: {
        backend: {
          command: 'node',
          args: [],
          tool_overrides: {
            get_status: { tier: Tier.Read },
            purge_records: { tier: Tier.Destructive, blocked: true },
          },
        },
      },
    };

    const { testClient } = await buildGatewayStack({
      tmpDir,
      gatewayConfig: configWithBlocked,
      policy: defaultPolicy,
      clients,
    });
    cleanups.push(async () => testClient.close());

    const result = await testClient.callTool({
      name: 'backend__purge_records',
      arguments: { confirm: true },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('[DENIED]');
    expect(content[0].text).toContain('explicitly blocked');
  });

  it('secret redaction strips sensitive data from tool output', async () => {
    // Create a downstream that returns secrets in its output
    const downstream = new McpServer(
      { name: 'leaky', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );

    downstream.tool('get_config', 'Returns config with secrets', {}, async () => ({
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            database_url: 'postgres://localhost:5432/db',
            api_key: 'api_key=test_fake_key_not_a_real_secret_1234',
            aws_key: 'AKIAIOSFODNN7EXAMPLE',
          }),
        },
      ],
    }));

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'proxy-leaky', version: '1.0.0' }, { capabilities: {} });
    await downstream.connect(serverTransport);
    await client.connect(clientTransport);

    const managed: ManagedClient = {
      name: 'leaky',
      client,
      transport: clientTransport as any,
      config: { command: 'node', args: [], tool_overrides: { get_config: { tier: Tier.Read } } },
    };

    cleanups.push(async () => {
      await client.close();
      await downstream.close();
    });

    const clients = new Map<string, ManagedClient>();
    clients.set('leaky', managed);

    const leakyGatewayConfig: GatewayConfig = {
      version: '1',
      servers: {
        leaky: {
          command: 'node',
          args: [],
          tool_overrides: { get_config: { tier: Tier.Read } },
        },
      },
    };

    const { testClient } = await buildGatewayStack({
      tmpDir,
      gatewayConfig: leakyGatewayConfig,
      policy: defaultPolicy,
      clients,
    });
    cleanups.push(async () => testClient.close());

    const result = await testClient.callTool({
      name: 'leaky__get_config',
      arguments: {},
    });

    const content = result.content as Array<{ type: string; text: string }>;
    const text = content[0].text;

    // AWS key should be redacted
    expect(text).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(text).toContain('[REDACTED]');

    // API key should be redacted
    expect(text).not.toContain('test_fake_key_not_a_real_secret_1234');
  });

  it('multiple downstream servers aggregate into a single gateway', async () => {
    const { managed: managed1, cleanup: cleanup1 } = await createDownstream('service-a');
    const { managed: managed2, cleanup: cleanup2 } = await createDownstream('service-b');
    cleanups.push(cleanup1, cleanup2);

    const clients = new Map<string, ManagedClient>();
    clients.set('service-a', managed1);
    clients.set('service-b', managed2);

    const multiConfig: GatewayConfig = {
      version: '1',
      servers: {
        'service-a': {
          command: 'node',
          args: [],
          tool_overrides: {
            get_status: { tier: Tier.Read },
            search_records: { tier: Tier.Read },
            send_notification: { tier: Tier.Write },
            purge_records: { tier: Tier.Destructive },
          },
        },
        'service-b': {
          command: 'node',
          args: [],
          tool_overrides: {
            get_status: { tier: Tier.Read },
            search_records: { tier: Tier.Read },
            send_notification: { tier: Tier.Write },
            purge_records: { tier: Tier.Destructive },
          },
        },
      },
    };

    const { testClient, toolCount } = await buildGatewayStack({
      tmpDir,
      gatewayConfig: multiConfig,
      policy: defaultPolicy,
      clients,
    });
    cleanups.push(async () => testClient.close());

    expect(toolCount).toBe(8); // 4 tools x 2 servers

    const toolsList = await testClient.listTools();
    expect(toolsList.tools.length).toBe(8);

    // Verify both namespaces are present
    const names = toolsList.tools.map((t) => t.name);
    expect(names.filter((n) => n.startsWith('service-a__'))).toHaveLength(4);
    expect(names.filter((n) => n.startsWith('service-b__'))).toHaveLength(4);

    // Call from each server independently
    const resultA = await testClient.callTool({
      name: 'service-a__get_status',
      arguments: {},
    });
    const resultB = await testClient.callTool({
      name: 'service-b__get_status',
      arguments: {},
    });

    // Both should succeed
    expect(resultA.isError).toBeFalsy();
    expect(resultB.isError).toBeFalsy();
  });
});
