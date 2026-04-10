import type { Middleware } from './chain.js';

/**
 * Known prompt injection phrases (lowercase for case-insensitive matching).
 * These patterns are commonly used to override system instructions in tool
 * descriptions or resource content returned by downstream MCP servers.
 */
const INJECTION_PHRASES: string[] = [
  'ignore previous instructions',
  'disregard your',
  'your new instructions are',
  'system prompt override',
  'forget all previous',
  'you are now',
];

/**
 * Decode a base64 string, returning the decoded text or null if decoding fails.
 * Only decodes if the input looks like base64 (64-char alphabet, length divisible by 4 or padded).
 */
function tryDecodeBase64(input: string): string | null {
  // Quick heuristic: must be at least 20 chars and use only base64 chars
  if (input.length < 20) return null;
  if (!/^[A-Za-z0-9+/]+=*$/.test(input)) return null;
  try {
    return Buffer.from(input, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Scan a string for known prompt injection phrases.
 * Also decodes base64 tokens and checks the decoded content.
 * Returns an array of matched phrase descriptions, empty if clean.
 */
export function scanForInjection(input: string): string[] {
  if (!input || typeof input !== 'string') return [];

  const lower = input.toLowerCase();
  const matches: string[] = [];

  // Check literal phrases
  for (const phrase of INJECTION_PHRASES) {
    if (lower.includes(phrase)) {
      matches.push(`literal: "${phrase}"`);
    }
  }

  // Check base64-encoded variants — scan word-like tokens that look like base64
  const base64Tokens = input.match(/[A-Za-z0-9+/]{20,}={0,2}/g) ?? [];
  for (const token of base64Tokens) {
    const decoded = tryDecodeBase64(token);
    if (!decoded) continue;
    const decodedLower = decoded.toLowerCase();
    for (const phrase of INJECTION_PHRASES) {
      if (decodedLower.includes(phrase)) {
        matches.push(`base64-encoded: "${phrase}"`);
        break; // One report per token is enough
      }
    }
  }

  return matches;
}

/**
 * Scan an unknown value recursively, collecting all injection matches.
 * Walks strings, arrays, and plain objects.
 */
function scanValue(value: unknown, matches: string[]): void {
  if (typeof value === 'string') {
    matches.push(...scanForInjection(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      scanValue(item, matches);
    }
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) {
      scanValue(v, matches);
    }
  }
}

export type InjectionAction = 'block' | 'warn';

/**
 * PostToolUse middleware: scans tool results for prompt injection patterns.
 *
 * Operates on tool output (ctx.result) returned from downstream MCP servers.
 * On detection:
 *   - Always logs to audit metadata and emits a warning to stderr.
 *   - If action is 'block' (default), sets ctx.status to Denied and blocks the result.
 *   - If action is 'warn', allows the result through with a warning only.
 *
 * SECURITY: Checking PostToolUse (after downstream execution, before the result
 * reaches the LLM) is the correct place to catch injection in tool descriptions
 * and resource content coming from potentially untrusted downstream servers.
 */
export function createInjectionMiddleware(action: InjectionAction = 'block'): Middleware {
  return async (ctx, next) => {
    await next();

    // Only scan if we have a result to inspect
    if (ctx.result == null) return;

    const matches: string[] = [];
    scanValue(ctx.result, matches);

    if (matches.length === 0) return;

    // Deduplicate matches
    const unique = [...new Set(matches)];

    // Always log to audit metadata
    ctx.metadata.injection_matches = unique;

    // Always emit warning to stderr
    process.stderr.write(
      `[reagent] INJECTION-GUARD: Prompt injection pattern detected in tool "${ctx.tool_name}" result\n`
    );
    for (const match of unique) {
      process.stderr.write(`  Pattern: ${match}\n`);
    }
    process.stderr.write(
      `  Action: ${action} — review the downstream server "${ctx.server_name}" for compromise.\n`
    );

    if (action === 'block') {
      const { InvocationStatus } = await import('../../types/index.js');
      ctx.status = InvocationStatus.Denied;
      ctx.error = `Prompt injection detected in tool result (${unique.length} pattern(s) matched). Result blocked.`;
      ctx.result = undefined;
    }
  };
}
