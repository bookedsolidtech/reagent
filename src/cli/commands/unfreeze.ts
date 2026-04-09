import fs from 'node:fs';
import path from 'node:path';

export function runUnfreeze(_args: string[]): void {
  const targetDir = process.cwd();
  const haltFile = path.join(targetDir, '.reagent', 'HALT');

  if (!fs.existsSync(haltFile)) {
    console.log('\nNot frozen — no .reagent/HALT file found.\n');
    return;
  }

  fs.unlinkSync(haltFile);
  console.log('\nREAGENT UNFROZEN');
  console.log('  .reagent/HALT removed — agent operations resumed.\n');
}
