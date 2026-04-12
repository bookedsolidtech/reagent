import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { parse as parseYaml } from 'yaml';

/**
 * Zod schema for the obsidian_vault block in gateway.yaml.
 * Every sync target defaults to false — fully opt-in.
 */
export const ObsidianVaultConfigSchema = z.object({
  enabled: z.boolean().default(false),
  vault_path: z.string().optional(),
  paths: z
    .object({
      root: z.string().default('Projects/Reagent'),
      kanban: z.string().default('Projects/Reagent/Kanban.md'),
      sources: z.string().default('Projects/Reagent/Sources'),
      wiki: z.string().default('Projects/Reagent/Auto'),
    })
    .default({}),
  sync: z
    .object({
      kanban: z.boolean().default(false),
      context_dump: z.boolean().default(false),
      wiki_refresh: z.boolean().default(false),
    })
    .default({}),
});

export type ObsidianVaultConfig = z.infer<typeof ObsidianVaultConfigSchema>;

/**
 * Resolved config with an absolute vault_path guaranteed present.
 * Only returned when the integration is fully enabled and the vault path resolves.
 */
export interface ResolvedObsidianConfig {
  vault_path: string;
  paths: ObsidianVaultConfig['paths'];
  sync: ObsidianVaultConfig['sync'];
}

/**
 * Load obsidian_vault config from .reagent/gateway.yaml.
 *
 * Resolution order for vault_path:
 *   1. REAGENT_OBSIDIAN_VAULT env var (absolute path to vault root)
 *   2. obsidian_vault.vault_path from gateway.yaml
 *   3. null → disabled
 *
 * Returns null if:
 *   - No obsidian_vault block in gateway.yaml
 *   - enabled: false
 *   - No vault path resolvable
 *   - Vault directory does not exist
 *
 * Never throws — fail-silent like Discord notifier.
 */
export function loadObsidianConfig(baseDir: string): ResolvedObsidianConfig | null {
  const gatewayPath = path.join(baseDir, '.reagent', 'gateway.yaml');
  if (!fs.existsSync(gatewayPath)) return null;

  try {
    const raw = fs.readFileSync(gatewayPath, 'utf8');
    const parsed = parseYaml(raw) as Record<string, unknown>;

    const obsidianRaw = parsed?.obsidian_vault;
    if (!obsidianRaw) return null;

    const config = ObsidianVaultConfigSchema.parse(obsidianRaw);
    if (!config.enabled) return null;

    // Resolve vault path: env var takes precedence
    const vaultPath = process.env['REAGENT_OBSIDIAN_VAULT'] || config.vault_path;
    if (!vaultPath) return null;

    // Resolve ~ to home directory
    const resolvedPath = vaultPath.startsWith('~')
      ? path.join(process.env['HOME'] || '', vaultPath.slice(1))
      : vaultPath;

    // Vault directory must exist
    if (!fs.existsSync(resolvedPath)) return null;

    return {
      vault_path: resolvedPath,
      paths: config.paths,
      sync: config.sync,
    };
  } catch {
    return null;
  }
}
