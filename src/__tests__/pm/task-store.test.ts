import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { TaskStore } from '../../pm/task-store.js';

describe('TaskStore', () => {
  let tmpDir: string;
  let store: TaskStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reagent-pm-test-'));
    fs.mkdirSync(path.join(tmpDir, '.reagent'), { recursive: true });
    store = new TaskStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('nextId', () => {
    it('returns T-001 for empty store', () => {
      expect(store.nextId()).toBe('T-001');
    });

    it('increments from existing tasks', () => {
      store.appendEvent({
        id: 'T-001',
        type: 'created',
        title: 'First task',
        timestamp: new Date().toISOString(),
      });
      expect(store.nextId()).toBe('T-002');
    });
  });

  describe('appendEvent + readEvents', () => {
    it('writes and reads events', () => {
      const event = {
        id: 'T-001',
        type: 'created' as const,
        title: 'Test task',
        urgency: 'normal' as const,
        timestamp: new Date().toISOString(),
      };
      store.appendEvent(event);

      const events = store.readEvents();
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe('T-001');
      expect(events[0].title).toBe('Test task');
    });

    it('rejects invalid events', () => {
      expect(() =>
        store.appendEvent({
          id: 'INVALID',
          type: 'created',
          title: 'Test',
          timestamp: new Date().toISOString(),
        })
      ).toThrow();
    });

    it('skips invalid lines in JSONL', () => {
      const filePath = path.join(tmpDir, '.reagent', 'tasks.jsonl');
      fs.writeFileSync(
        filePath,
        '{"id":"T-001","type":"created","title":"Good","timestamp":"2026-01-01T00:00:00.000Z"}\n' +
          'invalid json line\n' +
          '{"id":"T-002","type":"created","title":"Also good","timestamp":"2026-01-01T00:00:00.000Z"}\n'
      );

      const events = store.readEvents();
      expect(events).toHaveLength(2);
    });
  });

  describe('listTasks', () => {
    it('materializes task state from events', () => {
      const now = new Date().toISOString();
      store.appendEvent({ id: 'T-001', type: 'created', title: 'Task A', timestamp: now });
      store.appendEvent({ id: 'T-002', type: 'created', title: 'Task B', timestamp: now });
      store.appendEvent({ id: 'T-001', type: 'started', title: 'Task A', timestamp: now });

      const tasks = store.listTasks();
      expect(tasks).toHaveLength(2);

      const taskA = tasks.find((t) => t.id === 'T-001');
      expect(taskA?.status).toBe('started');

      const taskB = tasks.find((t) => t.id === 'T-002');
      expect(taskB?.status).toBe('created');
    });

    it('filters by status', () => {
      const now = new Date().toISOString();
      store.appendEvent({ id: 'T-001', type: 'created', title: 'A', timestamp: now });
      store.appendEvent({ id: 'T-002', type: 'created', title: 'B', timestamp: now });
      store.appendEvent({ id: 'T-001', type: 'completed', title: 'A', timestamp: now });

      const active = store.listTasks({ status: 'created' });
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe('T-002');
    });

    it('filters by urgency', () => {
      const now = new Date().toISOString();
      store.appendEvent({
        id: 'T-001',
        type: 'created',
        title: 'Urgent',
        urgency: 'critical',
        timestamp: now,
      });
      store.appendEvent({
        id: 'T-002',
        type: 'created',
        title: 'Normal',
        urgency: 'normal',
        timestamp: now,
      });

      const critical = store.listTasks({ urgency: 'critical' });
      expect(critical).toHaveLength(1);
      expect(critical[0].id).toBe('T-001');
    });
  });

  describe('getTask', () => {
    it('returns task by ID', () => {
      store.appendEvent({
        id: 'T-001',
        type: 'created',
        title: 'Test',
        timestamp: new Date().toISOString(),
      });

      const task = store.getTask('T-001');
      expect(task).not.toBeNull();
      expect(task?.title).toBe('Test');
    });

    it('returns null for non-existent task', () => {
      expect(store.getTask('T-999')).toBeNull();
    });
  });

  describe('empty store', () => {
    it('returns empty arrays for missing file', () => {
      expect(store.readEvents()).toEqual([]);
      expect(store.listTasks()).toEqual([]);
    });
  });
});
