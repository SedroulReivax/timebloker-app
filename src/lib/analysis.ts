import { differenceInCalendarDays, format, getDay, parseISO, startOfWeek } from 'date-fns';
import type { RangeBlock } from './blockRange';
import { DEFAULT_ELIGIBLE, focusWeightsFromDemand, scoreDay, sessionBlocksByDay, type DayBlockInfo, type FocusSession } from './focusModel';
import { bootstrapCI, compareSamples, geometricMean, mean, median, quantile, wilson, type ChangeResult } from './stats';

/**
 * One canonical per-day profile. Every screen (Trends, Focus, Day, Review, Dashboard tiles) reads from these, so the
 * same day can never produce two different numbers.
 *
 * Principles:
 *  - Only observed time is judged. Untracked, future and (for focus) sleep blocks are never counted against you.
 *  - Focus is measured three separate ways, not blended into one opaque score:
 *      focus share   how much of your tracked, awake time went to focus-eligible activity
 *      focus quality how deep that time was (warm-up, sustained runs, fragmentation), 0-100
 *      deep time     minutes inside uninterrupted focus runs of 30+ minutes
 *  - Fragmentation is measured directly (run lengths, switches per hour), not inferred from category labels.
 *  - Ignored activities (activities.analysis_ignored, and sleep) are tracked but never judged: they count as logged
 *    time, but never as focus, waste or productivity, and they are not part of the "awake" denominator.
 *  - Waste is time on a non-ignored activity with a negative productivity multiplier.
 */

export interface AnalysisActivity { id: string; category?: string | null; productivity_multiplier?: number | null; analysis_ignored?: boolean | null; focus_demand?: number | null }

export interface AnalysisInput {
  blocks: RangeBlock[];
  activities: AnalysisActivity[];
  sleepIds: Set<string>;
  sessions?: FocusSession[];
}

export interface AnalysisOptions {
  now?: Date;
  eligible?: Record<string, number>;
  /**
   * Only look at the first N blocks of every day. Used to compare "today so far" with past days cut at the same time
   * of day, so a half-finished day is never judged against whole ones.
   */
  cutoffBlocks?: number;
}

export interface Run {
  activityId: string;
  category: string | null;
  startIdx: number;
  blocks: number;
  eligible: boolean;
}

export interface DayProfile {
  dateKey: string;
  weekday: number;
  /** blocks that have fully elapsed (144 for a past day, so-far for today, 0 for the future) */
  elapsedBlocks: number;
  /** the day is over: safe to use in comparisons without partial-day bias */
  complete: boolean;
  /** assigned blocks incl. sleep */
  assignedBlocks: number;
  sleepBlocks: number;
  /** assigned, awake, judged blocks (excludes sleep and ignored activities; includes timer-only blocks) */
  awakeBlocks: number;
  /** assigned blocks of ignored, non-sleep activities (e.g. travel): tracked but never judged */
  ignoredBlocks: number;
  /** blocks on activities with a negative productivity multiplier */
  wasteBlocks: number;
  /** sum of |multiplier| over waste blocks: waste weighted by how bad you rated it */
  wasteCost: number;
  eligibleBlocks: number;
  /** sum of per-block depth scores (0-1 each) over eligible blocks */
  depthSum: number;
  /** eligible blocks inside uninterrupted runs of 3+ blocks (30 min) */
  deepBlocks: number;
  longestEligibleRun: number;
  runs: Run[];
  /** transitions between different activities (gaps of 30+ min break the sequence) */
  switches: number;
  /** transitions that also change category */
  crossSwitches: number;
  /** per-block score (0-1) for observed blocks, null otherwise: used by the heatmap and the focus model */
  scores: (number | null)[];
  /** sum of each judged block's activity productivity_multiplier (0 for activities with none set); can be negative */
  productivityBlocks: number;
}

const key = (d: Date) => format(d, 'yyyy-MM-dd');

export const elapsedBlocksFor = (dateKey: string, now: Date): number => {
  const today = key(now);
  if (dateKey < today) return 144;
  if (dateKey > today) return 0;
  return Math.min(144, Math.floor((now.getHours() * 60 + now.getMinutes()) / 10));
};

const GAP_BREAK = 3; // 30 min without tracking ends a run and breaks a switch sequence

/*
 * "Run" means different things in different places, on purpose. Each is tuned to its question, so they are named here
 * rather than merged (and each explainer in explain.ts says which one it uses):
 *  - profileDays runs (here): same activity on strictly adjacent awake blocks. Feeds deep focus (3+ blocks), the run
 *    histogram and the Day "Focus runs" list. Any gap ends the run. Switches count a change of activity within a gap
 *    of under 30 minutes (GAP_BREAK).
 *  - scoreDay (focusModel.ts): per-block focus depth. A blip of one block is tolerated after 2 clean blocks, because
 *    depth decays and recovers rather than resetting.
 *  - findRuns (activityFocus.ts): "what you focused on" by activity and time of day, tolerating one blip after 20
 *    clean minutes. It describes what you logged, so it is not the Deep focus figure.
 *  - buildDayFlows (flow.ts): one activity per flow, a lone untracked block inside it (DAY_FLOW_TOLERANCE) does not end it.
 *  - buildChains (flow.ts) and SQL transitions: chains of different activities with under 30 minutes between them.
 */

export const profileDays = (input: AnalysisInput, dateKeys: string[], options: AnalysisOptions = {}): DayProfile[] => {
  const now = options.now ?? new Date();
  const eligible = options.eligible ?? DEFAULT_ELIGIBLE;
  // same rule as the focus model: your focus demand decides focus work once any is set (an explicit map wins)
  const weightOf = options.eligible ? undefined : focusWeightsFromDemand(input.activities) ?? undefined;
  const cat = new Map(input.activities.map((a) => [a.id, a.category ?? null]));
  const mult = new Map(input.activities.map((a) => [a.id, a.productivity_multiplier ?? 0]));
  const ignored = new Set(input.sleepIds);
  for (const a of input.activities) if (a.analysis_ignored) ignored.add(a.id);
  const wanted = new Set(dateKeys);
  const byDate = new Map<string, DayBlockInfo[]>();
  for (const b of input.blocks) {
    if (!b.activity_id || !wanted.has(b.date_key)) continue; // only the days asked for get a 144-slot array
    const arr = byDate.get(b.date_key) ?? byDate.set(b.date_key, Array.from({ length: 144 }, () => ({ activityId: null as string | null }))).get(b.date_key)!;
    arr[b.block_index] = { activityId: b.activity_id, taskId: b.task_id ?? null };
  }
  const sessionDays = sessionBlocksByDay(input.sessions ?? []);
  const todayKey = key(now);

  return dateKeys.map((dateKey): DayProfile => {
    const elapsed = Math.min(elapsedBlocksFor(dateKey, now), options.cutoffBlocks ?? 144);
    const day = byDate.get(dateKey) ?? Array.from({ length: 144 }, () => ({ activityId: null as string | null }));
    const sessionBlocks = sessionDays.get(dateKey);
    const scores = scoreDay(day, {
      categoryOf: (id) => cat.get(id) ?? null,
      isSleep: (id) => ignored.has(id),
      sessionBlocks,
      elapsedBlocks: elapsed,
      eligible,
      weightOf,
    });

    let assigned = 0, sleep = 0, awake = 0, ignoredBlocks = 0, eligibleBlocks = 0, depthSum = 0, productivityBlocks = 0, wasteBlocks = 0, wasteCost = 0;
    const activityAt: (string | null)[] = new Array(144).fill(null);
    const isEligible: boolean[] = new Array(144).fill(false);
    for (let i = 0; i < elapsed; i++) {
      const a = day[i].activityId;
      if (!a) {
        if (scores[i] !== null) { awake++; activityAt[i] = '__session__'; } // session-only block counts as awake focus time
        continue;
      }
      assigned++;
      if (input.sleepIds.has(a)) { sleep++; continue; }
      if (ignored.has(a)) { ignoredBlocks++; continue; }
      const m = mult.get(a) ?? 0;
      productivityBlocks += m;
      if (m < 0) { wasteBlocks++; wasteCost -= m; }
      awake++;
      activityAt[i] = a;
    }
    for (let i = 0; i < elapsed; i++) {
      const s = scores[i];
      if (s !== null && s > 0) { eligibleBlocks++; depthSum += s; isEligible[i] = true; }
    }
    // blocks covered only by a timer session were still time you spent, so they count as tracked
    if (sessionBlocks) for (const i of sessionBlocks) if (i < elapsed && !day[i].activityId) assigned++;

    // Runs of the same activity across adjacent awake blocks
    const runs: Run[] = [];
    for (let i = 0; i < elapsed; i++) {
      const a = activityAt[i];
      if (!a) continue;
      const last = runs[runs.length - 1];
      if (last && last.activityId === a && last.startIdx + last.blocks === i) {
        last.blocks++;
        if (isEligible[i]) last.eligible = true;
      } else {
        runs.push({ activityId: a, category: a === '__session__' ? 'Work' : cat.get(a) ?? null, startIdx: i, blocks: 1, eligible: isEligible[i] });
      }
    }

    // Switches between consecutive runs (a 30+ minute gap breaks the chain). Picking the same activity back up after a
    // short gap is one flow, not a change (same rule as the Patterns tab's flows), so it is not a switch.
    let switches = 0, crossSwitches = 0;
    for (let k = 1; k < runs.length; k++) {
      const prev = runs[k - 1], cur = runs[k];
      const gap = cur.startIdx - (prev.startIdx + prev.blocks);
      if (gap >= GAP_BREAK) continue;
      if (prev.activityId === cur.activityId) continue;
      switches++;
      if ((prev.category ?? 'Uncategorized') !== (cur.category ?? 'Uncategorized')) crossSwitches++;
    }

    let deepBlocks = 0, longest = 0;
    for (const r of runs) {
      if (!r.eligible) continue;
      // count only the eligible blocks in runs of 30+ minutes
      let inRun = 0;
      for (let i = r.startIdx; i < r.startIdx + r.blocks; i++) if (isEligible[i]) inRun++;
      if (r.blocks >= 3) deepBlocks += inRun;
      longest = Math.max(longest, r.blocks);
    }

    return {
      dateKey,
      weekday: getDay(parseISO(dateKey)),
      elapsedBlocks: elapsed,
      complete: dateKey < todayKey,
      assignedBlocks: assigned,
      sleepBlocks: sleep,
      awakeBlocks: awake,
      ignoredBlocks,
      wasteBlocks,
      wasteCost,
      eligibleBlocks,
      depthSum,
      deepBlocks,
      longestEligibleRun: longest,
      runs,
      switches,
      crossSwitches,
      scores,
      productivityBlocks,
    };
  });
};

// ─── Aggregates ──────────────────────────────────────────────────────────────

export interface Summary {
  days: number;
  elapsedMinutes: number;
  assignedMinutes: number;
  awakeMinutes: number;
  /** tracked share of elapsed time (includes sleep). Not a productivity measure. */
  coveragePct: number | null;
  eligibleMinutes: number;
  /** eligible share of tracked awake time */
  focusSharePct: number | null;
  /** mean depth of eligible time, 0-100 */
  focusQualityPct: number | null;
  deepMinutes: number;
  /** deep minutes as a share of eligible minutes: how sustained your focus is */
  sustainedSharePct: number | null;
  meanRunMinutes: number | null;
  longestRunMinutes: number;
  /** activity changes per tracked awake hour */
  switchesPerHour: number | null;
  /** of which change category */
  crossSwitchesPerHour: number | null;
  /** minutes-weighted average of each judged block's activity productivity_multiplier; null with no judged time. Can be negative. */
  productivityScore: number | null;
  /** total multiplier x minutes across the period; can be negative */
  productivityPoints: number;
  /** tracked minutes on ignored (non-sleep) activities */
  ignoredMinutes: number;
  /** minutes on negative-multiplier activities */
  wasteMinutes: number;
  /** waste share of judged (awake, non-ignored) tracked time */
  wasteSharePct: number | null;
  /** waste minutes x |multiplier| */
  wastePoints: number;
}

export const summarize = (profiles: DayProfile[]): Summary => {
  let elapsed = 0, assigned = 0, awake = 0, eligible = 0, depth = 0, deep = 0, switches = 0, cross = 0, longest = 0, productivity = 0, ignoredB = 0, waste = 0, wasteCost = 0;
  const runLens: number[] = [];
  for (const p of profiles) {
    elapsed += p.elapsedBlocks;
    assigned += p.assignedBlocks;
    awake += p.awakeBlocks;
    eligible += p.eligibleBlocks;
    depth += p.depthSum;
    deep += p.deepBlocks;
    switches += p.switches;
    cross += p.crossSwitches;
    longest = Math.max(longest, p.longestEligibleRun);
    productivity += p.productivityBlocks;
    ignoredB += p.ignoredBlocks;
    waste += p.wasteBlocks;
    wasteCost += p.wasteCost;
    for (const r of p.runs) runLens.push(r.blocks);
  }
  const awakeHours = (awake * 10) / 60;
  return {
    days: profiles.filter((p) => p.assignedBlocks > 0).length,
    elapsedMinutes: elapsed * 10,
    assignedMinutes: assigned * 10,
    awakeMinutes: awake * 10,
    coveragePct: elapsed > 0 ? Math.round((assigned / elapsed) * 100) : null,
    eligibleMinutes: eligible * 10,
    focusSharePct: awake > 0 ? Math.round((eligible / awake) * 100) : null,
    focusQualityPct: eligible > 0 ? Math.round((depth / eligible) * 100) : null,
    deepMinutes: deep * 10,
    sustainedSharePct: eligible > 0 ? Math.round((deep / eligible) * 100) : null,
    meanRunMinutes: runLens.length ? (mean(runLens) as number) * 10 : null,
    longestRunMinutes: longest * 10,
    switchesPerHour: awakeHours > 0 ? switches / awakeHours : null,
    crossSwitchesPerHour: awakeHours > 0 ? cross / awakeHours : null,
    productivityScore: awake > 0 ? Math.round((productivity / awake) * 100) / 100 : null,
    productivityPoints: Math.round(productivity * 10 * 10) / 10,
    ignoredMinutes: ignoredB * 10,
    wasteMinutes: waste * 10,
    wasteSharePct: awake > 0 ? Math.round((waste / awake) * 100) : null,
    wastePoints: Math.round(wasteCost * 10 * 10) / 10,
  };
};

// ─── Bounded focus-model enrichment for backend-derived profiles ─────────────

/**
 * The subset of DayProfile that only the focus model (focusModel.ts, via profileDays) can
 * produce -- analytics_daily deliberately excludes these fields, so a screen
 * reading backend-derived profiles (backendAdapter.ts's mapAnalyticsToProfiles) needs this
 * supplement merged in by date rather than defaulting them to 0/[] for real days.
 */
export type FocusSupplement = Pick<DayProfile, 'depthSum' | 'deepBlocks' | 'eligibleBlocks' | 'longestEligibleRun' | 'runs'>;

/**
 * Bounded raw-block enrichment for the focus-model fields analytics_daily doesn't store. Calls
 * the exact same profileDays() every other consumer uses -- never a reimplementation -- over the
 * caller's own already-bounded date range. Never call this with an unbounded/all-history range;
 * it exists to patch in a handful of fields for a range you already fetched raw blocks for, not
 * to become a second full historical scan.
 */
export const focusSupplementByDate = (
  input: AnalysisInput,
  dateKeys: string[],
  options: AnalysisOptions = {}
): Map<string, FocusSupplement> => {
  const profiles = profileDays(input, dateKeys, options);
  return new Map(
    profiles.map((p) => [
      p.dateKey,
      { depthSum: p.depthSum, deepBlocks: p.deepBlocks, eligibleBlocks: p.eligibleBlocks, longestEligibleRun: p.longestEligibleRun, runs: p.runs },
    ])
  );
};

export type DayMetric = 'tracked' | 'awake' | 'eligible' | 'deep' | 'quality' | 'switchesPerHour' | 'coverage' | 'productivity' | 'waste';

/**
 * Day-level values of a metric for the COMPLETE days that have any tracking. Comparisons use these so a partial
 * "today" never drags a period down, and days with no tracking (a logging gap) are not treated as zero.
 */
/** One day's value of a metric, or null when the day is too thin to say (regardless of whether the day is finished). */
export const dayMetricValue = (p: DayProfile, metric: DayMetric): number | null => {
  if (p.assignedBlocks === 0 || p.elapsedBlocks === 0) return null;
  switch (metric) {
    case 'tracked': return p.assignedBlocks * 10;
    case 'awake': return p.awakeBlocks * 10;
    case 'eligible': return p.eligibleBlocks * 10;
    case 'deep': return p.deepBlocks * 10;
    case 'coverage': return (p.assignedBlocks / p.elapsedBlocks) * 100;
    case 'quality': return p.eligibleBlocks >= 3 ? (p.depthSum / p.eligibleBlocks) * 100 : null;
    case 'switchesPerHour': return p.awakeBlocks >= 6 ? p.switches / ((p.awakeBlocks * 10) / 60) : null;
    case 'productivity': return p.awakeBlocks > 0 ? p.productivityBlocks / p.awakeBlocks : null;
    case 'waste': return p.awakeBlocks > 0 ? p.wasteBlocks * 10 : null;
  }
};

export const dailyValues = (profiles: DayProfile[], metric: DayMetric): number[] => {
  const out: number[] = [];
  for (const p of profiles) {
    if (!p.complete) continue;
    const v = dayMetricValue(p, metric);
    if (v !== null) out.push(v);
  }
  return out;
};

export interface DayVsTypical {
  value: number | null;
  median: number | null;
  /** 25th-75th percentile of your recent days: "your typical range" */
  p25: number | null;
  p75: number | null;
  /** finished past days with a value */
  n: number;
  position: 'above' | 'within' | 'below' | 'insufficient';
}

/**
 * One day against your typical day. A single day cannot be bootstrapped, so instead of a change interval this says
 * whether the day sits above, within or below the middle half (25th-75th percentile) of your recent finished days.
 * Needs 7 such days. For today, pass history profiled with the same `cutoffBlocks`, so both sides cover the same hours.
 */
export const dayVsTypical = (day: DayProfile, history: DayProfile[], metric: DayMetric, minDays = 7): DayVsTypical => {
  const value = dayMetricValue(day, metric);
  const past = dailyValues(history.filter((p) => p.dateKey < day.dateKey), metric);
  const n = past.length;
  const p25 = quantile(past, 0.25), p75 = quantile(past, 0.75), med = median(past);
  let position: DayVsTypical['position'] = 'insufficient';
  if (value !== null && n >= minDays && p25 !== null && p75 !== null) position = value > p75 ? 'above' : value < p25 ? 'below' : 'within';
  return { value, median: med, p25, p75, n, position };
};

/** Is the metric really different from the previous period? Interval-based; "flat" when it cannot be told. */
export const compareMetric = (current: DayProfile[], previous: DayProfile[], metric: DayMetric): ChangeResult =>
  compareSamples(dailyValues(current, metric), dailyValues(previous, metric));

// ─── Weekday x hour focus heatmap ────────────────────────────────────────────

export interface HeatCell { value: number | null; n: number; days: number }

/**
 * 7 (Sun..Sat) x 24 (hour) deep-focus density, 0-100. Each cell is shrunk toward your overall baseline in proportion to
 * how little data it has, so a single lucky Tuesday 10 AM cannot show as a hot spot. Cells with fewer than `minBlocks`
 * observations are null (drawn empty), never zero.
 */
export const focusHeatmap = (
  profiles: DayProfile[],
  opts: { prior?: number; minBlocks?: number; halfLifeDays?: number; now?: Date } = {}
): { cells: HeatCell[][]; baseline: number } => {
  const prior = opts.prior ?? 6;
  const minBlocks = opts.minBlocks ?? 3;
  const now = opts.now ?? new Date();
  const half = opts.halfLifeDays ?? 60;
  const S = Array.from({ length: 7 }, () => new Float64Array(24));
  const N = Array.from({ length: 7 }, () => new Float64Array(24));
  const D = Array.from({ length: 7 }, () => new Float64Array(24));
  const raw = Array.from({ length: 7 }, () => new Float64Array(24));
  let totS = 0, totN = 0;
  for (const p of profiles) {
    const w = Math.pow(0.5, Math.max(0, differenceInCalendarDays(now, parseISO(p.dateKey))) / half);
    const seen = new Set<number>();
    p.scores.forEach((v, i) => {
      if (v === null) return;
      const h = Math.floor(i / 6);
      S[p.weekday][h] += w * v;
      N[p.weekday][h] += w;
      raw[p.weekday][h] += 1;
      totS += w * v;
      totN += w;
      seen.add(h);
    });
    for (const h of seen) D[p.weekday][h] += 1;
  }
  const baseline = totN > 0 ? totS / totN : 0;
  const cells = Array.from({ length: 7 }, (_, d) =>
    Array.from({ length: 24 }, (_, h): HeatCell => ({
      value: raw[d][h] >= minBlocks ? Math.round(((S[d][h] + prior * baseline) / (N[d][h] + prior)) * 100) : null,
      n: raw[d][h],
      days: D[d][h],
    }))
  );
  return { cells, baseline: Math.round(baseline * 100) };
};

// ─── Day-by-day series for trend charts ──────────────────────────────────────

export interface DailyPoint {
  dateKey: string;
  trackedMinutes: number;
  deepMinutes: number;
  coveragePct: number;
  /** null on days with under 30 min of focus-eligible time: too little to say anything about depth */
  focusQualityPct: number | null;
  /** null on days with no judged (awake, non-ignored) time */
  productivityScore: number | null;
  /** null on days with no judged time: nothing logged is not the same as no waste */
  wasteMinutes: number | null;
  /** null on days with under an hour of tracked awake time */
  switchesPerHour: number | null;
}

/**
 * One point per day that has actually elapsed (skips pure-future days), for trend charts. Unlike `dailyValues`,
 * this keeps partial "today" and zero-tracking days so the line stays continuous and dateKey-addressable.
 */
export const dailySeries = (profiles: DayProfile[]): DailyPoint[] =>
  profiles
    .filter((p) => p.elapsedBlocks > 0)
    .map((p) => ({
      dateKey: p.dateKey,
      trackedMinutes: p.assignedBlocks * 10,
      deepMinutes: p.deepBlocks * 10,
      coveragePct: Math.round((p.assignedBlocks / p.elapsedBlocks) * 100),
      focusQualityPct: p.eligibleBlocks >= 3 ? Math.round((p.depthSum / p.eligibleBlocks) * 100) : null,
      productivityScore: p.awakeBlocks > 0 ? Math.round((p.productivityBlocks / p.awakeBlocks) * 100) / 100 : null,
      wasteMinutes: p.awakeBlocks > 0 ? p.wasteBlocks * 10 : null,
      switchesPerHour: p.awakeBlocks >= 6 ? Math.round((p.switches / ((p.awakeBlocks * 10) / 60)) * 10) / 10 : null,
    }));

export interface ChartPoint extends DailyPoint { label: string }

const avgOrNull = (vals: (number | null)[]): number | null => {
  const present = vals.filter((v): v is number => v !== null);
  return present.length ? Math.round((present.reduce((a, b) => a + b, 0) / present.length) * 100) / 100 : null;
};

/**
 * Chart-ready points, labelled by day ("d MMM") for shorter ranges or averaged by ISO week ("d MMM", week start)
 * for 6m/1y so the x-axis stays legible. Nullable fields average only over the days that had enough data.
 */
export const bucketDailySeries = (series: DailyPoint[], weekly: boolean): ChartPoint[] => {
  if (!weekly) return series.map((p) => ({ ...p, label: format(parseISO(p.dateKey), 'd MMM') }));
  const order: string[] = [];
  const buckets = new Map<string, DailyPoint[]>();
  for (const p of series) {
    const wk = key(startOfWeek(parseISO(p.dateKey), { weekStartsOn: 1 }));
    if (!buckets.has(wk)) { buckets.set(wk, []); order.push(wk); }
    buckets.get(wk)!.push(p);
  }
  return order.map((wk) => {
    const pts = buckets.get(wk)!;
    return {
      dateKey: wk,
      label: format(parseISO(wk), 'd MMM'),
      trackedMinutes: Math.round(pts.reduce((s, p) => s + p.trackedMinutes, 0) / pts.length),
      deepMinutes: Math.round(pts.reduce((s, p) => s + p.deepMinutes, 0) / pts.length),
      coveragePct: Math.round(pts.reduce((s, p) => s + p.coveragePct, 0) / pts.length),
      focusQualityPct: avgOrNull(pts.map((p) => p.focusQualityPct)),
      productivityScore: avgOrNull(pts.map((p) => p.productivityScore)),
      wasteMinutes: avgOrNull(pts.map((p) => p.wasteMinutes)),
      switchesPerHour: avgOrNull(pts.map((p) => p.switchesPerHour)),
    };
  });
};

// ─── Estimation and reliability (per-task, multiplicative) ───────────────────

export interface EstimationInput {
  id: string;
  completed: boolean;
  estimatedMinutes: number | null;
  trackedMinutes: number;
  group: string;
}

export interface EstimationRow {
  label: string;
  n: number;
  /** geometric mean of tracked / estimated: "tasks take x times the estimate" */
  multiplier: number | null;
  /** 80% interval for the multiplier (bootstrap over tasks) */
  lo: number | null;
  hi: number | null;
  /** share of tasks that took longer than estimated, with a Wilson interval */
  overPct: number | null;
  overLo: number | null;
  overHi: number | null;
  /** median tracked / estimated */
  medianRatio: number | null;
}

const ratioRow = (label: string, ratios: number[]): EstimationRow => {
  const over = ratios.filter((r) => r > 1).length;
  const w = wilson(over, ratios.length);
  const ci = bootstrapCI(ratios.map((r) => Math.log(r)), (xs) => mean(xs));
  return {
    label,
    n: ratios.length,
    multiplier: geometricMean(ratios),
    lo: ci.lo !== null ? Math.exp(ci.lo) : null,
    hi: ci.hi !== null ? Math.exp(ci.hi) : null,
    overPct: w.p !== null ? Math.round(w.p * 100) : null,
    overLo: w.lo !== null ? Math.round(w.lo * 100) : null,
    overHi: w.hi !== null ? Math.round(w.hi * 100) : null,
    medianRatio: median(ratios),
  };
};

/**
 * Estimation accuracy per task, on a multiplicative scale. Errors in time estimates are ratios (2x too long is as
 * wrong as 2x too short), so the geometric mean of tracked/estimated is the right centre, and it is not dominated
 * by one huge task the way a ratio of sums is. Only completed tasks with an estimate and tracked time are used.
 */
export const estimationAccuracy = (tasks: EstimationInput[], minTrackedMinutes = 10): { overall: EstimationRow | null; groups: EstimationRow[] } => {
  const usable = tasks.filter((t) => t.completed && t.estimatedMinutes && t.estimatedMinutes > 0 && t.trackedMinutes >= minTrackedMinutes);
  if (usable.length === 0) return { overall: null, groups: [] };
  const byGroup = new Map<string, number[]>();
  for (const t of usable) (byGroup.get(t.group) ?? byGroup.set(t.group, []).get(t.group)!).push(t.trackedMinutes / (t.estimatedMinutes as number));
  return {
    overall: ratioRow('All tasks', usable.map((t) => t.trackedMinutes / (t.estimatedMinutes as number))),
    groups: Array.from(byGroup.entries()).map(([g, r]) => ratioRow(g, r)).sort((a, b) => b.n - a.n),
  };
};

export interface ReliabilityResult {
  measured: number;
  onTime: number;
  pctOnTime: number | null;
  lo: number | null;
  hi: number | null;
  /** median hours late among late tasks */
  medianLateHours: number | null;
}

export const deadlineReliability = (items: { dueAt: Date; doneAt: Date }[]): ReliabilityResult => {
  const late = items.filter((i) => i.doneAt.getTime() > i.dueAt.getTime());
  const onTime = items.length - late.length;
  const w = wilson(onTime, items.length);
  return {
    measured: items.length,
    onTime,
    pctOnTime: w.p !== null ? Math.round(w.p * 100) : null,
    lo: w.lo !== null ? Math.round(w.lo * 100) : null,
    hi: w.hi !== null ? Math.round(w.hi * 100) : null,
    medianLateHours: late.length ? (median(late.map((i) => (i.doneAt.getTime() - i.dueAt.getTime()) / 3600000)) as number) : null,
  };
};

// ─── How long are your focus stretches? ─────────────────────────────────────

export interface RunBucket { label: string; minBlocks: number; maxBlocks: number; minutes: number; sharePct: number }

/**
 * Where your focus time sits by stretch length. Each focus-eligible block is assigned to the run it belongs to, so a
 * 2 hour run contributes 120 minutes to the "2h+" bucket. Shows whether focus happens in short bursts or long sessions.
 */
export const focusRunHistogram = (profiles: DayProfile[]): { buckets: RunBucket[]; totalMinutes: number } => {
  const defs: [string, number, number][] = [['Under 30 min', 1, 2], ['30–60 min', 3, 5], ['1–1.5 h', 6, 8], ['1.5–2 h', 9, 11], ['2 h +', 12, 144]];
  const minutes = defs.map(() => 0);
  for (const p of profiles) {
    for (const r of p.runs) {
      if (!r.eligible) continue;
      let inRun = 0;
      for (let i = r.startIdx; i < r.startIdx + r.blocks; i++) if (p.scores[i] !== null && (p.scores[i] as number) > 0) inRun++;
      const idx = defs.findIndex(([, lo, hi]) => r.blocks >= lo && r.blocks <= hi);
      if (idx >= 0) minutes[idx] += inRun * 10;
    }
  }
  const total = minutes.reduce((a, b) => a + b, 0);
  return {
    totalMinutes: total,
    buckets: defs.map(([label, lo, hi], i) => ({ label, minBlocks: lo, maxBlocks: hi, minutes: minutes[i], sharePct: total ? Math.round((minutes[i] / total) * 100) : 0 })),
  };
};

export interface CurvePoint {
  /** half hour of the day, 0-47 */
  slot: number;
  /** average productivity multiplier of the judged time in this half hour; null when none was judged */
  value: number | null;
  /** judged minutes behind the value, summed over all days */
  minutes: number;
  /**
   * Productivity points in this half hour per judged day: multiplier x minutes, summed, divided by the days in
   * range that have any judged time. Unlike `value` it grows with how much you did, not only how well:
   * 30 min at +1x and 10 min at +1x have the same value (1x) but 30 vs 10 points.
   */
  pointsPerDay: number;
}

/**
 * Your focus curve: how productive each half hour of the day was, by your own per-activity multipliers.
 * Same rules as profileDays: only elapsed, assigned blocks count; sleep and ignored activities are left out;
 * an activity with no multiplier counts as 0. Over several days each half hour averages every judged block in it,
 * so a busy half hour on one day weighs no more per minute than a quiet one on another.
 */
export const productivityCurve = (input: AnalysisInput, dateKeys: string[], options: Pick<AnalysisOptions, 'now' | 'cutoffBlocks'> = {}): CurvePoint[] => {
  const now = options.now ?? new Date();
  const mult = new Map(input.activities.map((a) => [a.id, a.productivity_multiplier ?? 0]));
  const skip = new Set(input.sleepIds);
  for (const a of input.activities) if (a.analysis_ignored) skip.add(a.id);
  const limit = new Map(dateKeys.map((k) => [k, Math.min(elapsedBlocksFor(k, now), options.cutoffBlocks ?? 144)]));
  const sum = new Array(48).fill(0), n = new Array(48).fill(0);
  const judgedDays = new Set<string>();
  for (const b of input.blocks) {
    const cap = limit.get(b.date_key);
    if (cap === undefined || b.block_index >= cap || !b.activity_id || skip.has(b.activity_id)) continue;
    const slot = Math.floor(b.block_index / 3);
    sum[slot] += mult.get(b.activity_id) ?? 0;
    n[slot]++;
    judgedDays.add(b.date_key);
  }
  const days = Math.max(1, judgedDays.size);
  return sum.map((s, slot) => ({
    slot,
    value: n[slot] ? Math.round((s / n[slot]) * 100) / 100 : null,
    minutes: n[slot] * 10,
    pointsPerDay: Math.round(((s * 10) / days) * 10) / 10,
  }));
};
