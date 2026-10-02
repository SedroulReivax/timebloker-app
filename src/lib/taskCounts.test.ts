import { describe, expect, it } from 'vitest';
import { countActiveTasks, groupTasks } from './taskCounts';
import type { Task } from '../types';

const t = (over: Partial<Task>): Task => ({ id: Math.random().toString(), title: 'x', completed: false, ...over } as Task);

describe('countActiveTasks', () => {
  it('is 0 for empty and all-completed', () => {
    expect(countActiveTasks([])).toBe(0);
    expect(countActiveTasks([t({ completed: true }), t({ completed: true, recurrence_type: 'daily' })])).toBe(0);
  });

  it('counts inbox only', () => {
    expect(countActiveTasks([t({}), t({})])).toBe(2);
  });

  it('counts recurring only', () => {
    expect(countActiveTasks([t({ recurrence_type: 'weekly' })])).toBe(1);
  });

  it('counts inbox + scheduled + recurring and excludes completed', () => {
    const tasks = [
      t({}),
      t({ deadline: '2026-07-26T00:00:00.000Z' }),
      t({ recurrence_type: 'daily', deadline: '2026-07-26T00:00:00.000Z' }),
      t({ completed: true }),
    ];
    const g = groupTasks(tasks);
    expect([g.inbox.length, g.scheduled.length, g.recurring.length, g.completed.length]).toEqual([1, 1, 1, 1]);
    expect(countActiveTasks(tasks)).toBe(3);
  });

  it('treats recurrence_type "none" as non-recurring', () => {
    expect(groupTasks([t({ recurrence_type: 'none' })]).inbox.length).toBe(1);
  });
});
