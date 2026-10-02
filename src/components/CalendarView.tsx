import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Layers,
  ListTodo,
  Target,
  Check,
  CalendarDays,
  CheckCircle2,
  Circle,
  Trash2,
  Plus,
} from 'lucide-react';
import {
  startOfWeek,
  endOfWeek,
  addWeeks,
  addDays,
  format,
  isSameDay,
  isToday,
  getHours,
  getMinutes,
} from 'date-fns';

import { useBlockRange } from '../hooks/useBlockRange';
import type { RangeBlock } from '../lib/blockRange';
import type { Activity, Block, Task, Habit } from '../types';
import { getDeadlineHour, isTimedDeadline } from '../lib/deadlines';
import { groupTasksByDate } from '../lib/selectors';
import { useNow } from '../hooks/useNow';

interface CalendarViewProps {
  blocks: Block[];
  activities: Activity[];
  tasks: Task[];
  habits: Habit[];
  selectedDate: Date;
  onSelectDate: (d: Date) => void;
  onNavigateToDaily: () => void;
  onToggleTask: (id: string, completed: boolean) => void;
  onDeleteTask: (id: string) => void;
}

type FilterKey = 'blocks' | 'tasks' | 'habits';

const START_HOUR = 0;
const END_HOUR = 24;
const MIN_HOUR_HEIGHT = 40; // minimum px per hour — usable on tiny screens
const TOTAL_HOURS = END_HOUR - START_HOUR;

function blockIndexToHour(index: number): number {
  return (index * 10) / 60;
}

export const CalendarView: React.FC<CalendarViewProps> = ({
  blocks,
  activities,
  tasks,
  habits,
  selectedDate,
  onSelectDate,
  onNavigateToDaily,
  onToggleTask,
  onDeleteTask,
}) => {
  const [weekOffset, setWeekOffset] = useState(0);
  const [popoverDate, setPopoverDate] = useState<Date | null>(null);
  const [filters, setFilters] = useState<Record<FilterKey, boolean>>({
    blocks: true,
    tasks: true,
    habits: true,
  });
  const gridRef = useRef<HTMLDivElement>(null);
  // same minute boundary as the top-bar clock, re-read when the tab wakes up
  const now = useNow(60_000);

  const baseWeekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
  const weekStart = weekOffset === 0 ? baseWeekStart : addWeeks(baseWeekStart, weekOffset);
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  // Shared, cached, narrow block loader (live blocks for the selected date are overlaid)
  const { blocks: weeklyBlocks } = useBlockRange(format(weekStart, 'yyyy-MM-dd'), format(weekEnd, 'yyyy-MM-dd'), blocks);

  const goThisWeek = () => {
    setWeekOffset(0);
    onSelectDate(new Date());
  };

  const handleDayClick = (date: Date) => {
    onSelectDate(date);
    setPopoverDate(date);
  };

  const toggleFilter = (key: FilterKey) =>
    setFilters(prev => ({ ...prev, [key]: !prev[key] }));

  const getActivity = (activityId: string | null) =>
    activityId ? activities.find(a => a.id === activityId) : undefined;

  // Group blocks by date_key
  const blocksByDate = useMemo(() => {
    const map: Record<string, RangeBlock[]> = {};
    for (const b of weeklyBlocks) {
      if (!map[b.date_key]) map[b.date_key] = [];
      map[b.date_key].push(b);
    }
    return map;
  }, [weeklyBlocks]);

  // Group tasks by deadline (fallback to date_key)
  const tasksByDate = useMemo(() => groupTasksByDate(tasks), [tasks]);

  // Dynamic hour height: fills the grid container exactly, min 40px
  const [hourHeight, setHourHeight] = useState(60);
  useEffect(() => {
    if (!gridRef.current) return;
    const el = gridRef.current;
    const updateHeight = () => {
      setHourHeight(Math.max(MIN_HOUR_HEIGHT, el.clientHeight / TOTAL_HOURS));
    };
    updateHeight();
    const ro = new ResizeObserver(updateHeight);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Auto-scroll to current time on mount
  useEffect(() => {
    if (gridRef.current) {
      const currentHour = getHours(now);
      const scrollTo = Math.max(0, (currentHour - START_HOUR - 1) * hourHeight);
      gridRef.current.scrollTop = scrollTo;
    }
  }, [hourHeight]); // re-scroll when hourHeight resolves

  // Current time position
  const nowHour = getHours(now) + getMinutes(now) / 60;
  const nowTop = (nowHour - START_HOUR) * hourHeight;
  const nowDayIndex = days.findIndex(d => isToday(d));

  // Build contiguous time-block segments for a day
  const getSegments = (dateKey: string) => {
    const dayBlocks = (blocksByDate[dateKey] || [])
      .filter(b => b.activity_id !== null)
      .sort((a, b) => a.block_index - b.block_index);

    const segments: { startIndex: number; endIndex: number; activityId: string }[] = [];
    for (const block of dayBlocks) {
      const hour = blockIndexToHour(block.block_index);
      if (hour < START_HOUR || hour >= END_HOUR) continue;

      const last = segments[segments.length - 1];
      if (last && last.activityId === block.activity_id && last.endIndex === block.block_index - 1) {
        last.endIndex = block.block_index;
      } else {
        segments.push({
          startIndex: block.block_index,
          endIndex: block.block_index,
          activityId: block.activity_id!,
        });
      }
    }
    return segments;
  };

  const filterButtons: { key: FilterKey; label: string; icon: React.ReactNode }[] = [
    { key: 'blocks', label: 'Blocks', icon: <Layers size={12} /> },
    { key: 'tasks', label: 'Tasks', icon: <ListTodo size={12} /> },
    { key: 'habits', label: 'Habits', icon: <Target size={12} /> },
  ];

  const weekLabel = `${format(weekStart, 'MMM d')} – ${format(weekEnd, 'MMM d, yyyy')}`;

  return (
    <div className="flex flex-col flex-1 h-full bg-background relative w-full">
      {/* Header */}
      <div className="flex flex-col gap-2 md:gap-3 px-3 md:px-4 py-2 md:py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="hidden md:flex items-center gap-2">
            <CalendarDays size={16} className="text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground tracking-tight">Weekly Calendar</h2>
          </div>
          <div className="flex items-center gap-1 md:ml-auto">
            <button
              onClick={() => setWeekOffset(w => w - 1)}
              className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-accent transition-colors"
            >
              <ChevronLeft size={16} className="text-muted-foreground" />
            </button>
            <button
              onClick={goThisWeek}
              className="px-3 py-1.5 text-xs font-medium rounded-lg hover:bg-accent transition-colors text-foreground"
            >
              Today
            </button>
            <button
              onClick={() => setWeekOffset(w => w + 1)}
              className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-accent transition-colors"
            >
              <ChevronRight size={16} className="text-muted-foreground" />
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground ibm-mono">{weekLabel}</span>
          <div className="flex items-center gap-1.5">
            {filterButtons.map(fb => (
              <button
                key={fb.key}
                onClick={() => toggleFilter(fb.key)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all border ${
                  filters[fb.key]
                    ? 'bg-primary/10 text-primary border-primary/30'
                    : 'bg-muted text-muted-foreground border-border hover:bg-accent'
                }`}
              >
                {fb.icon}
                {fb.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 min-w-0 w-full relative overflow-hidden">
        <div 
          className="absolute inset-0 overflow-x-auto overflow-y-hidden no-scrollbar snap-x snap-mandatory sm:snap-none scroll-pl-10"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          <div className="w-full min-w-[calc(2.5rem+7*((100vw-2.5rem)/3))] sm:min-w-[650px] md:min-w-[700px] h-full flex flex-col">
            
            {/* Scrollable Vertical Grid (contains sticky headers for perfect alignment) */}
            <div ref={gridRef} className="flex-1 overflow-y-auto relative bg-background no-scrollbar" style={{ WebkitOverflowScrolling: 'touch' }}>
              
              {/* Day Headers (Sticky) */}
              <div className="sticky top-0 z-40 flex border-b border-border bg-background shadow-[0_1px_3px_0_rgb(0,0,0,0.05)]">
                {/* Gutter for hour labels */}
              <div className="w-10 sm:w-14 flex-shrink-0 sticky left-0 z-10 bg-background" />
              {days.map((day, i) => {
                const today = isToday(day);
                const selected = isSameDay(day, selectedDate);
                return (
                  <div
                    key={i}
                    onClick={() => handleDayClick(day)}
                    className={`flex-1 flex flex-col items-center py-2 cursor-pointer transition-colors border-l border-border min-w-0 snap-start ${
                      today ? 'bg-primary/5' : 'hover:bg-accent/50'
                    }`}
                  >
                    <span className="text-[11px] font-medium text-muted-foreground">
                      {format(day, 'EEE')}
                    </span>
                    <span
                      className={`text-lg font-semibold ibm-mono mt-0.5 w-8 h-8 flex items-center justify-center rounded-full ${
                        today
                          ? 'bg-primary text-primary-foreground'
                          : selected
                          ? 'bg-accent text-accent-foreground'
                          : 'text-foreground'
                      }`}
                    >
                      {format(day, 'd')}
                    </span>
                    {/* Habit indicators */}
                    {filters.habits && (
                      <div className="flex gap-0.5 mt-1 h-3">
                        {habits
                          .filter(h => h.type === 'daily')
                          .slice(0, 5)
                          .map(habit => (
                            <div
                              key={habit.id}
                              className={`w-3 h-3 rounded-full flex items-center justify-center ${
                                habit.completedToday && isToday(day)
                                  ? 'bg-primary'
                                  : 'bg-muted border border-border'
                              }`}
                            >
                              {habit.completedToday && isToday(day) && (
                                <Check size={7} className="text-primary-foreground" strokeWidth={3} />
                              )}
                            </div>
                          ))}
                      </div>
                    )}
                    {/* Tasks in header (all day) */}
                    {filters.tasks && (
                      <div className="flex flex-col w-full px-1.5 mt-2 gap-1 overflow-y-auto max-h-[60px] no-scrollbar">
                        {(tasksByDate[format(day, 'yyyy-MM-dd')] || [])
                          .filter(t => !t.completed && !isTimedDeadline(t.deadline))
                          .map(task => {
                            const activity = getActivity(task.activity_id);
                            return (
                              <div key={task.id} className="flex items-center gap-1 bg-card border border-border rounded px-1 py-0.5 shadow-sm overflow-hidden">
                                {activity && (
                                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: activity.color }} />
                                )}
                                <span className="text-[9px] font-medium text-foreground truncate">{task.title}</span>
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

              {/* Grid Area */}
              <div className="flex relative w-full" style={{ height: TOTAL_HOURS * hourHeight }}>
          {/* Hour Labels */}
          <div className="w-10 sm:w-14 flex-shrink-0 relative sticky left-0 z-30 bg-background">
            {Array.from({ length: TOTAL_HOURS }, (_, i) => {
              const hour = START_HOUR + i;
              const ampm = hour >= 12 ? 'PM' : 'AM';
              const display = hour % 12 === 0 ? 12 : hour % 12;
              return (
                <div
                  key={i}
                  className="absolute right-1 sm:right-2 text-right"
                  style={{ top: i * hourHeight - 6 }}
                >
                  <span className="text-[10px] text-muted-foreground ibm-mono">
                    {display}{ampm}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Day Columns */}
          {days.map((day, dayIndex) => {
            const dateKey = format(day, 'yyyy-MM-dd');
            const segments = getSegments(dateKey);
            const dayTasks = tasksByDate[dateKey] || [];
            const today = isToday(day);

            return (
              <div
                key={dayIndex}
                className={`flex-1 relative border-l border-border ${
                  today ? 'bg-primary/[0.02]' : ''
                }`}
              >
                {/* Hour grid lines */}
                {Array.from({ length: TOTAL_HOURS }, (_, i) => (
                  <div
                    key={i}
                    className="absolute w-full border-t border-border/50"
                    style={{ top: i * hourHeight }}
                  />
                ))}

                {/* Time blocks */}
                {filters.blocks &&
                  segments.map((seg, si) => {
                    const activity = getActivity(seg.activityId);
                    if (!activity) return null;
                    const startHour = blockIndexToHour(seg.startIndex);
                    const endHour = blockIndexToHour(seg.endIndex + 1);
                    const top = (startHour - START_HOUR) * hourHeight;
                    const height = (endHour - startHour) * hourHeight;
                    return (
                      <div
                        key={si}
                        className="absolute left-0.5 right-0.5 rounded-md overflow-hidden z-10 cursor-default group"
                        style={{
                          top,
                          height: Math.max(height, 4),
                          backgroundColor: activity.color + '30',
                          borderLeft: `3px solid ${activity.color}`,
                        }}
                      >
                        {height >= 20 && (
                          <div className="px-1.5 py-0.5 flex items-center gap-1 overflow-hidden whitespace-nowrap">
                            {activity.emoji && <span className="text-[10px] leading-none">{activity.emoji}</span>}
                            <span
                              className="text-[10px] font-medium leading-tight truncate text-foreground"
                            >
                              {activity.name}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}


                {/* Tasks with time */}
                {filters.tasks &&
                  dayTasks
                    .filter(t => !t.completed && isTimedDeadline(t.deadline))
                    .map((task) => {
                      const activity = getActivity(task.activity_id);
                      // Local time of day of the deadline
                      const taskHour = getDeadlineHour(task.deadline!) ?? 0;
                      if (taskHour < START_HOUR || taskHour >= END_HOUR) return null;
                      
                      const top = (taskHour - START_HOUR) * hourHeight;
                      return (
                        <div
                          key={task.id}
                          className="absolute left-1 right-1 z-20 flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-border bg-card shadow-sm overflow-hidden"
                          style={{ top, height: 20 }}
                        >
                          {activity && (
                            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: activity.color }} />
                          )}
                          <span className="text-[9px] font-medium text-foreground truncate">{task.title}</span>
                        </div>
                      );
                    })}

                {/* Current time indicator */}
                {today && nowDayIndex === dayIndex && nowTop >= 0 && nowTop <= TOTAL_HOURS * hourHeight && (
                  <div
                    className="absolute left-0 right-0 z-30 pointer-events-none"
                    style={{ top: nowTop }}
                  >
                    <div className="relative">
                      <div className="absolute -left-1 -top-[4px] w-2.5 h-2.5 rounded-full bg-red-500" />
                      <div className="h-[2px] bg-red-500 w-full" />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  </div>
</div>

      {/* Popover for daily details */}
      {popoverDate && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
          <div className="absolute inset-0 bg-background/50 backdrop-blur-sm" onClick={() => setPopoverDate(null)} />
          <div className="relative bg-card border border-border shadow-2xl rounded-t-3xl sm:rounded-xl w-full sm:max-w-sm flex flex-col overflow-hidden pb-[var(--safe-b)] sm:pb-0 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/50">
              <h3 className="font-bold text-foreground flex items-center gap-2">
                <CalendarDays size={16} className="text-primary" />
                {popoverDate.toLocaleDateString(undefined, { weekday: 'short', month: 'long', day: 'numeric' })}
              </h3>
              <button 
                onClick={() => {
                  setPopoverDate(null);
                  onNavigateToDaily();
                }}
                className="text-xs font-medium text-primary hover:underline"
              >
                Go to 24H Block →
              </button>
            </div>
            <div className="p-4 max-h-[60vh] overflow-y-auto space-y-2">
              {(() => {
                const dayTasks = tasksByDate[format(popoverDate, 'yyyy-MM-dd')] || [];
                if (dayTasks.length === 0) {
                  return <p className="text-sm text-muted-foreground text-center py-4">No tasks scheduled for this day.</p>;
                }
                return dayTasks.map(task => (
                  <div key={task.id} className="flex items-start gap-2.5 p-2.5 rounded-md border border-border hover:border-primary/50 transition-colors bg-background group">
                    <button onClick={() => onToggleTask(task.id, task.completed)} className="mt-0.5 text-muted-foreground hover:text-primary transition-colors flex-shrink-0">
                      {task.completed ? <CheckCircle2 size={16} className="text-primary" /> : <Circle size={16} />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium leading-tight truncate ${task.completed ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                        {task.title}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: getActivity(task.activity_id)?.color || '#888888' }} />
                        <span className="text-[11px] text-muted-foreground font-medium">
                          {getActivity(task.activity_id)?.name || 'Unassigned'}
                        </span>
                      </div>
                    </div>
                    <button onClick={() => onDeleteTask(task.id)} className="opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 focus-visible:opacity-100 p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-all flex-shrink-0">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ));
              })()}
            </div>
            <div className="p-3 border-t border-border bg-muted/30">
              <button 
                onClick={() => {
                  setPopoverDate(null);
                  onNavigateToDaily();
                }}
                className="w-full flex items-center justify-center gap-2 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 transition-colors"
              >
                <Plus size={16} /> Manage Day in 24H Block
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
