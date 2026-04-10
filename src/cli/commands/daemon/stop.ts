import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** Path to the PID file written by `reagent daemon start`. */
function getPidFilePath(): string {
  return path.join(os.homedir(), '.reagent', 'daemon.pid');
}

export function runDaemonStop(_args: string[]): void {
  const pidPath = getPidFilePath();

  if (!fs.existsSync(pidPath)) {
    console.log(`\nreagent daemon is not running (no PID file at ${pidPath})\n`);
    return;
  }

  const raw = fs.readFileSync(pidPath, 'utf8').trim();
  const pid = parseInt(raw, 10);

  if (isNaN(pid)) {
    console.error(`[reagent] PID file contains invalid value: ${JSON.stringify(raw)}`);
    console.error(`  Remove it manually: ${pidPath}`);
    process.exit(1);
  }

  // Verify the process is alive before sending SIGTERM
  let alive = true;
  try {
    process.kill(pid, 0);
  } catch {
    alive = false;
  }

  if (!alive) {
    console.log(`\nreagent daemon (PID ${pid}) is not running — removing stale PID file.`);
    fs.unlinkSync(pidPath);
    return;
  }

  console.log(`\nSending SIGTERM to reagent daemon (PID ${pid})...`);

  try {
    process.kill(pid, 'SIGTERM');
  } catch (err) {
    console.error(
      `[reagent] Failed to send SIGTERM to PID ${pid}: ${err instanceof Error ? err.message : err}`
    );
    process.exit(1);
  }

  // Poll for up to 10 seconds to confirm the process exited
  const deadline = Date.now() + 10_000;
  const pollIntervalMs = 250;

  const poll = (): void => {
    let still_alive = true;
    try {
      process.kill(pid, 0);
    } catch {
      still_alive = false;
    }

    if (!still_alive) {
      // Remove stale PID file — daemon removes it on clean exit, but handle
      // the case where it didn't
      if (fs.existsSync(pidPath)) {
        fs.unlinkSync(pidPath);
      }
      console.log(`  Daemon stopped.\n`);
      return;
    }

    if (Date.now() >= deadline) {
      console.error(`[reagent] Daemon (PID ${pid}) did not exit within 10 seconds.`);
      console.error(`  Send SIGKILL manually: kill -9 ${pid}`);
      process.exit(1);
    }

    setTimeout(poll, pollIntervalMs);
  };

  setTimeout(poll, pollIntervalMs);
}
