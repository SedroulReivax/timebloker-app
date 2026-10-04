import React from 'react';
import { useFocusClock, useFocusSession } from '../hooks/useFocusSession';

export const formatClock = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
  const sec = (s % 60).toString().padStart(2, '0');
  return h > 0 ? `${h}:${m}:${sec}` : `${m}:${sec}`;
};

/** Top-bar pill while a session runs and you're on another page: shows the clock, opens Focus. */
export const FocusPill: React.FC<{ onOpen: () => void }> = ({ onOpen }) => {
  const focus = useFocusSession();
  const seconds = useFocusClock(1000);
  const running = focus.isActive || focus.segments.length > 0;
  if (!running) return null;
  return (
    <button
      onClick={onOpen}
      title={focus.isActive ? 'Focus session running: open Focus' : 'Focus session paused: open Focus'}
      aria-label={`Focus session ${focus.isActive ? 'running' : 'paused'}, ${formatClock(seconds)}. Open Focus`}
      className="inline-flex items-center gap-1.5 px-2 py-1 min-h-[30px] rounded-full border border-border text-xs ibm-mono flex-shrink-0 hover:bg-accent"
    >
      <span className={`w-2 h-2 rounded-full ${focus.isActive ? 'bg-primary animate-pulse' : 'bg-muted-foreground'}`} />
      {formatClock(seconds)}
    </button>
  );
};
