import React, { useMemo, useState } from 'react';
import {
  Play,
  Pause,
  Square,
  SkipForward,
  Flame,
  Zap,
  ChevronDown,
  Coffee,
  Brain,
  Timer,
  Grid2x2,
} from 'lucide-react';
import { format } from 'date-fns';

import type { Activity, Goal, Task, TaskFocusSession } from '../types';
import { getSleepActivityIds } from '../lib/sleepActivity';
import { formatClock } from './FocusPill';
import { MODE_DURATIONS, SESSIONS_BEFORE_LONG_BREAK, useFocusClock, useFocusSession, type TimerMode } from '../hooks/useFocusSession';

interface FocusModeProps {
  goals: Goal[];
  tasks: Task[];
  activities: Activity[];
  focusSessions: TaskFocusSession[];
}

const MODE_LABELS: Record<TimerMode, string> = {
  'focus': 'Focus',
  'short-break': 'Short Break',
  'long-break': 'Long Break',
};

const RING_SIZE = 280;
const RING_STROKE = 6;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const STOPWATCH_CYCLE = 25 * 60; // the stopwatch ring loops every 25 minutes

interface PickItem { id: string; label: string; color?: string }

/** Focus: a pomodoro or stopwatch on a task or an activity. While it runs it fills today's grid (useFocusSession). */
export const FocusMode: React.FC<FocusModeProps> = ({ goals, tasks, activities, focusSessions }) => {
  const focus = useFocusSession();
  const timeLeft = useFocusClock();
  const { mode, timerType, isActive, target, focusCount } = focus;
  const [pickKind, setPickKind] = useState<'task' | 'activity' | 'goal'>(target?.kind ?? 'task');
  const [pickerOpen, setPickerOpen] = useState(false);

  const colorOf = (activityId: string | null | undefined) => activities.find((a) => a.id === activityId)?.color;
  const taskItems: PickItem[] = useMemo(
    () => tasks.filter((t) => !t.completed || (target?.kind === 'task' && target.id === t.id)).map((t) => ({ id: t.id, label: t.title, color: colorOf(t.activity_id) })),
    [tasks, activities, target] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const activityItems: PickItem[] = useMemo(() => {
    const sleep = getSleepActivityIds(activities);
    return activities.filter((a) => !a.archived && !sleep.has(a.id)).map((a) => ({ id: a.id, label: a.name, color: a.color }));
  }, [activities]);
  // One entry per (active goal, linked activity): the activity is what gets written to the grid, so the goal grows directly
  const goalItems: PickItem[] = useMemo(() => goals.filter((g) => g.status === 'active').flatMap((g) =>
    (g.linked_activity_ids ?? []).flatMap((aid) => {
      const a = activities.find((x) => x.id === aid);
      return a && !a.archived ? [{ id: `${g.id}:${aid}`, label: `${g.emoji ?? '🎯'} ${g.title} · ${a.name}`, color: a.color }] : [];
    })), [goals, activities]);
  const itemsByKind = { task: taskItems, activity: activityItems, goal: goalItems };
  const items = itemsByKind[pickKind];
  const targetItemId = target ? (target.kind === 'goal' ? `${target.id}:${target.activityId}` : target.id) : null;
  const chosen = target ? itemsByKind[target.kind].find((i) => i.id === targetItemId) : undefined;
  const fillActivity = activities.find((a) => a.id === focus.fillActivityId);

  const totalDuration = MODE_DURATIONS[mode];
  const progress = timerType === 'stopwatch'
    ? (timeLeft % STOPWATCH_CYCLE) / STOPWATCH_CYCLE
    : totalDuration > 0 ? (totalDuration - timeLeft) / totalDuration : 0;
  const strokeDashoffset = RING_CIRCUMFERENCE * (1 - progress);

  // Today's logged focus (tasks and activities), from the saved sessions so it survives a reload
  const today = useMemo(() => {
    const key = format(new Date(), 'yyyy-MM-dd');
    const list = focusSessions.filter((s) => format(new Date(s.started_at), 'yyyy-MM-dd') === key);
    return {
      sessions: list,
      minutes: list.reduce((sum, s) => sum + (s.duration_minutes || 0), 0),
    };
  }, [focusSessions]);
  const historySegments = today.sessions.map((s) => {
    const a = activities.find((x) => x.id === s.activity_id);
    const t = tasks.find((x) => x.id === s.task_id);
    return { id: s.id, minutes: s.duration_minutes || 0, color: a?.color || 'hsl(var(--primary))', label: `${t?.title ?? a?.name ?? 'Focus'} · ${s.duration_minutes} min` };
  });

  const currentSetIndex = focusCount % SESSIONS_BEFORE_LONG_BREAK;
  const ringColor = mode === 'focus' ? 'hsl(var(--primary))' : mode === 'short-break' ? 'hsl(142 71% 45%)' : 'hsl(217 91% 60%)';
  const atRest = timerType === 'pomodoro' ? (!isActive && timeLeft === totalDuration && focus.segments.length === 0) : (!isActive && timeLeft === 0);
  const filledCount = focus.filled.length;

  return (
    <div className="flex flex-col flex-1 h-full items-center bg-background px-4 py-6 sm:py-8 overflow-y-auto">
      <div className="flex flex-col items-center w-full my-auto">
        {/* Type & mode */}
        <div className="flex flex-col items-center gap-3 mb-6 sm:mb-8">
          <div className="flex items-center rounded-full bg-muted p-1">
            {(['pomodoro', 'stopwatch'] as const).map((t) => (
              <button
                key={t}
                onClick={() => focus.switchTimerType(t)}
                className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${timerType === t ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {t === 'pomodoro' ? 'Pomodoro' : 'Stopwatch'}
              </button>
            ))}
          </div>
          {timerType === 'pomodoro' && (
            <div className="flex items-center gap-1 rounded-full bg-muted/50 p-1">
              {(['focus', 'short-break', 'long-break'] as TimerMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => focus.switchMode(m)}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-medium transition-all ${mode === m ? 'bg-card text-foreground shadow-sm border border-border/50' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {MODE_LABELS[m]}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Timer ring */}
        <div className="relative mb-6 w-[min(280px,72vw)] aspect-square">
          <svg viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} className="w-full h-full transform -rotate-90">
            <circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS} fill="none" stroke="hsl(var(--border))" strokeWidth={RING_STROKE} />
            <circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              fill="none"
              stroke={ringColor}
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={strokeDashoffset}
              className="transition-all duration-1000 ease-linear"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="flex items-center gap-1.5 mb-2 text-muted-foreground">
              {mode === 'focus' ? <Brain size={16} /> : <Coffee size={16} />}
              <span className="text-[11px] font-semibold">{MODE_LABELS[mode]}</span>
            </div>
            <span className="ibm-mono font-bold text-foreground leading-none text-[clamp(40px,14vw,64px)]">{formatClock(timeLeft)}</span>
          </div>
        </div>

        {timerType === 'pomodoro' ? (
          <>
            <span className="text-xs text-muted-foreground mb-2">Focus {currentSetIndex + (mode === 'focus' ? 1 : 0)} of {SESSIONS_BEFORE_LONG_BREAK}</span>
            <div className="flex items-center gap-1.5 mb-6 sm:mb-8">
              {Array.from({ length: SESSIONS_BEFORE_LONG_BREAK }, (_, i) => (
                <div
                  key={i}
                  className={`w-2.5 h-2.5 rounded-full transition-colors ${i < currentSetIndex ? 'bg-primary' : i === currentSetIndex && mode === 'focus' ? 'bg-primary/40 ring-2 ring-primary/30' : 'bg-border'}`}
                />
              ))}
            </div>
          </>
        ) : <div className="mb-6 sm:mb-8" />}

        {/* Controls */}
        <div className="flex items-center gap-4 mb-6 sm:mb-8">
          <button
            onClick={focus.stop}
            disabled={atRest}
            aria-label="Stop and log"
            title="Stop and log the focus time"
            className="flex items-center justify-center w-12 h-12 rounded-full bg-muted text-muted-foreground disabled:opacity-30 hover:bg-accent hover:text-accent-foreground active:scale-95 transition-all"
          >
            <Square size={18} />
          </button>
          <button
            onClick={focus.toggle}
            disabled={!target && mode === 'focus'}
            aria-label={isActive ? 'Pause' : 'Start'}
            title={!target && mode === 'focus' ? 'Pick a task, activity or goal first' : undefined}
            className="flex items-center justify-center w-16 h-16 rounded-full bg-primary text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 active:scale-95 transition-all shadow-lg"
          >
            {isActive ? <Pause size={24} /> : <Play size={24} className="ml-1" />}
          </button>
          {mode !== 'focus' ? (
            <button
              onClick={focus.skipBreak}
              aria-label="Skip break"
              className="flex items-center justify-center w-12 h-12 rounded-full bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground active:scale-95 transition-all"
            >
              <SkipForward size={18} />
            </button>
          ) : <div className="w-12 h-12" />}
        </div>

        {/* What to focus on */}
        <div className="w-full max-w-sm mb-6 sm:mb-8">
          <div className="flex items-center justify-center mb-2">
            <div className="flex items-center rounded-full bg-muted p-0.5" role="tablist" aria-label="Focus on">
              {(['task', 'activity', 'goal'] as const).map((k) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={pickKind === k}
                  onClick={() => { setPickKind(k); setPickerOpen(false); }}
                  className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-all ${pickKind === k ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {k === 'task' ? 'Task' : k === 'activity' ? 'Activity' : 'Goal'}
                </button>
              ))}
            </div>
          </div>
          <div className="relative">
            <button
              onClick={() => setPickerOpen((o) => !o)}
              disabled={isActive}
              title={isActive ? 'Pause or stop to change what you focus on' : undefined}
              className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-border bg-card text-sm text-foreground hover:bg-accent/50 disabled:opacity-70 disabled:cursor-not-allowed transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                {chosen?.color && <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: chosen.color }} />}
                <span className={`truncate ${chosen ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {chosen && target?.kind === pickKind ? chosen.label : chosen ? `${chosen.label} (${target!.kind})` : pickKind === 'task' ? 'Select a task to focus on…' : pickKind === 'activity' ? 'Select an activity to focus on…' : 'Select a goal to focus on…'}
                </span>
              </div>
              <ChevronDown size={14} className={`text-muted-foreground transition-transform flex-shrink-0 ${pickerOpen ? 'rotate-180' : ''}`} />
            </button>
            {pickerOpen && !isActive && (
              <div className="absolute top-full left-0 right-0 mt-1 py-1 rounded-xl border border-border bg-card shadow-lg z-40 max-h-56 overflow-y-auto">
                {items.length === 0 ? (
                  <div className="px-4 py-3 text-xs text-muted-foreground text-center">{pickKind === 'task' ? 'No incomplete tasks.' : pickKind === 'activity' ? 'No activities yet.' : 'No active goal has a linked activity. Link one on the Goals page.'}</div>
                ) : items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      if (pickKind === 'goal') { const [goalId, activityId] = item.id.split(':'); focus.setTarget({ kind: 'goal', id: goalId, activityId }); }
                      else focus.setTarget({ kind: pickKind, id: item.id });
                      setPickerOpen(false);
                    }}
                    className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-accent transition-colors ${target?.kind === pickKind && targetItemId === item.id ? 'bg-primary/5' : ''}`}
                  >
                    {item.color && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />}
                    <span className="text-sm text-foreground truncate">{item.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {target && (
            <p className="mt-2 text-[11px] text-muted-foreground flex items-center justify-center gap-1.5 text-center">
              <Grid2x2 size={12} className="flex-shrink-0" />
              {fillActivity
                ? <span>Fills today's grid with <strong className="text-foreground font-medium">{fillActivity.name}</strong> as you go{filledCount > 0 ? ` · ${filledCount} block${filledCount === 1 ? '' : 's'} so far` : ''}</span>
                : <span>This task has no activity, so the grid isn't filled. Give it one, or focus on an activity.</span>}
            </p>
          )}
        </div>

        {/* Today's focus */}
        {historySegments.length > 0 && (
          <div className="w-full max-w-sm mb-6 sm:mb-8">
            <div className="flex items-center gap-1.5 mb-2">
              <Timer size={12} className="text-muted-foreground" />
              <span className="text-[11px] font-semibold text-muted-foreground">Today's Focus</span>
            </div>
            <div className="flex gap-0.5 rounded-lg overflow-hidden h-3 bg-muted">
              {historySegments.map((seg) => (
                <div key={seg.id} className="h-full" style={{ backgroundColor: seg.color, flexGrow: Math.max(1, seg.minutes) }} title={seg.label} />
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 sm:gap-6 w-full max-w-sm">
          <div className="flex-1 text-center p-3 rounded-xl bg-card border border-border">
            <span className="text-xl font-bold text-foreground ibm-mono">{(today.minutes / 60).toFixed(1)}</span>
            <p className="text-[10px] text-muted-foreground mt-0.5">Hours today</p>
          </div>
          <div className="flex-1 text-center p-3 rounded-xl bg-card border border-border">
            <div className="flex items-center justify-center gap-1">
              <Flame size={14} className="text-orange-500" />
              <span className="text-xl font-bold text-foreground ibm-mono">{focusCount}</span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">Current streak</p>
          </div>
          <div className="flex-1 text-center p-3 rounded-xl bg-card border border-border">
            <div className="flex items-center justify-center gap-1">
              <Zap size={14} className="text-primary" />
              <span className="text-xl font-bold text-foreground ibm-mono">{today.sessions.length}</span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">Sessions</p>
          </div>
        </div>
      </div>
    </div>
  );
};
