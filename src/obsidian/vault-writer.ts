import fs from 'node:fs';
import path from 'node:path';
import { loadObsidianConfig, type ResolvedObsidianConfig } from './vault-config.js';
import { generateKanban } from './kanban-generator.js';
import { TaskStore } from '../pm/task-store.js';

export interface SyncResult {
  target: string;
  written: boolean;
  path?: string;
  error?: string;
}

/**
 * Obsidian vault writer — writes markdown files directly to the vault.
 * Obsidian auto-refreshes via filesystem watcher.
 *
 * All methods return silently when not configured.
 * Pattern: DiscordNotifier (fail-silent, config-gated).
 */
export class VaultWriter {
  private readonly config: ResolvedObsidianConfig | null;
  private readonly store: TaskStore;

  constructor(baseDir: string) {
    this.config = loadObsidianConfig(baseDir);
    this.store = new TaskStore(baseDir);
  }

  /**
   * Check whether Obsidian vault sync is enabled.
   */
  isEnabled(): boolean {
    return this.config !== null;
  }

  /**
   * Get resolved config for status display. Returns null if not configured.
   */
  getConfig(): ResolvedObsidianConfig | null {
    return this.config;
  }

  /**
   * Sync the Kanban board to the vault.
   * Writes only if sync.kanban is enabled.
   */
  syncKanban(dryRun = false): SyncResult {
    if (!this.config) {
      return { target: 'kanban', written: false };
    }
    if (!this.config.sync.kanban) {
      return { target: 'kanban', written: false, error: 'kanban sync not enabled in config' };
    }

    try {
      const tasks = this.store.listTasks();
      const markdown = generateKanban(tasks);
      const outputPath = path.join(this.config.vault_path, this.config.paths.kanban);

      if (!dryRun) {
        // Ensure parent directory exists
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, markdown, 'utf8');
      }

      return { target: 'kanban', written: !dryRun, path: outputPath };
    } catch {
      return { target: 'kanban', written: false, error: 'Failed to write kanban' };
    }
  }

  /**
   * Sync context dump to the vault.
   * Placeholder for Phase 3.
   */
  syncContextDump(dryRun = false): SyncResult {
    if (!this.config) {
      return { target: 'context', written: false };
    }
    if (!this.config.sync.context_dump) {
      return {
        target: 'context',
        written: false,
        error: 'context_dump sync not enabled in config',
      };
    }

    // Phase 3: context-dumper.ts will be wired here
    void dryRun;
    return { target: 'context', written: false, error: 'Not yet implemented' };
  }

  /**
   * Sync wiki pages to the vault.
   * Placeholder for Phase 4.
   */
  syncWiki(dryRun = false): SyncResult {
    if (!this.config) {
      return { target: 'wiki', written: false };
    }
    if (!this.config.sync.wiki_refresh) {
      return { target: 'wiki', written: false, error: 'wiki_refresh sync not enabled in config' };
    }

    // Phase 4: wiki-generator.ts will be wired here
    void dryRun;
    return { target: 'wiki', written: false, error: 'Not yet implemented' };
  }

  /**
   * Sync all enabled targets.
   */
  syncAll(dryRun = false): SyncResult[] {
    return [this.syncKanban(dryRun), this.syncContextDump(dryRun), this.syncWiki(dryRun)];
  }
}
