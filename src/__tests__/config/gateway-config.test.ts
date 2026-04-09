import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadGatewayConfig } from '../../config/gateway-config.js';

describe('loadGatewayConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reagent-test-'));
    fs.mkdirSync(path.join(tmpDir, '.reagent'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parses a valid gateway.yaml', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.reagent', 'gateway.yaml'),
      `
version: "1"
servers:
  test-server:
    command: echo
    args: ["hello"]
`
    );

    const config = loadGatewayConfig(tmpDir);
    expect(config.version).toBe('1');
    expect(config.servers['test-server']).toBeDefined();
    expect(config.servers['test-server'].command).toBe('echo');
    expect(config.servers['test-server'].args).toEqual(['hello']);
  });

  it('resolves environment variables', () => {
    process.env.TEST_REAGENT_VAR = 'resolved-value';

    fs.writeFileSync(
      path.join(tmpDir, '.reagent', 'gateway.yaml'),
      `
version: "1"
servers:
  test-server:
    command: echo
    args: []
    env:
      MY_VAR: "\${TEST_REAGENT_VAR}"
`
    );

    const config = loadGatewayConfig(tmpDir);
    expect(config.servers['test-server'].env?.MY_VAR).toBe('resolved-value');

    delete process.env.TEST_REAGENT_VAR;
  });

  it('throws if config file is missing', () => {
    expect(() => loadGatewayConfig(tmpDir + '/nonexistent')).toThrow('Gateway config not found');
  });
});
