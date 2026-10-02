import { addDays, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek, subMonths, subWeeks } from 'date-fns';
import type { RangeBlock } from './blockRange';
import { distributionFromActivityDaily, type ActivityInfo, type AnalyticsTask, type DistributionRow } from './insights';
import { attentionPeriod, type AttentionDailyRow, type AttentionPeriod } from './attention';
import { compareMetric, summarize, type DayProfile, type Summary } from './analysis';
import type { HabitLike } from './habits';
import { type GoalDayMinutes } from './goals';
import { buildNights } from './sleepAnalysis';
import { compareSamples, wilson, type ChangeResult } from './stats';
import { isOverdue } from './taskFilters';
import type { Task } from '../types';

/**
 * Weekly and monthly review summaries. Deterministic totals come from the backend analytics tables (via the same
 * per-day profiles as the rest of Analysis, plus analytics_daily for timer/tasks/attention); only sleep nights and the
 * focus-model fields are computed here from a bounded raw-block fetch. Every "vs previous period" statement carries an
 * interval: a change is only called up or down when the day-level data supports it.
 */

export type ReviewPeriod = 'week' | 'month';

export interface PeriodWindow { startKey: string; endKey: string; dateKeys: string[] }

const key = (d: Date) => format(d, 'yyyy-MM-dd');
const windowFor = (start: Date, end: Date): PeriodWindow => {
  const dateKeys: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) dateKeys.push(key(d));
  return { startKey: dateKeys[0], endKey: dateKeys[dateKeys.length - 1], dateKeys };
};

/** Review window containing `date`: Monday-Sunday week or calendar month, plus the one before it. */
export const getReviewWindows = (period: ReviewPeriod, date: Date): { current: PeriodWindow; previous: PeriodWindow } => {
  if (period === 'week') {
    const s = startOfWeek(date, { weekStartsOn: 1 });
    return { current: windowFor(s, endOfWeek(date, { weekStartsOn: 1 })), previous: windowFor(subWeeks(s, 1), addDays(s, -1)) };
  }
  const s = startOfMonth(date);
  const ps = subMonths(s, 1);
  return { current: windowFor(s, endOfMonth(date)), previous: windowFor(ps, endOfMonth(ps)) };
};

/** Stable key for storing a reflection: the week's Monday, or yyyy-MM. */
export const reviewPeriodKey = (period: ReviewPeriod, date: Date): string =>
  period === 'week' ? key(startOfWeek(date, { weekStartsOn: 1 })) : format(date, 'yyyy-MM');

/** The subset of an analytics_activity_daily row summarizePeriod needs. */
export interface ActivityDailyLike { date_key: string; activity_id: string; minutes: number }
/** The subset of an analytics_daily row summarizePeriod reads directly (the rest arrives through `profiles`). */
export interface DailyFactsLike extends AttentionDailyRow { task_focus_minutes: number; tasks_completed: number }
/** The subset of an analytics_habit_daily row summarizePeriod needs. */
export interface HabitDailyLike { date_key: string; habit_id: string; due: boolean; completed: boolean }

export interface PeriodInput {
  /** Backend-derived DayProfile[] (mapAnalyticsToProfiles + analysis.ts's focusSupplementByDate),
   *  covering both the current and previous window. */
  profiles: DayProfile[];
  /** analytics_daily rows for the same combined range (timer minutes, tasks completed, attention). */
  daily: DailyFactsLike[];
  /** analytics_activity_daily rows for the same combined range. */
  activityDaily: ActivityDailyLike[];
  /** analytics_habit_daily rows for the same combined range. */
  habitDaily: HabitDailyLike[];
  /** Per-goal daily minutes (backend + live-merged), grouped by goal_id, for the same range. */
  goalDailyByGoal: Map<string, GoalDayMinutes[]>;
  /** Raw sleep blocks only, bounded to the two windows -- buildNights is sequence-dependent and
   *  has no backend equivalent. */
  sleepBlocks: RangeBlock[];
  activities: (ActivityInfo & { id: string })[];
  sleepIds: Set<string>;
  /** for overdue-at-period-end only; completions per day come from analytics_daily */
  tasks: (AnalyticsTask & Partial<Task>)[];
  habits: HabitLike[];
  goals: { id: string; title: string; linked_activity_ids?: string[] | null }[];
}

export interface PeriodSummary {
  window: PeriodWindow;
  profiles: DayProfile[];
  summary: Summary;
  focusedMinutes: number;
  tasksDone: number;
  /** Open tasks whose deadline had passed by the end of the period. */
  tasksOverdue: number;
  distribution: DistributionRow[];
  sleepAvgMinutes: number | null;
  sleepNights: number;
  /** total minutes per tracked night waking inside the period */
  nightly: number[];
  /** Share of due habit-days completed (daily/weekday habits), with an 80% interval; null when none were due. */
  habitConsistencyPct: number | null;
  habitLo: number | null;
  habitHi: number | null;
  goalHours: { goalId: string; title: string; hours: number }[];
  /** attention spent vs productivity value (analytics_daily) */
  attention: AttentionPeriod;
  /** day-level values for finished days of the period, used for comparisons */
  perDay: { tasksDone: number[]; timerFocus: number[]; goalHours: number[] };
}

export const summarizePeriod = (input: PeriodInput, window: PeriodWindow, now: Date = new Date()): PeriodSummary => {
  const inWindow = (dk: string) => dk >= window.startKey && dk <= window.endKey;
  const profiles = input.profiles.filter((p) => inWindow(p.dateKey));
  const summary = summarize(profiles);

  const coverage = { elapsedMinutes: summary.elapsedMinutes, untrackedMinutes: summary.elapsedMinutes - summary.assignedMinutes };
  const distribution = distributionFromActivityDaily(input.activityDaily.filter((r) => inWindow(r.date_key)), input.activities, input.sleepIds, coverage);

  const dailyByKey = new Map(input.daily.map((r) => [r.date_key, r]));
  const timerOn = (dk: string) => Number(dailyByKey.get(dk)?.task_focus_minutes ?? 0);
  const doneOn = (dk: string) => Number(dailyByKey.get(dk)?.tasks_completed ?? 0);
  const focusedMinutes = window.dateKeys.reduce((s, k) => s + timerOn(k), 0);
  const tasksDone = window.dateKeys.reduce((s, k) => s + doneOn(k), 0);
  const endOfPeriod = new Date(window.endKey + 'T23:59:59');
  const asOf = endOfPeriod < now ? endOfPeriod : now;
  const tasksOverdue = input.tasks.filter((t) => isOverdue(t as Task, asOf)).length;

  // Sleep: nights whose wake date falls inside the period
  const nightKeys = window.dateKeys.map((k) => format(addDays(new Date(k + 'T00:00:00'), -1), 'yyyy-MM-dd'));
  const nights = buildNights(input.sleepBlocks, nightKeys).filter((n) => n.totalMinutes > 0 && inWindow(n.wakeDate));
  const nightly = nights.map((n) => n.totalMinutes);
  const sleepAvgMinutes = nightly.length ? nightly.reduce((a, b) => a + b, 0) / nightly.length : null;

  // Habit consistency over due days that have finished (today only counts once logged); due/completed
  // now come straight from analytics_habit_daily instead of re-deriving isDueOn/logged here.
  const todayKey = key(now);
  const habitDailyByKey = new Map(input.habitDaily.map((r) => [`${r.habit_id}|${r.date_key}`, r]));
  let due = 0, met = 0;
  for (const h of input.habits.filter((x) => x.type === 'daily' && (x.frequency ?? 'daily') !== 'weekly' && x.frequency !== 'times_per_week')) {
    const created = h.created_at ? key(new Date(h.created_at)) : '0000-00-00';
    for (const dk of window.dateKeys) {
      if (dk > todayKey || dk < created) continue;
      const row = habitDailyByKey.get(`${h.id}|${dk}`);
      if (!row?.due) continue;
      if (row.completed) { due++; met++; } else if (dk !== todayKey) due++;
    }
  }
  const hw = wilson(met, due);

  // Goal hours: per-goal total across the window (goalHours), and all goals combined per
  // finished day (perDay.goalHours) -- two different reductions over the same daily series.
  const goalMinutesInWindow = (goalId: string) => (input.goalDailyByGoal.get(goalId) ?? []).filter((d) => inWindow(d.date_key));
  const goalHours = input.goals
    .map((g) => ({ goalId: g.id, title: g.title, hours: goalMinutesInWindow(g.id).reduce((s, d) => s + d.minutes, 0) / 60 }))
    .filter((g) => g.hours > 0);

  const finished = window.dateKeys.filter((k) => k < todayKey);
  const perDay = {
    tasksDone: finished.map(doneOn),
    timerFocus: finished.map(timerOn),
    goalHours: finished.map((dk) => input.goals.reduce((s, g) => s + ((input.goalDailyByGoal.get(g.id) ?? []).find((d) => d.date_key === dk)?.minutes ?? 0), 0) / 60),
  };

  return {
    window,
    profiles,
    summary,
    focusedMinutes,
    tasksDone,
    tasksOverdue,
    distribution,
    sleepAvgMinutes,
    sleepNights: nights.length,
    nightly,
    habitConsistencyPct: hw.p !== null ? Math.round(hw.p * 100) : null,
    habitLo: hw.lo !== null ? Math.round(hw.lo * 100) : null,
    habitHi: hw.hi !== null ? Math.round(hw.hi * 100) : null,
    goalHours,
    attention: attentionPeriod(input.daily, window.dateKeys),
    perDay,
  };
};

export interface PeriodComparison {
  /** tracked minutes per day (finished days that have any tracking) */
  tracked: ChangeResult;
  /** minutes in uninterrupted 30+ minute focus runs, per day */
  deep: ChangeResult;
  /** mean focus depth on days with at least 30 minutes of focus */
  quality: ChangeResult;
  /** tasks completed per day */
  tasksDone: ChangeResult;
  /** timer focus minutes per day */
  timerFocus: ChangeResult;
  /** hours on goals per day */
  goalHours: ChangeResult;
  /** minutes slept per night */
  sleep: ChangeResult;
  /** minutes-weighted average productivity multiplier per day */
  productivity: ChangeResult;
  /** minutes on negative-multiplier activities per day */
  waste: ChangeResult;
}

export const comparePeriods = (cur: PeriodSummary, prev: PeriodSummary): PeriodComparison => ({
  tracked: compareMetric(cur.profiles, prev.profiles, 'tracked'),
  deep: compareMetric(cur.profiles, prev.profiles, 'deep'),
  quality: compareMetric(cur.profiles, prev.profiles, 'quality'),
  tasksDone: compareSamples(cur.perDay.tasksDone, prev.perDay.tasksDone, { minEach: 5 }),
  timerFocus: compareSamples(cur.perDay.timerFocus, prev.perDay.timerFocus, { minEach: 5 }),
  goalHours: compareSamples(cur.perDay.goalHours, prev.perDay.goalHours, { minEach: 5 }),
  sleep: compareSamples(cur.nightly, prev.nightly, { minEach: 3 }),
  productivity: compareMetric(cur.profiles, prev.profiles, 'productivity'),
  waste: compareMetric(cur.profiles, prev.profiles, 'waste'),
});

// ─── Daily energy (1-7, from day reflections) ────────────────────────────────

export interface EnergyDay { dateKey: string; energy: number | null }
export interface EnergySummary {
  days: EnergyDay[];
  /** rated days in the window */
  n: number;
  /** mean of the rated days; null when none are rated */
  mean: number | null;
}

/** The self-rated energy for each day of a window. Unrated days stay null, never 0. */
export const energyForPeriod = (
  reviews: { period_type: string; period_key: string; energy?: number | null }[],
  window: PeriodWindow,
): EnergySummary => {
  const byDay = new Map<string, number>();
  for (const r of reviews) if (r.period_type === 'day' && r.energy != null) byDay.set(r.period_key, r.energy);
  const days = window.dateKeys.map((dateKey) => ({ dateKey, energy: byDay.get(dateKey) ?? null }));
  const rated = days.map((d) => d.energy).filter((v): v is number => v !== null);
  return { days, n: rated.length, mean: rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : null };
};
