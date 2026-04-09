import { execFileSync } from 'node:child_process';
import { TaskStore } from './task-store.js';
import type { TaskView } from './types.js';

export type GitHubMode = 'gh-cli' | 'local-only';

export interface RepoScaffoldOptions {
  description?: string;
  homepage?: string;
  topics?: string[];
  labels?: Array<{ name: string; color: string; description: string }>;
  milestones?: string[];
}

export interface RepoScaffoldResult {
  description_set: boolean;
  topics_added: string[];
  labels_created: string[];
  labels_skipped: string[];
  milestones_created: string[];
}

export interface ProjectSyncResult {
  project_id: number | null;
  project_url: string | null;
  items_added: number;
  items_skipped: number;
  error?: string;
}

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

  /**
   * Scaffold GitHub repo metadata: description, topics, labels, milestones.
   */
  scaffoldRepo(options: RepoScaffoldOptions): RepoScaffoldResult {
    const result: RepoScaffoldResult = {
      description_set: false,
      topics_added: [],
      labels_created: [],
      labels_skipped: [],
      milestones_created: [],
    };

    if (this.mode !== 'gh-cli') {
      return result;
    }

    // Set description and homepage
    if (options.description || options.homepage) {
      const editArgs = ['repo', 'edit'];
      if (options.description) {
        editArgs.push('--description', options.description);
      }
      if (options.homepage) {
        editArgs.push('--homepage', options.homepage);
      }
      try {
        execFileSync('gh', editArgs, { encoding: 'utf8', timeout: 10000, stdio: 'pipe' });
        result.description_set = true;
      } catch {
        result.description_set = false;
      }
    }

    // Add topics
    if (options.topics?.length) {
      for (const topic of options.topics) {
        try {
          execFileSync('gh', ['repo', 'edit', '--add-topic', topic], {
            encoding: 'utf8',
            timeout: 10000,
            stdio: 'pipe',
          });
          result.topics_added.push(topic);
        } catch {
          // Topic may already exist or be invalid — skip silently
        }
      }
    }

    // Create labels (idempotent)
    const labelsToCreate = options.labels ?? [];
    for (const label of labelsToCreate) {
      try {
        execFileSync(
          'gh',
          [
            'label',
            'create',
            label.name,
            '--color',
            label.color,
            '--description',
            label.description,
          ],
          { encoding: 'utf8', timeout: 10000, stdio: 'pipe' }
        );
        result.labels_created.push(label.name);
      } catch (err) {
        // Already exists error — treat as skipped
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('already exists') || msg.includes('Unprocessable Entity')) {
          result.labels_skipped.push(label.name);
        }
        // Other errors — skip silently
      }
    }

    // Create milestones
    if (options.milestones?.length) {
      for (const milestone of options.milestones) {
        try {
          // Get current repo owner/name for the API call
          const repoInfo = execFileSync('gh', ['repo', 'view', '--json', 'owner,name'], {
            encoding: 'utf8',
            timeout: 10000,
            stdio: 'pipe',
          });
          const { owner, name } = JSON.parse(repoInfo) as {
            owner: { login: string };
            name: string;
          };
          execFileSync(
            'gh',
            [
              'api',
              `repos/${owner.login}/${name}/milestones`,
              '-X',
              'POST',
              '-f',
              `title=${milestone}`,
            ],
            { encoding: 'utf8', timeout: 10000, stdio: 'pipe' }
          );
          result.milestones_created.push(milestone);
        } catch {
          // May already exist — skip silently
        }
      }
    }

    return result;
  }

  /**
   * Sync tasks with GitHub issues to a GitHub Projects v2 board.
   * Finds or creates a project board named projectTitle, then adds all
   * tasks that have a github_issue and are not yet on the board.
   */
  syncToProject(projectTitle = 'reagent'): ProjectSyncResult {
    const result: ProjectSyncResult = {
      project_id: null,
      project_url: null,
      items_added: 0,
      items_skipped: 0,
    };

    if (this.mode !== 'gh-cli') {
      result.error = 'GitHub CLI not available. Install gh and run: gh auth login';
      return result;
    }

    try {
      // Get current repo owner
      const repoInfo = execFileSync('gh', ['repo', 'view', '--json', 'owner,name,url'], {
        encoding: 'utf8',
        timeout: 10000,
        stdio: 'pipe',
      });
      const repo = JSON.parse(repoInfo) as {
        owner: { login: string };
        name: string;
        url: string;
      };
      const owner = repo.owner.login;

      // List projects for the owner
      let projectId: number | null = null;
      let projectUrl: string | null = null;

      try {
        const projectsOutput = execFileSync(
          'gh',
          ['project', 'list', '--owner', owner, '--format', 'json'],
          { encoding: 'utf8', timeout: 10000, stdio: 'pipe' }
        );
        const projectsData = JSON.parse(projectsOutput) as {
          projects: Array<{ id: number; title: string; url: string }>;
        };
        const existing = projectsData.projects?.find(
          (p) => p.title.toLowerCase() === projectTitle.toLowerCase()
        );
        if (existing) {
          projectId = existing.id;
          projectUrl = existing.url;
        }
      } catch {
        // project list may fail if no projects exist — continue to create
      }

      // Create project if not found
      if (!projectId) {
        try {
          const createOutput = execFileSync(
            'gh',
            ['project', 'create', '--owner', owner, '--title', projectTitle, '--format', 'json'],
            { encoding: 'utf8', timeout: 15000, stdio: 'pipe' }
          );
          const created = JSON.parse(createOutput) as { id: number; url: string };
          projectId = created.id;
          projectUrl = created.url;
        } catch (err) {
          result.error = `Failed to create project: ${err instanceof Error ? err.message : String(err)}`;
          return result;
        }
      }

      result.project_id = projectId;
      result.project_url = projectUrl;

      // Sync tasks with GitHub issues to the project board
      const tasks = this.store.listTasks();
      for (const task of tasks) {
        if (!task.github_issue) {
          result.items_skipped++;
          continue;
        }

        try {
          // Build the issue URL for this task
          const issueUrl = `${repo.url}/issues/${task.github_issue}`;
          execFileSync(
            'gh',
            ['project', 'item-add', String(projectId), '--owner', owner, '--url', issueUrl],
            { encoding: 'utf8', timeout: 10000, stdio: 'pipe' }
          );
          result.items_added++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // "already exists" means the item is already on the board
          if (msg.includes('already exists') || msg.includes('already on')) {
            result.items_skipped++;
          } else {
            result.items_skipped++;
          }
        }
      }

      return result;
    } catch (err) {
      result.error = `syncToProject failed: ${err instanceof Error ? err.message : String(err)}`;
      return result;
    }
  }
}
