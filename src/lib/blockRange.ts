/** Narrow block row used by range views (calendar, analytics). */
export interface RangeBlock {
  date_key: string;
  block_index: number;
  activity_id: string | null;
  task_id?: string | null;
}

export const RANGE_COLUMNS = 'date_key, block_index, activity_id, task_id';

/** Unique identity of a block slot. */
export const blockSlotKey = (b: { date_key: string; block_index: number }) => `${b.date_key}_${b.block_index}`;

/**
 * Overlay live (optimistic) blocks onto database rows for the range.
 * - The live blocks always belong to one date (the selected date); DB rows for that date are replaced.
 * - Only live blocks with an activity are kept (empty slots are not "tracked").
 * - Rows are de-duplicated by date_key + block_index, so a slot can never be counted twice (30h/day bug).
 * - Live blocks are dropped when their date is outside [startKey, endKey].
 */
export const mergeLiveBlocks = (
  dbRows: RangeBlock[],
  liveBlocks: RangeBlock[],
  startKey: string,
  endKey: string | null
): RangeBlock[] => {
  const liveDate = liveBlocks.length > 0 ? liveBlocks[0].date_key : null;
  const liveInRange = liveDate !== null && liveDate >= startKey && (endKey === null || liveDate <= endKey);

  const map = new Map<string, RangeBlock>();
  for (const row of dbRows) {
    if (liveInRange && row.date_key === liveDate) continue;
    if (row.activity_id === null) continue;
    map.set(blockSlotKey(row), row);
  }
  if (liveInRange) {
    for (const b of liveBlocks) {
      if (b.activity_id !== null) map.set(blockSlotKey(b), b);
    }
  }
  return Array.from(map.values());
};
