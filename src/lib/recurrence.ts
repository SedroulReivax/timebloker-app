import { addDays, addMonths, addWeeks, addYears, format } from 'date-fns';
import { getDeadlineDateKey, isDateOnlyDeadline, toISODeadline } from './deadlines';

export type RecurrenceType = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';

const addByType = (base: Date, type: RecurrenceType, rule?: string | null): Date => {
  switch (type) {
    case 'daily': return addDays(base, 1);
    case 'weekly': return addWeeks(base, 1);
    case 'monthly': return addMonths(base, 1); // date-fns clamps: Jan 31 -> Feb 28
    case 'yearly': return addYears(base, 1);
    case 'custom': return addByCustomRule(base, rule);
    default: return base;
  }
};

/**
 * Custom rules are free text. Understands "every N days|weeks|months|years" (and "N days" etc.);
 * anything else falls back to +1 month, the previous behavior.
 */
const addByCustomRule = (base: Date, rule?: string | null): Date => {
  const m = (rule || '').toLowerCase().match(/(\d+)\s*(day|week|month|year)/);
  if (!m) return addMonths(base, 1);
  const n = Math.max(1, parseInt(m[1], 10));
  switch (m[2]) {
    case 'day': return addDays(base, n);
    case 'week': return addWeeks(base, n);
    case 'month': return addMonths(base, n);
    default: return addYears(base, n);
  }
};

type RecurringTask = {
  title: string;
  description?: string | null;
  deadline?: string | null;
  recurrence_type?: RecurrenceType;
  recurrence_rule?: string | null;
  date_key?: string;
  urgency?: boolean | null;
  importance?: boolean | null;
  activity_id: string | null;
  estimated_minutes?: number | null;
  estimated_pomodoros?: number;
};

/**
 * Fields of the next occurrence of a completed recurring task, or null when the task doesn't repeat.
 * Carries the time estimate over, resets pomodoro progress and files the new task under its own deadline day.
 */
export const buildNextOccurrence = (task: RecurringTask, now: Date = new Date()) => {
  if (!task.recurrence_type || task.recurrence_type === 'none') return null;
  const deadline = nextOccurrence(task.deadline, task.recurrence_type, task.recurrence_rule, now);
  return {
    title: task.title,
    description: task.description,
    deadline,
    recurrence_type: task.recurrence_type,
    recurrence_rule: task.recurrence_rule,
    date_key: getDeadlineDateKey(deadline),
    urgency: task.urgency,
    importance: task.importance,
    activity_id: task.activity_id,
    estimated_minutes: task.estimated_minutes ?? null,
    estimated_pomodoros: task.estimated_pomodoros ?? 0,
    completed_pomodoros: 0,
    completed: false,
  };
};

/**
 * Next occurrence of a recurring task, as a stored deadline string.
 * Uses local calendar arithmetic. Date-only deadlines stay date-only; timed ones keep their local time.
 * With no deadline the series starts from today (date-only).
 */
export const nextOccurrence = (
  deadline: string | null | undefined,
  type: RecurrenceType,
  rule?: string | null,
  now: Date = new Date()
): string => {
  if (!deadline) {
    return toISODeadline(format(addByType(now, type, rule), 'yyyy-MM-dd'))!;
  }
  if (isDateOnlyDeadline(deadline)) {
    const [y, m, d] = deadline.slice(0, 10).split('-').map(Number);
    return toISODeadline(format(addByType(new Date(y, m - 1, d), type, rule), 'yyyy-MM-dd'))!;
  }
  return addByType(new Date(deadline), type, rule).toISOString();
};
