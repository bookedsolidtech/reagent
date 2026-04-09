import fs from 'node:fs';
import path from 'node:path';
import { parseFlag } from '../utils.js';

export function runFreeze(args: string[]): void {
  const targetDir = process.cwd();
  const rawReason =
    parseFlag(args, '--reason') || args.find((a) => !a.startsWith('--')) || 'Manual freeze';
  // Strip control characters (terminal escape injection defense)
  const reason = rawReason.replace(/[\x00-\x1f\x7f]/g, '');

  const reagentDir = path.join(targetDir, '.reagent');
  const haltFile = path.join(reagentDir, 'HALT');

  if (!fs.existsSync(reagentDir)) {
    fs.mkdirSync(reagentDir, { recursive: true });
  }

  const timestamp = new Date().toISOString();
  const content = `${reason} (frozen at ${timestamp})`;
  fs.writeFileSync(haltFile, content, 'utf8');

  console.log(`\nREAGENT FROZEN`);
  console.log(`  Reason:  ${reason}`);
  console.log(`  File:    .reagent/HALT`);
  console.log(`  Effect:  All PreToolUse hooks will exit 2 — agent operations blocked.`);
  console.log(`\n  To resume: reagent unfreeze`);
  console.log('');
}
