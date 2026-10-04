import { format } from 'date-fns';

/**
 * Live block filling for a running focus session. A session is a list of active focus segments (pauses and breaks are
 * the gaps between them). A 10-minute grid block counts as covered once the session has spent FILL_THRESHOLD_MIN of
 * its minutes in it, so the block being worked in is filled halfway through, and a session that ends two minutes into
 * a block leaves that block alone. Blocks are local-time and split at midnight like the grid.
 */

export const FILL_THRESHOLD_MIN = 5;
const BLOCK_MS = 10 * 60_000;

export interface FocusSegment {
  start: number;
  /** null while the segment is still running */
  end: number | null;
}

export interface BlockFill {
  dateKey: string;
  indices: number[];
}

/** `date|blockIndex`, the key a filled block is remembered by. */
export const blockKey = (dateKey: string, index: number) => `${dateKey}|${index}`;

const blockStartOf = (t: number) => {
  const d = new Date(t);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() - (d.getMinutes() % 10));
  return d;
};

/** Covered milliseconds per block for every block the segments touch. */
export const coverageByBlock = (segments: FocusSegment[], now: number): Map<string, number> => {
  const cover = new Map<string, number>();
  for (const seg of segments) {
    const end = Math.min(seg.end ?? now, now);
    let t = seg.start;
    while (t < end) {
      const block = blockStartOf(t);
      const blockEnd = block.getTime() + BLOCK_MS;
      const stop = Math.min(end, blockEnd);
      const key = blockKey(format(block, 'yyyy-MM-dd'), (block.getHours() * 60 + block.getMinutes()) / 10);
      cover.set(key, (cover.get(key) ?? 0) + (stop - t));
      t = stop;
    }
  }
  return cover;
};

/** Blocks covered for at least `thresholdMin` minutes that are not filled yet, grouped by date. */
export const blocksToFill = (
  segments: FocusSegment[],
  now: number,
  filled: Set<string>,
  thresholdMin = FILL_THRESHOLD_MIN
): BlockFill[] => {
  const byDate = new Map<string, number[]>();
  for (const [key, ms] of coverageByBlock(segments, now)) {
    if (ms < thresholdMin * 60_000 || filled.has(key)) continue;
    const [dateKey, idx] = key.split('|');
    (byDate.get(dateKey) ?? byDate.set(dateKey, []).get(dateKey)!).push(Number(idx));
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([dateKey, indices]) => ({ dateKey, indices: indices.sort((a, b) => a - b) }));
};

/** Active focus minutes in the segments (pauses and breaks excluded). */
export const focusedMinutes = (segments: FocusSegment[], now: number): number =>
  segments.reduce((sum, s) => sum + Math.max(0, Math.min(s.end ?? now, now) - s.start), 0) / 60_000;
