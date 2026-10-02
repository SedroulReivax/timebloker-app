// ─── Attention (Phase F consumer) ─────────────────────────────────────────────
// Two separate dimensions, never merged into one score:
//   productivity value  analytics_daily.productivity_points = judged minutes x the activity's multiplier
//   attention spent     analytics_daily.attention_points    = judged minutes x the activity's focus_demand / 5
//                        (demand 0-5 used as a 0-1 weight: an hour at full demand = 60 points, the same unit
//                        as productivity points; analytics_version 2)
// and the one relationship between them the backend stores:
//   attention efficiency analytics_daily.attention_efficiency = productivity_points / attention_points,
//                        null below a 6-point floor so a near-zero denominator never gives a runaway ratio.
//
// Everything here reads those canonical values; nothing is recomputed from blocks. The only thing the daily
// row cannot say is what the attention bought, so the per-day split (valuable / neutral / costly, by the sign
// of each activity's own multiplier, the same rule the Waste tab uses) and the biggest consumers come from
// analytics_activity_daily.focus_demand_points, which sums to the same daily total.

import { compareSamples, quantile, type ChangeResult } from './stats';

/** Mirrors the floor in recompute_daily_analytics (about 10 minutes at demand 3): below it a ratio means nothing. */
export const ATTENTION_EFFICIENCY_FLOOR = 6;

export type AttentionClass = 'valuable' | 'neutral' | 'costly';

/** The subset of an analytics_daily row attention reads. */
export interface AttentionDailyRow {
  date_key: string;
  elapsed_minutes: number;
  judged_minutes: number;
  productivity_points: number;
  attention_points: number;
  attention_efficiency: number | null;
}

/** The subset of an analytics_activity_daily row attention reads. */
export interface AttentionActivityRow {
  date_key: string;
  activity_id: string;
  judged_minutes: number;
  productivity_points: number;
  focus_demand_points: number;
}

export interface AttentionDay {
  dateKey: string;
  /** analytics_daily.attention_points */
  total: number;
  /** analytics_daily.productivity_points */
  value: number;
  /** analytics_daily.attention_efficiency (null below the floor) */
  efficiency: number | null;
  complete: boolean;
  valuable: number;
  neutral: number;
  costly: number;
}

export interface AttentionConsumer {
  activityId: string;
  points: number;
  minutes: number;
  cls: AttentionClass;
  sharePct: number;
}

export interface AttentionPeriod {
  /** false when no attention was recorded in the window: every number would be a fake 0 */
  configured: boolean;
  /** days in the window that have judged time, in date order */
  days: AttentionDay[];
  /** attention points spent in the window */
  total: number;
  /** productivity points earned in the window (can be negative) */
  value: number;
  /** value / attention over the window; null below the floor */
  efficiency: number | null;
  /** median of the per-day canonical efficiencies (days above the floor only) */
  typicalEfficiency: number | null;
  /** finished-day samples, for period-vs-period comparisons */
  perDay: { attention: number[]; efficiency: number[] };
}

export interface AttentionBudget extends AttentionPeriod {
  split: Record<AttentionClass, number>;
  /** share of attention that went to costly (negative-multiplier) activities */
  costlySharePct: number | null;
  /** per-day median and 90th percentile of total attention, over days with judged time */
  median: number | null;
  p90: number | null;
  /** the latest day in the window vs the other days (null when fewer than 5 other days) */
  latest: { dateKey: string; total: number; vsMedianPct: number | null } | null;
  consumers: AttentionConsumer[];
}

const num = (v: unknown) => Number(v) || 0;

const classOf = (judgedMinutes: number, productivityPoints: number): AttentionClass => {
  if (judgedMinutes <= 0 || productivityPoints === 0) return 'neutral';
  return productivityPoints > 0 ? 'valuable' : 'costly';
};

export const attentionPeriod = (dailyRows: AttentionDailyRow[], dateKeys: string[]): AttentionPeriod => {
  const inWindow = new Set(dateKeys);
  const days: AttentionDay[] = dailyRows
    .filter((r) => inWindow.has(r.date_key) && num(r.judged_minutes) > 0)
    .map((r) => ({
      dateKey: r.date_key,
      total: num(r.attention_points),
      value: num(r.productivity_points),
      efficiency: r.attention_efficiency === null || r.attention_efficiency === undefined ? null : Number(r.attention_efficiency),
      complete: num(r.elapsed_minutes) >= 1440,
      valuable: 0,
      neutral: 0,
      costly: 0,
    }))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));

  const total = days.reduce((s, d) => s + d.total, 0);
  const value = days.reduce((s, d) => s + d.value, 0);
  const configured = total > 0;
  const efficiencies = days.map((d) => d.efficiency).filter((e): e is number => e !== null);
  const finished = days.filter((d) => d.complete);

  return {
    configured,
    days,
    total,
    value,
    efficiency: total >= ATTENTION_EFFICIENCY_FLOOR ? value / total : null,
    typicalEfficiency: configured ? quantile(efficiencies, 0.5) : null,
    perDay: {
      attention: configured ? finished.map((d) => d.total) : [],
      efficiency: finished.map((d) => d.efficiency).filter((e): e is number => e !== null),
    },
  };
};

export const attentionBudget = (dailyRows: AttentionDailyRow[], activityRows: AttentionActivityRow[], dateKeys: string[]): AttentionBudget => {
  const period = attentionPeriod(dailyRows, dateKeys);
  const byDay = new Map(period.days.map((d) => [d.dateKey, d]));
  const byActivity = new Map<string, { points: number; minutes: number; value: number }>();
  const split: Record<AttentionClass, number> = { valuable: 0, neutral: 0, costly: 0 };

  for (const r of activityRows) {
    const day = byDay.get(r.date_key);
    if (!day || num(r.judged_minutes) <= 0) continue;
    const pts = num(r.focus_demand_points);
    const cls = classOf(num(r.judged_minutes), num(r.productivity_points));
    day[cls] += pts;
    split[cls] += pts;
    const a = byActivity.get(r.activity_id) ?? { points: 0, minutes: 0, value: 0 };
    a.points += pts;
    a.minutes += num(r.judged_minutes);
    a.value += num(r.productivity_points);
    byActivity.set(r.activity_id, a);
  }

  const { configured, total, days } = period;
  const totals = days.map((d) => d.total);

  let latest: AttentionBudget['latest'] = null;
  if (configured && days.length) {
    const last = days[days.length - 1];
    const others = days.slice(0, -1).map((d) => d.total);
    const med = others.length >= 5 ? quantile(others, 0.5) : null;
    latest = { dateKey: last.dateKey, total: last.total, vsMedianPct: med ? Math.round(((last.total - med) / med) * 100) : null };
  }

  const consumers = [...byActivity.entries()]
    .filter(([, a]) => a.points > 0)
    .map(([activityId, a]) => ({
      activityId,
      points: a.points,
      minutes: a.minutes,
      cls: classOf(a.minutes, a.value),
      sharePct: total ? Math.round((a.points / total) * 100) : 0,
    }))
    .sort((a, b) => b.points - a.points);

  return {
    ...period,
    split,
    costlySharePct: configured ? Math.round((split.costly / total) * 100) : null,
    median: configured ? quantile(totals, 0.5) : null,
    p90: configured && totals.length >= 10 ? quantile(totals, 0.9) : null,
    latest,
    consumers,
  };
};

/** Attention per finished day and daily efficiency, this period vs the previous one. */
export const compareAttention = (cur: AttentionPeriod, prev: AttentionPeriod): { attention: ChangeResult; efficiency: ChangeResult } => ({
  attention: compareSamples(cur.perDay.attention, prev.perDay.attention),
  efficiency: compareSamples(cur.perDay.efficiency, prev.perDay.efficiency),
});

export const formatAttention = (v: number) => `${Math.round(v)} pts`;
export const formatEfficiency = (v: number) => v.toFixed(2);
