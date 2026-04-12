import fs from 'node:fs';
import path from 'node:path';
import { parseDocument } from 'yaml';
import type { InstallResult } from './init/types.js';

/**
 * Canonical sections that should exist in every policy.yaml.
 * mergePolicy adds these if missing — never overwrites existing values.
 */
const CANONICAL_SECTIONS: Record<string, unknown> = {
  context_protection: {
    delegate_to_subagent: ['pnpm run preflight', 'pnpm run test', 'pnpm run build'],
    max_bash_output_lines: 100,
  },
};

/**
 * Granular blocked_paths that replace the blanket `.reagent/` entry.
 */
const GRANULAR_BLOCKED_PATHS = ['.reagent/policy.yaml', '.reagent/HALT'];

/**
 * YAML-aware policy merge for `reagent upgrade`.
 *
 * Uses the `yaml` package's `parseDocument` API to preserve
 * comments, ordering, and existing user customizations.
 *
 * Behavior:
 *   1. Parse existing policy.yaml as a YAML Document
 *   2. Add missing top-level sections (shallow merge — never overwrites existing)
 *   3. Update `installed_by` version stamp
 *   4. If `cleanBlockedPaths`: replace `.reagent/` with granular entries
 */
export function mergePolicy(
  targetDir: string,
  pkgVersion: string,
  dryRun: boolean,
  options?: { cleanBlockedPaths?: boolean }
): InstallResult[] {
  const policyPath = path.join(targetDir, '.reagent', 'policy.yaml');
  const results: InstallResult[] = [];

  if (!fs.existsSync(policyPath)) {
    results.push({ file: '.reagent/policy.yaml', status: 'warn' });
    console.warn('  Warning: .reagent/policy.yaml not found. Run `reagent init` to create it.');
    return results;
  }

  const raw = fs.readFileSync(policyPath, 'utf8');
  const doc = parseDocument(raw);

  // Guard: empty or malformed YAML (no mapping node)
  if (!doc.contents) {
    results.push({ file: '.reagent/policy.yaml', status: 'warn' });
    console.warn(
      '  Warning: .reagent/policy.yaml is empty or malformed. Run `reagent init` to recreate.'
    );
    return results;
  }

  let changed = false;

  // 1. Update installed_by version stamp
  const currentVersion = doc.get('installed_by') as string | undefined;
  const newVersion = `reagent@${pkgVersion}`;
  if (currentVersion !== newVersion) {
    doc.set('installed_by', newVersion);
    changed = true;
  }

  // 2. Add missing canonical sections (shallow — never overwrite existing)
  for (const [key, value] of Object.entries(CANONICAL_SECTIONS)) {
    if (!doc.has(key)) {
      doc.set(key, value);
      changed = true;
      results.push({
        file: `.reagent/policy.yaml (added ${key} section)`,
        status: 'installed',
      });
    }
  }

  // 3. Clean blocked_paths if requested
  if (options?.cleanBlockedPaths) {
    // doc.get() on a parseDocument returns YAML AST nodes, not plain arrays.
    // Use toJSON() to resolve to plain JS values for manipulation.
    const blockedNode = doc.get('blocked_paths');
    if (blockedNode != null) {
      const values: unknown[] =
        typeof (blockedNode as { toJSON?: () => unknown }).toJSON === 'function'
          ? ((blockedNode as { toJSON: () => unknown }).toJSON() as unknown[])
          : Array.isArray(blockedNode)
            ? blockedNode
            : [];

      if (Array.isArray(values)) {
        const hasReagentBlanket = values.some((v) => v === '.reagent/' || v === '.reagent');
        if (hasReagentBlanket) {
          const cleaned = values.filter((v: unknown) => v !== '.reagent/' && v !== '.reagent');
          for (const granular of GRANULAR_BLOCKED_PATHS) {
            if (!cleaned.includes(granular)) {
              cleaned.push(granular);
            }
          }
          doc.set('blocked_paths', cleaned);
          changed = true;
          results.push({
            file: '.reagent/policy.yaml (blocked_paths: .reagent/ → granular)',
            status: 'updated',
          });
        }
      }
    }
  }

  // 4. Write or report
  if (changed) {
    if (!dryRun) {
      try {
        fs.writeFileSync(policyPath, doc.toString(), 'utf8');
      } catch {
        results.push({ file: '.reagent/policy.yaml', status: 'warn' });
        console.warn('  Warning: .reagent/policy.yaml has YAML errors and cannot be updated.');
        return results;
      }
      results.push({
        file: '.reagent/policy.yaml (installed_by updated)',
        status: 'updated',
      });
    } else {
      results.push({
        file: '.reagent/policy.yaml (installed_by would be updated)',
        status: 'updated',
      });
    }
  } else {
    results.push({ file: '.reagent/policy.yaml', status: 'skipped' });
  }

  return results;
}
