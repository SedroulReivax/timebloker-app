import { format, getDay, parseISO, startOfWeek } from 'date-fns';
import type { RangeBlock } from './blockRange';
import { elapsedBlocksFor } from './analysis';
import { median, wilson } from './stats';
import { coreWindow, slotMinutes, SLOT_COUNT, SLOT_MINUTES, type SlotWindow } from './timeOfDay';

/**
 * Time waste: time on an activity whose productivity multiplier is below 0, unless that activity is ignored.
 * Descriptive, like activity focus: counts of what was logged, no model. Days with no judged (awake, non-ignored)
 * tracking are left out, because nothing logged is not the same as no waste.
 *
 * A waste STRETCH is consecutive waste blocks, even across different waste activities. A single untracked 10-minute
 * block inside it does not end it (other activities do).
 *
 * Two kinds of output, two sources:
 *  - deterministic totals (minutes and cost per activity per day, the daily series, weekday averages) are the
 *    backend's analytics_activity_daily.waste_minutes / waste_points whenever the caller passes `totals`;
 *  - everything that needs the block sequence (stretches, what led into them, return time, time-of-day placement)
 *    always comes from the raw blocks, which the caller bounds to the window.
 * Without `totals` (a live single-day view, the export pack) the totals are counted from the same blocks.
 */

export const CONTEXT_WAKE = '__wake__';
export const CONTEXT_GAP = '__gap__';
export const CONTEXT_START = '__start__';
const CONTEXT_LABEL: Record<string, string> = {
  [CONTEXT_WAKE]: 'First thing after waking',
  [CONTEXT_GAP]: 'After an untracked gap',
  [CONTEXT_START]: 'Start of the tracked day',
};
/**
 * How close the previous activity must end for it to count as what led into waste: at most 2 untracked blocks
 * (20 min) in between. The same rule decides whether a run "was followed by waste" for trigger rates.
 */
const LEAD_GAP_BLOCKS = 2;
/** Untracked time allowed between waking and waste for it to still count as "first thing after waking" (60 min). */
const WAKE_GAP_BLOCKS = 6;

export interface WasteActivityInfo {
  id: string;
  name: string;
  color?: string | null;
  productivity_multiplier?: number | null;
  analysis_ignored?: boolean | null;
}

export interface WasteInput {
  blocks: RangeBlock[];
  activities: WasteActivityInfo[];
  sleepIds: Set<string>;
}

/** Canonical waste totals for the window: analytics_daily (which days had judged time) and analytics_activity_daily. */
export interface WasteTotals {
  daily: { date_key: string; judged_minutes: number }[];
  activityDaily: { date_key: string; activity_id: string; waste_minutes: number; waste_points: number }[];
}

export interface WasteStretch {
  dateKey: string;
  startIdx: number;
  endIdx: number;
  minutes: number;
  activityIds: string[];
  /** activity id, or one of the CONTEXT_* ids */
  ledBy: string;
  /** minutes from the end of the stretch to the next block with a positive multiplier that day; null = no return */
  returnMinutes: number | null;
}

export interface WasteActivityRow {
  id: string;
  name: string;
  color: string;
  multiplier: number;
  minutes: number;
  /** minutes x |multiplier| */
  cost: number;
  days: number;
  /** contiguous stretches of this activity */
  stretches: number;
  medianStretchMinutes: number | null;
  longestStretchMinutes: number;
  slots: number[];
  core: SlotWindow | null;
}

export interface TriggerRow {
  id: string;
  name: string;
  color: string | null;
  /** waste stretches this led into */
  count: number;
  /** runs of this activity in the range (null for contexts like "after waking") */
  runs: number | null;
  /** share of its runs followed by waste within 20 minutes, with an 80% Wilson interval */
  ratePct: number | null;
  lo: number | null;
  hi: number | null;
  medianStretchMinutes: number | null;
}

export interface WasteAnalysis {
  hasWasteActivities: boolean;
  /** days with judged tracking */
  days: number;
  totalMinutes: number;
  rows: WasteActivityRow[];
  /** per slot: % of observed time in waste, per activity (stacked) */
  bySlot: ({ slot: number; startMin: number } & Record<string, number>)[];
  /** mean waste minutes per weekday (Sun..Sat) over that weekday's observed days */
  byWeekday: { weekday: number; minutes: number | null; days: number }[];
  /** waste minutes per day (or per-day average for each week), per activity */
  series: ({ label: string; dateKey: string } & Record<string, number>)[];
  stretches: WasteStretch[];
  triggers: TriggerRow[];
  /** stretch starts per clock hour */
  startHours: { hour: number; count: number }[];
  medianReturnMinutes: number | null;
  noReturnPct: number | null;
  longest: WasteStretch[];
  colors: Record<string, string>;
  names: Record<string, string>;
}

const FALLBACK = ['#ef4444', '#f97316', '#eab308', '#ec4899', '#a855f7', '#64748b'];

export const analyzeWaste = (input: WasteInput, dateKeys: string[], opts: { now?: Date; weekly?: boolean; totals?: WasteTotals } = {}): WasteAnalysis => {
  const now = opts.now ?? new Date();
  const info = new Map(input.activities.map((a) => [a.id, a]));
  const ignored = new Set(input.sleepIds);
  for (const a of input.activities) if (a.analysis_ignored) ignored.add(a.id);
  const mult = (id: string | null) => (id && !ignored.has(id) ? info.get(id)?.productivity_multiplier ?? 0 : 0);
  const isWaste = (id: string | null) => !!id && !ignored.has(id) && mult(id) < 0;
  const hasWasteActivities = input.activities.some((a) => isWaste(a.id));

  const raw = new Map<string, (string | null)[]>();
  for (const b of input.blocks) {
    if (!b.activity_id) continue;
    (raw.get(b.date_key) ?? raw.set(b.date_key, new Array(144).fill(null)).get(b.date_key)!)[b.block_index] = b.activity_id;
  }

  const colors: Record<string, string> = {};
  const names: Record<string, string> = {};
  let ci = 0;
  const colorOf = (id: string) => colors[id] ?? (colors[id] = info.get(id)?.color || FALLBACK[ci++ % FALLBACK.length]);
  const nameOf = (id: string) => names[id] ?? (names[id] = CONTEXT_LABEL[id] ?? info.get(id)?.name ?? 'Unknown activity');

  const wasteDays: (string | null)[][] = [];
  const perDay = new Map<string, Map<string, number>>();
  const perDayTotal: { dateKey: string; minutes: number }[] = [];
  const acc = new Map<string, { minutes: number; cost: number; days: Set<string>; runs: number[] }>();
  const accOf = (id: string) => acc.get(id) ?? acc.set(id, { minutes: 0, cost: 0, days: new Set(), runs: [] }).get(id)!;
  const backend = opts.totals;
  const stretches: WasteStretch[] = [];
  const runsOf = new Map<string, number>();
  const triggeredRuns = new Map<string, number>();
  let observedDays = 0;

  for (const dateKey of dateKeys) {
    const elapsed = elapsedBlocksFor(dateKey, now);
    if (elapsed === 0) continue;
    const day = (raw.get(dateKey) ?? new Array(144).fill(null)).slice(0, elapsed);
    const judged = day.some((a) => a && !ignored.has(a));
    if (!judged) continue;
    observedDays++;

    const labels: (string | null)[] = new Array(144).fill(null);
    let total = 0;
    const dayMap = new Map<string, number>();
    for (let i = 0; i < day.length; i++) {
      const a = day[i];
      if (!isWaste(a)) continue;
      labels[i] = a;
      if (backend) continue; // totals come from analytics_activity_daily below
      total += 10;
      dayMap.set(a!, (dayMap.get(a!) ?? 0) + 10);
      const s = accOf(a!);
      s.minutes += 10;
      s.cost += 10 * Math.abs(mult(a));
      s.days.add(dateKey);
    }
    wasteDays.push(labels);
    if (!backend) {
      perDay.set(dateKey, dayMap);
      perDayTotal.push({ dateKey, minutes: total });
    }

    // Per-activity contiguous stretches
    for (let i = 0; i < day.length; i++) {
      const a = day[i];
      if (!isWaste(a) || day[i - 1] === a) continue;
      let j = i;
      while (j + 1 < day.length && day[j + 1] === a) j++;
      accOf(a!).runs.push((j - i + 1) * 10);
    }

    const wasteStartSet = new Set<number>();
    // Combined waste stretches (one untracked block tolerated)
    let i = 0;
    while (i < day.length) {
      if (!isWaste(day[i])) { i++; continue; }
      const start = i;
      let end = i;
      const ids = new Set<string>([day[i]!]);
      let j = i + 1;
      while (j < day.length) {
        if (isWaste(day[j])) { ids.add(day[j]!); end = j; j++; continue; }
        if (day[j] === null && j + 1 < day.length && isWaste(day[j + 1])) { j++; continue; }
        break;
      }
      // What led into it
      let k = start - 1;
      while (k >= 0 && day[k] === null) k--;
      // Waking gets a longer allowance (getting up is rarely logged), but not an unlimited one: waking at 7 and
      // starting waste at 11 after four untracked hours is "after an untracked gap", not "first thing after waking".
      const gap = start - 1 - k;
      let ledBy: string;
      if (k < 0) ledBy = CONTEXT_START;
      else if (input.sleepIds.has(day[k]!)) ledBy = gap > WAKE_GAP_BLOCKS ? CONTEXT_GAP : CONTEXT_WAKE;
      else if (gap > LEAD_GAP_BLOCKS) ledBy = CONTEXT_GAP;
      else ledBy = day[k]!;
      // Back to productive work?
      let r = end + 1;
      while (r < day.length && !(mult(day[r]) > 0)) r++;
      stretches.push({
        dateKey,
        startIdx: start,
        endIdx: end,
        minutes: (end - start + 1) * 10 - countNulls(day, start, end) * 10,
        activityIds: [...ids],
        ledBy,
        returnMinutes: r < day.length ? (r - end - 1) * 10 : null,
      });
      wasteStartSet.add(start);
      i = end + 1;
    }

    // Plain runs of every awake, non-waste activity (ignored ones like travel included: they can lead into waste)
    for (let s = 0; s < day.length; s++) {
      const a = day[s];
      if (!a || input.sleepIds.has(a) || isWaste(a) || day[s - 1] === a) continue;
      let e = s;
      while (e + 1 < day.length && day[e + 1] === a) e++;
      runsOf.set(a, (runsOf.get(a) ?? 0) + 1);
      // Followed by waste = a waste stretch starts within 20 min with only untracked time in between, the same
      // rule that names this run as what led into it (A -> B -> waste credits B, not A as well)
      for (let d = 1; d <= LEAD_GAP_BLOCKS + 1; d++) {
        if (wasteStartSet.has(e + d)) { triggeredRuns.set(a, (triggeredRuns.get(a) ?? 0) + 1); break; }
        if (e + d < day.length && day[e + d] !== null) break;
      }
      s = e;
    }
  }

  let judgedDays = observedDays;
  if (backend) {
    const inWindow = new Set(dateKeys.filter((k) => elapsedBlocksFor(k, now) > 0));
    for (const d of backend.daily) {
      if (inWindow.has(d.date_key) && Number(d.judged_minutes) > 0 && !perDay.has(d.date_key)) perDay.set(d.date_key, new Map());
    }
    for (const r of backend.activityDaily) {
      const minutes = Number(r.waste_minutes) || 0;
      if (minutes <= 0 || !perDay.has(r.date_key)) continue;
      const dayMap = perDay.get(r.date_key)!;
      dayMap.set(r.activity_id, (dayMap.get(r.activity_id) ?? 0) + minutes);
      const s = accOf(r.activity_id);
      s.minutes += minutes;
      s.cost += Number(r.waste_points) || 0;
      s.days.add(r.date_key);
    }
    for (const [dateKey, dayMap] of perDay) perDayTotal.push({ dateKey, minutes: [...dayMap.values()].reduce((a, b) => a + b, 0) });
    judgedDays = perDay.size;
  }

  const slotMap = slotMinutes(wasteDays);
  const rows: WasteActivityRow[] = [...acc.entries()].filter(([, s]) => s.minutes > 0).map(([id, s]) => {
    const m = mult(id);
    const slots = slotMap.get(id) ?? new Array(SLOT_COUNT).fill(0);
    return {
      id,
      name: nameOf(id),
      color: colorOf(id),
      multiplier: m,
      minutes: s.minutes,
      cost: Math.round(s.cost * 10) / 10,
      days: s.days.size,
      stretches: s.runs.length,
      medianStretchMinutes: median(s.runs),
      longestStretchMinutes: Math.max(0, ...s.runs),
      slots,
      core: coreWindow(slots, 0.5),
    };
  }).sort((a, b) => b.minutes - a.minutes);

  const ids = rows.map((r) => r.id);
  const denom = observedDays * SLOT_MINUTES;
  const bySlot = Array.from({ length: SLOT_COUNT }, (_, slot) => {
    const pt = { slot, startMin: slot * SLOT_MINUTES } as { slot: number; startMin: number } & Record<string, number>;
    for (const r of rows) pt[r.id] = denom > 0 ? Math.round((r.slots[slot] / denom) * 1000) / 10 : 0;
    return pt;
  });

  const byWeekday = Array.from({ length: 7 }, (_, weekday) => {
    const vals = perDayTotal.filter((d) => getDay(parseISO(d.dateKey)) === weekday).map((d) => d.minutes);
    return { weekday, minutes: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null, days: vals.length };
  });

  const series: WasteAnalysis['series'] = [];
  const point = (keys: string[], label: string, dateKey: string) => {
    const pt = { label, dateKey } as { label: string; dateKey: string } & Record<string, number>;
    for (const id of ids) pt[id] = 0;
    const observed = keys.filter((k) => perDay.has(k));
    for (const k of observed) for (const [id, m] of perDay.get(k)!) pt[id] += m;
    if (observed.length > 1) for (const id of ids) pt[id] = Math.round(pt[id] / observed.length);
    return pt;
  };
  const elapsedKeys = dateKeys.filter((k) => elapsedBlocksFor(k, now) > 0);
  if (!opts.weekly) {
    for (const k of elapsedKeys) series.push(point([k], format(parseISO(k), 'd MMM'), k));
  } else {
    const weeks = new Map<string, string[]>();
    for (const k of elapsedKeys) {
      const wk = format(startOfWeek(parseISO(k), { weekStartsOn: 1 }), 'yyyy-MM-dd');
      (weeks.get(wk) ?? weeks.set(wk, []).get(wk)!).push(k);
    }
    for (const [wk, keys] of weeks) series.push(point(keys, format(parseISO(wk), 'd MMM'), wk));
  }

  // What leads to waste
  const byLead = new Map<string, number[]>();
  for (const s of stretches) (byLead.get(s.ledBy) ?? byLead.set(s.ledBy, []).get(s.ledBy)!).push(s.minutes);
  const triggers: TriggerRow[] = [...byLead.entries()].map(([id, mins]) => {
    const isContext = id in CONTEXT_LABEL;
    const runs = isContext ? null : runsOf.get(id) ?? 0;
    const w = runs ? wilson(Math.min(runs, triggeredRuns.get(id) ?? 0), runs) : null;
    return {
      id,
      name: nameOf(id),
      color: isContext ? null : colorOf(id),
      count: mins.length,
      runs,
      ratePct: w && w.p !== null ? Math.round(w.p * 100) : null,
      lo: w && w.lo !== null ? Math.round(w.lo * 100) : null,
      hi: w && w.hi !== null ? Math.round(w.hi * 100) : null,
      medianStretchMinutes: median(mins),
    };
  }).sort((a, b) => b.count - a.count);

  const startHours = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
  for (const s of stretches) startHours[Math.floor(s.startIdx / 6)].count++;
  const returns = stretches.filter((s) => s.returnMinutes !== null).map((s) => s.returnMinutes as number);

  return {
    hasWasteActivities,
    days: judgedDays,
    totalMinutes: rows.reduce((s, r) => s + r.minutes, 0),
    rows,
    bySlot,
    byWeekday,
    series,
    stretches,
    triggers,
    startHours,
    medianReturnMinutes: median(returns),
    noReturnPct: stretches.length ? Math.round(((stretches.length - returns.length) / stretches.length) * 100) : null,
    longest: [...stretches].sort((a, b) => b.minutes - a.minutes || b.dateKey.localeCompare(a.dateKey)).slice(0, 5),
    colors,
    names,
  };
};

const countNulls = (day: (string | null)[], a: number, b: number): number => {
  let n = 0;
  for (let i = a; i <= b; i++) if (day[i] === null) n++;
  return n;
};
