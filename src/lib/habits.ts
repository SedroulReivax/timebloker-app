import { addDays, differenceInCalendarDays, format, getDay, startOfWeek, subDays } from 'date-fns';
import { wilson } from './stats';

/**
 * Habit streak engine. All dates are local calendar dates as "yyyy-MM-dd" (the habit_logs.date_key convention).
 * - daily:          due every day
 * - weekdays:       due only on the selected weekdays (0=Sun..6=Sat); other days neither break nor extend a streak
 * - weekly:         one completed day per calendar week (Mon-Sun)
 * - times_per_week: N completed days per calendar week
 * - event habits:   no streak; totals only
 * The current day/week is "in progress": it extends a streak when met but never breaks it.
 */

export type HabitFrequency = 'daily' | 'weekly' | 'times_per_week' | 'weekdays';

export interface HabitLike {
  id: string;
  type: 'daily' | 'event' | string;
  frequency?: HabitFrequency | string | null;
  target_count?: number | null;
  weekdays?: number[] | null;
  created_at?: string | null;
}

export interface HabitLogLike {
  habit_id: string;
  date_key: string | null;
  logged_at?: string | null;
  notes?: string | null;
}

export type StreakUnit = 'days' | 'weeks';

export interface HabitStats {
  unit: StreakUnit;
  currentStreak: number;
  longestStreak: number;
  /** 0-100 over the evaluation window, or null when nothing was due yet. */
  completionRate: number | null;
  totalLogs: number;
  daysLogged: number;
  lastLoggedKey: string | null;
  /** 80% Wilson interval for the completion rate, 0-100 (null with nothing due) */
  rateLo: number | null;
  rateHi: number | null;
  /** Habit strength 0-100: a recency-weighted score that rewards long-run consistency and forgives a single miss. */
  strength: number | null;
}

const key = (d: Date) => format(d, 'yyyy-MM-dd');
const parse = (k: string) => new Date(k + 'T00:00:00');
const WINDOW_DAYS = 90;

const frequencyOf = (h: HabitLike): HabitFrequency => {
  if (h.frequency === 'weekly' || h.frequency === 'times_per_week' || h.frequency === 'weekdays') return h.frequency;
  return 'daily';
};

const weeklyTarget = (h: HabitLike): number => (frequencyOf(h) === 'weekly' ? 1 : Math.max(1, Math.min(7, h.target_count ?? 1)));
const isWeekly = (h: HabitLike) => h.type !== 'event' && (frequencyOf(h) === 'weekly' || frequencyOf(h) === 'times_per_week');

/** Is a day due for this habit? (daily-type habits only) */
export const isDueOn = (h: HabitLike, dateKey: string): boolean => {
  if (frequencyOf(h) === 'weekdays') {
    const days = h.weekdays && h.weekdays.length > 0 ? h.weekdays : [0, 1, 2, 3, 4, 5, 6];
    return days.includes(getDay(parse(dateKey)));
  }
  return true;
};

const habitStartKey = (h: HabitLike, fallback: string): string => (h.created_at ? key(new Date(h.created_at)) : fallback);

const loggedDays = (h: HabitLike, logs: HabitLogLike[]): Set<string> =>
  new Set(logs.filter((l) => l.habit_id === h.id && l.date_key).map((l) => l.date_key as string));

const weekKey = (dateKey: string) => key(startOfWeek(parse(dateKey), { weekStartsOn: 1 }));

export const computeHabitStats = (habit: HabitLike, logs: HabitLogLike[], now: Date = new Date()): HabitStats => {
  const todayKey = key(now);
  const days = loggedDays(habit, logs);
  const own = logs.filter((l) => l.habit_id === habit.id);
  const sortedKeys = Array.from(days).sort();
  const base = {
    totalLogs: own.length,
    daysLogged: days.size,
    lastLoggedKey: sortedKeys.length ? sortedKeys[sortedKeys.length - 1] : null,
  };

  if (habit.type === 'event') {
    return { ...base, unit: 'days', currentStreak: 0, longestStreak: 0, completionRate: null, rateLo: null, rateHi: null, strength: null };
  }

  const startKey = habitStartKey(habit, sortedKeys[0] ?? todayKey);
  // Streaks may start before the habit's created_at if the user back-filled logs
  const firstKey = sortedKeys[0] && sortedKeys[0] < startKey ? sortedKeys[0] : startKey;

  if (isWeekly(habit)) {
    const target = weeklyTarget(habit);
    const perWeek = new Map<string, number>();
    for (const d of days) perWeek.set(weekKey(d), (perWeek.get(weekKey(d)) || 0) + 1);
    const thisWeek = weekKey(todayKey);
    const firstWeek = weekKey(firstKey);
    const weeks: { wk: string; met: boolean }[] = [];
    for (let w = firstWeek; w <= thisWeek; w = key(addDays(parse(w), 7))) weeks.push({ wk: w, met: (perWeek.get(w) || 0) >= target });

    let longest = 0, run = 0;
    for (const w of weeks) { run = w.met ? run + 1 : 0; longest = Math.max(longest, run); }
    let current = 0;
    for (let i = weeks.length - 1; i >= 0; i--) {
      if (weeks[i].met) current++;
      else if (weeks[i].wk === thisWeek) continue; // in progress: does not break
      else break;
    }
    const completed = weeks.filter((w) => w.wk !== thisWeek || w.met);
    const wr = wilson(completed.filter((w) => w.met).length, completed.length);
    // Strength: each finished week is one opportunity (half-life about 6 weeks); partial weeks earn partial credit
    const mW = Math.pow(0.5, 1 / 6);
    let strengthW = 0;
    for (const w of weeks) {
      if (w.wk === thisWeek && !w.met) continue; // week still in progress
      strengthW = strengthW * mW + Math.min(1, (perWeek.get(w.wk) || 0) / target) * (1 - mW);
    }
    return {
      ...base,
      unit: 'weeks',
      currentStreak: current,
      longestStreak: longest,
      completionRate: completed.length ? Math.round((completed.filter((w) => w.met).length / completed.length) * 100) : null,
      rateLo: wr.lo !== null ? Math.round(wr.lo * 100) : null,
      rateHi: wr.hi !== null ? Math.round(wr.hi * 100) : null,
      strength: completed.length >= 2 ? Math.round(strengthW * 100) : null,
    };
  }

  // Daily / weekdays
  const cursorStart = firstKey;
  let longest = 0, run = 0;
  const totalDays = differenceInCalendarDays(parse(todayKey), parse(cursorStart));
  for (let i = 0; i <= totalDays; i++) {
    const d = key(addDays(parse(cursorStart), i));
    if (!isDueOn(habit, d)) continue;
    if (days.has(d)) { run++; longest = Math.max(longest, run); }
    else if (d === todayKey) continue; // today in progress
    else run = 0;
  }
  // Current streak: walk back from today over due days
  let current = 0;
  for (let i = 0; i <= totalDays; i++) {
    const d = key(subDays(parse(todayKey), i));
    if (d < cursorStart) break;
    if (!isDueOn(habit, d)) continue;
    if (days.has(d)) current++;
    else if (d === todayKey) continue;
    else break;
  }

  // Completion rate over the last WINDOW_DAYS (bounded by start), excluding an unfinished today
  const windowStart = key(subDays(parse(todayKey), WINDOW_DAYS - 1)) > cursorStart ? key(subDays(parse(todayKey), WINDOW_DAYS - 1)) : cursorStart;
  let due = 0, met = 0;
  const span = differenceInCalendarDays(parse(todayKey), parse(windowStart));
  for (let i = 0; i <= span; i++) {
    const d = key(addDays(parse(windowStart), i));
    if (!isDueOn(habit, d)) continue;
    if (days.has(d)) { due++; met++; }
    else if (d !== todayKey) due++;
  }
  // Strength over all due days since the start: score = score * m + checked * (1 - m), m = 0.5^(sqrt(f) / 13)
  // where f is the expected completions per day (about a two-week half-life for a daily habit).
  const freq = frequencyOf(habit) === 'weekdays' ? (habit.weekdays?.length || 7) / 7 : 1;
  const mD = Math.pow(0.5, Math.sqrt(freq) / 13);
  let strength = 0, opportunities = 0;
  for (let i = 0; i <= totalDays; i++) {
    const d = key(addDays(parse(cursorStart), i));
    if (!isDueOn(habit, d)) continue;
    if (d === todayKey && !days.has(d)) continue; // today still in progress
    strength = strength * mD + (days.has(d) ? 1 : 0) * (1 - mD);
    opportunities++;
  }
  const wd = wilson(met, due);
  return {
    ...base,
    unit: 'days',
    currentStreak: current,
    longestStreak: longest,
    completionRate: due ? Math.round((met / due) * 100) : null,
    rateLo: wd.lo !== null ? Math.round(wd.lo * 100) : null,
    rateHi: wd.hi !== null ? Math.round(wd.hi * 100) : null,
    strength: opportunities >= 3 ? Math.round(strength * 100) : null,
  };
};

// ─── History calendar ────────────────────────────────────────────────────────

export type DayStatus = 'done' | 'missed' | 'not_due' | 'pending' | 'future' | 'before_start';

export interface CalendarDay { dateKey: string; status: DayStatus; count: number; notes: string[] }

/** Status for each day of a month, for a calendar view. Weekly habits mark a day done when logged, else pending/not_due. */
export const getHabitMonth = (habit: HabitLike, logs: HabitLogLike[], year: number, month0: number, now: Date = new Date()): CalendarDay[] => {
  const todayKey = key(now);
  const own = logs.filter((l) => l.habit_id === habit.id && l.date_key);
  const startKey = habitStartKey(habit, '0000-00-00');
  const out: CalendarDay[] = [];
  const dim = new Date(year, month0 + 1, 0).getDate();
  for (let d = 1; d <= dim; d++) {
    const dateKey = key(new Date(year, month0, d));
    const dayLogs = own.filter((l) => l.date_key === dateKey);
    let status: DayStatus;
    if (dayLogs.length > 0) status = 'done';
    else if (dateKey > todayKey) status = 'future';
    else if (dateKey < startKey) status = 'before_start';
    else if (habit.type === 'event' || isWeekly(habit) || !isDueOn(habit, dateKey)) status = 'not_due';
    else status = dateKey === todayKey ? 'pending' : 'missed';
    out.push({ dateKey, status, count: dayLogs.length, notes: dayLogs.map((l) => l.notes).filter((n): n is string => !!n) });
  }
  return out;
};

/** Human label for the habit's frequency. */
export const describeFrequency = (h: HabitLike): string => {
  if (h.type === 'event') return 'Event';
  switch (frequencyOf(h)) {
    case 'weekly': return 'Once a week';
    case 'times_per_week': return `${weeklyTarget(h)}× per week`;
    case 'weekdays': {
      const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      return (h.weekdays ?? []).slice().sort().map((d) => names[d]).join(', ') || 'Daily';
    }
    default: return 'Daily';
  }
};
