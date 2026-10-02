import { describe, expect, it } from 'vitest';
import { getTasksForDate, groupTasksByDate } from './selectors';
import { memoizeLast } from './memo';
import type { Task } from '../types';

const task = (over: Partial<Task>) => ({ id: 'x', title: 'x', completed: false, activity_id: null, ...over }) as Task;

describe('selectors', () => {
  it('task selectors use local deadline dates', () => {
    const tasks = [
      task({ id: '1', deadline: '2026-09-22T00:00:00.000Z' }),
      task({ id: '2', date_key: '2026-09-22' }),
      task({ id: '3', deadline: new Date(2026, 8, 23, 1, 0).toISOString() }),
    ];
    expect(getTasksForDate(tasks, '2026-09-22').map((t) => t.id).sort()).toEqual(['1', '2']);
    expect(Object.keys(groupTasksByDate(tasks)).sort()).toEqual(['2026-09-22', '2026-09-23']);
  });

  it('memoizeLast recomputes only when args change', () => {
    let calls = 0;
    const f = memoizeLast((a: number[]) => { calls++; return a.length; });
    const arr = [1, 2];
    f(arr); f(arr);
    expect(calls).toBe(1);
    f([1, 2]);
    expect(calls).toBe(2);
  });
});
