import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { InvocationStatus } from '../../types/index.js';
import type { Middleware } from './chain.js';

const MAX_HALT_READ_BYTES = 1024; // Cap HALT file reads to prevent oversized error strings

/**
 * Checks for `.reagent/HALT` file. If present, denies the invocation.
 *
 * SECURITY: Validates HALT is a regular file (not directory/symlink to sensitive file).
 * SECURITY: Caps read size to prevent oversized error strings.
 * PERFORMANCE: All fs operations are async to avoid blocking the event loop.
 */
export function createKillSwitchMiddleware(baseDir: string): Middleware {
  return async (ctx, next) => {
    const haltPath = path.join(baseDir, '.reagent', 'HALT');

    try {
      const stat = await fs.stat(haltPath);

      // SECURITY: Only read regular files — reject directories, symlinks to sensitive files
      if (!stat.isFile()) {
        ctx.status = InvocationStatus.Denied;
        ctx.error = 'Kill switch active: HALT exists (non-file)';
        return;
      }

      // SECURITY: Use lstat to detect symlinks — resolve target path must be within .reagent/
      const lstat = await fs.lstat(haltPath);
      if (lstat.isSymbolicLink()) {
        const target = await fs.realpath(haltPath);
        const reagentDir = path.join(baseDir, '.reagent');
        if (!target.startsWith(reagentDir)) {
          ctx.status = InvocationStatus.Denied;
          ctx.error = 'Kill switch active: HALT is a symlink outside .reagent/';
          return;
        }
      }

      // Read with size cap using async file handle
      const fh = await fs.open(haltPath, fsConstants.O_RDONLY);
      try {
        const buf = Buffer.alloc(MAX_HALT_READ_BYTES);
        const { bytesRead } = await fh.read(buf, 0, MAX_HALT_READ_BYTES, 0);
        const reason = buf.subarray(0, bytesRead).toString('utf8').trim();
        ctx.status = InvocationStatus.Denied;
        ctx.error = `Kill switch active: ${reason}`;
      } finally {
        await fh.close();
      }
      return; // Do not call next — short-circuit
    } catch (err) {
      // ENOENT = file doesn't exist = no kill switch = proceed
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        await next();
        return;
      }
      // Other errors (permission denied, etc.) — fail-closed
      ctx.status = InvocationStatus.Denied;
      ctx.error = `Kill switch check failed: ${(err as Error).message}`;
    }
  };
}
