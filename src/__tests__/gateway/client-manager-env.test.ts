import { describe, it, expect, beforeEach, afterEach } from 'vitest';

/**
 * buildEnv is a private function inside client-manager.ts. We replicate its
 * logic here to validate the stripping / override behavior without needing to
 * spin up real MCP transports.
 */
const STRIP_FROM_DOWNSTREAM = [
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_REFRESH_TOKEN',
];

function buildEnv(configEnv?: Record<string, string>): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !STRIP_FROM_DOWNSTREAM.includes(k)) base[k] = v;
  }
  if (configEnv) Object.assign(base, configEnv);
  return base;
}

describe('buildEnv strips billing tokens from downstream', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat01-test-token';
    process.env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN = 'sk-ant-oart01-test-refresh';
    process.env.SOME_SAFE_VAR = 'keep-me';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('strips CLAUDE_CODE_OAUTH_TOKEN and CLAUDE_CODE_OAUTH_REFRESH_TOKEN', () => {
    const env = buildEnv();

    expect(env['CLAUDE_CODE_OAUTH_TOKEN']).toBeUndefined();
    expect(env['CLAUDE_CODE_OAUTH_REFRESH_TOKEN']).toBeUndefined();
  });

  it('passes through non-stripped environment variables', () => {
    const env = buildEnv();

    expect(env['SOME_SAFE_VAR']).toBe('keep-me');
    // PATH should always be present
    expect(env['PATH']).toBeDefined();
  });

  it('merges configEnv overrides into the result', () => {
    const env = buildEnv({ MY_CUSTOM: 'custom-value', ANOTHER: '42' });

    expect(env['MY_CUSTOM']).toBe('custom-value');
    expect(env['ANOTHER']).toBe('42');
    expect(env['SOME_SAFE_VAR']).toBe('keep-me');
  });

  it('configEnv overrides process.env values', () => {
    const env = buildEnv({ SOME_SAFE_VAR: 'overridden' });

    expect(env['SOME_SAFE_VAR']).toBe('overridden');
  });

  it('strips tokens even when configEnv is provided', () => {
    const env = buildEnv({ MY_CUSTOM: 'value' });

    expect(env['CLAUDE_CODE_OAUTH_TOKEN']).toBeUndefined();
    expect(env['CLAUDE_CODE_OAUTH_REFRESH_TOKEN']).toBeUndefined();
  });

  it('handles only CLAUDE_CODE_OAUTH_TOKEN being set', () => {
    delete process.env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN;

    const env = buildEnv();

    expect(env['CLAUDE_CODE_OAUTH_TOKEN']).toBeUndefined();
    expect(env['CLAUDE_CODE_OAUTH_REFRESH_TOKEN']).toBeUndefined();
    expect(env['SOME_SAFE_VAR']).toBe('keep-me');
  });

  it('handles only CLAUDE_CODE_OAUTH_REFRESH_TOKEN being set', () => {
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;

    const env = buildEnv();

    expect(env['CLAUDE_CODE_OAUTH_TOKEN']).toBeUndefined();
    expect(env['CLAUDE_CODE_OAUTH_REFRESH_TOKEN']).toBeUndefined();
    expect(env['SOME_SAFE_VAR']).toBe('keep-me');
  });

  it('handles neither token being set', () => {
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    delete process.env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN;

    const env = buildEnv();

    expect(env['CLAUDE_CODE_OAUTH_TOKEN']).toBeUndefined();
    expect(env['CLAUDE_CODE_OAUTH_REFRESH_TOKEN']).toBeUndefined();
    expect(env['SOME_SAFE_VAR']).toBe('keep-me');
  });

  it('returns empty configEnv without errors', () => {
    const env = buildEnv({});

    expect(env['SOME_SAFE_VAR']).toBe('keep-me');
    expect(env['CLAUDE_CODE_OAUTH_TOKEN']).toBeUndefined();
  });

  it('excludes process.env entries with undefined values', () => {
    // node process.env can have undefined values when iterating
    const env = buildEnv();

    for (const v of Object.values(env)) {
      expect(v).toBeDefined();
      expect(typeof v).toBe('string');
    }
  });
});
