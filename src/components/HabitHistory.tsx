import React, { useMemo, useState } from 'react';
import { addMonths, format, getDay, subMonths } from 'date-fns';
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { computeHabitStats, describeFrequency, getHabitMonth, type DayStatus, type HabitLike, type HabitLogLike } from '../lib/habits';

interface HabitHistoryProps {
  habit: HabitLike & { name: string };
  logs: (HabitLogLike & { id: string })[];
  onClose: () => void;
  /** Toggle completion on a date (daily habits). */
  onToggleDate: (habitId: string, dateKey: string) => void;
  /** Log an event with an optional note on a date. */
  onLogEvent: (habitId: string, note: string, dateKey: string) => void;
  onDeleteLog: (logId: string) => void;
  onUpdateNote: (logId: string, note: string) => void;
}

const STYLE: Record<DayStatus, string> = {
  done: 'bg-primary text-primary-foreground',
  missed: 'bg-destructive/10 text-destructive',
  pending: 'border border-primary text-foreground',
  not_due: 'text-muted-foreground/60',
  future: 'text-muted-foreground/40',
  before_start: 'text-muted-foreground/30',
};
const SYMBOL: Record<DayStatus, string> = { done: '✓', missed: '·', pending: '○', not_due: '–', future: '', before_start: '' };

export const HabitHistory: React.FC<HabitHistoryProps> = ({ habit, logs, onClose, onToggleDate, onLogEvent, onDeleteLog, onUpdateNote }) => {
  const [month, setMonth] = useState(() => new Date());
  const [selected, setSelected] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [note, setNote] = useState('');
  const now = new Date();
  const todayKey = format(now, 'yyyy-MM-dd');
  const isEvent = habit.type === 'event';

  const stats = useMemo(() => computeHabitStats(habit, logs, now), [habit, logs]); // eslint-disable-line react-hooks/exhaustive-deps
  const days = useMemo(() => getHabitMonth(habit, logs, month.getFullYear(), month.getMonth(), now), [habit, logs, month]); // eslint-disable-line react-hooks/exhaustive-deps
  const lead = (getDay(new Date(month.getFullYear(), month.getMonth(), 1)) + 6) % 7; // Monday-first
  const selectedLogs = logs.filter((l) => l.date_key === selected);
  const unit = stats.unit === 'weeks' ? 'wk' : 'd';

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{habit.name} <span className="text-xs font-normal text-muted-foreground">· {describeFrequency(habit)}</span></DialogTitle>
        </DialogHeader>

        <dl className="grid grid-cols-4 gap-2 text-center">
          {(isEvent
            ? [['Entries', String(stats.totalLogs)], ['Days', String(stats.daysLogged)], ['Last', stats.lastLoggedKey ?? '—'], ['', '']]
            : [['Streak', `${stats.currentStreak}${unit}`], ['Best', `${stats.longestStreak}${unit}`], ['Rate', stats.completionRate === null ? '—' : `${stats.completionRate}%`], ['Logged', String(stats.daysLogged)]]
          ).map(([k, v], i) => (
            <div key={i} className="bg-muted rounded-lg py-2">
              <dt className="text-[11px] text-muted-foreground font-medium">{k}</dt>
              <dd className="text-sm font-bold ibm-mono">{v}</dd>
            </div>
          ))}
        </dl>

        <div className="flex items-center justify-between">
          <button onClick={() => setMonth((m) => subMonths(m, 1))} className="p-1.5 rounded hover:bg-accent" aria-label="Previous month"><ChevronLeft size={16} /></button>
          <span className="text-sm font-semibold">{format(month, 'MMMM yyyy')}</span>
          <button onClick={() => setMonth((m) => addMonths(m, 1))} className="p-1.5 rounded hover:bg-accent" aria-label="Next month"><ChevronRight size={16} /></button>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-muted-foreground">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <div key={i}>{d}</div>)}
          {Array.from({ length: lead }).map((_, i) => <div key={`e${i}`} />)}
          {days.map((d) => {
            const isSel = d.dateKey === selected;
            return (
              <button
                key={d.dateKey}
                onClick={() => setSelected(d.dateKey)}
                aria-label={`${d.dateKey}: ${d.status.replace('_', ' ')}`}
                aria-pressed={isSel}
                className={`h-9 rounded-md text-xs flex flex-col items-center justify-center ${STYLE[d.status]} ${isSel ? 'ring-2 ring-ring' : ''}`}
              >
                <span className="leading-none">{Number(d.dateKey.slice(8))}</span>
                <span className="leading-none text-[10px]">{SYMBOL[d.status]}</span>
              </button>
            );
          })}
        </div>

        {/* Selected date */}
        <div className="border-t border-border pt-3 space-y-2">
          <div className="text-xs font-semibold">{format(new Date(selected + 'T00:00:00'), 'EEEE, d MMM yyyy')}</div>

          {isEvent ? (
            <>
              {selectedLogs.length === 0 && <p className="text-xs text-muted-foreground">No entries.</p>}
              {selectedLogs.map((l) => (
                <div key={l.id} className="flex items-center gap-2">
                  <input
                    defaultValue={l.notes ?? ''}
                    placeholder="Add a note"
                    aria-label="Entry note"
                    onBlur={(e) => e.target.value !== (l.notes ?? '') && onUpdateNote(l.id, e.target.value)}
                    className="flex-1 text-sm px-2 py-1.5 rounded-md bg-background border border-border"
                  />
                  <button onClick={() => onDeleteLog(l.id)} className="p-1.5 text-muted-foreground hover:text-destructive" aria-label="Delete entry"><Trash2 size={14} /></button>
                </div>
              ))}
              {selected <= todayKey && (
                <form onSubmit={(e) => { e.preventDefault(); onLogEvent(habit.id, note, selected); setNote(''); }} className="flex gap-2">
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (e.g. Chest workout)" aria-label="New entry note" className="flex-1 text-sm px-2 py-1.5 rounded-md bg-background border border-border" />
                  <button type="submit" className="px-3 py-1.5 text-xs font-semibold rounded-md bg-primary text-primary-foreground">Log</button>
                </form>
              )}
            </>
          ) : selected > todayKey ? (
            <p className="text-xs text-muted-foreground">Future dates can't be logged yet.</p>
          ) : (
            <button
              onClick={() => onToggleDate(habit.id, selected)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md border ${selectedLogs.length > 0 ? 'border-border text-muted-foreground hover:bg-accent' : 'bg-primary text-primary-foreground border-primary'}`}
            >
              {selectedLogs.length > 0 ? 'Mark as not done' : 'Mark as done'}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
