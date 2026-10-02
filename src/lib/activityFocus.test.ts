import { describe, expect, it } from 'vitest';
import { activityFocus, findRuns, peakSlotShare, TIMER_ID } from './activityFocus';
import { axisMinutes, coreWindow } from './timeOfDay';
import type { RangeBlock } from './blockRange';

const NOW = new Date(2026, 8, 30, 23, 59);
const acts = [
  { id: 'code', name: 'Coding', color: '#3b82f6' },
  { id: 'read', name: 'Reading', color: '#22c55e' },
  { id: 'tr', name: 'Travel', color: '#999999', analysis_ignored: true },
  { id: 'z', name: 'Sleep', color: '#333333' },
];
const run = (date: string, from: number, to: number, a: string): RangeBlock[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ date_key: date, block_index: from + i, activity_id: a }));
const input = (blocks: RangeBlock[], sessions: { started_at: string; duration_minutes: number }[] = []) =>
  ({ blocks, activities: acts, sleepIds: new Set(['z']), sessions });
const D = '2026-09-28';

describe('findRuns', () => {
  it('tolerates a single blip but does not count it', () => {
    const day: (string | null)[] = new Array(144).fill(null);
    [60, 61, 63, 64].forEach((i) => (day[i] = 'a'));
    day[62] = 'b';
    const runs = findRuns(day);
    expect(runs[0]).toEqual({ activityId: 'a', startIdx: 60, endIdx: 64, blocks: 4 });
  });

  it('two blocks of something else end the run', () => {
    const day: (string | null)[] = new Array(144).fill(null);
    [60, 61, 64, 65].forEach((i) => (day[i] = 'a'));
    day[62] = 'b'; day[63] = 'b';
    expect(findRuns(day).filter((r) => r.activityId === 'a').map((r) => r.blocks)).toEqual([2, 2]);
  });
});

describe('activityFocus', () => {
  it('a 20-minute stretch is not focus; 30 minutes is', () => {
    const r = activityFocus(input([...run(D, 60, 61, 'read'), ...run(D, 70, 72, 'code')]), [D], { now: NOW });
    expect(r.rows.map((x) => x.id)).toEqual(['code']);
    expect(r.rows[0].focusedMinutes).toBe(30);
  });

  it('a 40-minute stretch with one blip counts 30 focused minutes, not 40', () => {
    const blocks = [...run(D, 60, 61, 'code'), ...run(D, 62, 62, 'read'), ...run(D, 63, 63, 'code')];
    const r = activityFocus(input(blocks), [D], { now: NOW });
    const code = r.rows.find((x) => x.id === 'code')!;
    expect(code.focusedMinutes).toBe(30);
    expect(code.runs).toBe(1);
    expect(code.longestRunMinutes).toBe(30);
    expect(r.rows.find((x) => x.id === 'read')).toBeUndefined();
  });

  it('focus rate is focused time over all time on the activity', () => {
    const blocks = [...run(D, 60, 65, 'code'), ...run(D, 80, 80, 'code')]; // 60 focused + 10 scattered
    const code = activityFocus(input(blocks), [D], { now: NOW }).rows[0];
    expect(code.totalMinutes).toBe(70);
    expect(code.focusRatePct).toBe(86);
  });

  it('ignored and sleep activities never appear, and break runs like a gap', () => {
    const blocks = [...run(D, 0, 40, 'z'), ...run(D, 50, 60, 'tr'), ...run(D, 61, 62, 'code'), ...run(D, 63, 64, 'tr'), ...run(D, 65, 66, 'code')];
    const r = activityFocus(input(blocks), [D], { now: NOW });
    expect(r.rows).toHaveLength(0); // 2 + 2 blocks of code with a 20-min travel gap: never 30 min unbroken
  });

  it('finds the core window on a constructed week and reports the honest % of days', () => {
    const keys = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28'];
    // coding 9:00-11:00 on 6 of 8 days; the other 2 days only have untracked time... plus 1 day of reading tracked
    const blocks = keys.slice(0, 6).flatMap((k) => run(k, 54, 65, 'code'));
    blocks.push(...run(keys[6], 120, 125, 'read'));
    const r = activityFocus(input(blocks), keys, { now: NOW });
    expect(r.days).toBe(7); // the fully untracked day is not in the denominator
    const code = r.rows[0];
    expect(code.core).toEqual({ startMin: 540, endMin: 600, sharePct: 50 });
    expect(code.span80!.endMin - code.span80!.startMin).toBe(120);
    expect(code.focusedDays).toBe(6);
    expect(peakSlotShare(code, r.days)!.pct).toBe(86); // 6 of 7 observed days
    const nine = r.bySlot[18];
    expect(nine.code).toBeCloseTo((6 * 30) / (7 * 30) * 100, 0);
  });

  it('the stacked share never exceeds 100%, and topN folds the rest into Other', () => {
    const many = ['a1', 'a2', 'a3', 'a4'].map((id) => ({ id, name: id, color: '#000' }));
    const blocks = ['a1', 'a2', 'a3', 'a4'].flatMap((id, i) => run(D, 54 + i * 3, 56 + i * 3, id));
    const r = activityFocus({ blocks, activities: many, sleepIds: new Set() }, [D], { now: NOW, topN: 2 });
    expect(r.chartIds).toEqual(['a1', 'a2', '__other__']);
    for (const p of r.bySlot) expect(r.chartIds.reduce((s, id) => s + p[id], 0)).toBeLessThanOrEqual(100.0001);
    expect(r.series[0].__other__).toBe(60);
  });

  it('a timer session over an unpainted stretch counts as Focus timer', () => {
    const started = new Date(2026, 8, 28, 20, 0).toISOString();
    const r = activityFocus(input([], [{ started_at: started, duration_minutes: 50 }]), [D], { now: NOW });
    expect(r.rows[0].id).toBe(TIMER_ID);
    expect(r.rows[0].name).toBe('Focus timer');
    expect(r.rows[0].focusedMinutes).toBe(50);
  });

  it('future blocks of today are not counted', () => {
    const now = new Date(2026, 8, 28, 10, 0); // block 60
    const r = activityFocus(input(run(D, 54, 70, 'code')), [D], { now });
    expect(r.rows[0].focusedMinutes).toBe(60);
  });
});

describe('coreWindow', () => {
  it('prefers the shorter window, then the heavier one', () => {
    const slots = new Array(48).fill(0);
    slots[10] = 30; slots[11] = 30; slots[30] = 20; slots[31] = 20;
    expect(coreWindow(slots, 0.5)).toEqual({ startMin: 300, endMin: 360, sharePct: 60 });
    expect(coreWindow(new Array(48).fill(0))).toBeNull();
  });
});

describe('axisMinutes', () => {
  it('keeps chart axis labels short enough not to clip', () => {
    expect(axisMinutes(45)).toBe('45m');
    expect(axisMinutes(90)).toBe('1.5h');
    expect(axisMinutes(720)).toBe('12h');
  });
});

describe('findRuns: ping-pong is not focus', () => {
  it('alternating two activities every 10 minutes is not a focused run of either', () => {
    const runs = findRuns(['a', 'b', 'a', 'b', 'a', 'b', 'a', 'b']);
    expect(runs.every((r) => r.blocks < 3)).toBe(true);
  });
  it('still tolerates a blip inside real runs', () => {
    const runs = findRuns(['a', 'a', 'b', 'a', 'a', null, 'a', 'a']);
    expect(runs[0]).toMatchObject({ activityId: 'a', blocks: 6, startIdx: 0, endIdx: 7 });
  });
});
