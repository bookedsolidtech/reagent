import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../../..');

/**
 * E2E smoke test: spawns the actual `reagent serve` CLI as a child process,
 * connects via stdio MCP transport, and verifies end-to-end behavior.
 *
 * This test requires:
 * 1. A built dist/ directory (runs `npm run build` in beforeAll)
 * 2. A mock downstream MCP server script
 * 3. Temp directory with valid policy.yaml and gateway.yaml
 */
describe('E2E smoke — real CLI process', () => {
  let tmpDir: string;
  let mockServerScript: string;

  beforeAll(async () => {
    // Build only if dist/ is absent. CI always builds before running tests; rebuilding
    // concurrently with other test files causes a race condition where a partially-written
    // dist file can be read by a concurrent subprocess (e.g. init.test.ts).
    const distCli = path.join(projectRoot, 'dist', 'cli', 'index.js');
    if (!fs.existsSync(distCli)) {
      const { execSync } = await import('node:child_process');
      execSync('npm run build', { cwd: projectRoot, stdio: 'pipe' });
    }

    // Write a mock downstream MCP server script.
    // Placed in the source tree so it can resolve node_modules; cleaned up in afterAll.
    mockServerScript = path.join(projectRoot, 'src/__tests__/gateway/_mock-downstream.mjs');
    fs.writeFileSync(
      mockServerScript,
      `
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer(
  { name: 'mock-downstream', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

// Read-tier tool
server.tool('health_check', 'Returns health status', {}, async () => ({
  content: [{ type: 'text', text: JSON.stringify({ healthy: true }) }],
}));

// Write-tier tool
server.tool('send_message', 'Sends a message', { text: z.string() }, async ({ text }) => ({
  content: [{ type: 'text', text: JSON.stringify({ sent: true, text }) }],
}));

// Destructive-tier tool
server.tool('delete_channel', 'Deletes a channel', { id: z.string() }, async ({ id }) => ({
  content: [{ type: 'text', text: JSON.stringify({ deleted: true, id }) }],
}));

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[mock-downstream] Ready on stdio');
`
    );
  }, 60_000);

  afterAll(() => {
    // Clean up the mock server script from temp
    try {
      fs.unlinkSync(mockServerScript);
    } catch {
      // Ignore — may already be cleaned up
    }
  });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reagent-e2e-'));
    const reagentDir = path.join(tmpDir, '.reagent');
    fs.mkdirSync(reagentDir, { recursive: true });

    // Write policy.yaml
    fs.writeFileSync(
      path.join(reagentDir, 'policy.yaml'),
      `version: "1"
profile: test-e2e
installed_by: test-runner
installed_at: "2026-04-09T00:00:00Z"
autonomy_level: L3
max_autonomy_level: L3
promotion_requires_human_approval: false
blocked_paths: []
notification_channel: ""
`
    );

    // Write gateway.yaml pointing to the mock downstream
    fs.writeFileSync(
      path.join(reagentDir, 'gateway.yaml'),
      `version: "1"
servers:
  mock:
    command: node
    args:
      - "${mockServerScript.replace(/\\/g, '/')}"
    tool_overrides:
      health_check:
        tier: read
      send_message:
        tier: write
      delete_channel:
        tier: destructive
`
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('spawns gateway, lists tools, calls a tool, and gets a result', async () => {
    const cliPath = path.join(projectRoot, 'dist/cli/index.js');

    // Connect to the gateway as an MCP client via stdio
    const transport = new StdioClientTransport({
      command: 'node',
      args: [cliPath, 'serve'],
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)),
        HOME: tmpDir,
      },
      cwd: tmpDir,
    });

    const client = new Client({ name: 'e2e-test-client', version: '1.0.0' }, { capabilities: {} });

    await client.connect(transport);

    try {
      // List tools — should see namespaced tools from mock downstream
      const toolsList = await client.listTools();
      const toolNames = toolsList.tools.map((t) => t.name).sort();

      expect(toolNames).toContain('mock__health_check');
      expect(toolNames).toContain('mock__send_message');
      expect(toolNames).toContain('mock__delete_channel');
      // 10 native tools (task_* + repo_scaffold + project_sync + discord_notify + obsidian_sync) + 3 proxied tools from mock server
      expect(toolNames.length).toBe(13);

      // Call health_check (read-tier)
      const healthResult = await client.callTool({
        name: 'mock__health_check',
        arguments: {},
      });

      expect(healthResult.isError).toBeFalsy();
      const healthContent = healthResult.content as Array<{ type: string; text: string }>;
      const healthData = JSON.parse(healthContent[0].text);
      expect(healthData.healthy).toBe(true);

      // Call send_message (write-tier) with arguments
      const sendResult = await client.callTool({
        name: 'mock__send_message',
        arguments: { text: 'hello from e2e test' },
      });

      expect(sendResult.isError).toBeFalsy();
      const sendContent = sendResult.content as Array<{ type: string; text: string }>;
      const sendData = JSON.parse(sendContent[0].text);
      expect(sendData.sent).toBe(true);
      expect(sendData.text).toBe('hello from e2e test');

      // Verify audit log was written
      const auditDir = path.join(tmpDir, '.reagent', 'audit');
      expect(fs.existsSync(auditDir)).toBe(true);
      const auditFiles = fs.readdirSync(auditDir).filter((f) => f.endsWith('.jsonl'));
      expect(auditFiles.length).toBeGreaterThanOrEqual(1);

      const auditLines = fs
        .readFileSync(path.join(auditDir, auditFiles[0]), 'utf8')
        .trim()
        .split('\n');
      // We made 2 calls
      expect(auditLines.length).toBeGreaterThanOrEqual(2);

      const firstRecord = JSON.parse(auditLines[0]);
      expect(firstRecord.tool_name).toBe('health_check');
      expect(firstRecord.server_name).toBe('mock');
      expect(firstRecord.status).toBe('allowed');
    } finally {
      await client.close();
    }
  }, 30_000);

  it('kill switch denies tool calls via real CLI process', async () => {
    const cliPath = path.join(projectRoot, 'dist/cli/index.js');

    // Pre-create the HALT file before starting the gateway
    fs.writeFileSync(path.join(tmpDir, '.reagent', 'HALT'), 'E2E test kill switch');

    const transport = new StdioClientTransport({
      command: 'node',
      args: [cliPath, 'serve'],
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)),
        HOME: tmpDir,
      },
      cwd: tmpDir,
    });

    const client = new Client({ name: 'e2e-test-client', version: '1.0.0' }, { capabilities: {} });

    await client.connect(transport);

    try {
      // Tool listing should still work (middleware only applies to callTool)
      const toolsList = await client.listTools();
      // 10 native tools (task_* + repo_scaffold + project_sync + discord_notify + obsidian_sync) + 3 proxied tools
      expect(toolsList.tools.length).toBe(13);

      // But calling a tool should be denied
      const result = await client.callTool({
        name: 'mock__health_check',
        arguments: {},
      });

      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0].text).toContain('[DENIED]');
      expect(content[0].text).toContain('Kill switch active');
    } finally {
      await client.close();
    }
  }, 30_000);

  it('policy enforcement works through real CLI — L0 denies write tools', async () => {
    // Rewrite policy with L0 autonomy
    fs.writeFileSync(
      path.join(tmpDir, '.reagent', 'policy.yaml'),
      `version: "1"
profile: test-e2e-restricted
installed_by: test-runner
installed_at: "2026-04-09T00:00:00Z"
autonomy_level: L0
max_autonomy_level: L3
promotion_requires_human_approval: false
blocked_paths: []
notification_channel: ""
`
    );

    const cliPath = path.join(projectRoot, 'dist/cli/index.js');

    const transport = new StdioClientTransport({
      command: 'node',
      args: [cliPath, 'serve'],
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)),
        HOME: tmpDir,
      },
      cwd: tmpDir,
    });

    const client = new Client({ name: 'e2e-test-client', version: '1.0.0' }, { capabilities: {} });

    await client.connect(transport);

    try {
      // Read-tier: should be allowed
      const readResult = await client.callTool({
        name: 'mock__health_check',
        arguments: {},
      });
      expect(readResult.isError).toBeFalsy();

      // Write-tier: should be denied at L0
      const writeResult = await client.callTool({
        name: 'mock__send_message',
        arguments: { text: 'should fail' },
      });
      expect(writeResult.isError).toBe(true);
      const content = writeResult.content as Array<{ type: string; text: string }>;
      expect(content[0].text).toContain('[DENIED]');
      expect(content[0].text).toContain('does not allow write-tier');

      // Destructive-tier: should also be denied
      const destructiveResult = await client.callTool({
        name: 'mock__delete_channel',
        arguments: { id: 'ch-1' },
      });
      expect(destructiveResult.isError).toBe(true);
    } finally {
      await client.close();
    }
  }, 30_000);
});
