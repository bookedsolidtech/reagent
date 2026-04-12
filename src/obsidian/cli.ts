import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const OBSIDIAN_CLI = '/usr/local/bin/obsidian';
const EXEC_TIMEOUT = 10_000; // 10s

/**
 * Thin wrapper around the Obsidian CLI (`/usr/local/bin/obsidian`).
 *
 * All methods are fail-silent — returns null/false on error.
 * Pattern: DiscordNotifier / github-bridge.ts.
 */
export class ObsidianCli {
  constructor(private readonly vaultName: string) {}

  /**
   * Check if the Obsidian CLI binary is available.
   */
  static isAvailable(): boolean {
    return fs.existsSync(OBSIDIAN_CLI);
  }

  /**
   * Append content to today's daily note.
   */
  dailyAppend(content: string): boolean {
    return this.exec(['daily:append', '--vault', this.vaultName, '--', content]);
  }

  /**
   * Create a new note with the given name and content.
   */
  createNote(name: string, content: string, opts?: { path?: string }): boolean {
    const args = ['create', '--vault', this.vaultName];
    if (opts?.path) {
      args.push('--path', opts.path);
    }
    args.push('--name', name, '--', content);
    return this.exec(args);
  }

  /**
   * Read the content of a note. Returns null on failure.
   */
  readNote(file: string): string | null {
    try {
      const result = execFileSync(
        OBSIDIAN_CLI,
        ['read', '--vault', this.vaultName, '--file', file],
        { encoding: 'utf8', timeout: EXEC_TIMEOUT, stdio: ['pipe', 'pipe', 'pipe'] }
      );
      return result;
    } catch {
      return null;
    }
  }

  /**
   * Set a frontmatter property on a note.
   */
  setProperty(file: string, name: string, value: string, type?: string): boolean {
    const args = [
      'property:set',
      '--vault',
      this.vaultName,
      '--file',
      file,
      '--name',
      name,
      '--value',
      value,
    ];
    if (type) {
      args.push('--type', type);
    }
    return this.exec(args);
  }

  /**
   * Search for notes matching a query. Returns file paths or empty array.
   */
  search(query: string, limit?: number): string[] {
    try {
      const args = ['search', '--vault', this.vaultName, '--query', query];
      if (limit) {
        args.push('--limit', String(limit));
      }
      const result = execFileSync(OBSIDIAN_CLI, args, {
        encoding: 'utf8',
        timeout: EXEC_TIMEOUT,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return result
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Get vault health metrics (orphans, unresolved links, dead ends).
   */
  vaultHealth(): { orphans: number; unresolved: number; deadends: number } | null {
    try {
      const result = execFileSync(
        OBSIDIAN_CLI,
        ['vault:health', '--vault', this.vaultName, '--json'],
        { encoding: 'utf8', timeout: EXEC_TIMEOUT, stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const parsed = JSON.parse(result) as {
        orphans?: number;
        unresolved?: number;
        deadends?: number;
      };
      return {
        orphans: parsed.orphans ?? 0,
        unresolved: parsed.unresolved ?? 0,
        deadends: parsed.deadends ?? 0,
      };
    } catch {
      return null;
    }
  }

  /**
   * Execute an Obsidian CLI command. Returns true on success, false on failure.
   */
  private exec(args: string[]): boolean {
    try {
      execFileSync(OBSIDIAN_CLI, args, {
        encoding: 'utf8',
        timeout: EXEC_TIMEOUT,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return true;
    } catch {
      return false;
    }
  }
}
