import { differenceInCalendarDays, getDay, parseISO } from 'date-fns';
import type { RangeBlock } from './blockRange';

/**
 * Peak-focus model.
 *
 * Goal: find when you reliably do sustained, deep work, and say how sure we are.
 *
 * 1. Per-block depth score (0-1) for "focus-eligible" blocks: activities weighted by your focus demand (or, until any
 *    demand is set, the Work/Admin categories; see focusWeightsFromDemand), task-linked blocks, and blocks inside a
 *    recorded focus-timer session. Depth follows an unbroken run of the same activity: a warm-up over the
 *    first 20 min (flow onset is usually put at 15-20 min), a plateau, then a mild time-on-task decrement after 90 min
 *    (a convention: the size of the vigilance decrement depends on the task and sleep pressure, and a fixed 90-minute
 *    cycle is not well supported). A one-block interruption does not end the run, but it has a resume cost: depth falls
 *    back to the warm-up level and climbs again (attention residue, Leroy 2009; ~23 min to resume, Mark).
 *    Switching costs mostly AFTER a switch: switches in the previous 30 min weigh 0.08 each, a switch in the next 10
 *    min only 0.03 (anticipation). Timer sessions and task links raise the score.
 *    See docs/analysis-research.md, "Checked against research".
 * 2. Only observed time counts: blocks that are untracked, asleep or in the future are excluded (not tracked != distracted).
 *    Tracked-but-not-eligible time (leisure, exercise...) counts as 0, so a slot's value is deep-focus density.
 *    The curve is computed over working days (at least an hour of focus-eligible time) so days off do not flatten the peak.
 * 3. Days are weighted by recency (exponential half-life). Slots are 30 minutes, smoothed with neighbours and shrunk
 *    toward your baseline so thin data cannot fake a peak (empirical-Bayes style). A slot can only belong to the peak
 *    window if it has its own observations (smoothing never extends the window into unobserved time).
 * 4. The peak region is the contiguous run of slots above the half-way point between baseline and peak (full width at
 *    half maximum), 1-5 hours long.
 * 5. Reliability: the window mean, an 80% interval over days, the share of days that reach deep focus, and a bootstrap
 *    over days that reports how often the same window is found again (stability).
 */

export const SLOT_MIN = 30;
const BLOCKS_PER_SLOT = 3;
export const SLOTS = 48;

export interface FocusActivity {
  id: string;
  category?: string | null;
  analysis_ignored?: boolean | null;
  focus_demand?: number | null;
  productivity_multiplier?: number | null;
}
export interface FocusSession { started_at: string; duration_minutes: number }

export interface FocusOptions {
  /** Days for a day's weight to halve. Default 45. */
  halfLifeDays?: number;
  /** Prior strength in block-weights (shrinkage). Default 6 (about an hour). */
  priorStrength?: number;
  /** Bootstrap resamples for the overall analysis. Default 200. */
  bootstrap?: number;
  /** Category -> eligibility weight. Default Work 1, Admin 0.8. */
  eligible?: Record<string, number>;
  /** Fraction of the way from baseline to peak that defines the window edge. Default 0.5 (half maximum). */
  edgeFraction?: number;
  now?: Date;
}

const DEFAULTS = { halfLifeDays: 45, priorStrength: 6, bootstrap: 200, edgeFraction: 0.5 };
export const DEFAULT_ELIGIBLE: Record<string, number> = { Work: 1, Admin: 0.8 };

const DEMAND_MAX = 5; // activities.focus_demand range is 0-5 (activityFlags.FOCUS_DEMAND_MAX)

/**
 * What counts as focus work, from your own settings. Once any activity has a focus demand above 0, an activity's
 * focus weight is demand / 5, but only if its productivity multiplier is positive: a demanding activity you don't
 * rate as worthwhile (a draining chat) takes attention without being deep work. Everything else weighs 0.
 * Returns null while no demand is set anywhere, and callers fall back to the category defaults (Work 1, Admin 0.8),
 * so nothing changes until you opt in.
 */
export const focusWeightsFromDemand = (activities: FocusActivity[]): ((activityId: string) => number) | null => {
  if (!activities.some((a) => Number(a.focus_demand ?? 0) > 0)) return null;
  const w = new Map(activities.map((a) => {
    const demand = Number(a.focus_demand ?? 0);
    const mult = Number(a.productivity_multiplier ?? 0);
    return [a.id, demand > 0 && mult > 0 ? Math.min(1, demand / DEMAND_MAX) : 0] as const;
  }));
  return (id) => w.get(id) ?? 0;
};

/** Which rule decides focus work right now, for labelling screens. */
export const focusEligibilitySource = (activities: FocusActivity[]): 'demand' | 'category' =>
  activities.some((a) => Number(a.focus_demand ?? 0) > 0) ? 'demand' : 'category';

export interface FocusInput {
  blocks: RangeBlock[];
  activities: FocusActivity[];
  sleepIds: Set<string>;
  sessions?: FocusSession[];
}

// ─── Per-block scoring ───────────────────────────────────────────────────────

export interface DayBlockInfo {
  activityId: string | null;
  taskId?: string | null;
}

const depthAt = (pos: number): number => {
  if (pos <= 1) return 0.6;
  if (pos === 2) return 0.85;
  if (pos <= 9) return 1;
  return 0.75 + 0.25 * Math.pow(0.9, pos - 9);
};

/**
 * Score one day. Returns 144 entries: a number in [0,1] for observed blocks, null for unobserved
 * (untracked, sleep, or not yet elapsed).
 */
export const scoreDay = (
  day: DayBlockInfo[],
  opts: {
    categoryOf: (activityId: string) => string | null;
    isSleep: (activityId: string) => boolean;
    sessionBlocks?: Set<number>;
    elapsedBlocks?: number;
    eligible?: Record<string, number>;
    /** per-activity focus weight (0-1); when given it replaces the category lookup (see focusWeightsFromDemand) */
    weightOf?: (activityId: string) => number;
  }
): (number | null)[] => {
  const eligible = opts.eligible ?? DEFAULT_ELIGIBLE;
  const elapsed = opts.elapsedBlocks ?? 144;
  const act: (string | null)[] = Array.from({ length: 144 }, (_, i) => {
    // A block inside a recorded timer session counts as observed focus even if no activity was assigned to it
    const a = day[i]?.activityId ?? (opts.sessionBlocks?.has(i) ? '__session__' : null);
    return i < elapsed && a && !opts.isSleep(a) ? a : null;
  });
  const out: (number | null)[] = new Array(144).fill(null);

  // Run position with one-block interruption tolerance: a single different block between two blocks of the
  // same activity does not end the run, but resuming costs warm-up (the next block scores as 10-20 min in).
  // A blip is only tolerated after 2+ clean blocks of the run since the last one, so ping-ponging between two
  // activities (A B A B ...) is not read as a sustained run of either.
  const pos: number[] = new Array(144).fill(0);
  let runAct: string | null = null;
  let runPos = 0;
  let clean = 0; // blocks of runAct since the start of the run or the last tolerated blip
  for (let i = 0; i < 144; i++) {
    const a = act[i];
    if (a === null) { runAct = null; runPos = 0; clean = 0; continue; }
    if (a === runAct) { runPos++; clean++; pos[i] = runPos; continue; }
    if (runAct !== null && clean >= 2 && i + 1 < 144 && act[i + 1] === runAct) { pos[i] = 1; runPos = Math.min(runPos, 1); clean = 0; continue; }
    runAct = a; runPos = 1; clean = 1; pos[i] = 1;
  }

  for (let i = 0; i < 144; i++) {
    const a = act[i];
    if (a === null) continue;
    const inSession = opts.sessionBlocks?.has(i) ?? false;
    const task = !!day[i]?.taskId;
    const cat = opts.categoryOf(a);
    let w = opts.weightOf ? opts.weightOf(a) : cat ? eligible[cat] ?? 0 : 0;
    if (task || inSession) w = Math.max(w, 1);
    if (w === 0) { out[i] = 0; continue; }

    // Residue from switches in the previous 30 min (transitions landing in i-2..i), plus a small cost if a switch
    // follows right after this block.
    let penalty = 0;
    for (let k = Math.max(0, i - 3); k < i; k++) {
      if (act[k] !== null && act[k + 1] !== null && act[k] !== act[k + 1]) penalty += 0.08;
    }
    if (i + 1 < 144 && act[i + 1] !== null && act[i + 1] !== a) penalty += 0.03;
    let s = w * depthAt(pos[i]) * (1 - Math.min(0.4, penalty));
    if (task) s = Math.min(1, s * 1.05);
    if (inSession) s = Math.min(1, s * 1.15 + 0.1);
    out[i] = Math.max(0, Math.min(1, s));
  }
  return out;
};

// ─── Sessions -> per-day block sets ──────────────────────────────────────────

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Walking every block of every session ever recorded is the same work for every view on a screen, so the result is
// kept per sessions array (a new array from state is a new key). Callers only read the returned map.
const sessionBlocksCache = new WeakMap<FocusSession[], Map<string, Set<number>>>();

export const sessionBlocksByDay = (sessions: FocusSession[]): Map<string, Set<number>> => {
  const cached = sessionBlocksCache.get(sessions);
  if (cached) return cached;
  const map = computeSessionBlocksByDay(sessions);
  sessionBlocksCache.set(sessions, map);
  return map;
};

/**
 * Blocks of one day (before `elapsed`) covered only by a focus-timer session, with nothing painted on the grid.
 * It is time you spent that the grid does not show, so tracked time and the day's breakdown count it.
 */
export const timerOnlyBlocks = (
  sessions: FocusSession[],
  blocks: { date_key: string; block_index: number; activity_id?: string | null }[],
  dateKey: string,
  elapsed: number
): Set<number> => {
  const out = new Set<number>();
  const timer = sessionBlocksByDay(sessions).get(dateKey);
  if (!timer) return out;
  const painted = new Set<number>();
  for (const b of blocks) if (b.date_key === dateKey && b.activity_id) painted.add(b.block_index);
  for (const i of timer) if (i < elapsed && !painted.has(i)) out.add(i);
  return out;
};

const computeSessionBlocksByDay = (sessions: FocusSession[]): Map<string, Set<number>> => {
  const map = new Map<string, Set<number>>();
  for (const s of sessions) {
    const start = new Date(s.started_at).getTime();
    const end = start + s.duration_minutes * 60000;
    // walk through 10-minute blocks that overlap >= 5 minutes
    for (let t = Math.floor(start / 600000) * 600000; t < end; t += 600000) {
      const overlap = Math.min(end, t + 600000) - Math.max(start, t);
      if (overlap < 300000) continue;
      const d = new Date(t);
      const key = dayKey(d);
      const idx = Math.floor((d.getHours() * 60 + d.getMinutes()) / 10);
      (map.get(key) ?? map.set(key, new Set()).get(key)!).add(idx);
    }
  }
  return map;
};

// ─── Aggregation ─────────────────────────────────────────────────────────────

export interface FocusDay {
  dateKey: string;
  sum: Float64Array; // per slot: sum of block scores
  cnt: Float64Array; // per slot: observed blocks
  weight: number;
  weekday: number;
  /** blocks with a positive focus score that day */
  workBlocks: number;
}

export const buildFocusDays = (input: FocusInput, options: FocusOptions = {}): FocusDay[] => {
  const now = options.now ?? new Date();
  const half = options.halfLifeDays ?? DEFAULTS.halfLifeDays;
  const cat = new Map(input.activities.map((a) => [a.id, a.category ?? null]));
  // ignored activities (e.g. travel) are treated like sleep: not observed, so never judged
  const unobserved = new Set(input.sleepIds);
  for (const a of input.activities) if (a.analysis_ignored) unobserved.add(a.id);
  const byDate = new Map<string, DayBlockInfo[]>();
  for (const b of input.blocks) {
    if (!b.activity_id) continue;
    const arr = byDate.get(b.date_key) ?? byDate.set(b.date_key, Array.from({ length: 144 }, () => ({ activityId: null as string | null }))).get(b.date_key)!;
    arr[b.block_index] = { activityId: b.activity_id, taskId: b.task_id ?? null };
  }
  const sessionDays = sessionBlocksByDay(input.sessions ?? []);
  // an explicit category map (options.eligible) wins; otherwise your focus demand decides, once you've set any
  const weightOf = options.eligible ? undefined : focusWeightsFromDemand(input.activities) ?? undefined;
  for (const key of sessionDays.keys()) {
    if (!byDate.has(key)) byDate.set(key, Array.from({ length: 144 }, () => ({ activityId: null as string | null })));
  }
  const todayKey = dayKey(now);
  const elapsedToday = Math.floor((now.getHours() * 60 + now.getMinutes()) / 10);

  const days: FocusDay[] = [];
  for (const [dateKey, blocks] of byDate) {
    if (dateKey > todayKey) continue;
    const scores = scoreDay(blocks, {
      categoryOf: (id) => cat.get(id) ?? null,
      isSleep: (id) => unobserved.has(id),
      sessionBlocks: sessionDays.get(dateKey),
      elapsedBlocks: dateKey === todayKey ? elapsedToday : 144,
      eligible: options.eligible,
      weightOf,
    });
    const sum = new Float64Array(SLOTS);
    const cnt = new Float64Array(SLOTS);
    let any = false;
    let workBlocks = 0;
    scores.forEach((v, i) => {
      if (v === null) return;
      const s = Math.floor(i / BLOCKS_PER_SLOT);
      sum[s] += v;
      cnt[s] += 1;
      if (v > 0) workBlocks++;
      any = true;
    });
    if (!any) continue;
    const age = Math.max(0, differenceInCalendarDays(now, parseISO(dateKey)));
    days.push({ dateKey, sum, cnt, weight: Math.pow(0.5, age / half), weekday: getDay(parseISO(dateKey)), workBlocks });
  }
  return days.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
};

// ─── Peak search ─────────────────────────────────────────────────────────────

interface Curve { shrunk: Float64Array; weightedCount: Float64Array; rawCount: Float64Array; baseline: number }

const buildCurve = (
  daysList: FocusDay[],
  multiplicity: Float64Array | null,
  prior: number,
  mask?: boolean[]
): Curve => {
  const S = new Float64Array(SLOTS);
  const C = new Float64Array(SLOTS);
  let totS = 0, totC = 0;
  for (let d = 0; d < daysList.length; d++) {
    const m = multiplicity ? multiplicity[d] : 1;
    if (m === 0) continue;
    const day = daysList[d];
    const w = day.weight * m;
    for (let s = 0; s < SLOTS; s++) {
      S[s] += w * day.sum[s];
      C[s] += w * day.cnt[s];
      totS += w * day.sum[s];
      totC += w * day.cnt[s];
    }
  }
  const baseline = totC > 0 ? totS / totC : 0;
  // smooth sums and counts with a [0.2, 0.6, 0.2] kernel, then shrink toward the baseline
  const sS = new Float64Array(SLOTS), sC = new Float64Array(SLOTS);
  for (let s = 0; s < SLOTS; s++) {
    for (const [o, k] of [[-1, 0.2], [0, 0.6], [1, 0.2]] as const) {
      const t = s + o;
      if (t < 0 || t >= SLOTS) continue;
      sS[s] += k * S[t];
      sC[s] += k * C[t];
    }
  }
  const shrunk = new Float64Array(SLOTS);
  for (let s = 0; s < SLOTS; s++) {
    shrunk[s] = mask?.[s] ? -1 : (sS[s] + prior * baseline) / (sC[s] + prior);
    if (mask?.[s]) sC[s] = 0;
  }
  return { shrunk, weightedCount: sC, rawCount: mask ? C.map((v, s) => (mask[s] ? 0 : v)) : C, baseline };
};

interface Region { start: number; end: number; peak: number }

/** Full-width-at-half-maximum region around the best slot (min 2, max 10 slots). Null when there is no distinct peak. */
const findRegion = (curve: Curve, edgeFraction: number, minWeight: number, minLift = 0.03): Region | null => {
  let peak = -1, best = -Infinity;
  for (let s = 0; s < SLOTS; s++) {
    if (curve.rawCount[s] >= minWeight && curve.weightedCount[s] >= minWeight && curve.shrunk[s] > best) { best = curve.shrunk[s]; peak = s; }
  }
  if (peak < 0 || best - curve.baseline < minLift) return null;
  const edge = curve.baseline + edgeFraction * (best - curve.baseline);
  let a = peak, b = peak;
  const okSlot = (s: number) => s >= 0 && s < SLOTS && curve.shrunk[s] >= edge && curve.rawCount[s] >= minWeight * 0.5;
  while (b - a + 1 < 10) {
    const left = okSlot(a - 1) ? curve.shrunk[a - 1] : -Infinity;
    const right = okSlot(b + 1) ? curve.shrunk[b + 1] : -Infinity;
    if (left === -Infinity && right === -Infinity) break;
    if (left >= right) a--; else b++;
  }
  while (b - a + 1 < 2) { // widen to at least an hour using the better observed neighbour
    const left = a - 1 >= 0 && curve.rawCount[a - 1] > 0 ? curve.shrunk[a - 1] : -Infinity;
    const right = b + 1 < SLOTS && curve.rawCount[b + 1] > 0 ? curve.shrunk[b + 1] : -Infinity;
    if (left === -Infinity && right === -Infinity) break;
    if (left >= right) a--; else b++;
  }
  return { start: a, end: b, peak: best };
};

// seeded PRNG so results are reproducible
const mulberry32 = (seed: number) => () => {
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const hashKeys = (days: FocusDay[]) => days.reduce((h, d) => (Math.imul(h, 31) + d.dateKey.charCodeAt(9) + d.dateKey.charCodeAt(8) * 7 + d.dateKey.charCodeAt(6) * 13) | 0, 17);

export type Confidence = 'high' | 'medium' | 'low';

export interface FocusWindowResult {
  startMin: number;
  endMin: number;
  /** mean deep-focus density inside the window, 0-100 */
  score: number;
  /** your all-day baseline, 0-100 */
  baseline: number;
  /** (score - baseline) / baseline * 100, or null with no baseline */
  liftPct: number | null;
  /** 80% interval for the window score, 0-100 */
  ci80: [number, number];
  /** weighted share of days on which the window reached deep focus (day mean >= 60), 0-100 */
  deepDayPct: number;
  sampleDays: number;
  sampleBlocks: number;
  effectiveDays: number;
  /** share of bootstrap resamples that find (about) the same window, 0-1; null when not computed */
  stability: number | null;
  confidence: Confidence;
}

export interface CurvePoint {
  startMin: number;
  /** deep-focus density 0-100 (smoothed, shrunk) */
  value: number;
  /** weighted number of observed blocks behind this slot */
  observations: number;
  /** false when the slot has (almost) no observations; the value is then just the baseline */
  observed: boolean;
}

export interface FocusGroupResult {
  label: string;
  days: number;
  window: FocusWindowResult | null;
  /** deep-focus density per 30-minute slot, 0-100 (shrunk and smoothed) */
  curve: CurvePoint[];
  baseline: number;
}

const windowStats = (
  daysList: FocusDay[],
  region: Region,
  curve: Curve,
  stability: number | null
): FocusWindowResult | null => {
  const s0 = region.start, s1 = region.end;
  const need = Math.max(2, (s1 - s0 + 1)); // at least this many observed blocks in the window on a day
  let W = 0, W2 = 0, M = 0, blocks = 0, days = 0, deepW = 0;
  const obs: { m: number; w: number }[] = [];
  for (const d of daysList) {
    let s = 0, c = 0;
    for (let k = s0; k <= s1; k++) { s += d.sum[k]; c += d.cnt[k]; }
    if (c > 0) { blocks += c; days++; }
    if (c < need) continue;
    const dm = s / c;
    const w = d.weight * Math.min(1, c / (BLOCKS_PER_SLOT * (s1 - s0 + 1)));
    obs.push({ m: dm, w });
    W += w; W2 += w * w; M += w * dm;
    if (dm >= 0.6) deepW += w;
  }
  if (W === 0) return null;
  const mean = M / W;
  let varSum = 0;
  for (const o of obs) varSum += o.w * (o.m - mean) ** 2;
  const variance = varSum / W;
  const nEff = (W * W) / W2;
  const se = nEff > 1 ? Math.sqrt(variance / nEff) : 0.25;
  const z = 1.2816;
  const baseline = curve.baseline;
  const conf: Confidence = stability !== null && stability >= 0.75 && nEff >= 12 ? 'high' : stability !== null && stability >= 0.5 && nEff >= 6 ? 'medium' : 'low';
  return {
    startMin: s0 * SLOT_MIN,
    endMin: (s1 + 1) * SLOT_MIN,
    score: Math.round(mean * 100),
    baseline: Math.round(baseline * 100),
    liftPct: baseline > 0 ? Math.round(((mean - baseline) / baseline) * 100) : null,
    ci80: [Math.round(Math.max(0, mean - z * se) * 100), Math.round(Math.min(1, mean + z * se) * 100)],
    deepDayPct: Math.round((deepW / W) * 100),
    sampleDays: days,
    sampleBlocks: blocks,
    effectiveDays: Math.round(nEff * 10) / 10,
    stability,
    confidence: conf,
  };
};

const analyzeGroup = (
  label: string,
  daysList: FocusDay[],
  cfg: { prior: number; edgeFraction: number; bootstrap: number },
  minDays: number
): FocusGroupResult => {
  const curve = buildCurve(daysList, null, cfg.prior);
  const minWeight = 3;
  const points: CurvePoint[] = Array.from({ length: SLOTS }, (_, s) => ({ startMin: s * SLOT_MIN, value: Math.round(curve.shrunk[s] * 1000) / 10, observations: Math.round(curve.rawCount[s] * 10) / 10, observed: curve.rawCount[s] >= 1 }));
  if (daysList.length < minDays) return { label, days: daysList.length, window: null, curve: points, baseline: Math.round(curve.baseline * 100) };

  const region = findRegion(curve, cfg.edgeFraction, minWeight);
  if (!region) return { label, days: daysList.length, window: null, curve: points, baseline: Math.round(curve.baseline * 100) };

  // Bootstrap over days: how often is (about) the same window found?
  let stability: number | null = null;
  if (cfg.bootstrap > 0 && daysList.length >= 5) {
    const rand = mulberry32(hashKeys(daysList));
    const mult = new Float64Array(daysList.length);
    const center = (region.start + region.end) / 2;
    let hits = 0;
    for (let b = 0; b < cfg.bootstrap; b++) {
      mult.fill(0);
      for (let i = 0; i < daysList.length; i++) mult[Math.floor(rand() * daysList.length)]++;
      const c = buildCurve(daysList, mult, cfg.prior);
      const r = findRegion(c, cfg.edgeFraction, minWeight);
      if (r && Math.abs((r.start + r.end) / 2 - center) <= 2) hits++;
    }
    stability = hits / cfg.bootstrap;
  }
  return { label, days: daysList.length, window: windowStats(daysList, region, curve, stability), curve: points, baseline: Math.round(curve.baseline * 100) };
};

export interface FocusAnalysis {
  overall: FocusGroupResult;
  /** Weekday / weekend results, present only when their window differs from the overall one by 60+ minutes. */
  variants: FocusGroupResult[];
  /** A distinct second window (e.g. an afternoon "second wind"), if one exists. */
  secondary: FocusWindowResult | null;
  /** days with any tracked, awake time */
  observedDays: number;
  /** working days used for the curve (at least an hour of focus-eligible time) */
  activeDays: number;
  halfLifeDays: number;
}

/** Full analysis. Deterministic for the same input. May take a few tens of milliseconds for a year of data. */
export const analyzeFocus = (input: FocusInput, options: FocusOptions = {}): FocusAnalysis => {
  const cfg = {
    prior: options.priorStrength ?? DEFAULTS.priorStrength,
    edgeFraction: options.edgeFraction ?? DEFAULTS.edgeFraction,
    bootstrap: options.bootstrap ?? DEFAULTS.bootstrap,
  };
  const observed = buildFocusDays(input, options);
  // Days off (no focus-eligible work) would flatten the curve: analyse working days when there are enough of them
  const working = observed.filter((d) => d.workBlocks >= 6);
  const days = working.length >= 3 ? working : observed;
  const overall = analyzeGroup(working.length >= 3 ? 'Working days' : 'All days', days, cfg, 3);

  // Weekday / weekend split
  const variants: FocusGroupResult[] = [];
  const weekdays = days.filter((d) => d.weekday >= 1 && d.weekday <= 5);
  const weekends = days.filter((d) => d.weekday === 0 || d.weekday === 6);
  const smallCfg = { ...cfg, bootstrap: Math.min(cfg.bootstrap, 120) };
  for (const [label, group, min] of [['Mon-Fri', weekdays, 8], ['Sat-Sun', weekends, 6]] as const) {
    if (group.length < min) continue;
    const g = analyzeGroup(label, group, smallCfg, min);
    if (!g.window) continue;
    const o = overall.window;
    const differs = !o || Math.abs((g.window.startMin + g.window.endMin) / 2 - (o.startMin + o.endMin) / 2) >= 60;
    if (differs) variants.push(g);
  }

  // Second wind: mask the primary window (+1 slot) and look for another clear peak
  let secondary: FocusWindowResult | null = null;
  if (overall.window && days.length >= 8) {
    const primary = overall.window;
    const mask = new Array(SLOTS).fill(false);
    for (let s = Math.max(0, primary.startMin / SLOT_MIN - 1); s <= Math.min(SLOTS - 1, primary.endMin / SLOT_MIN); s++) mask[s] = true;
    const curve = buildCurve(days, null, cfg.prior, mask);
    const region = findRegion(curve, cfg.edgeFraction, 3);
    const primaryLift = (primary.score - primary.baseline) / 100;
    if (region && region.peak - curve.baseline >= 0.6 * primaryLift) {
      secondary = windowStats(days, region, curve, null);
    }
  }

  return { overall, variants, secondary, observedDays: observed.length, activeDays: days.length, halfLifeDays: options.halfLifeDays ?? DEFAULTS.halfLifeDays };
};

export const formatMinuteOfDay = (min: number): string => {
  const m = ((Math.round(min) % 1440) + 1440) % 1440; // callers may pass averaged (fractional) minutes
  const h = Math.floor(m / 60);
  const mi = m % 60;
  return `${h % 12 === 0 ? 12 : h % 12}${mi ? `:${String(mi).padStart(2, '0')}` : ''} ${h >= 12 ? 'PM' : 'AM'}`;
};

export const formatWindow = (w: { startMin: number; endMin: number }): string => `${formatMinuteOfDay(w.startMin)} – ${formatMinuteOfDay(w.endMin)}`;

/**
 * Plain-language context for a peak window from sleep timing. Explains the window, never changes it:
 * alertness follows time since waking and chronotype (with mixed evidence for a fixed "synchrony" boost), and most
 * people dip roughly 1-4 PM.
 */
export const describePeakContext = (
  w: { startMin: number; endMin: number },
  sleep: { wakeClockMin: number | null; midpointClockMin: number | null; chronotypeLabel: string | null }
): string[] => {
  const out: string[] = [];
  if (sleep.wakeClockMin !== null) {
    const after = Math.round((((w.startMin - sleep.wakeClockMin) % 1440) + 1440) % 1440);
    const h = Math.floor(after / 60), m = after % 60;
    out.push(`Starts about ${h > 0 ? `${h}h ` : ''}${m ? `${m}m ` : ''}after you usually wake (${formatMinuteOfDay(sleep.wakeClockMin)}).`);
  }
  if (sleep.chronotypeLabel && sleep.midpointClockMin !== null) {
    out.push(`Sleep midpoint ~${formatMinuteOfDay(sleep.midpointClockMin)} (${sleep.chronotypeLabel.toLowerCase()}); later types tend to peak later in the day, though studies disagree on how much.`);
  }
  if (w.startMin < 16 * 60 && w.endMin > 13 * 60) {
    out.push('It overlaps 1–4 PM, when most people\'s alertness dips; focusing well here is a real pattern in your data, not the norm.');
  }
  return out;
};
