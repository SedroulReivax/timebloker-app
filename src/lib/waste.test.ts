import { describe, expect, it } from 'vitest';
import { analyzeWaste, CONTEXT_GAP, CONTEXT_START, CONTEXT_WAKE } from './waste';
import type { RangeBlock } from './blockRange';

const NOW = new Date(2026, 8, 30, 23, 59);
const acts = [
  { id: 'code', name: 'Coding', color: '#3b82f6', productivity_multiplier: 1 },
  { id: 'mail', name: 'Email', color: '#aaaaaa', productivity_multiplier: 0 },
  { id: 'yt', name: 'YouTube', color: '#ef4444', productivity_multiplier: -0.35 },
  { id: 'ig', name: 'Instagram', color: '#ec4899', productivity_multiplier: -1 },
  { id: 'tr', name: 'Travel', color: '#999999', productivity_multiplier: -1, analysis_ignored: true },
  { id: 'z', name: 'Sleep', color: '#333333' },
];
const run = (date: string, from: number, to: number, a: string): RangeBlock[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ date_key: date, block_index: from + i, activity_id: a }));
const waste = (blocks: RangeBlock[], keys: string[], weekly = false) =>
  analyzeWaste({ blocks, activities: acts, sleepIds: new Set(['z']) }, keys, { now: NOW, weekly });
const D = '2026-09-28';

describe('analyzeWaste', () => {
  it('counts negative decimal multipliers as waste, costed by size; ignored activities never count', () => {
    const w = waste([...run(D, 54, 59, 'yt'), ...run(D, 60, 65, 'tr'), ...run(D, 66, 71, 'code')], [D]);
    expect(w.hasWasteActivities).toBe(true);
    expect(w.totalMinutes).toBe(60);
    expect(w.rows.map((r) => r.id)).toEqual(['yt']);
    expect(w.rows[0].cost).toBeCloseTo(21);
  });

  it('a stretch runs across different waste activities and one untracked block', () => {
    const w = waste([...run(D, 60, 62, 'yt'), ...run(D, 64, 66, 'ig')], [D]);
    expect(w.stretches).toHaveLength(1);
    expect(w.stretches[0].minutes).toBe(60);
    expect(w.stretches[0].activityIds.sort()).toEqual(['ig', 'yt']);
    expect(w.rows.find((r) => r.id === 'yt')!.stretches).toBe(1);
  });

  it('knows what led into waste: an activity, waking up, an untracked gap, or the start of the tracked day', () => {
    const days = ['2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27'];
    const blocks = [
      ...run(days[0], 54, 59, 'mail'), ...run(days[0], 60, 62, 'yt'), // mail -> yt
      ...run(days[1], 0, 41, 'z'), ...run(days[1], 45, 47, 'yt'), // wake (30 min untracked) -> yt
      ...run(days[2], 54, 59, 'code'), ...run(days[2], 70, 72, 'yt'), // 100 min untracked gap
      ...run(days[3], 60, 62, 'yt'), // nothing before
    ];
    const w = waste(blocks, days);
    const led = Object.fromEntries(w.stretches.map((s) => [s.dateKey, s.ledBy]));
    expect(led).toEqual({ [days[0]]: 'mail', [days[1]]: CONTEXT_WAKE, [days[2]]: CONTEXT_GAP, [days[3]]: CONTEXT_START });
  });

  it('trigger rate is the share of that activity\'s runs followed by waste, not a raw count', () => {
    const days = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'];
    // email is followed by YouTube on 1 of 4 days
    const blocks = days.flatMap((d, i) => [...run(d, 54, 56, 'mail'), ...(i === 0 ? run(d, 57, 59, 'yt') : run(d, 57, 60, 'code'))]);
    const t = waste(blocks, days).triggers.find((x) => x.id === 'mail')!;
    expect(t.count).toBe(1);
    expect(t.runs).toBe(4);
    expect(t.ratePct).toBe(25);
    expect(t.lo!).toBeLessThan(25);
    expect(t.hi!).toBeGreaterThan(25);
  });

  it('travel (ignored) can still lead into waste, with its own rate', () => {
    const w = waste([...run(D, 54, 59, 'tr'), ...run(D, 60, 62, 'yt')], [D]);
    const t = w.triggers.find((x) => x.id === 'tr')!;
    expect(t.name).toBe('Travel');
    expect(t.ratePct).toBe(100);
  });

  it('measures the return to productive work, and stretches with no return', () => {
    const days = ['2026-09-25', '2026-09-26'];
    const blocks = [
      ...run(days[0], 60, 62, 'yt'), ...run(days[0], 63, 64, 'mail'), ...run(days[0], 65, 70, 'code'), // back after 20 min of email
      ...run(days[1], 120, 125, 'ig'), // never returns
    ];
    const w = waste(blocks, days);
    expect(w.medianReturnMinutes).toBe(20);
    expect(w.noReturnPct).toBe(50);
    expect(w.longest[0].minutes).toBe(60);
  });

  it('only days with judged tracking are in the denominator; weekday means use them', () => {
    const blocks = [...run('2026-09-28', 60, 62, 'yt'), ...run('2026-09-21', 60, 65, 'code'), ...run('2026-09-22', 0, 40, 'z')];
    const w = waste(blocks, ['2026-09-21', '2026-09-22', '2026-09-28']);
    expect(w.days).toBe(2); // the sleep-only day is not judged
    expect(w.byWeekday[1]).toEqual({ weekday: 1, minutes: 15, days: 2 }); // Mondays: 0 and 30 min
    const pct = w.bySlot[20].yt;
    expect(pct).toBeCloseTo(50);
  });

  it('with no negative multipliers it says so', () => {
    const w = analyzeWaste({ blocks: run(D, 60, 70, 'code'), activities: [acts[0]], sleepIds: new Set() }, [D], { now: NOW });
    expect(w.hasWasteActivities).toBe(false);
    expect(w.totalMinutes).toBe(0);
  });
});

describe('what led into waste: gap and attribution rules', () => {
  it('a long untracked stretch after waking is a gap, not "first thing after waking"', () => {
    const d = '2026-09-25';
    const w = waste([...run(d, 0, 41, 'z'), ...run(d, 66, 68, 'yt')], [d]); // wake 7:00, waste at 11:00
    expect(w.stretches[0].ledBy).toBe(CONTEXT_GAP);
  });

  it('only the activity right before waste counts as followed by it (code -> mail -> waste credits mail)', () => {
    const d = '2026-09-25';
    const w = waste([
      ...run(d, 54, 56, 'code'), ...run(d, 57, 57, 'mail'), ...run(d, 58, 60, 'yt'), // code -> mail -> yt
      ...run(d, 80, 82, 'code'), ...run(d, 83, 85, 'yt'), // code -> yt
    ], [d]);
    const code = w.triggers.find((t) => t.id === 'code')!;
    expect(code.runs).toBe(2);
    expect(code.ratePct).toBe(50);
    expect(w.triggers.find((t) => t.id === 'mail')!.ratePct).toBe(100);
  });
});
