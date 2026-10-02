import { format } from 'date-fns';

/**
 * Deadline storage convention (timestamptz column):
 * - date-only deadline  -> UTC midnight ("YYYY-MM-DDT00:00:00.000Z"); the UTC date IS the intended date
 * - timed deadline      -> real instant; the user's LOCAL date/time is what they meant
 *
 * These helpers separate three jobs that used to share one string:
 * date grouping, exact time, and display.
 */

/** True when the value is a date-only deadline (no time component, or exactly UTC midnight). */
export const isDateOnlyDeadline = (deadline: string | null | undefined): boolean => {
  if (!deadline) return false;
  if (!deadline.includes('T')) return true;
  const d = new Date(deadline);
  return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
};

/** True when the deadline has a meaningful time of day. */
export const isTimedDeadline = (deadline: string | null | undefined): boolean =>
  !!deadline && !isDateOnlyDeadline(deadline);

/** Local calendar date key (yyyy-MM-dd) a deadline belongs to. */
export const getDeadlineDateKey = (deadline: string): string => {
  if (isDateOnlyDeadline(deadline)) return deadline.slice(0, 10);
  return format(new Date(deadline), 'yyyy-MM-dd');
};

/** Local time of day for a timed deadline as fractional hours (e.g. 14.5), or null when date-only. */
export const getDeadlineHour = (deadline: string): number | null => {
  if (!isTimedDeadline(deadline)) return null;
  const d = new Date(deadline);
  return d.getHours() + d.getMinutes() / 60;
};

/** Convert a form value ("YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" in local time) to the stored ISO string. */
export const toISODeadline = (deadline: string | undefined | null): string | null => {
  if (!deadline) return null;
  if (deadline.includes('T')) return new Date(deadline).toISOString();
  return `${deadline}T00:00:00.000Z`;
};
