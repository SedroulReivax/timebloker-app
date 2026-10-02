import { describe, expect, it } from 'vitest';
import { dayTurbulence, estimateCalibration, goalMomentum, linkedMinutesByTask, taskFlow, taskFunnel, timeToDone, type ExecTask } from './execution';

const NOW = new Date(2026, 8, 28, 12, 0);
const iso = (d: number, h = 9) => new Date(2026, 8, d, h, 0).toISOString();
const task = (id: string, over: Partial<ExecTask> = {}): ExecTask => ({ id, created_at: iso(20), date_key: '2026-09-20', completed: false, ...over });

describe('taskFunnel', () => {
  it('measures every stage when enough tasks have time linked', () => {
    const tasks = Array.from({ length: 10 }, (_, i) => task(`t${i}`, {
      completed: i < 6,
      completed_at: i < 6 ? iso(21) : null,
      deadline: i < 6 ? (i < 4 ? '2026-09-22' : '2026-09-20') : null,
    }));
    const linked = linkedMinutesByTask(tasks.slice(0, 8).map((t) => ({ task_id: t.id })), []);
    const f = taskFunnel(tasks, linked);
    const s = Object.fromEntries(f.map((x) => [x.key, x]));
    expect(s.worked.measurable).toBe(true);
    expect(s.worked.count).toBe(8);
    expect(s.completed.conversion!.pct).toBe(75); // 6 of 8 worked-on
    expect(s.onTime.count).toBe(4);
    expect(s.onTime.conversion!.n).toBe(6);
    expect(s.scheduled.note).toMatch(/Every task gets a day/);
  });

  it('says "not measurable" instead of reporting a near-zero stage when almost nothing is linked', () => {
    const tasks = [task('a', { completed: true }), task('b'), task('c')];
    const f = taskFunnel(tasks, new Map([['a', 10]]));
    const worked = f.find((x) => x.key === 'worked')!;
    expect(worked.measurable).toBe(false);
    expect(worked.conversion).toBeNull();
    expect(f.find((x) => x.key === 'onTime')!.measurable).toBe(false);
  });
});

describe('taskFlow', () => {
  it('compares arrivals and completions only over weeks with completion times, and ages the backlog', () => {
    const tasks = [
      task('old', { created_at: new Date(2026, 7, 1).toISOString(), deadline: '2026-09-01' }), // open, overdue, 58 days
      task('new', { created_at: iso(27) }), // open, 1 day
      task('d1', { created_at: iso(21), completed: true, completed_at: iso(22) }),
      task('d2', { created_at: iso(22), completed: true, completed_at: iso(23) }),
      task('legacy', { created_at: new Date(2026, 7, 3).toISOString(), completed: true }), // no completed_at
    ];
    const f = taskFlow(tasks, NOW);
    expect(f.open).toBe(2);
    expect(f.overdue).toBe(1);
    expect(f.oldestOpenDays).toBe(58);
    expect(f.undatedCompletions).toBe(1);
    expect(f.comparableWeeks).toBe(2); // the week of 21 Sep and this week
    expect(f.completedPerWeek).toBe(1);
    expect(f.ageBuckets.map((b) => b.count)).toEqual([1, 0, 1]);
  });

  it('has no rates when nothing has ever been completed with a time', () => {
    const f = taskFlow([task('a')], NOW);
    expect(f.comparableWeeks).toBe(0);
    expect(f.createdPerWeek).toBeNull();
    expect(f.completedPerWeek).toBeNull();
  });
});

describe('timeToDone', () => {
  it('uses created -> completed hours', () => {
    const t = timeToDone([
      task('a', { created_at: iso(20, 9), completed: true, completed_at: iso(20, 11) }),
      task('b', { created_at: iso(20, 9), completed: true, completed_at: iso(21, 9) }),
      task('c', { completed: true }), // no time, ignored
    ]);
    expect(t.n).toBe(2);
    expect(t.medianHours).toBe(13);
    expect(t.sameDayPct).toBe(50);
  });
  it('is empty without completion times', () => {
    expect(timeToDone([task('a', { completed: true })]).medianHours).toBeNull();
  });
});

describe('estimateCalibration', () => {
  it('buckets explicit estimates by size and ignores the pomodoro default', () => {
    const tasks = [
      task('s1', { completed: true, estimated_minutes: 20 }), task('s2', { completed: true, estimated_minutes: 30 }),
      task('l1', { completed: true, estimated_minutes: 120 }),
      task('default', { completed: true }),
    ];
    const linked = new Map([['s1', 40], ['s2', 60], ['l1', 240], ['default', 100]]);
    const c = estimateCalibration(tasks, linked);
    expect(c.usable).toBe(3);
    expect(c.defaultOnly).toBe(1);
    expect(c.rows.map((r) => r.label)).toEqual(['Up to 30 min', 'Over 90 min']);
    expect(c.rows[0].multiplier).toBeCloseTo(2);
  });
  it('is empty when no task has linked time', () => {
    expect(estimateCalibration([task('a', { completed: true, estimated_minutes: 30 })], new Map()).rows).toEqual([]);
  });
});

describe('dayTurbulence', () => {
  const r = (date_key: string, from: string, to: string, n: number) => ({ date_key, from_activity_id: from, to_activity_id: to, transition_count: n });

  it('is 1 choice for a perfectly habitual day and more for a scattered one', () => {
    const t = dayTurbulence([
      // habitual: A always goes to B, B always to A
      r('2026-09-20', 'A', 'B', 4), r('2026-09-20', 'B', 'A', 4),
      // scattered: A goes to B, C, D, E equally
      r('2026-09-21', 'A', 'B', 2), r('2026-09-21', 'A', 'C', 2), r('2026-09-21', 'A', 'D', 2), r('2026-09-21', 'A', 'E', 2),
    ], ['2026-09-20', '2026-09-21']);
    expect(t.days[0].choices).toBeCloseTo(1);
    expect(t.days[1].choices).toBeCloseTo(4);
    expect(t.bridges[0].activityId).toBe('A');
    expect(t.bridges[0].choices).toBeGreaterThan(2);
  });
  it('leaves entropy blank on days with too few switches', () => {
    const t = dayTurbulence([r('2026-09-20', 'A', 'B', 2)], ['2026-09-20']);
    expect(t.days[0].entropyBits).toBeNull();
    expect(t.medianChoices).toBeNull();
  });
});

describe('goalMomentum', () => {
  it('reads acceleration relative to the goal\'s own typical week', () => {
    expect(goalMomentum({ currentWeekly: 8, lastWeek: 9, weeklyHistory: [2, 4, 6, 8, 10], stalledDays: 0 }).state).toBe('accelerating');
    expect(goalMomentum({ currentWeekly: 2, lastWeek: 1, weeklyHistory: [10, 8, 6, 4, 2], stalledDays: 1 }).state).toBe('slowing');
    expect(goalMomentum({ currentWeekly: 5, lastWeek: 5, weeklyHistory: [5, 5, 5, 5], stalledDays: 0 }).state).toBe('steady');
  });
  it('calls a 2-week silence a stall, and under 4 weeks too early', () => {
    expect(goalMomentum({ currentWeekly: 0, lastWeek: 0, weeklyHistory: [3, 3, 0, 0], stalledDays: 15 }).state).toBe('stalled');
    expect(goalMomentum({ currentWeekly: 3, lastWeek: 3, weeklyHistory: [3, 3], stalledDays: 0 }).state).toBe('too-early');
  });
});
