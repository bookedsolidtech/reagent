import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { Tier } from '../types/index.js';
import type { GatewayConfig } from '../types/index.js';

const ToolOverrideSchema = z.object({
  tier: z.nativeEnum(Tier).optional(),
  blocked: z.boolean().optional(),
});

const DownstreamServerSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).optional(),
  tool_overrides: z.record(ToolOverrideSchema).optional(),
  max_concurrent_calls: z.number().int().min(0).optional(),
  calls_per_minute: z.number().int().min(0).optional(),
});

const GatewayOptionsSchema = z.object({
  max_result_size_kb: z.number().int().min(1).optional(),
});

const GatewayConfigSchema = z.object({
  version: z.string(),
  servers: z.record(DownstreamServerSchema),
  gateway: GatewayOptionsSchema.optional(),
});

/**
 * Resolve `${ENV_VAR}` references in string values.
 */
function resolveEnvVars(obj: Record<string, string>): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    resolved[key] = value.replace(/\$\{([^}]+)\}/g, (_match, varName: string) => {
      const envValue = process.env[varName];
      if (envValue === undefined) {
        console.error(
          `[reagent] WARNING: env var "\${${varName}}" referenced in gateway config key "${key}" is not set — using empty string`
        );
      }
      return envValue ?? '';
    });
  }
  return resolved;
}

export function loadGatewayConfig(baseDir: string): GatewayConfig {
  const configPath = path.join(baseDir, '.reagent', 'gateway.yaml');

  if (!fs.existsSync(configPath)) {
    throw new Error(`Gateway config not found: ${configPath}`);
  }

  const raw = fs.readFileSync(configPath, 'utf8');

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (yamlErr) {
    throw new Error(
      `Failed to parse gateway YAML at ${configPath}: ${yamlErr instanceof Error ? yamlErr.message : yamlErr}`
    );
  }

  let config;
  try {
    config = GatewayConfigSchema.parse(parsed);
  } catch (zodErr) {
    throw new Error(
      `Invalid gateway config schema at ${configPath}: ${zodErr instanceof Error ? zodErr.message : zodErr}`
    );
  }

  // Resolve env vars in server env blocks
  for (const server of Object.values(config.servers)) {
    if (server.env) {
      server.env = resolveEnvVars(server.env);
    }
  }

  return config;
}
