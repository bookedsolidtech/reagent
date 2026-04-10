import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseFlag } from '../../utils.js';
import { loadDaemonConfig } from '../../../config/daemon-loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Path to the PID file written when the daemon starts. */
function getPidFilePath(): string {
  return path.join(os.homedir(), '.reagent', 'daemon.pid');
}

/** Resolve the compiled Rust daemon binary path relative to the package root. */
function resolveDaemonBinary(): string {
  // Walk up from dist/cli/commands/daemon/ to find the package root, then
  // look for the platform binary in bin/reagent-daemon-<platform>
  const pkgRoot = path.join(__dirname, '..', '..', '..', '..');
  const platform = process.platform;
  const arch = process.arch;

  // Map Node.js platform/arch to the binary name convention used by the
  // Rust build and npm optional dependency packages
  const platformMap: Record<string, string> = {
    'darwin-arm64': 'reagent-daemon-darwin-arm64',
    'darwin-x64': 'reagent-daemon-darwin-x64',
    'linux-x64': 'reagent-daemon-linux-x64',
  };

  const key = `${platform}-${arch}`;
  const binaryName = platformMap[key] ?? 'reagent-daemon';

  // Check platform-specific optional package first (npm distribution)
  const optionalPkgBin = path.join(
    pkgRoot,
    'node_modules',
    `@bookedsolid/${binaryName}`,
    'bin',
    binaryName
  );
  if (fs.existsSync(optionalPkgBin)) {
    return optionalPkgBin;
  }

  // Fall back to local build output (development)
  const localBin = path.join(pkgRoot, 'daemon', 'target', 'release', 'reagent-daemon');
  if (fs.existsSync(localBin)) {
    return localBin;
  }

  throw new Error(
    `reagent daemon binary not found for platform ${key}.\n` +
      `  Looked for: ${optionalPkgBin}\n` +
      `            : ${localBin}\n` +
      `  Run \`cargo build --release\` inside daemon/ to build locally, or ensure the\n` +
      `  @bookedsolid/${binaryName} optional package is installed.`
  );
}

/** Read the existing PID file and check if the process is alive. */
function getRunningPid(): number | null {
  const pidPath = getPidFilePath();
  if (!fs.existsSync(pidPath)) return null;

  const raw = fs.readFileSync(pidPath, 'utf8').trim();
  const pid = parseInt(raw, 10);
  if (isNaN(pid)) return null;

  // Send signal 0 to check if the process exists without affecting it
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    // Process not found — stale PID file
    return null;
  }
}

export function runDaemonStart(args: string[]): void {
  const foreground = args.includes('--foreground');
  const portOverride = parseFlag(args, '--port');
  const bindOverride = parseFlag(args, '--bind');

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

  const port = portOverride ? parseInt(portOverride, 10) : config.port;
  const bind = bindOverride ?? config.bind;

  if (isNaN(port) || port < 1 || port > 65535) {
    console.error(`[reagent] Invalid port: ${portOverride}`);
    process.exit(1);
  }

  // Resolve binary
  let binaryPath: string;
  try {
    binaryPath = resolveDaemonBinary();
  } catch (err) {
    console.error(`[reagent] ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    RUST_LOG: config.log_level,
    REAGENT_DAEMON_PORT: String(port),
    REAGENT_DAEMON_BIND: bind,
    REAGENT_DAEMON_SESSION_TTL: String(config.session_ttl_minutes),
  };

  if (foreground) {
    console.log(`\nStarting reagent daemon on ${bind}:${port} (foreground)`);
    console.log(`  Binary: ${binaryPath}\n`);

    const child = spawn(binaryPath, [], { env, stdio: 'inherit' });
    child.on('exit', (code) => {
      process.exit(code ?? 0);
    });
    return;
  }

  // Background mode: detach child process and write PID file
  const logDir = path.join(os.homedir(), '.reagent');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const logFile = path.join(logDir, 'daemon.log');
  const logFd = fs.openSync(logFile, 'a');

  const child = spawn(binaryPath, [], {
    env,
    stdio: ['ignore', logFd, logFd],
    detached: true,
  });

  child.unref();

  if (child.pid === undefined) {
    console.error('[reagent] Failed to obtain daemon PID after spawn — daemon may not be running');
    process.exit(1);
  }

  const pidPath = getPidFilePath();
  fs.writeFileSync(pidPath, String(child.pid), 'utf8');

  console.log(`\nreagent daemon started`);
  console.log(`  PID:     ${child.pid}`);
  console.log(`  Address: http://${bind}:${port}`);
  console.log(`  Log:     ${logFile}`);
  console.log(`  PID file: ${pidPath}`);
  console.log(`\n  Run \`reagent daemon status\` to confirm it is healthy.\n`);
}
