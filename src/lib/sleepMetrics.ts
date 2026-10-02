/**
 * Bedtime index: block index of the first sleep block of a night, anchored to 18:00.
 * Evening bedtimes (>= 18:00, block >= 108) are negative (block - 144); after-midnight
 * bedtimes are 0..107. Because the night window is cut at 18:00 rather than midnight,
 * the scale never wraps, so a plain arithmetic mean is a correct average bedtime
 * (no circular averaging needed).
 */

/** Average bedtime index rounded to the nearest block, or null when there are no samples. */
export const averageBedtimeIndex = (indices: number[]): number | null => {
  if (indices.length === 0) return null;
  return Math.round(indices.reduce((a, b) => a + b, 0) / indices.length);
};

/** Format a bedtime index as a 12-hour clock time, e.g. -13 -> "11:50 PM", 5 -> "12:50 AM". */
export const formatBedtimeIndex = (idx: number | null): string => {
  if (idx === null || isNaN(idx)) return '';
  let totalMins = idx * 10;
  if (totalMins < 0) totalMins += 24 * 60;
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  const ampm = h >= 12 && h < 24 ? 'PM' : 'AM';
  const displayH = (h % 12) === 0 ? 12 : (h % 12);
  return `${displayH}:${m.toString().padStart(2, '0')} ${ampm}`;
};
