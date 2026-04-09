import type { Middleware } from './chain.js';

/**
 * Patterns that match common secret formats.
 * Each pattern has a name (for audit logging) and a regex.
 *
 * SECURITY: Patterns use case-insensitive flag where applicable.
 * SECURITY: Input is sanitized (null bytes stripped) before matching.
 */
const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'AWS Access Key', pattern: /AKIA[0-9A-Z]{16}/gi },
  {
    name: 'AWS Secret Key',
    pattern: /(?:aws_secret_access_key|secret_key)\s*[:=]\s*[A-Za-z0-9/+=]{40}/gi,
  },
  { name: 'GitHub Token', pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/g },
  {
    name: 'Generic API Key',
    pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*["']?[A-Za-z0-9\-_.]{20,}["']?/gi,
  },
  { name: 'Bearer Token', pattern: /bearer\s+[A-Za-z0-9\-_.~+/]+=*/gi },
  { name: 'Private Key', pattern: /-----BEGIN\s+(?:RSA\s+|EC\s+|DSA\s+)?PRIVATE\s+KEY-----/gi },
  { name: 'Discord Token', pattern: /[MN][A-Za-z\d]{23,}\.[\w-]{6}\.[\w-]{27,}/g },
  // Base64-encoded AWS access key (AKIA... in base64 starts with QUTJQ)
  { name: 'Base64 AWS Key', pattern: /QUtJQ[A-Za-z0-9+/]{17,}={0,2}/g },
];

/**
 * Strip null bytes and other control characters that could break regex matching.
 */
function sanitizeInput(input: string): string {
  return input.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

/**
 * Redact secrets from a string, returning the redacted string and list of redacted field names.
 */
export function redactSecrets(input: string): { output: string; redacted: string[] } {
  let output = sanitizeInput(input);
  const redacted: string[] = [];

  for (const { name, pattern } of SECRET_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    if (pattern.test(output)) {
      pattern.lastIndex = 0;
      output = output.replace(pattern, '[REDACTED]');
      redacted.push(name);
    }
  }

  return { output, redacted };
}

/**
 * Post-execution middleware: scans tool output for secret patterns and redacts them.
 *
 * SECURITY: For non-string results, redaction operates on individual string values
 * within the object structure rather than JSON.stringify→replace→JSON.parse, which
 * could corrupt the result if a replacement changes JSON structure.
 */
export const redactMiddleware: Middleware = async (ctx, next) => {
  await next();

  if (ctx.result == null) return;

  if (typeof ctx.result === 'string') {
    const { output, redacted } = redactSecrets(ctx.result);
    if (redacted.length > 0) {
      ctx.result = output;
      ctx.redacted_fields = redacted;
    }
    return;
  }

  // For objects, deeply redact all string values in-place
  const allRedacted: string[] = [];
  redactDeep(ctx.result, allRedacted);
  if (allRedacted.length > 0) {
    ctx.redacted_fields = [...new Set(allRedacted)];
  }
};

/**
 * Recursively walk an object/array and redact string values in-place.
 */
function redactDeep(obj: unknown, redacted: string[]): void {
  if (obj == null || typeof obj !== 'object') return;

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      if (typeof obj[i] === 'string') {
        const { output, redacted: r } = redactSecrets(obj[i]);
        if (r.length > 0) {
          obj[i] = output;
          redacted.push(...r);
        }
      } else {
        redactDeep(obj[i], redacted);
      }
    }
    return;
  }

  const record = obj as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (typeof record[key] === 'string') {
      const { output, redacted: r } = redactSecrets(record[key] as string);
      if (r.length > 0) {
        record[key] = output;
        redacted.push(...r);
      }
    } else {
      redactDeep(record[key], redacted);
    }
  }
}
