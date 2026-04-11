import fs from 'node:fs';
import path from 'node:path';
import type { InstallResult } from './types.js';

/**
 * The reagent MCP server entry to write into .mcp.json.
 *
 * Uses stdio transport so Claude Code spawns `reagent serve` directly —
 * no daemon required, works immediately after `reagent init`.
 *
 * `npx reagent serve` resolves in order:
 *   1. ./node_modules/.bin/reagent  (local install)
 *   2. PATH reagent                 (global install)
 *
 * This means the committed .mcp.json works on any machine regardless of
 * whether reagent was installed locally or globally.
 */
const REAGENT_MCP_ENTRY = {
  type: 'stdio',
  command: 'npx',
  args: ['reagent', 'serve'],
} as const;

/**
 * Write (or merge into) .mcp.json in `targetDir` with a reagent stdio entry.
 *
 * Idempotent:
 *  - If .mcp.json doesn't exist: creates it with the reagent entry.
 *  - If .mcp.json exists but has no `mcpServers.reagent` key: adds the entry.
 *  - If .mcp.json already has a `mcpServers.reagent` key: skips (preserves existing).
 */
export function installMcpJson(targetDir: string, dryRun: boolean): InstallResult[] {
  const mcpPath = path.join(targetDir, '.mcp.json');

  // Case 1: file exists — check if reagent already registered
  if (fs.existsSync(mcpPath)) {
    let existing: { mcpServers?: Record<string, unknown> };
    try {
      existing = JSON.parse(fs.readFileSync(mcpPath, 'utf8')) as {
        mcpServers?: Record<string, unknown>;
      };
    } catch {
      // Unparseable .mcp.json — don't overwrite; warn and bail
      return [{ file: '.mcp.json', status: 'warn' }];
    }

    if (existing.mcpServers?.reagent) {
      // Already configured — leave it alone
      return [{ file: '.mcp.json', status: 'skipped' }];
    }

    // Add reagent entry to existing file
    existing.mcpServers = existing.mcpServers ?? {};
    existing.mcpServers.reagent = REAGENT_MCP_ENTRY;

    if (!dryRun) {
      fs.writeFileSync(mcpPath, JSON.stringify(existing, null, 2) + '\n');
    }
    return [{ file: '.mcp.json', status: 'updated' }];
  }

  // Case 2: file doesn't exist — create it
  const config = {
    mcpServers: {
      reagent: REAGENT_MCP_ENTRY,
    },
  };

  if (!dryRun) {
    fs.writeFileSync(mcpPath, JSON.stringify(config, null, 2) + '\n');
  }
  return [{ file: '.mcp.json', status: 'installed' }];
}
