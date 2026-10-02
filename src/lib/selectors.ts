import type { Task } from '../types';
import { getDeadlineDateKey } from './deadlines';
import { memoizeLast } from './memo';

/**
 * Task selectors. Pure functions over raw state, memoized on argument identity, so screens share one
 * computation instead of each re-deriving the same lists. (Time totals are not derived here: they come from
 * the backend analytics tables.)
 */

/** Tasks that belong to a date: created on it (date_key) or with a deadline that falls on it (local date). */
export const getTasksForDate = memoizeLast((tasks: Task[], dateKey: string): Task[] =>
  tasks.filter((t) => t.date_key === dateKey || (!!t.deadline && getDeadlineDateKey(t.deadline) === dateKey))
);

/** Tasks grouped by deadline date (falls back to their date_key). */
export const groupTasksByDate = memoizeLast((tasks: Task[]): Record<string, Task[]> => {
  const map: Record<string, Task[]> = {};
  for (const t of tasks) {
    const key = t.deadline ? getDeadlineDateKey(t.deadline) : t.date_key || '';
    (map[key] ||= []).push(t);
  }
  return map;
});
