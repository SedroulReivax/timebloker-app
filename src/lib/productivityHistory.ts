import { format, parseISO, startOfWeek } from 'date-fns';
import { compareSamples, type ChangeResult } from './stats';

/**
 * Productivity points history: the points earned each day of a range (minutes × the activity's multiplier, summed by
 * the backend into analytics_daily.productivity_points), plus a running total. Reads only the analytics_daily rows a
 * screen already fetched, so it adds no query and no block scan; the work here is one pass over at most ~730 rows.
 */

/** The analytics_daily fields this needs; any row type that has them fits. */
export interface PointsDailyRow {
  date_key: string;
  productivity_points: number | string | null;
  judged_minutes: number | string | null;
  elapsed_minutes: number | string | null;
}

export interface PointsBar {
  /** the day, or the Monday that starts the week for weekly bars */
  dateKey: string;
  label: string;
  /** points earned that day (or summed over the week) */
  points: number;
  /** running total from the first day of the range up to and including this bar */
  cumulative: number;
  /** days in this bar that had any judged (counted) time */
  trackedDays: number;
}

export interface PointsHistory {
  bars: PointsBar[];
  total: number;
  /** total ÷ days with judged time; null when none */
  perTrackedDay: number | null;
  trackedDays: number;
  best: { dateKey: string; points: number } | null;
  worst: { dateKey: string; points: number } | null;
  /** daily points vs the previous period; null when the screen has no previous period */
  change: ChangeResult | null;
}

const num = (v: number | string | null | undefined): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round1 = (v: number) => Math.round(v * 10) / 10;

/** Points of every complete day (a full 24h elapsed) with judged time, for comparing periods without a partial today. */
const completeDayPoints = (byDate: Map<string, PointsDailyRow>, dateKeys: string[]): number[] => {
  const out: number[] = [];
  for (const k of dateKeys) {
    const r = byDate.get(k);
    if (r && num(r.elapsed_minutes) >= 1440 && num(r.judged_minutes) > 0) out.push(num(r.productivity_points));
  }
  return out;
};

/**
 * `rows` may cover more than `dateKeys` (screens fetch the previous period in the same call); only `dateKeys` are
 * charted. Days without a row show as 0 so the timeline and running total stay continuous; they are not counted as
 * tracked days. `weekly` sums each ISO week into one bar (for 6m/1y, so the chart stays legible).
 */
export const productivityPointsHistory = (
  rows: readonly PointsDailyRow[],
  dateKeys: readonly string[],
  opts: { weekly?: boolean; prevDateKeys?: readonly string[] | null } = {},
): PointsHistory => {
  const byDate = new Map<string, PointsDailyRow>();
  for (const r of rows) byDate.set(r.date_key, r);

  const bars: PointsBar[] = [];
  let running = 0, total = 0, trackedDays = 0;
  let best: PointsHistory['best'] = null, worst: PointsHistory['worst'] = null;
  let weekKey = '';

  for (const k of dateKeys) {
    const r = byDate.get(k);
    const pts = r ? num(r.productivity_points) : 0;
    const tracked = !!r && num(r.judged_minutes) > 0;
    running += pts;
    total += pts;
    if (tracked) {
      trackedDays++;
      if (!best || pts > best.points) best = { dateKey: k, points: pts };
      if (!worst || pts < worst.points) worst = { dateKey: k, points: pts };
    }

    if (opts.weekly) {
      const wk = format(startOfWeek(parseISO(k), { weekStartsOn: 1 }), 'yyyy-MM-dd');
      if (wk !== weekKey) {
        weekKey = wk;
        bars.push({ dateKey: wk, label: format(parseISO(wk), 'd MMM'), points: 0, cumulative: 0, trackedDays: 0 });
      }
      const bar = bars[bars.length - 1];
      bar.points += pts;
      bar.cumulative = running;
      if (tracked) bar.trackedDays++;
    } else {
      bars.push({ dateKey: k, label: format(parseISO(k), 'd MMM'), points: pts, cumulative: running, trackedDays: tracked ? 1 : 0 });
    }
  }
  for (const b of bars) { b.points = round1(b.points); b.cumulative = round1(b.cumulative); }

  const change = opts.prevDateKeys?.length
    ? compareSamples(completeDayPoints(byDate, dateKeys as string[]), completeDayPoints(byDate, opts.prevDateKeys as string[]))
    : null;

  return {
    bars,
    total: round1(total),
    perTrackedDay: trackedDays > 0 ? round1(total / trackedDays) : null,
    trackedDays,
    best,
    worst,
    change,
  };
};
