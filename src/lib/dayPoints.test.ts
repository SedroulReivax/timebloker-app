import { describe, expect, it } from 'vitest';
import { dayPoints, typicalCumulativePoints } from './dayPoints';
import { profileDays, summarize } from './analysis';
import type { RangeBlock } from './blockRange';

const NOW = new Date(2026, 8, 30, 15, 0); // Wed 30 Sep 2026, 15:00 -> 90 blocks elapsed today
const D = '2026-09-28';
const activities = [
  { id: 'code', productivity_multiplier: 2 },
  { id: 'read', productivity_multiplier: 0.5 },
  { id: 'scroll', productivity_multiplier: -1 },
  { id: 'meal', productivity_multiplier: null },
  { id: 'tv', productivity_multiplier: 3, analysis_ignored: true },
  { id: 'sleep', productivity_multiplier: 4 },
];
const sleepIds = new Set(['sleep']);
const run = (date: string, from: number, to: number, a: string): RangeBlock[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ date_key: date, block_index: from + i, activity_id: a }));
const input = (blocks: RangeBlock[]) => ({ blocks, activities, sleepIds });

describe('dayPoints', () => {
  it('splits the day into half hours with the activities behind each and a running total', () => {
    // 09:00-10:00 code (2 slots × 3 blocks × 20 = 60 each), 10:00-10:20 scroll, 10:20-10:30 read
    const d = dayPoints(input([...run(D, 54, 59, 'code'), ...run(D, 60, 61, 'scroll'), ...run(D, 62, 62, 'read')]), D, { now: NOW });
    expect(d.slots).toHaveLength(48);
    expect(d.slots[18]).toMatchObject({ points: 60, gained: 60, lost: 0, minutes: 30, cumulative: 60 });
    expect(d.slots[19].cumulative).toBe(120);
    expect(d.slots[20]).toMatchObject({ points: -15, gained: 5, lost: -20, minutes: 30, cumulative: 105 });
    expect(d.slots[20].activities).toEqual([{ id: 'scroll', minutes: 20, points: -20 }, { id: 'read', minutes: 10, points: 5 }]);
    expect(d.slots[47].cumulative).toBe(105); // a finished day carries the total to midnight
    expect(d.total).toBe(105);
    expect(d.gained).toBe(125);
    expect(d.lost).toBe(-20);
    expect(d.countedMinutes).toBe(90);
    expect(d.best?.slot).toBe(18);
    expect(d.worst?.slot).toBe(20);
    expect(d.byActivity.map((a) => [a.id, a.minutes, a.points])).toEqual([['code', 60, 120], ['scroll', 20, -20], ['read', 10, 5]]);
  });

  it('leaves out sleep and ignored time, counts no-multiplier time as 0 points, and matches the day profile', () => {
    const blocks = [...run(D, 0, 35, 'sleep'), ...run(D, 36, 38, 'tv'), ...run(D, 39, 41, 'meal'), ...run(D, 42, 47, 'code')];
    const d = dayPoints(input(blocks), D, { now: NOW });
    expect(d.slots[12].minutes).toBe(0); // tv
    expect(d.slots[13]).toMatchObject({ points: 0, minutes: 30, activities: [{ id: 'meal', minutes: 30, points: 0 }] });
    expect(d.total).toBe(120);
    expect(d.countedMinutes).toBe(90);
    const profile = profileDays({ blocks, activities, sleepIds }, [D], { now: NOW });
    expect(summarize(profile).productivityPoints).toBe(d.total);
  });

  it('stops the running total at the current half hour today and ignores other days', () => {
    const today = '2026-09-30';
    const d = dayPoints(input([...run(today, 84, 95, 'code'), ...run(D, 0, 5, 'code')]), today, { now: NOW });
    // 15:00 -> blocks 84-89 count, the slot holding block 89 (slot 29) is the last with a running total
    expect(d.total).toBe(120);
    expect(d.slots[29].cumulative).toBe(120);
    expect(d.slots[30].cumulative).toBeNull();
    expect(d.slots[0].minutes).toBe(0);
  });

  it('has no best or worst on an empty day, and no worst when every half hour scored the same', () => {
    expect(dayPoints(input([]), D, { now: NOW })).toMatchObject({ total: 0, best: null, worst: null, byActivity: [] });
    const flat = dayPoints(input([...run(D, 54, 56, 'code'), ...run(D, 60, 62, 'code')]), D, { now: NOW });
    expect(flat.best?.points).toBe(60);
    expect(flat.worst).toBeNull();
  });
});

describe('typicalCumulativePoints', () => {
  it('takes the median running total across counted days, cut at the same time', () => {
    const days = ['2026-09-25', '2026-09-26', '2026-09-27'];
    const blocks = [
      ...run(days[0], 0, 2, 'code'), // +60 in slot 0
      ...run(days[1], 0, 2, 'read'), // +15 in slot 0
      ...run(days[2], 0, 2, 'scroll'), ...run(days[2], 3, 5, 'code'), // -30 then +60
    ];
    const t = typicalCumulativePoints(input(blocks), days, { now: NOW, cutoffBlocks: 6 });
    expect(t[0]).toBe(15); // median of 60, 15, -30
    expect(t[1]).toBe(30); // median of 60, 15, 30
    expect(t[2]).toBeNull(); // past the cutoff
  });

  it('is all null with no counted days', () => {
    expect(typicalCumulativePoints(input(run('2026-09-25', 0, 5, 'sleep')), ['2026-09-25'], { now: NOW }).every((v) => v === null)).toBe(true);
  });
});
