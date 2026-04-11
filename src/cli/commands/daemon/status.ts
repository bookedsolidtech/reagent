import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { DaemonHealthFile } from '../../../types/daemon.js';

/** Path to the PID file written by `reagent daemon start`. */
function getPidFilePath(): string {
  return path.join(os.homedir(), '.reagent', 'daemon.pid');
}

/** Path to the health file written by the supervisor every 30 seconds. */
function getHealthFilePath(): string {
  return path.join(os.homedir(), '.reagent', 'daemon-health.json');
}

/** Check whether a process is alive without affecting it. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function formatUptime(startedAt: string): string {
  const startMs = new Date(startedAt).getTime();
  if (isNaN(startMs)) return 'unknown';

  const totalSeconds = Math.floor((Date.now() - startMs) / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function runDaemonStatus(_args: string[]): void {
  const pidPath = getPidFilePath();
  const healthPath = getHealthFilePath();

  // Check PID file
  let pid: number | null = null;
  if (fs.existsSync(pidPath)) {
    const raw = fs.readFileSync(pidPath, 'utf8').trim();
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed) && isAlive(parsed)) {
      pid = parsed;
    }
  }

  console.log(`\nreagent daemon status`);

  if (pid === null) {
    console.log(`  Status:  stopped`);
    console.log('');
    return;
  }

  console.log(`  Status:  running`);
  console.log(`  PID:     ${pid}`);

  // Read health file if available
  if (fs.existsSync(healthPath)) {
    let health: DaemonHealthFile | null = null;
    try {
      health = JSON.parse(fs.readFileSync(healthPath, 'utf8')) as DaemonHealthFile;
    } catch {
      // Malformed health file — not fatal
    }

    if (health) {
      console.log(`  Version: ${health.version}`);
      console.log(`  Uptime:  ${formatUptime(health.started_at)}`);
      console.log(`  Restarts: ${health.restarts}`);
      if (health.last_restart_at) {
        console.log(`  Last restart: ${health.last_restart_at}`);
      }
    }
  }

  console.log('');
}
