import fs from 'node:fs';
import path from 'node:path';
import { TaskEventSchema, type TaskEvent, type TaskEventInput, type TaskView } from './types.js';

export class TaskStore {
  private readonly filePath: string;
  private readonly lockPath: string;

  constructor(baseDir: string) {
    const reagentDir = path.join(baseDir, '.reagent');
    this.filePath = path.join(reagentDir, 'tasks.jsonl');
    this.lockPath = path.join(reagentDir, 'tasks.lock');
  }

  /**
   * Read all events from the JSONL file, validating each line with Zod.
   * Invalid lines are skipped with a warning (the file could be hand-edited).
   */
  readEvents(): TaskEvent[] {
    if (!fs.existsSync(this.filePath)) {
      return [];
    }

    const content = fs.readFileSync(this.filePath, 'utf8');
    const lines = content.split('\n').filter((line) => line.trim().length > 0);
    const events: TaskEvent[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        const validated = TaskEventSchema.parse(parsed);
        events.push(validated);
      } catch {
        // Skip invalid lines — file could be hand-edited
        console.error(`[task-store] Skipping invalid line: ${line.slice(0, 80)}...`);
      }
    }

    return events;
  }

  /**
   * Append a new event to the JSONL file (append-only).
   * Uses a lock file for concurrent safety.
   */
  appendEvent(event: TaskEventInput): void {
    // Validate before writing
    const validated = TaskEventSchema.parse(event);

    this.withLock(() => {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.appendFileSync(this.filePath, JSON.stringify(validated) + '\n');
    });
  }

  /**
   * Get the next available task ID.
   */
  nextId(): string {
    const events = this.readEvents();
    const maxId = events.reduce((max, e) => {
      const num = parseInt(e.id.replace('T-', ''), 10);
      return num > max ? num : max;
    }, 0);
    return `T-${String(maxId + 1).padStart(3, '0')}`;
  }

  /**
   * Materialize the current state of all tasks from the event log.
   * Returns the latest view of each task (last-writer-wins on fields).
   */
  listTasks(filter?: { status?: string; urgency?: string; phase?: string }): TaskView[] {
    const events = this.readEvents();
    const taskMap = new Map<string, TaskView>();

    for (const event of events) {
      const existing = taskMap.get(event.id);

      if (!existing) {
        taskMap.set(event.id, {
          id: event.id,
          title: event.title,
          status: event.type === 'created' ? 'created' : event.type,
          urgency: event.urgency,
          description: event.description,
          phase: event.phase,
          milestone: event.milestone,
          assignee: event.assignee,
          parent_id: event.parent_id,
          commit_refs: event.commit_refs,
          pr_ref: event.pr_ref,
          blocked_by: event.blocked_by,
          github_issue: event.github_issue,
          created_at: event.timestamp,
          updated_at: event.timestamp,
        });
      } else {
        // Update with newer event data
        existing.status = event.type === 'created' ? 'created' : event.type;
        existing.updated_at = event.timestamp;
        if (event.title) existing.title = event.title;
        if (event.description !== undefined) existing.description = event.description;
        if (event.urgency) existing.urgency = event.urgency;
        if (event.phase !== undefined) existing.phase = event.phase;
        if (event.milestone !== undefined) existing.milestone = event.milestone;
        if (event.assignee !== undefined) existing.assignee = event.assignee;
        if (event.parent_id !== undefined) existing.parent_id = event.parent_id;
        if (event.commit_refs !== undefined) existing.commit_refs = event.commit_refs;
        if (event.pr_ref !== undefined) existing.pr_ref = event.pr_ref;
        if (event.blocked_by !== undefined) existing.blocked_by = event.blocked_by;
        if (event.github_issue !== undefined) existing.github_issue = event.github_issue;
      }
    }

    let tasks = Array.from(taskMap.values());

    // Apply filters
    if (filter?.status) {
      tasks = tasks.filter((t) => t.status === filter.status);
    }
    if (filter?.urgency) {
      tasks = tasks.filter((t) => t.urgency === filter.urgency);
    }
    if (filter?.phase) {
      tasks = tasks.filter((t) => t.phase === filter.phase);
    }

    return tasks;
  }

  /**
   * Get a single task by ID.
   */
  getTask(id: string): TaskView | null {
    const tasks = this.listTasks();
    return tasks.find((t) => t.id === id) || null;
  }

  /**
   * Simple advisory file lock using a lock file.
   * Not POSIX flock — good enough for single-machine use.
   */
  private withLock(fn: () => void): void {
    const maxRetries = 10;
    const retryDelay = 50;

    for (let i = 0; i < maxRetries; i++) {
      try {
        // Attempt to create lock file exclusively
        fs.writeFileSync(this.lockPath, String(process.pid), { flag: 'wx' });

        try {
          fn();
        } finally {
          try {
            fs.unlinkSync(this.lockPath);
          } catch {
            // Best-effort cleanup
          }
        }
        return;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
          // Lock exists — check if stale (>5s old)
          try {
            const stat = fs.statSync(this.lockPath);
            if (Date.now() - stat.mtimeMs > 5000) {
              fs.unlinkSync(this.lockPath);
              continue;
            }
          } catch {
            // Lock disappeared — retry
            continue;
          }

          // Wait and retry
          const start = Date.now();
          while (Date.now() - start < retryDelay) {
            // Busy wait — simple and portable
          }
          continue;
        }
        throw err;
      }
    }

    throw new Error('Failed to acquire task store lock after retries');
  }
}
