import { describe, it, expect } from 'vitest';
import { generateKanban } from '../../obsidian/kanban-generator.js';
import type { TaskView } from '../../pm/types.js';

function makeTask(overrides: Partial<TaskView> = {}): TaskView {
  return {
    id: 'T-001',
    title: 'Test task',
    status: 'created',
    urgency: 'normal',
    created_at: '2026-04-12T00:00:00.000Z',
    updated_at: '2026-04-12T00:00:00.000Z',
    ...overrides,
  };
}

describe('generateKanban', () => {
  it('produces valid frontmatter with kanban-plugin and reagent_managed', () => {
    const result = generateKanban([]);
    expect(result).toContain('kanban-plugin: basic');
    expect(result).toContain('reagent_managed: true');
    expect(result).toContain('reagent_synced_at:');
  });

  it('renders all five columns even when empty', () => {
    const result = generateKanban([]);
    expect(result).toContain('## Backlog');
    expect(result).toContain('## In Progress');
    expect(result).toContain('## Blocked');
    expect(result).toContain('## Done');
    expect(result).toContain('## Cancelled');
  });

  it('places created tasks in Backlog as unchecked', () => {
    const result = generateKanban([makeTask({ id: 'T-001', status: 'created' })]);
    expect(result).toContain('- [ ] **T-001** Test task');
  });

  it('places started tasks in In Progress as unchecked', () => {
    const result = generateKanban([makeTask({ id: 'T-002', status: 'started' })]);
    const lines = result.split('\n');
    const inProgressIdx = lines.findIndex((l) => l === '## In Progress');
    const taskLine = lines.find((l) => l.includes('T-002'));
    expect(taskLine).toContain('- [ ]');
    expect(inProgressIdx).toBeGreaterThan(-1);
    // Task should appear after "In Progress" heading
    const taskIdx = lines.indexOf(taskLine!);
    expect(taskIdx).toBeGreaterThan(inProgressIdx);
  });

  it('places blocked tasks in Blocked with blocked_by annotation', () => {
    const result = generateKanban([
      makeTask({ id: 'T-003', status: 'blocked', blocked_by: 'API dependency' }),
    ]);
    expect(result).toContain('**T-003** Test task *(blocked by: API dependency)*');
  });

  it('places completed tasks in Done as checked', () => {
    const result = generateKanban([makeTask({ id: 'T-004', status: 'completed' })]);
    expect(result).toContain('- [x] **T-004** Test task');
  });

  it('places cancelled tasks in Cancelled as checked', () => {
    const result = generateKanban([makeTask({ id: 'T-005', status: 'cancelled' })]);
    expect(result).toContain('- [x] **T-005** Test task');
  });

  it('marks critical tasks with emoji', () => {
    const result = generateKanban([makeTask({ urgency: 'critical' })]);
    expect(result).toContain('🔴');
  });

  it('does not add emoji for normal urgency', () => {
    const result = generateKanban([makeTask({ urgency: 'normal' })]);
    expect(result).not.toContain('🔴');
  });

  it('includes assignee when present', () => {
    const result = generateKanban([makeTask({ assignee: 'himerus' })]);
    expect(result).toContain('@himerus');
  });

  it('handles multiple tasks across different columns', () => {
    const tasks = [
      makeTask({ id: 'T-001', status: 'created', title: 'Backlog item' }),
      makeTask({ id: 'T-002', status: 'started', title: 'WIP item' }),
      makeTask({ id: 'T-003', status: 'blocked', title: 'Stuck item', blocked_by: 'upstream' }),
      makeTask({ id: 'T-004', status: 'completed', title: 'Done item' }),
      makeTask({ id: 'T-005', status: 'cancelled', title: 'Dropped item' }),
    ];

    const result = generateKanban(tasks);

    expect(result).toContain('**T-001** Backlog item');
    expect(result).toContain('**T-002** WIP item');
    expect(result).toContain('**T-003** Stuck item *(blocked by: upstream)*');
    expect(result).toContain('**T-004** Done item');
    expect(result).toContain('**T-005** Dropped item');
  });

  it('returns valid markdown string', () => {
    const result = generateKanban([makeTask()]);
    // Should start with frontmatter
    expect(result.startsWith('---\n')).toBe(true);
    // Should be a non-empty string
    expect(result.length).toBeGreaterThan(0);
  });
});
