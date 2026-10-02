import { addDays, format, getDay, parseISO } from 'date-fns';
import { mean, median, medianDifference, spearmanTest, stdev, type Association } from './stats';

/**
 * Sleep analysis over 10-minute blocks.
 *
 * A "night" for date X is the window 18:00 on X -> 18:00 on X+1 (block 108 = 18:00). Within it, sleep blocks are
 * grouped into sessions (a gap of more than 2 hours starts a new one). The longest session is the main sleep;
 * the rest are naps. Gaps inside the main session are awake time (a gap of 20+ minutes counts as a wake-up).
 * "Relative minutes" below are minutes since 18:00 of the night date, a linear scale that never wraps at midnight.
 */

export const BLOCK_MIN = 10;
const NIGHT_START_BLOCK = 108; // 18:00
const SESSION_GAP_BLOCKS = 12; // > 2h apart = separate session
const WAKEUP_MIN_BLOCKS = 2;

export interface SleepBlock { date_key: string; block_index: number }

export interface Session { startRel: number; endRel: number; sleepMinutes: number }

export interface MainSleep extends Session {
  inBedMinutes: number;
  awakeMinutes: number;
  /** sleepMinutes / inBedMinutes, 0-1 */
  efficiency: number;
  wakeUps: number;
  longestAwakeMinutes: number;
  /** awake intervals inside the main session, in relative minutes */
  gaps: { startRel: number; endRel: number }[];
}

export interface Night {
  nightDate: string;
  wakeDate: string;
  main: MainSleep | null;
  naps: Session[];
  napMinutes: number;
  /** main + naps */
  totalMinutes: number;
  quality: number | null;
  energy: number | null;
  factors: string[];
  notes: string | null;
}

export interface NightLog { quality?: number | null; energy?: number | null; factors?: string[] | null; notes?: string | null }

const relOf = (dateKey: string, nightDate: string, wakeDate: string, idx: number): number | null => {
  if (dateKey === nightDate && idx >= NIGHT_START_BLOCK) return idx - NIGHT_START_BLOCK;
  if (dateKey === wakeDate && idx < NIGHT_START_BLOCK) return 36 + idx;
  return null;
};

export const buildNight = (sleepBlocks: SleepBlock[], nightDate: string, log: NightLog = {}): Night => {
  const wakeDate = format(addDays(parseISO(nightDate), 1), 'yyyy-MM-dd');
  const rels = new Set<number>();
  for (const b of sleepBlocks) {
    const r = relOf(b.date_key, nightDate, wakeDate, b.block_index);
    if (r !== null) rels.add(r);
  }
  const sorted = Array.from(rels).sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const r of sorted) {
    const g = groups[groups.length - 1];
    if (g && r - g[g.length - 1] <= SESSION_GAP_BLOCKS) g.push(r);
    else groups.push([r]);
  }

  let main: MainSleep | null = null;
  let mainIdx = -1;
  groups.forEach((g, i) => {
    if (!main || g.length > main.sleepMinutes / BLOCK_MIN) {
      const span = g[g.length - 1] - g[0] + 1;
      const gaps: number[] = [];
      const gapSpans: { startRel: number; endRel: number }[] = [];
      for (let k = 1; k < g.length; k++) {
        if (g[k] - g[k - 1] > 1) {
          gaps.push(g[k] - g[k - 1] - 1);
          gapSpans.push({ startRel: (g[k - 1] + 1) * BLOCK_MIN, endRel: g[k] * BLOCK_MIN });
        }
      }
      const awakeBlocks = span - g.length;
      main = {
        startRel: g[0] * BLOCK_MIN,
        endRel: (g[g.length - 1] + 1) * BLOCK_MIN,
        sleepMinutes: g.length * BLOCK_MIN,
        inBedMinutes: span * BLOCK_MIN,
        awakeMinutes: awakeBlocks * BLOCK_MIN,
        efficiency: g.length / span,
        wakeUps: gaps.filter((n) => n >= WAKEUP_MIN_BLOCKS).length,
        longestAwakeMinutes: (gaps.length ? Math.max(...gaps) : 0) * BLOCK_MIN,
        gaps: gapSpans,
      };
      mainIdx = i;
    }
  });

  const naps: Session[] = groups
    .filter((_, i) => i !== mainIdx)
    .map((g) => ({ startRel: g[0] * BLOCK_MIN, endRel: (g[g.length - 1] + 1) * BLOCK_MIN, sleepMinutes: g.length * BLOCK_MIN }));
  const napMinutes = naps.reduce((s, n) => s + n.sleepMinutes, 0);
  const mainMinutes = (main as MainSleep | null)?.sleepMinutes ?? 0;

  return {
    nightDate,
    wakeDate,
    main,
    naps,
    napMinutes,
    totalMinutes: mainMinutes + napMinutes,
    quality: log.quality ?? null,
    energy: log.energy ?? null,
    factors: log.factors ?? [],
    notes: log.notes ?? null,
  };
};

export const buildNights = (sleepBlocks: SleepBlock[], nightDates: string[], logs: Record<string, NightLog> = {}): Night[] =>
  nightDates.map((d) => buildNight(sleepBlocks, d, logs[d]));

// ─── Clock helpers ───────────────────────────────────────────────────────────

/** Relative minutes (since 18:00) -> clock minutes since midnight (0-1439). */
export const relToClock = (rel: number): number => (((NIGHT_START_BLOCK * BLOCK_MIN + rel) % 1440) + 1440) % 1440;

export const formatClock = (clockMin: number): string => {
  const m = ((Math.round(clockMin) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m % 60).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

export const formatRel = (rel: number): string => formatClock(relToClock(rel));

export const formatDur = (minutes: number): string => {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  return h === 0 ? `${m}m` : m % 60 === 0 ? `${h}h` : `${h}h ${m % 60}m`;
};

/** "HH:MM" (24h text as stored in user_settings) -> clock minutes, or null. */
export const parseClockText = (t: string | null | undefined): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t ?? '');
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  return h < 24 && mi < 60 ? h * 60 + mi : null;
};

// ─── Small stats ─────────────────────────────────────────────────────────────

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

const withMain = (nights: Night[]) => nights.filter((n): n is Night & { main: MainSleep } => n.main !== null);

// ─── Per-night score (transparent components) ────────────────────────────────

export interface SleepScoreParts { duration: number; continuity: number; regularity: number | null; rating: number | null }
export interface SleepScore { score: number; parts: SleepScoreParts; weights: Record<keyof SleepScoreParts, number> }

export const SCORE_WEIGHTS: Record<keyof SleepScoreParts, number> = { duration: 40, continuity: 20, regularity: 25, rating: 15 };

export interface Baseline { medianBedRel: number | null; medianWakeRel: number | null }

export const getBaseline = (nights: Night[]): Baseline => ({
  medianBedRel: median(withMain(nights).map((n) => n.main.startRel)),
  medianWakeRel: median(withMain(nights).map((n) => n.main.endRel)),
});

/**
 * Score a night 0-100 from up to four visible components:
 *  duration (40)    total sleep vs your goal, lightly penalised for large oversleeping
 *  continuity (20)  efficiency (time asleep / time in bed) and wake-ups
 *  regularity (25)  how close bed and wake times were to your usual (needs a baseline)
 *  rating (15)      your own 1-5 quality (and energy, if logged)
 * Missing components are left out and the rest re-weighted.
 */
export const scoreNight = (night: Night, goalMinutes: number, baseline: Baseline): SleepScore | null => {
  if (!night.main) return null;
  const total = night.totalMinutes;
  let duration = 100 * clamp01(total / goalMinutes);
  if (total > goalMinutes * 1.3) duration = Math.max(70, 100 - ((total - goalMinutes * 1.3) / 60) * 10);

  const continuity = Math.max(0, 100 * clamp01((night.main.efficiency - 0.75) / 0.2) - night.main.wakeUps * 5);

  let regularity: number | null = null;
  if (baseline.medianBedRel !== null && baseline.medianWakeRel !== null) {
    const dev = (Math.abs(night.main.startRel - baseline.medianBedRel) + Math.abs(night.main.endRel - baseline.medianWakeRel)) / 2;
    regularity = 100 * (1 - clamp01((dev - 20) / 100));
  }

  const ratings = [night.quality, night.energy].filter((v): v is number => v !== null);
  const rating = ratings.length ? 100 * clamp01(((mean(ratings) as number) - 1) / 4) : null;

  const parts: SleepScoreParts = { duration, continuity, regularity, rating };
  let sum = 0, w = 0;
  (Object.keys(parts) as (keyof SleepScoreParts)[]).forEach((k) => {
    const v = parts[k];
    if (v !== null) { sum += v * SCORE_WEIGHTS[k]; w += SCORE_WEIGHTS[k]; }
  });
  return { score: Math.round(sum / w), parts, weights: SCORE_WEIGHTS };
};

// ─── Aggregates ──────────────────────────────────────────────────────────────

export interface SleepDebt {
  /** hours-worth in minutes: goal minus actual summed over the window (positive = owed) */
  netMinutes: number;
  /** sum of shortfalls only */
  shortfallMinutes: number;
  nights: number;
}

export const getSleepDebt = (nights: Night[], goalMinutes: number, lastN = 14): SleepDebt => {
  const recent = nights.filter((n) => n.totalMinutes > 0).slice(-lastN);
  let net = 0, short = 0;
  for (const n of recent) {
    const d = goalMinutes - n.totalMinutes;
    net += d;
    if (d > 0) short += d;
  }
  return { netMinutes: Math.max(0, net), shortfallMinutes: short, nights: recent.length };
};

export interface Regularity {
  bedSdMin: number | null;
  wakeSdMin: number | null;
  /** 0-100; 100 at <= 20 min spread, 0 at >= 90 min */
  score: number | null;
  nights: number;
}

export const getRegularity = (nights: Night[], lastN = 14): Regularity => {
  const recent = withMain(nights).slice(-lastN);
  const bed = stdev(recent.map((n) => n.main.startRel));
  const wake = stdev(recent.map((n) => n.main.endRel));
  const spreads = [bed, wake].filter((v): v is number => v !== null);
  const avg = mean(spreads);
  return { bedSdMin: bed, wakeSdMin: wake, score: avg === null ? null : Math.round(100 * (1 - clamp01((avg - 20) / 70))), nights: recent.length };
};

export interface SleepAverages {
  nights: number;
  totalMinutes: number | null;
  mainMinutes: number | null;
  bedRel: number | null;
  wakeRel: number | null;
  midpointRel: number | null;
  efficiency: number | null;
  wakeUps: number | null;
  napMinutesPerDay: number | null;
}

export const getAverages = (nights: Night[]): SleepAverages => {
  const m = withMain(nights);
  const days = nights.length || 1;
  return {
    nights: m.length,
    totalMinutes: mean(m.map((n) => n.totalMinutes)),
    mainMinutes: mean(m.map((n) => n.main.sleepMinutes)),
    bedRel: mean(m.map((n) => n.main.startRel)),
    wakeRel: mean(m.map((n) => n.main.endRel)),
    midpointRel: mean(m.map((n) => (n.main.startRel + n.main.endRel) / 2)),
    efficiency: mean(m.map((n) => n.main.efficiency)),
    wakeUps: mean(m.map((n) => n.main.wakeUps)),
    napMinutesPerDay: nights.reduce((s, n) => s + n.napMinutes, 0) / days,
  };
};

export type Chronotype = 'early' | 'intermediate' | 'late';

/** Approximate chronotype from mid-sleep clock time (a rough guide, not a clinical measure). */
export const getChronotype = (midpointRel: number | null): { type: Chronotype; label: string } | null => {
  if (midpointRel === null) return null;
  const clock = relToClock(midpointRel);
  const t: Chronotype = clock < 3 * 60 ? 'early' : clock <= 5 * 60 ? 'intermediate' : 'late';
  return { type: t, label: t === 'early' ? 'Early type' : t === 'late' ? 'Late type' : 'Intermediate type' };
};

export interface SocialJetLag { minutes: number; workMidpointRel: number; freeMidpointRel: number; workNights: number; freeNights: number }

/** Difference in mid-sleep between free days (wake on Sat/Sun) and work days (wake Mon-Fri); needs 3+ of each. */
export const getSocialJetLag = (nights: Night[]): SocialJetLag | null => {
  const m = withMain(nights);
  const free = m.filter((n) => [0, 6].includes(getDay(parseISO(n.wakeDate))));
  const work = m.filter((n) => ![0, 6].includes(getDay(parseISO(n.wakeDate))));
  if (free.length < 3 || work.length < 3) return null;
  const mid = (xs: typeof m) => mean(xs.map((n) => (n.main.startRel + n.main.endRel) / 2)) as number;
  const f = mid(free), w = mid(work);
  return { minutes: Math.round(f - w), workMidpointRel: w, freeMidpointRel: f, workNights: work.length, freeNights: free.length };
};

/** Average total sleep by the weekday you woke up (0=Sun..6=Sat); null where there is no data. */
export const getWeekdayPattern = (nights: Night[]): { weekday: number; avgMinutes: number | null; n: number }[] =>
  Array.from({ length: 7 }, (_, d) => {
    const xs = nights.filter((n) => n.totalMinutes > 0 && getDay(parseISO(n.wakeDate)) === d).map((n) => n.totalMinutes);
    return { weekday: d, avgMinutes: mean(xs), n: xs.length };
  });

// ─── Streaks ─────────────────────────────────────────────────────────────────

/** Consecutive most-recent nights meeting the goal (>= 95%). A missing night ends the streak. */
export const getGoalStreak = (nights: Night[], goalMinutes: number): number => {
  let s = 0;
  for (let i = nights.length - 1; i >= 0; i--) {
    if (nights[i].totalMinutes >= goalMinutes * 0.95) s++;
    else break;
  }
  return s;
};

/** Consecutive most-recent nights whose bedtime is within `toleranceMin` of your median bedtime. */
export const getBedtimeStreak = (nights: Night[], toleranceMin = 30): number => {
  const base = getBaseline(nights).medianBedRel;
  if (base === null) return 0;
  let s = 0;
  for (let i = nights.length - 1; i >= 0; i--) {
    const m = nights[i].main;
    if (m && Math.abs(m.startRel - base) <= toleranceMin) s++;
    else break;
  }
  return s;
};

// ─── Tonight planner ─────────────────────────────────────────────────────────

export interface TonightPlan {
  /** clock minutes since midnight */
  windDownClock: number;
  inBedClock: number;
  asleepByClock: number;
  wakeClock: number;
  sleepMinutes: number;
}

/**
 * Work backwards from the wake time: wake - goal sleep = asleep by; minus the usual awake-in-bed overhead and a
 * latency allowance = get in bed; minus 45 min = start winding down.
 */
export const planTonight = (goalMinutes: number, wakeClock: number, overheadMinutes = 0, latencyMinutes = 15): TonightPlan => {
  const asleep = wakeClock - goalMinutes;
  const inBed = asleep - Math.round(overheadMinutes) - latencyMinutes;
  const wrap = (x: number) => ((x % 1440) + 1440) % 1440;
  return { windDownClock: wrap(inBed - 45), inBedClock: wrap(inBed), asleepByClock: wrap(asleep), wakeClock: wrap(wakeClock), sleepMinutes: goalMinutes };
};

// ─── Factors ─────────────────────────────────────────────────────────────────

export const SLEEP_FACTORS: { id: string; label: string; emoji: string }[] = [
  { id: 'caffeine_late', label: 'Late caffeine', emoji: '☕' },
  { id: 'alcohol', label: 'Alcohol', emoji: '🍷' },
  { id: 'screens', label: 'Screens in bed', emoji: '📱' },
  { id: 'late_meal', label: 'Late meal', emoji: '🍕' },
  { id: 'exercise', label: 'Exercise', emoji: '🏃' },
  { id: 'stress', label: 'Stressed', emoji: '😣' },
  { id: 'nap', label: 'Napped', emoji: '😴' },
  { id: 'travel', label: 'Travel / noise', emoji: '✈️' },
];

export interface FactorImpact {
  factor: string;
  withN: number;
  withoutN: number;
  /** median total sleep with minus without (minutes) */
  sleepDelta: number | null;
  /** median quality (1-5) with minus without */
  qualityDelta: number | null;
}

/** Compare nights with a factor against nights without it. Needs >= minEach nights in both groups. */
export const getFactorImpacts = (nights: Night[], minEach = 4): FactorImpact[] => {
  const usable = nights.filter((n) => n.totalMinutes > 0 && (n.factors.length > 0 || n.quality !== null || n.energy !== null));
  const tagged = usable.filter((n) => n.factors.length > 0 || n.quality !== null); // the user logged this night
  const out: FactorImpact[] = [];
  for (const f of SLEEP_FACTORS) {
    const w = tagged.filter((n) => n.factors.includes(f.id));
    const wo = tagged.filter((n) => !n.factors.includes(f.id));
    if (w.length < minEach || wo.length < minEach) continue;
    const md = (xs: (number | null)[]) => median(xs.filter((v): v is number => v !== null));
    const a = md(w.map((n) => n.totalMinutes)), b = md(wo.map((n) => n.totalMinutes));
    const qa = md(w.map((n) => n.quality)), qb = md(wo.map((n) => n.quality));
    out.push({
      factor: f.id,
      withN: w.length,
      withoutN: wo.length,
      sleepDelta: a !== null && b !== null ? a - b : null,
      qualityDelta: qa !== null && qb !== null ? Math.round((qa - qb) * 10) / 10 : null,
    });
  }
  return out.sort((x, y) => Math.abs(y.sleepDelta ?? 0) - Math.abs(x.sleepDelta ?? 0));
};

// ─── Coaching (rule-based, every line carries its evidence) ──────────────────

export interface Insight { id: string; tone: 'good' | 'watch' | 'info'; title: string; detail: string }

export const getInsights = (nights: Night[], goalMinutes: number): Insight[] => {
  const out: Insight[] = [];
  const logged = nights.filter((n) => n.totalMinutes > 0);
  if (logged.length < 3) return [{ id: 'need-data', tone: 'info', title: 'Keep tracking', detail: 'Insights appear after three nights of sleep tracked in your grid.' }];

  const debt = getSleepDebt(nights, goalMinutes);
  if (debt.nights >= 5) {
    if (debt.netMinutes >= 120) out.push({ id: 'debt', tone: 'watch', title: `About ${formatDur(debt.netMinutes)} of sleep owed`, detail: `Over the last ${debt.nights} tracked nights you slept ${formatDur(debt.netMinutes)} less than your goal in total. Small extra amounts on a few nights repay it faster than one long sleep-in.` });
    else if (debt.netMinutes === 0) out.push({ id: 'debt-clear', tone: 'good', title: 'No sleep debt', detail: `Across the last ${debt.nights} nights you met or beat your goal overall.` });
  }

  const reg = getRegularity(nights);
  if (reg.score !== null && reg.nights >= 5) {
    if (reg.score < 50) out.push({ id: 'regularity', tone: 'watch', title: 'Sleep times are all over the place', detail: `Bedtime varies by about ±${Math.round(reg.bedSdMin ?? 0)} min and wake time by ±${Math.round(reg.wakeSdMin ?? 0)} min (${reg.nights} nights). A steadier schedule usually helps more than adding an hour.` });
    else if (reg.score >= 80) out.push({ id: 'regularity-good', tone: 'good', title: 'Very regular schedule', detail: `Bedtime spread is only ±${Math.round(reg.bedSdMin ?? 0)} min over ${reg.nights} nights.` });
  }

  const sjl = getSocialJetLag(nights);
  if (sjl && Math.abs(sjl.minutes) >= 45) out.push({ id: 'sjl', tone: 'watch', title: `Weekends shift your sleep by ${formatDur(Math.abs(sjl.minutes))}`, detail: `Your mid-sleep is ${formatDur(Math.abs(sjl.minutes))} ${sjl.minutes > 0 ? 'later' : 'earlier'} on weekends than on weekdays (${sjl.freeNights} weekend vs ${sjl.workNights} weekday nights), like a small jet lag every Monday.` });

  const eff = getAverages(nights).efficiency;
  if (eff !== null && eff < 0.85) out.push({ id: 'efficiency', tone: 'watch', title: 'Broken sleep', detail: `You are asleep for about ${Math.round(eff * 100)}% of the time between first and last sleep block, with ${getAverages(nights).wakeUps?.toFixed(1)} wake-ups a night on average.` });

  const recent = logged.slice(-7), prior = logged.slice(-14, -7);
  if (recent.length >= 4 && prior.length >= 4) {
    const d = (mean(recent.map((n) => n.totalMinutes)) as number) - (mean(prior.map((n) => n.totalMinutes)) as number);
    if (Math.abs(d) >= 20) out.push({ id: 'trend', tone: d > 0 ? 'good' : 'watch', title: `Sleeping ${formatDur(Math.abs(d))} ${d > 0 ? 'more' : 'less'} than the week before`, detail: `Average over the last ${recent.length} tracked nights vs the ${prior.length} before.` });
  }

  const avgNap = getAverages(nights).napMinutesPerDay;
  if (avgNap !== null && avgNap >= 25) out.push({ id: 'naps', tone: 'info', title: 'Naps are part of your pattern', detail: `About ${formatDur(avgNap)} of napping per day on average. They count toward your total but not toward the main-sleep numbers.` });

  const factors = getFactorImpacts(nights);
  const top = factors.find((f) => (f.sleepDelta ?? 0) <= -20 || (f.qualityDelta ?? 0) <= -0.5);
  if (top) {
    const meta = SLEEP_FACTORS.find((f) => f.id === top.factor)!;
    out.push({ id: `factor-${top.factor}`, tone: 'watch', title: `${meta.emoji} ${meta.label} goes with worse nights`, detail: `${top.withN} nights with it vs ${top.withoutN} without: ${top.sleepDelta !== null ? `${top.sleepDelta > 0 ? '+' : '−'}${formatDur(Math.abs(top.sleepDelta))} sleep` : ''}${top.qualityDelta !== null ? `, quality ${top.qualityDelta > 0 ? '+' : ''}${top.qualityDelta}` : ''}. An association in your data, not proof of cause.` });
  }

  return out;
};

// ─── Sleep Regularity Index ──────────────────────────────────────────────────

export interface RegularityIndex {
  /** -100 (opposite pattern every day) .. 100 (identical every day); ~ 80+ is very regular */
  sri: number | null;
  /** consecutive tracked day pairs compared */
  pairs: number;
}

/**
 * Sleep Regularity Index (Phillips et al., 2017): the probability that you are in the same state (asleep or awake) at
 * the same clock time on consecutive days, rescaled to -100..100. Unlike the spread of bedtimes, it also captures
 * fragmented and split sleep. Only days that have sleep tracked are compared, and on those days any block that is not
 * sleep is treated as awake.
 */
export const getSleepRegularityIndex = (sleepBlocks: SleepBlock[], dateKeys: string[], minSleepBlocks = 24): RegularityIndex => {
  const asleep = new Map<string, Uint8Array>();
  for (const b of sleepBlocks) {
    const arr = asleep.get(b.date_key) ?? asleep.set(b.date_key, new Uint8Array(144)).get(b.date_key)!;
    arr[b.block_index] = 1;
  }
  const tracked = (d: string) => {
    const a = asleep.get(d);
    return !!a && a.reduce((s, v) => s + v, 0) >= minSleepBlocks;
  };
  let match = 0, total = 0, pairs = 0;
  for (const d of dateKeys) {
    const next = format(addDays(parseISO(d), 1), 'yyyy-MM-dd');
    if (!tracked(d) || !tracked(next)) continue;
    const a = asleep.get(d)!, b = asleep.get(next)!;
    for (let i = 0; i < 144; i++) if (a[i] === b[i]) match++;
    total += 144;
    pairs++;
  }
  return { sri: pairs >= 3 ? Math.round(200 * (match / total) - 100) : null, pairs };
};

// ─── Does short sleep go with a different next day? (honest association test) ─

export interface SleepEffect {
  n: number;
  short: { n: number; median: number | null };
  other: { n: number; median: number | null };
  /** median(short) - median(other) with an 80% bootstrap interval; null unless both groups are big enough */
  diff: { value: number; lo: number; hi: number } | null;
  association: Association;
  /**
   * clear:        permutation p < 0.05 and the interval for the correlation excludes zero
   * possible:     p < 0.15, worth watching but not something to act on
   * none:         enough data and no relationship detectable
   * insufficient: fewer than 10 nights
   */
  verdict: 'clear' | 'possible' | 'none' | 'insufficient';
}

/**
 * Compare a next-day metric against sleep length. Uses a rank correlation with a permutation test (no normality
 * assumption, robust to outliers) instead of a raw Pearson threshold. With 10 nights of pure noise, a Pearson
 * cut-off of 0.4 fires about a quarter of the time; the permutation p-value keeps the false-alarm rate near 5%.
 */
export const analyzeSleepEffect = (pairs: { sleepMinutes: number; value: number }[], opts: { thresholdMinutes?: number; B?: number } = {}): SleepEffect => {
  const thr = opts.thresholdMinutes ?? 420;
  const short = pairs.filter((p) => p.sleepMinutes < thr).map((p) => p.value);
  const other = pairs.filter((p) => p.sleepMinutes >= thr).map((p) => p.value);
  const md = short.length >= 4 && other.length >= 4 ? medianDifference(short, other) : null;
  const association = spearmanTest(pairs.map((p) => p.sleepMinutes), pairs.map((p) => p.value), { B: opts.B ?? 1000 });
  let verdict: SleepEffect['verdict'] = 'insufficient';
  if (pairs.length >= 10 && association.p !== null) {
    const ciExcludesZero = association.lo !== null && association.hi !== null && (association.lo > 0 || association.hi < 0);
    verdict = association.p < 0.05 && ciExcludesZero ? 'clear' : association.p < 0.15 ? 'possible' : 'none';
  }
  return {
    n: pairs.length,
    short: { n: short.length, median: median(short) },
    other: { n: other.length, median: median(other) },
    diff: md && md.diff !== null && md.lo !== null && md.hi !== null ? { value: md.diff, lo: md.lo, hi: md.hi } : null,
    association,
    verdict,
  };
};
