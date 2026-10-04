import {
  fetchDailyAnalytics,
  fetchActivityAnalytics,
  fetchGoalAnalytics,
  fetchHabitAnalytics,
  fetchTransitionAnalytics,
  fetchRoutineAnalytics,
} from './backendAnalytics';
import type { Database } from '../database.types';

/**
 * Shared cached-range-fetcher factory for the analytics_*_daily RPCs (one hook
 * pattern, not five independent caches). Modeled on blockRange.ts's cache: promise-based per-key
 * dedup (concurrent callers share one in-flight fetch), a TTL, and rejected promises are never
 * cached.
 *
 * TTL is shorter than useBlockRange's 5 minutes: analyticsInvalidation.ts's debounced drain
 * clears these caches on success, so a same-device edit is reflected within seconds, and the
 * TTL's only remaining job is bridging other staleness sources (a second tab/device, a drain
 * still in flight). 2 minutes is a judgment call, not a hard requirement.
 */
const TTL_MS = 2 * 60 * 1000;

export interface RangeCache<T> {
  getRange: (userId: string, from: string, to: string) => Promise<T[]>;
  invalidate: () => void;
}

export function createRangeCache<T>(fetcher: (from: string, to: string) => Promise<T[]>): RangeCache<T> {
  const cache = new Map<string, { rows: Promise<T[]>; at: number }>();
  return {
    getRange(userId, from, to) {
      const key = `${userId}|${from}|${to}`;
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < TTL_MS) return hit.rows;
      const rows = fetcher(from, to).catch((e) => {
        cache.delete(key); // never cache failures
        throw e;
      });
      cache.set(key, { rows, at: Date.now() });
      return rows;
    },
    invalidate() {
      cache.clear();
    },
  };
}

type DailyRow = Database['public']['Tables']['analytics_daily']['Row'];
type ActivityDailyRow = Database['public']['Tables']['analytics_activity_daily']['Row'];
type GoalDailyRow = Database['public']['Tables']['analytics_goal_daily']['Row'];
type HabitDailyRow = Database['public']['Tables']['analytics_habit_daily']['Row'];
type TransitionDailyRow = Database['public']['Tables']['analytics_transition_daily']['Row'];
type RoutineRangeRow = Database['public']['Functions']['get_routine_analytics_range']['Returns'][number];

export const dailyAnalyticsCache = createRangeCache<DailyRow>(fetchDailyAnalytics as (from: string, to: string) => Promise<DailyRow[]>);
export const activityAnalyticsCache = createRangeCache<ActivityDailyRow>(fetchActivityAnalytics as (from: string, to: string) => Promise<ActivityDailyRow[]>);
export const goalAnalyticsCache = createRangeCache<GoalDailyRow>(fetchGoalAnalytics as (from: string, to: string) => Promise<GoalDailyRow[]>);
export const habitAnalyticsCache = createRangeCache<HabitDailyRow>(fetchHabitAnalytics as (from: string, to: string) => Promise<HabitDailyRow[]>);
export const transitionAnalyticsCache = createRangeCache<TransitionDailyRow>(fetchTransitionAnalytics as (from: string, to: string) => Promise<TransitionDailyRow[]>);
export const routineAnalyticsCache = createRangeCache<RoutineRangeRow>(fetchRoutineAnalytics as (from: string, to: string) => Promise<RoutineRangeRow[]>);

// Clearing the caches alone only helps the next screen that mounts: a screen that is already open
// keeps the rows it fetched. So every invalidation also bumps a generation number that
// useAnalyticsRange subscribes to, and mounted hooks refetch their range when it changes.
let generation = 0;
const listeners = new Set<() => void>();

export function subscribeAnalyticsInvalidation(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const analyticsGeneration = () => generation;

/** Clear every analytics range cache and tell mounted screens to refetch. Called after a successful
 *  dirty-queue drain so a screen doesn't have to wait out the TTL after the user's own edit
 *  (analyticsInvalidation.ts). */
export function invalidateAnalyticsRangeCaches() {
  dailyAnalyticsCache.invalidate();
  activityAnalyticsCache.invalidate();
  goalAnalyticsCache.invalidate();
  habitAnalyticsCache.invalidate();
  transitionAnalyticsCache.invalidate();
  routineAnalyticsCache.invalidate();
  generation++;
  for (const l of listeners) l();
}
