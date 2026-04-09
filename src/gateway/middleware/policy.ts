import { AutonomyLevel, InvocationStatus, Tier } from '../../types/index.js';
import { classifyTool, isToolBlocked } from '../../config/tier-map.js';
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
 * SECURITY: Re-derives tier from tool_name independently — never trusts ctx.tier.
 * SECURITY: Undefined/unknown tier defaults to DENY (fail-closed).
 */
export function createPolicyMiddleware(policy: Policy, gatewayConfig?: GatewayConfig): Middleware {
  return async (ctx, next) => {
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

    await next();

    // SECURITY: Re-assert denial status cannot be undone by downstream middleware.
    // Once denied, status is locked.
  };
}
