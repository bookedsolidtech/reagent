import { runDaemonStart } from './start.js';
import { runDaemonStop } from './stop.js';
import { runDaemonStatus } from './status.js';
import { runDaemonRestart } from './restart.js';
import { runDaemonEject } from './eject.js';

/**
 * Entry point for `reagent daemon <subcommand> [options]`.
 */
export function runDaemon(args: string[]): void {
  const [sub, ...rest] = args;

  if (!sub || sub === 'help' || sub === '--help' || sub === '-h') {
    printDaemonHelp();
    return;
  }

  switch (sub) {
    case 'start':
      runDaemonStart(rest);
      break;
    case 'stop':
      runDaemonStop(rest);
      break;
    case 'status':
      runDaemonStatus(rest);
      break;
    case 'restart':
      runDaemonRestart(rest);
      break;
    case 'eject':
      runDaemonEject(rest);
      break;
    default:
      console.error(`\nUnknown daemon subcommand: ${sub}`);
      printDaemonHelp();
      process.exit(1);
  }
}

function printDaemonHelp(): void {
  console.log(`
reagent daemon — persistent HTTP/SSE multi-project MCP gateway

Usage:
  reagent daemon <subcommand> [options]

Subcommands:
  start     Start the daemon in the background
  stop      Stop the running daemon
  status    Show daemon health and active sessions
  restart   Gracefully restart the daemon
  eject     Nuclear kill — SIGKILL daemon and sweep orphans (last resort)

Options for start:
  --port <port>       Override the listen port (default: 3737)
  --bind <addr>       Override the bind address (default: 127.0.0.1)
  --foreground        Run in foreground instead of backgrounding

Examples:
  reagent daemon start
  reagent daemon start --port 8888
  reagent daemon status
  reagent daemon stop
  reagent daemon restart
`);
}
