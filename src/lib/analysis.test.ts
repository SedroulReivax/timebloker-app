import { describe, expect, it } from 'vitest';
import { bucketDailySeries, compareMetric, dailySeries, dailyValues, dayMetricValue, dayVsTypical, deadlineReliability, estimationAccuracy, focusHeatmap, focusRunHistogram, focusSupplementByDate, productivityCurve, profileDays, summarize, type AnalysisInput } from './analysis';
import type { RangeBlock } from './blockRange';

const NOW = new Date(2026, 8, 30, 15, 0); // Wed 30 Sep 2026, 15:00 -> 90 blocks elapsed today
const cats = [{ id: 'w1', category: 'Work' }, { id: 'w2', category: 'Work' }, { id: 'l', category: 'Leisure' }, { id: 'z', category: 'Health' }];
const input = (blocks: RangeBlock[]): AnalysisInput => ({ blocks, activities: cats, sleepIds: new Set(['z']) });
const run = (date: string, from: number, to: number, a: string, task: string | null = null): RangeBlock[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ date_key: date, block_index: from + i, activity_id: a, task_id: task }));
const D = '2026-09-28';
const one = (blocks: RangeBlock[], date = D) => profileDays(input(blocks), [date], { now: NOW })[0];

describe('profileDays: the three focus measures are independent', () => {
  it('4h of uninterrupted work: high quality, all deep, share 100%', () => {
    const p = one(run(D, 54, 77, 'w1'));
    const s = summarize([p]);
    expect(p.assignedBlocks).toBe(24);
    expect(s.focusSharePct).toBe(100);
    expect(s.focusQualityPct!).toBeGreaterThanOrEqual(85); // a 4h run decays a little from vigilance fatigue
    expect(s.deepMinutes).toBe(240);
    expect(s.sustainedSharePct).toBe(100);
    expect(s.longestRunMinutes).toBe(240);
  });

  it('tracking MORE leisure does not change focus quality (it only changes focus share)', () => {
    const base = summarize([one(run(D, 54, 77, 'w1'))]);
    const more = summarize([one([...run(D, 54, 77, 'w1'), ...run(D, 78, 113, 'l')])]);
    expect(Math.abs(more.focusQualityPct! - base.focusQualityPct!)).toBeLessThanOrEqual(2); // the old "consistency" moved 19.8 -> 54.1 here
    expect(more.focusSharePct!).toBeLessThan(base.focusSharePct!);
    expect(more.focusSharePct).toBe(40);
  });

  it('untracked gaps are not distraction: a gap only costs a fresh warm-up, not a penalty for the gap itself', () => {
    const solid = summarize([one(run(D, 54, 77, 'w1'))]);
    const gappy = summarize([one([...run(D, 54, 64, 'w1'), ...run(D, 68, 77, 'w1')])]); // 40 min untracked in the middle
    expect(gappy.focusSharePct).toBe(100);
    expect(solid.focusQualityPct! - gappy.focusQualityPct!).toBeLessThan(8);
  });

  it('sleep is excluded from focus share and from the awake denominator', () => {
    const p = one([...run(D, 0, 41, 'z'), ...run(D, 54, 65, 'w1')]);
    expect(p.sleepBlocks).toBe(42);
    expect(p.awakeBlocks).toBe(12);
    expect(summarize([p]).focusSharePct).toBe(100);
    expect(summarize([p]).coveragePct).toBe(Math.round((54 / 144) * 100));
  });

  it('a fragmented day scores lower quality and shorter runs than a solid day with the same eligible time', () => {
    const solid = summarize([one(run(D, 54, 71, 'w1'))]);
    const alt: RangeBlock[] = Array.from({ length: 18 }, (_, i) => ({ date_key: D, block_index: 54 + i, activity_id: i % 2 ? 'w1' : 'w2' }));
    const choppy = summarize([one(alt)]);
    expect(choppy.focusSharePct).toBe(solid.focusSharePct);
    expect(choppy.focusQualityPct!).toBeLessThan(solid.focusQualityPct! * 0.6);
    expect(choppy.deepMinutes).toBe(0);
    expect(choppy.meanRunMinutes).toBe(10);
    expect(solid.meanRunMinutes).toBe(180);
  });
});

describe('focusSupplementByDate', () => {
  it('matches profileDays exactly for the five focus-model fields, over the given dates', () => {
    const blocks = run(D, 54, 77, 'w1');
    const p = one(blocks);
    const supp = focusSupplementByDate(input(blocks), [D], { now: NOW });
    const s = supp.get(D)!;
    expect(s.depthSum).toBe(p.depthSum);
    expect(s.deepBlocks).toBe(p.deepBlocks);
    expect(s.eligibleBlocks).toBe(p.eligibleBlocks);
    expect(s.longestEligibleRun).toBe(p.longestEligibleRun);
    expect(s.runs).toEqual(p.runs);
  });

  it('has no entry for a date outside the requested range', () => {
    const supp = focusSupplementByDate(input(run(D, 54, 77, 'w1')), [D], { now: NOW });
    expect(supp.has('2026-09-29')).toBe(false);
  });
});

describe('productivity multiplier', () => {
  const withMult = [
    { id: 'w1', category: 'Work', productivity_multiplier: 2 },
    { id: 'l', category: 'Leisure', productivity_multiplier: -1 },
    { id: 'z', category: 'Health' }, // no multiplier set -> neutral (0)
  ];
  const oneM = (blocks: RangeBlock[]) => profileDays({ blocks, activities: withMult, sleepIds: new Set(['z']) }, [D], { now: NOW })[0];

  it('weights tracked minutes by each activity\'s own multiplier, average and total', () => {
    const p = oneM(run(D, 54, 77, 'w1')); // 24 blocks at x2
    const s = summarize([p]);
    expect(s.productivityScore).toBe(2);
    expect(s.productivityPoints).toBe(24 * 10 * 2);
  });

  it('supports a negative multiplier that pulls the score below zero', () => {
    const p = oneM(run(D, 54, 65, 'l')); // 12 blocks at x-1
    const s = summarize([p]);
    expect(s.productivityScore).toBe(-1);
    expect(s.productivityPoints).toBeLessThan(0);
  });

  it('mixed positive and negative time can net to zero even though both are tracked', () => {
    const p = oneM([...run(D, 54, 65, 'w1'), ...run(D, 66, 89, 'l')]); // 12 at x2, 24 at x-1
    const s = summarize([p]);
    expect(s.productivityScore).toBe(0); // (12*2 + 24*-1) / 36 = 0
  });

  it('an awake activity with no multiplier set counts as neutral, diluting the average toward zero', () => {
    const acts = [...withMult, { id: 'n', category: 'Other' }];
    const rated = summarize([oneM(run(D, 54, 65, 'w1'))]); // 12 blocks x2 -> score 2
    const diluted = summarize([profileDays({ blocks: [...run(D, 54, 65, 'w1'), ...run(D, 66, 77, 'n')], activities: acts, sleepIds: new Set(['z']) }, [D], { now: NOW })[0]]);
    expect(rated.productivityScore).toBe(2);
    expect(diluted.productivityScore).toBe(1); // (12*2 + 12*0) / 24
  });

  it('sleep never dilutes the score: it is tracked, but not judged', () => {
    const rated = summarize([oneM(run(D, 54, 65, 'w1'))]);
    const withSleep = summarize([oneM([...run(D, 54, 65, 'w1'), ...run(D, 0, 41, 'z')])]); // + 42 sleep blocks
    expect(withSleep.productivityScore).toBe(rated.productivityScore);
    expect(withSleep.coveragePct!).toBeGreaterThan(rated.coveragePct!);
  });
});

describe('ignored activities and waste', () => {
  const acts = [
    { id: 'w1', category: 'Work', productivity_multiplier: 1 },
    { id: 'yt', category: 'Leisure', productivity_multiplier: -0.35 },
    { id: 'tr', category: 'Other', productivity_multiplier: -1, analysis_ignored: true }, // travel: ignored wins over its multiplier
    { id: 'z', category: 'Health' },
  ];
  const oneI = (blocks: RangeBlock[]) => profileDays({ blocks, activities: acts, sleepIds: new Set(['z']) }, [D], { now: NOW })[0];

  it('ignored time is tracked (coverage) but not awake, not focus, not productivity, not waste', () => {
    const base = oneI(run(D, 54, 65, 'w1'));
    const p = oneI([...run(D, 54, 65, 'w1'), ...run(D, 66, 77, 'tr')]);
    expect(p.ignoredBlocks).toBe(12);
    expect(p.assignedBlocks).toBe(24);
    expect(p.awakeBlocks).toBe(12);
    expect(p.wasteBlocks).toBe(0);
    const s = summarize([p]);
    expect(s.productivityScore).toBe(summarize([base]).productivityScore);
    expect(s.focusSharePct).toBe(100);
    expect(s.ignoredMinutes).toBe(120);
    expect(p.scores[70]).toBeNull(); // unobserved for the focus model
  });

  it('a negative decimal multiplier is waste, costed by its size', () => {
    const p = oneI([...run(D, 54, 65, 'w1'), ...run(D, 66, 71, 'yt')]);
    expect(p.wasteBlocks).toBe(6);
    expect(p.wasteCost).toBeCloseTo(6 * 0.35);
    const s = summarize([p]);
    expect(s.wasteMinutes).toBe(60);
    expect(s.wasteSharePct).toBe(Math.round((6 / 18) * 100));
    expect(s.wastePoints).toBeCloseTo(21);
    expect(dailyValues([p], 'waste')).toEqual([60]);
    expect(dailySeries([p])[0].wasteMinutes).toBe(60);
  });

  it('a day with only sleep and ignored time has no waste value at all (not zero)', () => {
    const p = oneI([...run(D, 0, 41, 'z'), ...run(D, 60, 70, 'tr')]);
    expect(dailyValues([p], 'waste')).toEqual([]);
    expect(dailySeries([p])[0].wasteMinutes).toBeNull();
  });
});

describe('switching', () => {
  it('sees switches between two activities of the same category, and separates cross-category ones', () => {
    const p = one([...run(D, 54, 56, 'w1'), ...run(D, 57, 59, 'w2'), ...run(D, 60, 62, 'l')]);
    expect(p.switches).toBe(2);
    expect(p.crossSwitches).toBe(1);
    expect(summarize([p]).switchesPerHour!).toBeCloseTo(2 / (90 / 60));
  });

  it('a 30+ minute untracked gap breaks the chain instead of counting a switch', () => {
    const p = one([...run(D, 54, 56, 'w1'), ...run(D, 60, 62, 'w2')]); // 3 blocks untracked between
    expect(p.switches).toBe(0);
    const close = one([...run(D, 54, 56, 'w1'), ...run(D, 58, 60, 'w2')]); // 1 block gap
    expect(close.switches).toBe(1);
  });

  it('picking the same activity back up after a short gap is not a switch', () => {
    const p = one([...run(D, 54, 56, 'w1'), ...run(D, 58, 60, 'w1')]); // 1 block gap, same activity
    expect(p.switches).toBe(0);
    const withOther = one([...run(D, 54, 56, 'w1'), ...run(D, 58, 60, 'w1'), ...run(D, 61, 63, 'l')]);
    expect(withOther.switches).toBe(1); // w1 -> l only
  });
});

describe('days and comparisons', () => {
  it('today is incomplete and counts only elapsed blocks; the future is empty', () => {
    const [today, future, past] = profileDays(input([...run('2026-09-30', 10, 20, 'w1'), ...run('2026-09-30', 120, 130, 'w1')]), ['2026-09-30', '2026-10-05', D], { now: NOW });
    expect(today.complete).toBe(false);
    expect(today.elapsedBlocks).toBe(90);
    expect(today.assignedBlocks).toBe(11); // blocks after "now" are not tracked time
    expect(future.elapsedBlocks).toBe(0);
    expect(past.complete).toBe(true);
  });

  it('dailyValues skips today and empty days (a logging gap is not a zero)', () => {
    const profiles = profileDays(input([...run('2026-09-27', 54, 65, 'w1'), ...run('2026-09-30', 54, 65, 'w1')]), ['2026-09-26', '2026-09-27', '2026-09-30'], { now: NOW });
    expect(dailyValues(profiles, 'tracked')).toEqual([120]);
  });

  it('compareMetric reports a real improvement and stays flat when there is too little data', () => {
    const days = (start: number, blocksPerDay: number) => Array.from({ length: 10 }, (_, i) => `2026-09-${String(start + i).padStart(2, '0')}`).flatMap((d) => run(d, 54, 54 + blocksPerDay - 1, 'w1'));
    const keys = (start: number) => Array.from({ length: 10 }, (_, i) => `2026-09-${String(start + i).padStart(2, '0')}`);
    const prev = profileDays(input(days(1, 8)), keys(1), { now: NOW });
    const cur = profileDays(input(days(11, 14)), keys(11), { now: NOW });
    expect(compareMetric(cur, prev, 'eligible').direction).toBe('up');
    expect(compareMetric(cur.slice(0, 2), prev.slice(0, 2), 'eligible').direction).toBe('flat');
  });
});

describe('focusHeatmap', () => {
  it('hides thin cells (null) and shrinks a lucky cell toward the baseline', () => {
    const blocks: RangeBlock[] = [];
    const keys: string[] = [];
    for (let d = 1; d <= 28; d++) {
      const k = `2026-09-${String(d).padStart(2, '0')}`;
      keys.push(k);
      blocks.push(...run(k, 54, 65, 'w1')); // 9-11 every day
      blocks.push(...run(k, 84, 89, 'l'));
    }
    const profiles = profileDays(input(blocks), keys, { now: NOW });
    const { cells, baseline } = focusHeatmap(profiles, { now: NOW });
    expect(cells).toHaveLength(7);
    expect(cells[1][3].value).toBeNull(); // 3 AM: never observed
    expect(cells[1][9].value!).toBeGreaterThan(baseline);
    expect(cells[1][14].value!).toBeLessThan(baseline); // leisure hour
    // one lucky observation
    const lucky = profileDays(input([...blocks.slice(0, 0), ...run('2026-09-29', 78, 80, 'w1')]), ['2026-09-29'], { now: NOW });
    const single = focusHeatmap(lucky, { now: NOW, minBlocks: 3 });
    expect(single.cells[2][13].value!).toBeLessThanOrEqual(100);
  });
});

describe('estimationAccuracy', () => {
  const t = (id: string, est: number, tracked: number, group = 'g', completed = true) => ({ id, completed, estimatedMinutes: est, trackedMinutes: tracked, group });

  it('one huge accurate task no longer hides that typical tasks run 3x over', () => {
    const tasks = [t('big', 600, 600), ...Array.from({ length: 6 }, (_, i) => t(`s${i}`, 30, 90))];
    const { overall } = estimationAccuracy(tasks);
    expect(overall!.n).toBe(7);
    expect(overall!.multiplier!).toBeGreaterThan(2.4); // the old ratio-of-sums said +46% (x1.46)
    expect(overall!.medianRatio).toBe(3);
    expect(overall!.overPct).toBe(86);
    expect(overall!.lo!).toBeGreaterThan(1);
  });

  it('ignores open tasks, tasks with no estimate and trivial tracked time', () => {
    const { overall } = estimationAccuracy([t('a', 60, 60), t('b', 60, 90, 'g', false), t('c', 0, 60), t('d', 60, 5)]);
    expect(overall!.n).toBe(1);
  });

  it('groups and empty input', () => {
    const r = estimationAccuracy([t('a', 60, 120, 'Work'), t('b', 60, 30, 'Health'), t('c', 60, 120, 'Work')]);
    expect(r.groups.map((g) => g.label)).toEqual(['Work', 'Health']);
    expect(estimationAccuracy([]).overall).toBeNull();
  });
});

describe('deadlineReliability', () => {
  it('uses a Wilson interval and reports how late late tasks are', () => {
    const at = (h: number) => new Date(2026, 8, 20, h);
    const r = deadlineReliability([
      { dueAt: at(12), doneAt: at(10) }, { dueAt: at(12), doneAt: at(11) }, { dueAt: at(12), doneAt: at(15) }, { dueAt: at(12), doneAt: at(12) },
    ]);
    expect(r.pctOnTime).toBe(75);
    expect(r.lo!).toBeLessThan(75);
    expect(r.hi!).toBeGreaterThan(75);
    expect(r.medianLateHours).toBe(3);
    expect(deadlineReliability([]).pctOnTime).toBeNull();
  });
});

describe('dailySeries', () => {
  it('skips pure-future days but keeps a partial today and zero-tracking days, one point per day', () => {
    const profiles = profileDays(input([...run('2026-09-28', 54, 65, 'w1')]), ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-05'], { now: NOW });
    const series = dailySeries(profiles);
    expect(series.map((p) => p.dateKey)).toEqual(['2026-09-28', '2026-09-29', '2026-09-30']); // 10-05 is pure future
    expect(series[0].trackedMinutes).toBe(120);
    expect(series[1].trackedMinutes).toBe(0); // logging gap, not future
  });

  it('nulls out quality, productivity and switches on days too thin to measure them', () => {
    const p = profileDays(input(run(D, 54, 55, 'w1')), [D], { now: NOW })[0]; // 2 tracked blocks only
    const [point] = dailySeries([p]);
    expect(point.focusQualityPct).toBeNull(); // under 3 eligible blocks
    expect(point.switchesPerHour).toBeNull(); // under 6 awake blocks
    expect(point.productivityScore).not.toBeNull(); // any assigned time is enough
  });

  it('carries the productivity multiplier through to the daily point', () => {
    const withMult = [{ id: 'w1', category: 'Work', productivity_multiplier: 1.5 }];
    const p = profileDays({ blocks: run(D, 54, 77, 'w1'), activities: withMult, sleepIds: new Set() }, [D], { now: NOW })[0];
    expect(dailySeries([p])[0].productivityScore).toBe(1.5);
  });
});

describe('bucketDailySeries', () => {
  it('passes days through unchanged (labelled) when not weekly', () => {
    const profiles = profileDays(input(run('2026-09-28', 54, 65, 'w1')), ['2026-09-28'], { now: NOW });
    const [point] = bucketDailySeries(dailySeries(profiles), false);
    expect(point.label).toBe('28 Sep');
    expect(point.trackedMinutes).toBe(120);
  });

  it('averages days within the same ISO week, nulling a metric only when every day in the bucket lacks it', () => {
    const blocks = [...run('2026-09-21', 54, 65, 'w1'), ...run('2026-09-22', 54, 89, 'w1')]; // Mon 12 blocks, Tue 36 blocks, same week
    const profiles = profileDays(input(blocks), ['2026-09-21', '2026-09-22'], { now: NOW });
    const [point] = bucketDailySeries(dailySeries(profiles), true);
    expect(point.trackedMinutes).toBe((120 + 360) / 2);
    expect(point.focusQualityPct).not.toBeNull(); // Tuesday has >=3 eligible blocks
  });
});

describe('focusRunHistogram', () => {
  it('assigns focus time to the length of the run it belongs to', () => {
    const blocks = [...run(D, 10, 11, 'w1'), ...run(D, 30, 33, 'w1'), ...run(D, 60, 83, 'w2')]; // 20 min, 40 min, 4 hours
    const { buckets, totalMinutes } = focusRunHistogram([one(blocks)]);
    expect(totalMinutes).toBe(20 + 40 + 240);
    expect(buckets[0].minutes).toBe(20);
    expect(buckets[1].minutes).toBe(40);
    expect(buckets[4].minutes).toBe(240);
    expect(buckets.reduce((s, b) => s + b.sharePct, 0)).toBeGreaterThanOrEqual(99);
  });

  it('ignores non-focus runs and handles no data', () => {
    expect(focusRunHistogram([one(run(D, 10, 30, 'l'))]).totalMinutes).toBe(0);
    expect(focusRunHistogram([]).buckets.every((b) => b.minutes === 0)).toBe(true);
  });
});

describe('a single day against your typical day', () => {
  const keys = Array.from({ length: 14 }, (_, i) => `2026-09-${String(10 + i).padStart(2, '0')}`); // 10..23 Sep
  // tracked 2h on most days, 1h on some
  const hist = keys.flatMap((k, i) => run(k, 54, 54 + (i % 3 === 0 ? 5 : 11), 'w1'));
  const all = (extra: RangeBlock[]) => profileDays(input([...hist, ...extra]), [...keys, '2026-09-24'], { now: NOW });

  it('says above / within / below your 25th-75th percentile range', () => {
    const above = all(run('2026-09-24', 54, 83, 'w1')); // 5h
    const r = dayVsTypical(above[above.length - 1], above, 'tracked');
    expect(r.n).toBe(14);
    expect(r.position).toBe('above');
    const within = all(run('2026-09-24', 54, 65, 'w1'));
    expect(dayVsTypical(within[within.length - 1], within, 'tracked').position).toBe('within');
    const below = all(run('2026-09-24', 54, 55, 'w1'));
    expect(dayVsTypical(below[below.length - 1], below, 'tracked').position).toBe('below');
  });

  it('needs 7 past days', () => {
    const few = profileDays(input([...run('2026-09-20', 54, 60, 'w1'), ...run('2026-09-24', 54, 60, 'w1')]), ['2026-09-20', '2026-09-24'], { now: NOW });
    expect(dayVsTypical(few[1], few, 'tracked').position).toBe('insufficient');
  });

  it('cutoffBlocks compares today so far with past days cut at the same hour', () => {
    const cut = profileDays(input(run(D, 54, 100, 'w1')), [D], { now: NOW, cutoffBlocks: 60 })[0];
    expect(cut.elapsedBlocks).toBe(60);
    expect(cut.assignedBlocks).toBe(6);
    expect(dayMetricValue(cut, 'coverage')).toBe(10);
  });
});

describe('productivityCurve: the focus curve from your multipliers', () => {
  const acts = [
    { id: 'w', category: 'Work', productivity_multiplier: 1 },
    { id: 'yt', category: 'Leisure', productivity_multiplier: -0.5 },
    { id: 'none', category: 'Other' },
    { id: 'tr', category: 'Other', productivity_multiplier: 2, analysis_ignored: true },
    { id: 'z', category: 'Health', productivity_multiplier: 3 },
  ];
  const curve = (blocks: RangeBlock[], days = [D]) => productivityCurve({ blocks, activities: acts, sleepIds: new Set(['z']) }, days, { now: NOW });

  it('averages the multipliers in each half hour and leaves empty half hours null', () => {
    const c = curve([...run(D, 54, 56, 'w'), ...run(D, 57, 57, 'yt'), ...run(D, 58, 59, 'w')]); // 09:00-09:30 work, 09:30-10:00 one blip of YouTube
    expect(c).toHaveLength(48);
    expect(c[18]).toEqual({ slot: 18, value: 1, minutes: 30, pointsPerDay: 30 });
    expect(c[19].value).toBeCloseTo((-0.5 + 1 + 1) / 3, 2);
    expect(c[0].value).toBeNull();
  });

  it('leaves out sleep and ignored activities, and counts no multiplier as 0', () => {
    const c = curve([...run(D, 0, 2, 'z'), ...run(D, 3, 5, 'tr'), ...run(D, 6, 8, 'none')]);
    expect(c[0].value).toBeNull();
    expect(c[1].value).toBeNull();
    expect(c[2]).toEqual({ slot: 2, value: 0, minutes: 30, pointsPerDay: 0 });
  });

  it('averages over several days and ignores the future part of today', () => {
    const today = '2026-09-30';
    const c = curve([...run(D, 54, 56, 'w'), ...run('2026-09-29', 54, 56, 'yt'), ...run(today, 96, 98, 'w')], [D, '2026-09-29', today]);
    expect(c[18]).toEqual({ slot: 18, value: 0.25, minutes: 60, pointsPerDay: 7.5 }); // (+30 - 15) / 2 judged days
    expect(c[32].value).toBeNull(); // 16:00 today has not happened yet at 15:00
  });

  it('points grow with volume where the average multiplier does not', () => {
    const c = curve([...run(D, 54, 56, 'w'), ...run(D, 60, 60, 'w')]); // 30 min at 1x vs 10 min at 1x
    expect(c[18].value).toBe(1);
    expect(c[20].value).toBe(1);
    expect(c[18].pointsPerDay).toBe(30);
    expect(c[20].pointsPerDay).toBe(10);
  });
});
