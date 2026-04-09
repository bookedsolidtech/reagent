import { classifyTool } from '../../config/tier-map.js';
import type { GatewayConfig } from '../../types/index.js';
import type { Middleware } from './chain.js';

/**
 * Classifies the tool's tier and attaches it to the context.
 */
export function createTierMiddleware(gatewayConfig?: GatewayConfig): Middleware {
  return async (ctx, next) => {
    ctx.tier = classifyTool(ctx.tool_name, ctx.server_name, gatewayConfig);
    await next();
  };
}
