// Shared chart styling so every graph in the app reads as one smooth, calm system.
// Axis lines, tick marks and grid weight are themed globally in index.css (.recharts-*).

/** every line and area is a monotone curve: smooth, but never overshoots the data (no fake peaks or dips below 0) */
export const CURVE = 'monotone' as const;

/**
 * Spread onto every Line / Area / Bar / Pie. Recharts' own draw-in animation is OFF: in this app it could stall on
 * its first frame (the reveal clip stayed 0px wide), leaving charts blank. Charts fade in with CSS instead
 * (.recharts-wrapper in index.css), which cannot hide the data.
 */
export const ANIM = { isAnimationActive: false } as const;

/** tick style for axes */
export const TICK = { fontSize: 10 } as const;

/**
 * Centred moving average over `key`, for per-slot series (half hours, hours) that otherwise look like a comb.
 * Null points stay null (gaps are real: untracked or asleep), and nulls inside the window are skipped rather than
 * counted as zero. The raw value is kept on `${key}Raw` so tooltips can still show it.
 */
export const smoothSeries = <T extends Record<string, unknown>>(points: T[], key: keyof T & string, window = 3): (T & Record<string, number | null>)[] => {
  const half = Math.floor(window / 2);
  return points.map((p, i) => {
    const raw = p[key] as number | null | undefined;
    if (raw === null || raw === undefined) return { ...p, [key]: null, [`${key}Raw`]: null } as T & Record<string, number | null>;
    let sum = 0, n = 0;
    for (let j = i - half; j <= i + half; j++) {
      const v = points[j]?.[key] as number | null | undefined;
      if (typeof v === 'number') { sum += v; n++; }
    }
    return { ...p, [key]: Math.round((sum / n) * 100) / 100, [`${key}Raw`]: raw } as T & Record<string, number | null>;
  });
};

/**
 * Chart height that follows the screen's height: about 10% shorter on 768px-tall laptops and 4:3 screens, up to a
 * third taller on 1440px-tall and ultrawide monitors, so charts are neither cramped nor lost in space.
 */
export const chartH = (base: number): string =>
  `clamp(${Math.round(base * 0.85)}px, ${(base / 8.5).toFixed(2)}vh, ${Math.round(base * 1.35)}px)`;
