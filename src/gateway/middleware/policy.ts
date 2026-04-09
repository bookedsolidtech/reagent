import { AutonomyLevel, InvocationStatus, Tier } from '../../types/index.js';
import { classifyTool, isToolBlocked } from '../../config/tier-map.js';
import { loadPolicy } from '../../config/policy-loader.js';
import type { Policy, GatewayConfig } from '../../types/index.js';
import type { Middleware } from './chain.js';

/**
 * Autonomy level tier permissions:
 * - L0: Read only
 * - L1: Read + Write (no destructive)
 * - L2: Read + Write (no destructive)
 * - L3: All tiers allowed
 */
const TIER_ALLOWED: Record<AutonomyLevel, Set<Tier>> = {
  [AutonomyLevel.L0]: new Set([Tier.Read]),
  [AutonomyLevel.L1]: new Set([Tier.Read, Tier.Write]),
  [AutonomyLevel.L2]: new Set([Tier.Read, Tier.Write]),
  [AutonomyLevel.L3]: new Set([Tier.Read, Tier.Write, Tier.Destructive]),
};

/**
 * Checks autonomy level against tool tier, and checks blocked tools.
 *
 * SECURITY: Re-reads policy.yaml on every invocation so autonomy level changes
 * take effect immediately without gateway restart.
 * SECURITY: Re-derives tier from tool_name independently — never trusts ctx.tier.
 * SECURITY: Undefined/unknown tier defaults to DENY (fail-closed).
 */
export function createPolicyMiddleware(
  initialPolicy: Policy,
  gatewayConfig?: GatewayConfig,
  baseDir?: string
): Middleware {
  // SECURITY: Cache last successfully parsed policy for fallback.
  // This prevents falling back to a potentially more permissive initial policy
  // if the file is corrupted after a stricter policy was loaded.
  let lastGoodPolicy = initialPolicy;

  return async (ctx, next) => {
    // SECURITY: Re-read policy on each invocation for live autonomy changes.
    // Falls back to last successfully parsed policy on read failure.
    let policy = lastGoodPolicy;
    if (baseDir) {
      try {
        policy = loadPolicy(baseDir);
        lastGoodPolicy = policy; // Cache successful parse
      } catch {
        // Fail-safe: use last successfully parsed policy if re-read fails
      }
    }

    // Check if tool is explicitly blocked
    if (isToolBlocked(ctx.tool_name, ctx.server_name, gatewayConfig)) {
      ctx.status = InvocationStatus.Denied;
      ctx.error = `Tool "${ctx.tool_name}" is explicitly blocked in gateway config`;
      return;
    }

    // SECURITY: Re-derive tier from tool_name — do NOT trust ctx.tier from prior middleware.
    // This prevents a rogue middleware from downgrading a destructive tool to read-tier.
    const tier = classifyTool(ctx.tool_name, ctx.server_name, gatewayConfig);
    ctx.tier = tier; // Overwrite with authoritative classification

    // Validate autonomy level is known
    const allowed = TIER_ALLOWED[policy.autonomy_level];
    if (!allowed) {
      ctx.status = InvocationStatus.Denied;
      ctx.error = `Unknown autonomy level: ${policy.autonomy_level}. Denying by default.`;
      return;
    }

    // Check autonomy level vs tier (fail-closed: deny if tier unknown)
    if (!allowed.has(tier)) {
      ctx.status = InvocationStatus.Denied;
      ctx.error = `Autonomy level ${policy.autonomy_level} does not allow ${tier}-tier tools. Tool: ${ctx.tool_name}`;
      return;
    }

    // Store current autonomy level in metadata for audit middleware
    ctx.metadata.autonomy_level = policy.autonomy_level;

    await next();
  };
}
