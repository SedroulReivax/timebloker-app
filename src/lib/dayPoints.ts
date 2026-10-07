import { elapsedBlocksFor, type AnalysisInput } from './analysis';
import { median } from './stats';
import { SLOT_COUNT } from './timeOfDay';

/**
 * One day's productivity points, half hour by half hour: what each half hour earned or lost, which activities did it,
 * and the running total through the day. Same rules as profileDays / analytics_daily.productivity_points, so the
 * last running total is the day's points everywhere else: only elapsed, assigned blocks count; sleep and ignored
 * activities are left out; points per 10-minute block = 10 × the activity's multiplier (0 when none is set).
 */

export interface SlotActivity {
  id: string;
  minutes: number;
  points: number;
}

export interface PointsSlot {
  /** half hour of the day, 0-47 */
  slot: number;
  /** net points earned in this half hour */
  points: number;
  /** the positive and negative parts of `points` (a half hour can hold both) */
  gained: number;
  lost: number;
  /** counted minutes in this half hour */
  minutes: number;
  /** running total up to and including this half hour; null after the elapsed part of the day */
  cumulative: number | null;
  /** activities counted in this half hour, biggest effect on points first */
  activities: SlotActivity[];
}

export interface ActivityPoints {
  id: string;
  minutes: number;
  multiplier: number;
  points: number;
}

export interface DayPoints {
  slots: PointsSlot[];
  total: number;
  gained: number;
  lost: number;
  countedMinutes: number;
  /** the half hours that earned the most and lost the most (only ones with counted time; worst only if below best) */
  best: PointsSlot | null;
  worst: PointsSlot | null;
  /** every counted activity of the day, biggest effect on points first */
  byActivity: ActivityPoints[];
}

const round1 = (v: number) => {
  const r = Math.round(v * 10) / 10;
  return r === 0 ? 0 : r; // no "-0"
};
const byImpact = (a: { points: number; minutes: number }, b: { points: number; minutes: number }) =>
  Math.abs(b.points) - Math.abs(a.points) || b.minutes - a.minutes;

type Input = Pick<AnalysisInput, 'blocks' | 'activities' | 'sleepIds'>;
interface Options { now?: Date; cutoffBlocks?: number }

const setup = (input: Input) => {
  const mult = new Map(input.activities.map((a) => [a.id, a.productivity_multiplier ?? 0]));
  const skip = new Set(input.sleepIds);
  for (const a of input.activities) if (a.analysis_ignored) skip.add(a.id);
  return { mult, skip };
};

const limitFor = (dateKey: string, opts: Options) =>
  Math.min(elapsedBlocksFor(dateKey, opts.now ?? new Date()), opts.cutoffBlocks ?? 144);

export const dayPoints = (input: Input, dateKey: string, opts: Options = {}): DayPoints => {
  const { mult, skip } = setup(input);
  const limit = limitFor(dateKey, opts);
  // per slot: activity id -> blocks
  const perSlot = Array.from({ length: SLOT_COUNT }, () => new Map<string, number>());
  for (const b of input.blocks) {
    if (b.date_key !== dateKey || b.block_index >= limit || !b.activity_id || skip.has(b.activity_id)) continue;
    const m = perSlot[Math.floor(b.block_index / 3)];
    m.set(b.activity_id, (m.get(b.activity_id) ?? 0) + 1);
  }

  const lastSlot = Math.ceil(limit / 3) - 1; // the half hour holding the last elapsed block
  const totals = new Map<string, ActivityPoints>();
  let running = 0, gainedAll = 0, lostAll = 0, minutesAll = 0;
  const slots: PointsSlot[] = perSlot.map((counts, slot) => {
    let gained = 0, lost = 0, minutes = 0;
    const activities: SlotActivity[] = [];
    for (const [id, n] of counts) {
      const m = mult.get(id) ?? 0;
      const pts = n * 10 * m;
      if (pts > 0) gained += pts; else lost += pts;
      minutes += n * 10;
      activities.push({ id, minutes: n * 10, points: round1(pts) });
      const t = totals.get(id) ?? totals.set(id, { id, minutes: 0, multiplier: m, points: 0 }).get(id)!;
      t.minutes += n * 10;
      t.points += pts;
    }
    activities.sort(byImpact);
    running += gained + lost;
    gainedAll += gained; lostAll += lost; minutesAll += minutes;
    return {
      slot,
      points: round1(gained + lost),
      gained: round1(gained),
      lost: round1(lost),
      minutes,
      cumulative: slot <= lastSlot ? round1(running) : null,
      activities,
    };
  });

  let best: PointsSlot | null = null, worst: PointsSlot | null = null;
  for (const s of slots) {
    if (!s.minutes) continue;
    if (!best || s.points > best.points) best = s;
    if (!worst || s.points < worst.points) worst = s;
  }
  if (worst && best && worst.points >= best.points) worst = null;

  return {
    slots,
    total: round1(gainedAll + lostAll),
    gained: round1(gainedAll),
    lost: round1(lostAll),
    countedMinutes: minutesAll,
    best,
    worst,
    byActivity: [...totals.values()].map((t) => ({ ...t, points: round1(t.points) })).sort(byImpact),
  };
};

/**
 * Your typical running total at each half hour: the median, over the given days that have any counted time, of the
 * points earned by the end of that half hour. For today, pass `cutoffBlocks` so past days stop at the same time.
 * Null where no day reaches (after the cutoff) or with no counted days.
 */
export const typicalCumulativePoints = (input: Input, dateKeys: string[], opts: Options = {}): (number | null)[] => {
  const { mult, skip } = setup(input);
  const keys = new Set(dateKeys);
  const perDay = new Map<string, number[]>();
  // each day's cut-off is the same for every one of its blocks, so work it out once per day
  const now = opts.now ?? new Date();
  const limits = new Map<string, number>();
  const limitOf = (k: string) => limits.get(k) ?? limits.set(k, limitFor(k, { ...opts, now })).get(k)!;
  for (const b of input.blocks) {
    if (!keys.has(b.date_key) || b.block_index >= limitOf(b.date_key) || !b.activity_id || skip.has(b.activity_id)) continue;
    const arr = perDay.get(b.date_key) ?? perDay.set(b.date_key, new Array(SLOT_COUNT).fill(0)).get(b.date_key)!;
    arr[Math.floor(b.block_index / 3)] += 10 * (mult.get(b.activity_id) ?? 0);
  }
  if (perDay.size === 0) return new Array(SLOT_COUNT).fill(null);
  const lastSlot = opts.cutoffBlocks !== undefined ? Math.ceil(Math.min(opts.cutoffBlocks, 144) / 3) - 1 : SLOT_COUNT - 1;
  const running = [...perDay.values()].map((arr) => {
    let r = 0;
    return arr.map((v) => (r += v));
  });
  return Array.from({ length: SLOT_COUNT }, (_, s) => (s > lastSlot ? null : round1(median(running.map((r) => r[s]))!)));
};
