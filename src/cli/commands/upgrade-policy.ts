import fs from 'node:fs';
import path from 'node:path';
import { parseDocument, type Document } from 'yaml';
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
    const blockedPaths = doc.get('blocked_paths');
    if (Array.isArray(blockedPaths)) {
      const hasReagentBlanket = blockedPaths.some(
        (p: unknown) => p === '.reagent/' || p === '.reagent'
      );
      if (hasReagentBlanket) {
        // Remove .reagent/ and add granular entries
        const cleaned = blockedPaths.filter((p: unknown) => p !== '.reagent/' && p !== '.reagent');
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
    } else if (isYamlSeq(doc, 'blocked_paths')) {
      // Handle YAML Seq node (parsed as YAML AST, not plain array)
      const node = doc.getIn(['blocked_paths'], true) as {
        items?: Array<{ value?: unknown }>;
      };
      if (node && 'items' in node && Array.isArray(node.items)) {
        const values = node.items.map((item) => ('value' in item ? item.value : item));
        const hasReagentBlanket = values.some((v) => v === '.reagent/' || v === '.reagent');
        if (hasReagentBlanket) {
          const cleaned = values.filter((v) => v !== '.reagent/' && v !== '.reagent');
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
      fs.writeFileSync(policyPath, doc.toString(), 'utf8');
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

/**
 * Check if a key in the document is a YAML Seq node (not yet resolved to array).
 */
function isYamlSeq(doc: Document, key: string): boolean {
  const node = doc.getIn([key], true);
  return node !== undefined && typeof node === 'object' && node !== null && 'items' in node;
}
