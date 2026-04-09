import { execFileSync } from 'node:child_process';
import { TaskStore } from './task-store.js';
import type { TaskView } from './types.js';

export type GitHubMode = 'gh-cli' | 'local-only';

export interface GitHubBridgeOptions {
  baseDir: string;
  label?: string;
  syncCooldownSeconds?: number;
}

export class GitHubBridge {
  private readonly store: TaskStore;
  private readonly label: string;
  private readonly syncCooldown: number;
  private mode: GitHubMode;
  private lastSyncTime = 0;

  constructor(options: GitHubBridgeOptions) {
    this.store = new TaskStore(options.baseDir);
    this.label = options.label || 'reagent';
    this.syncCooldown = (options.syncCooldownSeconds || 300) * 1000;
    this.mode = this.detectMode();
  }

  /**
   * Detect which GitHub integration mode is available.
   */
  private detectMode(): GitHubMode {
    try {
      execFileSync('gh', ['auth', 'status'], {
        encoding: 'utf8',
        timeout: 5000,
        stdio: 'pipe',
      });
      return 'gh-cli';
    } catch {
      return 'local-only';
    }
  }

  getMode(): GitHubMode {
    return this.mode;
  }

  /**
   * Sync local tasks to GitHub issues (creates issues for tasks without github_issue).
   * Only syncs tasks that have the reagent label scope.
   */
  async syncToGitHub(): Promise<{ created: number; skipped: number }> {
    if (this.mode !== 'gh-cli') {
      return { created: 0, skipped: 0 };
    }

    // Rate limit guard
    const now = Date.now();
    if (now - this.lastSyncTime < this.syncCooldown) {
      return { created: 0, skipped: 0 };
    }
    this.lastSyncTime = now;

    const tasks = this.store.listTasks();
    let created = 0;
    let skipped = 0;

    for (const task of tasks) {
      if (task.github_issue) {
        skipped++;
        continue;
      }

      // Terminal tasks don't need issues
      if (task.status === 'completed' || task.status === 'cancelled') {
        skipped++;
        continue;
      }

      try {
        const issueNumber = this.createGitHubIssue(task);
        if (issueNumber) {
          // Update local task with issue number
          this.store.appendEvent({
            id: task.id,
            type: task.status === 'created' ? 'created' : task.status,
            title: task.title,
            github_issue: issueNumber,
            timestamp: new Date().toISOString(),
          });
          created++;
        }
      } catch (err) {
        console.error(
          `[github-bridge] Failed to create issue for ${task.id}: ${err instanceof Error ? err.message : err}`
        );
        skipped++;
      }
    }

    return { created, skipped };
  }

  /**
   * Create a GitHub issue for a task.
   */
  private createGitHubIssue(task: TaskView): number | null {
    try {
      const body = [
        task.description || '',
        '',
        `**Task ID:** ${task.id}`,
        task.phase ? `**Phase:** ${task.phase}` : '',
        task.urgency !== 'normal' ? `**Urgency:** ${task.urgency}` : '',
        task.parent_id ? `**Parent:** ${task.parent_id}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      const result = execFileSync(
        'gh',
        [
          'issue',
          'create',
          '--title',
          `[${task.id}] ${task.title}`,
          '--body',
          body,
          '--label',
          this.label,
        ],
        {
          encoding: 'utf8',
          timeout: 10000,
          stdio: 'pipe',
        }
      );

      // Extract issue number from URL
      const match = result.trim().match(/\/issues\/(\d+)$/);
      return match ? parseInt(match[1], 10) : null;
    } catch {
      return null;
    }
  }

  /**
   * Close a GitHub issue when a task is completed.
   */
  closeGitHubIssue(issueNumber: number): boolean {
    if (this.mode !== 'gh-cli') return false;

    try {
      execFileSync('gh', ['issue', 'close', String(issueNumber)], {
        encoding: 'utf8',
        timeout: 10000,
        stdio: 'pipe',
      });
      return true;
    } catch {
      return false;
    }
  }
}
