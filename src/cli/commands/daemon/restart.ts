import { runDaemonStop } from './stop.js';
import { runDaemonStart } from './start.js';

/**
 * Graceful restart: stop the running daemon (SIGTERM + poll for exit),
 * then start a fresh instance once the process has actually exited.
 *
 * runDaemonStop accepts an onDone callback that fires only after the daemon
 * process is confirmed dead, preventing the new instance from racing the old
 * one for the port binding.
 */
export function runDaemonRestart(args: string[]): void {
  console.log('\nRestarting reagent daemon...');
  runDaemonStop([], () => {
    // Brief pause so the OS can release the port binding before re-launch.
    setTimeout(() => {
      runDaemonStart(args);
    }, 200);
  });
}
