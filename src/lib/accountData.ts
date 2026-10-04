import { supabase } from '../supabaseClient';
import type { Database } from '../database.types';

/**
 * Every table that holds a user's rows, in the order "Delete all data" clears them: derived analytics and their
 * queue first, then raw data children before their parents (time blocks and sessions before tasks, habit logs
 * before habits, everything before activities), settings last. Every foreign key between these tables cascades
 * or sets null, so the order is for clarity rather than correctness. Keep this list in step with the schema:
 * a table missing here survives a wipe.
 */
export const WIPE_ORDER = [
  'ai_analysis_cache',
  'analytics_runs',
  'analytics_dirty_dates',
  'analytics_routine_daily',
  'analytics_transition_daily',
  'analytics_habit_daily',
  'analytics_goal_daily',
  'analytics_activity_daily',
  'analytics_daily',
  'analytics_state',
  'time_blocks',
  'task_focus_sessions',
  'habit_logs',
  'reviews',
  'daily_stats',
  'sleep_logs',
  'tasks',
  'habits',
  'goals',
  'activities',
  'user_settings',
] as const;

export type WipeTable = (typeof WIPE_ORDER)[number];

// Compile-time guard: adding a table to the schema (database.types.ts) without adding it above fails the build.
type Unwiped = Exclude<keyof Database['public']['Tables'], WipeTable>;
export const EVERY_TABLE_WIPED: [Unwiped] extends [never] ? true : never = true;
export interface WipeFailure { table: WipeTable; reason: string }

// Table names come from the constant above, so an untyped handle is safe here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (t: string) => any };

/**
 * Delete all of a user's rows, one table at a time. Row-level security turns a disallowed delete into "0 rows
 * deleted" with no error, so each table is re-counted afterwards and any leftover rows are reported as a failure
 * instead of passing silently. Raw data is the user's own, deleted at their explicit request.
 */
export async function deleteAllUserData(userId: string, onStep?: (done: number, table: WipeTable) => void): Promise<WipeFailure[]> {
  const failures: WipeFailure[] = [];
  for (let i = 0; i < WIPE_ORDER.length; i++) {
    const table = WIPE_ORDER[i];
    onStep?.(i, table);
    const { error } = await db.from(table).delete().eq('user_id', userId);
    if (error) { failures.push({ table, reason: error.message }); continue; }
    const { count, error: countError } = await db.from(table).select('user_id', { count: 'exact', head: true }).eq('user_id', userId);
    if (countError) failures.push({ table, reason: `could not confirm: ${countError.message}` });
    else if (count) failures.push({ table, reason: `${count} row${count === 1 ? '' : 's'} could not be deleted` });
  }
  onStep?.(WIPE_ORDER.length, WIPE_ORDER[WIPE_ORDER.length - 1]);
  // the day cache would otherwise show wiped data until it is refetched
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(`blockday_data_${userId}_`)) localStorage.removeItem(key);
  } catch { /* storage blocked */ }
  return failures;
}
