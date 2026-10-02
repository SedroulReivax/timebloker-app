import { format } from 'date-fns';
import type { Activity, Task, TaskBlockRef, TaskFocusSession } from '../types';
import { getDeadlineDateKey, isTimedDeadline } from './deadlines';
import { summarizeTaskTime } from './taskTime';

export const TASK_TIME_HEADER = [
  'task_id', 'task_title', 'activity', 'estimated_minutes', 'planned_minutes', 'tracked_minutes', 'focused_minutes',
  'deadline', 'completed', 'completed_at',
] as const;

const csvEsc = (val: string): string => (/[",\n\r]/.test(val) ? `"${val.replace(/"/g, '""')}"` : val);

const formatDeadline = (deadline: string | null | undefined): string => {
  if (!deadline) return '';
  return isTimedDeadline(deadline) ? format(new Date(deadline), "yyyy-MM-dd'T'HH:mm") : getDeadlineDateKey(deadline);
};

/**
 * One row per task with planned (scheduled future blocks), tracked (past linked blocks) and focused minutes.
 * estimated_minutes is the estimate; planned_minutes is what is currently scheduled.
 */
export const buildTaskTimeCsv = (
  tasks: Task[],
  activities: Activity[],
  taskBlocks: TaskBlockRef[],
  sessions: TaskFocusSession[],
  now: Date = new Date()
): string => {
  const actName = new Map(activities.map((a) => [a.id, a.name]));
  const rows = tasks.map((t) => {
    const s = summarizeTaskTime(t as Task & { id: string }, taskBlocks, sessions, now);
    return [
      t.id,
      t.title,
      t.activity_id ? actName.get(t.activity_id) ?? '' : '',
      s.estimatedMinutes !== null ? String(s.estimatedMinutes) : '',
      String(s.scheduledMinutes),
      String(s.trackedMinutes),
      String(s.focusedMinutes),
      formatDeadline(t.deadline),
      t.completed ? 'true' : 'false',
      t.completed_at ?? '',
    ].map(csvEsc).join(',');
  });
  return [TASK_TIME_HEADER.join(','), ...rows].join('\n');
};
