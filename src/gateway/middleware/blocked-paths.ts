import path from 'node:path';
import { InvocationStatus } from '../../types/index.js';
import { loadPolicyAsync } from '../../config/policy-loader.js';
import type { Policy } from '../../types/index.js';
import type { Middleware } from './chain.js';

/**
 * Pre-execution middleware: denies tool invocations whose arguments
 * reference paths that are in the policy's blocked_paths list.
 *
 * SECURITY: Inspects all string values in arguments (including nested objects/arrays).
 * SECURITY: Always blocks .reagent/ regardless of policy configuration.
 * SECURITY: Normalizes URL-encoded characters, path separators, and case before comparison.
 * SECURITY: Re-reads blocked_paths from policy.yaml when baseDir is provided (hot-reload).
 */
export function createBlockedPathsMiddleware(initialPolicy: Policy, baseDir?: string): Middleware {
  return async (ctx, next) => {
    // Hot-reload blocked_paths from policy.yaml if baseDir is available
    let blockedPaths = initialPolicy.blocked_paths;
    if (baseDir) {
      try {
        const policy = await loadPolicyAsync(baseDir);
        blockedPaths = policy.blocked_paths;
      } catch {
        // Fall back to initial policy's blocked_paths on read failure
      }
    }

    // Always protect .reagent/ — it's the trust root of the system.
    const paths = [...new Set([...blockedPaths, '.reagent/'])];

    // Recursively extract all string values from arguments
    const stringValues = extractStringValues(ctx.arguments);

    for (const [key, value] of stringValues) {
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
 * Recursively extract all string values from an object, with their key paths.
 * Handles nested objects and arrays.
 */
function extractStringValues(
  obj: unknown,
  prefix = '',
  seen = new WeakSet()
): Array<[string, string]> {
  const results: Array<[string, string]> = [];

  if (obj === null || obj === undefined) return results;
  if (typeof obj === 'string') {
    results.push([prefix || 'value', obj]);
    return results;
  }
  if (typeof obj !== 'object') return results;

  // Circular reference guard
  const objRef = obj as object;
  if (seen.has(objRef)) return results;
  seen.add(objRef);

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      results.push(...extractStringValues(obj[i], `${prefix}[${i}]`, seen));
    }
  } else {
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      results.push(...extractStringValues(value, fullKey, seen));
    }
  }

  return results;
}

/**
 * Check if a string value references a blocked path.
 *
 * SECURITY: Decodes URL-encoded characters (%2F, %2f, etc.)
 * SECURITY: Normalizes path separators and resolves . and .. segments
 * SECURITY: Performs case-insensitive comparison for cross-platform safety
 */
function containsBlockedPath(value: string, blockedPath: string): boolean {
  // Normalize the value: decode URL encoding, normalize slashes and path segments
  const normalized = normalizePath(value);
  const normalizedBlocked = blockedPath.replace(/\\/g, '/').toLowerCase();

  // Direct containment check (case-insensitive)
  if (normalized.includes(normalizedBlocked)) return true;

  // Check without leading dot/slash for relative path variants
  const stripped = normalizedBlocked.replace(/^\.?\/?/, '');
  if (stripped && normalized.includes(stripped)) return true;

  return false;
}

/**
 * Normalize a path string for blocked-path comparison.
 *
 * 1. Decode URL-encoded characters (handles %2F, %2f, %2E, etc.)
 * 2. Normalize backslashes to forward slashes
 * 3. Normalize path segments (resolve . and ..)
 * 4. Lowercase for case-insensitive comparison
 */
function normalizePath(value: string): string {
  let decoded = value;

  // Decode URL-encoded characters (try/catch for malformed sequences)
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // If decoding fails, use the original value — may contain partial encoding
  }

  // Normalize backslashes to forward slashes
  decoded = decoded.replace(/\\/g, '/');

  // Use path.normalize to resolve . and .. segments, then re-normalize slashes
  decoded = path.normalize(decoded).replace(/\\/g, '/');

  // Lowercase for case-insensitive comparison
  return decoded.toLowerCase();
}
