import { describe, expect, it } from 'vitest';
import { getCopySources, planCopy } from './copyDay';

describe('getCopySources', () => {
  it('on a Wednesday: yesterday=Tue, previous weekday=Tue (deduped), last Monday=Mon', () => {
    const s = getCopySources(new Date(2026, 8, 23)); // Wed 23 Sep 2026
    expect(s.map((x) => x.dateKey)).toEqual(['2026-09-22', '2026-09-21']);
  });

  it('on a Monday: previous weekday skips the weekend, last Monday is 7 days back', () => {
    const s = getCopySources(new Date(2026, 8, 21)); // Mon 21 Sep 2026
    expect(s.map((x) => x.dateKey)).toEqual(['2026-09-20', '2026-09-18', '2026-09-14']);
  });
});

describe('planCopy', () => {
  const src = [{ block_index: 1, activity_id: 'a' }, { block_index: 2, activity_id: 'b' }, { block_index: 3, activity_id: null }, { block_index: 4, activity_id: 'a' }];

  it('fills only empty blocks and never overwrites', () => {
    const target = [{ block_index: 1, activity_id: 'z' }, { block_index: 2, activity_id: null }];
    const p = planCopy(src, target);
    expect(p.toWrite.map((w) => w.block_index)).toEqual([2, 4]);
    expect(p.skippedFilled).toBe(1);
  });

  it('skips archived activities', () => {
    const p = planCopy(src, [], new Set(['b']));
    expect(p.toWrite.map((w) => w.block_index)).toEqual([1, 4]);
    expect(p.skippedArchived).toBe(1);
  });
});
