import { describe, expect, it } from 'vitest';
import { buildTimeline, formatSegmentRange } from './dayTimeline';

const blk = (i: number, a: string | null, t: string | null = null) => ({ block_index: i, activity_id: a, task_id: t });

describe('buildTimeline', () => {
  it('merges adjacent blocks and shows untracked gaps', () => {
    const blocks = [blk(54, 'study', 't1'), blk(55, 'study', 't1'), blk(56, 'study', 't1'), blk(60, 'math')];
    const seg = buildTimeline(blocks, 144).filter((s) => s.kind === 'tracked');
    expect(seg).toHaveLength(2);
    expect(seg[0]).toMatchObject({ startIdx: 54, endIdx: 56, minutes: 30, taskId: 't1' });
    expect(seg[1]).toMatchObject({ startIdx: 60, endIdx: 60, activityId: 'math' });
  });

  it('splits when the task differs even for the same activity', () => {
    const seg = buildTimeline([blk(1, 'study', 't1'), blk(2, 'study', 't2')], 144).filter((s) => s.kind === 'tracked');
    expect(seg).toHaveLength(2);
  });

  it('covers the whole day: segment minutes sum to 1440', () => {
    const seg = buildTimeline([blk(1, 'a')], 144);
    expect(seg.reduce((s, x) => s + x.minutes, 0)).toBe(1440);
  });

  it('marks blocks after now as future', () => {
    const seg = buildTimeline([blk(10, 'a'), blk(90, 'b')], 72);
    expect(seg.find((s) => s.startIdx === 10)?.kind).toBe('tracked');
    expect(seg.find((s) => s.startIdx === 90)?.kind).toBe('future');
    expect(seg[seg.length - 1].kind).toBe('future');
  });
});

describe('formatSegmentRange', () => {
  it('formats and wraps at midnight', () => {
    expect(formatSegmentRange({ startIdx: 54, endIdx: 59 })).toBe('9:00 AM–10:00 AM');
    expect(formatSegmentRange({ startIdx: 138, endIdx: 143 })).toBe('11:00 PM–12:00 AM');
  });
});
