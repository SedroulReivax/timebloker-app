import React, { useState } from 'react';
import { CheckCircle2, Circle, Plus, Timer, Trash2, Pencil, Search, Calendar, Repeat, ChevronDown, ChevronRight, ChevronUp, Clock } from 'lucide-react';
import * as chrono from 'chrono-node';

import type { Activity, Task, TaskBlockRef, TaskFocusSession } from '../types';
import { TaskEditForm, type TaskEditValues } from './TaskEditForm';
import { TASK_FILTERS, filterTasks, type TaskFilter } from '../lib/taskFilters';
import { formatMinutes, summarizeTaskTime } from '../lib/taskTime';
import { isDateOnlyDeadline } from '../lib/deadlines';
import { groupTasks, countActiveTasks } from '../lib/taskCounts';
import { useNerdMode } from './ui/detail';

const isDateOnly = (deadline: string): boolean => isDateOnlyDeadline(deadline);

/** Format a timestamptz deadline string for display. */
const formatDeadline = (deadline: string): string => {
  const d = new Date(deadline);
  if (isDateOnly(deadline)) {
    // Format UTC date to prevent local timezone offset from shifting the date
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const day = d.getUTCDate();
    const localDate = new Date(y, m, day);
    return localDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  // Show date + local time
  const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${dateStr} \u00b7 ${timeStr}`;
};

/**
 * Returns Tailwind class strings for the deadline badge based on urgency.
 */
const getDeadlineColorClass = (deadline: string, completed: boolean): string => {
  if (completed) return 'bg-muted text-muted-foreground';

  const now = new Date();
  let deadlineDate: Date;

  if (isDateOnly(deadline)) {
    const d = new Date(deadline);
    deadlineDate = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999);
  } else {
    deadlineDate = new Date(deadline);
  }

  const msPerDay = 1000 * 60 * 60 * 24;
  const diffDays = (deadlineDate.getTime() - now.getTime()) / msPerDay;

  if (diffDays < 0)  return 'bg-destructive/15 text-destructive border border-destructive/30';
  if (diffDays < 1)  return 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border border-orange-500/30';
  if (diffDays < 3)  return 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30';
  if (diffDays < 7)  return 'bg-yellow-400/10 text-yellow-600 dark:text-yellow-400 border border-yellow-400/30';
  return 'bg-muted text-muted-foreground';
};

interface TaskListProps {
  tasks: Task[];
  onToggleTask: (id: string) => void;
  onAddTask: (title: string, description?: string, deadline?: string, recurrence_type?: string, recurrence_rule?: string, activity_id?: string | null, estimated_minutes?: number | null) => void;
  activities?: Activity[];
  onUpdateTask?: (id: string, updates: Record<string, unknown>) => void;
  taskBlocks?: TaskBlockRef[];
  focusSessions?: TaskFocusSession[];
  onDeleteTask: (id: string) => void;
  selectedTaskId: string | null;
  onSelectTask: (id: string) => void;
  onNavigateToFocus: () => void;
}

export const TaskList: React.FC<TaskListProps> = ({
  tasks,
  onToggleTask,
  onAddTask,
  onDeleteTask,
  activities = [],
  onUpdateTask,
  taskBlocks = [],
  focusSessions = [],
  selectedTaskId,
  onSelectTask,
  onNavigateToFocus,
}) => {
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDescription, setNewTaskDescription] = useState('');
  const [newTaskDeadline, setNewTaskDeadline] = useState('');
  const [newTaskRecurrence, setNewTaskRecurrence] = useState<'none'|'daily'|'weekly'|'monthly'|'yearly'|'custom'>('none');
  const [newTaskRecurrenceRule, setNewTaskRecurrenceRule] = useState('');
  const [newTaskEstimate, setNewTaskEstimate] = useState('');
  const [isFormExpanded, setIsFormExpanded] = useState(false);

  const [filter, setFilter] = useState<TaskFilter>('all');
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const [showCompleted, setShowCompleted] = useState(false);
  const [showRecurring, setShowRecurring] = useState(true);
  const [showScheduled, setShowScheduled] = useState(true);



  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;

    let parsedTitle = newTaskTitle.trim();
    let parsedDeadline = newTaskDeadline || undefined;

    if (!parsedDeadline) {
      const parsedResults = chrono.parse(parsedTitle);
      if (parsedResults.length > 0) {
        const parsedResult = parsedResults[0];
        const parsedDate = parsedResult.start.date();
        const hasTime = parsedResult.start.isCertain('hour');

        const offset = parsedDate.getTimezoneOffset() * 60000;
        const localISO = new Date(parsedDate.getTime() - offset).toISOString();
        parsedDeadline = hasTime ? localISO.slice(0, 16) : localISO.split('T')[0];

        parsedTitle = parsedTitle.replace(parsedResult.text, '').trim();
        if (!parsedTitle) parsedTitle = newTaskTitle.trim();
      }
    }

    onAddTask(
      parsedTitle,
      newTaskDescription.trim() || undefined,
      parsedDeadline,
      newTaskRecurrence,
      newTaskRecurrenceRule.trim() || undefined,
      undefined,
      parseInt(newTaskEstimate, 10) > 0 ? parseInt(newTaskEstimate, 10) : null
    );
    setNewTaskTitle('');
    setNewTaskDescription('');
    setNewTaskDeadline('');
    setNewTaskRecurrence('none');
    setNewTaskRecurrenceRule('');
    setNewTaskEstimate('');
    setIsFormExpanded(false);
  };



  const activityNameById = Object.fromEntries(activities.map(a => [a.id, a.name]));
  const visibleTasks = filterTasks(tasks, filter, query, activityNameById);
  const isFiltering = filter !== 'all' || query.trim() !== '';
  const { nerd } = useNerdMode();
  const counts = {
    today: filterTasks(tasks, 'today', '').length,
    overdue: filterTasks(tasks, 'overdue', '').length,
    unscheduled: filterTasks(tasks, 'unscheduled', '').length,
  };
  const { inbox: inboxTasks, scheduled: scheduledTasks, recurring: recurringTasks } = groupTasks(visibleTasks);
  const completedTasks = visibleTasks.filter(t => t.completed);
  const handleSaveEdit = (id: string, v: TaskEditValues) => {
    onUpdateTask?.(id, v);
    setEditingId(null);
  };

  const renderTask = (task: Task) => {
    const isSelected = selectedTaskId === task.id;
    const showDetail = nerd || isSelected;
    if (editingId === task.id) {
      return (
        <TaskEditForm key={task.id} task={task} activities={activities} onSave={(v) => handleSaveEdit(task.id, v)} onCancel={() => setEditingId(null)} />
      );
    }
    return (
      <div
        key={task.id}
        onClick={() => onSelectTask(task.id)}
        className={`flex items-start gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all min-h-[48px] border group ${
          isSelected
            ? 'border-primary/40 bg-primary/5'
            : 'border-transparent hover:bg-accent'
        } ${task.completed ? 'opacity-60' : ''}`}
      >
        <button
          onClick={e => { e.stopPropagation(); onToggleTask(task.id); }}
          className="mt-0.5 flex-shrink-0 text-muted-foreground hover:text-primary transition-colors"
        >
          {task.completed
            ? <CheckCircle2 size={20} className="text-primary" />
            : <Circle size={20} />}
        </button>
        <div className="flex-1 min-w-0">
          <div
            className={`text-sm font-medium ${
              task.completed ? 'line-through text-muted-foreground' : 'text-foreground'
            }`}
          >
            {task.title}
          </div>
          {task.description && showDetail && (
            <div className="text-xs text-muted-foreground mt-0.5 animate-in fade-in duration-150">
              {task.description}
            </div>
          )}

          {showDetail && (() => {
            const s = summarizeTaskTime({ ...task, estimated_pomodoros: task.estimated_pomodoros }, taskBlocks, focusSessions);
            if (!s.estimatedMinutes && !s.trackedMinutes && !s.scheduledMinutes && !s.focusedMinutes) return null;
            return (
              <div className="text-[10px] text-muted-foreground mt-1 flex flex-wrap gap-x-2">
                {s.estimatedMinutes ? <span>Est {formatMinutes(s.estimatedMinutes)}</span> : null}
                {s.scheduledMinutes > 0 && <span>Planned {formatMinutes(s.scheduledMinutes)}</span>}
                {s.trackedMinutes > 0 && <span>Tracked {formatMinutes(s.trackedMinutes)}{s.progress !== null ? ` (${Math.round(s.progress * 100)}%)` : ''}</span>}
                {s.focusedMinutes > 0 && <span>Focused {formatMinutes(s.focusedMinutes)}</span>}
              </div>
            );
          })()}

          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {task.deadline && (
              <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-sm transition-colors ${
                getDeadlineColorClass(task.deadline, task.completed)
              }`}>
                {!isDateOnly(task.deadline) ? <Clock size={10} /> : <Calendar size={10} />}
                {formatDeadline(task.deadline)}
              </span>
            )}
            {task.recurrence_type && task.recurrence_type !== 'none' && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-sm bg-primary/10 text-primary">
                <Repeat size={10} />
                {task.recurrence_type === 'custom' ? task.recurrence_rule : task.recurrence_type}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 focus-visible:opacity-100 transition-all flex-shrink-0">
          {isSelected && !task.completed && (
            <button
              onClick={e => { e.stopPropagation(); onNavigateToFocus(); }}
              className="px-3 py-1.5 text-[11px] font-bold bg-primary text-primary-foreground hover:bg-primary/90 rounded flex items-center gap-1"
              title="Focus on task"
            >
              <Timer size={12} /> Focus
            </button>
          )}
          {onUpdateTask && (
            <button
              onClick={e => { e.stopPropagation(); setEditingId(task.id); }}
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent rounded"
              title="Edit task"
              aria-label={`Edit ${task.title}`}
            >
              <Pencil size={14} />
            </button>
          )}
          <button
            onClick={e => { e.stopPropagation(); onDeleteTask(task.id); }}
            className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded"
            title="Delete task"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col flex-1 h-full bg-background overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 md:px-6 md:py-4 border-b border-border flex-shrink-0 bg-card">
        <div className="max-w-3xl 3xl:max-w-4xl mx-auto w-full flex items-center justify-between gap-x-3 gap-y-2 flex-wrap">
          <h2 className="text-lg font-bold text-foreground tracking-tight">Tasks <span className="text-sm font-normal text-muted-foreground">{countActiveTasks(tasks)} active</span></h2>
          <div className="flex gap-1.5">
            {([['today', 'due today'], ['overdue', 'overdue'], ['unscheduled', 'no date']] as const).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setFilter(filter === id ? 'all' : id)}
                aria-pressed={filter === id}
                title={`Show ${label}`}
                className={`px-2.5 py-1 rounded-full text-[11px] transition-colors ${filter === id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'} ${id === 'overdue' && counts.overdue > 0 && filter !== id ? 'text-red-600 dark:text-red-400' : ''}`}
              >
                <span className="font-semibold ibm-mono">{counts[id]}</span> <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto w-full">
        <div className="max-w-3xl 3xl:max-w-4xl mx-auto w-full p-3 sm:p-4 md:p-6 flex flex-col h-full">

        <div className="flex-shrink-0 mb-4 md:mb-6">

          {/* Search + filters */}
          <div className="flex flex-col gap-2 mb-4">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search title, description, activity, date..."
                aria-label="Search tasks"
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-muted text-foreground placeholder:text-muted-foreground border border-border focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar" role="tablist" aria-label="Task filters">
              {TASK_FILTERS.map(f => (
                <button
                  key={f.id}
                  role="tab"
                  aria-selected={filter === f.id}
                  onClick={() => setFilter(f.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full border whitespace-nowrap transition-colors ${
                    filter === f.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent text-muted-foreground border-border hover:bg-accent'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {inboxTasks.length === 0 && scheduledTasks.length === 0 && recurringTasks.length === 0 && completedTasks.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-sm text-muted-foreground">{isFiltering ? 'No tasks match this filter.' : "No active tasks. You're all caught up!"}</p>
            </div>
          )}

          {/* Inbox Section */}
          {inboxTasks.length > 0 && (
            <div className="space-y-1.5">
              <h3 className="text-xs font-semibold text-muted-foreground px-1 mb-2">Inbox</h3>
              {inboxTasks.map(renderTask)}
            </div>
          )}

          {/* Scheduled Section */}
          {scheduledTasks.length > 0 && (
            <div className="pt-2">
              <button
                onClick={() => setShowScheduled(s => !s)}
                className="flex items-center gap-2 text-xs font-semibold text-muted-foreground w-full px-1 py-2 hover:text-foreground transition-colors"
              >
                {showScheduled ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                Scheduled ({scheduledTasks.length})
              </button>

              {showScheduled && (
                <div className="mt-1 space-y-1.5">
                  {scheduledTasks.map(renderTask)}
                </div>
              )}
            </div>
          )}

          {/* Recurring Section */}
          {recurringTasks.length > 0 && (
            <div className="pt-2 border-t border-border mt-4">
              <button
                onClick={() => setShowRecurring(s => !s)}
                className="flex items-center gap-2 text-xs font-semibold text-muted-foreground w-full px-1 py-2 hover:text-foreground transition-colors"
              >
                {showRecurring ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                Recurring ({recurringTasks.length})
              </button>

              {showRecurring && (
                <div className="mt-1 space-y-1.5">
                  {recurringTasks.map(renderTask)}
                </div>
              )}
            </div>
          )}

          {/* Completed Section */}
          {completedTasks.length > 0 && (
            <div className="pt-2 border-t border-border mt-4">
              <button
                onClick={() => setShowCompleted(s => !s)}
                className="flex items-center gap-2 text-xs font-semibold text-muted-foreground w-full px-1 py-2 hover:text-foreground transition-colors"
              >
                {showCompleted || filter === 'completed' ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                Completed ({completedTasks.length})
              </button>

              {(showCompleted || filter === 'completed') && (
                <div className="mt-1 space-y-1.5">
                  {completedTasks.map(renderTask)}
                </div>
              )}
            </div>
          )}
        </div>
        </div>
      </div>

      {/* Add Task Form */}
      <div className="flex-shrink-0 border-t border-border bg-card shadow-[0_-4px_15px_-3px_rgba(0,0,0,0.1)]">
        <div className="max-w-3xl 3xl:max-w-4xl mx-auto w-full">
          <form onSubmit={handleAddTask} className="px-3 sm:px-6 pb-3 sm:pb-6 pt-3 sm:pt-4 flex flex-col gap-3">

          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Add a new task…"
              value={newTaskTitle}
              onChange={e => setNewTaskTitle(e.target.value)}
              className="flex-1 min-w-0 text-sm px-3 py-2.5 rounded-lg bg-muted text-foreground placeholder:text-muted-foreground border border-border focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              type="button"
              onClick={() => setIsFormExpanded(prev => !prev)}
              className={`flex items-center justify-center w-11 h-11 rounded-lg border border-border transition-all flex-shrink-0 ${isFormExpanded ? 'bg-accent text-foreground' : 'bg-transparent text-muted-foreground hover:bg-accent'}`}
              title={isFormExpanded ? 'Hide extra details' : 'Show extra details'}
              aria-label={isFormExpanded ? 'Hide extra details' : 'Show extra details'}
              aria-expanded={isFormExpanded}
            >
              {isFormExpanded ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
            </button>
            <button
              type="submit"
              disabled={!newTaskTitle.trim()}
              className="flex items-center justify-center w-11 h-11 rounded-lg bg-primary text-primary-foreground disabled:opacity-50 hover:opacity-90 active:scale-95 transition-all flex-shrink-0"
            >
              <Plus size={20} />
            </button>
          </div>

          {isFormExpanded && (
            <div className="flex flex-col gap-2 mt-2 p-3 bg-muted rounded-lg border border-border animate-in slide-in-from-bottom-2 fade-in">
              <textarea
                placeholder="Description (optional)"
                value={newTaskDescription}
                onChange={e => setNewTaskDescription(e.target.value)}
                className="w-full text-sm px-3 py-2 rounded-md bg-background text-foreground placeholder:text-muted-foreground border border-border focus:outline-none focus:ring-1 focus:ring-ring min-h-[60px] resize-y"
              />

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-muted-foreground ml-1">Estimated effort (minutes)</label>
                <input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  placeholder="e.g. 90"
                  value={newTaskEstimate}
                  onChange={e => setNewTaskEstimate(e.target.value)}
                  className="w-full text-sm px-3 py-2 rounded-md bg-background text-foreground placeholder:text-muted-foreground border border-border focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              <div className="flex gap-2">
                <div className="flex-1 flex flex-col gap-1">
                  <label className="text-[11px] font-semibold text-muted-foreground ml-1">Deadline</label>
                  <input
                    type="datetime-local"
                    value={newTaskDeadline}
                    onChange={e => setNewTaskDeadline(e.target.value)}
                    className="w-full text-sm px-3 py-2 rounded-md bg-background text-foreground border border-border focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>

                <div className="flex-1 flex flex-col gap-1">
                  <label className="text-[11px] font-semibold text-muted-foreground ml-1">Recurrence</label>
                  <select
                    value={newTaskRecurrence}
                    onChange={e => setNewTaskRecurrence(e.target.value as any)}
                    className="w-full text-sm px-3 py-2 rounded-md bg-background text-foreground border border-border focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="none">None</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>
              </div>

              {newTaskRecurrence === 'custom' && (
                <div className="flex flex-col gap-1 mt-1">
                  <label className="text-[11px] font-semibold text-muted-foreground ml-1">Custom Rule</label>
                  <input
                    type="text"
                    placeholder="e.g. 5th of every month"
                    value={newTaskRecurrenceRule}
                    onChange={e => setNewTaskRecurrenceRule(e.target.value)}
                    className="w-full text-sm px-3 py-2 rounded-md bg-background text-foreground placeholder:text-muted-foreground border border-border focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              )}
            </div>
          )}
        </form>
        </div>
      </div>
    </div>
  );
};
