import fs from 'node:fs';
import path from 'node:path';
import { parseFlag } from '../utils.js';

interface CacheEntry {
  sha: string;
  branch: string;
  baseCommit: string;
  reviewer: string;
  findingsCount: number;
  result: 'pass' | 'fail' | 'advisory';
  timestamp: string;
  ttlSeconds: number;
}

interface CacheFile {
  version: '1';
  entries: Record<string, CacheEntry>;
}

function getCachePath(): string {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  return path.join(root, '.reagent', 'review-cache.json');
}

function loadCache(): CacheFile {
  const cachePath = getCachePath();
  if (!fs.existsSync(cachePath)) {
    return { version: '1', entries: {} };
  }
  try {
    const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (data.version !== '1') {
      return { version: '1', entries: {} };
    }
    return data as CacheFile;
  } catch {
    return { version: '1', entries: {} };
  }
}

function saveCache(cache: CacheFile): void {
  const cachePath = getCachePath();
  const dir = path.dirname(cachePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2) + '\n');
}

function isExpired(entry: CacheEntry): boolean {
  const now = Date.now();
  const entryTime = new Date(entry.timestamp).getTime();
  const ttlMs = (entry.ttlSeconds || 86400) * 1000;
  return now - entryTime > ttlMs;
}

function buildKey(sha: string, branch?: string, baseCommit?: string): string {
  const parts = [branch || '', baseCommit || '', sha].filter(Boolean);
  return parts.join(':');
}

export function runCache(args: string[]): void {
  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case 'check': {
      const sha = rest[0];
      if (!sha) {
        console.error('Usage: reagent cache check <sha> [--branch <b>] [--base <c>]');
        process.exit(1);
      }
      const branch = parseFlag(rest, '--branch') || '';
      const baseCommit = parseFlag(rest, '--base') || '';
      const key = buildKey(sha, branch, baseCommit);
      const cache = loadCache();
      const entry = cache.entries[key];

      if (!entry) {
        console.log(JSON.stringify({ hit: false }));
        process.exit(1);
      }

      if (isExpired(entry)) {
        delete cache.entries[key];
        saveCache(cache);
        console.log(JSON.stringify({ hit: false, reason: 'expired' }));
        process.exit(1);
      }

      console.log(
        JSON.stringify({
          hit: true,
          result: entry.result,
          reviewer: entry.reviewer,
          findingsCount: entry.findingsCount,
          timestamp: entry.timestamp,
        })
      );
      process.exit(0);
      break;
    }

    case 'set': {
      const sha = rest[0];
      const result = rest[1] as 'pass' | 'fail' | 'advisory';
      if (!sha || !result || !['pass', 'fail', 'advisory'].includes(result)) {
        console.error(
          'Usage: reagent cache set <sha> <pass|fail|advisory> [--branch <b>] [--base <c>] [--reviewer <r>] [--findings <n>] [--ttl <seconds>]'
        );
        process.exit(1);
      }
      const branch = parseFlag(rest, '--branch') || '';
      const baseCommit = parseFlag(rest, '--base') || '';
      const reviewer = parseFlag(rest, '--reviewer') || 'unknown';
      const findingsCount = parseInt(parseFlag(rest, '--findings') || '0', 10);
      const ttlSeconds = parseInt(parseFlag(rest, '--ttl') || '86400', 10);
      const key = buildKey(sha, branch, baseCommit);

      const cache = loadCache();
      cache.entries[key] = {
        sha,
        branch,
        baseCommit,
        reviewer,
        findingsCount,
        result,
        timestamp: new Date().toISOString(),
        ttlSeconds,
      };
      saveCache(cache);
      console.log(JSON.stringify({ stored: true, key }));
      break;
    }

    case 'clear': {
      saveCache({ version: '1', entries: {} });
      console.log(JSON.stringify({ cleared: true }));
      break;
    }

    default:
      console.error('Usage: reagent cache <check|set|clear> [args]');
      process.exit(1);
  }
}
