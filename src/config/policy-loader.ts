import fs from 'node:fs';
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

export function loadPolicy(baseDir: string): Policy {
  const policyPath = path.join(baseDir, '.reagent', 'policy.yaml');

  if (!fs.existsSync(policyPath)) {
    throw new Error(`Policy file not found: ${policyPath}`);
  }

  const raw = fs.readFileSync(policyPath, 'utf8');

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

  // SECURITY: Enforce max_autonomy_level ceiling — clamp if autonomy_level exceeds it.
  if (LEVEL_ORDER[policy.autonomy_level] > LEVEL_ORDER[policy.max_autonomy_level]) {
    console.error(
      `[reagent] WARNING: autonomy_level ${policy.autonomy_level} exceeds max_autonomy_level ${policy.max_autonomy_level} — clamping to ${policy.max_autonomy_level}`
    );
    policy = { ...policy, autonomy_level: policy.max_autonomy_level };
  }

  return policy;
}
