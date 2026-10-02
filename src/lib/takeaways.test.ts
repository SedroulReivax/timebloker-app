import { describe, expect, it } from 'vitest';
import type { ChangeResult } from './stats';
import { changePhrase, dayTakeaways, realChange, reviewTakeaways, trendsTakeaways, wasteTakeaways } from './takeaways';
import { formatMinutes } from './taskTime';

const change = (over: Partial<ChangeResult>): ChangeResult => ({
  current: 100, previous: 60, delta: 40, lo: 10, hi: 70, direction: 'up', enough: true, nCurrent: 7, nPrevious: 7, ...over,
});

describe('honesty rule', () => {
  it('says up/down only for a real change, "same" for a flat one, nothing when too thin', () => {
    expect(realChange(change({}))).toBe('up');
    expect(realChange(change({ direction: 'flat' }))).toBe('same');
    expect(realChange(change({ enough: false }))).toBeNull();
    expect(realChange(null)).toBeNull();
    expect(changePhrase(change({}), formatMinutes)).toBe(', up 40m a day on the previous period');
    expect(changePhrase(change({ direction: 'flat' }), formatMinutes)).toBe(', about the same as the previous period');
    expect(changePhrase(change({ enough: false }), formatMinutes)).toBe('');
  });

  it('never calls a productivity change unless it is real', () => {
    const base = {
      topCategory: { name: 'Work', minutes: 600 }, untrackedPct: 20, trackedPerDay: 480, deepPerDay: 90, productivityScore: 0.4,
      changes: { tracked: null, deep: null, productivity: change({ direction: 'flat' }) },
      attention: { configured: false, total: 0, value: 0, efficiency: null }, tasksDone: 3, tasksOpen: 2,
    };
    expect(trendsTakeaways(base).some((t) => t.text.startsWith('Productivity is'))).toBe(false);
    const real = trendsTakeaways({ ...base, changes: { ...base.changes, productivity: change({ direction: 'down', delta: -0.2 }) } });
    expect(real.find((t) => t.text.startsWith('Productivity is'))?.text).toContain('down');
  });
});

describe('takeaways', () => {
  it('caps at four sentences', () => {
    const t = trendsTakeaways({
      topCategory: { name: 'Work', minutes: 600 }, untrackedPct: 20, trackedPerDay: 480, deepPerDay: 90, productivityScore: 0.4,
      changes: { tracked: change({}), deep: change({}), productivity: change({}) },
      attention: { configured: true, total: 400, value: 120, efficiency: 0.3 }, tasksDone: 3, tasksOpen: 2,
    });
    expect(t).toHaveLength(4);
    expect(t.every((x) => !x.text.includes('NaN'))).toBe(true);
  });

  it('says what is missing instead of inventing numbers', () => {
    expect(dayTakeaways({
      isToday: true, trackedMinutes: 0, coveragePct: 0, topCategory: null, deepMinutes: 0, focusQualityPct: null, productivityScore: null,
      hasMultipliers: false, wasteMinutes: 0, topWaste: null, completedCount: 0, openDueCount: 0,
    })).toEqual([{ text: 'Nothing logged yet today.', to: 'day-timeline' }]);
    expect(wasteTakeaways({ perDay: null, change: null, top: null, totalMinutes: 0, trigger: null, peakStart: null, medianReturnMinutes: null, noReturnPct: null })[0].text)
      .toBe('No waste logged in this range.');
    const review = reviewTakeaways({
      period: 'week', trackedMinutes: 600, deepMinutes: 120, days: 2, busiest: null, energyMean: null, energyMax: 7,
      changes: [{ label: 'Tracked time', change: change({ enough: false }), fmt: formatMinutes }],
    });
    expect(review[1].text).toBe('Too few finished days to compare with last week yet.');
  });

  it('leaves productivity out of the day story until multipliers exist', () => {
    const day = dayTakeaways({
      isToday: false, trackedMinutes: 540, coveragePct: 38, topCategory: { name: 'Work', minutes: 245 }, deepMinutes: 70, focusQualityPct: 64,
      productivityScore: 0, hasMultipliers: false, wasteMinutes: 0, topWaste: null, completedCount: 2, openDueCount: 1,
    });
    expect(day[0].text).toBe('You logged 9h (38% of the day); most of it went to Work (4h 5m).');
    expect(day.some((t) => t.text.startsWith('Productivity'))).toBe(false);
    expect(day[day.length - 1].text).toBe('2 tasks done; 1 due that day still open.');
  });
});
