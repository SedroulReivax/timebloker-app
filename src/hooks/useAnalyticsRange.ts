import { useEffect, useState, useSyncExternalStore } from 'react';
import { supabase } from '../supabaseClient';
import {
  dailyAnalyticsCache,
  activityAnalyticsCache,
  goalAnalyticsCache,
  habitAnalyticsCache,
  transitionAnalyticsCache,
  analyticsGeneration,
  subscribeAnalyticsInvalidation,
  type RangeCache,
} from '../lib/analyticsRangeCache';

/**
 * Shared hook shape for every analytics_*_daily range read . One internal
 * implementation, five thin exports below. Unlike useBlockRange, there is no live/optimistic
 * overlay here -- analytics rows aren't edited client-side; freshness comes from the
 * analyticsInvalidation.ts drain, which clears these caches on success and bumps the generation this
 * hook subscribes to, so an open screen refetches its range instead of keeping pre-edit rows.
 * The previous rows stay on screen while the refetch is in flight.
 */
function useCachedRange<T>(cache: RangeCache<T>, fromKey: string, toKey: string) {
  const generation = useSyncExternalStore(subscribeAnalyticsInvalidation, analyticsGeneration, analyticsGeneration);
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const data = await cache.getRange(session.user.id, fromKey, toKey);
        if (!cancelled) {
          setRows(data);
          setError(null);
        }
      } catch (e: any) {
        console.error('analytics range fetch failed:', e);
        if (!cancelled) setError(e?.message ?? String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cache, fromKey, toKey, generation]);

  return { rows, loading, error };
}

export const useDailyAnalyticsRange = (fromKey: string, toKey: string) => useCachedRange(dailyAnalyticsCache, fromKey, toKey);
export const useActivityAnalyticsRange = (fromKey: string, toKey: string) => useCachedRange(activityAnalyticsCache, fromKey, toKey);
export const useGoalAnalyticsRange = (fromKey: string, toKey: string) => useCachedRange(goalAnalyticsCache, fromKey, toKey);
export const useHabitAnalyticsRange = (fromKey: string, toKey: string) => useCachedRange(habitAnalyticsCache, fromKey, toKey);
export const useTransitionAnalyticsRange = (fromKey: string, toKey: string) => useCachedRange(transitionAnalyticsCache, fromKey, toKey);
