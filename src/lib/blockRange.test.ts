import { describe, expect, it } from 'vitest';
import { mergeLiveBlocks, type RangeBlock } from './blockRange';

const b = (date_key: string, block_index: number, activity_id: string | null = 'a'): RangeBlock => ({ date_key, block_index, activity_id });

describe('mergeLiveBlocks', () => {
  it('replaces DB rows of the live date with live blocks', () => {
    const db = [b('2026-09-22', 1, 'old'), b('2026-09-21', 1)];
    const live = [b('2026-09-22', 2, 'new'), b('2026-09-22', 3, null)];
    const out = mergeLiveBlocks(db, live, '2026-09-15', '2026-09-22');
    expect(out.map((x) => `${x.date_key}:${x.block_index}:${x.activity_id}`).sort()).toEqual([
      '2026-09-21:1:a',
      '2026-09-22:2:new',
    ]);
  });

  it('never counts a slot twice (dedupe)', () => {
    const db = [b('2026-09-21', 5), b('2026-09-21', 5)];
    expect(mergeLiveBlocks(db, [], '2026-09-01', null)).toHaveLength(1);
  });

  it('ignores live blocks outside the range', () => {
    const db = [b('2026-09-10', 1)];
    const live = [b('2026-09-22', 2)];
    expect(mergeLiveBlocks(db, live, '2026-09-01', '2026-09-15')).toHaveLength(1);
  });

  it('drops empty DB rows and handles no live blocks', () => {
    expect(mergeLiveBlocks([b('2026-09-10', 1, null)], [], '2026-09-01', null)).toEqual([]);
  });

  it('cleared live blocks remove the DB rows for that date', () => {
    const db = [b('2026-09-22', 1)];
    const live = [b('2026-09-22', 1, null)];
    expect(mergeLiveBlocks(db, live, '2026-09-01', null)).toEqual([]);
  });
});
