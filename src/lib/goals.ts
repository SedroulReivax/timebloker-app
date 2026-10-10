import { differenceInCalendarDays, format, subDays } from 'date-fns';
import type { RangeBlock } from './blockRange';
import { elapsedBlocksForDate } from './insights';
import { BLOCK_MINUTES } from './taskTime';
import { ewma, quantile } from './stats';

/**
 * Goal progress is a per-day minutes series (one number per date_key), not raw blocks:
 * historical days come from the backend's analytics_goal_daily (Phase C), and the
 * currently-selected/live date is overlaid from optimistic block state the same way
 * useBlockRange/mergeLiveBlocks does for other range views (see mergeGoalDailyLive
 * below). This replaced a version that re-scanned every raw block since the goal's
 * creation on every render -- the daily aggregate already has the
 * exact number this needs, so there is no reason to reconstruct it from blocks.
 */

export interface GoalDayMinutes { date_key: string; minutes: number }

/**
 * Build a goal's daily-minutes series directly from raw blocks already in hand
 * (dedup by block index, elapsed-blocks-only). For callers that already fetched a
 * raw block range for another reason (TrendsTab's own chart range, exportPack's
 * full-range export) and would gain nothing from a second backend round trip; new
 * call sites that don't already have raw blocks should prefer analytics_goal_daily
 * (see GoalsPage) instead of fetching raw blocks just to call this.
 */
export const dailyMinutesFromBlocks = (goal: GoalLike, blocks: RangeBlock[], now: Date = new Date()): GoalDayMinutes[] => {
  const perDay = new Map<string, Set<number>>();
  for (const b of blocks) {
    if (!b.activity_id || !activityCountsOn(goal, b.activity_id, b.date_key)) continue;
    if (b.block_index >= elapsedBlocksForDate(b.date_key, now)) continue;
    (perDay.get(b.date_key) ?? perDay.set(b.date_key, new Set()).get(b.date_key)!).add(b.block_index);
  }
  return Array.from(perDay.entries()).map(([date_key, idx]) => ({ date_key, minutes: idx.size * BLOCK_MINUTES }));
};

/** Group analytics_goal_daily rows (or any {goal_id,date_key,goal_minutes} shape) by goal_id, the
 *  form getGoalHours/getGoalPace/getGoalReview expect. Shared by every screen that reads goal
 *  progress from the backend (GoalsPage, TrendsTab, ReviewPage) so the grouping logic exists once. */
export const groupGoalDailyRows = (rows: { goal_id: string; date_key: string; goal_minutes: number }[]): Map<string, GoalDayMinutes[]> => {
  const byGoal = new Map<string, GoalDayMinutes[]>();
  for (const r of rows) {
    const list = byGoal.get(r.goal_id) ?? [];
    list.push({ date_key: r.date_key, minutes: r.goal_minutes });
    byGoal.set(r.goal_id, list);
  }
  return byGoal;
};

/** Overlay one live (optimistic) date's minutes onto the backend daily series, exactly like mergeLiveBlocks. */
export const mergeGoalDailyLive = (
  daily: GoalDayMinutes[],
  goal: GoalLike,
  liveBlocks: RangeBlock[],
  now: Date = new Date()
): GoalDayMinutes[] => {
  if (liveBlocks.length === 0) return daily;
  const liveDate = liveBlocks[0].date_key;
  const seen = new Set<number>();
  for (const b of liveBlocks) {
    if (!b.activity_id || !activityCountsOn(goal, b.activity_id, liveDate)) continue;
    if (b.block_index >= elapsedBlocksForDate(liveDate, now)) continue;
    seen.add(b.block_index);
  }
  const liveMinutes = seen.size * BLOCK_MINUTES;
  const withoutLiveDate = daily.filter((d) => d.date_key !== liveDate);
  return [...withoutLiveDate, { date_key: liveDate, minutes: liveMinutes }].sort((a, b) => a.date_key.localeCompare(b.date_key));
};

export interface GoalLike {
  id: string;
  status?: string | null;
  target_hours?: number | null;
  target_date?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  linked_activity_ids?: string[] | null;
  linked_habit_ids?: string[] | null;
  linked_activity_ranges?: GoalActivityRanges | null;
}

/** When each activity counted toward a goal. Missing entry = the goal's whole life. Mirrors the SQL goal_activity_counts. */
export type GoalActivityRanges = Record<string, { since?: string | null; until?: string | null }>;

/** Does a block of this activity on this date count toward the goal? Linked now, or unlinked (has an `until`) with the date inside its range. */
export function activityCountsOn(goal: GoalLike, activityId: string, dateKey: string): boolean {
  const range = goal.linked_activity_ranges?.[activityId];
  const since = validDateKey(range?.since);
  const until = validDateKey(range?.until);
  const linked = (goal.linked_activity_ids ?? []).includes(activityId);
  if (!linked && !until) return false;
  if (since && dateKey < since) return false;
  if (until && dateKey > until) return false;
  return true;
}

// Like goal_safe_date in SQL: anything that is not a real yyyy-MM-dd date counts as "not set"
const validDateKey = (v: string | null | undefined): string | null =>
  v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().startsWith(v) ? v : null;

/** True when any activity is linked now or was linked earlier (unlinked ones keep their past days). */
const hasCountedActivities = (goal: GoalLike): boolean =>
  (goal.linked_activity_ids ?? []).length > 0 ||
  Object.values(goal.linked_activity_ranges ?? {}).some((r) => !!validDateKey(r?.until));

/** New ranges after the linked-activity set changes: newly linked start counting today, unlinked stop after today. */
export const applyActivityLinkChange = (goal: GoalLike, nextIds: string[], todayKey: string): GoalActivityRanges => {
  const prev = new Set(goal.linked_activity_ids ?? []);
  const next = new Set(nextIds);
  const ranges: GoalActivityRanges = { ...(goal.linked_activity_ranges ?? {}) };
  for (const id of next) {
    if (prev.has(id)) continue;
    const old = ranges[id];
    // Re-linking resumes the original range (gap days count); a first-time link starts today.
    ranges[id] = old ? { since: old.since ?? null, until: null } : { since: todayKey, until: null };
  }
  for (const id of prev) {
    if (!next.has(id)) ranges[id] = { since: ranges[id]?.since ?? null, until: todayKey };
  }
  return ranges;
};

const key = (d: Date) => format(d, 'yyyy-MM-dd');

/** Local date the goal started (created). */
export const goalStartKey = (g: GoalLike): string | null => (g.created_at ? key(new Date(g.created_at)) : null);

/** Local date a completed/abandoned goal was closed (updated_at), otherwise null. */
export const goalEndKey = (g: GoalLike): string | null =>
  g.status && g.status !== 'active' && g.updated_at ? key(new Date(g.updated_at)) : null;

/** Hours logged on the goal's linked activities from its start date (to its close date when closed). */
export const getGoalHours = (goal: GoalLike, daily: GoalDayMinutes[]): number => {
  if (!hasCountedActivities(goal)) return 0;
  const start = goalStartKey(goal);
  const end = goalEndKey(goal);
  let minutes = 0;
  for (const d of daily) {
    if (start && d.date_key < start) continue;
    if (end && d.date_key > end) continue;
    minutes += d.minutes;
  }
  return minutes / 60;
};

export interface GoalPace {
  hours: number;
  targetHours: number | null;
  remainingHours: number | null;
  /** Recency-weighted weekly pace: exponentially weighted mean of the last (up to) 4 complete weeks. */
  currentWeekly: number;
  /** Hours in the last 7 days. */
  lastWeek: number;
  /** Weekly totals, oldest first, up to 8 complete weeks since the goal started. */
  weeklyHistory: number[];
  /** 25th-75th percentile of weekly totals (needs 4+ weeks): what a normal week looks like. */
  typicalRange: [number, number] | null;
  /** Hours per week still needed to hit the target by the target date; null without both. */
  requiredWeekly: number | null;
  daysRemaining: number | null;
  /** Weeks to reach the target at the current pace; null when pace is 0 or no target. */
  weeksToTarget: number | null;
  /** Range of weeks to target using a good week (75th pct) and a slow week (25th pct). */
  weeksToTargetRange: [number, number] | null;
  /** Days since the last tracked linked block (0 = today); null if never. A long stall matters more than an average. */
  stalledDays: number | null;
}

/**
 * Pace from the daily minutes series. The old version used a flat 28-day mean, which kept reporting a healthy pace
 * long after work had stopped. This one weights recent weeks more, reports the last 7 days separately, gives a range
 * instead of a single number, and detects a stall.
 */
export const getGoalPace = (goal: GoalLike, daily: GoalDayMinutes[], now: Date = new Date()): GoalPace => {
  const hours = getGoalHours(goal, daily);
  const target = goal.target_hours && goal.target_hours > 0 ? goal.target_hours : null;
  const remaining = target !== null ? Math.max(0, target - hours) : null;

  const start = goalStartKey(goal);
  const minutesByDate = new Map<string, number>();
  for (const d of daily) {
    if (start && d.date_key < start) continue;
    minutesByDate.set(d.date_key, (minutesByDate.get(d.date_key) ?? 0) + d.minutes);
  }
  const hoursOn = (dk: string) => (minutesByDate.get(dk) ?? 0) / 60;
  const hoursBetween = (fromAgo: number, toAgo: number) => {
    let h = 0;
    for (let a = fromAgo; a >= toAgo; a--) h += hoursOn(key(subDays(now, a)));
    return h;
  };

  const daysSinceStart = start ? Math.max(1, differenceInCalendarDays(now, new Date(start + 'T00:00:00')) + 1) : 28;
  const nWeeks = Math.min(8, Math.floor(daysSinceStart / 7));
  const history: number[] = [];
  for (let k = nWeeks - 1; k >= 0; k--) history.push(hoursBetween(6 + 7 * k, 7 * k));
  const lastWeek = hoursBetween(6, 0);

  let currentWeekly: number;
  if (nWeeks === 0) currentWeekly = (hours / daysSinceStart) * 7;
  else currentWeekly = ewma(history.slice(-4), 0.5) as number;

  const typicalRange: [number, number] | null = history.length >= 4 ? [quantile(history, 0.25) as number, quantile(history, 0.75) as number] : null;

  let daysRemaining: number | null = null;
  let requiredWeekly: number | null = null;
  if (goal.target_date) {
    daysRemaining = differenceInCalendarDays(new Date(goal.target_date), now);
    if (remaining !== null && daysRemaining > 0) requiredWeekly = remaining / (daysRemaining / 7);
  }

  let weeksToTargetRange: [number, number] | null = null;
  if (remaining !== null && remaining > 0 && typicalRange && typicalRange[1] > 0) {
    weeksToTargetRange = [remaining / typicalRange[1], typicalRange[0] > 0 ? remaining / typicalRange[0] : Infinity];
  }

  let stalledDays: number | null = null;
  for (let a = 0; a < Math.max(daysSinceStart, 1) && a < 400; a++) {
    if ((minutesByDate.get(key(subDays(now, a))) ?? 0) > 0) { stalledDays = a; break; }
  }

  return {
    hours,
    targetHours: target,
    remainingHours: remaining,
    currentWeekly,
    lastWeek,
    weeklyHistory: history,
    typicalRange,
    requiredWeekly,
    daysRemaining,
    weeksToTarget: remaining !== null && currentWeekly > 0 ? remaining / currentWeekly : null,
    weeksToTargetRange,
    stalledDays,
  };
};

export interface HabitLogLike { habit_id: string; date_key: string | null }

export interface GoalHabitProgress {
  habitId: string;
  /** Distinct days logged since the goal started. */
  daysLogged: number;
  /** Days since the goal started (inclusive). */
  daysElapsed: number;
  perWeek: number;
}

/** Completion frequency of each linked habit since the goal started (or over the last 28 days if no start). */
export const getGoalHabitProgress = (goal: GoalLike, logs: HabitLogLike[], now: Date = new Date()): GoalHabitProgress[] => {
  const start = goalStartKey(goal) ?? key(subDays(now, 27));
  const end = goalEndKey(goal) ?? key(now);
  const daysElapsed = Math.max(1, differenceInCalendarDays(new Date(end + 'T00:00:00'), new Date(start + 'T00:00:00')) + 1);
  return (goal.linked_habit_ids ?? []).map((habitId) => {
    const days = new Set(logs.filter((l) => l.habit_id === habitId && l.date_key && l.date_key >= start && l.date_key <= end).map((l) => l.date_key));
    return { habitId, daysLogged: days.size, daysElapsed, perWeek: (days.size / daysElapsed) * 7 };
  });
};

export interface GoalReview {
  startKey: string | null;
  endKey: string | null;
  actualHours: number;
  plannedHours: number | null;
  habits: GoalHabitProgress[];
}

export const getGoalReview = (goal: GoalLike, daily: GoalDayMinutes[], logs: HabitLogLike[], now: Date = new Date()): GoalReview => ({
  startKey: goalStartKey(goal),
  endKey: goalEndKey(goal),
  actualHours: getGoalHours(goal, daily),
  plannedHours: goal.target_hours ?? null,
  habits: getGoalHabitProgress(goal, logs, now),
});
