import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import {
  Play,
  Pause,
  Square,
  SkipForward,
  Timer,
  Flame,
  Zap,
  ChevronDown,
  Coffee,
  Brain,
  ArrowLeft,
} from 'lucide-react';

import type { Activity, Task } from '../types';

interface FocusModeProps {
  tasks: Task[];
  activities: Activity[];
  selectedTaskId: string | null;
  onSelectTask: (id: string) => void;
  onPomodoroComplete: (taskId: string, elapsedMinutes: number, timerType: 'pomodoro' | 'stopwatch') => void;
  onBack?: () => void;
}

type TimerMode = 'focus' | 'short-break' | 'long-break';

interface FocusSession {
  taskId: string;
  mode: TimerMode;
  completedAt: number;
  activityId: string | null;
}

const MODE_DURATIONS: Record<TimerMode, number> = {
  'focus': 25 * 60,
  'short-break': 5 * 60,
  'long-break': 15 * 60,
};

const MODE_LABELS: Record<TimerMode, string> = {
  'focus': 'Focus',
  'short-break': 'Short Break',
  'long-break': 'Long Break',
};

const SESSIONS_BEFORE_LONG_BREAK = 4;

const RING_SIZE = 280;
const RING_STROKE = 6;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export const FocusMode: React.FC<FocusModeProps> = ({
  tasks,
  activities,
  selectedTaskId,
  onSelectTask,
  onPomodoroComplete,
  onBack,
}) => {
  const [mode, setMode] = useState<TimerMode>('focus');
  const [timerType, setTimerType] = useState<'pomodoro' | 'stopwatch'>('pomodoro');
  const [timeLeft, setTimeLeft] = useState(MODE_DURATIONS['focus']); // acts as timeElapsed in stopwatch mode
  const [isActive, setIsActive] = useState(false);
  const [focusCount, setFocusCount] = useState(0); 
  const [sessions, setSessions] = useState<FocusSession[]>([]);
  const [showTaskSelect, setShowTaskSelect] = useState(false);

  const selectedTask = tasks.find(t => t.id === selectedTaskId);
  const selectedActivity = selectedTask
    ? activities.find(a => a.id === selectedTask.activity_id)
    : undefined;

  const totalDuration = MODE_DURATIONS[mode];
  // Pomodoro: progress grows as time runs down (0 → 1)
  // Stopwatch: progress grows from 0, cycling every 25 min
  const STOPWATCH_CYCLE = 25 * 60; // 25 min visual cycle
  const progress = timerType === 'stopwatch'
    ? (timeLeft % STOPWATCH_CYCLE) / STOPWATCH_CYCLE
    : totalDuration > 0 ? (totalDuration - timeLeft) / totalDuration : 0;
  const strokeDashoffset = RING_CIRCUMFERENCE * (1 - progress);

  // Timer tick. Time is read from the wall clock (not counted in 1-second steps), so the timer stays in step with
  // the top-bar clock even when the browser slows timers in a background tab or the laptop sleeps.
  const anchor = useRef<{ at: number; value: number } | null>(null);
  useEffect(() => {
    if (!isActive) { anchor.current = null; return; }
    anchor.current = { at: Date.now(), value: timeLeft };
    const read = () => {
      const a = anchor.current;
      if (!a) return;
      const elapsed = Math.floor((Date.now() - a.at) / 1000);
      setTimeLeft(timerType === 'pomodoro' ? Math.max(0, a.value - elapsed) : a.value + elapsed);
    };
    const id = setInterval(read, 250);
    const onWake = () => { if (document.visibilityState === 'visible') read(); };
    document.addEventListener('visibilitychange', onWake);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onWake); };
    // restart the anchor only when the timer starts, stops, or switches mode/type
  }, [isActive, timerType, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isActive && timerType === 'pomodoro' && timeLeft === 0) {
      // Session complete (Pomodoro only)
      setIsActive(false);

      if (mode === 'focus') {
        const newCount = focusCount + 1;
        setFocusCount(newCount);

        if (selectedTaskId) {
          onPomodoroComplete(selectedTaskId, 25, 'pomodoro');
          setSessions(prev => [
            ...prev,
            {
              taskId: selectedTaskId,
              mode: 'focus',
              completedAt: Date.now(),
              activityId: selectedTask?.activity_id ?? null,
            },
          ]);
        }

        const nextMode = newCount % SESSIONS_BEFORE_LONG_BREAK === 0 ? 'long-break' : 'short-break';
        setMode(nextMode);
        setTimeLeft(MODE_DURATIONS[nextMode]);
      } else {
        setMode('focus');
        setTimeLeft(MODE_DURATIONS['focus']);
      }
    }
  }, [isActive, timeLeft, mode, focusCount, selectedTaskId, selectedTask, onPomodoroComplete, timerType]);

  const toggleTimer = useCallback(() => {
    setIsActive(a => !a);
  }, []);

  const stopTimer = useCallback(() => {
    setIsActive(false);
    if (timerType === 'stopwatch' && mode === 'focus' && selectedTaskId) {
      // Record stopwatch time
      const elapsedMinutes = Math.round(timeLeft / 60);
      if (elapsedMinutes > 0) {
        onPomodoroComplete(selectedTaskId, elapsedMinutes, 'stopwatch');
        setSessions(prev => [
          ...prev,
          {
            taskId: selectedTaskId,
            mode: 'focus',
            completedAt: Date.now(),
            activityId: selectedTask?.activity_id ?? null,
          },
        ]);
        setFocusCount(c => c + Math.max(1, Math.floor(elapsedMinutes / 25)));
      }
    }
    setMode('focus');
    setTimeLeft(timerType === 'pomodoro' ? MODE_DURATIONS['focus'] : 0);
  }, [timerType, mode, selectedTaskId, timeLeft, selectedTask, onPomodoroComplete]);

  const skipBreak = useCallback(() => {
    if (mode !== 'focus') {
      setIsActive(false);
      setMode('focus');
      setTimeLeft(timerType === 'pomodoro' ? MODE_DURATIONS['focus'] : 0);
    }
  }, [mode, timerType]);

  const switchMode = useCallback((newMode: TimerMode) => {
    setIsActive(false);
    setMode(newMode);
    setTimeLeft(timerType === 'pomodoro' ? MODE_DURATIONS[newMode] : 0);
  }, [timerType]);

  const switchTimerType = useCallback((type: 'pomodoro' | 'stopwatch') => {
    setIsActive(false);
    setTimerType(type);
    setMode('focus');
    setTimeLeft(type === 'pomodoro' ? MODE_DURATIONS['focus'] : 0);
  }, []);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  };

  // Today's stats
  const todaySessions = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    return sessions.filter(s => s.completedAt >= todayStart.getTime() && s.mode === 'focus');
  }, [sessions]);

  const totalFocusedMinutes = todaySessions.length * 25;
  const totalFocusedHours = (totalFocusedMinutes / 60).toFixed(1);

  // Build focus history bar (each session = 25min mapped to segments)
  const historySegments = useMemo(() => {
    return todaySessions.map(s => {
      const activity = activities.find(a => a.id === s.activityId);
      return {
        color: activity?.color || 'hsl(var(--primary))',
        label: activity?.name || 'Focus',
      };
    });
  }, [todaySessions, activities]);

  const incompleteTasks = tasks.filter(t => !t.completed);

  // Progress dots for current Pomodoro set
  const currentSetIndex = focusCount % SESSIONS_BEFORE_LONG_BREAK;

  const modeIcon = mode === 'focus'
    ? <Brain size={16} />
    : <Coffee size={16} />;

  const ringColor = mode === 'focus'
    ? 'hsl(var(--primary))'
    : mode === 'short-break'
    ? 'hsl(142 71% 45%)'
    : 'hsl(217 91% 60%)';

  return (
    <div className="flex flex-col flex-1 h-full items-center justify-center bg-background px-4 py-8 relative overflow-y-auto">
      {/* Back Button */}
      {onBack && (
        <button
          onClick={onBack}
          className="absolute top-6 left-6 flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={16} /> Back to Tasks
        </button>
      )}

      {/* Type & Mode Switcher */}
      <div className="flex flex-col items-center gap-3 mb-8">
        {/* Type Toggle */}
        <div className="flex items-center rounded-full bg-muted p-1">
          <button
            onClick={() => switchTimerType('pomodoro')}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
              timerType === 'pomodoro' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Pomodoro
          </button>
          <button
            onClick={() => switchTimerType('stopwatch')}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
              timerType === 'stopwatch' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Stopwatch
          </button>
        </div>

        {/* Phase Toggle */}
        {timerType === 'pomodoro' && (
          <div className="flex items-center gap-1 rounded-full bg-muted/50 p-1">
            {(['focus', 'short-break', 'long-break'] as TimerMode[]).map(m => (
              <button
                key={m}
                onClick={() => switchMode(m)}
                className={`px-3 py-1.5 rounded-full text-[11px] font-medium transition-all ${
                  mode === m
                    ? 'bg-card text-foreground shadow-sm border border-border/50'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Timer Ring */}
      <div className="relative mb-6">
        <svg
          width={RING_SIZE}
          height={RING_SIZE}
          className="transform -rotate-90"
        >
          {/* Background ring */}
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            fill="none"
            stroke="hsl(var(--border))"
            strokeWidth={RING_STROKE}
          />
          {/* Progress ring */}
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

        {/* Timer Text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="flex items-center gap-1.5 mb-2 text-muted-foreground">
            {modeIcon}
            <span className="text-[11px] font-semibold">
              {MODE_LABELS[mode]}
            </span>
          </div>
          <span
            className="ibm-mono font-bold text-foreground leading-none"
            style={{ fontSize: 64 }}
          >
            {formatTime(timeLeft)}
          </span>
        </div>
      </div>

      {/* Session Progress Dots — only relevant in Pomodoro mode */}
      {timerType === 'pomodoro' && (
        <>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-muted-foreground">
              Focus {currentSetIndex + (mode === 'focus' ? 1 : 0)} of {SESSIONS_BEFORE_LONG_BREAK}
            </span>
          </div>
          <div className="flex items-center gap-1.5 mb-8">
            {Array.from({ length: SESSIONS_BEFORE_LONG_BREAK }, (_, i) => (
              <div
                key={i}
                className={`w-2.5 h-2.5 rounded-full transition-colors ${
                  i < currentSetIndex
                    ? 'bg-primary'
                    : i === currentSetIndex && mode === 'focus'
                    ? 'bg-primary/40 ring-2 ring-primary/30'
                    : 'bg-border'
                }`}
              />
            ))}
          </div>
        </>
      )}
      {timerType === 'stopwatch' && <div className="mb-8" />}

      {/* Controls */}
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={stopTimer}
          disabled={
            timerType === 'pomodoro'
              ? (!isActive && timeLeft === totalDuration)
              : (!isActive && timeLeft === 0)
          }
          className="flex items-center justify-center w-12 h-12 rounded-full bg-muted text-muted-foreground disabled:opacity-30 hover:bg-accent hover:text-accent-foreground active:scale-95 transition-all"
        >
          <Square size={18} />
        </button>
        <button
          onClick={toggleTimer}
          disabled={!selectedTaskId && mode === 'focus'}
          className="flex items-center justify-center w-16 h-16 rounded-full bg-primary text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 active:scale-95 transition-all shadow-lg"
        >
          {isActive ? <Pause size={24} /> : <Play size={24} className="ml-1" />}
        </button>
        {mode !== 'focus' && (
          <button
            onClick={skipBreak}
            className="flex items-center justify-center w-12 h-12 rounded-full bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground active:scale-95 transition-all"
          >
            <SkipForward size={18} />
          </button>
        )}
        {mode === 'focus' && (
          <div className="w-12 h-12" /> /* spacer for symmetry */
        )}
      </div>

      {/* Task Selector */}
      <div className="w-full max-w-sm mb-8">
        <div className="relative">
          <button
            onClick={() => setShowTaskSelect(!showTaskSelect)}
            className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-border bg-card text-sm text-foreground hover:bg-accent/50 transition-colors"
          >
            <div className="flex items-center gap-2 min-w-0">
              {selectedActivity && (
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: selectedActivity.color }}
                />
              )}
              <span className={`truncate ${selectedTask ? 'text-foreground' : 'text-muted-foreground'}`}>
                {selectedTask ? selectedTask.title : 'Select a task to focus on…'}
              </span>
            </div>
            <ChevronDown
              size={14}
              className={`text-muted-foreground transition-transform flex-shrink-0 ${
                showTaskSelect ? 'rotate-180' : ''
              }`}
            />
          </button>

          {showTaskSelect && (
            <div className="absolute top-full left-0 right-0 mt-1 py-1 rounded-xl border border-border bg-card shadow-lg z-40 max-h-48 overflow-y-auto">
              {incompleteTasks.length === 0 ? (
                <div className="px-4 py-3 text-xs text-muted-foreground text-center">
                  No incomplete tasks available.
                </div>
              ) : (
                incompleteTasks.map(task => {
                  const activity = activities.find(a => a.id === task.activity_id);
                  return (
                    <button
                      key={task.id}
                      onClick={() => {
                        onSelectTask(task.id);
                        setShowTaskSelect(false);
                      }}
                      className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-accent transition-colors ${
                        selectedTaskId === task.id ? 'bg-primary/5' : ''
                      }`}
                    >
                      {activity && (
                        <span
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: activity.color }}
                        />
                      )}
                      <span className="text-sm text-foreground truncate">{task.title}</span>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>

      {/* Focus History Bar */}
      {historySegments.length > 0 && (
        <div className="w-full max-w-sm mb-8">
          <div className="flex items-center gap-1.5 mb-2">
            <Timer size={12} className="text-muted-foreground" />
            <span className="text-[11px] font-semibold text-muted-foreground">
              Today's Focus
            </span>
          </div>
          <div className="flex gap-0.5 rounded-lg overflow-hidden h-3 bg-muted">
            {historySegments.map((seg, i) => (
              <div
                key={i}
                className="h-full flex-1 relative group"
                style={{ backgroundColor: seg.color }}
              >
                <div className="absolute -top-8 left-1/2 -translate-x-1/2 hidden group-hover:block px-2 py-1 rounded-md bg-foreground text-background text-[9px] whitespace-nowrap z-50">
                  {seg.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="flex items-center gap-6 w-full max-w-sm">
        <div className="flex-1 text-center p-3 rounded-xl bg-card border border-border">
          <span className="text-xl font-bold text-foreground ibm-mono">{totalFocusedHours}</span>
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
            <span className="text-xl font-bold text-foreground ibm-mono">{todaySessions.length}</span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">Sessions</p>
        </div>
      </div>

      {/* Empty state when no tasks */}
      {tasks.length === 0 && (
        <div className="mt-12 text-center">
          <p className="text-sm text-muted-foreground">No tasks available.</p>
          <p className="text-xs text-muted-foreground mt-1">Add tasks to start focusing.</p>
        </div>
      )}
    </div>
  );
};
