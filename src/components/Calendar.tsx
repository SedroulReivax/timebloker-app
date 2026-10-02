import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  format, addMonths, subMonths, startOfMonth, endOfMonth,
  startOfWeek, endOfWeek, isSameMonth, isSameDay, addDays, isToday
} from 'date-fns';

interface CalendarProps {
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
}

export const Calendar: React.FC<CalendarProps> = ({ selectedDate, onSelectDate }) => {
  const [currentMonth, setCurrentMonth] = useState(selectedDate);

  const nextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));
  const prevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);

  const dayLabelStart = startOfWeek(currentMonth);
  const dayLabels = Array.from({ length: 7 }, (_, i) => (
    <div key={`lbl-${i}`} className="text-center text-[9px] font-semibold text-muted-foreground py-1">
      {format(addDays(dayLabelStart, i), 'eeeee')}
    </div>
  ));

  const cells: React.ReactNode[] = [];
  let day = startDate;
  while (day <= endDate) {
    const cloneDay = day;
    const inMonth = isSameMonth(day, monthStart);
    const selected = isSameDay(day, selectedDate);
    const todayDay = isToday(day);
    cells.push(
      <div
        key={day.toString()}
        onClick={() => { if (inMonth) onSelectDate(cloneDay); }}
        className={`flex items-center justify-center text-[11px] rounded-full w-7 h-7 mx-auto transition-colors ${
          !inMonth
            ? 'text-muted-foreground/30 cursor-default'
            : selected
            ? 'bg-primary text-primary-foreground font-semibold cursor-pointer'
            : todayDay
            ? 'text-primary font-semibold ring-1 ring-primary cursor-pointer hover:bg-accent'
            : 'text-foreground cursor-pointer hover:bg-accent'
        }`}
      >
        {inMonth ? format(day, 'd') : ''}
      </div>
    );
    day = addDays(day, 1);
  }

  return (
    <div className="rounded-xl bg-background border border-border p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-foreground">
          {format(currentMonth, 'MMMM yyyy')}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={prevMonth}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            onClick={nextMonth}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-y-1">
        {dayLabels}
        {cells}
      </div>
    </div>
  );
};
