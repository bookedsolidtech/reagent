import fs from 'node:fs';
import path from 'node:path';
import type { InstallResult } from './types.js';

/**
 * Build the reagent MCP server entry for .mcp.json.
 *
 * Uses `node` with the direct path to the dist CLI entry point.
 * This works across all package managers (npm, yarn, pnpm, bun)
 * without relying on bin symlinks or npx resolution, which breaks
 * in pnpm projects where node_modules/.bin/reagent is not created.
 */
function buildMcpEntry(targetDir: string): {
  type: 'stdio';
  command: string;
  args: string[];
} {
  // Check if reagent is installed locally (node_modules)
  const localCliPath = path.join(
    targetDir,
    'node_modules',
    '@bookedsolid',
    'reagent',
    'dist',
    'cli',
    'index.js'
  );

  if (fs.existsSync(localCliPath)) {
    // Local install — use relative path from project root
    return {
      type: 'stdio',
      command: 'node',
      args: ['node_modules/@bookedsolid/reagent/dist/cli/index.js', 'serve'],
    };
  }

  // Not installed locally — likely running via npx or global install.
  // Use npx as fallback (works for npm/yarn, auto-fetches if needed).
  return {
    type: 'stdio',
    command: 'npx',
    args: ['@bookedsolid/reagent', 'serve'],
  };
}

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
  const mcpEntry = buildMcpEntry(targetDir);

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
    existing.mcpServers.reagent = mcpEntry;

    if (!dryRun) {
      fs.writeFileSync(mcpPath, JSON.stringify(existing, null, 2) + '\n');
    }
    return [{ file: '.mcp.json', status: 'updated' }];
  }

  // Case 2: file doesn't exist — create it
  const config = {
    mcpServers: {
      reagent: mcpEntry,
    },
  };

  if (!dryRun) {
    fs.writeFileSync(mcpPath, JSON.stringify(config, null, 2) + '\n');
  }
  return [{ file: '.mcp.json', status: 'installed' }];
}
