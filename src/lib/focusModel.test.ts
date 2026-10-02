import { describe, expect, it } from 'vitest';
import { addDays, format, getDay } from 'date-fns';
import { analyzeFocus, buildFocusDays, describePeakContext, focusEligibilitySource, focusWeightsFromDemand, formatWindow, scoreDay, sessionBlocksByDay, type DayBlockInfo, type FocusInput } from './focusModel';
import { profileDays } from './analysis';
import type { RangeBlock } from './blockRange';

const cats: Record<string, string> = { w: 'Work', ad: 'Admin', l: 'Leisure', g: 'Health', z: 'Health', x: 'Leisure' };
const opts = { categoryOf: (id: string) => cats[id] ?? null, isSleep: (id: string) => id === 'z' };
const blocks = (spec: Record<number, string>): DayBlockInfo[] => {
  const d: DayBlockInfo[] = Array.from({ length: 144 }, () => ({ activityId: null }));
  for (const [i, a] of Object.entries(spec)) d[Number(i)] = { activityId: a };
  return d;
};
const run = (from: number, to: number, a: string) => Object.fromEntries(Array.from({ length: to - from + 1 }, (_, i) => [from + i, a]));

describe('scoreDay', () => {
  it('ramps up over 20 minutes (flow onset ~15-20 min), plateaus, then decays gently on a long run', () => {
    const s = scoreDay(blocks(run(10, 21, 'w')), opts);
    expect(s.slice(10, 13)).toEqual([0.6, 0.85, 1]);
    expect(s.slice(12, 19).every((v) => v === 1)).toBe(true);
    expect(s[19]).toBeCloseTo(0.75 + 0.25 * 0.9);
    expect(s[21]).toBeCloseTo(0.75 + 0.25 * 0.9 ** 3);
    expect(s[21]!).toBeGreaterThan(0.75);
  });

  it('untracked, sleep and future blocks are unobserved (null); tracked non-work counts as 0', () => {
    const s = scoreDay(blocks({ 10: 'w', 11: 'z', 12: 'l', 20: 'w' }), { ...opts, elapsedBlocks: 15 });
    expect(s[5]).toBeNull();
    expect(s[11]).toBeNull();
    expect(s[12]).toBe(0);
    expect(s[20]).toBeNull();
    expect(s[10]).not.toBeNull();
  });

  it('a single interrupting block does not end the run, but resuming costs warm-up (attention residue)', () => {
    const s = scoreDay(blocks({ 10: 'w', 11: 'w', 12: 'w', 13: 'x', 14: 'w', 15: 'w' }), opts);
    // block 14 resumes at the 10-20 min depth (0.85) with two switches in the previous 30 min (x 0.84)
    expect(s[14]).toBeCloseTo(0.85 * 0.84);
    // and is back at full depth one block later, still paying for the two recent switches
    expect(s[15]).toBeCloseTo(0.84);
    // an uninterrupted run is deeper at the same point
    expect(scoreDay(blocks(run(10, 15, 'w')), opts)[14]!).toBeGreaterThan(s[14]!);
    // two interrupting blocks do reset it
    const r = scoreDay(blocks({ 10: 'w', 11: 'w', 12: 'w', 13: 'x', 14: 'x', 15: 'w', 16: 'w' }), opts);
    expect(r[15]!).toBeLessThan(0.7);
  });

  it('a switch costs more after it than before it', () => {
    const s = scoreDay(blocks({ ...run(10, 15, 'w'), ...run(16, 21, 'ad') }), opts);
    const before = s[15]!; // last Work block, a switch follows
    const after = scoreDay(blocks({ ...run(10, 15, 'ad'), ...run(16, 21, 'w') }), opts)[18]!; // 3rd Work block after a switch
    expect(before).toBeCloseTo(1 * (1 - 0.03));
    expect(after).toBeCloseTo(1 * (1 - 0.08));
    expect(after).toBeLessThan(before);
  });

  it('frequent switching lowers the score (capped)', () => {
    const steady = scoreDay(blocks(run(10, 20, 'w')), opts)[15]!;
    const alt: Record<number, string> = {};
    for (let i = 10; i <= 20; i++) alt[i] = i % 2 ? 'w' : 'ad';
    const choppy = scoreDay(blocks(alt), opts)[15]!;
    expect(choppy).toBeLessThan(steady * 0.5);
    expect(choppy).toBeGreaterThan(0);
  });

  it('Admin is a lighter kind of focus than Work', () => {
    const w = scoreDay(blocks(run(10, 14, 'w')), opts)[13]!;
    const a = scoreDay(blocks(run(10, 14, 'ad')), opts)[13]!;
    expect(a).toBeCloseTo(w * 0.8);
  });

  it('task links and timer sessions make non-work blocks eligible and raise scores', () => {
    const d = blocks(run(10, 14, 'l'));
    d[12] = { activityId: 'l', taskId: 't' };
    const s = scoreDay(d, opts);
    expect(s[11]).toBe(0);
    expect(s[12]!).toBeGreaterThan(0);
    const withSession = scoreDay(blocks(run(10, 14, 'w')), { ...opts, sessionBlocks: new Set([11]) });
    const without = scoreDay(blocks(run(10, 14, 'w')), opts);
    expect(withSession[11]!).toBeGreaterThan(without[11]!);
    // unassigned block inside a session still counts as focus
    expect(scoreDay(blocks({}), { ...opts, sessionBlocks: new Set([50]) })[50]!).toBeGreaterThan(0);
  });
});

describe('sessionBlocksByDay', () => {
  it('marks 10-minute blocks overlapping at least 5 minutes, per local day', () => {
    const start = new Date(2026, 8, 21, 9, 0).toISOString();
    const m = sessionBlocksByDay([{ started_at: start, duration_minutes: 25 }]);
    expect(Array.from(m.get('2026-09-21')!).sort((a, b) => a - b)).toEqual([54, 55, 56]); // 9:00-9:25 -> blocks 54,55,56 (56 has 5 min)
  });
});

// ─── synthetic data ──────────────────────────────────────────────────────────

const NOW = new Date(2026, 8, 22, 22, 0);
const dayKeyOf = (d: Date) => format(d, 'yyyy-MM-dd');

const makeInput = (
  nDays: number,
  plan: (weekday: number, ageDays: number) => Record<number, string>,
  offset = 1
): FocusInput => {
  const out: RangeBlock[] = [];
  for (let age = offset; age < nDays + offset; age++) {
    const d = addDays(NOW, -age);
    const spec = plan(getDay(d), age);
    for (const [i, a] of Object.entries(spec)) out.push({ date_key: dayKeyOf(d), block_index: Number(i), activity_id: a });
  }
  return { blocks: out, activities: Object.entries(cats).map(([id, category]) => ({ id, category })), sleepIds: new Set(['z']) };
};

const weekdaysMorning = (wd: number) => (wd >= 1 && wd <= 5 ? { ...run(42, 47, 'g'), ...run(54, 65, 'w'), ...run(66, 80, 'l') } : run(60, 100, 'l'));

describe('analyzeFocus', () => {
  it('finds a consistent 9-11 AM work window with high stability and confidence', () => {
    const a = analyzeFocus(makeInput(56, weekdaysMorning), { now: NOW });
    const w = a.overall.window!;
    expect(w).not.toBeNull();
    // the real work block is exactly 9:00-11:00; the window must not bleed into unobserved time before it
    expect(w.startMin).toBe(9 * 60);
    expect(w.endMin).toBeGreaterThanOrEqual(10 * 60 + 30);
    expect(w.endMin).toBeLessThanOrEqual(11 * 60);
    expect(w.stability!).toBeGreaterThanOrEqual(0.75);
    expect(w.confidence).toBe('high');
    expect(w.score).toBeGreaterThan(w.baseline);
    expect(w.ci80[0]).toBeLessThanOrEqual(w.score);
    expect(w.ci80[1]).toBeGreaterThanOrEqual(w.score);
    expect(w.deepDayPct).toBeGreaterThan(60);
    expect(formatWindow(w)).toMatch(/AM/);
  });

  it('is deterministic', () => {
    const input = makeInput(40, weekdaysMorning);
    expect(JSON.stringify(analyzeFocus(input, { now: NOW }))).toBe(JSON.stringify(analyzeFocus(input, { now: NOW })));
  });

  it('little data gives a low-confidence answer, and almost none gives no window', () => {
    const few = analyzeFocus(makeInput(4, () => ({ ...run(54, 65, 'w') })), { now: NOW });
    expect(few.overall.window?.confidence ?? 'low').toBe('low');
    const two = analyzeFocus(makeInput(2, () => ({ ...run(54, 65, 'w') })), { now: NOW });
    expect(two.overall.window).toBeNull();
  });

  it('does not invent a peak when nothing was focus work', () => {
    const a = analyzeFocus(makeInput(30, () => run(54, 100, 'l')), { now: NOW });
    expect(a.overall.window).toBeNull();
  });

  it('untracked time is not treated as distraction: gaps do not lower a window', () => {
    const dense = analyzeFocus(makeInput(30, () => run(54, 65, 'w')), { now: NOW });
    const sparse = analyzeFocus(makeInput(30, (_wd, age) => (age % 2 ? run(54, 65, 'w') : {})), { now: NOW });
    expect(sparse.overall.window!.score).toBeGreaterThanOrEqual(dense.overall.window!.score - 5);
  });

  it('recent weeks outweigh old ones: the peak follows a schedule change', () => {
    const input = makeInput(60, (_, age) => (age <= 30 ? run(90, 101, 'w') : run(54, 65, 'w'))); // recently afternoons, previously mornings
    const a = analyzeFocus(input, { now: NOW });
    expect(a.overall.window!.startMin).toBeGreaterThanOrEqual(14 * 60);
    const flat = analyzeFocus(input, { now: NOW, halfLifeDays: 100000 });
    expect(flat.overall.window).not.toBeNull(); // both peaks equally weighted: still finds one
  });

  it('reports a distinct weekend window when weekends differ from weekdays', () => {
    const input = makeInput(70, (wd) => (wd >= 1 && wd <= 5 ? run(54, 65, 'w') : run(90, 101, 'w')));
    const a = analyzeFocus(input, { now: NOW });
    const sat = a.variants.find((v) => v.label === 'Sat-Sun');
    expect(sat?.window?.startMin).toBeGreaterThanOrEqual(14 * 60);
    expect(a.variants.find((v) => v.label === 'Mon-Fri')).toBeUndefined(); // same as overall
  });

  it('finds a second wind after the main window', () => {
    const a = analyzeFocus(makeInput(50, () => ({ ...run(54, 65, 'w'), ...run(66, 89, 'l'), ...run(90, 101, 'w') })), { now: NOW });
    expect(a.overall.window).not.toBeNull();
    expect(a.secondary).not.toBeNull();
    const centers = [a.overall.window!, a.secondary!].map((w) => (w.startMin + w.endMin) / 2).sort((x, y) => x - y);
    expect(centers[0]).toBeLessThan(12 * 60);
    expect(centers[1]).toBeGreaterThan(14 * 60);
  });

  it('exposes a 48-slot curve and ignores sleep and future days', () => {
    const input = makeInput(20, weekdaysMorning);
    input.blocks.push({ date_key: '2026-09-25', block_index: 60, activity_id: 'w' }); // future day
    input.blocks.push({ date_key: '2026-09-20', block_index: 20, activity_id: 'z' }); // sleep
    const a = analyzeFocus(input, { now: NOW });
    expect(a.overall.curve).toHaveLength(48);
    expect(buildFocusDays(input, { now: NOW }).some((d) => d.dateKey === '2026-09-25')).toBe(false);
  });

  it('an ignored activity (e.g. travel) is unobserved, like sleep: it never lowers the curve', () => {
    const input = makeInput(20, weekdaysMorning);
    input.activities = [...input.activities, { id: 't', category: 'Leisure', analysis_ignored: true }];
    const before = buildFocusDays(input, { now: NOW });
    input.blocks.push(...Object.keys(run(90, 95, 't')).map((i) => ({ date_key: before[before.length - 1].dateKey, block_index: Number(i), activity_id: 't' })));
    const after = buildFocusDays(input, { now: NOW });
    const last = after[after.length - 1];
    expect(last.cnt[30] + last.cnt[31]).toBe(0); // 15:00-16:00 stays unobserved
  });

  it('a timer session on an untracked stretch pulls the window there', () => {
    const input = makeInput(30, () => run(54, 65, 'w'));
    const sessions = Array.from({ length: 30 }, (_, i) => ({ started_at: new Date(2026, 8, 21 - i, 20, 0).toISOString(), duration_minutes: 60 }));
    const withSessions = analyzeFocus({ ...input, sessions }, { now: NOW });
    const evening = withSessions.overall.curve.find((c) => c.startMin === 20 * 60)!;
    expect(evening.value).toBeGreaterThan(30);
  });
});

describe('describePeakContext', () => {
  it('explains the window from wake time, chronotype and the afternoon dip, without changing it', () => {
    const lines = describePeakContext({ startMin: 14 * 60, endMin: 16 * 60 }, { wakeClockMin: 7 * 60 + 30, midpointClockMin: 4 * 60, chronotypeLabel: 'Intermediate type' });
    expect(lines[0]).toBe('Starts about 6h 30m after you usually wake (7:30 AM).');
    expect(lines[1]).toContain('intermediate type');
    expect(lines[2]).toContain('1–4 PM');
    expect(describePeakContext({ startMin: 540, endMin: 660 }, { wakeClockMin: null, midpointClockMin: null, chronotypeLabel: null })).toEqual([]);
  });
});

describe('scoreDay: ping-pong', () => {
  it('alternating two work activities never reaches deep focus (0.6)', () => {
    const spec: Record<number, string> = {};
    for (let i = 0; i < 12; i++) spec[54 + i] = i % 2 ? 'ad' : 'w';
    const s = scoreDay(blocks(spec), opts);
    const vals = s.slice(54, 66) as number[];
    expect(Math.max(...vals)).toBeLessThan(0.6);
  });
  it('a real run with one blip still reaches full depth', () => {
    const spec: Record<number, string> = {};
    for (let i = 0; i < 12; i++) spec[54 + i] = i === 4 ? 'l' : 'w';
    const s = scoreDay(blocks(spec), opts);
    expect(s[65]).toBeGreaterThanOrEqual(0.9);
  });
});

describe('focus work from focus demand', () => {
  const acts = [
    { id: 'code', category: 'Admin', focus_demand: 5, productivity_multiplier: 0.8 },
    { id: 'class', category: 'Work', focus_demand: 3, productivity_multiplier: 0.6 },
    { id: 'choir', category: 'Work', focus_demand: 0, productivity_multiplier: 0.55 },
    { id: 'social', category: 'Leisure', focus_demand: 4, productivity_multiplier: 0 },
  ];

  it('weights activities by demand / 5, only with a positive multiplier', () => {
    const w = focusWeightsFromDemand(acts)!;
    expect(w('code')).toBe(1);
    expect(w('class')).toBeCloseTo(0.6);
    expect(w('choir')).toBe(0); // category Work, but demand 0
    expect(w('social')).toBe(0); // demanding, but not rated worthwhile
    expect(focusEligibilitySource(acts)).toBe('demand');
  });

  it('falls back to categories until any demand is set', () => {
    const none = acts.map((a) => ({ ...a, focus_demand: 0 }));
    expect(focusWeightsFromDemand(none)).toBeNull();
    expect(focusEligibilitySource(none)).toBe('category');
  });

  it('drives the day profile: an hour of Admin coding counts, an hour of Work choir does not', () => {
    const run6 = (id: string, from: number): RangeBlock[] => Array.from({ length: 6 }, (_, i) => ({ date_key: '2026-09-21', block_index: from + i, activity_id: id }));
    const input = { blocks: [...run6('code', 54), ...run6('choir', 72)], activities: acts, sleepIds: new Set<string>() };
    const now = { now: new Date(2026, 8, 22) };
    expect(profileDays(input, ['2026-09-21'], now)[0].eligibleBlocks).toBe(6); // coding only
    const byCategory = profileDays({ ...input, activities: acts.map((a) => ({ ...a, focus_demand: 0 })) }, ['2026-09-21'], now)[0];
    expect(byCategory.eligibleBlocks).toBe(12); // Admin coding + Work choir
  });
});
