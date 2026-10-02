import { describe, expect, it } from 'vitest';
import { formatMultiplier, getIgnoredActivityIds, isWasteActivity, parseMultiplier } from './activityFlags';

describe('parseMultiplier', () => {
  it('accepts negative decimals in the forms people type', () => {
    expect(parseMultiplier('-0.35')).toBe(-0.35);
    expect(parseMultiplier('-.5')).toBe(-0.5);
    expect(parseMultiplier(' +1 ')).toBe(1);
    expect(parseMultiplier('1,5')).toBe(1.5);
    expect(parseMultiplier('2.')).toBe(2);
  });

  it('treats empty as neutral, and rejects text that is not a number', () => {
    expect(parseMultiplier('')).toBe(0);
    expect(parseMultiplier('-')).toBeNull();
    expect(parseMultiplier('abc')).toBeNull();
    expect(parseMultiplier('1e3')).toBeNull();
    expect(parseMultiplier('--1')).toBeNull();
  });

  it('clamps to [-5, 5], rounds to 2 decimals and never returns -0', () => {
    expect(parseMultiplier('-9')).toBe(-5);
    expect(parseMultiplier('12')).toBe(5);
    expect(parseMultiplier('-0.333')).toBe(-0.33);
    expect(Object.is(parseMultiplier('-0.001'), 0)).toBe(true);
  });
});

describe('formatMultiplier', () => {
  it('shows one decimal when enough, two when needed, with a real minus sign', () => {
    expect(formatMultiplier(1)).toBe('+1.0×');
    expect(formatMultiplier(-0.35)).toBe('−0.35×');
    expect(formatMultiplier(0)).toBe('0.0×');
  });
});

describe('ignored and waste flags', () => {
  const acts = [
    { id: 's', name: 'Sleep', is_sleep_activity: true },
    { id: 't', name: 'Travel', analysis_ignored: true, productivity_multiplier: -1 },
    { id: 'y', name: 'YouTube', productivity_multiplier: -0.5 },
    { id: 'w', name: 'Work', productivity_multiplier: 1 },
  ];

  it('sleep is always ignored, plus anything marked ignored', () => {
    expect([...getIgnoredActivityIds(acts)].sort()).toEqual(['s', 't']);
  });

  it('waste needs a negative multiplier and not being ignored', () => {
    const ignored = getIgnoredActivityIds(acts);
    expect(acts.filter((a) => isWasteActivity(a, ignored)).map((a) => a.id)).toEqual(['y']);
  });
});
