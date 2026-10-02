import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { format } from 'date-fns';
import { toISODeadline } from '../lib/deadlines';
import { fetchAllRows } from '../lib/paging';
import { planCopy, type CopyPlan } from '../lib/copyDay';
import { invalidateBlockRangeCache } from './useBlockRange';
import { nextOccurrence } from '../lib/recurrence';
import { markDateDirty, markDatesDirty, markActivityDirty, markGoalDirty, markHabitDirty, drainOnStartup } from '../lib/analyticsInvalidation';
import type { Database } from '../database.types';
import type { DailyStats, Goal, HabitLog, Review, SleepLog, TaskBlockRef, TaskFocusSession, UserSettings } from '../types';

type UserSettingsInsert = Database['public']['Tables']['user_settings']['Insert'];

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

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

  // ─── Save status helpers ───────────────────────────────────────────────────
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextRealtimeSync = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setSelfMutation = () => {
    if (skipNextRealtimeSync.current) clearTimeout(skipNextRealtimeSync.current);
    skipNextRealtimeSync.current = setTimeout(() => {
      skipNextRealtimeSync.current = null;
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
    if (skipNextRealtimeSync.current) clearTimeout(skipNextRealtimeSync.current);
  }, []);

  // ─── Data loading ──────────────────────────────────────────────────────────
  const loadData = useCallback(async (isRealtimeEvent = false) => {
    if (!userId) return;
    if (isRealtimeEvent && skipNextRealtimeSync.current) return;

    const cacheKey = `blockday_data_${userId}_${dateKey}`;
    if (!isRealtimeEvent && loading) {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (parsed.activities) setActivities(parsed.activities);
          if (parsed.habits) setHabits(parsed.habits);
          if (parsed.habitLogs) setHabitLogs(parsed.habitLogs);
          if (parsed.tasks) setTasks(parsed.tasks);
          if (parsed.blocks) setBlocks(parsed.blocks);
          if (parsed.dailyStats) setDailyStats(parsed.dailyStats);
          if (parsed.sleepLogs) setSleepLogs(parsed.sleepLogs);
          if (parsed.goals) setGoals(parsed.goals);
          if (parsed.userSettings) setUserSettings(parsed.userSettings);
        } catch (e) {}
      }
    }

    setLoading(true);

    try {
      const [
        { data: actData },
        { data: habData },
        { data: logData },
        { data: taskData },
        { data: blockData },
        { data: statsData },
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
        supabase.from('time_blocks').select('id, user_id, date_key, block_index, activity_id, task_id, notes').eq('user_id', userId).eq('date_key', dateKey),
        supabase.from('daily_stats').select('*').eq('user_id', userId).eq('date_key', dateKey).maybeSingle(),
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
      if (statsData) setDailyStats(statsData);
      if (sleepData) setSleepLogs(sleepData);
      if (goalsData) setGoals(goalsData);
      if (settingsData) setUserSettings(settingsData);
      if (sessionData) setFocusSessions(sessionData);
      if (reviewData) setReviews(reviewData);
      if (taskBlockData) setTaskBlocks(taskBlockData as TaskBlockRef[]);

      // Always 144 blocks
      const fullBlocks = Array.from({ length: 144 }, (_, i) => {
        const existing = blockData?.find((b: any) => b.block_index === i);
        return existing || { block_index: i, activity_id: null, date_key: dateKey, user_id: userId };
      });
      setBlocks(fullBlocks);

      // Cache the loaded data
      localStorage.setItem(`blockday_data_${userId}_${dateKey}`, JSON.stringify({
        activities: actData, habits: habData, habitLogs: logData, tasks: taskData,
        blocks: fullBlocks, dailyStats: statsData, sleepLogs: sleepData, goals: goalsData,
        userSettings: settingsData
      }));
    } catch (e) {
      console.error('loadData error:', e);
    } finally {
      setLoading(false);
    }
  }, [userId, dateKey]);

  useEffect(() => {
    loadData();

    if (!userId) return;

    drainOnStartup(userId); // mop up any dirty dates left over from a prior session

    const channel = supabase
      .channel('public-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public' }, () => {
        loadData(true);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadData, userId]);

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
  const assignBlocks = async (blockIndices: number[], activityId: string | null, taskId: string | null = null) => {
    // A task link only makes sense together with an activity
    const linkedTaskId = activityId ? taskId : null;
    // Snapshot for rollback
    const prevBlocks = blocks;
    const prevTaskBlocks = taskBlocks;
    // Optimistic update
    setBlocks((prev) =>
      prev.map((b) => (blockIndices.includes(b.block_index) ? { ...b, activity_id: activityId, task_id: linkedTaskId } : b))
    );
    setTaskBlocks((prev) => {
      const kept = prev.filter((r) => !(r.date_key === dateKey && blockIndices.includes(r.block_index)));
      return linkedTaskId
        ? [...kept, ...blockIndices.map((idx) => ({ date_key: dateKey, block_index: idx, task_id: linkedTaskId }))]
        : kept;
    });
    setSaving();

    try {
      const updates = blockIndices.map((idx) => ({
        user_id: userId,
        date_key: dateKey,
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
      markDateDirty(userId, dateKey, 'block_assign');
    } catch (e) {
      console.error('assignBlocks error:', e);
      setBlocks(prevBlocks);
      setTaskBlocks(prevTaskBlocks);
      setSaveError();
    }
  };

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
    if (completed && task.recurrence_type && task.recurrence_type !== 'none') {
      const nextTask = {
        title: task.title,
        description: task.description,
        deadline: nextOccurrence(task.deadline, task.recurrence_type, task.recurrence_rule),
        recurrence_type: task.recurrence_type,
        recurrence_rule: task.recurrence_rule,
        date_key: task.date_key,
        user_id: userId,
        urgency: task.urgency,
        importance: task.importance,
        activity_id: task.activity_id,
        completed: false,
      };
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

  const logFocusSession = async (taskId: string, elapsedMinutes: number, timerType: 'pomodoro' | 'stopwatch' = 'pomodoro') => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    const pomosToAdd = Math.max(1, Math.round(elapsedMinutes / 25));
    const newCount = (task.completed_pomodoros || 0) + pomosToAdd;

    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, completed_pomodoros: newCount } : t)));
    setSaving();
    const { error } = await supabase.from('tasks').update({ completed_pomodoros: newCount }).eq('id', taskId);
    if (error) { console.error('logFocusSession error:', error); setSaveError(); } else setSaved();

    // Persist the real session so focused time survives reloads
    const endedAt = new Date();
    const startedAt = new Date(endedAt.getTime() - elapsedMinutes * 60000);
    const { data: session, error: sessionError } = await supabase
      .from('task_focus_sessions')
      .insert({
        user_id: userId as string,
        task_id: taskId,
        activity_id: task.activity_id ?? null,
        timer_type: timerType,
        started_at: startedAt.toISOString(),
        ended_at: endedAt.toISOString(),
        duration_minutes: Math.max(0, Math.round(elapsedMinutes)),
      })
      .select()
      .single();
    if (sessionError) { console.error('focus session insert error:', sessionError); setSaveError(); }
    else if (session) setFocusSessions((prev) => [...prev, session]);
    markDateDirty(userId, format(startedAt, 'yyyy-MM-dd'), 'focus_session_logged');

    if (task.activity_id) {
      const now = new Date();
      if (format(now, 'yyyy-MM-dd') === dateKey) {
        const currentBlockIndex = Math.floor((now.getHours() * 60 + now.getMinutes()) / 10);
        const blocksToFill = Math.ceil(elapsedMinutes / 10);
        const indices: number[] = [];
        for (let i = 0; i < blocksToFill; i++) {
          const idx = currentBlockIndex - i;
          if (idx >= 0) indices.push(idx);
        }
        if (indices.length > 0) {
          assignBlocks(indices, task.activity_id, task.id);
        }
      }
    }
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
