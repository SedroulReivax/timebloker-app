import { describe, expect, it } from 'vitest';
import { blockKey, blocksToFill, focusedMinutes } from './focusFill';

const at = (d: string, hh: number, mm: number, ss = 0) => new Date(`${d}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`).getTime();
const D = '2026-10-04';

describe('blocksToFill', () => {
  it('fills a block once five of its ten minutes are covered, not before', () => {
    const start = at(D, 9, 0);
    expect(blocksToFill([{ start, end: null }], at(D, 9, 4, 59), new Set())).toEqual([]);
    expect(blocksToFill([{ start, end: null }], at(D, 9, 5), new Set())).toEqual([{ dateKey: D, indices: [54] }]);
  });

  it('fills every fully covered block and the current one past halfway', () => {
    expect(blocksToFill([{ start: at(D, 9, 0), end: null }], at(D, 9, 36), new Set())).toEqual([{ dateKey: D, indices: [54, 55, 56, 57] }]);
  });

  it('a start late in a block leaves that block out', () => {
    // 09:07 start: only 3 minutes of block 54
    expect(blocksToFill([{ start: at(D, 9, 7), end: at(D, 9, 20) }], at(D, 9, 30), new Set())).toEqual([{ dateKey: D, indices: [55] }]);
  });

  it('a pause in the middle of a block counts only the focused minutes', () => {
    // 09:00-09:03 then 09:08-09:10: 5 minutes in block 54 in total
    const segs = [{ start: at(D, 9, 0), end: at(D, 9, 3) }, { start: at(D, 9, 8), end: at(D, 9, 10) }];
    expect(blocksToFill(segs, at(D, 9, 10), new Set())).toEqual([{ dateKey: D, indices: [54] }]);
    const short = [{ start: at(D, 9, 0), end: at(D, 9, 3) }, { start: at(D, 9, 8), end: at(D, 9, 9) }];
    expect(blocksToFill(short, at(D, 9, 10), new Set())).toEqual([]);
  });

  it('splits a session that runs past midnight by date', () => {
    expect(blocksToFill([{ start: at(D, 23, 50), end: at('2026-10-05', 0, 10) }], at('2026-10-05', 0, 10), new Set())).toEqual([
      { dateKey: D, indices: [143] },
      { dateKey: '2026-10-05', indices: [0] },
    ]);
  });

  it('skips blocks already filled this session', () => {
    const filled = new Set([blockKey(D, 54)]);
    expect(blocksToFill([{ start: at(D, 9, 0), end: null }], at(D, 9, 16), filled)).toEqual([{ dateKey: D, indices: [55] }]);
  });

  it('never counts time after now, even for a segment with a later end', () => {
    expect(blocksToFill([{ start: at(D, 9, 0), end: at(D, 10, 0) }], at(D, 9, 6), new Set())).toEqual([{ dateKey: D, indices: [54] }]);
  });
});

describe('focusedMinutes', () => {
  it('adds up the segments and leaves pauses out', () => {
    expect(focusedMinutes([{ start: at(D, 9, 0), end: at(D, 9, 10) }, { start: at(D, 9, 20), end: null }], at(D, 9, 25))).toBe(15);
  });
});
