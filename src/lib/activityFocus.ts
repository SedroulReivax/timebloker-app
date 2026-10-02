import { format, parseISO, startOfWeek } from 'date-fns';
import type { RangeBlock } from './blockRange';
import { elapsedBlocksFor } from './analysis';
import { sessionBlocksByDay, type FocusSession } from './focusModel';
import { median } from './stats';
import { coreWindow, slotMinutes, SLOT_COUNT, SLOT_MINUTES, type SlotWindow } from './timeOfDay';

/**
 * When have you actually focused, and on what?
 *
 * Descriptive, not predictive: this only counts what you logged. No recency weighting, no smoothing, no shrinkage.
 * A block counts as FOCUSED on activity A when it sits inside a run of A that holds at least 30 minutes of A.
 * A single 10-minute block of something else (or nothing) between two blocks of A does not end the run, but that blip
 * is not counted as A. Sleep and ignored activities never count and act like a gap. Blocks covered only by a focus-timer
 * session (nothing painted) count as the pseudo-activity "Focus timer".
 */

export const TIMER_ID = '__timer__';
export const OTHER_ID = '__other__';
const MIN_RUN_BLOCKS = 3;

export interface FocusActivityInfo {
  id: string;
  name: string;
  color?: string | null;
  analysis_ignored?: boolean | null;
}

export interface ActivityFocusInput {
  blocks: RangeBlock[];
  activities: FocusActivityInfo[];
  sleepIds: Set<string>;
  sessions?: FocusSession[];
}

export interface FocusRun {
  activityId: string;
  startIdx: number;
  endIdx: number;
  /** blocks of the activity inside the run (excludes a tolerated blip) */
  blocks: number;
}

/**
 * Runs of the same activity with one-block blip tolerance. `day` holds an activity id (or null) per 10-minute block.
 * Returns every run; a run is focused when `blocks >= 3`. A blip is only tolerated after 2+ blocks of the activity
 * since the run started or since the previous blip: otherwise alternating A B A B A B would count as 30 minutes
 * focused on A and, at the same time, 30 minutes focused on B.
 */
export const findRuns = (day: (string | null)[]): FocusRun[] => {
  const runs: FocusRun[] = [];
  let i = 0;
  while (i < day.length) {
    const a = day[i];
    if (!a) { i++; continue; }
    let end = i, blocks = 1, clean = 1, j = i + 1;
    while (j < day.length) {
      if (day[j] === a) { blocks++; clean++; end = j; j++; continue; }
      if (clean >= 2 && j + 1 < day.length && day[j + 1] === a) { clean = 0; j++; continue; } // tolerate one blip
      break;
    }
    runs.push({ activityId: a, startIdx: i, endIdx: end, blocks });
    i = end + 1;
  }
  return runs;
};

/** Per-day arrays of the judged activity at each elapsed block (null for untracked, sleep, ignored, future). */
export const judgedDays = (input: ActivityFocusInput, dateKeys: string[], now: Date): { dateKey: string; day: (string | null)[] }[] => {
  const ignored = new Set(input.sleepIds);
  for (const a of input.activities) if (a.analysis_ignored) ignored.add(a.id);
  const byDate = new Map<string, (string | null)[]>();
  for (const b of input.blocks) {
    if (!b.activity_id || ignored.has(b.activity_id)) continue;
    const arr = byDate.get(b.date_key) ?? byDate.set(b.date_key, new Array(144).fill(null)).get(b.date_key)!;
    arr[b.block_index] = b.activity_id;
  }
  const sessions = sessionBlocksByDay(input.sessions ?? []);
  // A timer block over a painted sleep or ignored block stays unjudged
  const painted = new Set(input.blocks.filter((b) => b.activity_id).map((b) => `${b.date_key}_${b.block_index}`));
  return dateKeys.map((dateKey) => {
    const elapsed = elapsedBlocksFor(dateKey, now);
    const day = (byDate.get(dateKey) ?? new Array(144).fill(null)).slice();
    const timer = sessions.get(dateKey);
    if (timer) for (const i of timer) if (day[i] === null && !painted.has(`${dateKey}_${i}`)) day[i] = TIMER_ID;
    for (let i = elapsed; i < 144; i++) day[i] = null;
    return { dateKey, day };
  });
};

export interface ActivityFocusRow {
  id: string;
  name: string;
  color: string;
  focusedMinutes: number;
  /** all judged minutes on the activity, focused or not */
  totalMinutes: number;
  /** focused share of all time on the activity, 0-100 */
  focusRatePct: number;
  /** days with at least one focused run */
  focusedDays: number;
  runs: number;
  medianRunMinutes: number | null;
  longestRunMinutes: number;
  /** median start time of focused runs, minutes after midnight */
  medianStartMin: number | null;
  /** focused minutes per observed day in the range */
  perDayMinutes: number;
  /** focused minutes per 30-minute slot */
  slots: number[];
  /** shortest window holding half of the focused minutes */
  core: SlotWindow | null;
  /** shortest window holding 80% of the focused minutes */
  span80: SlotWindow | null;
}

export interface ActivityFocusResult {
  /** days in the range with any judged tracking: the denominator for every "% of days" */
  days: number;
  totalFocusedMinutes: number;
  /** every activity with focused time, most first */
  rows: ActivityFocusRow[];
  /** ids shown as their own series (top N); the rest are folded into OTHER_ID */
  chartIds: string[];
  /** per slot: share of observed time in a focused run of each series, 0-100 (stacked, never above 100) */
  bySlot: ({ slot: number; startMin: number } & Record<string, number>)[];
  /** focused minutes per day (or per-day average for each week when weekly), per series */
  series: ({ label: string; dateKey: string } & Record<string, number>)[];
  colors: Record<string, string>;
  names: Record<string, string>;
}

const FALLBACK_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ef4444', '#14b8a6', '#ec4899', '#64748b'];

export const activityFocus = (
  input: ActivityFocusInput,
  dateKeys: string[],
  opts: { topN?: number; now?: Date; weekly?: boolean } = {}
): ActivityFocusResult => {
  const now = opts.now ?? new Date();
  const topN = opts.topN ?? 6;
  const info = new Map(input.activities.map((a) => [a.id, a]));
  const days = judgedDays(input, dateKeys, now);
  const observed = days.filter((d) => d.day.some((a) => a !== null));
  const nDays = observed.length;

  const focusedDays: (string | null)[][] = [];
  const perDay = new Map<string, Map<string, number>>(); // dateKey -> activity -> focused minutes
  const acc = new Map<string, { total: number; focused: number; days: Set<string>; runLens: number[]; starts: number[]; longest: number }>();
  const get = (id: string) => acc.get(id) ?? acc.set(id, { total: 0, focused: 0, days: new Set(), runLens: [], starts: [], longest: 0 }).get(id)!;

  for (const { dateKey, day } of observed) {
    const focused: (string | null)[] = new Array(144).fill(null);
    for (const a of day) if (a) get(a).total += 10;
    for (const r of findRuns(day)) {
      if (r.blocks < MIN_RUN_BLOCKS) continue;
      const s = get(r.activityId);
      s.runLens.push(r.blocks * 10);
      s.starts.push(r.startIdx * 10);
      s.longest = Math.max(s.longest, r.blocks * 10);
      s.days.add(dateKey);
      for (let i = r.startIdx; i <= r.endIdx; i++) if (day[i] === r.activityId) focused[i] = r.activityId;
      s.focused += r.blocks * 10;
      const m = perDay.get(dateKey) ?? perDay.set(dateKey, new Map()).get(dateKey)!;
      m.set(r.activityId, (m.get(r.activityId) ?? 0) + r.blocks * 10);
    }
    focusedDays.push(focused);
  }

  const bySlotMinutes = slotMinutes(focusedDays);
  const nameOf = (id: string) => (id === TIMER_ID ? 'Focus timer' : info.get(id)?.name ?? 'Unknown activity');
  const rows: ActivityFocusRow[] = [];
  let colorIdx = 0;
  const colors: Record<string, string> = {};
  const names: Record<string, string> = {};
  for (const [id, s] of acc) {
    if (s.focused === 0) continue;
    const slots = bySlotMinutes.get(id) ?? new Array(SLOT_COUNT).fill(0);
    const color = info.get(id)?.color || FALLBACK_COLORS[colorIdx++ % FALLBACK_COLORS.length];
    rows.push({
      id,
      name: nameOf(id),
      color,
      focusedMinutes: s.focused,
      totalMinutes: s.total,
      focusRatePct: s.total > 0 ? Math.round((s.focused / s.total) * 100) : 0,
      focusedDays: s.days.size,
      runs: s.runLens.length,
      medianRunMinutes: median(s.runLens),
      longestRunMinutes: s.longest,
      medianStartMin: median(s.starts),
      perDayMinutes: nDays > 0 ? s.focused / nDays : 0,
      slots,
      core: coreWindow(slots, 0.5),
      span80: coreWindow(slots, 0.8),
    });
  }
  rows.sort((a, b) => b.focusedMinutes - a.focusedMinutes);
  for (const r of rows) { colors[r.id] = r.color; names[r.id] = r.name; }

  const chartIds = rows.slice(0, topN).map((r) => r.id);
  const inChart = new Set(chartIds);
  const hasOther = rows.length > topN;
  if (hasOther) { chartIds.push(OTHER_ID); colors[OTHER_ID] = '#94a3b8'; names[OTHER_ID] = 'Other'; }
  const keyOf = (id: string) => (inChart.has(id) ? id : OTHER_ID);

  const denom = nDays * SLOT_MINUTES;
  const bySlot = Array.from({ length: SLOT_COUNT }, (_, slot) => {
    const pt: { slot: number; startMin: number } & Record<string, number> = { slot, startMin: slot * SLOT_MINUTES } as { slot: number; startMin: number } & Record<string, number>;
    for (const id of chartIds) pt[id] = 0;
    for (const r of rows) pt[keyOf(r.id)] += denom > 0 ? (r.slots[slot] / denom) * 100 : 0;
    for (const id of chartIds) pt[id] = Math.round(pt[id] * 10) / 10;
    return pt;
  });

  // Day-by-day (or weekly average) focused minutes per series
  const series: ActivityFocusResult['series'] = [];
  const pointFor = (keys: string[], label: string, dateKey: string) => {
    const pt = { label, dateKey } as { label: string; dateKey: string } & Record<string, number>;
    for (const id of chartIds) pt[id] = 0;
    for (const k of keys) for (const [id, m] of perDay.get(k) ?? []) pt[keyOf(id)] += m;
    if (keys.length > 1) for (const id of chartIds) pt[id] = Math.round(pt[id] / keys.length);
    return pt;
  };
  const elapsedKeys = dateKeys.filter((k) => elapsedBlocksFor(k, now) > 0);
  if (!opts.weekly) {
    for (const k of elapsedKeys) series.push(pointFor([k], format(parseISO(k), 'd MMM'), k));
  } else {
    const weeks = new Map<string, string[]>();
    for (const k of elapsedKeys) {
      const wk = format(startOfWeek(parseISO(k), { weekStartsOn: 1 }), 'yyyy-MM-dd');
      (weeks.get(wk) ?? weeks.set(wk, []).get(wk)!).push(k);
    }
    for (const [wk, keys] of weeks) series.push(pointFor(keys, format(parseISO(wk), 'd MMM'), wk));
  }

  return {
    days: nDays,
    totalFocusedMinutes: rows.reduce((s, r) => s + r.focusedMinutes, 0),
    rows,
    chartIds,
    bySlot,
    series,
    colors,
    names,
  };
};

/** The slot where a row is most often in focus, as "% of days" (for captions). */
export const peakSlotShare = (row: ActivityFocusRow, days: number): { startMin: number; pct: number } | null => {
  if (days === 0) return null;
  let best = -1, idx = -1;
  row.slots.forEach((m, i) => { if (m > best) { best = m; idx = i; } });
  return best > 0 ? { startMin: idx * SLOT_MINUTES, pct: Math.round((best / (days * SLOT_MINUTES)) * 100) } : null;
};
