import { describe, expect, it } from 'vitest';
import { attentionBudget, attentionPeriod, type AttentionActivityRow, type AttentionDailyRow } from './attention';

const row = (date_key: string, activity_id: string, judged_minutes: number, multiplier: number, demand: number): AttentionActivityRow => ({
  date_key, activity_id, judged_minutes, productivity_points: judged_minutes * multiplier, focus_demand_points: judged_minutes * demand,
});

/** analytics_daily as recompute_daily_analytics would write it for these activity rows */
const daily = (rows: AttentionActivityRow[]): AttentionDailyRow[] => {
  const by = new Map<string, AttentionDailyRow>();
  for (const r of rows) {
    const d = by.get(r.date_key) ?? { date_key: r.date_key, elapsed_minutes: 1440, judged_minutes: 0, productivity_points: 0, attention_points: 0, attention_efficiency: null };
    d.judged_minutes += r.judged_minutes;
    d.productivity_points += r.productivity_points;
    d.attention_points += r.focus_demand_points;
    by.set(r.date_key, d);
  }
  for (const d of by.values()) d.attention_efficiency = d.attention_points >= 6 ? d.productivity_points / d.attention_points : null;
  return [...by.values()];
};

describe('attentionBudget', () => {
  const keys = Array.from({ length: 7 }, (_, i) => `2026-09-${String(20 + i).padStart(2, '0')}`);

  it('splits attention by the sign of each activity multiplier and compares the latest day', () => {
    const rows = keys.flatMap((k, i) => [
      row(k, 'code', 60, 0.8, 4),        // valuable, 240 pts/day
      row(k, 'social', 30, 0, 4),        // neutral, 120 pts/day
      row(k, 'scroll', i === 6 ? 90 : 30, -1, 2), // costly, 60 pts/day, 180 on the last day
    ]);
    const b = attentionBudget(daily(rows), rows, keys);
    expect(b.configured).toBe(true);
    expect(b.days).toHaveLength(7);
    expect(b.split).toEqual({ valuable: 1680, neutral: 840, costly: 540 });
    expect(b.total).toBe(3060);
    expect(b.costlySharePct).toBe(Math.round((540 / 3060) * 100));
    expect(b.median).toBe(420);
    expect(b.latest).toEqual({ dateKey: keys[6], total: 540, vsMedianPct: 29 });
    expect(b.consumers.map((c) => [c.activityId, c.cls])).toEqual([['code', 'valuable'], ['social', 'neutral'], ['scroll', 'costly']]);
    // value and attention stay separate; efficiency is their ratio over the period
    expect(b.value).toBe(7 * 48 - 6 * 30 - 90);
    expect(b.efficiency).toBeCloseTo(b.value / 3060);
  });

  it('reports not configured (never a fake zero) when no activity has a focus demand', () => {
    const rows = keys.map((k) => row(k, 'code', 60, 0.8, 0));
    const b = attentionBudget(daily(rows), rows, keys);
    expect(b.configured).toBe(false);
    expect(b.median).toBeNull();
    expect(b.costlySharePct).toBeNull();
    expect(b.latest).toBeNull();
    expect(b.efficiency).toBeNull();
    expect(b.consumers).toEqual([]);
  });

  it('keeps the efficiency guard: no ratio below the attention floor', () => {
    const rows = [row(keys[0], 'code', 10, 1, 0.5)]; // 5 attention points, under the 6-point floor
    const p = attentionPeriod(daily(rows), keys);
    expect(p.configured).toBe(true);
    expect(p.efficiency).toBeNull();
    expect(p.typicalEfficiency).toBeNull();
  });
});
