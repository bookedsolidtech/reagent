import { runDaemonStop } from './stop.js';
import { runDaemonStart } from './start.js';

/**
 * Graceful restart: stop the running daemon (SIGTERM + poll for exit),
 * then start a fresh instance.
 */
export function runDaemonRestart(args: string[]): void {
  console.log('\nRestarting reagent daemon...');
  // runDaemonStop polls synchronously via setTimeout — it will not return until
  // the daemon exits or the 10-second timeout expires. This works because Node
  // keeps the event loop alive while setTimeout callbacks are pending.
  runDaemonStop([]);

  // Give a brief moment after stop returns before re-launching so the OS can
  // release the port binding from the previous process.
  setTimeout(() => {
    runDaemonStart(args);
  }, 500);
}
