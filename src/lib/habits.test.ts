import { describe, expect, it } from 'vitest';
import { computeHabitStats, describeFrequency, getHabitMonth, isDueOn, type HabitLike } from './habits';

const now = new Date(2026, 8, 23, 12, 0); // Wed 23 Sep 2026
const daily = (over: Partial<HabitLike> = {}): HabitLike => ({ id: 'h', type: 'daily', created_at: new Date(2026, 7, 1).toISOString(), ...over });
const logs = (...keys: string[]) => keys.map((k) => ({ habit_id: 'h', date_key: k }));

describe('daily habits', () => {
  it('continues the streak through an unlogged today (in progress)', () => {
    const s = computeHabitStats(daily(), logs('2026-09-20', '2026-09-21', '2026-09-22'), now);
    expect(s.currentStreak).toBe(3);
    expect(s.unit).toBe('days');
  });

  it('counts today when logged', () => {
    expect(computeHabitStats(daily(), logs('2026-09-21', '2026-09-22', '2026-09-23'), now).currentStreak).toBe(3);
  });

  it('breaks when yesterday was missed', () => {
    const s = computeHabitStats(daily(), logs('2026-09-19', '2026-09-20', '2026-09-23'), now);
    expect(s.currentStreak).toBe(1);
    expect(s.longestStreak).toBe(2);
  });

  it('tracks the longest streak across breaks', () => {
    const s = computeHabitStats(daily(), logs('2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-10', '2026-09-11'), now);
    expect(s.longestStreak).toBe(4);
    expect(s.currentStreak).toBe(0);
  });

  it('completion rate excludes an unfinished today', () => {
    const s = computeHabitStats(daily({ created_at: new Date(2026, 8, 20).toISOString() }), logs('2026-09-20', '2026-09-22'), now);
    // due: 20,21,22 (23 pending) -> 2/3
    expect(s.completionRate).toBe(67);
  });

  it('multiple logs on one day do not inflate anything', () => {
    const s = computeHabitStats(daily(), logs('2026-09-22', '2026-09-22'), now);
    expect(s.currentStreak).toBe(1);
    expect(s.totalLogs).toBe(2);
    expect(s.daysLogged).toBe(1);
  });

  it('no logs -> zero streak', () => {
    const s = computeHabitStats(daily(), [], now);
    expect([s.currentStreak, s.longestStreak, s.lastLoggedKey]).toEqual([0, 0, null]);
  });
});

describe('specific weekdays', () => {
  const mwf = daily({ frequency: 'weekdays', weekdays: [1, 3, 5] });
  it('non-due days neither break nor extend', () => {
    // Mon 21 and Fri 18 logged; Tue/Thu (not due) skipped; Wed 23 pending
    const s = computeHabitStats(mwf, logs('2026-09-18', '2026-09-21'), now);
    expect(s.currentStreak).toBe(2);
  });
  it('a missed due day breaks', () => {
    expect(computeHabitStats(mwf, logs('2026-09-21'), now).currentStreak).toBe(1); // Fri 18 missed
  });
  it('isDueOn respects weekdays', () => {
    expect(isDueOn(mwf, '2026-09-21')).toBe(true); // Mon
    expect(isDueOn(mwf, '2026-09-22')).toBe(false); // Tue
  });
});

describe('weekly and N-per-week habits', () => {
  it('weekly: consecutive weeks with at least one log; current week in progress never breaks', () => {
    const h = daily({ frequency: 'weekly' });
    // weeks starting Mon 7 Sep, 14 Sep logged; current week (21 Sep) not yet
    const s = computeHabitStats(h, logs('2026-09-09', '2026-09-16'), now);
    expect(s.unit).toBe('weeks');
    expect(s.currentStreak).toBe(2);
  });

  it('times_per_week needs the target distinct days', () => {
    const h = daily({ frequency: 'times_per_week', target_count: 3 });
    const met = computeHabitStats(h, logs('2026-09-14', '2026-09-15', '2026-09-16', '2026-09-21'), now);
    expect(met.currentStreak).toBe(1); // week of 14th met (3 days); current week has 1 of 3, in progress
    const notMet = computeHabitStats(h, logs('2026-09-14', '2026-09-15'), now);
    expect(notMet.currentStreak).toBe(0);
  });

  it('a missed week breaks the streak', () => {
    const h = daily({ frequency: 'weekly' });
    expect(computeHabitStats(h, logs('2026-09-02'), now).currentStreak).toBe(0);
  });
});

describe('event habits', () => {
  it('report totals but no streak', () => {
    const s = computeHabitStats({ id: 'h', type: 'event' }, logs('2026-09-20', '2026-09-20', '2026-09-22'), now);
    expect([s.currentStreak, s.completionRate, s.totalLogs, s.daysLogged, s.lastLoggedKey]).toEqual([0, null, 3, 2, '2026-09-22']);
  });
});

describe('calendar and labels', () => {
  it('marks done, missed, pending, future and not_due', () => {
    const month = getHabitMonth(daily({ frequency: 'weekdays', weekdays: [1, 3] }), [{ habit_id: 'h', date_key: '2026-09-21', notes: 'x' }], 2026, 8, now);
    const st = (d: string) => month.find((x) => x.dateKey === d)!;
    expect(st('2026-09-21')).toMatchObject({ status: 'done', notes: ['x'] });
    expect(st('2026-09-16').status).toBe('missed'); // Wed, due, no log
    expect(st('2026-09-22').status).toBe('not_due'); // Tue
    expect(st('2026-09-23').status).toBe('pending'); // today, due
    expect(st('2026-09-25').status).toBe('future');
  });

  it('describes frequency', () => {
    expect(describeFrequency(daily())).toBe('Daily');
    expect(describeFrequency(daily({ frequency: 'times_per_week', target_count: 3 }))).toBe('3× per week');
    expect(describeFrequency(daily({ frequency: 'weekdays', weekdays: [5, 1] }))).toBe('Mon, Fri');
    expect(describeFrequency({ id: 'x', type: 'event' })).toBe('Event');
  });
});

describe('habit strength and rate interval', () => {
  const start = new Date(2025, 0, 1).toISOString();
  const dayKeys = (n: number, skip: number[] = []) =>
    Array.from({ length: n }, (_, i) => {
      const d = new Date(2026, 8, 22 - i);
      return skip.includes(i) ? null : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }).filter((x): x is string => !!x);

  it('a long unbroken run is near 100, one miss barely dents it, a long absence hurts', () => {
    const h = daily({ created_at: start });
    const perfect = computeHabitStats(h, logs(...dayKeys(120)), now).strength!;
    const oneMiss = computeHabitStats(h, logs(...dayKeys(120, [3])), now).strength!;
    const absent = computeHabitStats(h, logs(...dayKeys(120).slice(20)), now).strength!; // nothing in the last 20 days
    expect(perfect).toBeGreaterThanOrEqual(99);
    expect(perfect - oneMiss).toBeLessThan(7);
    expect(absent).toBeLessThan(perfect - 40);
  });

  it('a brand new habit builds gradually instead of jumping to 100', () => {
    const h = daily({ created_at: new Date(2026, 8, 17).toISOString() });
    const s = computeHabitStats(h, logs('2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22'), now).strength!;
    expect(s).toBeGreaterThan(15);
    expect(s).toBeLessThan(40);
  });

  it('strength needs a few opportunities; event habits have none', () => {
    expect(computeHabitStats(daily({ created_at: new Date(2026, 8, 22).toISOString() }), [], now).strength).toBeNull();
    expect(computeHabitStats({ id: 'h', type: 'event' }, logs('2026-09-20'), now).strength).toBeNull();
  });

  it('the completion rate carries an interval that is wider with less data', () => {
    const h = daily({ created_at: new Date(2026, 8, 20).toISOString() });
    const few = computeHabitStats(h, logs('2026-09-20', '2026-09-22'), now);
    const many = computeHabitStats(daily({ created_at: start }), logs(...dayKeys(60, [2, 9, 15, 22, 30])), now);
    expect(few.rateHi! - few.rateLo!).toBeGreaterThan(many.rateHi! - many.rateLo!);
    expect(many.rateLo!).toBeLessThanOrEqual(many.completionRate!);
    expect(many.rateHi!).toBeGreaterThanOrEqual(many.completionRate!);
  });

  it('weekly habits get a week-based strength', () => {
    const h = daily({ created_at: start, frequency: 'weekly' });
    const weeks = Array.from({ length: 12 }, (_, i) => dayKeys(7 * (i + 1))[7 * (i + 1) - 1]).filter(Boolean);
    const s = computeHabitStats(h, logs(...weeks), now);
    expect(s.unit).toBe('weeks');
    expect(s.strength!).toBeGreaterThan(50);
  });
});
