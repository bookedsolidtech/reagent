import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { DaemonConfig } from '../types/daemon.js';

/** Path to the global daemon config: ~/.reagent/daemon.yaml */
function getDaemonConfigPath(): string {
  return path.join(os.homedir(), '.reagent', 'daemon.yaml');
}

const DaemonConfigSchema = z.object({
  reagent_bin: z.string().optional(),
  log_level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

/** Default config used when ~/.reagent/daemon.yaml is absent. */
const DAEMON_DEFAULTS: DaemonConfig = {
  log_level: 'info',
};

function parseRawDaemonConfig(raw: string, configPath: string): DaemonConfig {
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (yamlErr) {
    throw new Error(
      `Failed to parse daemon YAML at ${configPath}: ${yamlErr instanceof Error ? yamlErr.message : yamlErr}`
    );
  }

  try {
    // parseYaml returns null for an empty file — treat as empty object so defaults apply
    return DaemonConfigSchema.parse(parsed ?? {}) as DaemonConfig;
  } catch (zodErr) {
    throw new Error(
      `Invalid daemon config schema at ${configPath}: ${zodErr instanceof Error ? zodErr.message : zodErr}`
    );
  }
}

/**
 * Async daemon config loader.
 *
 * Reads ~/.reagent/daemon.yaml and returns a validated DaemonConfig.
 * Falls back to defaults if the file is absent.
 */
export async function loadDaemonConfigAsync(): Promise<DaemonConfig> {
  const configPath = getDaemonConfigPath();

  let raw: string;
  try {
    raw = await fsPromises.readFile(configPath, 'utf8');
  } catch {
    return { ...DAEMON_DEFAULTS };
  }

  return parseRawDaemonConfig(raw, configPath);
}

/**
 * Synchronous daemon config loader — for CLI startup paths that must be sync.
 *
 * Falls back to defaults if ~/.reagent/daemon.yaml is absent.
 */
export function loadDaemonConfig(): DaemonConfig {
  const configPath = getDaemonConfigPath();

  if (!fs.existsSync(configPath)) {
    return { ...DAEMON_DEFAULTS };
  }

  const raw = fs.readFileSync(configPath, 'utf8');
  return parseRawDaemonConfig(raw, configPath);
}
