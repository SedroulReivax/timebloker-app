import { describe, expect, it } from 'vitest';
import { comparePeriods, energyForPeriod, getReviewWindows, reviewPeriodKey, summarizePeriod, type PeriodInput } from './reviews';
import { profileDays } from './analysis';
import { dailyMinutesFromBlocks, groupGoalDailyRows } from './goals';
import { isDueOn } from './habits';
import type { RangeBlock } from './blockRange';

const now = new Date(2026, 8, 30, 12, 0); // Wed 30 Sep 2026
const blk = (date_key: string, block_index: number, activity_id = 'w'): RangeBlock => ({ date_key, block_index, activity_id });
const at = (m: number, d: number, h = 12) => new Date(2026, m - 1, d, h).toISOString();
const dayRun = (date: string, from: number, n: number, a = 'w') => Array.from({ length: n }, (_, i) => blk(date, from + i, a));

describe('review windows', () => {
  it('week is Monday to Sunday with the previous week before it', () => {
    const { current, previous } = getReviewWindows('week', new Date(2026, 8, 23));
    expect([current.startKey, current.endKey, current.dateKeys.length]).toEqual(['2026-09-21', '2026-09-27', 7]);
    expect([previous.startKey, previous.endKey]).toEqual(['2026-09-14', '2026-09-20']);
  });

  it('month is the calendar month and the previous month', () => {
    const { current, previous } = getReviewWindows('month', new Date(2026, 2, 15));
    expect([current.startKey, current.endKey]).toEqual(['2026-03-01', '2026-03-31']);
    expect([previous.startKey, previous.endKey, previous.dateKeys.length]).toEqual(['2026-02-01', '2026-02-28', 28]);
  });

  it('period keys', () => {
    expect(reviewPeriodKey('week', new Date(2026, 8, 23))).toBe('2026-09-21');
    expect(reviewPeriodKey('month', new Date(2026, 8, 23))).toBe('2026-09');
  });
});

const activities = [{ id: 'w', category: 'Work' }, { id: 's', category: 'Health' }];
const sleepIds = new Set(['s']);

/**
 * Builds a PeriodInput the way the real pipeline does -- profiles from profileDays (what
 * mapAnalyticsToProfiles + focusSupplementByDate reproduce from backend rows), activityDaily/
 * habitDaily from the same raw fixtures the backend aggregates would have summed, goalDailyByGoal
 * via the same dailyMinutesFromBlocks/groupGoalDailyRows helpers GoalsPage/TrendsTab use -- so
 * these tests exercise summarizePeriod's own assembly logic, not a hand-rolled substitute.
 */
function buildInput(opts: {
  blocks?: RangeBlock[];
  dateKeys: string[];
  tasks?: PeriodInput['tasks'];
  sessions?: { started_at: string; duration_minutes: number }[];
  habits?: PeriodInput['habits'];
  habitLogs?: { habit_id: string; date_key: string }[];
  goals?: PeriodInput['goals'];
}): PeriodInput {
  const blocks = opts.blocks ?? [];
  const habits = opts.habits ?? [];
  const habitLogs = opts.habitLogs ?? [];
  const goals = opts.goals ?? [];

  const profiles = profileDays({ blocks, activities, sleepIds, sessions: opts.sessions }, opts.dateKeys, { now });

  const activityDaily: PeriodInput['activityDaily'] = [];
  const byDayActivity = new Map<string, number>();
  for (const b of blocks) {
    if (!b.activity_id) continue;
    const k = `${b.date_key}|${b.activity_id}`;
    byDayActivity.set(k, (byDayActivity.get(k) ?? 0) + 10);
  }
  for (const [k, minutes] of byDayActivity) {
    const [date_key, activity_id] = k.split('|');
    activityDaily.push({ date_key, activity_id, minutes });
  }

  const habitDaily: PeriodInput['habitDaily'] = [];
  const logged = new Set(habitLogs.map((l) => `${l.habit_id}|${l.date_key}`));
  for (const h of habits) {
    for (const dk of opts.dateKeys) {
      habitDaily.push({ date_key: dk, habit_id: h.id, due: isDueOn(h, dk), completed: logged.has(`${h.id}|${dk}`) });
    }
  }

  const goalDailyByGoal = groupGoalDailyRows(
    goals.flatMap((g) => dailyMinutesFromBlocks(g, blocks, now).map((d) => ({ goal_id: g.id, date_key: d.date_key, goal_minutes: d.minutes })))
  );

  // analytics_daily's timer minutes and completions, summed per local day as recompute_daily_analytics does
  const dayOf = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const daily = new Map<string, PeriodInput['daily'][number]>();
  const dayRow = (dk: string) => daily.get(dk) ?? daily.set(dk, {
    date_key: dk, elapsed_minutes: 1440, judged_minutes: 0, productivity_points: 0, attention_points: 0, attention_efficiency: null, task_focus_minutes: 0, tasks_completed: 0,
  }).get(dk)!;
  for (const s of opts.sessions ?? []) dayRow(dayOf(s.started_at)).task_focus_minutes += s.duration_minutes;
  for (const t of opts.tasks ?? []) if (t.completed && t.completed_at) dayRow(dayOf(t.completed_at)).tasks_completed += 1;

  return {
    profiles,
    daily: [...daily.values()],
    activityDaily,
    habitDaily,
    goalDailyByGoal,
    sleepBlocks: blocks.filter((b) => b.activity_id && sleepIds.has(b.activity_id)),
    activities,
    sleepIds,
    tasks: opts.tasks ?? [],
    habits,
    goals,
  };
}

describe('summarizePeriod', () => {
  const { current } = getReviewWindows('week', new Date(2026, 8, 23)); // 21-27 Sep, entirely in the past vs `now`

  it('tracked, coverage, deep focus, timer focus and distribution come from the shared profiles', () => {
    const sessions = [{ started_at: at(9, 22), duration_minutes: 50 }, { started_at: at(9, 1), duration_minutes: 99 }];
    const input = buildInput({
      dateKeys: current.dateKeys,
      blocks: [...dayRun('2026-09-21', 54, 12), ...dayRun('2026-09-14', 54, 4) /* outside */],
      sessions,
    });
    const s = summarizePeriod(input, current, now);
    // 120 min of painted blocks plus a 50 min timer session on an untracked stretch (time you really spent)
    expect(s.summary.assignedMinutes).toBe(170);
    expect(s.summary.deepMinutes).toBe(170);
    expect(s.summary.coveragePct).toBe(Math.round((17 / (144 * 7)) * 100));
    expect(s.focusedMinutes).toBe(50);
    expect(s.distribution[0].category).toBe('Untracked');
    expect(s.profiles).toHaveLength(7);
  });

  it('tasks done in period and overdue as of period end', () => {
    const s = summarizePeriod(buildInput({
      dateKeys: current.dateKeys,
      tasks: [
        { id: '1', title: 'a', completed: true, completed_at: at(9, 22) },
        { id: '2', title: 'b', completed: true, completed_at: at(9, 2) },
        { id: '3', title: 'c', completed: false, deadline: '2026-09-25T00:00:00.000Z' },
        { id: '4', title: 'd', completed: false, deadline: '2026-09-29T00:00:00.000Z' },
      ],
    }), current, now);
    expect(s.tasksDone).toBe(1);
    expect(s.tasksOverdue).toBe(1);
  });

  it('sleep average over nights waking inside the period', () => {
    const night = [blk('2026-09-21', 138, 's'), blk('2026-09-21', 139, 's'), blk('2026-09-22', 0, 's'), blk('2026-09-22', 1, 's')];
    const s = summarizePeriod(buildInput({ dateKeys: current.dateKeys, blocks: night }), current, now);
    expect(s.sleepNights).toBe(1);
    expect(s.sleepAvgMinutes).toBe(40);
    expect(s.nightly).toEqual([40]);
  });

  it('habit consistency counts due, finished days only, with an interval', () => {
    const habit = { id: 'h', type: 'daily', created_at: new Date(2026, 8, 1).toISOString() };
    const habitLogs = ['2026-09-21', '2026-09-22', '2026-09-23'].map((date_key) => ({ habit_id: 'h', date_key }));
    const s = summarizePeriod(buildInput({ dateKeys: current.dateKeys, habits: [habit], habitLogs }), current, now);
    expect(s.habitConsistencyPct).toBe(Math.round((3 / 7) * 100));
    expect(s.habitLo!).toBeLessThan(s.habitConsistencyPct!);
    expect(s.habitHi!).toBeGreaterThan(s.habitConsistencyPct!);
    expect(summarizePeriod(buildInput({ dateKeys: current.dateKeys }), current, now).habitConsistencyPct).toBeNull();
  });

  it('goal hours within the period only', () => {
    const s = summarizePeriod(buildInput({
      dateKeys: current.dateKeys,
      goals: [{ id: 'g', title: 'Study', linked_activity_ids: ['w'] }, { id: 'g2', title: 'None', linked_activity_ids: [] }],
      blocks: [...dayRun('2026-09-21', 1, 2), blk('2026-09-10', 1)],
    }), current, now);
    expect(s.goalHours).toEqual([{ goalId: 'g', title: 'Study', hours: 20 / 60 }]);
  });
});

describe('comparePeriods', () => {
  it('calls a clear improvement up and noise flat, and refuses with too few days', () => {
    const w = getReviewWindows('week', new Date(2026, 8, 23));
    const cur = summarizePeriod(buildInput({ dateKeys: w.current.dateKeys, blocks: w.current.dateKeys.flatMap((d) => dayRun(d, 54, 14)) }), w.current, now);
    const prev = summarizePeriod(buildInput({ dateKeys: w.previous.dateKeys, blocks: w.previous.dateKeys.flatMap((d) => dayRun(d, 54, 6)) }), w.previous, now);
    const c = comparePeriods(cur, prev);
    expect(c.tracked.direction).toBe('up');
    expect(c.tracked.delta!).toBeCloseTo(80);
    expect(c.deep.direction).toBe('up');

    const same = comparePeriods(prev, prev);
    expect(same.tracked.direction).toBe('flat');

    const thin = summarizePeriod(buildInput({ dateKeys: w.current.dateKeys, blocks: dayRun('2026-09-21', 54, 14) }), w.current, now);
    expect(comparePeriods(thin, prev).tracked.enough).toBe(false);
    expect(comparePeriods(cur, prev).sleep.direction).toBe('flat'); // no sleep data at all
  });
});

describe('energyForPeriod', () => {
  const window = { startKey: '2026-09-21', endKey: '2026-09-23', dateKeys: ['2026-09-21', '2026-09-22', '2026-09-23'] };

  it('averages rated days only and keeps unrated days null', () => {
    const e = energyForPeriod([
      { period_type: 'day', period_key: '2026-09-21', energy: 3 },
      { period_type: 'day', period_key: '2026-09-23', energy: 6 },
      { period_type: 'day', period_key: '2026-09-30', energy: 1 }, // outside the window
      { period_type: 'week', period_key: '2026-09-21', energy: 7 }, // not a day review
    ], window);
    expect(e.days.map((d) => d.energy)).toEqual([3, null, 6]);
    expect(e.n).toBe(2);
    expect(e.mean).toBe(4.5);
  });

  it('is empty (not zero) when nothing is rated', () => {
    const e = energyForPeriod([{ period_type: 'day', period_key: '2026-09-22', energy: null }], window);
    expect(e.n).toBe(0);
    expect(e.mean).toBeNull();
  });
});
