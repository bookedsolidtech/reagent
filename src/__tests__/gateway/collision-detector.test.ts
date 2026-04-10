import { describe, it, expect, vi } from 'vitest';
import { detectToolCollisions } from '../../gateway/collision-detector.js';
import type { ClientManager } from '../../gateway/client-manager.js';

// Suppress stderr noise during tests
vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
vi.spyOn(console, 'error').mockImplementation(() => {});

function makeMockManager(servers: Record<string, string[]>): ClientManager {
  const map = new Map(
    Object.entries(servers).map(([name, tools]) => [
      name,
      {
        name,
        client: {
          listTools: async () => ({
            tools: tools.map((t) => ({ name: t, description: '', inputSchema: {} })),
          }),
        },
        transport: {} as never,
        config: {} as never,
      },
    ])
  );

  return {
    getAllClients: () => map,
  } as unknown as ClientManager;
}

describe('detectToolCollisions', () => {
  it('reports no collisions when all tool names are unique', async () => {
    const manager = makeMockManager({
      serverA: ['read_file', 'write_file'],
      serverB: ['send_email', 'list_inbox'],
    });

    const { collisions } = await detectToolCollisions(manager);
    expect(collisions).toHaveLength(0);
  });

  it('detects a collision when two servers share a tool name', async () => {
    const manager = makeMockManager({
      serverA: ['health_check', 'list_files'],
      serverB: ['health_check', 'send_message'],
    });

    const { collisions } = await detectToolCollisions(manager);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].toolName).toBe('health_check');
  });

  it('assigns primary to the first server and shadow to the second', async () => {
    const manager = makeMockManager({
      alpha: ['ping'],
      beta: ['ping'],
    });

    const { collisions } = await detectToolCollisions(manager);
    expect(collisions[0].primaryServer).toBe('alpha');
    expect(collisions[0].shadowedServer).toBe('beta');
  });

  it('namespaces the shadowed tool as serverName/toolName', async () => {
    const manager = makeMockManager({
      alpha: ['ping'],
      beta: ['ping'],
    });

    const { collisions } = await detectToolCollisions(manager);
    expect(collisions[0].namespacedName).toBe('beta/ping');
  });

  it('primary tool keeps its original name in the nameMap', async () => {
    const manager = makeMockManager({
      alpha: ['ping'],
      beta: ['ping'],
    });

    const { nameMap } = await detectToolCollisions(manager);
    expect(nameMap.get('alpha::ping')).toBe('ping');
  });

  it('shadowed tool gets prefixed name in the nameMap', async () => {
    const manager = makeMockManager({
      alpha: ['ping'],
      beta: ['ping'],
    });

    const { nameMap } = await detectToolCollisions(manager);
    expect(nameMap.get('beta::ping')).toBe('beta/ping');
  });

  it('detects multiple collisions across servers', async () => {
    const manager = makeMockManager({
      s1: ['foo', 'bar'],
      s2: ['foo', 'bar', 'baz'],
    });

    const { collisions } = await detectToolCollisions(manager);
    expect(collisions).toHaveLength(2);
    const names = collisions.map((c) => c.toolName).sort();
    expect(names).toEqual(['bar', 'foo']);
  });

  it('handles a server that fails to list tools gracefully', async () => {
    const map = new Map([
      [
        'good',
        {
          name: 'good',
          client: {
            listTools: async () => ({
              tools: [{ name: 'tool_a', description: '', inputSchema: {} }],
            }),
          },
          transport: {} as never,
          config: {} as never,
        },
      ],
      [
        'broken',
        {
          name: 'broken',
          client: {
            listTools: async () => {
              throw new Error('connection refused');
            },
          },
          transport: {} as never,
          config: {} as never,
        },
      ],
    ]);

    const manager = { getAllClients: () => map } as unknown as ClientManager;
    // Should not throw — broken server is skipped
    const { collisions } = await detectToolCollisions(manager);
    expect(collisions).toHaveLength(0);
  });
});
