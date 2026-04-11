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
reagent daemon — keep-alive supervisor for reagent serve

Usage:
  reagent daemon <subcommand> [options]

Subcommands:
  start     Start the supervisor in the background (keeps reagent serve alive)
  stop      Stop the running supervisor
  status    Show supervisor health and uptime
  restart   Gracefully restart the supervisor
  eject     Nuclear kill — SIGKILL supervisor (last resort)

Options for start:
  --foreground        Run in foreground instead of backgrounding
  --reagent-bin <p>   Override the path to the reagent binary

Examples:
  reagent daemon start
  reagent daemon start --foreground
  reagent daemon status
  reagent daemon stop
  reagent daemon restart
`);
}
