import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { format } from 'date-fns';
import { toISODeadline } from '../lib/deadlines';
import { fetchAllRows } from '../lib/paging';
import { planCopy, type CopyPlan } from '../lib/copyDay';
import { invalidateBlockRangeCache } from './useBlockRange';
import { buildNextOccurrence } from '../lib/recurrence';
import { markDateDirty, markDatesDirty, markActivityDirty, markGoalDirty, markHabitDirty, drainOnStartup, drainAfterRemoteChange } from '../lib/analyticsInvalidation';
import type { Database } from '../database.types';
import type { DailyStats, Goal, HabitLog, Review, SleepLog, TaskBlockRef, TaskFocusSession, UserSettings } from '../types';

type UserSettingsInsert = Database['public']['Tables']['user_settings']['Insert'];

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

// Local first-paint cache. Keys share the blockday_data_<user>_ prefix that accountData.ts clears on wipe.
const userCacheKey = (userId: string) => `blockday_data_${userId}_user`;
const dayCacheKey = (userId: string, dateKey: string) => `blockday_data_${userId}_${dateKey}`;

function readCache(key: string) {
  try {
    const cached = localStorage.getItem(key);
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('local cache write skipped:', e); // quota full or storage blocked; the fetch result is already in state
  }
}

export function useSupabaseSync(session: any, selectedDate: Date) {
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');

  const [activities, setActivities] = useState<any[]>([]);
  const [habits, setHabits] = useState<any[]>([]);
  const [habitLogs, setHabitLogs] = useState<HabitLog[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [blocks, setBlocks] = useState<any[]>([]);
  const [dailyStats, setDailyStats] = useState<DailyStats | null>(null);
  const [sleepLogs, setSleepLogs] = useState<SleepLog[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [focusSessions, setFocusSessions] = useState<TaskFocusSession[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [taskBlocks, setTaskBlocks] = useState<TaskBlockRef[]>([]);
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null);

  const dateKey = format(selectedDate, 'yyyy-MM-dd');
  const userId = session?.user?.id;

  // Realtime handlers and the visibility listener live for the whole session, so they read the
  // current date through a ref instead of resubscribing on every date change.
  const dateKeyRef = useRef(dateKey);
  dateKeyRef.current = dateKey;
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const taskBlocksRef = useRef(taskBlocks);
  taskBlocksRef.current = taskBlocks;

  // ─── Save status helpers ───────────────────────────────────────────────────
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // While our own writes are in flight their Realtime echoes can arrive between two optimistic
  // updates and briefly undo the newer one. Events that arrive in this window are queued instead of
  // dropped, then applied in commit order once writes go quiet, so remote edits made in the window
  // still land and the final state matches the database.
  const selfWriteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queuedRealtime = useRef<(() => void)[]>([]);

  const setSelfMutation = () => {
    if (selfWriteTimer.current) clearTimeout(selfWriteTimer.current);
    selfWriteTimer.current = setTimeout(() => {
      selfWriteTimer.current = null;
      const queued = queuedRealtime.current;
      queuedRealtime.current = [];
      queued.forEach((apply) => apply());
    }, 2000);
  };

  const setSaving = () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus('saving');
    setSelfMutation();
  };

  const setSaved = () => {
    setSaveStatus('saved');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2000);
  };

  const setSaveError = () => {
    setSaveStatus('error');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => setSaveStatus('idle'), 5000);
  };

  /** Report the outcome of a write: error -> 'error' status, otherwise 'saved'. Returns true on success. */
  const finishSave = (error: { message?: string } | null, label: string): boolean => {
    if (error) {
      console.error(`${label} error:`, error);
      setSaveError();
      return false;
    }
    setSaved();
    return true;
  };

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (selfWriteTimer.current) clearTimeout(selfWriteTimer.current);
  }, []);

  // ─── Data loading ──────────────────────────────────────────────────────────
  // Two loaders instead of one: everything user-wide (all tasks, habit logs, focus sessions, ...) is
  // fetched once per session and then kept current by our own mutations, Realtime (tasks, blocks) and
  // a refresh when the tab comes back into view. Only the selected day's grid is refetched when the
  // date changes. localStorage keys keep the blockday_data_<user>_ prefix so the account wipe in
  // accountData.ts still clears them.
  const userDataPainted = useRef(false);

  const loadUserData = useCallback(async () => {
    if (!userId) return;

    if (!userDataPainted.current) {
      userDataPainted.current = true;
      const parsed = readCache(userCacheKey(userId));
      if (parsed) {
        if (parsed.activities) setActivities(parsed.activities);
        if (parsed.habits) setHabits(parsed.habits);
        if (parsed.habitLogs) setHabitLogs(parsed.habitLogs);
        if (parsed.tasks) setTasks(parsed.tasks);
        if (parsed.sleepLogs) setSleepLogs(parsed.sleepLogs);
        if (parsed.goals) setGoals(parsed.goals);
        if (parsed.userSettings) setUserSettings(parsed.userSettings);
      }
    }

    const [
      { data: actData },
      { data: habData },
      { data: logData },
      { data: taskData },
      { data: sleepData },
      { data: goalsData },
      { data: settingsData },
      { data: reviewData },
      { data: sessionData },
      { data: taskBlockData },
    ] = await Promise.all([
      supabase.from('activities').select('*').eq('user_id', userId).order('created_at'),
      supabase.from('habits').select('*').eq('user_id', userId).order('created_at'),
      fetchAllRows((from, to) => supabase.from('habit_logs').select('id, user_id, habit_id, date_key, logged_at, notes').eq('user_id', userId).order('logged_at').order('id').range(from, to)),
      fetchAllRows((from, to) => supabase.from('tasks').select('*').eq('user_id', userId).order('created_at').order('id').range(from, to)),
      supabase.from('sleep_logs').select('*').eq('user_id', userId).order('date_key', { ascending: false }).limit(60),
      supabase.from('goals').select('*').eq('user_id', userId).order('created_at'),
      supabase.from('user_settings').select('*').eq('user_id', userId).maybeSingle(),
      supabase.from('reviews').select('*').eq('user_id', userId),
      fetchAllRows((from, to) => supabase.from('task_focus_sessions').select('*').eq('user_id', userId).order('started_at').order('id').range(from, to)),
      fetchAllRows((from, to) => supabase.from('time_blocks').select('date_key, block_index, task_id').eq('user_id', userId).not('task_id', 'is', null).order('date_key').order('block_index').range(from, to)),
    ]);

    if (actData) setActivities(actData);
    if (habData) setHabits(habData);
    if (logData) setHabitLogs(logData);
    if (taskData) setTasks(taskData);
    if (sleepData) setSleepLogs(sleepData);
    if (goalsData) setGoals(goalsData);
    if (settingsData) setUserSettings(settingsData);
    if (sessionData) setFocusSessions(sessionData);
    if (reviewData) setReviews(reviewData);
    if (taskBlockData) setTaskBlocks(taskBlockData as TaskBlockRef[]);

    writeCache(userCacheKey(userId), {
      activities: actData, habits: habData, habitLogs: logData, tasks: taskData,
      sleepLogs: sleepData, goals: goalsData, userSettings: settingsData,
    });
  }, [userId]);

  const loadDayData = useCallback(async () => {
    if (!userId) return;
    const forDate = dateKey;

    // Paint the day from cache first so date navigation is instant (old combined-format entries
    // also carry blocks/dailyStats, so they still work here and are overwritten with day-only data).
    const parsed = readCache(dayCacheKey(userId, forDate));
    if (parsed?.blocks) setBlocks(parsed.blocks);

    const [{ data: blockData }, { data: statsData }] = await Promise.all([
      supabase.from('time_blocks').select('id, user_id, date_key, block_index, activity_id, task_id, notes').eq('user_id', userId).eq('date_key', forDate),
      supabase.from('daily_stats').select('*').eq('user_id', userId).eq('date_key', forDate).maybeSingle(),
    ]);

    if (dateKeyRef.current !== forDate) return; // the user moved to another date while this was in flight

    // Always 144 blocks
    const fullBlocks = Array.from({ length: 144 }, (_, i) => {
      const existing = blockData?.find((b: any) => b.block_index === i);
      return existing || { block_index: i, activity_id: null, date_key: forDate, user_id: userId };
    });
    setBlocks(fullBlocks);
    setDailyStats(statsData ?? null);

    writeCache(dayCacheKey(userId, forDate), { blocks: fullBlocks, dailyStats: statsData });
  }, [userId, dateKey]);

  /** Full reload (user-wide data plus the selected day). Used to roll back after a failed write and
   *  to catch up after the tab was hidden or the Realtime connection dropped. */
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadUserData(), loadDayData()]);
    } catch (e) {
      console.error('loadData error:', e);
    } finally {
      setLoading(false);
    }
  }, [loadUserData, loadDayData]);

  const loadDataRef = useRef(loadData);
  loadDataRef.current = loadData;

  // User-wide data: once per signed-in user, not on every date change.
  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    loadUserData()
      .catch((e) => console.error('loadUserData error:', e))
      .finally(() => setLoading(false));
    drainOnStartup(userId); // mop up any dirty dates left over from a prior session
  }, [userId, loadUserData]);

  // The selected day's grid: on every date change.
  useEffect(() => {
    if (!userId) return;
    loadDayData().catch((e) => console.error('loadDayData error:', e));
  }, [userId, loadDayData]);

  // ─── Realtime: tasks and time blocks only ─────────────────────────────────
  // Each event is applied to local state directly; nothing is refetched. Other tables (habits, sleep,
  // goals, settings, ...) catch up through the visibility refresh below. INSERT/UPDATE are filtered
  // to this user server-side. DELETE events can't be filtered (Supabase Realtime limitation) and,
  // with RLS on, only carry the primary key, so those are subscribed separately and matched by id.
  useEffect(() => {
    if (!userId) return;

    const applyRealtime = (apply: () => void) => {
      if (selfWriteTimer.current) {
        queuedRealtime.current.push(apply); // most likely our own echo; apply after our writes settle
        return;
      }
      apply();
      drainAfterRemoteChange(userId); // another device changed raw data: refresh analytics here too
    };

    const applyBlockRow = (row: any) => {
      if (row.date_key === dateKeyRef.current) {
        setBlocks((prev) => prev.map((b) => (b.block_index === row.block_index ? { ...b, ...row } : b)));
      }
      setTaskBlocks((prev) => {
        const kept = prev.filter((r) => !(r.date_key === row.date_key && r.block_index === row.block_index));
        return row.task_id ? [...kept, { date_key: row.date_key, block_index: row.block_index, task_id: row.task_id }] : kept;
      });
      invalidateBlockRangeCache();
    };

    const applyTaskRow = (row: any) => {
      setTasks((prev) => (prev.some((t) => t.id === row.id) ? prev.map((t) => (t.id === row.id ? row : t)) : [...prev, row]));
    };

    // Block rows are only deleted in bulk (account wipe), and a delete event carries no date_key or
    // block_index, so fall back to one debounced full reload.
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    const reloadSoon = () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => { reloadTimer = null; void loadDataRef.current(); }, 1000);
    };

    const ownRows = `user_id=eq.${userId}`;
    let subscribedBefore = false;

    const channel = supabase
      .channel(`sync-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'time_blocks', filter: ownRows }, (p) => applyRealtime(() => applyBlockRow(p.new)))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'time_blocks', filter: ownRows }, (p) => applyRealtime(() => applyBlockRow(p.new)))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'time_blocks' }, (p) => {
        // Unfiltered: only react to rows we actually hold (the visible day or a task-linked block)
        const id = (p.old as { id?: string }).id;
        if (id && blocksRef.current.some((b) => b.id === id)) applyRealtime(reloadSoon);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tasks', filter: ownRows }, (p) => applyRealtime(() => applyTaskRow(p.new)))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks', filter: ownRows }, (p) => applyRealtime(() => applyTaskRow(p.new)))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'tasks' }, (p) => {
        // Unfiltered: ids that aren't ours simply match nothing
        const id = (p.old as { id?: string }).id;
        if (id && tasksRef.current.some((t) => t.id === id)) applyRealtime(() => setTasks((prev) => prev.filter((t) => t.id !== id)));
      })
      .subscribe((status) => {
        if (status !== 'SUBSCRIBED') return;
        // A second SUBSCRIBED means the socket dropped and rejoined; events in the gap were missed.
        if (subscribedBefore) void loadDataRef.current();
        subscribedBefore = true;
      });

    return () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      supabase.removeChannel(channel);
    };
  }, [userId]);

  // ─── Lazy catch-up for everything not on Realtime ─────────────────────────
  // Coming back to the tab after a while refetches everything once, which picks up habit, sleep,
  // goal and settings edits made on another device without streaming those tables.
  useEffect(() => {
    if (!userId) return;
    const STALE_AFTER_HIDDEN_MS = 30_000;
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt && Date.now() - hiddenAt >= STALE_AFTER_HIDDEN_MS && !selfWriteTimer.current) {
        void loadDataRef.current();
        drainAfterRemoteChange(userId);
      }
      hiddenAt = 0;
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [userId]);

  // ─── Activity mutations ────────────────────────────────────────────────────
  const addActivity = async (activity: any) => {
    setSaving();
    const { data, error } = await supabase
      .from('activities')
      .insert({ ...activity, user_id: userId })
      .select()
      .single();
    if (error) { console.error('addActivity error:', error); setSaveError(); return; }
    if (data) setActivities((prev) => [...prev, data]);
    setSaved();
  };

  const ANALYSIS_RELEVANT_ACTIVITY_FIELDS = ['productivity_multiplier', 'analysis_ignored', 'focus_demand', 'category', 'is_sleep_activity'];

  const updateActivity = async (activityId: string, updates: any) => {
    setActivities((prev) => prev.map((a) => (a.id === activityId ? { ...a, ...updates } : a)));
    setSaving();
    const { error } = await supabase.from('activities').update(updates).eq('id', activityId);
    if (error) { console.error('updateActivity error:', error); setSaveError(); return; }
    setSaved();
    if (ANALYSIS_RELEVANT_ACTIVITY_FIELDS.some((f) => f in updates)) {
      markActivityDirty(userId, activityId, `activity_updated:${Object.keys(updates).join(',')}`);
    }
  };

  // Archive instead of delete: blocks, tasks and goals keep pointing at the activity, so history stays intact.
  const archiveActivity = async (activityId: string) => {
    setActivities((prev) => prev.map((a) => (a.id === activityId ? { ...a, archived: true } : a)));
    setSaving();
    const { error } = await supabase.from('activities').update({ archived: true }).eq('id', activityId);
    if (!finishSave(error, 'archiveActivity')) { loadData(); return; }
    markActivityDirty(userId, activityId, 'activity_archived');
  };

  // ─── Block mutations ───────────────────────────────────────────────────────
  /** Writes blocks on any date, not just the one on screen (a running focus session always writes to today).
   *  The grid's local copy is only touched when that date is the one shown. */
  const assignBlocksOn = async (forDate: string, blockIndices: number[], activityId: string | null, taskId: string | null = null) => {
    if (!userId || blockIndices.length === 0) return;
    // A task link only makes sense together with an activity
    const linkedTaskId = activityId ? taskId : null;
    const touched = new Set(blockIndices);
    const onScreen = forDate === dateKeyRef.current;
    // Snapshot of just the touched rows, so a rollback can't undo other edits made meanwhile
    const prevRows = new Map(onScreen ? blocksRef.current.filter((b) => touched.has(b.block_index)).map((b) => [b.block_index, b]) : []);
    const prevLinks = taskBlocksRef.current.filter((r) => r.date_key === forDate && touched.has(r.block_index));
    // Optimistic update
    if (onScreen) {
      setBlocks((prev) =>
        prev.map((b) => (touched.has(b.block_index) ? { ...b, activity_id: activityId, task_id: linkedTaskId } : b))
      );
    }
    setTaskBlocks((prev) => {
      const kept = prev.filter((r) => !(r.date_key === forDate && touched.has(r.block_index)));
      return linkedTaskId
        ? [...kept, ...blockIndices.map((idx) => ({ date_key: forDate, block_index: idx, task_id: linkedTaskId }))]
        : kept;
    });
    setSaving();

    try {
      const updates = blockIndices.map((idx) => ({
        user_id: userId,
        date_key: forDate,
        block_index: idx,
        activity_id: activityId,
        task_id: linkedTaskId,
      }));
      const { error } = await supabase
        .from('time_blocks')
        .upsert(updates, { onConflict: 'user_id,date_key,block_index' });
      if (error) throw error;
      invalidateBlockRangeCache(); // cached ranges may hold pre-edit rows for this date
      setSaved();
      markDateDirty(userId, forDate, 'block_assign');
    } catch (e) {
      console.error('assignBlocks error:', e);
      if (onScreen && dateKeyRef.current === forDate) {
        setBlocks((prev) => prev.map((b) => (prevRows.has(b.block_index) ? prevRows.get(b.block_index) : b)));
      }
      setTaskBlocks((prev) => [...prev.filter((r) => !(r.date_key === forDate && touched.has(r.block_index))), ...prevLinks]);
      setSaveError();
    }
  };

  const assignBlocks = (blockIndices: number[], activityId: string | null, taskId: string | null = null) =>
    assignBlocksOn(dateKey, blockIndices, activityId, taskId);

  // ─── Copy a day's time pattern (fills empty blocks only; never overwrites, never copies task links) ───
  const previewCopyFromDate = async (sourceDateKey: string): Promise<CopyPlan | null> => {
    if (!userId || sourceDateKey === dateKey) return null;
    const { data, error } = await supabase
      .from('time_blocks')
      .select('block_index, activity_id')
      .eq('user_id', userId)
      .eq('date_key', sourceDateKey)
      .not('activity_id', 'is', null)
      .order('block_index');
    if (error) { console.error('previewCopyFromDate error:', error); setSaveError(); return null; }
    const archived = new Set(activities.filter((a) => a.archived).map((a) => a.id as string));
    return planCopy(data ?? [], blocks, archived);
  };

  const copyBlocksFromDate = async (sourceDateKey: string): Promise<number> => {
    const plan = await previewCopyFromDate(sourceDateKey);
    if (!plan || plan.toWrite.length === 0) return 0;
    const prevBlocks = blocks;
    const byIndex = new Map(plan.toWrite.map((w) => [w.block_index, w.activity_id]));
    setBlocks((prev) => prev.map((b) => (byIndex.has(b.block_index) ? { ...b, activity_id: byIndex.get(b.block_index)!, task_id: null } : b)));
    setSaving();
    const { error } = await supabase.from('time_blocks').upsert(
      plan.toWrite.map((w) => ({ user_id: userId as string, date_key: dateKey, block_index: w.block_index, activity_id: w.activity_id, task_id: null })),
      { onConflict: 'user_id,date_key,block_index' }
    );
    if (error) {
      console.error('copyBlocksFromDate error:', error);
      setBlocks(prevBlocks);
      setSaveError();
      return 0;
    }
    invalidateBlockRangeCache();
    setSaved();
    markDateDirty(userId, dateKey, 'block_copy');
    return plan.toWrite.length;
  };

  // ─── Habit mutations ───────────────────────────────────────────────────────
  const addHabit = async (
    name: string,
    type: 'daily' | 'event',
    opts?: { frequency?: 'daily' | 'weekly' | 'times_per_week' | 'weekdays'; target_count?: number | null; weekdays?: number[] | null }
  ) => {
    setSaving();
    const extra = type === 'daily' && opts?.frequency && opts.frequency !== 'daily'
      ? { frequency: opts.frequency, target_count: opts.target_count ?? null, weekdays: opts.weekdays ?? null }
      : {};
    const { data, error } = await supabase
      .from('habits')
      .insert({ name, type, user_id: userId, ...extra })
      .select()
      .single();
    if (error) { console.error('addHabit error:', error); setSaveError(); return; }
    if (data) setHabits((prev) => [...prev, data]);
    setSaved();
    markDateDirty(userId, dateKey, 'habit_added');
  };

  const deleteHabit = async (habitId: string) => {
    setHabits((prev) => prev.filter((h) => h.id !== habitId));
    setSaving();
    // mark_habit_dates_dirty reads habit_logs for this habit, so it must run before the
    // row (and any cascaded logs) are gone.
    await markHabitDirty(userId, habitId, 'habit_deleted');
    const { error } = await supabase.from('habits').delete().eq('id', habitId);
    if (!finishSave(error, 'deleteHabit')) loadData();
  };

  /** Toggle completion of a habit on a date (defaults to the selected date; pass a date to edit history). */
  const toggleDailyHabit = async (habitId: string, forDateKey: string = dateKey) => {
    const log = habitLogs.find((l) => l.habit_id === habitId && l.date_key === forDateKey);
    if (log) {
      setHabitLogs((prev) => prev.filter((l) => l.id !== log.id));
      setSaving();
      const { error } = await supabase.from('habit_logs').delete().eq('id', log.id);
      if (!finishSave(error, 'toggleDailyHabit')) { loadData(); return; }
      markDateDirty(userId, forDateKey, 'habit_log_removed');
    } else {
      const newLog = { habit_id: habitId, user_id: userId, date_key: forDateKey };
      setSaving();
      const { data, error } = await supabase.from('habit_logs').insert(newLog).select().single();
      if (error) { console.error('toggleDailyHabit error:', error); setSaveError(); return; }
      if (data) setHabitLogs((prev) => [...prev, data]);
      setSaved();
      markDateDirty(userId, forDateKey, 'habit_log_added');
    }
  };

  /** Log an event occurrence, optionally with a note and for a specific date. */
  const logEventHabit = async (habitId: string, note?: string, forDateKey: string = dateKey) => {
    const newLog = { habit_id: habitId, user_id: userId, date_key: forDateKey, notes: note?.trim() || null };
    setSaving();
    const { data, error } = await supabase.from('habit_logs').insert(newLog).select().single();
    if (error) { console.error('logEventHabit error:', error); setSaveError(); return; }
    if (data) setHabitLogs((prev) => [...prev, data]);
    setSaved();
    markDateDirty(userId, forDateKey, 'habit_log_added');
  };

  const deleteHabitLog = async (logId: string) => {
    const log = habitLogs.find((l) => l.id === logId);
    setHabitLogs((prev) => prev.filter((l) => l.id !== logId));
    setSaving();
    const { error } = await supabase.from('habit_logs').delete().eq('id', logId);
    if (!finishSave(error, 'deleteHabitLog')) { loadData(); return; }
    markDateDirty(userId, log?.date_key, 'habit_log_removed');
  };

  const updateHabitLogNote = async (logId: string, note: string) => {
    const notes = note.trim() || null;
    setHabitLogs((prev) => prev.map((l) => (l.id === logId ? { ...l, notes } : l)));
    setSaving();
    const { error } = await supabase.from('habit_logs').update({ notes }).eq('id', logId);
    if (!finishSave(error, 'updateHabitLogNote')) loadData();
  };

  // ─── Task mutations ────────────────────────────────────────────────────────
  /**
   * Convert a deadline string from the frontend to a UTC ISO timestamp
   * suitable for a timestamptz column.
   *
   * - "YYYY-MM-DD"       (date-only from chrono or old data)
   *     → interpreted as local midnight → stored as midnight UTC
   *     → when read back, isDateOnly() returns true → shown without time ✓
   *
   * - "YYYY-MM-DDTHH:mm" (datetime-local picker value)
   *     → interpreted as local time → converted to UTC ISO
   *     → when read back, isDateOnly() returns false → shown with time ✓
   */

  const addTask = async (
    title: string,
    description?: string,
    deadline?: string,
    recurrence_type?: string,
    recurrence_rule?: string,
    activity_id?: string | null,
    estimated_minutes?: number | null
  ) => {
    const newTask = {
      title,
      description,
      deadline: toISODeadline(deadline),
      recurrence_type: recurrence_type || 'none',
      recurrence_rule,
      date_key: dateKey,
      user_id: userId,
      urgency: null,
      importance: null,
      activity_id: activity_id || null,
      estimated_minutes: estimated_minutes && estimated_minutes > 0 ? estimated_minutes : null,
    };
    setSaving();
    const { data, error } = await supabase.from('tasks').insert(newTask).select().single();
    if (error) { console.error('addTask error:', error); setSaveError(); return; }
    if (data) setTasks((prev) => [...prev, data]);
    setSaved();
    markDateDirty(userId, dateKey, 'task_added');
  };

  const toggleTask = async (taskId: string, completed: boolean) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    const completed_at = completed ? new Date().toISOString() : null;
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, completed, completed_at } : t)));
    setSaving();
    const { error: toggleError } = await supabase.from('tasks').update({ completed, completed_at }).eq('id', taskId);
    if (toggleError) {
      console.error('toggleTask error:', toggleError);
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, completed: !completed, completed_at: task.completed_at ?? null } : t)));
      setSaveError();
      return;
    }
    markDateDirty(userId, format(new Date(completed_at ?? task.completed_at ?? Date.now()), 'yyyy-MM-dd'), 'task_completion_toggled');
    if (task.completed_at) markDateDirty(userId, format(new Date(task.completed_at), 'yyyy-MM-dd'), 'task_completion_toggled');

    // Generate next occurrence for recurring tasks
    const next = completed && !task.completed ? buildNextOccurrence(task) : null;
    // Uncheck then re-check must not spawn a second copy of the same occurrence
    const alreadySpawned = next && tasks.some((t) =>
      !t.completed && t.title === next.title && t.recurrence_type === next.recurrence_type && t.deadline === next.deadline);
    if (next && !alreadySpawned) {
      const nextTask = { ...next, user_id: userId };
      const { data, error: nextError } = await supabase.from('tasks').insert(nextTask).select().single();
      if (nextError) { console.error('recurring task insert error:', nextError); setSaveError(); return; }
      if (data) setTasks((prev) => [...prev, data]);
    }
    setSaved();
  };

  const updateTask = async (taskId: string, rawUpdates: any) => {
    // Completion always goes through toggleTask, so completed_at, the analytics dirty mark and the next
    // recurring occurrence are handled in one place (the Eisenhower matrix completes tasks through here).
    if ('completed' in rawUpdates) {
      const { completed, ...rest } = rawUpdates;
      await toggleTask(taskId, !!completed);
      if (Object.keys(rest).length === 0) return;
      rawUpdates = rest;
    }
    // Deadlines come from forms as "YYYY-MM-DD" / "YYYY-MM-DDTHH:mm"; store them in the canonical form
    const updates = 'deadline' in rawUpdates ? { ...rawUpdates, deadline: toISODeadline(rawUpdates.deadline) } : rawUpdates;
    const prevTask = tasks.find((t) => t.id === taskId);
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...updates } : t)));
    setSaving();
    const { error } = await supabase.from('tasks').update(updates).eq('id', taskId);
    if (error) { console.error('updateTask error:', error); setSaveError(); return; }
    setSaved();
    if (prevTask && ('date_key' in updates || 'activity_id' in updates)) {
      markDateDirty(userId, prevTask.date_key, 'task_updated');
      if ('date_key' in updates) markDateDirty(userId, updates.date_key, 'task_updated');
    }
  };

  const deleteTask = async (taskId: string) => {
    const removed = tasks.find((t) => t.id === taskId);
    // Every day the task touched, collected before it disappears: its own day, the day it was completed
    // (tasks_completed), and the days of its linked blocks and timer sessions.
    const touchedDates = [
      removed?.date_key,
      removed?.completed_at ? format(new Date(removed.completed_at), 'yyyy-MM-dd') : null,
      ...taskBlocks.filter((b) => b.task_id === taskId).map((b) => b.date_key),
      ...focusSessions.filter((s) => s.task_id === taskId).map((s) => format(new Date(s.started_at), 'yyyy-MM-dd')),
    ];
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    setSaving();
    const { error } = await supabase.from('tasks').delete().eq('id', taskId);
    if (!finishSave(error, 'deleteTask')) { loadData(); return; }
    markDatesDirty(userId, touchedDates, 'task_deleted');
  };

  /**
   * Records one finished focus session: on a task (also bumps its pomodoro count) or on an activity alone
   * (task_id stays null). Blocks are not written here any more: a running session fills them live as it covers
   * them (useFocusSession), so this only logs the time.
   */
  const logFocusSession = async (s: {
    taskId: string | null;
    activityId: string | null;
    minutes: number;
    timerType: 'pomodoro' | 'stopwatch';
    startedAt: Date;
    endedAt: Date;
  }) => {
    if (!userId) return;
    const task = s.taskId ? tasksRef.current.find((t) => t.id === s.taskId) : undefined;
    if (s.taskId && !task) return;
    const minutes = Math.max(0, Math.round(s.minutes));

    if (task) {
      // A pomodoro stopped early is logged as time but doesn't count as a pomodoro
      const pomosToAdd = s.timerType === 'pomodoro' ? (minutes >= 25 ? 1 : 0) : Math.max(1, Math.round(minutes / 25));
      if (pomosToAdd > 0) {
        const newCount = (task.completed_pomodoros || 0) + pomosToAdd;
        setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, completed_pomodoros: newCount } : t)));
        setSaving();
        const { error } = await supabase.from('tasks').update({ completed_pomodoros: newCount }).eq('id', task.id);
        if (error) { console.error('logFocusSession error:', error); setSaveError(); } else setSaved();
      }
    }

    // Persist the real session so focused time survives reloads
    const { data: session, error: sessionError } = await supabase
      .from('task_focus_sessions')
      .insert({
        user_id: userId as string,
        task_id: task?.id ?? null,
        activity_id: s.activityId ?? task?.activity_id ?? null,
        timer_type: s.timerType,
        started_at: s.startedAt.toISOString(),
        ended_at: s.endedAt.toISOString(),
        duration_minutes: minutes,
      })
      .select()
      .single();
    if (sessionError) { console.error('focus session insert error:', sessionError); setSaveError(); }
    else if (session) setFocusSessions((prev) => [...prev, session]);
    markDateDirty(userId, format(s.startedAt, 'yyyy-MM-dd'), 'focus_session_logged');
  };

  // ─── Sleep mutations ───────────────────────────────────────────────────────
  const addSleepLog = async (log: {
    date_key: string;
    sleep_time?: string;
    wake_time?: string;
    total_minutes?: number;
    quality?: number;
    notes?: string;
    factors?: string[];
    energy?: number | null;
  }) => {
    setSaving();
    const payload = { ...log, user_id: userId };
    // Upsert — one sleep log per day
    const { data, error } = await supabase
      .from('sleep_logs')
      .upsert(payload, { onConflict: 'user_id,date_key' })
      .select()
      .single();
    if (error) { console.error('addSleepLog error:', error); setSaveError(); return; }
    if (data) {
      setSleepLogs((prev) => {
        const without = prev.filter((l) => l.date_key !== log.date_key);
        return [data, ...without].sort((a, b) => b.date_key.localeCompare(a.date_key));
      });
    }
    setSaved();
    markDateDirty(userId, log.date_key, 'sleep_log_saved');
  };

  const updateSleepLog = async (id: string, updates: any) => {
    const prevLog = sleepLogs.find((l) => l.id === id);
    setSleepLogs((prev) => prev.map((l) => (l.id === id ? { ...l, ...updates } : l)));
    setSaving();
    const { error } = await supabase.from('sleep_logs').update(updates).eq('id', id);
    if (error) { console.error('updateSleepLog error:', error); setSaveError(); return; }
    setSaved();
    markDatesDirty(userId, [prevLog?.date_key, updates.date_key], 'sleep_log_updated');
  };

  const deleteSleepLog = async (id: string) => {
    const removed = sleepLogs.find((l) => l.id === id);
    setSleepLogs((prev) => prev.filter((l) => l.id !== id));
    setSaving();
    const { error } = await supabase.from('sleep_logs').delete().eq('id', id);
    if (!finishSave(error, 'deleteSleepLog')) { loadData(); return; }
    markDateDirty(userId, removed?.date_key, 'sleep_log_deleted');
  };

  // ─── Goal mutations ────────────────────────────────────────────────────────
  const addGoal = async (goal: any, linkedActivityIds: string[], linkedHabitIds: string[]) => {
    setSaving();
    // Links live in array columns on the goals row (no separate link tables exist).
    const payload = {
      ...goal,
      target_date: toISODeadline(goal.target_date),
      linked_activity_ids: linkedActivityIds,
      linked_habit_ids: linkedHabitIds,
      user_id: userId,
    };
    const { data, error } = await supabase
      .from('goals')
      .insert(payload)
      .select()
      .single();
    if (error) { console.error('addGoal error:', error); setSaveError(); return; }
    if (data) setGoals((prev) => [...prev, data]);
    setSaved();
    if (data) markGoalDirty(userId, data.id, 'goal_added');
  };

  const updateGoal = async (goalId: string, updates: any) => {
    setGoals((prev) => prev.map((g) => (g.id === goalId ? { ...g, ...updates } : g)));
    setSaving();
    const { error } = await supabase.from('goals').update(updates).eq('id', goalId);
    if (error) { console.error('updateGoal error:', error); setSaveError(); return; }
    setSaved();
    markGoalDirty(userId, goalId, 'goal_updated');
  };

  const deleteGoal = async (goalId: string) => {
    setGoals((prev) => prev.filter((g) => g.id !== goalId));
    setSaving();
    // mark_goal_dates_dirty reads the goal's created_at, so it must run before the
    // row is gone.
    await markGoalDirty(userId, goalId, 'goal_deleted');
    const { error } = await supabase.from('goals').delete().eq('id', goalId);
    if (!finishSave(error, 'deleteGoal')) loadData();
  };

  const completeGoal = async (goalId: string, completionNote?: string) => {
    const updates = { status: 'completed', completion_note: completionNote || null, updated_at: new Date().toISOString() };
    setGoals((prev) => prev.map((g) => (g.id === goalId ? { ...g, ...updates } : g)));
    setSaving();
    const { error } = await supabase.from('goals').update(updates).eq('id', goalId);
    if (!finishSave(error, 'completeGoal')) { loadData(); return; }
    markGoalDirty(userId, goalId, 'goal_completed');
  };

  const abandonGoal = async (goalId: string) => {
    const updates = { status: 'abandoned', updated_at: new Date().toISOString() };
    setGoals((prev) => prev.map((g) => (g.id === goalId ? { ...g, ...updates } : g)));
    setSaving();
    const { error } = await supabase.from('goals').update(updates).eq('id', goalId);
    if (!finishSave(error, 'abandonGoal')) { loadData(); return; }
    markGoalDirty(userId, goalId, 'goal_abandoned');
  };

  // ─── Reviews (day / week / month reflections) ─────────────────────────────
  const saveReview = async (
    periodType: 'day' | 'week' | 'month',
    periodKey: string,
    fields: { planned: string; happened: string; changed: string; carry_over: string; energy?: number | null }
  ) => {
    setSaving();
    const payload = {
      user_id: userId as string,
      period_type: periodType,
      period_key: periodKey,
      planned: fields.planned.trim() || null,
      happened: fields.happened.trim() || null,
      changed: fields.changed.trim() || null,
      carry_over: fields.carry_over.trim() || null,
      // Only day reflections carry an energy rating; week/month saves leave the column alone
      ...(fields.energy !== undefined ? { energy: fields.energy } : {}),
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from('reviews')
      .upsert(payload, { onConflict: 'user_id,period_type,period_key' })
      .select()
      .single();
    if (!finishSave(error, 'saveReview')) return;
    if (data) setReviews((prev) => [...prev.filter((r) => !(r.period_type === periodType && r.period_key === periodKey)), data]);
  };

  // ─── Settings mutations ────────────────────────────────────────────────────
  const updateUserSettings = async (updates: Partial<UserSettings>) => {
    setUserSettings((prev) => ({ ...prev, ...updates } as UserSettings));
    setSaving();
    const { error } = await supabase
      .from('user_settings')
      .upsert({ user_id: userId, ...updates } as UserSettingsInsert, { onConflict: 'user_id' });
    if (error) { console.error('updateUserSettings error:', error); setSaveError(); return; }
    setSaved();
  };

  return {
    // State
    loading,
    saveStatus,
    activities,
    habits,
    habitLogs,
    tasks,
    blocks,
    dailyStats,
    sleepLogs,
    goals,
    userSettings,

    // Activity
    addActivity,
    updateActivity,
    archiveActivity,

    // Habit
    addHabit,
    deleteHabit,
    toggleDailyHabit,
    reviews,
    saveReview,
    logEventHabit,
    deleteHabitLog,
    updateHabitLogNote,

    // Task
    addTask,
    toggleTask,
    updateTask,
    deleteTask,
    logFocusSession,
    focusSessions,
    taskBlocks,

    // Blocks
    assignBlocks,
    assignBlocksOn,
    previewCopyFromDate,
    copyBlocksFromDate,

    // Sleep
    addSleepLog,
    updateSleepLog,
    deleteSleepLog,

    // Goals
    addGoal,
    updateGoal,
    deleteGoal,
    completeGoal,
    abandonGoal,

    // Settings
    updateUserSettings,
  };
}
