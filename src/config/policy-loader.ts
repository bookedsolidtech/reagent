import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { AutonomyLevel } from '../types/index.js';
import type { Policy } from '../types/index.js';

/** Numeric ordering for autonomy levels — higher number = more permissive. */
const LEVEL_ORDER: Record<AutonomyLevel, number> = {
  [AutonomyLevel.L0]: 0,
  [AutonomyLevel.L1]: 1,
  [AutonomyLevel.L2]: 2,
  [AutonomyLevel.L3]: 3,
};

const PolicySchema = z.object({
  version: z.string(),
  profile: z.string(),
  installed_by: z.string(),
  installed_at: z.string(),
  autonomy_level: z.nativeEnum(AutonomyLevel),
  max_autonomy_level: z.nativeEnum(AutonomyLevel),
  promotion_requires_human_approval: z.boolean(),
  block_ai_attribution: z.boolean().default(false),
  blocked_paths: z.array(z.string()),
  notification_channel: z.string().default(''),
});

/** Default TTL for the policy cache — 30 seconds. Configurable via env var. */
const DEFAULT_CACHE_TTL_MS = 30_000;

interface PolicyCacheEntry {
  policy: Policy;
  cachedAt: number;
  mtimeMs: number;
}

/**
 * Module-level cache: one entry per baseDir (singleton per process).
 * SECURITY: Cache is never used to serve a more permissive policy than the file on disk.
 * mtime-based invalidation ensures policy tightening takes effect before TTL expires.
 */
const policyCache = new Map<string, PolicyCacheEntry>();

function applyMaxCeiling(policy: Policy): Policy {
  // SECURITY: Enforce max_autonomy_level ceiling — clamp if autonomy_level exceeds it.
  if (LEVEL_ORDER[policy.autonomy_level] > LEVEL_ORDER[policy.max_autonomy_level]) {
    console.error(
      `[reagent] WARNING: autonomy_level ${policy.autonomy_level} exceeds max_autonomy_level ${policy.max_autonomy_level} — clamping to ${policy.max_autonomy_level}`
    );
    return { ...policy, autonomy_level: policy.max_autonomy_level };
  }
  return policy;
}

function parseRawPolicy(raw: string, policyPath: string): Policy {
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (yamlErr) {
    throw new Error(
      `Failed to parse policy YAML at ${policyPath}: ${yamlErr instanceof Error ? yamlErr.message : yamlErr}`
    );
  }

  let policy: Policy;
  try {
    policy = PolicySchema.parse(parsed);
  } catch (zodErr) {
    throw new Error(
      `Invalid policy schema at ${policyPath}: ${zodErr instanceof Error ? zodErr.message : zodErr}`
    );
  }

  return applyMaxCeiling(policy);
}

/**
 * Async policy loader with TTL cache and mtime-based invalidation.
 *
 * Cache behavior:
 * - On each call, stat the file to get current mtime.
 * - If mtime changed since the cached entry, invalidate immediately regardless of TTL.
 * - If the entry is older than the TTL, re-read from disk.
 * - Otherwise, return the cached entry.
 *
 * TTL is configurable via the REAGENT_POLICY_CACHE_TTL_MS environment variable.
 *
 * PERFORMANCE: fs.promises.readFile avoids blocking the event loop on every tool invocation.
 * SECURITY: mtime invalidation ensures a tightened policy takes effect on the next call.
 */
export async function loadPolicyAsync(baseDir: string): Promise<Policy> {
  const policyPath = path.join(baseDir, '.reagent', 'policy.yaml');
  const ttlMs = Number(process.env.REAGENT_POLICY_CACHE_TTL_MS ?? DEFAULT_CACHE_TTL_MS);
  const now = Date.now();

  // Check mtime before consulting the cache — a changed file always invalidates.
  let currentMtime: number;
  try {
    const stat = await fsPromises.stat(policyPath);
    currentMtime = stat.mtimeMs;
  } catch {
    throw new Error(`Policy file not found: ${policyPath}`);
  }

  const cached = policyCache.get(baseDir);
  if (cached !== undefined && cached.mtimeMs === currentMtime && now - cached.cachedAt < ttlMs) {
    return cached.policy;
  }

  // Cache miss or invalidation — read from disk.
  const raw = await fsPromises.readFile(policyPath, 'utf8');
  const policy = parseRawPolicy(raw, policyPath);

  policyCache.set(baseDir, { policy, cachedAt: now, mtimeMs: currentMtime });
  return policy;
}

/**
 * Synchronous policy loader — retained for CLI startup paths that must be sync.
 * Does NOT use the cache — always reads from disk.
 *
 * Prefer loadPolicyAsync for middleware and any async context.
 */
export function loadPolicy(baseDir: string): Policy {
  const policyPath = path.join(baseDir, '.reagent', 'policy.yaml');

  if (!fs.existsSync(policyPath)) {
    throw new Error(`Policy file not found: ${policyPath}`);
  }

  const raw = fs.readFileSync(policyPath, 'utf8');
  return parseRawPolicy(raw, policyPath);
}

/**
 * Invalidate the cache for a given baseDir.
 * Exposed for testing — production code should rely on TTL and mtime invalidation.
 */
export function invalidatePolicyCache(baseDir?: string): void {
  if (baseDir === undefined) {
    policyCache.clear();
  } else {
    policyCache.delete(baseDir);
  }
}
