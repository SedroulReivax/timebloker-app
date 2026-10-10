import { describe, expect, it } from 'vitest';
import { format } from 'date-fns';
import { activityCountsOn, applyActivityLinkChange, dailyMinutesFromBlocks as dailyFromBlocks, getGoalHabitProgress, getGoalHours, getGoalPace, getGoalReview, goalEndKey, goalStartKey, groupGoalDailyRows, mergeGoalDailyLive, type GoalDayMinutes } from './goals';
import type { RangeBlock } from './blockRange';

const now = new Date(2026, 8, 22, 12, 0); // Tue 22 Sep 2026, 72 blocks elapsed today
const blk = (date_key: string, block_index: number, activity_id: string | null = 'study'): RangeBlock => ({ date_key, block_index, activity_id });
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 9, 0).toISOString();

const goal = {
  id: 'g', status: 'active', target_hours: 50, target_date: at(2026, 10, 22),
  created_at: at(2026, 9, 1), linked_activity_ids: ['study'], linked_habit_ids: ['h1'],
};

describe('groupGoalDailyRows', () => {
  it('groups analytics_goal_daily rows by goal_id, in GoalDayMinutes shape', () => {
    const rows = [
      { goal_id: 'g1', date_key: '2026-09-01', goal_minutes: 30 },
      { goal_id: 'g1', date_key: '2026-09-02', goal_minutes: 45 },
      { goal_id: 'g2', date_key: '2026-09-01', goal_minutes: 10 },
    ];
    const byGoal = groupGoalDailyRows(rows);
    expect(byGoal.get('g1')).toEqual([{ date_key: '2026-09-01', minutes: 30 }, { date_key: '2026-09-02', minutes: 45 }]);
    expect(byGoal.get('g2')).toEqual([{ date_key: '2026-09-01', minutes: 10 }]);
    expect(byGoal.has('g3')).toBe(false);
  });

  it('returns an empty map for no rows', () => {
    expect(groupGoalDailyRows([]).size).toBe(0);
  });
});

describe('goal keys', () => {
  it('start is local created date; end only when closed', () => {
    expect(goalStartKey(goal)).toBe('2026-09-01');
    expect(goalEndKey(goal)).toBeNull();
    expect(goalEndKey({ ...goal, status: 'completed', updated_at: at(2026, 9, 20) })).toBe('2026-09-20');
  });
});

describe('getGoalHours', () => {
  it('counts linked-activity blocks since the goal started, elapsed only, without duplicates', () => {
    const blocks = [
      blk('2026-08-30', 1), // before goal start
      blk('2026-09-10', 1), blk('2026-09-10', 1), blk('2026-09-10', 2), // duplicate slot
      blk('2026-09-22', 10), // today, elapsed
      blk('2026-09-22', 100), // today, future
      blk('2026-09-10', 5, 'other'), // not linked
    ];
    expect(getGoalHours(goal, dailyFromBlocks(goal, blocks, now))).toBeCloseTo(30 / 60);
  });

  it('is 0 without linked activities', () => {
    const g = { ...goal, linked_activity_ids: [] };
    expect(getGoalHours(g, dailyFromBlocks(g, [blk('2026-09-10', 1)], now))).toBe(0);
  });

  it('stops at the close date for finished goals', () => {
    const done = { ...goal, status: 'completed', updated_at: at(2026, 9, 12) };
    expect(getGoalHours(done, dailyFromBlocks(done, [blk('2026-09-10', 1), blk('2026-09-15', 1)], now))).toBeCloseTo(10 / 60);
  });
});

describe('getGoalPace', () => {
  it('weights recent weeks, reports the last 7 days, and finds when work last happened', () => {
    // 6 blocks/day (1h) for the last 7 days only; earlier weeks of the goal had nothing
    const blocks: RangeBlock[] = [];
    for (let d = 16; d <= 22; d++) for (let i = 0; i < 6; i++) blocks.push(blk(`2026-09-${d}`, i));
    const p = getGoalPace(goal, dailyFromBlocks(goal, blocks, now), now);
    expect(p.hours).toBeCloseTo(7);
    expect(p.lastWeek).toBeCloseTo(7);
    expect(p.weeklyHistory).toEqual([0, 0, 7]);
    expect(p.currentWeekly).toBeCloseTo(3.5); // EWMA of [0,0,7] with alpha 0.5
    expect(p.stalledDays).toBe(0);
    expect(p.remainingHours).toBeCloseTo(43);
    expect(p.daysRemaining).toBe(30);
    expect(p.requiredWeekly).toBeCloseTo(43 / (30 / 7));
    expect(p.weeksToTarget).toBeCloseTo(43 / 3.5);
  });

  it('a stall shows up: 2h/day for three weeks, then nothing for 8 days', () => {
    const cur = new Date(2026, 8, 30, 12, 0);
    const g = { ...goal, target_hours: 100, target_date: new Date(2026, 10, 30).toISOString(), created_at: new Date(2026, 7, 1).toISOString() };
    const blocks: RangeBlock[] = [];
    for (let d = 3; d <= 22; d++) for (let i = 0; i < 12; i++) blocks.push(blk(`2026-09-${String(d).padStart(2, '0')}`, 60 + i));
    const p = getGoalPace(g, dailyFromBlocks(g, blocks, cur), cur);
    expect(p.stalledDays).toBe(8);
    expect(p.lastWeek).toBe(0);
    expect(p.currentWeekly).toBeLessThan(8); // the old flat 28-day mean reported 10.0 here
  });

  it('a typical range and a weeks-to-target range appear once there are 4+ weeks', () => {
    const cur = new Date(2026, 8, 30, 12, 0);
    const g = { ...goal, created_at: new Date(2026, 7, 1).toISOString() };
    const blocks: RangeBlock[] = [];
    // weekly totals of ~5h, 7h, 6h, 8h, 6h across the last five weeks
    const perWeek = [5, 7, 6, 8, 6];
    perWeek.forEach((h, w) => {
      const dayBase = 30 - 6 - 7 * (4 - w); // first day of that week within September / August spill handled below
      for (let d = 0; d < h; d++) {
        const date = new Date(2026, 8, dayBase + d);
        for (let i = 0; i < 6; i++) blocks.push({ date_key: format(date, 'yyyy-MM-dd'), block_index: i, activity_id: 'study' });
      }
    });
    const p = getGoalPace(g, dailyFromBlocks(g, blocks, cur), cur);
    expect(p.typicalRange).not.toBeNull();
    expect(p.weeksToTargetRange![0]).toBeLessThan(p.weeksToTargetRange![1]);
  });

  it('a brand new goal (under a week old) uses its own daily rate', () => {
    const cur = new Date(2026, 8, 22, 12, 0);
    const g = { ...goal, created_at: at(2026, 9, 20) }; // 3 days old
    const blocks = [blk('2026-09-20', 1), blk('2026-09-21', 1), blk('2026-09-21', 2)];
    const p = getGoalPace(g, dailyFromBlocks(g, blocks, cur), cur);
    expect(p.weeklyHistory).toEqual([]);
    expect(p.currentWeekly).toBeCloseTo((30 / 60 / 3) * 7);
  });

  it('no target or date gives null pace fields', () => {
    const g = { ...goal, target_hours: null, target_date: null };
    const p = getGoalPace(g, dailyFromBlocks(g, [], now), now);
    expect(p.requiredWeekly).toBeNull();
    expect(p.remainingHours).toBeNull();
    expect(p.weeksToTarget).toBeNull();
    expect(p.stalledDays).toBeNull();
  });
});

describe('mergeGoalDailyLive', () => {
  it('overlays the live date onto the backend series, replacing any existing row for that date', () => {
    const daily: GoalDayMinutes[] = [{ date_key: '2026-09-20', minutes: 60 }, { date_key: '2026-09-22', minutes: 30 }];
    const live = [blk('2026-09-22', 10), blk('2026-09-22', 11), blk('2026-09-22', 100)]; // 100 is future (>=72 elapsed)
    const merged = mergeGoalDailyLive(daily, goal, live, now);
    expect(merged.find((d) => d.date_key === '2026-09-22')?.minutes).toBe(20);
    expect(merged.find((d) => d.date_key === '2026-09-20')?.minutes).toBe(60);
  });

  it('is a no-op when there are no live blocks', () => {
    const daily: GoalDayMinutes[] = [{ date_key: '2026-09-20', minutes: 60 }];
    expect(mergeGoalDailyLive(daily, goal, [], now)).toEqual(daily);
  });
});

describe('habits and review', () => {
  it('counts distinct logged days per linked habit since start', () => {
    const logs = [
      { habit_id: 'h1', date_key: '2026-09-02' }, { habit_id: 'h1', date_key: '2026-09-02' }, { habit_id: 'h1', date_key: '2026-09-05' },
      { habit_id: 'h2', date_key: '2026-09-05' }, { habit_id: 'h1', date_key: '2026-08-01' },
    ];
    const [h] = getGoalHabitProgress(goal, logs, now);
    expect(h.daysLogged).toBe(2);
    expect(h.daysElapsed).toBe(22);
    expect(h.perWeek).toBeCloseTo((2 / 22) * 7);
  });

  it('review bundles start, end, actual and planned hours', () => {
    const done = { ...goal, status: 'completed', updated_at: at(2026, 9, 20) };
    const r = getGoalReview(done, dailyFromBlocks(done, [blk('2026-09-10', 1)], now), [], now);
    expect(r).toMatchObject({ startKey: '2026-09-01', endKey: '2026-09-20', plannedHours: 50 });
    expect(r.actualHours).toBeCloseTo(10 / 60);
  });
});

describe('activity link ranges', () => {
  const g = (ranges: any, ids = ['study']) => ({ ...goal, linked_activity_ids: ids, linked_activity_ranges: ranges });

  it('counts the whole life when there is no range entry (legacy goals)', () => {
    expect(activityCountsOn(goal, 'study', '2026-09-02')).toBe(true);
    expect(activityCountsOn(goal, 'other', '2026-09-02')).toBe(false);
  });

  it('a newly linked activity counts only from its since date', () => {
    const gg = g({ study: { since: '2026-09-20' } });
    expect(activityCountsOn(gg, 'study', '2026-09-19')).toBe(false);
    expect(activityCountsOn(gg, 'study', '2026-09-20')).toBe(true);
  });

  it('an unlinked activity keeps its past days through until, then stops', () => {
    const gg = g({ study: { until: '2026-09-20' } }, []);
    expect(activityCountsOn(gg, 'study', '2026-09-05')).toBe(true);
    expect(activityCountsOn(gg, 'study', '2026-09-20')).toBe(true);
    expect(activityCountsOn(gg, 'study', '2026-09-21')).toBe(false);
  });

  it('dailyMinutesFromBlocks and mergeGoalDailyLive respect the ranges', () => {
    const gg = g({ study: { since: '2026-09-21' } });
    expect(dailyFromBlocks(gg, [blk('2026-09-20', 5), blk('2026-09-21', 5)], now)).toEqual([{ date_key: '2026-09-21', minutes: 10 }]);
    const merged = mergeGoalDailyLive([], g({ study: { since: '2026-09-23' } }), [blk('2026-09-22', 3)], now);
    expect(merged).toEqual([{ date_key: '2026-09-22', minutes: 0 }]);
  });

  it('applyActivityLinkChange: link starts today, unlink ends today, relink resumes', () => {
    const linked = applyActivityLinkChange(goal, ['study', 'math'], '2026-09-22');
    expect(linked.math).toEqual({ since: '2026-09-22', until: null });
    expect(linked.study).toBeUndefined();
    const unlinked = applyActivityLinkChange(goal, [], '2026-09-22');
    expect(unlinked.study).toEqual({ since: null, until: '2026-09-22' });
    const relinked = applyActivityLinkChange({ ...goal, linked_activity_ids: [], linked_activity_ranges: unlinked }, ['study'], '2026-09-25');
    expect(relinked.study).toEqual({ since: null, until: null });
  });
});
