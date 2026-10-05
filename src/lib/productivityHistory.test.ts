import { describe, expect, it } from 'vitest';
import { productivityPointsHistory, type PointsDailyRow } from './productivityHistory';

const row = (date_key: string, productivity_points: number | string | null, judged_minutes: number | string | null = 600, elapsed_minutes = 1440): PointsDailyRow =>
  ({ date_key, productivity_points, judged_minutes, elapsed_minutes });

describe('productivityPointsHistory', () => {
  it('charts each day with a running total, filling missing days with 0', () => {
    const h = productivityPointsHistory(
      [row('2026-10-01', 120), row('2026-10-03', -40.25)],
      ['2026-10-01', '2026-10-02', '2026-10-03'],
    );
    expect(h.bars.map((b) => b.points)).toEqual([120, 0, -40.2]);
    expect(h.bars.map((b) => b.cumulative)).toEqual([120, 120, 79.8]);
    expect(h.total).toBe(79.8);
    expect(h.trackedDays).toBe(2);
    expect(h.perTrackedDay).toBe(39.9);
    expect(h.best).toEqual({ dateKey: '2026-10-01', points: 120 });
    expect(h.worst).toEqual({ dateKey: '2026-10-03', points: -40.25 });
    expect(h.change).toBeNull();
  });

  it('ignores rows outside the range and tolerates numeric strings and nulls', () => {
    const h = productivityPointsHistory(
      [row('2026-09-01', 999), row('2026-10-01', '50'), row('2026-10-02', null, null)],
      ['2026-10-01', '2026-10-02'],
    );
    expect(h.total).toBe(50);
    expect(h.trackedDays).toBe(1);
  });

  it('sums weeks (Monday start) when weekly', () => {
    // 2026-10-04 is a Sunday, 2026-10-05 a Monday
    const h = productivityPointsHistory(
      [row('2026-10-03', 10), row('2026-10-04', 20), row('2026-10-05', 5)],
      ['2026-10-03', '2026-10-04', '2026-10-05'],
      { weekly: true },
    );
    expect(h.bars.map((b) => [b.dateKey, b.points, b.cumulative, b.trackedDays])).toEqual([
      ['2026-09-28', 30, 30, 2],
      ['2026-10-05', 5, 35, 1],
    ]);
  });

  it('compares complete days with the previous period, skipping a partial today', () => {
    const prev = ['2026-09-01', '2026-09-02', '2026-09-03'];
    const cur = ['2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07'];
    const rows = [
      ...prev.map((k) => row(k, 10)),
      ...cur.slice(0, 3).map((k) => row(k, 100)),
      row('2026-09-07', -500, 300, 600), // today, partial: not in the comparison
    ];
    const h = productivityPointsHistory(rows, cur, { prevDateKeys: prev });
    expect(h.change?.enough).toBe(true);
    expect(h.change?.nCurrent).toBe(3);
    expect(h.change?.delta).toBe(90);
  });

  it('returns an empty history for an empty range', () => {
    const h = productivityPointsHistory([row('2026-10-01', 10)], []);
    expect(h).toMatchObject({ bars: [], total: 0, perTrackedDay: null, trackedDays: 0, best: null, worst: null });
  });
});
