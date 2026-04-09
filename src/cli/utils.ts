import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const PKG_ROOT = path.join(__dirname, '..', '..');

export function getPkgVersion(): string {
  try {
    const pkgPath = path.join(PKG_ROOT, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

export function parseFlag(args: string[], flag: string): string | null {
  const eqForm = args.find((a) => a.startsWith(`${flag}=`));
  if (eqForm) return eqForm.split('=').slice(1).join('=');
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--')) {
    return args[idx + 1];
  }
  return null;
}

export function gitignoreHasEntry(targetDir: string, entry: string): boolean {
  const gitignorePath = path.join(targetDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) return false;
  const content = fs.readFileSync(gitignorePath, 'utf8');
  return content.split('\n').some((line) => line.trim() === entry.trim());
}
