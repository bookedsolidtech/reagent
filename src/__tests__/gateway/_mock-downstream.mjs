
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
