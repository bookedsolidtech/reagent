import fs from 'node:fs';
import path from 'node:path';
import { loadObsidianConfig, type ResolvedObsidianConfig } from './vault-config.js';
import { generateKanban } from './kanban-generator.js';
import { ObsidianCli } from './cli.js';
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
   * Sync tasks as individual Obsidian notes via the CLI.
   * Writes only if sync.tasks is enabled and the Obsidian CLI is available.
   */
  syncTasks(dryRun = false): SyncResult {
    if (!this.config) {
      return { target: 'tasks', written: false };
    }
    if (!this.config.sync.tasks) {
      return { target: 'tasks', written: false, error: 'tasks sync not enabled in config' };
    }
    if (!this.config.vault_name) {
      return { target: 'tasks', written: false, error: 'vault_name not set in config' };
    }
    if (!ObsidianCli.isAvailable()) {
      return { target: 'tasks', written: false, error: 'Obsidian CLI not available' };
    }

    try {
      const tasks = this.store.listTasks();
      if (tasks.length === 0) {
        return { target: 'tasks', written: false, error: 'No tasks to sync' };
      }

      if (dryRun) {
        return { target: 'tasks', written: false, path: `${tasks.length} tasks would be synced` };
      }

      const cli = new ObsidianCli(this.config.vault_name);
      const tasksPath = this.config.paths.tasks;
      let synced = 0;

      for (const task of tasks) {
        const noteName = `${task.id} ${task.title}`;
        const content = [
          '---',
          'reagent_managed: true',
          `task_id: "${task.id}"`,
          `status: "${task.status}"`,
          `urgency: "${task.urgency}"`,
          `assignee: "${task.assignee || 'unassigned'}"`,
          '---',
          '',
          `# ${task.title}`,
          '',
          `- **ID:** ${task.id}`,
          `- **Status:** ${task.status}`,
          `- **Urgency:** ${task.urgency}`,
          `- **Assignee:** ${task.assignee || 'unassigned'}`,
          '',
        ].join('\n');

        if (cli.createNote(noteName, content, { path: tasksPath })) {
          synced++;
        }
      }

      return {
        target: 'tasks',
        written: synced > 0,
        path: `${synced}/${tasks.length} tasks synced to ${tasksPath}`,
      };
    } catch {
      return { target: 'tasks', written: false, error: 'Failed to sync tasks' };
    }
  }

  /**
   * Sync all enabled targets.
   */
  syncAll(dryRun = false): SyncResult[] {
    return [
      this.syncKanban(dryRun),
      this.syncContextDump(dryRun),
      this.syncWiki(dryRun),
      this.syncTasks(dryRun),
    ];
  }
}
