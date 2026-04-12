import type { TaskView } from '../pm/types.js';

/**
 * Status-to-column mapping for the Obsidian Kanban plugin.
 */
const COLUMN_ORDER = ['Backlog', 'In Progress', 'Blocked', 'Done', 'Cancelled'] as const;

const STATUS_TO_COLUMN: Record<TaskView['status'], (typeof COLUMN_ORDER)[number]> = {
  created: 'Backlog',
  started: 'In Progress',
  blocked: 'Blocked',
  completed: 'Done',
  cancelled: 'Cancelled',
};

/**
 * Pure function: converts an array of TaskView into Obsidian Kanban markdown.
 *
 * Output is compatible with the Obsidian Kanban plugin (kanban-plugin: basic frontmatter).
 * Uses reagent_managed frontmatter to identify auto-generated files.
 */
export function generateKanban(tasks: TaskView[]): string {
  const now = new Date().toISOString();

  const lines: string[] = [
    '---',
    'kanban-plugin: basic',
    'reagent_managed: true',
    `reagent_synced_at: "${now}"`,
    '---',
    '',
  ];

  // Group tasks by column
  const columns = new Map<string, TaskView[]>();
  for (const col of COLUMN_ORDER) {
    columns.set(col, []);
  }

  for (const task of tasks) {
    const column = STATUS_TO_COLUMN[task.status] || 'Backlog';
    columns.get(column)!.push(task);
  }

  for (const col of COLUMN_ORDER) {
    const colTasks = columns.get(col)!;
    lines.push(`## ${col}`);
    lines.push('');

    if (colTasks.length === 0) {
      lines.push('');
      continue;
    }

    for (const task of colTasks) {
      const checked = task.status === 'completed' || task.status === 'cancelled' ? 'x' : ' ';
      let line = `- [${checked}] **${task.id}** ${task.title}`;

      if (task.status === 'blocked' && task.blocked_by) {
        line += ` *(blocked by: ${task.blocked_by})*`;
      }

      if (task.urgency === 'critical') {
        line += ' 🔴';
      }

      if (task.assignee) {
        line += ` @${task.assignee}`;
      }

      lines.push(line);
    }

    lines.push('');
  }

  return lines.join('\n');
}
