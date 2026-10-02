import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { X, Eraser, Plus, Search, ChevronDown, Copy, Clock, Repeat, Keyboard, MoreHorizontal } from 'lucide-react';
import { useNerdMode } from './ui/detail';
import { isSameDay, isBefore, startOfDay, format } from 'date-fns';
import type { Activity, Task, Block } from '../types';
import { TimeBlockCell } from './TimeBlockCell';
import { getCopySources, type CopyPlan } from '../lib/copyDay';
import { useNow } from '../hooks/useNow';

const LAST_ASSIGN_KEY = 'blockday_last_assign';
interface LastAssign { activityId: string; taskId: string | null }
const loadLastAssign = (): LastAssign | null => {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_ASSIGN_KEY) || 'null');
    return v && typeof v.activityId === 'string' ? v : null;
  } catch { return null; }
};

const SHORTCUTS: [string, string][] = [
  ['← → ↑ ↓', 'Move between blocks (↑↓ jump one hour)'],
  ['Shift + arrows', 'Extend the selection'],
  ['Enter', 'Assign the last used activity to the selection'],
  ['A or Space', 'Open the activity picker'],
  ['C', 'Clear the selection'],
  ['Esc', 'Cancel / close'],
  ['?', 'Show this help'],
];

interface TimeGridProps {
  blocks: Block[];
  activities: Activity[];
  tasks: Task[];
  onAssignActivity: (blockIndices: number[], activityId: string | null, taskId?: string | null) => void;
  selectedTaskId: string | null;
  onAddActivity?: (activity: Omit<Activity, 'id'>) => void;
  selectedDate: Date;
  onPreviewCopy?: (sourceDateKey: string) => Promise<CopyPlan | null>;
  onCopyFromDate?: (sourceDateKey: string) => Promise<number>;
}

const PREDEFINED_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#84cc16', '#22c55e', '#10b981', '#14b8a6',
  '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
  '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
];

function blockIndexToTime(i: number): string {
  const totalMinutes = (i % 144) * 10;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const displayH = h % 12 === 0 ? 12 : h % 12;
  return `${displayH}:${m.toString().padStart(2, '0')} ${ampm}`;
}

export const TimeGrid: React.FC<TimeGridProps> = ({
  blocks,
  activities,
  tasks,
  onAssignActivity,
  onAddActivity,
  selectedDate,
  onPreviewCopy,
  onCopyFromDate,
}) => {
  // same minute boundary as the top-bar clock, re-read when the tab wakes up
  const now = useNow(60_000);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 1024 || window.matchMedia?.("(pointer: coarse)").matches);

  useEffect(() => {
    const resizeHandler = () => setIsMobile(window.innerWidth < 1024 || window.matchMedia?.("(pointer: coarse)").matches);
    window.addEventListener('resize', resizeHandler);
    return () => {
      window.removeEventListener('resize', resizeHandler);
    };
  }, []);

  const currentBlockIndex = Math.floor((now.getHours() * 60 + now.getMinutes()) / 10);
  const isToday = isSameDay(selectedDate, now);
  const isPastDay = isBefore(startOfDay(selectedDate), startOfDay(now));

  const [anchorIdx, setAnchorIdx] = useState<number | null>(null);
  const [targetIdx, setTargetIdx] = useState<number | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [menuCoords, setMenuCoords] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);
  useEffect(() => { isDraggingRef.current = isDragging; }, [isDragging]);
  const [cursorIdx, setCursorIdx] = useState<number | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showCopyMenu, setShowCopyMenu] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const { nerd } = useNerdMode();
  const [lastAssign, setLastAssign] = useState<LastAssign | null>(loadLastAssign);
  const gridRef = useRef<HTMLDivElement>(null);

  // Activity picker state
  const [searchQuery, setSearchQuery] = useState('');
  // null = untouched (falls back to the task already on the selected blocks); '' = explicitly "No task"
  const [pickedTaskId, setPickedTaskId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newActivityName, setNewActivityName] = useState('');
  const [newActivityColor, setNewActivityColor] = useState('#3b82f6');
  const [newActivityCategory, setNewActivityCategory] = useState('Work');
  const searchRef = useRef<HTMLInputElement>(null);

  // ESC key to cancel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAnchorIdx(null);
        setTargetIdx(null);
        setMenuCoords(null);
        setIsDragging(false);
        setShowAddForm(false);
        setSearchQuery('');
        setShowHelp(false);
        setShowCopyMenu(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Focus search when picker opens
  useEffect(() => {
    if (menuCoords && searchRef.current) {
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [menuCoords]);

  // Stable callbacks so memoized cells are not re-rendered by unrelated state changes
  const handleCellMouseDown = useCallback((idx: number) => {
    setAnchorIdx(idx);
    setTargetIdx(idx);
    setCursorIdx(idx);
    setMenuCoords(null);
    setIsDragging(true);
  }, []);

  const handleCellMouseEnter = useCallback((idx: number) => {
    setHoverIdx(idx);
    if (isDraggingRef.current) setTargetIdx(idx);
  }, []);

  const handleCellMouseLeave = useCallback(() => setHoverIdx(null), []);
  const handleCellFocus = useCallback((idx: number) => setCursorIdx(idx), []);

  const handleMouseUp = (e: React.MouseEvent | React.TouchEvent) => {
    if (isDragging) {
      setIsDragging(false);
      let x = 0, y = 0;
      if ('changedTouches' in e) {
        x = (e as React.TouchEvent).changedTouches[0].clientX;
        y = (e as React.TouchEvent).changedTouches[0].clientY;
      } else {
        x = (e as React.MouseEvent).clientX;
        y = (e as React.MouseEvent).clientY;
      }
      setMenuCoords({ x, y });
      setSearchQuery('');
      setShowAddForm(false);
    }
  };

  const getTouchIdx = (touch: React.Touch): number | null => {
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const blockEl = el?.closest('[data-idx]');
    const idx = blockEl?.getAttribute('data-idx');
    return idx !== null && idx !== undefined ? parseInt(idx, 10) : null;
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const idx = getTouchIdx(e.touches[0]);
    if (idx !== null) {
      setAnchorIdx(idx);
      setTargetIdx(idx);
      setMenuCoords(null);
      setIsDragging(true);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;
    const idx = getTouchIdx(e.touches[0]);
    if (idx !== null) setTargetIdx(idx);
  };

  const selectedRange =
    anchorIdx !== null && targetIdx !== null
      ? [Math.min(anchorIdx, targetIdx), Math.max(anchorIdx, targetIdx)]
      : null;

  const getRangeIndices = () => {
    if (!selectedRange) return [];
    const arr = [];
    for (let i = selectedRange[0]; i <= selectedRange[1]; i++) arr.push(i);
    return arr;
  };

  // Task shared by every selected block (if any), so reopening the menu shows the existing link
  const rangeTaskId = (() => {
    const ids = new Set(getRangeIndices().map((i) => blocks.find((b) => b.block_index === i)?.task_id ?? null));
    return ids.size === 1 ? [...ids][0] : null;
  })();
  const shownTaskId = pickedTaskId ?? rangeTaskId ?? '';

  const activityById = useMemo(() => new Map(activities.map((a) => [a.id, a])), [activities]);
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const rememberAssign = (activityId: string | null, taskId: string | null) => {
    if (!activityId) return;
    const next = { activityId, taskId };
    setLastAssign(next);
    try { localStorage.setItem(LAST_ASSIGN_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  };

  // Last used activity (still valid = exists and not archived); its task only if still active
  const lastActivity = lastAssign ? activityById.get(lastAssign.activityId) : undefined;
  const lastUsable = !!lastActivity && !lastActivity.archived;
  const lastTask = lastAssign?.taskId ? taskById.get(lastAssign.taskId) : undefined;
  const lastTaskId = lastTask && !lastTask.completed ? lastTask.id : null;

  const clearSelection = () => {
    setAnchorIdx(null);
    setTargetIdx(null);
    setMenuCoords(null);
  };

  const assignLastUsed = (indices: number[] = getRangeIndices()) => {
    if (!lastUsable || !lastAssign || indices.length === 0) return;
    onAssignActivity(indices, lastAssign.activityId, lastTaskId);
    clearSelection();
  };

  const cellEl = (idx: number) => gridRef.current?.querySelector(`[data-idx="${idx}"]`) as HTMLElement | null | undefined;

  const focusCell = (idx: number) => {
    requestAnimationFrame(() => cellEl(idx)?.focus());
  };

  const openPickerAt = (idx: number) => {
    const r = cellEl(idx)?.getBoundingClientRect();
    setMenuCoords({ x: r ? r.left : 40, y: r ? r.bottom : 120 });
    setSearchQuery('');
    setShowAddForm(false);
  };

  const handleGridKeyDown = (e: React.KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const cur = cursorIdx ?? (isToday ? currentBlockIndex : 0);
    const move = (delta: number) => {
      e.preventDefault();
      const next = Math.max(0, Math.min(143, cur + delta));
      if (e.shiftKey) {
        if (anchorIdx === null) setAnchorIdx(cur);
        setTargetIdx(next);
      } else {
        setAnchorIdx(next);
        setTargetIdx(next);
      }
      setCursorIdx(next);
      setMenuCoords(null);
      focusCell(next);
    };
    switch (e.key) {
      case 'ArrowRight': return move(1);
      case 'ArrowLeft': return move(-1);
      case 'ArrowDown': return move(6);
      case 'ArrowUp': return move(-6);
      case 'Enter': {
        e.preventDefault();
        const indices = selectedRange ? getRangeIndices() : [cur];
        if (lastUsable) {
          assignLastUsed(indices);
        } else {
          setAnchorIdx(indices[0]);
          setTargetIdx(indices[indices.length - 1]);
          openPickerAt(cur);
        }
        return;
      }
      case ' ':
      case 'a':
      case 'A':
        e.preventDefault();
        if (!selectedRange) { setAnchorIdx(cur); setTargetIdx(cur); }
        openPickerAt(cur);
        return;
      case 'c':
      case 'C':
        e.preventDefault();
        clearSelection();
        return;
      case '?':
        e.preventDefault();
        setShowHelp(true);
        return;
    }
  };

  const jumpToNow = () => {
    setCursorIdx(currentBlockIndex);
    cellEl(currentBlockIndex)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  // Bring the current block into view when opening today
  useEffect(() => {
    if (isToday) cellEl(currentBlockIndex)?.scrollIntoView({ block: 'center' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isToday]);

  const handleCopy = async (sourceDateKey: string) => {
    setShowCopyMenu(false);
    if (!onPreviewCopy || !onCopyFromDate || !sourceDateKey) return;
    const plan = await onPreviewCopy(sourceDateKey);
    if (!plan) return;
    if (plan.toWrite.length === 0) {
      window.alert(plan.skippedFilled > 0 ? 'Nothing to copy: the matching blocks are already filled.' : 'Nothing to copy: that day has no tracked blocks.');
      return;
    }
    const extra = [
      plan.skippedFilled ? `${plan.skippedFilled} already-filled block(s) will be kept` : '',
      plan.skippedArchived ? `${plan.skippedArchived} block(s) using archived activities will be skipped` : '',
    ].filter(Boolean).join('; ');
    const target = format(selectedDate, 'yyyy-MM-dd');
    if (window.confirm(`Copy ${plan.toWrite.length} block(s) from ${sourceDateKey} into ${target}?${extra ? `\n\n${extra}.` : ''}\n\nTask links are not copied.`)) {
      await onCopyFromDate(sourceDateKey);
    }
  };

  const handleAssign = (activityId: string | null) => {
    const indices = getRangeIndices();
    if (indices.length > 0) {
      onAssignActivity(indices, activityId, shownTaskId || null);
      rememberAssign(activityId, shownTaskId || null);
      setPickedTaskId(null);
      setAnchorIdx(null);
      setTargetIdx(null);
      setMenuCoords(null);
      setSearchQuery('');
      setShowAddForm(false);
    }
  };

  const handleAddNewActivity = () => {
    if (!newActivityName.trim()) return;
    onAddActivity?.({
      name: newActivityName.trim(),
      color: newActivityColor,
      category: newActivityCategory as any,
    });
    setNewActivityName('');
    setNewActivityColor('#3b82f6');
    setNewActivityCategory('Work');
    setShowAddForm(false);
  };

  const closeMenu = () => {
    setAnchorIdx(null);
    setTargetIdx(null);
    setMenuCoords(null);
    setSearchQuery('');
    setPickedTaskId(null);
    setShowAddForm(false);
    setIsDragging(false);
  };


  const filteredActivities = activities.filter((a) =>
    !a.archived && a.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const CATEGORY_ORDER = ['Work', 'Health', 'Admin', 'Leisure', 'Other', 'Uncategorized'];
  const groupedActivities = filteredActivities.reduce((acc, act) => {
    const cat = act.category || 'Uncategorized';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(act);
    return acc;
  }, {} as Record<string, typeof activities>);
  
  Object.values(groupedActivities).forEach(arr => arr.sort((a, b) => a.name.localeCompare(b.name)));

  const rangeLabel = selectedRange ? `${blockIndexToTime(selectedRange[0])}–${blockIndexToTime(selectedRange[1] + 1)}` : '';

  // Summary bar stats
  const assignedCount = blocks.filter((b) => b.activity_id !== null).length;
  const untrackedCount = blocks.filter((b) => b.activity_id === null).length;
  const trackedMinutes = assignedCount * 10;
  const hours = Math.floor(trackedMinutes / 60);
  const mins = trackedMinutes % 60;

  // Plain function (not a component) so inputs don't lose focus on re-render
  const renderActivityPickerContent = () => (
    <div className="flex flex-col gap-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-muted-foreground">
          Assign {getRangeIndices().length} block{getRangeIndices().length !== 1 ? 's' : ''}
          {selectedRange && <span className="normal-case tracking-normal font-medium"> · {rangeLabel}</span>}
        </span>
        <button onClick={closeMenu} className="text-muted-foreground hover:text-foreground p-0.5 rounded">
          <X size={14} />
        </button>
      </div>

      {lastUsable && lastActivity && (
        <button
          onClick={() => { onAssignActivity(getRangeIndices(), lastActivity.id, lastTaskId); clearSelection(); }}
          className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium border border-border hover:bg-accent transition-all text-left"
        >
          <Repeat size={12} className="text-muted-foreground" />
          <span className="flex-1 truncate">Repeat: {lastActivity.emoji ? `${lastActivity.emoji} ` : ''}{lastActivity.name}</span>
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: lastActivity.color }} />
        </button>
      )}

      {/* Optional task link */}
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold text-muted-foreground">Task (optional)</span>
        <select
          value={shownTaskId}
          onChange={(e) => setPickedTaskId(e.target.value)}
          className="w-full px-2 py-1.5 text-xs rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">No task</option>
          {tasks.filter((t) => !t.completed || t.id === shownTaskId).map((t) => (
            <option key={t.id} value={t.id}>{t.title}</option>
          ))}
        </select>
      </label>

      {/* Search */}
      <div className="relative">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <input
          ref={searchRef}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search activities..."
          className="w-full pl-7 pr-3 py-1.5 text-xs rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {/* Activity list */}
      <div className="flex flex-col gap-1 max-h-[200px] overflow-y-auto">
        <button
          onClick={() => handleAssign(null)}
          className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-all min-h-[36px] text-left mx-1"
        >
          <Eraser size={13} />
          Clear blocks
        </button>
        
        {filteredActivities.length === 0 && searchQuery && (
          <p className="text-xs text-muted-foreground text-center py-2">No activities found</p>
        )}
        
        {CATEGORY_ORDER.map(cat => {
          const acts = groupedActivities[cat];
          if (!acts || acts.length === 0) return null;
          return (
            <div key={cat} className="flex flex-col gap-0.5">
              <div className="text-[11px] font-bold text-muted-foreground px-3 py-1 mt-1">
                {cat}
              </div>
              {acts.map((a) => (
                <button
                  key={a.id}
                  onClick={() => handleAssign(a.id)}
                  className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium text-foreground hover:bg-accent transition-all min-h-[36px] text-left mx-1"
                >
                  <span
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: a.color }}
                  />
                  <span className="flex-1 truncate">{a.name}</span>
                  {(a as any).emoji && (
                    <span className="text-sm flex-shrink-0">{(a as any).emoji}</span>
                  )}
                </button>
              ))}
            </div>
          );
        })}
      </div>

      {/* Add activity section */}
      {onAddActivity && (
        <div className="border-t border-border pt-2">
          <button
            onClick={() => setShowAddForm((v) => !v)}
            className="flex items-center gap-2 w-full px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors rounded-lg hover:bg-accent"
          >
            <Plus size={12} />
            <span>Add activity</span>
            <ChevronDown size={11} className={`ml-auto transition-transform ${showAddForm ? 'rotate-180' : ''}`} />
          </button>

          {showAddForm && (
            <div className="mt-2 space-y-2">
              <input
                value={newActivityName}
                onChange={(e) => setNewActivityName(e.target.value)}
                placeholder="Activity name"
                onKeyDown={(e) => e.key === 'Enter' && handleAddNewActivity()}
                className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <select
                value={newActivityCategory}
                onChange={(e) => setNewActivityCategory(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="Work">Work</option>
                <option value="Health">Health</option>
                <option value="Admin">Admin</option>
                <option value="Leisure">Leisure</option>
                <option value="Other">Other</option>
              </select>
              <div className="flex flex-wrap gap-1.5">
                {PREDEFINED_COLORS.map((color) => (
                  <button
                    key={color}
                    onClick={() => setNewActivityColor(color)}
                    className={`w-6 h-6 rounded-full transition-transform ${
                      newActivityColor === color ? 'scale-125 ring-2 ring-primary ring-offset-1 ring-offset-background' : 'hover:scale-110'
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
              <button
                onClick={handleAddNewActivity}
                disabled={!newActivityName.trim()}
                className="w-full py-1.5 text-xs font-semibold bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-40 transition-all"
              >
                Add activity
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div
      className="flex flex-col h-full bg-background select-none"
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleMouseUp}
    >
      {/* Grid Area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-4 sm:p-4 md:p-6 [--cell:34px] [--gap:8px] sm:[--cell:36px] sm:[--gap:12px] short:[--cell:30px] short:[--gap:10px] 2xl:[--cell:40px] 2xl:[--gap:14px] uw:[--cell:44px] uw:[--gap:16px]">
        <div className="w-fit mx-auto flex gap-2 sm:gap-3 md:gap-6">
          {/* Time Labels (Every 2 hours) */}
          <div className="flex flex-col flex-shrink-0 w-10 sm:w-[45px]">
            {Array.from({ length: 12 }).map((_, i) => {
              const h = i * 2;
              const ampm = h >= 12 ? 'PM' : 'AM';
              const displayH = h % 12 === 0 ? 12 : h % 12;
              return (
                <div key={i} className="flex items-start justify-end pr-1 sm:pr-2" style={{ height: 'calc(2 * (var(--cell) + var(--gap)))', paddingTop: 'calc(var(--cell) / 3.6)' }}>
                  <span className="text-[10px] font-medium text-muted-foreground ibm-mono leading-none">
                    {displayH} {ampm}
                  </span>
                </div>
              );
            })}
          </div>

          {/* 6×24 Circle Grid */}
          <div
            ref={gridRef}
            role="group"
            aria-label="Time blocks, 10 minutes each. Arrow keys move, Shift extends, Enter repeats the last activity, question mark shows shortcuts."
            onKeyDown={handleGridKeyDown}
            className="grid grid-cols-6 gap-[var(--gap)] content-start"
          >
            {blocks.map((block) => {
              const isPast = isPastDay || (isToday && block.block_index < currentBlockIndex);
              const isCurrent = isToday && block.block_index === currentBlockIndex;
              const act = block.activity_id ? activityById.get(block.activity_id) : undefined;
              const isSelected = !!selectedRange && block.block_index >= selectedRange[0] && block.block_index <= selectedRange[1];
              const isHoverPreview =
                !isSelected && anchorIdx !== null && hoverIdx !== null &&
                block.block_index >= Math.min(anchorIdx, hoverIdx) && block.block_index <= Math.max(anchorIdx, hoverIdx);
              const linkedTask = block.task_id ? taskById.get(block.task_id) : undefined;
              const blockTime = blockIndexToTime(block.block_index);
              const title = act ? `${blockTime} - ${act.name}${linkedTask ? ` · ${linkedTask.title}` : ''}` : blockTime;

              return (
                <TimeBlockCell
                  key={block.block_index}
                  idx={block.block_index}
                  color={act?.color ?? null}
                  emoji={act?.emoji ?? null}
                  isPast={isPast}
                  isCurrent={isCurrent}
                  isSelected={isSelected}
                  isHoverPreview={isHoverPreview}
                  isCursor={block.block_index === (cursorIdx ?? (isToday ? currentBlockIndex : 0))}
                  title={title}
                  onMouseDown={handleCellMouseDown}
                  onMouseEnter={handleCellMouseEnter}
                  onMouseLeave={handleCellMouseLeave}
                  onFocusCell={handleCellFocus}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Summary Bar */}
      <div className="flex-shrink-0 border-t border-border px-4 md:px-6 py-2.5 flex items-center gap-3 bg-card flex-wrap relative">
        <span className="text-[11px] text-muted-foreground ibm-mono">
          <span className="text-foreground font-medium">
            {hours > 0 ? `${hours}h ` : ''}{mins > 0 ? `${mins}m` : hours === 0 ? '0m' : ''}
          </span> tracked
        </span>
        {nerd && (
          <>
            <span className="text-muted-foreground text-[10px]">·</span>
            <span className="text-[11px] text-muted-foreground ibm-mono">
              <span className="text-foreground font-medium">{assignedCount}</span> assigned · <span className="text-foreground font-medium">{untrackedCount}</span> untracked blocks
            </span>
          </>
        )}
        {selectedRange && (
          <>
            <span className="text-muted-foreground text-[10px]">·</span>
            <span className="text-[11px] text-muted-foreground ibm-mono">
              Selected <span className="text-foreground font-medium">{rangeLabel}</span>
            </span>
            {lastUsable && lastActivity && (
              <button
                onClick={() => assignLastUsed()}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-border hover:bg-accent"
                title="Assign the last used activity (Enter)"
              >
                <Repeat size={11} /> {lastActivity.emoji ? `${lastActivity.emoji} ` : ''}{lastActivity.name}
              </button>
            )}
          </>
        )}

        <div className="ml-auto flex items-center gap-2 relative">
          {isToday && (
            <button
              onClick={jumpToNow}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-border hover:bg-accent ibm-mono"
              title="Jump to the current block"
            >
              <Clock size={11} className="text-destructive" /> Now {format(now, 'h:mm a')}
            </button>
          )}
          {/* Less-used tools live behind one button */}
          <button
            onClick={() => { setShowMore((v) => !v); setShowCopyMenu(false); }}
            aria-expanded={showMore}
            aria-label="More tools"
            title="More: copy a day, keyboard shortcuts"
            className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-border hover:bg-accent"
          >
            <MoreHorizontal size={14} />
          </button>
          {showMore && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowMore(false)} />
              <div className="absolute bottom-full right-0 mb-2 z-50 w-52 bg-card border border-border rounded-xl shadow-2xl p-1.5 flex flex-col">
                {onPreviewCopy && onCopyFromDate && (
                  <button onClick={() => { setShowMore(false); setShowCopyMenu(true); }} className="flex items-center gap-2 text-left text-xs px-2.5 py-2 rounded-lg hover:bg-accent">
                    <Copy size={13} /> Copy another day…
                  </button>
                )}
                <button onClick={() => { setShowMore(false); setShowHelp(true); }} className="flex items-center gap-2 text-left text-xs px-2.5 py-2 rounded-lg hover:bg-accent">
                  <Keyboard size={13} /> Keyboard shortcuts <span className="ml-auto text-muted-foreground ibm-mono">?</span>
                </button>
              </div>
            </>
          )}
          {onPreviewCopy && onCopyFromDate && (
            <>
              {showCopyMenu && <div className="fixed inset-0 z-40" onClick={() => setShowCopyMenu(false)} />}
              {showCopyMenu && (
                <div className="absolute bottom-full right-0 mb-2 z-50 w-64 bg-card border border-border rounded-xl shadow-2xl p-2 flex flex-col gap-1">
                  {getCopySources(selectedDate).map((src) => (
                    <button
                      key={src.dateKey}
                      onClick={() => handleCopy(src.dateKey)}
                      className="text-left text-xs px-2.5 py-2 rounded-lg hover:bg-accent"
                    >
                      {src.label}
                    </button>
                  ))}
                  <label className="flex flex-col gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground">
                    Copy date…
                    <input
                      type="date"
                      max={format(new Date(), 'yyyy-MM-dd')}
                      onChange={(e) => e.target.value && handleCopy(e.target.value)}
                      className="text-xs normal-case tracking-normal px-2 py-1.5 rounded-md border border-border bg-background text-foreground"
                    />
                  </label>
                  <p className="px-2.5 pb-1 text-[10px] text-muted-foreground">Only empty blocks are filled. Task links aren't copied.</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {showHelp && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setShowHelp(false)} />
          <div role="dialog" aria-label="Keyboard shortcuts" className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(92vw,420px)] bg-card border border-border rounded-2xl shadow-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold">Keyboard shortcuts</h3>
              <button onClick={() => setShowHelp(false)} className="p-1 rounded hover:bg-accent" aria-label="Close"><X size={14} /></button>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
              {SHORTCUTS.map(([k, d]) => (
                <React.Fragment key={k}>
                  <dt className="font-mono font-semibold text-foreground whitespace-nowrap">{k}</dt>
                  <dd className="text-muted-foreground">{d}</dd>
                </React.Fragment>
              ))}
            </dl>
          </div>
        </>
      )}

      {/* DESKTOP: Floating Tooltip Menu */}
      {!isMobile && selectedRange && menuCoords && (
        <>
          {/* Transparent backdrop */}
          <div
            className="fixed inset-0 z-40"
            onMouseDown={(e) => {
              e.stopPropagation();
              closeMenu();
            }}
          />
          <div
            className="fixed z-50 bg-card/95 backdrop-blur-md border border-border/80 shadow-2xl rounded-2xl p-3 w-[260px] animate-in fade-in zoom-in-95 duration-150"
            style={{
              left: Math.min(menuCoords.x, window.innerWidth - 280),
              top: Math.min(menuCoords.y + 15, window.innerHeight - 400),
            }}
          >
            {renderActivityPickerContent()}
          </div>
        </>
      )}

      {/* MOBILE: Bottom Sheet */}
      {isMobile && selectedRange && menuCoords && (
        <>
          {/* Overlay */}
          <div
            className="fixed inset-0 z-40 bg-black/40"
            onClick={closeMenu}
          />
          {/* Sheet */}
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border rounded-t-3xl p-4 pb-[calc(2rem+var(--safe-b))] shadow-2xl animate-in slide-in-from-bottom duration-200 max-h-[70dvh] overflow-y-auto">
            {/* Drag handle */}
            <div className="flex justify-center mb-3">
              <div className="w-10 h-1 rounded-full bg-border" />
            </div>
            {renderActivityPickerContent()}
          </div>
        </>
      )}
    </div>
  );
};
