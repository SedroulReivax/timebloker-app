import { useEffect, useState } from 'react';

/**
 * Current time, updated on every interval boundary of the wall clock (every whole second by default, or on the
 * minute with 60_000), so every clock in the app flips at the same moment as the top-bar clock. Browsers pause
 * timers in background tabs and during sleep, so it also re-reads the clock whenever the page becomes visible.
 * Only the caller re-renders.
 */
export const useNow = (intervalMs = 1000): Date => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let id: ReturnType<typeof setTimeout>;
    const tick = () => {
      clearTimeout(id);
      setNow(new Date());
      id = setTimeout(tick, intervalMs - (Date.now() % intervalMs) + 5);
    };
    id = setTimeout(tick, intervalMs - (Date.now() % intervalMs) + 5);
    const onWake = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    return () => {
      clearTimeout(id);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
    };
  }, [intervalMs]);
  return now;
};
