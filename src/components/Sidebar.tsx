import React, { useState } from 'react';
import {
  Zap,
  Check,
  Flame,
  LayoutGrid,
  Timer,
  BarChart2,
  ChevronsLeft,
  ChevronsRight,
  Plus,
  Palette,
  ListTodo,
  Clock,
  Trash2,
} from 'lucide-react';
import { Calendar } from './Calendar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from './ui/dialog';
import { Input } from './ui/input';
import { Button } from './ui/button';
import type { Task } from '../types';
import { prefetchView } from '../lib/prefetch';

interface Activity {
  id: string;
  name: string;
  color: string;
}

interface Habit {
  id: string;
  name: string;
  type: 'daily' | 'event';
  completedToday?: boolean;
  streak?: number;
  streakUnit?: 'days' | 'weeks';
  daysSince?: number | null;
  lastLogDate?: string | null;
}

export type SidebarView =
  | 'today'
  | 'tasks'
  | 'focus'
  | 'analysis'
  | 'activities'
  | 'sleep'
  | 'goals'
  | 'export'
  | 'settings';

interface NavItem {
  view: SidebarView;
  label: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { view: 'today', label: 'Today', icon: <LayoutGrid size={18} /> },
  { view: 'tasks', label: 'Tasks', icon: <ListTodo size={18} /> },
  { view: 'focus', label: 'Focus', icon: <Timer size={18} /> },
  { view: 'analysis', label: 'Analysis', icon: <BarChart2 size={18} /> },
  { view: 'activities', label: 'Activities', icon: <Palette size={18} /> },
];

interface SidebarProps {
  activities: Activity[];
  habits: Habit[];
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  onToggleHabit: (id: string) => void;
  onLogEventHabit: (id: string) => void;
  onDeleteHabit: (id: string) => void;
  onOpenHabitHistory?: (id: string) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  activeView?: SidebarView;
  onNavigate?: (view: SidebarView) => void;
  onAddActivity?: (activity: Omit<Activity, 'id'>) => void;
  onAddHabit?: (
    name: string,
    type: 'daily' | 'event',
    opts?: { frequency?: 'daily' | 'weekly' | 'times_per_week' | 'weekdays'; target_count?: number | null; weekdays?: number[] | null }
  ) => void;
  tasks?: Task[];
  onToggleTask?: (id: string, completed: boolean) => void;
  /** just the calendar and habits, for the phone date sheet (no logo, nav or collapse button) */
  panel?: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  habits,
  selectedDate,
  onSelectDate,
  onToggleHabit,
  onLogEventHabit,
  onOpenHabitHistory,
  onDeleteHabit,
  collapsed = false,
  onToggleCollapse,
  activeView = 'today',
  onNavigate,
  onAddHabit,
  panel = false,
}) => {
  const [isAddHabitOpen, setIsAddHabitOpen] = useState(false);
  const [newHabitName, setNewHabitName] = useState('');
  const [newHabitType, setNewHabitType] = useState<'daily' | 'event'>('daily');
  const [newHabitFreq, setNewHabitFreq] = useState<'daily' | 'weekdays' | 'times_per_week' | 'weekly'>('daily');
  const [newHabitDays, setNewHabitDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [newHabitCount, setNewHabitCount] = useState(3);
  const [justLoggedId, setJustLoggedId] = useState<string | null>(null);

  const handleAddHabit = () => {
    if (!newHabitName.trim()) return;
    onAddHabit?.(newHabitName.trim(), newHabitType, newHabitType === 'daily'
      ? { frequency: newHabitFreq, target_count: newHabitFreq === 'times_per_week' ? newHabitCount : newHabitFreq === 'weekly' ? 1 : null, weekdays: newHabitFreq === 'weekdays' ? newHabitDays : null }
      : undefined);
    setNewHabitName('');
    setNewHabitType('daily');
    setNewHabitFreq('daily');
    setIsAddHabitOpen(false);
  };

  const handleLogEvent = (habitId: string) => {
    onLogEventHabit(habitId);
    setJustLoggedId(habitId);
    setTimeout(() => setJustLoggedId(null), 2000);
  };

  const dailyHabits = habits.filter((h) => h.type === 'daily');
  const eventHabits = habits.filter((h) => h.type === 'event');

  const formatDaysSince = (daysSince: number | null | undefined, lastLogDate: string | null | undefined): string => {
    if (daysSince === null || daysSince === undefined) return 'Never logged';
    if (daysSince === 0) return 'Today';
    if (daysSince === 1) return `Yesterday · ${lastLogDate ?? ''}`;
    return `${daysSince} days ago · ${lastLogDate ?? ''}`;
  };

  return (
    <div 
      className={`flex flex-col h-full ${collapsed ? 'cursor-pointer hover:bg-accent/10 transition-colors' : ''}`}
      onClick={() => {
        if (collapsed && onToggleCollapse) onToggleCollapse();
      }}
    >
      {/* Logo */}
      {!panel && <div
        className={`flex items-center flex-shrink-0 ${
          collapsed ? 'justify-center px-2 py-2 mb-2' : 'gap-2.5 px-4 py-2 mb-2'
        }`}
      >
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
          <Zap size={16} className="text-primary-foreground" />
        </div>
        {!collapsed && (
          <div>
            <div className="font-display text-base font-bold tracking-tight text-foreground leading-tight">TimeBloker</div>
            <div className="text-[11px] text-muted-foreground font-medium">Time Tracker</div>
          </div>
        )}
      </div>}

      {/* Navigation items */}
      {!panel && <div className={`flex-shrink-0 py-2 space-y-0.5 ${collapsed ? 'px-1.5' : 'px-2'}`}>
        {NAV_ITEMS.map((item) => {
          const isActive = activeView === item.view;
          return (
            <button
              key={item.view}
              onClick={(e) => {
                e.stopPropagation();
                onNavigate?.(item.view);
              }}
              onPointerEnter={() => prefetchView(item.view)}
              onFocus={() => prefetchView(item.view)}
              title={collapsed ? item.label : undefined}
              className={`w-full flex items-center rounded-md transition-colors min-h-[36px] ${
                collapsed ? 'justify-center px-0 py-1.5' : 'gap-3 px-3 py-1.5'
              } ${
                isActive
                  ? 'bg-accent text-foreground font-medium shadow-sm'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              <span className="flex-shrink-0">{item.icon}</span>
              {!collapsed && <span className="text-sm">{item.label}</span>}
            </button>
          );
        })}
      </div>}

      {/* Scrollable habits content — hidden when collapsed */}
      {!collapsed && (
        <div className={`flex-1 overflow-y-auto px-3 py-3 space-y-5 ${panel ? '' : 'border-t border-border'}`}>
          {/* Calendar */}
          <Calendar selectedDate={selectedDate} onSelectDate={onSelectDate} />

          {/* Daily Habits */}
          <div>
            <div className="flex items-center justify-between mb-2 px-1">
              <p className="text-xs font-semibold text-muted-foreground">
                Daily habits
              </p>
              <Dialog open={isAddHabitOpen} onOpenChange={setIsAddHabitOpen}>
                <DialogTrigger asChild>
                  <button className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded">
                    <Plus size={14} />
                  </button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[425px]">
                  <DialogHeader>
                    <DialogTitle>Add New Habit</DialogTitle>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                      <label htmlFor="habit-name" className="text-sm font-medium">Name</label>
                      <Input
                        id="habit-name"
                        value={newHabitName}
                        onChange={(e) => setNewHabitName(e.target.value)}
                        placeholder="E.g., Morning Run"
                        onKeyDown={(e) => e.key === 'Enter' && handleAddHabit()}
                      />
                    </div>
                    <div className="grid gap-2">
                      <label className="text-sm font-medium">Type</label>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setNewHabitType('daily')}
                          className={`flex-1 py-2 rounded-lg text-sm border transition-colors ${
                            newHabitType === 'daily'
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'border-border text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          Daily
                        </button>
                        <button
                          onClick={() => setNewHabitType('event')}
                          className={`flex-1 py-2 rounded-lg text-sm border transition-colors ${
                            newHabitType === 'event'
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'border-border text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          Event
                        </button>
                      </div>
                    </div>
                    {newHabitType === 'daily' && (
                      <div className="grid gap-2">
                        <label htmlFor="habit-freq" className="text-sm font-medium">How often</label>
                        <select
                          id="habit-freq"
                          value={newHabitFreq}
                          onChange={(e) => setNewHabitFreq(e.target.value as typeof newHabitFreq)}
                          className="w-full text-sm px-3 py-2 rounded-lg bg-background border border-border"
                        >
                          <option value="daily">Every day</option>
                          <option value="weekdays">Specific weekdays</option>
                          <option value="times_per_week">Times per week</option>
                          <option value="weekly">Once a week</option>
                        </select>
                        {newHabitFreq === 'weekdays' && (
                          <div className="flex gap-1" role="group" aria-label="Weekdays">
                            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                              <button
                                key={i}
                                type="button"
                                aria-pressed={newHabitDays.includes(i)}
                                onClick={() => setNewHabitDays((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]))}
                                className={`w-9 h-9 rounded-full text-xs font-semibold border ${newHabitDays.includes(i) ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground'}`}
                              >
                                {d}
                              </button>
                            ))}
                          </div>
                        )}
                        {newHabitFreq === 'times_per_week' && (
                          <div className="flex items-center gap-2 text-sm">
                            <input type="number" min={1} max={7} value={newHabitCount} onChange={(e) => setNewHabitCount(Math.max(1, Math.min(7, Number(e.target.value) || 1)))} className="w-16 px-2 py-1.5 rounded-lg border border-border bg-background" />
                            days each week
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <DialogFooter>
                    <Button onClick={handleAddHabit}>Add Habit</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>

            <div className="space-y-0.5">
              {dailyHabits.length === 0 && (
                <p className="text-xs text-muted-foreground px-1 py-2">No daily habits yet.</p>
              )}
              {dailyHabits.map((habit) => (
                <div key={habit.id} className="group flex items-center gap-1">
                  <button
                    onClick={() => onToggleHabit(habit.id)}
                    className="flex-1 flex items-center gap-2.5 px-2 py-2.5 rounded-md hover:bg-accent transition-colors min-h-[44px] text-left"
                  >
                    <div
                      className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border-2 transition-colors ${
                        habit.completedToday
                          ? 'bg-primary border-primary'
                          : 'border-border group-hover:border-muted-foreground'
                      }`}
                    >
                      {habit.completedToday && (
                        <Check size={12} className="text-primary-foreground" strokeWidth={3} />
                      )}
                    </div>
                    <span
                      className={`text-sm flex-1 transition-colors ${
                        habit.completedToday ? 'line-through text-muted-foreground' : 'text-foreground'
                      }`}
                    >
                      {habit.name}
                    </span>
                    {(habit.streak ?? 0) > 0 && (
                      <span className="flex items-center gap-0.5 text-[10px] font-semibold text-orange-500 flex-shrink-0 ibm-mono">
                        <Flame size={11} />
                        {habit.streak}{habit.streakUnit === 'weeks' ? 'w' : ''}
                      </span>
                    )}
                  </button>
                  {onOpenHabitHistory && (
                    <button
                      onClick={() => onOpenHabitHistory(habit.id)}
                      className="opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 focus-visible:opacity-100 p-1.5 rounded text-muted-foreground hover:text-foreground transition-all flex-shrink-0"
                      title="History and stats"
                      aria-label={`History for ${habit.name}`}
                    >
                      <BarChart2 size={12} />
                    </button>
                  )}
                  <button
                    onClick={() => onDeleteHabit(habit.id)}
                    className="opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 focus-visible:opacity-100 p-1.5 rounded text-muted-foreground hover:text-destructive transition-all flex-shrink-0"
                    title="Delete habit"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Event Habits */}
          {eventHabits.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-2 px-1">
                Events
              </p>
              <div className="space-y-2">
                {eventHabits.map((habit) => {
                  const justLogged = justLoggedId === habit.id;
                  return (
                    <div
                      key={habit.id}
                      className="px-2 py-2.5 rounded-md border border-border bg-card group"
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <div
                            className={`w-2.5 h-2.5 rounded-full flex-shrink-0 transition-all ${
                              justLogged ? 'bg-green-500 scale-125' : 'bg-primary'
                            }`}
                          />
                          <span className="text-sm text-foreground font-medium truncate">{habit.name}</span>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => handleLogEvent(habit.id)}
                            className={`px-2 py-1 rounded-md text-[10px] font-semibold transition-all ${
                              justLogged
                                ? 'bg-green-500/10 text-green-500 border border-green-500/30'
                                : 'bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20'
                            }`}
                          >
                            {justLogged ? '✓ Logged' : 'Log now'}
                          </button>
                          {onOpenHabitHistory && (
                            <button
                              onClick={() => onOpenHabitHistory(habit.id)}
                              className="opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 focus-visible:opacity-100 p-1 rounded text-muted-foreground hover:text-foreground transition-all"
                              title="History, notes and stats"
                              aria-label={`History for ${habit.name}`}
                            >
                              <BarChart2 size={11} />
                            </button>
                          )}
                          <button
                            onClick={() => onDeleteHabit(habit.id)}
                            className="opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 focus-visible:opacity-100 p-1 rounded text-muted-foreground hover:text-destructive transition-all"
                            title="Delete event habit"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 ml-[18px]">
                        <Clock size={9} className="text-muted-foreground" />
                        <span className="text-[10px] text-muted-foreground ibm-mono">
                          {formatDaysSince(habit.daysSince, habit.lastLogDate)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Spacer when collapsed */}
      {collapsed && <div className="flex-1" />}

      {/* Collapse / Expand toggle */}
      {onToggleCollapse && !panel && (
        <div className={`flex-shrink-0 border-t border-border ${collapsed ? 'px-1.5 py-2' : 'px-2 py-2'}`}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse();
            }}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={`w-full flex items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors min-h-[40px] ${
              collapsed ? 'justify-center px-0 py-2' : 'gap-3 px-3 py-2'
            }`}
          >
            {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
            {!collapsed && <span className="text-sm">Collapse</span>}
          </button>
        </div>
      )}
    </div>
  );
};
