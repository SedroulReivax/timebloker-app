import { describe, expect, it } from 'vitest';
import { getDeadlineDateKey, getDeadlineHour, isDateOnlyDeadline, isTimedDeadline, toISODeadline } from './deadlines';

describe('deadlines', () => {
  it('treats YYYY-MM-DD and UTC-midnight as date-only', () => {
    expect(isDateOnlyDeadline('2026-07-26')).toBe(true);
    expect(isDateOnlyDeadline('2026-07-26T00:00:00.000Z')).toBe(true);
    expect(isDateOnlyDeadline('2026-07-26T14:00:00.000Z')).toBe(false);
    expect(isDateOnlyDeadline(null)).toBe(false);
  });

  it('date-only and timed deadlines on the same local day share a date key', () => {
    const timed = toISODeadline('2026-07-26T14:00')!;
    const dateOnly = toISODeadline('2026-07-26')!;
    expect(getDeadlineDateKey(dateOnly)).toBe('2026-07-26');
    expect(getDeadlineDateKey(timed)).toBe('2026-07-26');
  });

  it('a late-night local time stays on its local day (not shifted by UTC)', () => {
    expect(getDeadlineDateKey(toISODeadline('2026-07-26T23:30')!)).toBe('2026-07-26');
    expect(getDeadlineDateKey(toISODeadline('2026-07-26T01:00')!)).toBe('2026-07-26');
  });

  it('exposes local hour only for timed deadlines', () => {
    expect(getDeadlineHour(toISODeadline('2026-07-26T14:30')!)).toBe(14.5);
    expect(getDeadlineHour(toISODeadline('2026-07-26')!)).toBeNull();
    expect(isTimedDeadline(toISODeadline('2026-07-26T14:30'))).toBe(true);
  });
});
