import { startGateway } from '../../gateway/server.js';

export async function runServe(_args: string[]): Promise<void> {
  const baseDir = process.cwd();

  try {
    await startGateway({ baseDir });
  } catch (err) {
    console.error('[reagent] Fatal error:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
