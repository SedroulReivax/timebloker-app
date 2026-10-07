import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { RANGE_COLUMNS, mergeLiveBlocks, type RangeBlock } from '../lib/blockRange';

/**
 * Shared, cached loader for time blocks over a date range.
 * - narrow columns only (see RANGE_COLUMNS)
 * - stable ordering so paging cannot skip or repeat rows
 * - one in-flight/cached request per user+range (Dashboard and Calendar no longer fetch separately), and a range that
 *   sits inside a fresh cached one (a 28-day history inside a 90-day view, say) is cut from it instead of fetched again
 * - live (optimistic) blocks for the selected date are overlaid without refetching
 */

const PAGE = 1000;
const TTL_MS = 5 * 60 * 1000; // pick up edits made on other devices within a few minutes

interface CacheEntry { rows: Promise<RangeBlock[]>; at: number; userId: string; startKey: string; endKey: string | null }
const cache = new Map<string, CacheEntry>();

/** Drop all cached ranges (call after bulk writes such as copying a day). */
export const invalidateBlockRangeCache = () => cache.clear();

async function fetchRange(userId: string, startKey: string, endKey: string | null): Promise<RangeBlock[]> {
  const rows: RangeBlock[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from('time_blocks')
      .select(RANGE_COLUMNS)
      .eq('user_id', userId)
      .gte('date_key', startKey)
      .not('activity_id', 'is', null)
      .order('date_key')
      .order('block_index')
      .range(from, from + PAGE - 1);
    if (endKey) q = q.lte('date_key', endKey);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...(data as RangeBlock[]));
    if (data.length < PAGE) break;
  }
  return rows;
}

function getRange(userId: string, startKey: string, endKey: string | null): Promise<RangeBlock[]> {
  const key = `${userId}|${startKey}|${endKey ?? ''}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rows;
  // a cached range that covers this one (same user, starts no later, ends no earlier) already holds every row we need
  for (const e of cache.values()) {
    if (e.userId !== userId || Date.now() - e.at >= TTL_MS) continue;
    if (e.startKey <= startKey && (e.endKey === null || (endKey !== null && e.endKey >= endKey))) {
      return e.rows.then((rows) => rows.filter((b) => b.date_key >= startKey && (endKey === null || b.date_key <= endKey)));
    }
  }
  const rows = fetchRange(userId, startKey, endKey).catch((e) => {
    cache.delete(key); // never cache failures
    throw e;
  });
  cache.set(key, { rows, at: Date.now(), userId, startKey, endKey });
  return rows;
}

export function useBlockRange(
  startKey: string,
  endKey: string | null,
  liveBlocks: RangeBlock[]
): { blocks: RangeBlock[]; loading: boolean } {
  const [dbRows, setDbRows] = useState<RangeBlock[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const rows = await getRange(session.user.id, startKey, endKey);
        if (!cancelled) setDbRows(rows);
      } catch (e) {
        console.error('useBlockRange error:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [startKey, endKey]);

  const blocks = useMemo(() => mergeLiveBlocks(dbRows, liveBlocks, startKey, endKey), [dbRows, liveBlocks, startKey, endKey]);
  return { blocks, loading };
}
