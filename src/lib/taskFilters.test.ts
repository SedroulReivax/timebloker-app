import { describe, expect, it } from 'vitest';
import { filterTasks, isOverdue } from './taskFilters';
import type { Task } from '../types';

const now = new Date(2026, 8, 22, 12, 0); // Sep 22 2026, 12:00 local
const t = (over: Partial<Task>): Task => ({ id: over.title ?? 'x', title: 'x', completed: false, activity_id: null, ...over } as Task);
const titles = (ts: Task[]) => ts.map((x) => x.title).sort();

const tasks: Task[] = [
  t({ title: 'inbox' }),
  t({ title: 'dateToday', deadline: '2026-09-22T00:00:00.000Z' }),
  t({ title: 'datePast', deadline: '2026-09-20T00:00:00.000Z' }),
  t({ title: 'dateFuture', deadline: '2026-09-25T00:00:00.000Z' }),
  t({ title: 'timedPast', deadline: new Date(2026, 8, 22, 9, 0).toISOString() }),
  t({ title: 'timedLaterToday', deadline: new Date(2026, 8, 22, 18, 0).toISOString() }),
  t({ title: 'daily', recurrence_type: 'daily', deadline: '2026-09-23T00:00:00.000Z' }),
  t({ title: 'done', completed: true, deadline: '2026-09-01T00:00:00.000Z' }),
];

describe('filterTasks', () => {
  it('all returns everything', () => expect(filterTasks(tasks, 'all', '', {}, now)).toHaveLength(tasks.length));

  it('today: date-only and timed deadlines on the local day, not completed', () => {
    expect(titles(filterTasks(tasks, 'today', '', {}, now))).toEqual(['dateToday', 'timedLaterToday', 'timedPast']);
  });

  it('overdue: date-only before today, timed before now; today date-only is not overdue', () => {
    expect(titles(filterTasks(tasks, 'overdue', '', {}, now))).toEqual(['datePast', 'timedPast']);
    expect(isOverdue(tasks.find((x) => x.title === 'done')!, now)).toBe(false);
  });

  it('upcoming: after today', () => {
    expect(titles(filterTasks(tasks, 'upcoming', '', {}, now))).toEqual(['daily', 'dateFuture']);
  });

  it('recurring, completed, unscheduled', () => {
    expect(titles(filterTasks(tasks, 'recurring', '', {}, now))).toEqual(['daily']);
    expect(titles(filterTasks(tasks, 'completed', '', {}, now))).toEqual(['done']);
    expect(titles(filterTasks(tasks, 'unscheduled', '', {}, now))).toEqual(['inbox']);
  });
});

describe('search', () => {
  it('matches title, description, activity name and deadline date', () => {
    const list = [
      t({ title: 'Write report', description: 'for DBMS course' }),
      t({ title: 'Gym', activity_id: 'a1' }),
      t({ title: 'Pay rent', deadline: '2026-10-01T00:00:00.000Z' }),
    ];
    const names = { a1: 'Health' };
    expect(titles(filterTasks(list, 'all', 'dbms', names, now))).toEqual(['Write report']);
    expect(titles(filterTasks(list, 'all', 'health', names, now))).toEqual(['Gym']);
    expect(titles(filterTasks(list, 'all', '2026-10', names, now))).toEqual(['Pay rent']);
    expect(filterTasks(list, 'all', '   ', names, now)).toHaveLength(3);
  });

  it('combines filter and query', () => {
    expect(titles(filterTasks(tasks, 'overdue', 'timed', {}, now))).toEqual(['timedPast']);
  });
});
