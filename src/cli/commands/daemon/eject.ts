import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

/** Path to the PID file written by the daemon on startup. */
function getPidFilePath(): string {
  return path.join(os.homedir(), '.reagent', 'daemon.pid');
}

/**
 * `reagent daemon eject` — unconditional nuclear kill.
 *
 * Does not attempt graceful shutdown. Suitable as a last resort when the
 * daemon is stuck and `reagent daemon stop` is unresponsive.
 *
 * Steps:
 *   1. SIGKILL the PID recorded in ~/.reagent/daemon.pid
 *   2. pkill -f reagent-daemon as a fallback (catches orphans not in PID file)
 *   3. Remove ~/.reagent/daemon.pid
 */
export function runDaemonEject(_args: string[]): void {
  const pidPath = getPidFilePath();
  let killedViaPid = false;

  // Step 1: kill via PID file
  if (fs.existsSync(pidPath)) {
    const raw = fs.readFileSync(pidPath, 'utf8').trim();
    const pid = parseInt(raw, 10);

    if (!isNaN(pid)) {
      try {
        process.kill(pid, 'SIGKILL');
        console.log(`[reagent] SIGKILL sent to daemon (PID ${pid})`);
        killedViaPid = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // ESRCH means the process does not exist — not an error for eject
        if ((err as NodeJS.ErrnoException).code !== 'ESRCH') {
          console.error(`[reagent] Could not SIGKILL PID ${pid}: ${msg}`);
        } else {
          console.log(`[reagent] PID ${pid} was not running (stale PID file)`);
        }
      }
    } else {
      console.error(`[reagent] PID file contains invalid value: ${JSON.stringify(raw)}`);
    }
  } else {
    console.log(`[reagent] No PID file found at ${pidPath}`);
  }

  // Step 2: pkill fallback — catches orphaned processes not tracked by PID file
  try {
    execSync('pkill -KILL -f reagent-daemon 2>/dev/null || true', { stdio: 'ignore' });
    if (!killedViaPid) {
      console.log('[reagent] pkill -KILL -f reagent-daemon executed (orphan sweep)');
    }
  } catch {
    // pkill exits non-zero when no processes matched — that is acceptable
  }

  // Step 3: remove PID file
  if (fs.existsSync(pidPath)) {
    try {
      fs.unlinkSync(pidPath);
      console.log(`[reagent] Removed PID file: ${pidPath}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[reagent] Could not remove PID file: ${msg}`);
    }
  }

  console.log('[reagent] Eject complete.\n');
}
