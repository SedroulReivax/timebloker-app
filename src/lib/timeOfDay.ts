/**
 * Time-of-day helpers shared by the descriptive (no-prediction) graphs: activity focus and waste.
 * Everything here is plain counting over 30-minute slots: no smoothing, no shrinkage, no recency weighting.
 */

export const SLOT_MINUTES = 30;
export const SLOT_COUNT = 48;
const BLOCKS_PER_SLOT = 3;

/**
 * Minutes per label per 30-minute slot. Each day is 144 ten-minute blocks holding a label (the thing being counted,
 * e.g. an activity id) or null (not counted).
 */
export const slotMinutes = (days: (string | null)[][]): Map<string, number[]> => {
  const out = new Map<string, number[]>();
  for (const day of days) {
    for (let i = 0; i < day.length; i++) {
      const label = day[i];
      if (!label) continue;
      const arr = out.get(label) ?? out.set(label, new Array(SLOT_COUNT).fill(0)).get(label)!;
      arr[Math.floor(i / BLOCKS_PER_SLOT)] += 10;
    }
  }
  return out;
};

export interface SlotWindow {
  startMin: number;
  endMin: number;
  /** share of all the minutes that fall inside the window, 0-100 */
  sharePct: number;
}

/**
 * The shortest run of consecutive slots that holds at least `fraction` of all the minutes ("half of your X happened
 * between 9:30 and 12:00"). Ties go to the window holding more. Null when there are no minutes.
 */
export const coreWindow = (slots: number[], fraction = 0.5): SlotWindow | null => {
  const total = slots.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const need = total * fraction - 1e-9;
  let best: { a: number; b: number; sum: number } | null = null;
  for (let a = 0; a < slots.length; a++) {
    let sum = 0;
    for (let b = a; b < slots.length; b++) {
      sum += slots[b];
      if (sum >= need) {
        const len = b - a;
        if (!best || len < best.b - best.a || (len === best.b - best.a && sum > best.sum)) best = { a, b, sum };
        break;
      }
    }
  }
  if (!best) return null;
  return { startMin: best.a * SLOT_MINUTES, endMin: (best.b + 1) * SLOT_MINUTES, sharePct: Math.round((best.sum / total) * 100) };
};

/** "12a", "3a", "12p" style labels for a slot index, for compact axes. */
export const slotAxisLabel = (slot: number): string => {
  const h = Math.floor((slot * SLOT_MINUTES) / 60);
  return `${h % 12 === 0 ? 12 : h % 12}${h >= 12 ? 'p' : 'a'}`;
};

/** Short minutes for chart axes, where "1h 30m" gets clipped: 45m, 1.5h, 12h. */
export const axisMinutes = (v: number): string => {
  const m = Math.round(v);
  if (m < 60) return `${m}m`;
  const h = Math.round((m / 60) * 10) / 10;
  return `${h}h`;
};
