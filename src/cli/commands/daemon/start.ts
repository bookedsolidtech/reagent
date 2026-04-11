import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseFlag, getPkgVersion } from '../../utils.js';
import { loadDaemonConfig } from '../../../config/daemon-loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Directory used for all reagent runtime files. */
function getReagentDir(): string {
  return path.join(os.homedir(), '.reagent');
}

/** Path to the PID file — records the supervisor process PID. */
export function getPidFilePath(): string {
  return path.join(getReagentDir(), 'daemon.pid');
}

/** Path to the health file updated by the supervisor every 30 seconds. */
export function getHealthFilePath(): string {
  return path.join(getReagentDir(), 'daemon-health.json');
}

/** Path to the start-time file written once on supervisor boot. */
export function getStartTimePath(): string {
  return path.join(getReagentDir(), 'daemon-start.json');
}

/** Resolve the `reagent serve` command to run as the supervised child. */
function resolveReagentBin(overrideBin?: string): string {
  if (overrideBin) return overrideBin;

  // When running from dist/cli/commands/daemon/start.js, the CLI entry is
  // four directories up: dist/cli/index.js
  const pkgRoot = path.join(__dirname, '..', '..', '..', '..');
  const distEntry = path.join(pkgRoot, 'dist', 'cli', 'index.js');
  return distEntry;
}

/** Check whether the supervisor process recorded in the PID file is alive. */
export function getRunningPid(): number | null {
  const pidPath = getPidFilePath();
  if (!fs.existsSync(pidPath)) return null;

  const raw = fs.readFileSync(pidPath, 'utf8').trim();
  const pid = parseInt(raw, 10);
  if (isNaN(pid)) return null;

  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

/** Shape of ~/.reagent/daemon-health.json */
export interface DaemonHealth {
  version: string;
  pid: number;
  started_at: string;
  restarts: number;
  last_restart_at: string | null;
}

/**
 * Write a fresh health record to ~/.reagent/daemon-health.json.
 * Called once on startup and then on a 30-second interval.
 */
function writeHealth(health: DaemonHealth): void {
  const healthPath = getHealthFilePath();
  try {
    fs.writeFileSync(healthPath, JSON.stringify(health, null, 2) + '\n', 'utf8');
  } catch {
    // Non-fatal — best effort
  }
}

/**
 * Run the supervisor loop in the foreground of the current process.
 *
 * This function is called either directly (--foreground flag) or from inside
 * a detached background spawn of the same script entry-point.  It never
 * returns under normal operation.
 */
export function runSupervisorLoop(reagentBin: string, logLevel: string): never {
  const version = getPkgVersion();
  const startedAt = new Date().toISOString();

  let restarts = 0;
  let lastRestartAt: string | null = null;

  const health: DaemonHealth = {
    version,
    pid: process.pid,
    started_at: startedAt,
    restarts,
    last_restart_at: null,
  };

  writeHealth(health);

  // Refresh health file every 30 seconds
  const healthInterval = setInterval(() => {
    writeHealth(health);
  }, 30_000);

  // Keep Node alive even if child exits temporarily
  healthInterval.unref();

  const isNodeScript = reagentBin.endsWith('.js');

  function spawnChild(): void {
    const args = isNodeScript ? ['serve'] : ['serve'];
    const cmd = isNodeScript ? process.execPath : reagentBin;
    const cmdArgs = isNodeScript ? [reagentBin, ...args] : args;

    const child = spawn(cmd, cmdArgs, {
      env: { ...process.env, LOG_LEVEL: logLevel },
      stdio: 'inherit',
    });

    child.on('exit', (code, signal) => {
      const unexpected = code !== 0 || signal !== null;

      if (unexpected) {
        restarts += 1;
        lastRestartAt = new Date().toISOString();
        health.restarts = restarts;
        health.last_restart_at = lastRestartAt;
        writeHealth(health);

        // Re-spawn after a 1-second back-off
        setTimeout(spawnChild, 1_000);
      } else {
        // Clean exit — the supervisor should stop too
        cleanup();
        process.exit(0);
      }
    });
  }

  function cleanup(): void {
    clearInterval(healthInterval);

    const pidPath = getPidFilePath();
    if (fs.existsSync(pidPath)) {
      try {
        fs.unlinkSync(pidPath);
      } catch {
        /* ignore */
      }
    }

    const healthPath = getHealthFilePath();
    if (fs.existsSync(healthPath)) {
      try {
        fs.unlinkSync(healthPath);
      } catch {
        /* ignore */
      }
    }
  }

  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });

  // Write PID and start-time files — done here so they are written by the
  // actual supervisor process (the foreground worker), not the outer CLI call
  // that detaches it.
  const pidPath = getPidFilePath();
  fs.writeFileSync(pidPath, String(process.pid), 'utf8');

  const startTimePath = getStartTimePath();
  fs.writeFileSync(startTimePath, JSON.stringify({ started_at: startedAt }), 'utf8');

  spawnChild();

  // Keep the event loop alive permanently
  setInterval(() => {
    /* heartbeat — keeps Node alive */
  }, 60_000);

  // TypeScript: this function signature is `never` because it never returns
  // via normal control flow (only via process.exit)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  throw new Error('supervisor loop exited unexpectedly') as any;
}

export function runDaemonStart(args: string[]): void {
  const foreground = args.includes('--foreground');

  // Check if already running
  const existingPid = getRunningPid();
  if (existingPid !== null) {
    console.log(`\nreagent daemon is already running (PID ${existingPid})`);
    console.log(`  Run \`reagent daemon status\` to inspect it.`);
    console.log(`  Run \`reagent daemon restart\` to restart it.\n`);
    return;
  }

  // Load config (falls back to defaults if ~/.reagent/daemon.yaml absent)
  let config;
  try {
    config = loadDaemonConfig();
  } catch (err) {
    console.error(
      `[reagent] Failed to load daemon config: ${err instanceof Error ? err.message : err}`
    );
    process.exit(1);
  }

  const binOverride = parseFlag(args, '--reagent-bin');
  const reagentBin = resolveReagentBin(binOverride ?? config.reagent_bin);
  const logLevel = config.log_level;

  // Ensure ~/.reagent/ exists
  const reagentDir = getReagentDir();
  if (!fs.existsSync(reagentDir)) {
    fs.mkdirSync(reagentDir, { recursive: true });
  }

  if (foreground) {
    console.log(`\nStarting reagent daemon v${getPkgVersion()} (foreground)`);
    console.log(`  Serving: ${reagentBin}\n`);
    runSupervisorLoop(reagentBin, logLevel);
    return;
  }

  // Background mode: spawn a detached copy of this same Node.js entry-point
  // with a special env var that makes it enter the supervisor loop directly.
  const logFile = path.join(reagentDir, 'daemon.log');
  const logFd = fs.openSync(logFile, 'a');

  // The supervisor re-entry env vars are read by the CLI entry-point.
  const supervisorEnv: NodeJS.ProcessEnv = {
    ...process.env,
    REAGENT_SUPERVISOR_MODE: '1',
    REAGENT_SUPERVISOR_BIN: reagentBin,
    REAGENT_SUPERVISOR_LOG_LEVEL: logLevel,
  };

  // The CLI entry-point (dist/cli/index.js) will detect REAGENT_SUPERVISOR_MODE
  // and call runSupervisorLoop directly.  We spawn Node with that entry-point.
  const pkgRoot = path.join(__dirname, '..', '..', '..', '..');
  const cliEntry = path.join(pkgRoot, 'dist', 'cli', 'index.js');

  const child = spawn(process.execPath, [cliEntry, '__supervisor__'], {
    env: supervisorEnv,
    stdio: ['ignore', logFd, logFd],
    detached: true,
  });

  child.unref();

  if (child.pid === undefined) {
    console.error(
      '[reagent] Failed to obtain supervisor PID after spawn — daemon may not be running'
    );
    process.exit(1);
  }

  // Write PID immediately so status / stop can find it even before the
  // supervisor process writes its own copy.
  const pidPath = getPidFilePath();
  fs.writeFileSync(pidPath, String(child.pid), 'utf8');

  const version = getPkgVersion();
  console.log(`\nreagent daemon v${version} started`);
  console.log(`  PID:      ${child.pid}`);
  console.log(`  Log:      ${logFile}`);
  console.log(`  PID file: ${pidPath}`);
  console.log(`\n  Run \`reagent daemon status\` to confirm it is healthy.\n`);
}
