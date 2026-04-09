import { InvocationStatus } from '../../types/index.js';
import type { Policy } from '../../types/index.js';
import type { Middleware } from './chain.js';

/**
 * Pre-execution middleware: denies tool invocations whose arguments
 * reference paths that are in the policy's blocked_paths list.
 *
 * SECURITY: Inspects all string-valued arguments for path matches.
 * SECURITY: Always blocks .reagent/ regardless of policy configuration.
 */
export function createBlockedPathsMiddleware(policy: Policy): Middleware {
  // Always protect .reagent/ — it's the trust root of the system.
  const paths = [...new Set([...policy.blocked_paths, '.reagent/'])];

  return async (ctx, next) => {
    // Scan all string arguments for blocked path references
    for (const [key, value] of Object.entries(ctx.arguments)) {
      if (typeof value !== 'string') continue;

      for (const blocked of paths) {
        if (containsBlockedPath(value, blocked)) {
          ctx.status = InvocationStatus.Denied;
          ctx.error = `Argument "${key}" references blocked path "${blocked}". Tool: ${ctx.tool_name}`;
          return;
        }
      }
    }

    await next();
  };
}

/**
 * Check if a string value references a blocked path.
 * Handles both exact matches and path containment.
 */
function containsBlockedPath(value: string, blockedPath: string): boolean {
  const normalized = value.replace(/\\/g, '/');
  const normalizedBlocked = blockedPath.replace(/\\/g, '/');

  // Direct containment check
  if (normalized.includes(normalizedBlocked)) return true;

  // Check without leading dot/slash for relative path variants
  const stripped = normalizedBlocked.replace(/^\.?\/?/, '');
  if (stripped && normalized.includes(stripped)) return true;

  return false;
}
