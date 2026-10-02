import { describe, expect, it } from 'vitest';
import { averageBedtimeIndex, formatBedtimeIndex } from './sleepMetrics';

describe('sleepMetrics', () => {
  it('returns null with no samples', () => {
    expect(averageBedtimeIndex([])).toBeNull();
    expect(formatBedtimeIndex(null)).toBe('');
  });

  it('averages evening and after-midnight bedtimes across midnight', () => {
    // 11:30 PM = block 138 -> -6 ; 12:30 AM = block 3 -> 3 ; mean -1.5 -> rounds to -1 (11:50 PM)
    expect(averageBedtimeIndex([-6, 3])).toBe(-1);
    expect(formatBedtimeIndex(-1)).toBe('11:50 PM');
  });

  it('formats evening, midnight and small hours', () => {
    expect(formatBedtimeIndex(-36)).toBe('6:00 PM');
    expect(formatBedtimeIndex(0)).toBe('12:00 AM');
    expect(formatBedtimeIndex(6)).toBe('1:00 AM');
  });
});
