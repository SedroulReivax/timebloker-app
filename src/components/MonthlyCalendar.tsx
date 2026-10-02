import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, CheckCircle2, Circle, Trash2, CalendarDays, Plus } from 'lucide-react';
import { format } from 'date-fns';
import type { Task, Activity } from '../types';
import { getTasksForDate as selectTasksForDate } from '../lib/selectors';

interface MonthlyCalendarProps {
  tasks: Task[];
  activities: Activity[];
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  onNavigateToDaily: () => void;
  onToggleTask: (id: string, completed: boolean) => void;
  onDeleteTask: (id: string) => void;
}

export const MonthlyCalendar: React.FC<MonthlyCalendarProps> = ({
  tasks,
  activities,
  selectedDate,
  onSelectDate,
  onNavigateToDaily,
  onToggleTask,
  onDeleteTask,
}) => {
  const [currentMonth, setCurrentMonth] = useState(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
  const [popoverDate, setPopoverDate] = useState<Date | null>(null);

  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
  const firstDayOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay();

  const handlePrevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
    setPopoverDate(null);
  };

  const handleNextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
    setPopoverDate(null);
  };

  const handleDayClick = (date: Date) => {
    onSelectDate(date);
    setPopoverDate(date);
  };

  const getTasksForDate = (date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    return selectTasksForDate(tasks, dateStr);
  };

  const getActivityColor = (activityId: string | null) => {
    if (!activityId) return '#888888';
    return activities.find(a => a.id === activityId)?.color || '#888888';
  };

  const days = [];
  // Empty slots before the 1st
  for (let i = 0; i < firstDayOfMonth; i++) {
    days.push(<div key={`empty-${i}`} className="bg-card/30 border-r border-b border-border/50" />);
  }

  // Actual days
  for (let i = 1; i <= daysInMonth; i++) {
    const d = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), i);
    const dayTasks = getTasksForDate(d);
    const isToday = new Date().toDateString() === d.toDateString();
    const isSelected = selectedDate.toDateString() === d.toDateString();

    days.push(
      <div
        key={i}
        onClick={() => handleDayClick(d)}
        className={`min-h-[56px] sm:min-h-[88px] short:min-h-[72px] 2xl:min-h-[110px] border-r border-b border-border/60 p-1 sm:p-2 cursor-pointer hover:bg-accent/50 transition-colors relative flex flex-col ${
          isSelected ? 'bg-primary/5' : 'bg-card'
        }`}
      >
        <span className={`text-xs font-semibold self-start mb-1 sm:mb-1.5 w-6 h-6 flex items-center justify-center rounded-full ${
          isToday ? 'bg-primary text-primary-foreground' : 'text-foreground'
        }`}>
          {i}
        </span>
        <div className="flex flex-wrap items-center gap-1 mt-auto">
          {dayTasks.slice(0, 4).map(task => (
            <div
              key={task.id}
              className={`w-2 h-2 rounded-full ${task.completed ? 'opacity-40' : ''}`}
              style={{ backgroundColor: getActivityColor(task.activity_id) }}
              title={task.title}
            />
          ))}
          {dayTasks.length > 4 && <span className="text-[10px] text-muted-foreground ibm-mono leading-none">+{dayTasks.length - 4}</span>}
        </div>
      </div>
    );
  }

  // Fill remainder of grid
  const remainingSlots = (7 - (days.length % 7)) % 7;
  for (let i = 0; i < remainingSlots; i++) {
    days.push(<div key={`empty-end-${i}`} className="bg-card/30 border-r border-b border-border/50" />);
  }

  return (
    <div className="flex flex-col flex-1 h-full bg-background relative w-full">
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-border bg-card flex-shrink-0">
        <h2 className="text-base sm:text-lg font-bold text-foreground">
          {currentMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </h2>
        <div className="flex gap-2">
          <button onClick={handlePrevMonth} className="p-2 border border-border rounded-md hover:bg-accent text-foreground transition-colors">
            <ChevronLeft size={16} />
          </button>
          <button onClick={handleNextMonth} className="p-2 border border-border rounded-md hover:bg-accent text-foreground transition-colors">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-auto min-w-0 w-full no-scrollbar" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="w-full max-w-[1400px] uw:max-w-[1800px] mx-auto h-full p-2 sm:p-4 md:p-6">
          <div className="grid grid-cols-7 border-t border-l border-border/60 rounded-2xl overflow-hidden bg-card">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
              <div key={day} className="px-1 py-2 border-r border-b border-border/60 text-center text-[11px] font-medium text-muted-foreground">
                <span className="sm:hidden">{day[0]}</span><span className="hidden sm:inline">{day}</span>
              </div>
            ))}
            {days}
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
              {getTasksForDate(popoverDate).length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No tasks scheduled for this day.</p>
              ) : (
                getTasksForDate(popoverDate).map(task => (
                  <div key={task.id} className="flex items-start gap-2.5 p-2.5 rounded-md border border-border hover:border-primary/50 transition-colors bg-background group">
                    <button onClick={() => onToggleTask(task.id, task.completed)} className="mt-0.5 text-muted-foreground hover:text-primary transition-colors flex-shrink-0">
                      {task.completed ? <CheckCircle2 size={16} className="text-primary" /> : <Circle size={16} />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium leading-tight truncate ${task.completed ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                        {task.title}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: getActivityColor(task.activity_id) }} />
                        <span className="text-[11px] text-muted-foreground font-medium">
                          {activities.find(a => a.id === task.activity_id)?.name || 'Unassigned'}
                        </span>
                      </div>
                    </div>
                    <button onClick={() => onDeleteTask(task.id)} className="opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 focus-visible:opacity-100 p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-all flex-shrink-0">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))
              )}
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
