import { describe, expect, it } from 'vitest';
import { addDays, format, parseISO } from 'date-fns';
import {
  analyzeSleepEffect, getSleepRegularityIndex,
  buildNight, buildNights, formatClock, formatDur, getAverages, getBaseline, getBedtimeStreak, getChronotype, getFactorImpacts, getGoalStreak,
  getInsights, getRegularity, getSleepDebt, getSocialJetLag, getWeekdayPattern, parseClockText, planTonight, relToClock, scoreNight, type SleepBlock,
} from './sleepAnalysis';

const nextDay = (d: string) => format(addDays(parseISO(d), 1), 'yyyy-MM-dd');

/** Sleep from bedIdx on the night date (evening) until wakeIdx (exclusive) on the wake date. */
const sleep = (nightDate: string, bedIdx = 138, wakeIdx = 42, skip: number[] = []): SleepBlock[] => {
  const wake = nextDay(nightDate);
  const out: SleepBlock[] = [];
  for (let i = bedIdx; i < 144; i++) out.push({ date_key: nightDate, block_index: i });
  for (let i = 0; i < wakeIdx; i++) if (!skip.includes(i)) out.push({ date_key: wake, block_index: i });
  return out;
};

describe('buildNight', () => {
  it('measures a clean 11pm-7am night', () => {
    const n = buildNight(sleep('2026-09-21'), '2026-09-21');
    expect(n.main).toMatchObject({ startRel: 300, endRel: 780, sleepMinutes: 480, inBedMinutes: 480, awakeMinutes: 0, efficiency: 1, wakeUps: 0 });
    expect(n.wakeDate).toBe('2026-09-22');
    expect(n.totalMinutes).toBe(480);
    expect(formatClock(relToClock(n.main!.startRel))).toBe('11:00 PM');
    expect(formatClock(relToClock(n.main!.endRel))).toBe('7:00 AM');
  });

  it('counts a 30-minute gap as a wake-up and lowers efficiency', () => {
    const n = buildNight(sleep('2026-09-21', 138, 42, [10, 11, 12]), '2026-09-21');
    expect(n.main!.wakeUps).toBe(1);
    expect(n.main!.awakeMinutes).toBe(30);
    expect(n.main!.longestAwakeMinutes).toBe(30);
    expect(n.main!.efficiency).toBeCloseTo(45 / 48);
    expect(n.main!.gaps).toEqual([{ startRel: (36 + 10) * 10, endRel: (36 + 13) * 10 }]);
  });

  it('a single missing block is awake time but not a wake-up', () => {
    const n = buildNight(sleep('2026-09-21', 138, 42, [10]), '2026-09-21');
    expect(n.main!.wakeUps).toBe(0);
    expect(n.main!.awakeMinutes).toBe(10);
  });

  it('a gap of up to 2 hours stays in the same session; longer splits off a nap', () => {
    const wake = '2026-09-22';
    const within = [...sleep('2026-09-21'), ...Array.from({ length: 3 }, (_, i) => ({ date_key: wake, block_index: 53 + i }))]; // exactly 12 blocks after the last main block
    expect(buildNight(within, '2026-09-21').naps).toHaveLength(0);
    const nap = [...sleep('2026-09-21'), ...Array.from({ length: 3 }, (_, i) => ({ date_key: wake, block_index: 84 + i }))]; // 14:00
    const n = buildNight(nap, '2026-09-21');
    expect(n.naps).toHaveLength(1);
    expect(n.napMinutes).toBe(30);
    expect(n.main!.sleepMinutes).toBe(480);
    expect(n.totalMinutes).toBe(510);
  });

  it('nights with no sleep have no main session; blocks of other dates are ignored', () => {
    const n = buildNight([{ date_key: '2026-09-25', block_index: 3 }], '2026-09-21');
    expect(n.main).toBeNull();
    expect(n.totalMinutes).toBe(0);
  });

  it('an afternoon nap before 18:00 on the night date belongs to the previous night window', () => {
    expect(buildNight([{ date_key: '2026-09-21', block_index: 90 }], '2026-09-21').main).toBeNull();
  });

  it('carries the log fields', () => {
    const n = buildNight(sleep('2026-09-21'), '2026-09-21', { quality: 4, energy: 3, factors: ['alcohol'], notes: 'x' });
    expect([n.quality, n.energy, n.factors, n.notes]).toEqual([4, 3, ['alcohol'], 'x']);
  });
});

describe('scoreNight', () => {
  const goal = 480;
  const perfect = buildNight(sleep('2026-09-21'), '2026-09-21', { quality: 5 });
  const base = getBaseline([perfect]);

  it('a perfect, regular, well-rated night scores 100 with all parts visible', () => {
    const s = scoreNight(perfect, goal, base)!;
    expect(s.score).toBe(100);
    expect(s.parts).toEqual({ duration: 100, continuity: 100, regularity: 100, rating: 100 });
  });

  it('re-weights when regularity and rating are unavailable', () => {
    const n = buildNight(sleep('2026-09-21', 138, 36), '2026-09-21'); // 7h
    const s = scoreNight(n, goal, { medianBedRel: null, medianWakeRel: null })!;
    expect(s.parts.regularity).toBeNull();
    expect(s.parts.rating).toBeNull();
    const dur = (420 / 480) * 100;
    expect(s.score).toBe(Math.round((dur * 40 + 100 * 20) / 60));
  });

  it('penalises broken sleep and big deviations from your usual times', () => {
    const broken = buildNight(sleep('2026-09-21', 138, 42, [5, 6, 7, 20, 21, 22]), '2026-09-21');
    const s = scoreNight(broken, goal, base)!;
    expect(s.parts.continuity).toBeLessThan(100);
    const late = buildNight(sleep('2026-09-22', 150 - 6, 60), '2026-09-22'); // 1:00 AM bed .. shifted
    void late;
    const shifted = buildNight([...Array.from({ length: 48 }, (_, i) => ({ date_key: '2026-09-23', block_index: i + 6 }))], '2026-09-22'); // 1:00-9:00
    expect(scoreNight(shifted, goal, base)!.parts.regularity).toBeLessThan(30);
  });

  it('oversleeping is lightly penalised', () => {
    const long = buildNight(sleep('2026-09-21', 138, 42 + 22), '2026-09-21'); // 11h40
    const s = scoreNight(long, goal, base)!;
    expect(s.parts.duration).toBeLessThan(100);
    expect(s.parts.duration).toBeGreaterThanOrEqual(70);
  });

  it('no sleep -> null', () => {
    expect(scoreNight(buildNight([], '2026-09-21'), goal, base)).toBeNull();
  });
});

describe('aggregates', () => {
  const dates = Array.from({ length: 14 }, (_, i) => format(addDays(parseISO('2026-09-07'), i), 'yyyy-MM-dd'));

  it('sleep debt: net owed vs goal, shortfalls only, capped at zero net', () => {
    const blocks = dates.flatMap((d, i) => sleep(d, 138, i % 2 ? 36 : 48)); // alternating 7h / 9h
    const nights = buildNights(blocks, dates);
    const d = getSleepDebt(nights, 480);
    expect(d.nights).toBe(14);
    expect(d.shortfallMinutes).toBe(7 * 60);
    expect(d.netMinutes).toBe(0); // surplus offsets shortfall
    const short = getSleepDebt(buildNights(dates.flatMap((x) => sleep(x, 138, 36)), dates), 480); // always 7h
    expect(short.netMinutes).toBe(14 * 60);
  });

  it('regularity: identical nights = 100; a wobbling schedule scores lower', () => {
    const steady = buildNights(dates.flatMap((d) => sleep(d)), dates);
    expect(getRegularity(steady).score).toBe(100);
    const wobble = buildNights(dates.flatMap((d, i) => sleep(d, 138 - (i % 2 ? 12 : 0), 42 - (i % 2 ? 12 : 0))), dates);
    const r = getRegularity(wobble);
    expect(r.bedSdMin).toBeCloseTo(60 * Math.sqrt(14 / 13), 1); // sample standard deviation
    expect(r.wakeSdMin).toBeCloseTo(60 * Math.sqrt(14 / 13), 1);
    expect(r.score).toBe(40); // 100 * (1 - (62.3 - 20) / 70)
  });

  it('averages, chronotype and clock parsing', () => {
    const nights = buildNights(dates.flatMap((d) => sleep(d)), dates);
    const a = getAverages(nights);
    expect(a.totalMinutes).toBe(480);
    expect(a.efficiency).toBe(1);
    expect(formatClock(relToClock(a.midpointRel!))).toBe('3:00 AM');
    expect(getChronotype(a.midpointRel)?.type).toBe('intermediate');
    expect(getChronotype(null)).toBeNull();
    expect(parseClockText('07:30:00')).toBe(450);
    expect(parseClockText('nope')).toBeNull();
  });

  it('social jet lag needs 3+ weekday and weekend nights and reports the mid-sleep shift', () => {
    // 3 weeks; weekend wake dates (Sat/Sun) sleep 90 min later
    const ds = Array.from({ length: 21 }, (_, i) => format(addDays(parseISO('2026-09-07'), i), 'yyyy-MM-dd'));
    const blocks = ds.flatMap((d) => {
      const wakeDay = parseISO(nextDay(d)).getDay();
      return wakeDay === 0 || wakeDay === 6 ? sleep(d, 138, 42) : sleep(d, 128, 32); // weekdays 9:20pm-5:20am, weekends 11pm-7am
    });
    const j = getSocialJetLag(buildNights(blocks, ds))!;
    expect(j.minutes).toBe(100);
    expect(getSocialJetLag(buildNights(sleep('2026-09-07'), ['2026-09-07']))).toBeNull();
  });

  it('weekday pattern and streaks', () => {
    const nights = buildNights(dates.flatMap((d) => sleep(d)), dates);
    const wp = getWeekdayPattern(nights);
    expect(wp).toHaveLength(7);
    expect(wp.every((w) => w.avgMinutes === 480)).toBe(true);
    expect(getGoalStreak(nights, 480)).toBe(14);
    const broken = buildNights([...dates.slice(0, 13).flatMap((d) => sleep(d))], dates); // last night missing
    expect(getGoalStreak(broken, 480)).toBe(0);
    expect(getBedtimeStreak(nights, 30)).toBe(14);
  });
});

describe('planTonight', () => {
  it('works back from the wake time', () => {
    const p = planTonight(480, 7 * 60, 20, 15);
    expect(formatClock(p.asleepByClock)).toBe('11:00 PM');
    expect(formatClock(p.inBedClock)).toBe('10:25 PM');
    expect(formatClock(p.windDownClock)).toBe('9:40 PM');
    expect(formatClock(p.wakeClock)).toBe('7:00 AM');
  });
});

describe('factors and insights', () => {
  const ds = Array.from({ length: 12 }, (_, i) => format(addDays(parseISO('2026-09-01'), i), 'yyyy-MM-dd'));

  it('compares nights with and without a factor, only with enough of each', () => {
    const blocks = ds.flatMap((d, i) => sleep(d, 138, i < 6 ? 12 : 42)); // first six shorter (3h..) vs 8h
    const logs = Object.fromEntries(ds.map((d, i) => [d, { quality: i < 6 ? 2 : 4, factors: i < 6 ? ['caffeine_late'] : [] }]));
    const impacts = getFactorImpacts(buildNights(blocks, ds, logs));
    const c = impacts.find((f) => f.factor === 'caffeine_late')!;
    expect([c.withN, c.withoutN]).toEqual([6, 6]);
    expect(c.sleepDelta!).toBeLessThan(0);
    expect(c.qualityDelta).toBe(-2);
    expect(getFactorImpacts(buildNights(blocks.slice(0, 60), ds.slice(0, 3), logs))).toEqual([]);
  });

  it('insights: asks for data first, then flags debt and irregularity with evidence', () => {
    expect(getInsights(buildNights(sleep('2026-09-01'), ['2026-09-01']), 480)[0].id).toBe('need-data');
    const blocks = ds.flatMap((d, i) => sleep(d, 138 - (i % 2 ? 12 : 0), 36 - (i % 2 ? 12 : 0)));
    const ins = getInsights(buildNights(blocks, ds), 480);
    const ids = ins.map((i) => i.id);
    expect(ids).toContain('debt');
    expect(ids).toContain('regularity');
    expect(ins.find((i) => i.id === 'debt')!.detail).toMatch(/last 12 tracked nights/);
  });

  it('formats durations', () => {
    expect([formatDur(0), formatDur(45), formatDur(60), formatDur(95)]).toEqual(['0m', '45m', '1h', '1h 35m']);
  });
});

describe('Sleep Regularity Index', () => {
  const dates = Array.from({ length: 10 }, (_, i) => format(addDays(parseISO('2026-09-07'), i), 'yyyy-MM-dd'));

  it('is 100 for an identical schedule every day', () => {
    const blocks = dates.flatMap((d) => sleep(d));
    const r = getSleepRegularityIndex(blocks, dates);
    expect(r.sri!).toBeGreaterThanOrEqual(97); // not exactly 100: the first tracked day has no preceding morning
    expect(r.pairs).toBeGreaterThanOrEqual(8);
  });

  it('drops when the schedule alternates by 3 hours, and is lower than for a 30 minute wobble', () => {
    const alt = dates.flatMap((d, i) => sleep(d, 138 - (i % 2 ? 18 : 0), 42 - (i % 2 ? 18 : 0)));
    const small = dates.flatMap((d, i) => sleep(d, 138 - (i % 2 ? 3 : 0), 42 - (i % 2 ? 3 : 0)));
    const a = getSleepRegularityIndex(alt, dates).sri!;
    const s = getSleepRegularityIndex(small, dates).sri!;
    expect(a).toBeLessThan(s);
    expect(s).toBeGreaterThan(80);
    expect(a).toBeLessThan(60);
  });

  it('needs at least three comparable day pairs, and ignores days with no tracked sleep', () => {
    expect(getSleepRegularityIndex(sleep('2026-09-07'), dates.slice(0, 3)).sri).toBeNull();
    const gapped = [...sleep('2026-09-07'), ...sleep('2026-09-08')];
    expect(getSleepRegularityIndex(gapped, dates).pairs).toBeLessThan(3);
  });
});

describe('analyzeSleepEffect', () => {
  it('calls a real relationship clear and reports the median gap with an interval', () => {
    const pairs = Array.from({ length: 30 }, (_, i) => {
      const sleepMinutes = 330 + (i % 10) * 20; // 5.5h..8.5h
      return { sleepMinutes, value: 40 + (sleepMinutes - 330) * 0.5 + ((i * 7) % 5) };
    });
    const e = analyzeSleepEffect(pairs, { B: 400 });
    expect(e.verdict).toBe('clear');
    expect(e.association.rho!).toBeGreaterThan(0.8);
    expect(e.diff!.value).toBeLessThan(0);
    expect(e.diff!.hi).toBeLessThan(0);
  });

  it('says "too early" under 10 nights', () => {
    const e = analyzeSleepEffect(Array.from({ length: 6 }, (_, i) => ({ sleepMinutes: 400 + i * 10, value: i })));
    expect(e.verdict).toBe('insufficient');
  });

  it('pure noise is almost never called clear (the old Pearson cut-off fired ~25% of the time at n=10)', () => {
    let seed = 12345;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) | 0) >>> 0) / 4294967296;
    let clear = 0, possible = 0;
    const trials = 150;
    for (let t = 0; t < trials; t++) {
      const pairs = Array.from({ length: 10 }, () => ({ sleepMinutes: 300 + rnd() * 200, value: rnd() * 100 }));
      const v = analyzeSleepEffect(pairs, { B: 150 }).verdict;
      if (v === 'clear') clear++;
      if (v === 'possible') possible++;
    }
    expect(clear / trials).toBeLessThan(0.1);
    expect((clear + possible) / trials).toBeLessThan(0.3);
  });
});
