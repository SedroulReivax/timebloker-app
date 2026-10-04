import { supabase } from '../supabaseClient';
import { invalidateAnalyticsRangeCaches } from './analyticsRangeCache';

// Fire-and-forget dirty-date marking after a raw-data mutation succeeds. These are
// background bookkeeping calls : the mutation itself already
// succeeded and its optimistic UI update is already applied, so a failure here must
// not roll back the user's edit or show a save-error toast. It is logged instead,
// which means the affected date's analytics could go stale silently until the next
// full rebuild -- an acceptable tradeoff for background invalidation, not a hidden
// data-corruption risk (raw data is untouched either way).

function report(rpc: string, error: { message?: string } | null) {
  if (error) console.error(`analytics invalidation (${rpc}) failed:`, error.message);
}

// ─── Drain trigger ──────────────────────────────────────────────────────────────
// Marking a date dirty only queues it (analytics_dirty_dates); nothing recomputes it until
// something drains the queue. The only server-side drain path is pg_cron, which the user has to
// schedule manually (supabase/manual/phase_e_cron.sql) and which runs at most every 15 minutes.
// To make migrated screens fresh right after a normal edit, every successful
// mark-dirty call below schedules a debounced client-side drain via the caller's own
// process_dirty_analytics() RPC (SECURITY INVOKER, scoped to auth.uid(), safe from the browser).
// pg_cron remains recommended as a backup for multi-device edits and sessions that close before
// the debounce fires -- see phase_e_cron.sql.

const DRAIN_DEBOUNCE_MS = 4000; // coalesces rapid edits (e.g. block-dragging) into one drain call
let drainTimer: ReturnType<typeof setTimeout> | null = null;
let drainInFlight: Promise<void> | null = null;
let redrainPending = false;

function scheduleDrain(userId: string | undefined) {
  if (!userId) return;
  if (drainTimer) clearTimeout(drainTimer);
  drainTimer = setTimeout(() => {
    drainTimer = null;
    void runDrain(userId);
  }, DRAIN_DEBOUNCE_MS);
}

// Today in the app's analytics timezone (the SQL side uses Asia/Kolkata for "today" and elapsed blocks).
const analyticsToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

/**
 * recompute_daily_analytics only counts blocks that had elapsed when it ran, so a day last recomputed
 * before it ended (an edit at 15:00, or blocks planned ahead) keeps a partial row after midnight:
 * elapsed < 1440, untracked/coverage frozen at that moment, later blocks uncounted, and the day is left
 * out of every "finished days" comparison. Nothing else re-marks such a day, so each drain first queues
 * any past day whose row is still partial. Bounded: only rows with elapsed_minutes < 1440 and a date
 * before today are touched, and once recomputed they stop matching.
 */
async function queueStalePartialDays(userId: string) {
  try {
    const { data, error } = await supabase
      .from('analytics_daily')
      .select('date_key')
      .eq('user_id', userId)
      .lt('date_key', analyticsToday())
      .lt('elapsed_minutes', 1440);
    if (error) throw error;
    const dates = (data ?? []).map((r) => r.date_key);
    if (dates.length) await queueDates(userId, dates, 'day_finished');
  } catch (e) {
    console.error('analytics stale-day sweep failed:', e);
  }
}

async function runDrain(userId: string): Promise<void> {
  if (drainInFlight) {
    redrainPending = true;
    return;
  }
  drainInFlight = (async () => {
    try {
      await queueStalePartialDays(userId);
      let rows: unknown[];
      do {
        const { data, error } = await supabase.rpc('process_dirty_analytics', { p_limit: 50 });
        if (error) {
          console.error('analytics drain failed:', error.message);
          return;
        }
        rows = (data as unknown[] | null) ?? [];
      } while (rows.length === 50); // fewer than the limit returned => queue is empty
      invalidateAnalyticsRangeCaches(); // don't make the user wait out the TTL after their own edit
    } catch (e) {
      console.error('analytics drain failed:', e);
    } finally {
      drainInFlight = null;
      if (redrainPending) {
        redrainPending = false;
        scheduleDrain(userId);
      }
    }
  })();
  return drainInFlight;
}

/** Mop up dirty dates left over from a session that closed before its debounce fired. Call once
 *  when a session starts (as soon as userId is known). Fire-and-forget. */
export function drainOnStartup(userId: string | undefined) {
  if (!userId) return;
  void runDrain(userId);
}

/** A Realtime event showed raw data changed on another device. That device queues and drains its own
 *  dirty dates, but this device's analytics caches don't know, so run the same debounced drain here:
 *  it picks up anything still queued (process_dirty_analytics skips rows another drain has locked) and
 *  clears the range caches when done, so open analysis screens refetch instead of waiting out the TTL. */
export function drainAfterRemoteChange(userId: string | undefined) {
  scheduleDrain(userId);
}

// ─── Mark-dirty API ─────────────────────────────────────────────────────────────

/** Mark one date's derived analytics dirty (block edits, task/habit/sleep/session changes). */
export async function markDateDirty(userId: string | undefined, dateKey: string | null | undefined, reason: string) {
  if (!userId || !dateKey) return;
  const { error } = await supabase.rpc('mark_analytics_dirty', { p_user_id: userId, p_date: dateKey, p_reason: reason });
  report('mark_analytics_dirty', error);
  if (!error) scheduleDrain(userId);
}

/**
 * Queue many dates in one request instead of one RPC per date: the rows go straight into the same
 * analytics_dirty_dates queue mark_analytics_dirty writes (RLS lets users manage their own rows), with
 * the same reset of status/attempts. One mark_analytics_dirty call then bumps analytics_state.data_version
 * once for the whole batch. Does not schedule a drain; callers decide.
 */
async function queueDates(userId: string, dateKeys: string[], reason: string): Promise<boolean> {
  if (dateKeys.length === 0) return true;
  const [first, ...rest] = dateKeys;
  if (rest.length) {
    const now = new Date().toISOString();
    const { error } = await supabase.from('analytics_dirty_dates').upsert(
      rest.map((date_key) => ({ user_id: userId, date_key, reason, status: 'dirty', attempts: 0, last_marked_at: now })),
      { onConflict: 'user_id,date_key' }
    );
    report('analytics_dirty_dates upsert', error);
    if (error) return false;
  }
  const { error } = await supabase.rpc('mark_analytics_dirty', { p_user_id: userId, p_date: first, p_reason: reason });
  report('mark_analytics_dirty', error);
  return !error;
}

/** Mark several dates dirty at once (bulk writes such as a backup import, or a deleted task's dates). */
export async function markDatesDirty(userId: string | undefined, dateKeys: (string | null | undefined)[], reason: string) {
  if (!userId) return;
  const unique = Array.from(new Set(dateKeys.filter((d): d is string => !!d)));
  if (await queueDates(userId, unique, reason)) scheduleDrain(userId);
}

/** Mark every date an activity has ever been assigned to dirty (multiplier/ignore/focus_demand edits). */
export async function markActivityDirty(userId: string | undefined, activityId: string | null | undefined, reason: string) {
  if (!userId || !activityId) return;
  const { error } = await supabase.rpc('mark_activity_dates_dirty', { p_user_id: userId, p_activity_id: activityId, p_reason: reason });
  report('mark_activity_dates_dirty', error);
  if (!error) scheduleDrain(userId);
}

/** Mark a goal's lifetime (capped at 365 days back) dirty (linked activities/status/date edits). */
export async function markGoalDirty(userId: string | undefined, goalId: string | null | undefined, reason: string) {
  if (!userId || !goalId) return;
  const { error } = await supabase.rpc('mark_goal_dates_dirty', { p_user_id: userId, p_goal_id: goalId, p_reason: reason });
  report('mark_goal_dates_dirty', error);
  if (!error) scheduleDrain(userId);
}

/** Mark every date a habit has ever been logged on dirty (habit deletion). */
export async function markHabitDirty(userId: string | undefined, habitId: string | null | undefined, reason: string) {
  if (!userId || !habitId) return;
  const { error } = await supabase.rpc('mark_habit_dates_dirty', { p_user_id: userId, p_habit_id: habitId, p_reason: reason });
  report('mark_habit_dates_dirty', error);
  if (!error) scheduleDrain(userId);
}
