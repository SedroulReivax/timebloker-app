import { format } from 'date-fns';
import type { Task } from '../types';
import { getDeadlineDateKey, isDateOnlyDeadline } from './deadlines';

export type TaskFilter = 'all' | 'today' | 'overdue' | 'upcoming' | 'recurring' | 'completed' | 'unscheduled';

export const TASK_FILTERS: { id: TaskFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'today', label: 'Today' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'recurring', label: 'Recurring' },
  { id: 'completed', label: 'Completed' },
  { id: 'unscheduled', label: 'Unscheduled' },
];

const isRecurring = (t: Task) => !!t.recurrence_type && t.recurrence_type !== 'none';

/** A deadline is overdue when a date-only one is before today, or a timed one is before now. */
export const isOverdue = (t: Task, now: Date = new Date()): boolean => {
  if (t.completed || !t.deadline) return false;
  if (isDateOnlyDeadline(t.deadline)) return getDeadlineDateKey(t.deadline) < format(now, 'yyyy-MM-dd');
  return new Date(t.deadline).getTime() < now.getTime();
};

export const matchesFilter = (t: Task, filter: TaskFilter, now: Date = new Date()): boolean => {
  const todayKey = format(now, 'yyyy-MM-dd');
  switch (filter) {
    case 'all': return true;
    case 'completed': return t.completed;
    case 'today': return !t.completed && !!t.deadline && getDeadlineDateKey(t.deadline) === todayKey;
    case 'overdue': return isOverdue(t, now);
    case 'upcoming': return !t.completed && !!t.deadline && getDeadlineDateKey(t.deadline) > todayKey;
    case 'recurring': return !t.completed && isRecurring(t);
    case 'unscheduled': return !t.completed && !t.deadline;
  }
};

/** Case-insensitive match over title, description, activity name and deadline date (yyyy-MM-dd). */
export const matchesQuery = (t: Task, query: string, activityName?: string | null): boolean => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [t.title, t.description, activityName, t.deadline ? getDeadlineDateKey(t.deadline) : '']
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
};

export const filterTasks = (
  tasks: Task[],
  filter: TaskFilter,
  query: string,
  activityNameById: Record<string, string> = {},
  now: Date = new Date()
): Task[] =>
  tasks.filter(
    (t) => matchesFilter(t, filter, now) && matchesQuery(t, query, t.activity_id ? activityNameById[t.activity_id] : null)
  );
