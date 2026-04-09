import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { PKG_ROOT } from '../../utils.js';
import type { InstallResult } from './types.js';

export interface GateDefinition {
  name: string;
  command: string;
  description: string;
  on_failure: 'block' | 'warn';
}

export interface GatesConfig {
  gates: GateDefinition[];
}

export interface ProfileInstallResult {
  results: InstallResult[];
  gatesInstalled: GateDefinition[];
  agentsInstalled: string[];
}

/**
 * Validate a profile name to prevent path traversal.
 */
function isValidProfileName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(name);
}

/**
 * List available tech stack profiles (directories in profiles/ that have gates.yaml or hooks/).
 * These are distinct from the flat .json profiles used by `reagent init --profile`.
 */
export function listTechProfiles(): string[] {
  const profilesDir = path.join(PKG_ROOT, 'profiles');
  if (!fs.existsSync(profilesDir)) return [];

  return fs
    .readdirSync(profilesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && isValidProfileName(e.name))
    .map((e) => e.name);
}

/**
 * Read gates.yaml from a profile directory.
 */
export function readProfileGates(profileName: string): GateDefinition[] {
  if (!isValidProfileName(profileName)) return [];

  const gatesPath = path.join(PKG_ROOT, 'profiles', profileName, 'gates.yaml');
  if (!fs.existsSync(gatesPath)) return [];

  try {
    const raw = fs.readFileSync(gatesPath, 'utf8');
    const parsed = parseYaml(raw) as GatesConfig;
    return Array.isArray(parsed?.gates) ? parsed.gates : [];
  } catch {
    return [];
  }
}

/**
 * Read agents.txt from a profile directory.
 */
export function readProfileAgents(profileName: string): string[] {
  if (!isValidProfileName(profileName)) return [];

  const agentsPath = path.join(PKG_ROOT, 'profiles', profileName, 'agents.txt');
  if (!fs.existsSync(agentsPath)) return [];

  return fs
    .readFileSync(agentsPath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Install a tech stack profile into a target directory.
 *
 * Copies hooks from profiles/<name>/hooks/ to .claude/hooks/
 * Agents are listed in agents.txt — consumers can install them via installAgents()
 * Gates are returned for the caller to append to preflight config
 *
 * Returns install results, gates config, and agent list.
 */
export function installProfile(
  profileName: string,
  targetDir: string,
  dryRun: boolean
): ProfileInstallResult {
  const results: InstallResult[] = [];

  // Security: validate profile name
  if (!isValidProfileName(profileName)) {
    return {
      results: [
        {
          file: `profiles/${profileName}`,
          status: 'warn',
        },
      ],
      gatesInstalled: [],
      agentsInstalled: [],
    };
  }

  const profilesDir = path.join(PKG_ROOT, 'profiles');
  const profileDir = path.resolve(profilesDir, profileName);

  // Security: ensure no path traversal
  if (!profileDir.startsWith(profilesDir + path.sep)) {
    return {
      results: [{ file: `profiles/${profileName}`, status: 'warn' }],
      gatesInstalled: [],
      agentsInstalled: [],
    };
  }

  if (!fs.existsSync(profileDir)) {
    const available = listTechProfiles();
    results.push({
      file: `profiles/${profileName} (not found — available: ${available.join(', ')})`,
      status: 'warn',
    });
    return { results, gatesInstalled: [], agentsInstalled: [] };
  }

  // Install hooks
  const hooksDir = path.join(profileDir, 'hooks');
  if (fs.existsSync(hooksDir)) {
    const destHooksDir = path.join(targetDir, '.claude', 'hooks');

    if (!dryRun) {
      fs.mkdirSync(destHooksDir, { recursive: true });
    }

    const hookFiles = fs.readdirSync(hooksDir).filter((f) => f.endsWith('.sh'));
    for (const hookFile of hookFiles) {
      const srcPath = path.join(hooksDir, hookFile);
      const destPath = path.join(destHooksDir, hookFile);
      const relPath = `.claude/hooks/${hookFile}`;

      const srcContent = fs.readFileSync(srcPath, 'utf8');
      const exists = fs.existsSync(destPath);
      const same = exists && fs.readFileSync(destPath, 'utf8') === srcContent;

      if (!same && !dryRun) {
        fs.writeFileSync(destPath, srcContent, 'utf8');
        fs.chmodSync(destPath, 0o755);
      }

      results.push({
        file: relPath,
        status: same ? 'skipped' : exists ? 'updated' : 'installed',
      });
    }
  }

  const gates = readProfileGates(profileName);
  const agents = readProfileAgents(profileName);

  return {
    results,
    gatesInstalled: gates,
    agentsInstalled: agents,
  };
}
