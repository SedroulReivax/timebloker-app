import { eachDayOfInterval, format, startOfDay, subDays, subMonths, subYears } from 'date-fns';
import type { RangeBlock } from './blockRange';
import { BLOCK_MINUTES } from './taskTime';

/** Analytics over raw data. Everything here is derived and reproducible from blocks/tasks/sessions. */

export type InsightRange = '1d' | '7d' | '30d' | '90d' | '6m' | '1y';
/** The range every Analysis tab opens on. */
export const DEFAULT_RANGE: InsightRange = '30d';
export const INSIGHT_RANGES: { id: InsightRange; label: string }[] = [
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
  { id: '90d', label: '90d' },
  { id: '6m', label: '6m' },
  { id: '1y', label: '1y' },
];

const key = (d: Date) => format(d, 'yyyy-MM-dd');

export interface RangeWindow {
  startKey: string;
  endKey: string;
  dateKeys: string[];
  /** Previous period of the same length (null for 1d/6m/1y: too many rows to fetch twice, or a single day). */
  prev: { startKey: string; endKey: string; dateKeys: string[] } | null;
  /** For '1d': the 28 days before it, the "typical day" a single day is compared with. */
  history?: { startKey: string; endKey: string; dateKeys: string[] };
}

/** Days of history a single day is compared with. */
export const DAY_HISTORY = 28;

const windowOf = (start: Date, end: Date) => {
  const days = eachDayOfInterval({ start, end }).map(key);
  return { startKey: days[0], endKey: days[days.length - 1], dateKeys: days };
};

export const getRangeWindow = (range: InsightRange, end: Date): RangeWindow => {
  const endDay = startOfDay(end);
  let start: Date;
  let prevStart: Date | null = null;
  let prevEnd: Date | null = null;
  if (range === '1d') {
    return { ...windowOf(endDay, endDay), prev: null, history: windowOf(subDays(endDay, DAY_HISTORY), subDays(endDay, 1)) };
  }
  switch (range) {
    case '7d': start = subDays(endDay, 6); prevEnd = subDays(start, 1); prevStart = subDays(prevEnd, 6); break;
    case '30d': start = subDays(endDay, 29); prevEnd = subDays(start, 1); prevStart = subDays(prevEnd, 29); break;
    case '90d': start = subDays(endDay, 89); prevEnd = subDays(start, 1); prevStart = subDays(prevEnd, 89); break;
    case '6m': start = subMonths(endDay, 6); break;
    default: start = subYears(endDay, 1);
  }
  const w = windowOf(start, endDay);
  return { ...w, prev: prevStart && prevEnd ? windowOf(prevStart, prevEnd) : null };
};

// ─── Grouping ────────────────────────────────────────────────────────────────

export const groupBlocksByDate = (blocks: RangeBlock[]): Record<string, RangeBlock[]> => {
  const map: Record<string, RangeBlock[]> = {};
  for (const b of blocks) (map[b.date_key] ||= []).push(b);
  return map;
};

/** Number of fully elapsed blocks for a date (past = 144, today = so far, future = 0). */
export const elapsedBlocksForDate = (dateKey: string, now: Date): number => {
  const todayKey = key(now);
  if (dateKey < todayKey) return 144;
  if (dateKey > todayKey) return 0;
  return Math.min(144, Math.floor((now.getHours() * 60 + now.getMinutes()) / BLOCK_MINUTES));
};

// ─── Tracking coverage (separate from focus/consistency) ─────────────────────

export interface Coverage {
  trackedMinutes: number;
  untrackedMinutes: number;
  elapsedMinutes: number;
  /** 0-100, or null when nothing has elapsed. Not a productivity measure. */
  coveragePct: number | null;
}

export const getCoverage = (blocks: RangeBlock[], dateKeys: string[], now: Date = new Date()): Coverage => {
  const byDate = groupBlocksByDate(blocks);
  let tracked = 0;
  let elapsed = 0;
  for (const dk of dateKeys) {
    const e = elapsedBlocksForDate(dk, now);
    elapsed += e;
    const seen = new Set<number>();
    for (const b of byDate[dk] || []) if (b.activity_id && b.block_index < e) seen.add(b.block_index);
    tracked += seen.size;
  }
  return {
    trackedMinutes: tracked * BLOCK_MINUTES,
    untrackedMinutes: (elapsed - tracked) * BLOCK_MINUTES,
    elapsedMinutes: elapsed * BLOCK_MINUTES,
    coveragePct: elapsed > 0 ? Math.round((tracked / elapsed) * 100) : null,
  };
};

// ─── Time distribution ───────────────────────────────────────────────────────

export interface ActivityInfo { id: string; category?: string | null }
export interface DistributionRow { category: string; minutes: number; pct: number; prevMinutes?: number }

export const categoryOf = (a: ActivityInfo | undefined, sleepIds: Set<string>): string => {
  if (!a) return 'Uncategorized';
  if (sleepIds.has(a.id)) return 'Sleep';
  return a.category || 'Uncategorized';
};

/** Minutes per category over elapsed time, with an 'Untracked' row. Percentages are of elapsed time. */
export const getDistribution = (
  blocks: RangeBlock[],
  activities: ActivityInfo[],
  sleepIds: Set<string>,
  coverage: Coverage,
  prevBlocks?: RangeBlock[]
): DistributionRow[] => {
  const info = new Map(activities.map((a) => [a.id, a]));
  const totals = new Map<string, number>();
  const prevTotals = new Map<string, number>();
  const add = (m: Map<string, number>, list: RangeBlock[]) => {
    for (const b of list) {
      if (!b.activity_id) continue;
      const c = categoryOf(info.get(b.activity_id), sleepIds);
      m.set(c, (m.get(c) || 0) + BLOCK_MINUTES);
    }
  };
  add(totals, blocks);
  if (prevBlocks) add(prevTotals, prevBlocks);
  if (coverage.untrackedMinutes > 0) totals.set('Untracked', coverage.untrackedMinutes);
  const denom = coverage.elapsedMinutes || 1;
  return Array.from(totals.entries())
    .map(([category, minutes]) => ({ category, minutes, pct: Math.round((minutes / denom) * 100), ...(prevBlocks ? { prevMinutes: prevTotals.get(category) || 0 } : {}) }))
    .sort((a, b) => b.minutes - a.minutes);
};

/** The subset of an analytics_activity_daily row (or any equivalent shape) distributionFromActivityDaily needs. */
export interface ActivityDailyLike { activity_id: string; minutes: number }

/**
 * Same category-summing/sorting/'Untracked' logic as getDistribution, sourced from
 * analytics_activity_daily's stored per-activity minutes instead of counting raw blocks
 * (activity/day totals are already canonicalized in SQL). Percentages are
 * still of elapsed time (coverage.elapsedMinutes), matching getDistribution exactly.
 */
export const distributionFromActivityDaily = (
  rows: ActivityDailyLike[],
  activities: ActivityInfo[],
  sleepIds: Set<string>,
  coverage: Pick<Coverage, 'elapsedMinutes' | 'untrackedMinutes'>,
  prevRows?: ActivityDailyLike[]
): DistributionRow[] => {
  const info = new Map(activities.map((a) => [a.id, a]));
  const totals = new Map<string, number>();
  const prevTotals = new Map<string, number>();
  const add = (m: Map<string, number>, list: ActivityDailyLike[]) => {
    for (const r of list) {
      const c = categoryOf(info.get(r.activity_id), sleepIds);
      m.set(c, (m.get(c) || 0) + r.minutes);
    }
  };
  add(totals, rows);
  if (prevRows) add(prevTotals, prevRows);
  if (coverage.untrackedMinutes > 0) totals.set('Untracked', coverage.untrackedMinutes);
  const denom = coverage.elapsedMinutes || 1;
  return Array.from(totals.entries())
    .map(([category, minutes]) => ({ category, minutes, pct: Math.round((minutes / denom) * 100), ...(prevRows ? { prevMinutes: prevTotals.get(category) || 0 } : {}) }))
    .sort((a, b) => b.minutes - a.minutes);
};

export interface NamedActivityInfo { id: string; name: string; color?: string | null }
export interface ActivityDistributionRow { id: string; name: string; color: string; minutes: number; pct: number }

/** Minutes per individual activity over elapsed time, with an 'Untracked' row. Percentages are of elapsed time. */
export const getActivityDistribution = (
  blocks: RangeBlock[],
  activities: NamedActivityInfo[],
  coverage: Coverage
): ActivityDistributionRow[] => {
  const info = new Map(activities.map((a) => [a.id, a]));
  const totals = new Map<string, number>();
  for (const b of blocks) {
    if (!b.activity_id) continue;
    totals.set(b.activity_id, (totals.get(b.activity_id) || 0) + BLOCK_MINUTES);
  }
  const denom = coverage.elapsedMinutes || 1;
  const rows = Array.from(totals.entries()).map(([id, minutes]) => {
    const a = info.get(id);
    return { id, name: a?.name ?? 'Unknown activity', color: a?.color || 'hsl(var(--muted-foreground))', minutes, pct: Math.round((minutes / denom) * 100) };
  });
  if (coverage.untrackedMinutes > 0) rows.push({ id: 'untracked', name: 'Untracked', color: 'hsl(var(--muted))', minutes: coverage.untrackedMinutes, pct: Math.round((coverage.untrackedMinutes / denom) * 100) });
  return rows.sort((a, b) => b.minutes - a.minutes);
};

/**
 * getActivityDistribution's per-activity rows, sourced from analytics_activity_daily's stored minutes instead of
 * raw blocks (the activity counterpart of distributionFromActivityDaily). Beyond `limit` activities the smallest
 * are merged into one "Other activities" row so a long tail does not swamp the list; Untracked stays last-sorted
 * by size like every other row. Percentages are of elapsed time.
 */
export const activityDistributionFromActivityDaily = (
  rows: ActivityDailyLike[],
  activities: NamedActivityInfo[],
  coverage: Pick<Coverage, 'elapsedMinutes' | 'untrackedMinutes'>,
  limit = 12
): ActivityDistributionRow[] => {
  const info = new Map(activities.map((a) => [a.id, a]));
  const totals = new Map<string, number>();
  for (const r of rows) {
    if (r.minutes > 0) totals.set(r.activity_id, (totals.get(r.activity_id) || 0) + r.minutes);
  }
  const denom = coverage.elapsedMinutes || 1;
  const row = (id: string, name: string, color: string, minutes: number): ActivityDistributionRow => ({ id, name, color, minutes, pct: Math.round((minutes / denom) * 100) });
  let out = Array.from(totals.entries())
    .map(([id, minutes]) => row(id, info.get(id)?.name ?? 'Unknown activity', info.get(id)?.color || 'hsl(var(--muted-foreground))', minutes))
    .sort((a, b) => b.minutes - a.minutes);
  if (out.length > limit) {
    const rest = out.slice(limit - 1).reduce((s, r) => s + r.minutes, 0);
    out = [...out.slice(0, limit - 1), row('other', 'Other activities', 'hsl(0 0% 50%)', rest)];
  }
  if (coverage.untrackedMinutes > 0) out.push(row('untracked', 'Untracked', 'hsl(var(--muted))', coverage.untrackedMinutes));
  return out.sort((a, b) => b.minutes - a.minutes);
};

// ─── Focus sessions ──────────────────────────────────────────────────────────

export interface SessionLike { started_at: string; duration_minutes: number; task_id?: string | null }

/** Focused minutes per local date. */
export const getFocusByDate = (sessions: SessionLike[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const s of sessions) {
    const k = key(new Date(s.started_at));
    out[k] = (out[k] || 0) + s.duration_minutes;
  }
  return out;
};

// ─── Task-based measurements ─────────────────────────────────────────────────

export interface AnalyticsTask {
  id: string;
  title: string;
  completed: boolean;
  completed_at?: string | null;
  deadline?: string | null;
  activity_id?: string | null;
  estimated_minutes?: number | null;
  estimated_pomodoros?: number | null;
}

export interface TaskBlockLike { date_key: string; block_index: number; task_id: string }

export interface TimeAccounting { taskLinked: number; otherTracked: number; untracked: number }

/**
 * Where elapsed time went: blocks linked to a task, other tracked blocks, and untracked time.
 * (Plans are not snapshotted, so "leakage" is measured as the untracked share of elapsed time.)
 */
export const getTimeAccounting = (blocks: RangeBlock[], coverage: Coverage, sleepIds: Set<string>): TimeAccounting => {
  let taskLinked = 0;
  let other = 0;
  for (const b of blocks) {
    if (!b.activity_id || sleepIds.has(b.activity_id)) continue;
    if (b.task_id) taskLinked += BLOCK_MINUTES;
    else other += BLOCK_MINUTES;
  }
  return { taskLinked, otherTracked: other, untracked: coverage.untrackedMinutes };
};

// ─── Logging gaps: where you usually forget to track ────────────────────────

export interface GapCell {
  /** untracked share of elapsed time in this weekday x hour, 0-100; null with too few days */
  untrackedPct: number | null;
  days: number;
}

/**
 * Weekday (Sun..Sat) x hour map of untracked time. Sleep counts as tracked (it was logged). Only days from the first
 * tracked day in the range onward are used, so the weeks before you started do not show up as one big gap.
 * Cells need `minDays` days to be shown, otherwise null.
 */
export const loggingGaps = (blocks: RangeBlock[], dateKeys: string[], now: Date = new Date(), minDays = 3): { cells: GapCell[][]; overallPct: number | null; days: number; notTrackedDays: number } => {
  const byDate = groupBlocksByDate(blocks);
  const first = dateKeys.find((k) => (byDate[k] || []).some((b) => b.activity_id));
  const elapsedN = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const gapN = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const dayN = Array.from({ length: 7 }, () => new Array(24).fill(0));
  let totE = 0, totG = 0, days = 0, notTrackedDays = 0;
  if (first) {
    for (const dk of dateKeys) {
      if (dk < first) continue;
      const e = elapsedBlocksForDate(dk, now);
      if (e === 0) continue;
      // A day with nothing tracked at all is a day away from the app, not an hour-of-day habit: counted
      // separately, so a week off doesn't paint every cell of the map (today is excluded: it may just be early)
      if (!(byDate[dk] || []).some((b) => b.activity_id)) { if (e === 144) notTrackedDays++; continue; }
      days++;
      const wd = new Date(`${dk}T12:00:00`).getDay();
      const tracked = new Set<number>();
      for (const b of byDate[dk] || []) if (b.activity_id) tracked.add(b.block_index);
      const seenHours = new Set<number>();
      for (let i = 0; i < e; i++) {
        const h = Math.floor(i / 6);
        elapsedN[wd][h]++;
        totE++;
        seenHours.add(h);
        if (!tracked.has(i)) { gapN[wd][h]++; totG++; }
      }
      for (const h of seenHours) dayN[wd][h]++;
    }
  }
  const cells = Array.from({ length: 7 }, (_, d) =>
    Array.from({ length: 24 }, (_, h): GapCell => ({
      untrackedPct: dayN[d][h] >= minDays ? Math.round((gapN[d][h] / elapsedN[d][h]) * 100) : null,
      days: dayN[d][h],
    }))
  );
  return { cells, overallPct: totE ? Math.round((totG / totE) * 100) : null, days, notTrackedDays };
};

/** The worst cells (most untracked), for a "biggest blind spots" list. */
export const blindSpots = (cells: GapCell[][], n = 3): { weekday: number; hour: number; untrackedPct: number; days: number }[] => {
  const out: { weekday: number; hour: number; untrackedPct: number; days: number }[] = [];
  cells.forEach((row, weekday) => row.forEach((c, hour) => { if (c.untrackedPct !== null && c.untrackedPct > 0) out.push({ weekday, hour, untrackedPct: c.untrackedPct, days: c.days }); }));
  return out.sort((a, b) => b.untrackedPct - a.untrackedPct || b.days - a.days).slice(0, n);
};
