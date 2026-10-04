import { describe, expect, it } from 'vitest';
import { buildNextOccurrence, nextOccurrence } from './recurrence';
import { getDeadlineDateKey } from './deadlines';

const key = (iso: string) => getDeadlineDateKey(iso);

describe('nextOccurrence (date-only deadlines)', () => {
  it('daily/weekly/yearly', () => {
    expect(nextOccurrence('2026-07-26T00:00:00.000Z', 'daily')).toBe('2026-07-27T00:00:00.000Z');
    expect(nextOccurrence('2026-07-26T00:00:00.000Z', 'weekly')).toBe('2026-08-02T00:00:00.000Z');
    expect(nextOccurrence('2026-07-26T00:00:00.000Z', 'yearly')).toBe('2027-07-26T00:00:00.000Z');
  });

  it('monthly clamps at end of month instead of overflowing', () => {
    expect(nextOccurrence('2026-01-31T00:00:00.000Z', 'monthly')).toBe('2026-02-28T00:00:00.000Z');
  });

  it('crosses month and year boundaries', () => {
    expect(nextOccurrence('2026-12-31T00:00:00.000Z', 'daily')).toBe('2027-01-01T00:00:00.000Z');
    expect(nextOccurrence('2026-12-15T00:00:00.000Z', 'monthly')).toBe('2027-01-15T00:00:00.000Z');
  });

  it('yearly from Feb 29 clamps to Feb 28', () => {
    expect(nextOccurrence('2028-02-29T00:00:00.000Z', 'yearly')).toBe('2029-02-28T00:00:00.000Z');
  });

  it('custom honors "every N units" and falls back to +1 month', () => {
    expect(nextOccurrence('2026-07-26T00:00:00.000Z', 'custom', 'every 2 weeks')).toBe('2026-08-09T00:00:00.000Z');
    expect(nextOccurrence('2026-07-26T00:00:00.000Z', 'custom', '10 days')).toBe('2026-08-05T00:00:00.000Z');
    expect(nextOccurrence('2026-07-26T00:00:00.000Z', 'custom', 'whenever')).toBe('2026-08-26T00:00:00.000Z');
  });
});

describe('nextOccurrence (timed deadlines)', () => {
  it('keeps the local time of day and moves the local date', () => {
    const start = new Date(2026, 6, 26, 23, 30).toISOString(); // local 23:30
    const next = new Date(nextOccurrence(start, 'daily'));
    expect(next.getHours()).toBe(23);
    expect(next.getMinutes()).toBe(30);
    expect(key(next.toISOString())).toBe('2026-07-27');
  });

  it('local midnight moves to next local day', () => {
    const start = new Date(2026, 11, 31, 0, 0).toISOString();
    expect(key(nextOccurrence(start, 'daily'))).toBe('2027-01-01');
  });
});

describe('nextOccurrence (no deadline)', () => {
  it('starts from today as a date-only deadline', () => {
    const now = new Date(2026, 6, 26, 15, 0);
    expect(nextOccurrence(null, 'daily', null, now)).toBe('2026-07-27T00:00:00.000Z');
  });
});

describe('buildNextOccurrence', () => {
  const base = {
    title: 'Water plants',
    activity_id: 'a1',
    deadline: '2026-07-26T00:00:00.000Z',
    recurrence_type: 'daily' as const,
    date_key: '2026-07-26',
    estimated_minutes: 20,
    estimated_pomodoros: 2,
  };

  it('returns null for tasks that do not repeat', () => {
    expect(buildNextOccurrence({ ...base, recurrence_type: 'none' })).toBeNull();
    expect(buildNextOccurrence({ ...base, recurrence_type: undefined })).toBeNull();
  });

  it('carries the estimate, resets pomodoro progress and files under the new deadline day', () => {
    const next = buildNextOccurrence(base)!;
    expect(next.deadline).toBe('2026-07-27T00:00:00.000Z');
    expect(next.date_key).toBe('2026-07-27');
    expect(next.estimated_minutes).toBe(20);
    expect(next.estimated_pomodoros).toBe(2);
    expect(next.completed_pomodoros).toBe(0);
    expect(next.completed).toBe(false);
  });
});
