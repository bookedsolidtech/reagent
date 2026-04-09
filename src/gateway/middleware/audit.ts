import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AuditRecord } from '../../types/index.js';
import { Tier, InvocationStatus } from '../../types/index.js';
import type { Middleware } from './chain.js';

function computeHash(record: Omit<AuditRecord, 'hash'>): string {
  const payload = JSON.stringify(record);
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Post-execution middleware: appends a hash-chained JSONL audit record.
 *
 * SECURITY: Each audit middleware instance maintains its own hash chain.
 * SECURITY: Audit write failures are logged to stderr but do NOT crash the gateway.
 * SECURITY: Wraps next() in try/finally to ensure audit runs even on middleware exceptions.
 * SECURITY: Placed as outermost middleware so audit records ALL invocations, including denials.
 * PERFORMANCE: All fs operations are async to avoid blocking the event loop.
 */
export function createAuditMiddleware(baseDir: string): Middleware {
  const auditDir = path.join(baseDir, '.reagent', 'audit');
  let prevHash = '0000000000000000000000000000000000000000000000000000000000000000';
  let dirEnsured = false;

  return async (ctx, next) => {
    let nextError: Error | undefined;

    try {
      await next();
    } catch (err) {
      // Capture the error but still write the audit record
      nextError = err instanceof Error ? err : new Error(String(err));
      ctx.status = InvocationStatus.Error;
      ctx.error = nextError.message;
    }

    // Build audit record — always runs, even after exceptions
    try {
      const duration_ms = Date.now() - ctx.start_time;
      const now = new Date().toISOString();
      const date = now.slice(0, 10); // YYYY-MM-DD

      const recordBase: Omit<AuditRecord, 'hash'> = {
        timestamp: now,
        session_id: ctx.session_id,
        tool_name: ctx.tool_name,
        server_name: ctx.server_name,
        tier: ctx.tier ?? Tier.Write,
        status: ctx.status,
        autonomy_level: (ctx.metadata.autonomy_level as string) ?? 'unknown',
        duration_ms,
        prev_hash: prevHash,
      };

      if (ctx.error) {
        recordBase.error = ctx.error;
      }
      if (ctx.redacted_fields?.length) {
        recordBase.redacted_fields = ctx.redacted_fields;
      }

      const hash = computeHash(recordBase);
      const record: AuditRecord = { ...recordBase, hash };
      prevHash = hash;

      const filePath = path.join(auditDir, `${date}.jsonl`);
      const line = JSON.stringify(record) + '\n';

      // Ensure audit dir exists (cached, with retry on failure)
      if (!dirEnsured) {
        await fs.mkdir(auditDir, { recursive: true });
        dirEnsured = true;
      }

      try {
        await fs.appendFile(filePath, line);
      } catch {
        // Directory may have been deleted externally — retry once with mkdir
        dirEnsured = false;
        await fs.mkdir(auditDir, { recursive: true });
        dirEnsured = true;
        await fs.appendFile(filePath, line);
      }
    } catch (auditErr) {
      // SECURITY: Never crash the gateway on audit failure — log to stderr
      // Reset dirEnsured in case the mkdir was the thing that failed
      dirEnsured = false;
      console.error(
        '[reagent] AUDIT WRITE FAILED:',
        auditErr instanceof Error ? auditErr.message : auditErr
      );
    }

    // Re-throw the original error if next() failed
    if (nextError) {
      throw nextError;
    }
  };
}
