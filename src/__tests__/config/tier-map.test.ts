import { describe, it, expect } from 'vitest';
import { classifyTool, isToolBlocked } from '../../config/tier-map.js';
import { Tier } from '../../types/index.js';
import type { GatewayConfig } from '../../types/index.js';

describe('classifyTool', () => {
  it('classifies known read tools', () => {
    expect(classifyTool('get_messages', 'discord-ops')).toBe(Tier.Read);
    expect(classifyTool('list_channels', 'discord-ops')).toBe(Tier.Read);
    expect(classifyTool('health_check', 'discord-ops')).toBe(Tier.Read);
  });

  it('classifies known write tools', () => {
    expect(classifyTool('send_message', 'discord-ops')).toBe(Tier.Write);
    expect(classifyTool('create_channel', 'discord-ops')).toBe(Tier.Write);
  });

  it('classifies known destructive tools', () => {
    expect(classifyTool('delete_channel', 'discord-ops')).toBe(Tier.Destructive);
    expect(classifyTool('ban_member', 'discord-ops')).toBe(Tier.Destructive);
    expect(classifyTool('purge_messages', 'discord-ops')).toBe(Tier.Destructive);
  });

  it('defaults unknown tools to Write', () => {
    expect(classifyTool('unknown_tool', 'some-server')).toBe(Tier.Write);
  });

  it('strips server prefix for lookup', () => {
    expect(classifyTool('discord-ops__get_messages', 'discord-ops')).toBe(Tier.Read);
  });

  it('respects gateway config overrides', () => {
    const config: GatewayConfig = {
      version: '1',
      servers: {
        'test-server': {
          command: 'echo',
          args: [],
          tool_overrides: {
            send_message: { tier: Tier.Destructive },
          },
        },
      },
    };

    expect(classifyTool('send_message', 'test-server', config)).toBe(Tier.Destructive);
  });
});

describe('isToolBlocked', () => {
  it('returns false when no override', () => {
    expect(isToolBlocked('send_message', 'discord-ops')).toBe(false);
  });

  it('returns true when blocked in config', () => {
    const config: GatewayConfig = {
      version: '1',
      servers: {
        'test-server': {
          command: 'echo',
          args: [],
          tool_overrides: {
            dangerous_tool: { blocked: true },
          },
        },
      },
    };

    expect(isToolBlocked('dangerous_tool', 'test-server', config)).toBe(true);
  });
});
