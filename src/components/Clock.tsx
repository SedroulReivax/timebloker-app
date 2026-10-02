import React, { useEffect, useMemo, useRef } from 'react';
import { format } from 'date-fns';
import type { Activity } from '../types';
import { useNow } from '../hooks/useNow';

/** Top-bar clock: seconds when there is room, minutes only on narrow phones. Opens the full-screen clock. */
export const TopBarClock: React.FC<{ onOpen: () => void }> = ({ onOpen }) => {
  const now = useNow();
  return (
    <button
      onClick={onOpen}
      title="Full-screen clock"
      aria-label={`Time ${format(now, 'h:mm a')}. Open full-screen clock`}
      className="ibm-mono tabular-nums text-xs text-foreground px-2 py-1 min-h-[32px] rounded-md border border-border hover:bg-accent transition-colors whitespace-nowrap"
    >
      <span className="sm:hidden">{format(now, 'h:mm')}</span>
      <span className="hidden sm:inline">{format(now, 'h:mm:ss')}<span className="text-muted-foreground"> {format(now, 'a')}</span></span>
    </button>
  );
};

interface ClockOverlayProps {
  onClose: () => void;
  activities: Activity[];
  /** today's blocks, or null when the tracker is showing another day (status lines are then skipped) */
  blocks: { date_key: string; block_index: number; activity_id: string | null }[] | null;
}

const BAR = 24;

/**
 * Full-screen, terminal-style clock in the current theme's colours: the time with seconds, the date, what you are
 * tracking right now and how much of the day has passed. Esc, a tap or the close hint dismisses it. Asks the browser
 * for full screen and to keep the screen awake where supported (both silently skipped where not).
 */
export const ClockOverlay: React.FC<ClockOverlayProps> = ({ onClose, activities, blocks }) => {
  const now = useNow();
  const entered = useRef(false);
  // The parent re-renders often; keep the latest onClose without re-running the full-screen effect.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const onClose = () => closeRef.current();
    const el = document.documentElement;
    let lock: { release: () => Promise<void> } | null = null;
    el.requestFullscreen?.().then(() => { entered.current = true; }).catch(() => undefined);
    (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock
      ?.request('screen').then((l) => { lock = l; }).catch(() => undefined);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    // Esc in browser full screen only leaves full screen; treat that as closing the clock too
    const onFs = () => { if (entered.current && !document.fullscreenElement) onClose(); };
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFs);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => undefined);
      lock?.release().catch(() => undefined);
    };
  }, []);

  const todayKey = format(now, 'yyyy-MM-dd');
  const minuteOfDay = now.getHours() * 60 + now.getMinutes();
  const current = useMemo(() => {
    if (!blocks) return null;
    const byIdx = new Map(blocks.filter((b) => b.date_key === todayKey && b.activity_id).map((b) => [b.block_index, b.activity_id as string]));
    const idx = Math.floor(minuteOfDay / 10);
    const id = byIdx.get(idx) ?? byIdx.get(idx - 1);
    if (!id) return null;
    let start = byIdx.get(idx) ? idx : idx - 1;
    while (byIdx.get(start - 1) === id) start--;
    const act = activities.find((a) => a.id === id);
    return { name: act?.name ?? 'Unknown', emoji: act?.emoji, color: act?.color, since: start * 10 };
  }, [blocks, activities, todayKey, minuteOfDay]);
  const tracked = useMemo(() => (blocks ?? []).filter((b) => b.date_key === todayKey && b.activity_id && b.block_index * 10 < minuteOfDay).length * 10, [blocks, todayKey, minuteOfDay]);

  const dayPct = Math.floor((minuteOfDay / 1440) * 100);
  const filled = Math.round((minuteOfDay / 1440) * BAR);
  const since = current ? minuteOfDay - current.since : 0;
  const hm = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Full-screen clock"
      onClick={onClose}
      className="fixed inset-0 z-[100] bg-background text-foreground ibm-mono flex flex-col justify-center px-5 sm:px-12 cursor-pointer select-none"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="max-w-5xl w-full mx-auto space-y-3 sm:space-y-4 text-[13px] sm:text-base">
        <div className="text-muted-foreground"><span className="text-foreground">blockday@clock</span>:~$ date</div>
        <div className="text-muted-foreground">{format(now, 'EEEE, d MMMM yyyy')}</div>
        <div className="font-bold tabular-nums leading-none tracking-tight" style={{ fontSize: 'clamp(3.25rem, min(17vw, 30dvh), 13rem)' }} aria-live="off">
          {format(now, 'HH:mm')}<span className="text-muted-foreground">:{format(now, 'ss')}</span>
        </div>
        <div className="text-muted-foreground">{format(now, 'h:mm a')} · week {format(now, 'I')} · day {format(now, 'D', { useAdditionalDayOfYearTokens: true })}</div>
        <div className="pt-2 sm:pt-4 space-y-1.5">
          <div className="text-muted-foreground"><span className="text-foreground">blockday@clock</span>:~$ status</div>
          {blocks && <div>
            <span className="text-muted-foreground">now&nbsp;&nbsp;&nbsp;</span>
            {current ? (
              <>
                <span className="inline-block w-2.5 h-2.5 rounded-sm align-middle mr-1.5" style={{ backgroundColor: current.color ?? 'currentColor' }} />
                {current.emoji ? `${current.emoji} ` : ''}{current.name}<span className="text-muted-foreground"> · since {format(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, current.since), 'HH:mm')} ({hm(since)})</span>
              </>
            ) : <span className="text-muted-foreground">nothing tracked right now</span>}
          </div>}
          <div className="whitespace-pre">
            <span className="text-muted-foreground">day&nbsp;&nbsp;&nbsp;</span>[{'█'.repeat(filled)}<span className="text-muted-foreground">{'░'.repeat(BAR - filled)}</span>] {dayPct}%
          </div>
          {blocks ? (
            <div><span className="text-muted-foreground">today </span>{hm(tracked)} tracked<span className="text-muted-foreground"> · {hm(Math.max(0, minuteOfDay - tracked))} untracked</span></div>
          ) : (
            <div className="text-muted-foreground">today (select today in the tracker to see what you are on)</div>
          )}
          <div className="text-muted-foreground"><span className="text-foreground">blockday@clock</span>:~$ <span className="inline-block w-[0.6em] h-[1.1em] align-middle bg-foreground animate-pulse" /></div>
        </div>
        <div className="pt-4 text-[11px] text-muted-foreground">tap anywhere or press Esc to close</div>
      </div>
    </div>
  );
};
