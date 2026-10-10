import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Activity, Task } from '../types';
import { blockKey, blocksToFill, focusedMinutes, type FocusSegment } from '../lib/focusFill';

/**
 * The focus session lives here, above the pages, so the timer keeps running (and keeps filling the grid) while you
 * use the rest of the app, and survives a reload (it is saved to localStorage on every change). Time is always read
 * from the wall clock, never counted in ticks. This provider only re-renders on real events (start, pause, a block
 * filled, a pomodoro finished); the screens that show the clock tick on their own (useFocusClock).
 */

export type TimerMode = 'focus' | 'short-break' | 'long-break';
export type TimerType = 'pomodoro' | 'stopwatch';
/** A goal target fills the grid with one of the goal's linked activities, so the time counts toward the goal at once. */
export type FocusTarget = { kind: 'task'; id: string } | { kind: 'activity'; id: string } | { kind: 'goal'; id: string; activityId: string };

export const MODE_DURATIONS: Record<TimerMode, number> = {
  'focus': 25 * 60,
  'short-break': 5 * 60,
  'long-break': 15 * 60,
};
export const SESSIONS_BEFORE_LONG_BREAK = 4;
const FILL_CHECK_MS = 15_000;

interface FocusState {
  target: FocusTarget | null;
  timerType: TimerType;
  mode: TimerMode;
  /** when the current running stretch started; null while paused/stopped */
  runningSince: number | null;
  /** seconds left (pomodoro) or seconds elapsed (stopwatch) at runningSince, or now when not running */
  baseSeconds: number;
  /** focus sessions finished since the last long break (drives the pomodoro dots and the break length) */
  focusCount: number;
  /** active focus time of the session in progress (breaks and pauses are the gaps) */
  segments: FocusSegment[];
  /** blocks this session already wrote, as date|index, so they are never rewritten (an edit made meanwhile sticks) */
  filled: string[];
}

const initialState = (): FocusState => ({
  target: null, timerType: 'pomodoro', mode: 'focus', runningSince: null,
  baseSeconds: MODE_DURATIONS.focus, focusCount: 0, segments: [], filled: [],
});

const storageKey = (userId: string) => `blockday.focusSession.${userId}`;
const readState = (userId: string): FocusState => {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return initialState();
    const s = JSON.parse(raw);
    return { ...initialState(), ...s, segments: Array.isArray(s.segments) ? s.segments : [], filled: Array.isArray(s.filled) ? s.filled : [] };
  } catch { return initialState(); }
};

/** Seconds on the clock face at `now`: time left for a pomodoro, time elapsed for the stopwatch. */
export const clockSeconds = (s: Pick<FocusState, 'runningSince' | 'baseSeconds' | 'timerType'>, now: number) => {
  if (s.runningSince === null) return s.baseSeconds;
  const elapsed = Math.floor((now - s.runningSince) / 1000);
  return s.timerType === 'pomodoro' ? Math.max(0, s.baseSeconds - elapsed) : s.baseSeconds + elapsed;
};

export interface LogFocusSession {
  (s: { taskId: string | null; activityId: string | null; minutes: number; timerType: TimerType; startedAt: Date; endedAt: Date }): Promise<void> | void;
}
export type AssignBlocksOn = (dateKey: string, indices: number[], activityId: string | null, taskId: string | null) => Promise<void> | void;

interface FocusSessionValue extends FocusState {
  isActive: boolean;
  /** the activity the grid gets filled with (the task's activity for a task), null if there is none */
  fillActivityId: string | null;
  setTarget: (t: FocusTarget | null) => void;
  toggle: () => void;
  stop: () => void;
  skipBreak: () => void;
  switchMode: (m: TimerMode) => void;
  switchTimerType: (t: TimerType) => void;
}

const FocusSessionContext = createContext<FocusSessionValue | null>(null);

export const useFocusSession = () => {
  const v = useContext(FocusSessionContext);
  if (!v) throw new Error('useFocusSession must be used inside FocusSessionProvider');
  return v;
};

/** Same, but null outside the provider (for components that also render on their own, e.g. in tests). */
export const useOptionalFocusSession = () => useContext(FocusSessionContext);

/** Ticks the caller (only) while the timer runs, and returns the clock face value. */
export const useFocusClock = (intervalMs = 250) => {
  const s = useFocusSession();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (s.runningSince === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    const onWake = () => { if (document.visibilityState === 'visible') setNow(Date.now()); };
    document.addEventListener('visibilitychange', onWake);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onWake); };
  }, [s.runningSince, intervalMs]);
  return clockSeconds(s, s.runningSince === null ? Date.now() : Math.max(now, s.runningSince));
};

interface ProviderProps {
  userId: string;
  tasks: Task[];
  activities: Activity[];
  assignBlocksOn: AssignBlocksOn;
  logFocusSession: LogFocusSession;
  children: React.ReactNode;
}

export const FocusSessionProvider: React.FC<ProviderProps> = ({ userId, tasks, activities, assignBlocksOn, logFocusSession, children }) => {
  const [state, setState] = useState<FocusState>(() => readState(userId));
  const stateRef = useRef(state);
  stateRef.current = state;
  // Every change goes through here so the ref is current at once: a second check in the same tick (StrictMode runs
  // effects twice) must see that a pomodoro was already finished and logged, or it would log it again.
  const commit = (next: FocusState) => {
    stateRef.current = next;
    setState(next);
  };

  // The data callbacks change on every render of the app; the timer reads the latest through refs
  const io = useRef({ tasks, activities, assignBlocksOn, logFocusSession });
  io.current = { tasks, activities, assignBlocksOn, logFocusSession };

  useEffect(() => {
    try { localStorage.setItem(storageKey(userId), JSON.stringify(state)); } catch { /* storage unavailable: the session still runs in memory */ }
  }, [userId, state]);

  const fillActivityFor = (target: FocusTarget | null): { activityId: string | null; taskId: string | null } => {
    if (!target) return { activityId: null, taskId: null };
    if (target.kind === 'activity') return { activityId: target.id, taskId: null };
    if (target.kind === 'goal') return { activityId: target.activityId, taskId: null };
    const task = io.current.tasks.find((t) => t.id === target.id);
    return { activityId: task?.activity_id ?? null, taskId: task?.id ?? null };
  };

  /** Writes every block the segments have covered enough by `now`; returns the updated filled list. */
  const fill = (s: FocusState, now: number): string[] => {
    const { activityId, taskId } = fillActivityFor(s.target);
    if (!activityId || s.segments.length === 0) return s.filled;
    const due = blocksToFill(s.segments, now, new Set(s.filled));
    if (due.length === 0) return s.filled;
    for (const d of due) void io.current.assignBlocksOn(d.dateKey, d.indices, activityId, taskId);
    return [...s.filled, ...due.flatMap((d) => d.indices.map((i) => blockKey(d.dateKey, i)))];
  };

  /** Closes the focus time in progress at `at`: fills its last blocks and logs it. Returns the state after. */
  const finishFocus = (s: FocusState, at: number): FocusState => {
    const segments = s.segments.map((g) => (g.end === null ? { ...g, end: at } : g));
    const closed = { ...s, segments };
    fill(closed, at);
    const minutes = focusedMinutes(segments, at);
    const { activityId, taskId } = fillActivityFor(s.target);
    if (segments.length > 0 && minutes >= 1 && (taskId || activityId)) {
      void io.current.logFocusSession({
        taskId, activityId, minutes, timerType: s.timerType,
        startedAt: new Date(segments[0].start), endedAt: new Date(at),
      });
    }
    return { ...closed, segments: [], filled: [] };
  };

  // Background check: fill blocks as they get covered, and finish a pomodoro (or break) when its time is up,
  // even if the Focus page isn't open or the tab slept through the end.
  useEffect(() => {
    if (state.runningSince === null) return;
    const check = () => {
      const s = stateRef.current;
      if (s.runningSince === null) return;
      // right after a reload the task list may not be in yet; wait for it rather than log a pomodoro without its task
      if (s.target?.kind === 'task' && io.current.tasks.length === 0) return;
      const now = Date.now();
      if (s.timerType === 'pomodoro' && clockSeconds(s, now) <= 0) {
        const endAt = s.runningSince + s.baseSeconds * 1000; // the real end, even if we only notice later
        if (s.mode === 'focus') {
          const done = finishFocus(s, endAt);
          const count = s.focusCount + 1;
          const next: TimerMode = count % SESSIONS_BEFORE_LONG_BREAK === 0 ? 'long-break' : 'short-break';
          commit({ ...done, focusCount: count, mode: next, runningSince: null, baseSeconds: MODE_DURATIONS[next] });
        } else {
          commit({ ...s, mode: 'focus', runningSince: null, baseSeconds: MODE_DURATIONS.focus });
        }
        return;
      }
      if (s.mode === 'focus') {
        const filled = fill(s, now);
        if (filled !== s.filled) commit({ ...s, filled });
      }
    };
    check();
    const fast = setInterval(() => {
      // pomodoro end needs second precision; filling only needs a check every few seconds
      const s = stateRef.current;
      if (s.timerType === 'pomodoro' && s.runningSince !== null && clockSeconds(s, Date.now()) <= 0) check();
    }, 1000);
    const slow = setInterval(check, FILL_CHECK_MS);
    const onWake = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onWake);
    return () => { clearInterval(fast); clearInterval(slow); document.removeEventListener('visibilitychange', onWake); };
  }, [state.runningSince, tasks.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = useCallback(() => {
    const s = stateRef.current;
    const now = Date.now();
    if (s.runningSince === null) {
      if (s.mode === 'focus' && !s.target) return;
      commit({
        ...s,
        runningSince: now,
        segments: s.mode === 'focus' ? [...s.segments, { start: now, end: null }] : s.segments,
      });
    } else {
      const paused = { ...s, segments: s.segments.map((g) => (g.end === null ? { ...g, end: now } : g)) };
      commit({ ...paused, filled: fill(paused, now), runningSince: null, baseSeconds: clockSeconds(s, now) });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Ends the session: logs the focus time so far, and resets the clock for the current timer type. */
  const reset = (s: FocusState, timerType: TimerType, mode: TimerMode, extra: Partial<FocusState> = {}) => {
    const now = Date.now();
    const done = s.mode === 'focus' ? finishFocus(s, now) : s;
    commit({ ...done, ...extra, timerType, mode, runningSince: null, baseSeconds: timerType === 'pomodoro' ? MODE_DURATIONS[mode] : 0 });
  };

  const stop = useCallback(() => {
    const s = stateRef.current;
    const minutes = focusedMinutes(s.segments, Date.now());
    // a stopwatch session counts toward the pomodoro set by its length, like a run of pomodoros
    const extra = s.timerType === 'stopwatch' && s.mode === 'focus' && minutes >= 1
      ? { focusCount: s.focusCount + Math.max(1, Math.floor(minutes / 25)) } : {};
    reset(s, s.timerType, 'focus', extra);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const skipBreak = useCallback(() => {
    const s = stateRef.current;
    if (s.mode !== 'focus') reset(s, s.timerType, 'focus');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const switchMode = useCallback((m: TimerMode) => reset(stateRef.current, stateRef.current.timerType, m), []); // eslint-disable-line react-hooks/exhaustive-deps
  const switchTimerType = useCallback((t: TimerType) => reset(stateRef.current, t, 'focus'), []); // eslint-disable-line react-hooks/exhaustive-deps

  const setTarget = useCallback((target: FocusTarget | null) => {
    const s = stateRef.current;
    // Changing what you focus on ends the focus time in progress, so it is logged under what it really was
    if (s.segments.length > 0 && s.mode === 'focus') {
      const done = finishFocus({ ...s, runningSince: null }, Date.now());
      commit({ ...done, target, runningSince: null, baseSeconds: s.timerType === 'pomodoro' ? MODE_DURATIONS.focus : 0 });
      return;
    }
    commit({ ...s, target });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fillActivityId = useMemo(() => {
    if (!state.target) return null;
    if (state.target.kind === 'activity') return state.target.id;
    if (state.target.kind === 'goal') return state.target.activityId;
    return tasks.find((t) => t.id === state.target!.id)?.activity_id ?? null;
  }, [state.target, tasks]);

  const value = useMemo<FocusSessionValue>(() => ({
    ...state,
    isActive: state.runningSince !== null,
    fillActivityId,
    setTarget, toggle, stop, skipBreak, switchMode, switchTimerType,
  }), [state, fillActivityId, setTarget, toggle, stop, skipBreak, switchMode, switchTimerType]);

  return <FocusSessionContext.Provider value={value}>{children}</FocusSessionContext.Provider>;
};
