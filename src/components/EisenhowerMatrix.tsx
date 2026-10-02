import React, { useState, useMemo, useCallback } from 'react';
import { useNerdMode } from './ui/detail';
import {
  Flame,
  Clock,
  ArrowDownRight,
  Trash2,
  CheckCircle2,
  Circle,
  GripVertical,
  Calendar,
  Repeat,
  ChevronDown,
  ChevronRight
} from 'lucide-react';

const getDeadlineColor = (deadline: string | undefined, completed: boolean) => {
  if (completed || !deadline) return 'bg-muted text-muted-foreground';
  const today = new Date();
  today.setHours(0,0,0,0);
  const due = new Date(deadline);
  const diffDays = Math.ceil((due.getTime() - today.getTime()) / (1000 * 3600 * 24));
  if (diffDays < 0) return 'bg-destructive/10 text-destructive';
  if (diffDays <= 3) return 'bg-amber-500/10 text-amber-500';
  return 'bg-green-500/10 text-green-500';
};

import type { Activity, Task } from '../types';

interface EisenhowerMatrixProps {
  tasks: Task[];
  activities: Activity[];
  onUpdateTask?: (id: string, updates: { urgency?: boolean | null; importance?: boolean | null; completed?: boolean }) => void;
}

interface Quadrant {
  key: string;
  label: string;
  subtitle: string;
  urgency: boolean;
  importance: boolean;
  icon: React.ReactNode;
  accentColor: string;
  emptyText: string;
}

const QUADRANTS: Quadrant[] = [
  {
    key: 'q1',
    label: 'DO FIRST',
    subtitle: 'Urgent & Important',
    urgency: true,
    importance: true,
    icon: <Flame size={14} />,
    accentColor: 'hsl(0 72% 51%)',       // red
    emptyText: 'No urgent & important tasks. Great job staying ahead!',
  },
  {
    key: 'q2',
    label: 'SCHEDULE',
    subtitle: 'Not Urgent & Important',
    urgency: false,
    importance: true,
    icon: <Clock size={14} />,
    accentColor: 'hsl(217 91% 60%)',     // blue
    emptyText: 'Plan your important tasks here for long-term success.',
  },
  {
    key: 'q3',
    label: 'DELEGATE',
    subtitle: 'Urgent & Not Important',
    urgency: true,
    importance: false,
    icon: <ArrowDownRight size={14} />,
    accentColor: 'hsl(45 93% 47%)',      // yellow
    emptyText: 'Urgent but not important — can someone else handle these?',
  },
  {
    key: 'q4',
    label: 'ELIMINATE',
    subtitle: 'Not Urgent & Not Important',
    urgency: false,
    importance: false,
    icon: <Trash2 size={14} />,
    accentColor: 'hsl(var(--muted-foreground))',
    emptyText: 'Consider removing these — they add little value.',
  },
];

export const EisenhowerMatrix: React.FC<EisenhowerMatrixProps> = ({
  tasks,
  activities,
  onUpdateTask,
}) => {
  const { nerd } = useNerdMode();
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const toggleOpen = (id: string) => setOpenIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const [dragOverQuadrant, setDragOverQuadrant] = useState<string | null>(null);
  const [showCompletedMap, setShowCompletedMap] = useState<Record<string, boolean>>({});

  const getActivity = useCallback((id?: string | null) => activities.find(a => a.id === id), [activities]);

  const toggleCompleted = (qKey: string) => {
    setShowCompletedMap(prev => ({ ...prev, [qKey]: !prev[qKey] }));
  };

  // Group tasks into quadrants
  const tasksByQuadrant = useMemo(() => {
    const map: Record<string, Task[]> = { q1: [], q2: [], q3: [], q4: [], unassigned: [] };
    for (const task of tasks) {
      if (task.urgency === undefined || task.importance === undefined || task.urgency === null || task.importance === null) {
        map.unassigned.push(task);
      } else if (task.urgency === true && task.importance === true) {
        map.q1.push(task);
      } else if (task.urgency === false && task.importance === true) {
        map.q2.push(task);
      } else if (task.urgency === true && task.importance === false) {
        map.q3.push(task);
      } else {
        map.q4.push(task);
      }
    }
    return map;
  }, [tasks]);

  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData('text/plain', taskId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, quadrantKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverQuadrant(quadrantKey);
  };

  const handleDragLeave = () => {
    setDragOverQuadrant(null);
  };

  const handleDrop = (e: React.DragEvent, quadrant: Quadrant) => {
    e.preventDefault();
    setDragOverQuadrant(null);
    const taskId = e.dataTransfer.getData('text/plain');
    if (taskId && onUpdateTask) {
      onUpdateTask(taskId, { urgency: quadrant.urgency, importance: quadrant.importance });
    }
  };

  const handleToggle = (taskId: string, completed: boolean) => {
    if (onUpdateTask) {
      onUpdateTask(taskId, { completed: !completed });
    }
  };

  /** "Move to" picker: the touch (and keyboard) way to sort a task, since drag and drop needs a mouse */
  const moveTo = (task: Task) => (
    <select
      aria-label={`Move ${task.title} to`}
      value=""
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        const q = QUADRANTS.find((x) => x.key === e.target.value);
        if (q) onUpdateTask?.(task.id, { urgency: q.urgency, importance: q.importance });
      }}
      className="tap-compact coarse:min-h-[32px] ml-auto self-start text-[10px] bg-transparent text-muted-foreground border border-border rounded-md px-1 py-0.5 max-w-[88px] lg:opacity-0 lg:group-hover:opacity-100 lg:focus:opacity-100 coarse:opacity-100"
    >
      <option value="" disabled>Move…</option>
      {QUADRANTS.map((q) => <option key={q.key} value={q.key}>{q.label.charAt(0) + q.label.slice(1).toLowerCase()}</option>)}
    </select>
  );

  const renderTaskCard = (task: Task, isDraggable: boolean) => {
    const open = nerd || openIds.has(task.id);
    return (
      <div
        key={task.id}
        onClick={() => task.description && toggleOpen(task.id)}
        draggable={isDraggable}
        onDragStart={isDraggable ? e => handleDragStart(e, task.id) : undefined}
        className={`group flex items-start gap-2 px-2.5 py-2 rounded-lg border border-border bg-background hover:shadow-sm transition-shadow ${
          isDraggable ? 'cursor-grab active:cursor-grabbing' : 'opacity-50'
        }`}
      >
        <button
          onClick={(e) => { e.stopPropagation(); handleToggle(task.id, task.completed); }}
          className="mt-0.5 flex-shrink-0 text-muted-foreground hover:text-primary transition-colors"
        >
          {task.completed ? (
            <CheckCircle2 size={16} className="text-primary" />
          ) : (
            <Circle size={16} />
          )}
        </button>
        <div className="flex-1 min-w-0">
          <span
            className={`text-xs font-medium leading-tight block ${
              task.completed ? 'line-through text-muted-foreground' : 'text-foreground'
            }`}
          >
            {task.title}
          </span>
          {task.description && open && (
            <span className="text-[10px] text-muted-foreground mt-0.5 leading-tight block animate-in fade-in duration-150">
              {task.description}
            </span>
          )}

          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            {task.deadline && (
              <span className={`inline-flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded-sm ${getDeadlineColor(task.deadline, task.completed)}`}>
                <Calendar size={9} />
                {new Date(task.deadline).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
            )}

            {task.recurrence_type && task.recurrence_type !== 'none' && (
              <span className="inline-flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded-sm bg-muted text-muted-foreground">
                <Repeat size={9} />
                {task.recurrence_type === 'custom' ? 'Custom' : task.recurrence_type.charAt(0).toUpperCase() + task.recurrence_type.slice(1)}
              </span>
            )}
          </div>
        </div>
        {!task.completed && moveTo(task)}
      </div>
    );
  };

  return (
    <div className="flex flex-col flex-1 h-full bg-background overflow-y-auto md:overflow-hidden">

      {/* Unassigned Tasks */}
      {tasksByQuadrant.unassigned.length > 0 && (
        <div className="px-4 py-2 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs font-semibold text-muted-foreground">
              Unsorted
            </span>
            <span className="text-[10px] ibm-mono text-muted-foreground">
              ({tasksByQuadrant.unassigned.length})
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {tasksByQuadrant.unassigned.map(task => {
              const activity = getActivity(task.activity_id);
              return (
                <div
                  key={task.id}
                  draggable
                  onDragStart={e => handleDragStart(e, task.id)}
                  className="group flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-card text-xs cursor-grab active:cursor-grabbing hover:shadow-sm transition-shadow"
                >
                  <GripVertical size={10} className="text-muted-foreground" />
                  {activity && (
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: activity.color }}
                    />
                  )}
                  <span className="text-foreground font-medium truncate max-w-[140px]">
                    {task.title}
                  </span>
                  {moveTo(task)}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 2x2 Grid */}
      <div className="md:flex-1 grid grid-cols-1 md:grid-cols-2 md:grid-rows-2 gap-px bg-border md:overflow-hidden md:min-h-0">
        {QUADRANTS.map(quadrant => {
          const qTasks = tasksByQuadrant[quadrant.key] || [];
          const activeTasks = qTasks.filter(t => !t.completed);
          const completedTasks = qTasks.filter(t => t.completed);
          const isDragOver = dragOverQuadrant === quadrant.key;

          return (
            <div
              key={quadrant.key}
              onDragOver={e => handleDragOver(e, quadrant.key)}
              onDragLeave={handleDragLeave}
              onDrop={e => handleDrop(e, quadrant)}
              className={`flex flex-col bg-card transition-colors md:overflow-hidden md:min-h-0 ${
                isDragOver ? 'bg-primary/5 ring-2 ring-inset ring-primary/20' : ''
              }`}
            >
              {/* Quadrant Header */}
              <div className="flex items-center justify-between px-3 py-2.5 flex-shrink-0">
                <div className="flex items-center gap-2">
                  <span style={{ color: quadrant.accentColor }}>{quadrant.icon}</span>
                  <div>
                    <span
                      className="font-display text-sm font-semibold"
                      style={{ color: quadrant.accentColor }}
                    >
                      {quadrant.label.charAt(0) + quadrant.label.slice(1).toLowerCase()}
                    </span>
                    <p className="text-[10px] text-muted-foreground leading-tight">{quadrant.subtitle}</p>
                  </div>
                </div>
                <span
                  className="text-[10px] font-semibold ibm-mono px-1.5 py-0.5 rounded-full"
                  style={{
                    backgroundColor: quadrant.accentColor + '18',
                    color: quadrant.accentColor,
                  }}
                >
                  {activeTasks.length}
                </span>
              </div>

              {/* Task List */}
              <div className="md:flex-1 md:overflow-y-auto px-2 pb-2">
                <div className="space-y-1">
                  {qTasks.length === 0 ? (
                    <div className="flex items-center justify-center py-6 px-4">
                      <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
                        {quadrant.emptyText}
                      </p>
                    </div>
                  ) : (
                    activeTasks.map(task => renderTaskCard(task, true))
                  )}
                </div>

                {completedTasks.length > 0 && (
                  <div className="mt-4">
                    <button
                      onClick={() => toggleCompleted(quadrant.key)}
                      className="flex items-center gap-1 w-full text-left px-1 mb-2 text-muted-foreground hover:text-foreground transition-colors group"
                    >
                      {showCompletedMap[quadrant.key] ? <ChevronDown size={12} className="group-hover:text-foreground" /> : <ChevronRight size={12} className="group-hover:text-foreground" />}
                      <span className="text-[11px] font-semibold">
                        Completed ({completedTasks.length})
                      </span>
                    </button>
                    {showCompletedMap[quadrant.key] && (
                      <div className="space-y-1">
                        {completedTasks.map(task => renderTaskCard(task, false))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
