import { describe, expect, it } from 'vitest';
import { formatMinutes, getEstimatedMinutes, summarizeTaskTime } from './taskTime';

const now = new Date(2026, 8, 22, 12, 0); // 12:00 local => block 72
const blk = (index: number, task_id: string | null, date_key = '2026-09-22') => ({ date_key, block_index: index, task_id });

describe('getEstimatedMinutes', () => {
  it('prefers estimated_minutes, falls back to pomodoros x 25, else null', () => {
    expect(getEstimatedMinutes({ estimated_minutes: 90, estimated_pomodoros: 2 })).toBe(90);
    expect(getEstimatedMinutes({ estimated_minutes: null, estimated_pomodoros: 2 })).toBe(50);
    expect(getEstimatedMinutes({ estimated_minutes: null, estimated_pomodoros: 0 })).toBeNull();
  });
});

describe('summarizeTaskTime', () => {
  const task = { id: 't1', estimated_minutes: 120 };

  it('splits scheduled (future) from tracked (past) and ignores other tasks', () => {
    const blocks = [blk(60, 't1'), blk(61, 't1'), blk(80, 't1'), blk(62, 't2'), blk(63, null)];
    const s = summarizeTaskTime(task, blocks, [], now);
    expect(s.trackedMinutes).toBe(20);
    expect(s.scheduledMinutes).toBe(10);
  });

  it('sums focus sessions separately from tracked blocks', () => {
    const s = summarizeTaskTime(task, [blk(60, 't1')], [
      { task_id: 't1', duration_minutes: 25 }, { task_id: 't1', duration_minutes: 30 }, { task_id: 'x', duration_minutes: 99 },
    ], now);
    expect(s.focusedMinutes).toBe(55);
    expect(s.trackedMinutes).toBe(10);
  });

  it('computes progress, remaining and estimate error vs the estimate', () => {
    const blocks = Array.from({ length: 14 }, (_, i) => blk(40 + i, 't1')); // 140 min tracked
    const s = summarizeTaskTime(task, blocks, [], now);
    expect(s.progress).toBeCloseTo(140 / 120);
    expect(s.remainingMinutes).toBe(0);
    expect(s.estimateErrorMinutes).toBe(20);
  });

  it('has null estimate-derived fields without an estimate', () => {
    const s = summarizeTaskTime({ id: 't1' }, [blk(60, 't1')], [], now);
    expect(s.progress).toBeNull();
    expect(s.remainingMinutes).toBeNull();
    expect(s.estimateErrorMinutes).toBeNull();
  });

  it('a block starting exactly now counts as tracked', () => {
    expect(summarizeTaskTime(task, [blk(72, 't1')], [], now).trackedMinutes).toBe(10);
  });
});

describe('formatMinutes', () => {
  it('formats', () => {
    expect([formatMinutes(0), formatMinutes(25), formatMinutes(60), formatMinutes(100)]).toEqual(['0m', '25m', '1h', '1h 40m']);
  });
});
