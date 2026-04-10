import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadDaemonConfig } from '../../../config/daemon-loader.js';
import type { DaemonHealthResponse, DaemonSessionsResponse } from '../../../types/daemon.js';

/** Path to the PID file written by `reagent daemon start`. */
function getPidFilePath(): string {
  return path.join(os.homedir(), '.reagent', 'daemon.pid');
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}`);
  }
  return res.json() as Promise<T>;
}

export async function runDaemonStatus(_args: string[]): Promise<void> {
  const pidPath = getPidFilePath();

  // Check PID file
  let pid: number | null = null;
  if (fs.existsSync(pidPath)) {
    const raw = fs.readFileSync(pidPath, 'utf8').trim();
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed)) {
      // Verify the process is alive
      try {
        process.kill(parsed, 0);
        pid = parsed;
      } catch {
        // Stale PID
      }
    }
  }

  const config = loadDaemonConfig();
  const baseUrl = `http://${config.bind}:${config.port}`;

  console.log(`\nreagent daemon status`);
  console.log(`  Address: ${baseUrl}`);

  if (pid !== null) {
    console.log(`  PID:     ${pid} (running)`);
  } else {
    console.log(`  PID:     not running`);
  }

  // Try to hit /health
  let health: DaemonHealthResponse | null = null;
  try {
    health = await fetchJson<DaemonHealthResponse>(`${baseUrl}/health`);
    console.log(`  Status:  ${health.status}`);
    console.log(`  Version: ${health.version}`);
    console.log(`  Uptime:  ${formatUptime(health.uptime_seconds)}`);
    console.log(`  Sessions: ${health.sessions}`);
  } catch {
    console.log(`  Status:  unreachable (daemon may not be running or still starting)`);
    console.log('');
    return;
  }

  // Fetch sessions if any are active
  if (health.sessions > 0) {
    try {
      const sessionsResp = await fetchJson<DaemonSessionsResponse>(`${baseUrl}/sessions`);
      console.log(`\n  Active sessions:`);
      for (const session of sessionsResp.sessions) {
        const elapsed = session.last_activity_elapsed_secs;
        const elapsedStr =
          elapsed < 60
            ? `${elapsed}s ago`
            : elapsed < 3600
              ? `${Math.floor(elapsed / 60)}m ago`
              : `${Math.floor(elapsed / 3600)}h ago`;
        console.log(`    [${session.session_id.slice(0, 8)}] ${session.project_root}`);
        console.log(`      Last activity: ${elapsedStr}`);
      }
    } catch {
      // Non-fatal — health already printed session count
    }
  }

  console.log('');
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
