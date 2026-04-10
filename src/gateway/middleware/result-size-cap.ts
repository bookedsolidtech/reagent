import type { GatewayConfig } from '../../types/index.js';
import type { Middleware } from './chain.js';

const DEFAULT_CAP_KB = 512;

/**
 * Serialize any result to a string for size measurement.
 * If it's already a string, use it directly; otherwise JSON.stringify.
 */
function resultToString(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * PostToolUse middleware: truncates tool results that exceed a configurable size cap.
 *
 * Operates on the serialized form of the result — if the downstream tool returns
 * a large object or binary-encoded string, we measure and truncate the serialized
 * representation. A human-readable notice is appended so the agent knows the
 * result was cut.
 *
 * Default cap: 512 KB. Override via `gateway.max_result_size_kb` in gateway.yaml.
 */
export function createResultSizeCapMiddleware(gatewayConfig?: GatewayConfig): Middleware {
  const capKb = gatewayConfig?.gateway?.max_result_size_kb ?? DEFAULT_CAP_KB;
  const capBytes = capKb * 1024;

  return async (ctx, next) => {
    await next();

    if (ctx.result == null) return;

    const serialized = resultToString(ctx.result);
    const byteLength = Buffer.byteLength(serialized, 'utf8');

    if (byteLength <= capBytes) return;

    const removedBytes = byteLength - capBytes;
    const removedKb = Math.ceil(removedBytes / 1024);
    const notice = `\n[TRUNCATED: result exceeded ${capKb}KB limit. ${removedKb}KB removed.]`;

    // Truncate to cap, then append notice. We truncate the serialized string and
    // store it back — the agent sees the notice and knows context was lost.
    const noticeBytes = Buffer.byteLength(notice, 'utf8');
    const keepBytes = capBytes - noticeBytes;
    const truncated =
      Buffer.from(serialized, 'utf8').subarray(0, keepBytes).toString('utf8') + notice;

    ctx.result = truncated;

    console.error(
      `[reagent] result-size-cap: truncated tool "${ctx.tool_name}" result from ${Math.ceil(byteLength / 1024)}KB to ${capKb}KB`
    );
  };
}
