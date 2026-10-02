import { describe, expect, it } from 'vitest';
import {
  activityDistributionFromActivityDaily, distributionFromActivityDaily, elapsedBlocksForDate, getActivityDistribution, getCoverage, getDistribution, getFocusByDate, getRangeWindow, getTimeAccounting,
} from './insights';
import { findSleepActivities } from './sleepActivity';
import type { RangeBlock } from './blockRange';

const now = new Date(2026, 8, 22, 12, 0); // Tue 22 Sep 2026 12:00 -> 72 blocks elapsed today
const b = (date_key: string, block_index: number, activity_id: string | null = 'w', task_id: string | null = null): RangeBlock => ({ date_key, block_index, activity_id, task_id });

describe('range windows', () => {
  it('7d ends on the given day and has a 7-day previous period', () => {
    const w = getRangeWindow('7d', now);
    expect(w.dateKeys).toHaveLength(7);
    expect(w.endKey).toBe('2026-09-22');
    expect(w.startKey).toBe('2026-09-16');
    expect(w.prev?.dateKeys).toHaveLength(7);
    expect(w.prev?.endKey).toBe('2026-09-15');
  });
  it('6m and 1y have no previous window', () => {
    expect(getRangeWindow('6m', now).prev).toBeNull();
    expect(getRangeWindow('1y', now).dateKeys.length).toBeGreaterThan(360);
  });
});

describe('coverage', () => {
  it('elapsed blocks: past 144, today so far, future 0', () => {
    expect(elapsedBlocksForDate('2026-09-21', now)).toBe(144);
    expect(elapsedBlocksForDate('2026-09-22', now)).toBe(72);
    expect(elapsedBlocksForDate('2026-09-23', now)).toBe(0);
  });

  it('counts only elapsed tracked blocks and separates untracked', () => {
    const blocks = [b('2026-09-21', 0), b('2026-09-21', 1), b('2026-09-22', 10), b('2026-09-22', 100), b('2026-09-23', 0)];
    const c = getCoverage(blocks, ['2026-09-21', '2026-09-22', '2026-09-23'], now);
    expect(c.trackedMinutes).toBe(30);
    expect(c.elapsedMinutes).toBe((144 + 72) * 10);
    expect(c.untrackedMinutes).toBe(c.elapsedMinutes - 30);
    expect(c.coveragePct).toBe(Math.round((3 / 216) * 100));
  });

  it('null coverage when nothing elapsed; duplicates do not double count', () => {
    expect(getCoverage([], ['2026-09-30'], now).coveragePct).toBeNull();
    expect(getCoverage([b('2026-09-21', 0), b('2026-09-21', 0)], ['2026-09-21'], now).trackedMinutes).toBe(10);
  });
});

describe('distribution', () => {
  it('groups by category with sleep and untracked rows', () => {
    const acts = [{ id: 'w', category: 'Work' }, { id: 's', category: 'Health' }];
    const blocks = [b('2026-09-21', 0, 'w'), b('2026-09-21', 1, 'w'), b('2026-09-21', 2, 's')];
    const cov = getCoverage(blocks, ['2026-09-21'], now);
    const rows = getDistribution(blocks, acts, new Set(['s']), cov);
    expect(rows.find((r) => r.category === 'Work')?.minutes).toBe(20);
    expect(rows.find((r) => r.category === 'Sleep')?.minutes).toBe(10);
    expect(rows.find((r) => r.category === 'Untracked')?.minutes).toBe(1440 - 30);
  });

  it('distributionFromActivityDaily matches getDistribution for the equivalent per-activity totals', () => {
    const acts = [{ id: 'w', category: 'Work' }, { id: 's', category: 'Health' }];
    const blocks = [b('2026-09-21', 0, 'w'), b('2026-09-21', 1, 'w'), b('2026-09-21', 2, 's')];
    const cov = getCoverage(blocks, ['2026-09-21'], now);
    const fromBlocks = getDistribution(blocks, acts, new Set(['s']), cov);
    const rows = [
      { activity_id: 'w', minutes: 20 } as any,
      { activity_id: 's', minutes: 10 } as any,
    ];
    const fromDaily = distributionFromActivityDaily(rows, acts, new Set(['s']), cov);
    for (const category of ['Work', 'Sleep', 'Untracked']) {
      expect(fromDaily.find((r) => r.category === category)?.minutes).toBe(fromBlocks.find((r) => r.category === category)?.minutes);
      expect(fromDaily.find((r) => r.category === category)?.pct).toBe(fromBlocks.find((r) => r.category === category)?.pct);
    }
  });

  it('groups by individual activity with an untracked row', () => {
    const acts = [{ id: 'w', name: 'Deep Work', color: '#111' }, { id: 's', name: 'Workout', color: '#222' }];
    const blocks = [b('2026-09-21', 0, 'w'), b('2026-09-21', 1, 'w'), b('2026-09-21', 2, 's')];
    const cov = getCoverage(blocks, ['2026-09-21'], now);
    const rows = getActivityDistribution(blocks, acts, cov);
    expect(rows.find((r) => r.name === 'Deep Work')?.minutes).toBe(20);
    expect(rows.find((r) => r.name === 'Workout')?.minutes).toBe(10);
    expect(rows.find((r) => r.name === 'Untracked')?.minutes).toBe(1440 - 30);
  });
});

describe('focus sessions', () => {
  it('sums by local date', () => {
    const at = new Date(2026, 8, 21, 23, 30).toISOString();
    expect(getFocusByDate([{ started_at: at, duration_minutes: 25 }, { started_at: at, duration_minutes: 5 }])).toEqual({ '2026-09-21': 30 });
  });
});

describe('misc', () => {
  it('time accounting excludes sleep and splits task-linked vs other', () => {
    const blocks = [b('d', 1, 'w', 't'), b('d', 2, 'w'), b('d', 3, 's')];
    const acc = getTimeAccounting(blocks, { trackedMinutes: 30, untrackedMinutes: 100, elapsedMinutes: 130, coveragePct: 23 }, new Set(['s']));
    expect(acc).toEqual({ taskLinked: 10, otherTracked: 10, untracked: 100 });
  });
  it('sleep activity: flag beats name; name fallback prefers Health', () => {
    expect(findSleepActivities([{ id: '1', name: 'Nap', is_sleep_activity: true }, { id: '2', name: 'Sleep' }]).map((a) => a.id)).toEqual(['1']);
    expect(findSleepActivities([{ id: '1', name: 'Sleep', category: 'Other' }, { id: '2', name: 'Deep sleep', category: 'Health' }]).map((a) => a.id)).toEqual(['2']);
    expect(findSleepActivities([{ id: '1', name: 'Work' }])).toEqual([]);
  });
});

describe('the Day range', () => {
  it('is just the selected day, with 28 days of history and no previous period', () => {
    const w = getRangeWindow('1d', new Date(2026, 8, 23, 15, 0));
    expect(w.dateKeys).toEqual(['2026-09-23']);
    expect(w.prev).toBeNull();
    expect(w.history!.dateKeys).toHaveLength(28);
    expect(w.history!.endKey).toBe('2026-09-22');
  });
});

describe('activityDistributionFromActivityDaily', () => {
  it('sums each activity across days, keeps Untracked, and folds a long tail into "Other activities"', () => {
    const acts = Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, name: `A${i}`, color: '#000' }));
    const rows = [
      { activity_id: 'a0', minutes: 100 }, { activity_id: 'a0', minutes: 20 },
      { activity_id: 'a1', minutes: 90 }, { activity_id: 'a2', minutes: 30 }, { activity_id: 'a3', minutes: 20 }, { activity_id: 'a4', minutes: 10 },
    ];
    const cov = { elapsedMinutes: 600, untrackedMinutes: 330 };
    const all = activityDistributionFromActivityDaily(rows, acts, cov);
    expect(all.map((r) => [r.name, r.minutes])).toEqual([['Untracked', 330], ['A0', 120], ['A1', 90], ['A2', 30], ['A3', 20], ['A4', 10]]);
    expect(all.find((r) => r.id === 'a0')!.pct).toBe(20);
    const capped = activityDistributionFromActivityDaily(rows, acts, cov, 3);
    expect(capped.map((r) => [r.name, r.minutes])).toEqual([['Untracked', 330], ['A0', 120], ['A1', 90], ['Other activities', 60]]);
  });
});
