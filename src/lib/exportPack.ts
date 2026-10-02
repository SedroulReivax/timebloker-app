import { differenceInCalendarDays, eachDayOfInterval, format, getDay, parseISO, subDays } from 'date-fns';
import type { RangeBlock } from './blockRange';
import { compareMetric, deadlineReliability, estimationAccuracy, focusHeatmap, focusRunHistogram, profileDays, summarize, type DayMetric, type Summary } from './analysis';
import { activityFocus, findRuns, judgedDays, TIMER_ID } from './activityFocus';
import { getIgnoredActivityIds } from './activityFlags';
import { getDeadlineDateKey, isDateOnlyDeadline } from './deadlines';
import { analyzeFlow } from './flow';
import { analyzeFocus, formatWindow } from './focusModel';
import { dailyMinutesFromBlocks, getGoalPace } from './goals';
import { computeHabitStats, describeFrequency, isDueOn } from './habits';
import { blindSpots, getFocusByDate, loggingGaps } from './insights';
import { analyzeSleepEffects } from './sleepEffects';
import { getSleepActivityIds } from './sleepActivity';
import { buildNights, getBaseline, getFactorImpacts, relToClock, scoreNight } from './sleepAnalysis';
import { getEstimatedMinutes } from './taskTime';
import { analyzeWaste, CONTEXT_GAP, CONTEXT_START, CONTEXT_WAKE } from './waste';

/**
 * Export: one analysis engine, three renderers (AI-ready markdown, JSON, CSV bundle).
 *
 * Every number comes from the same engines the screens use (day profiles, focus model, activity focus, waste, flow,
 * logging gaps, sleep effects), so an export can never disagree with the app. Tables are defined once and rendered as
 * markdown tables (compact and well read by language models) and as CSV files.
 *
 * Anonymising happens while building, not afterwards: names are replaced as they are written and free text is never
 * copied, so nothing private can leak through a field that was forgotten.
 */

export const EXPORT_SCHEMA_VERSION = 1;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ─── Input ───────────────────────────────────────────────────────────────────

export interface ExportActivity {
  id: string; name: string; color?: string | null; category?: string | null; archived?: boolean | null;
  is_sleep_activity?: boolean | null; productivity_multiplier?: number | null; analysis_ignored?: boolean | null;
}
export interface ExportTask {
  id: string; title: string; completed: boolean; activity_id: string | null; date_key?: string | null;
  estimated_minutes?: number | null; estimated_pomodoros?: number | null; completed_at?: string | null; deadline?: string | null;
  urgency?: boolean | null; importance?: boolean | null;
}
export interface ExportSession { task_id?: string | null; started_at: string; duration_minutes: number }
export interface ExportHabit { id: string; name: string; type?: string | null; frequency?: string | null; target_count?: number | null; weekdays?: number[] | null; created_at?: string | null }
export interface ExportHabitLog { habit_id: string; date_key: string | null; logged_at?: string | null }
export interface ExportGoal {
  id: string; title: string; status?: string | null; target_hours?: number | null; target_date?: string | null; created_at?: string | null;
  updated_at?: string | null; linked_activity_ids?: string[] | null; linked_habit_ids?: string[] | null; description?: string | null;
}
export interface ExportSleepLog { date_key: string; quality?: number | null; energy?: number | null; factors?: string[] | null; notes?: string | null }
export interface ExportReview { period_type: string; period_key: string; energy?: number | null; happened?: string | null; planned?: string | null; changed?: string | null; carry_over?: string | null; notes?: string | null }

/** Rows of the backend analytics layer (analytics_* tables) for the export range, as returned by the get_*_analytics_range RPCs. */
export interface ExportBackendAnalytics {
  daily: {
    date_key: string; tracked_minutes: number; untracked_minutes: number; elapsed_minutes: number; coverage_pct: number | null;
    judged_minutes: number; ignored_minutes: number; sleep_minutes: number; productivity_points: number; productivity_score: number | null;
    attention_points: number; attention_efficiency: number | null; waste_minutes: number; waste_points: number; waste_share_pct: number | null;
    switch_count: number; cross_switch_count: number; switches_per_hour: number | null; longest_run_minutes: number | null;
    mean_run_minutes: number | null; task_focus_minutes: number; tasks_completed: number; goal_minutes: number;
  }[];
  activity: {
    date_key: string; activity_id: string; minutes: number; judged_minutes: number; ignored_minutes: number; productivity_points: number;
    productivity_score: number | null; focus_demand_points: number; waste_minutes: number; waste_points: number; run_count: number; longest_run_minutes: number | null;
  }[];
  goal: { date_key: string; goal_id: string; goal_minutes: number; cumulative_hours: number; linked_task_count: number; linked_habit_completions: number }[];
  habit: { date_key: string; habit_id: string; due: boolean; completed: boolean; log_count: number }[];
  transition: { date_key: string; from_activity_id: string; to_activity_id: string; transition_count: number }[];
}

export interface ExportInput {
  /** blocks from (from - 28 days, or the previous period start, whichever is earlier) to `to` */
  blocks: RangeBlock[];
  activities: ExportActivity[];
  tasks: ExportTask[];
  taskBlocks: { date_key: string; block_index: number; task_id: string }[];
  sessions: ExportSession[];
  habits: ExportHabit[];
  habitLogs: ExportHabitLog[];
  goals: ExportGoal[];
  sleepLogs: ExportSleepLog[];
  reviews: ExportReview[];
  settings?: { sleep_goal_hours?: number | null; default_wake_time?: string | null; default_sleep_time?: string | null } | null;
  /** Backend analytics rows for [from, to]; omit when unavailable (the analytics tables are left out of the export). */
  backend?: ExportBackendAnalytics | null;
}

export interface ExportInclude { timeline: boolean; text: boolean; tasks: boolean; habits: boolean; sleep: boolean; goals: boolean; analytics: boolean }
export const DEFAULT_INCLUDE: ExportInclude = { timeline: true, text: true, tasks: true, habits: true, sleep: true, goals: true, analytics: true };

export interface ExportOptions { include?: Partial<ExportInclude>; anonymise?: boolean; now?: Date }

/** How many days before `from` are needed in `blocks` (previous period for comparisons). */
export const exportFetchStart = (fromKey: string, toKey: string): string => {
  const len = differenceInCalendarDays(parseISO(toKey), parseISO(fromKey)) + 1;
  return format(subDays(parseISO(fromKey), Math.max(len, 28)), 'yyyy-MM-dd');
};

// ─── Output ──────────────────────────────────────────────────────────────────

export type Cell = string | number | boolean | null;
export interface Table { title: string; description: string; columns: string[]; rows: Cell[][] }

export interface ExportData {
  schema_version: number;
  meta: {
    app: 'TimeBloker'; generated_at: string; timezone: string; from: string; to: string; days: number; days_with_tracking: number;
    anonymised: boolean; included: ExportInclude;
    settings: { sleep_goal_hours: number | null; default_wake_time: string | null; default_sleep_time: string | null };
  };
  definitions: { term: string; meaning: string }[];
  summary: { metric: string; this_period: string; previous_period: string; change: string }[];
  insights: {
    focus: string[];
    waste: string[];
    patterns: string[];
    sleep: string[];
    goals: string[];
    tasks: string[];
    data_quality: string[];
  };
  tables: Record<string, Table>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const hhmm = (min: number): string => {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const blockHHMM = (idx: number) => (idx >= 144 ? '24:00' : hhmm(idx * 10));
const r1 = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);
const r2 = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const mins = (m: number | null | undefined) => (m === null || m === undefined ? '—' : `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`);
const letters = (i: number) => { let s = ''; i++; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };

const DEFINITIONS: { term: string; meaning: string }[] = [
  { term: 'block', meaning: 'The app records time in 10-minute blocks. Times are local, 24-hour.' },
  { term: 'tracked', meaning: 'Minutes with any recorded activity (sleep included).' },
  { term: 'untracked', meaning: 'Minutes with nothing recorded. NOT idle time and NOT waste: just unknown. Days with no tracking are left out of averages, not counted as zero.' },
  { term: 'ignored activity', meaning: 'Tracked but never judged (e.g. travel). Sleep is always ignored. Excluded from focus, waste and productivity.' },
  { term: 'awake / judged time', meaning: 'Tracked minutes excluding sleep and ignored activities. Denominator for focus share, waste share and productivity.' },
  { term: 'focus-eligible', meaning: 'Activities weighted by their focus demand (0-5 -> 0-100%, only when the productivity multiplier is positive); before any focus demand is set, Work and Admin category activities instead. Plus task-linked blocks and focus-timer sessions.' },
  { term: 'deep focus', meaning: 'Focus-eligible minutes inside unbroken runs of 30+ minutes.' },
  { term: 'focus quality', meaning: '0-100 average depth of focus-eligible time: full depth after ~20 min of one activity, reduced right after interruptions and switches, mild decline after 90 min.' },
  { term: 'focus share', meaning: 'Focus-eligible share of awake judged time.' },
  { term: 'focused (activity focus)', meaning: 'Any activity, in a run holding 30+ minutes of it; one 10-minute blip inside the run is allowed but not counted. A record of what happened, not a prediction.' },
  { term: 'core window', meaning: 'Shortest clock window holding half of an activity\'s focused (or wasted) minutes.' },
  { term: 'productivity', meaning: 'Average of the user\'s own per-activity multipliers (-5..+5) over judged minutes. 1 = fully productive minute, negative = counts against.' },
  { term: 'waste', meaning: 'Minutes on activities with a negative multiplier (not ignored). Cost = minutes x |multiplier|.' },
  { term: 'waste stretch', meaning: 'Consecutive waste blocks (one untracked block tolerated). "Led by" = what ended at most 20 min before it, or waking, an untracked gap, or the start of the tracked day.' },
  { term: 'trigger rate', meaning: 'Share of an activity\'s runs followed by waste within 20 min, with an 80% interval. Rare activities have wide intervals: do not over-read them.' },
  { term: 'switches per hour', meaning: 'Activity changes per tracked awake hour (a 30+ min gap does not count as a switch).' },
  { term: 'peak focus window', meaning: 'A model (recency-weighted, shrunk toward your average, bootstrap-checked) of when deep work is most reliable, with a confidence label.' },
  { term: 'change', meaning: 'Compared with the previous period of the same length using an 80% bootstrap interval over days. "no clear change" means the difference is within normal day-to-day variation.' },
  { term: 'sleep effect verdict', meaning: 'Rank correlation between sleep length and a next-day measure with a permutation test. "clear" needs p < 0.05; associations, not causes.' },
  { term: 'night', meaning: 'The window 18:00 on the night date to 18:00 the next day. Sleep minutes include naps.' },
];

const QUESTIONS = [
  'When do I actually focus best, and on what? Use the focus tables and the peak window, and say how confident you are.',
  'What reliably leads into wasted time, and what gets me out of it? Use the trigger rates (mind the intervals) and return times.',
  'How does sleep line up with the next day\'s focus, waste and productivity? Only call it a pattern where the verdict supports it.',
  'Which were my best and worst days in this period, and what was different about them (sleep, start time, first activity, switches)?',
  'Where am I not tracking, and could those gaps change your conclusions?',
  'Are my task estimates realistic? Am I on pace for my goals?',
  'Give me three concrete experiments for next week, each with the exact number from this data I should watch to judge it.',
];

// ─── Build ───────────────────────────────────────────────────────────────────

export const buildExportData = (input: ExportInput, fromKey: string, toKey: string, opts: ExportOptions = {}): ExportData => {
  const now = opts.now ?? new Date();
  const inc: ExportInclude = { ...DEFAULT_INCLUDE, ...opts.include };
  const anon = !!opts.anonymise;
  const keepText = inc.text && !anon;

  const dateKeys = eachDayOfInterval({ start: parseISO(fromKey), end: parseISO(toKey) }).map((d) => format(d, 'yyyy-MM-dd'));
  const len = dateKeys.length;
  const prevKeys = eachDayOfInterval({ start: subDays(parseISO(fromKey), len), end: subDays(parseISO(fromKey), 1) }).map((d) => format(d, 'yyyy-MM-dd'));
  const inRange = (k: string | null | undefined) => !!k && k >= fromKey && k <= toKey;
  const rangeBlocks = input.blocks.filter((b) => b.date_key >= fromKey && b.date_key <= toKey);

  const sleepIds = getSleepActivityIds(input.activities);
  const ignored = getIgnoredActivityIds(input.activities, sleepIds);
  const actInfo = new Map(input.activities.map((a) => [a.id, a]));

  // Names (anonymised on the way out)
  const actAlias = new Map<string, string>();
  [...input.activities].sort((a, b) => a.name.localeCompare(b.name)).forEach((a, i) => actAlias.set(a.id, `Activity ${letters(i)}`));
  const actName = (id: string | null | undefined): string => {
    if (!id) return '';
    if (id === TIMER_ID) return 'Focus timer';
    if (anon) return actAlias.get(id) ?? 'Activity ?';
    return actInfo.get(id)?.name ?? 'Unknown activity';
  };
  const taskAlias = new Map(input.tasks.map((t, i) => [t.id, `Task ${i + 1}`]));
  const taskName = (id: string | null | undefined) => (!id ? '' : anon ? taskAlias.get(id) ?? 'Task ?' : input.tasks.find((t) => t.id === id)?.title ?? 'Unknown task');
  const habitName = (h: ExportHabit, i: number) => (anon ? `Habit ${i + 1}` : h.name);
  const goalName = (g: ExportGoal, i: number) => (anon ? `Goal ${i + 1}` : g.title);
  const ctxName = (id: string) => (id === CONTEXT_WAKE ? 'waking up' : id === CONTEXT_GAP ? 'an untracked gap' : id === CONTEXT_START ? 'start of tracked day' : actName(id));

  // Core engines
  const aInput = { blocks: input.blocks, activities: input.activities, sleepIds, sessions: input.sessions };
  const cur = profileDays(aInput, dateKeys, { now });
  const prev = profileDays(aInput, prevKeys, { now });
  const sCur = summarize(cur);
  const sPrev = summarize(prev);
  const af = activityFocus(aInput, dateKeys, { now, topN: 50 });
  const waste = analyzeWaste({ blocks: input.blocks, activities: input.activities, sleepIds }, dateKeys, { now });
  const flow = analyzeFlow({ blocks: rangeBlocks, activities: input.activities, sleepIds }, dateKeys, { now });
  const gaps = loggingGaps(rangeBlocks, dateKeys, now);
  const focus = analyzeFocus({ blocks: rangeBlocks, activities: input.activities, sleepIds, sessions: input.sessions }, { now });
  const heat = focusHeatmap(cur, { now });
  const hist = focusRunHistogram(cur);
  const timerByDate = getFocusByDate(input.sessions);

  // Sleep nights whose wake date is in range
  const logsByNight = Object.fromEntries(input.sleepLogs.map((l) => [l.date_key, { quality: l.quality ?? null, energy: l.energy ?? null, factors: l.factors ?? [], notes: keepText ? l.notes ?? null : null }]));
  const nightKeys = dateKeys.map((k) => format(subDays(parseISO(k), 1), 'yyyy-MM-dd'));
  const allNightKeys = [...prevKeys.slice(-14).map((k) => format(subDays(parseISO(k), 1), 'yyyy-MM-dd')), ...nightKeys];
  const allNights = buildNights(input.blocks.filter((b) => b.activity_id && sleepIds.has(b.activity_id)), allNightKeys, logsByNight);
  const nights = allNights.filter((n) => nightKeys.includes(n.nightDate));
  const goalMinutes = Math.round((input.settings?.sleep_goal_hours || 8) * 60);
  const baseline = getBaseline(allNights.filter((n) => n.main).slice(-14));
  const nightByWake = new Map(nights.map((n) => [n.wakeDate, { n, score: n.main ? scoreNight(n, goalMinutes, baseline) : null }]));

  const sleepFx = inc.sleep ? analyzeSleepEffects({ blocks: input.blocks, activities: input.activities, sleepIds, sessions: input.sessions, tasks: input.tasks }, [...prevKeys, ...dateKeys].map((k) => format(subDays(parseISO(k), 1), 'yyyy-MM-dd')), { B: 400 }) : null;

  // ── Summary with honest comparisons ──
  const cmp = (m: DayMetric) => {
    const c = compareMetric(cur, prev, m);
    if (!c.enough) return 'not enough days to compare';
    if (c.direction === 'flat' || c.delta === null) return 'no clear change';
    return `${c.direction} ${r2(Math.abs(c.delta))}/day (80% interval ${r2(c.lo)} to ${r2(c.hi)})`;
  };
  const perDay = (s: Summary, total: number) => (s.days ? total / s.days : null);
  const summary = [
    { metric: 'days with tracking', this_period: String(sCur.days), previous_period: String(sPrev.days), change: '' },
    { metric: 'tracked per tracked day', this_period: mins(perDay(sCur, sCur.assignedMinutes)), previous_period: mins(perDay(sPrev, sPrev.assignedMinutes)), change: cmp('tracked') },
    { metric: 'coverage (tracked share of elapsed time)', this_period: `${sCur.coveragePct ?? '—'}%`, previous_period: `${sPrev.coveragePct ?? '—'}%`, change: cmp('coverage') },
    { metric: 'deep focus per tracked day', this_period: mins(perDay(sCur, sCur.deepMinutes)), previous_period: mins(perDay(sPrev, sPrev.deepMinutes)), change: cmp('deep') },
    { metric: 'focus quality (0-100)', this_period: String(sCur.focusQualityPct ?? '—'), previous_period: String(sPrev.focusQualityPct ?? '—'), change: cmp('quality') },
    { metric: 'focus share of judged time', this_period: `${sCur.focusSharePct ?? '—'}%`, previous_period: `${sPrev.focusSharePct ?? '—'}%`, change: '' },
    { metric: 'switches per awake hour', this_period: String(r1(sCur.switchesPerHour) ?? '—'), previous_period: String(r1(sPrev.switchesPerHour) ?? '—'), change: cmp('switchesPerHour') },
    { metric: 'productivity (avg multiplier)', this_period: String(r2(sCur.productivityScore) ?? '—'), previous_period: String(r2(sPrev.productivityScore) ?? '—'), change: cmp('productivity') },
    { metric: 'waste per tracked day', this_period: mins(perDay(sCur, sCur.wasteMinutes)), previous_period: mins(perDay(sPrev, sPrev.wasteMinutes)), change: cmp('waste') },
    { metric: 'waste share of judged time', this_period: `${sCur.wasteSharePct ?? '—'}%`, previous_period: `${sPrev.wasteSharePct ?? '—'}%`, change: '' },
    { metric: 'ignored time (total)', this_period: mins(sCur.ignoredMinutes), previous_period: mins(sPrev.ignoredMinutes), change: '' },
  ];

  // ── Tables ──
  const tables: Record<string, Table> = {};

  const tasksDoneOn = (k: string) => input.tasks.filter((t) => t.completed && t.completed_at && format(new Date(t.completed_at), 'yyyy-MM-dd') === k).length;
  const dayReviews = input.reviews.filter((r) => r.period_type === 'day');
  const reviewKeys = new Set(dayReviews.filter((r) => r.happened || r.planned || r.changed || r.carry_over || r.notes).map((r) => r.period_key));
  const energyByDay = new Map(dayReviews.filter((r) => r.energy != null).map((r) => [r.period_key, r.energy as number]));
  tables.days = {
    title: 'Days',
    description: 'One row per day. sleep_* is the night before (ending that morning). energy is the self-rated 1-7 energy of the whole day (blank = not rated). Blank = not enough data that day (never a zero).',
    columns: ['date', 'weekday', 'tracked_min', 'awake_min', 'ignored_min', 'coverage_pct', 'deep_min', 'focus_quality', 'focus_share_pct', 'switches_per_h', 'productivity', 'waste_min', 'waste_cost', 'timer_min', 'tasks_done', 'habits_done_due', 'sleep_min', 'sleep_score', 'bed', 'wake', 'top_activity', 'energy', 'reflection'],
    rows: cur.filter((p) => p.elapsedBlocks > 0).map((p) => {
      const top = new Map<string, number>();
      for (const b of rangeBlocks) if (b.date_key === p.dateKey && b.activity_id && !sleepIds.has(b.activity_id)) top.set(b.activity_id, (top.get(b.activity_id) ?? 0) + 10);
      const topId = [...top.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      const night = nightByWake.get(p.dateKey);
      const due = inc.habits ? input.habits.filter((h) => isDueOn({ ...h, type: h.type ?? 'daily' }, p.dateKey)) : [];
      const done = inc.habits ? due.filter((h) => input.habitLogs.some((l) => l.habit_id === h.id && l.date_key === p.dateKey)).length : 0;
      const q = p.eligibleBlocks >= 3 ? Math.round((p.depthSum / p.eligibleBlocks) * 100) : null;
      const judged = p.awakeBlocks > 0;
      return [
        p.dateKey, DOW[p.weekday], p.assignedBlocks * 10, p.awakeBlocks * 10, p.ignoredBlocks * 10,
        p.elapsedBlocks ? Math.round((p.assignedBlocks / p.elapsedBlocks) * 100) : null,
        p.deepBlocks * 10, q, judged ? Math.round((p.eligibleBlocks / p.awakeBlocks) * 100) : null,
        p.awakeBlocks >= 6 ? r1(p.switches / ((p.awakeBlocks * 10) / 60)) : null,
        judged ? r2(p.productivityBlocks / p.awakeBlocks) : null,
        judged ? p.wasteBlocks * 10 : null, judged ? r1(p.wasteCost * 10) : null,
        timerByDate[p.dateKey] ?? 0, tasksDoneOn(p.dateKey),
        inc.habits && due.length ? `${done}/${due.length}` : null,
        inc.sleep && night ? night.n.totalMinutes : null, inc.sleep && night?.score ? night.score.score : null,
        inc.sleep && night?.n.main ? hhmm(relToClock(night.n.main.startRel)) : null,
        inc.sleep && night?.n.main ? hhmm(relToClock(night.n.main.endRel)) : null,
        topId ? actName(topId) : null,
        energyByDay.get(p.dateKey) ?? null,
        reviewKeys.has(p.dateKey),
      ];
    }),
  };

  const totals = new Map<string, number>();
  for (const b of rangeBlocks) if (b.activity_id) totals.set(b.activity_id, (totals.get(b.activity_id) ?? 0) + 10);
  const afById = new Map(af.rows.map((r) => [r.id, r]));
  const wasteById = new Map(waste.rows.map((r) => [r.id, r]));
  tables.activities = {
    title: 'Activities',
    description: 'Every activity with time in the period. multiplier is the user\'s own productivity weight. focused = minutes in 30+ min runs of it.',
    columns: ['activity', 'category', 'multiplier', 'flags', 'total_min', 'share_of_tracked_pct', 'focused_min', 'focus_rate_pct', 'median_run_min', 'longest_run_min', 'focus_core_window', 'focused_days', 'waste_min'],
    rows: [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([id, m]) => {
      const a = actInfo.get(id);
      const f = afById.get(id);
      const flags = [sleepIds.has(id) ? 'sleep' : '', ignored.has(id) && !sleepIds.has(id) ? 'ignored' : '', a?.archived ? 'archived' : ''].filter(Boolean).join(' ');
      return [
        actName(id), a?.category ?? null, a?.productivity_multiplier ?? 0, flags || null, m,
        sCur.assignedMinutes ? Math.round((m / sCur.assignedMinutes) * 100) : null,
        f?.focusedMinutes ?? 0, f?.focusRatePct ?? null, f?.medianRunMinutes ?? null, f?.longestRunMinutes ?? null,
        f?.core ? `${hhmm(f.core.startMin)}-${hhmm(f.core.endMin)}` : null, f?.focusedDays ?? 0, wasteById.get(id)?.minutes ?? 0,
      ];
    }),
  };

  // Focus runs (every 30+ min run), from the same record-based engine
  const runRows: Cell[][] = [];
  for (const { dateKey, day } of judgedDays(aInput, dateKeys, now)) {
    for (const r of findRuns(day)) if (r.blocks >= 3) runRows.push([dateKey, blockHHMM(r.startIdx), blockHHMM(r.endIdx + 1), r.blocks * 10, actName(r.activityId)]);
  }
  tables.focus_runs = { title: 'Focus runs', description: 'Every run of 30+ minutes on one activity (one 10-min blip allowed; minutes exclude the blip).', columns: ['date', 'start', 'end', 'minutes', 'activity'], rows: runRows };

  tables.waste_stretches = {
    title: 'Waste stretches',
    description: 'Every waste stretch, what led into it, and minutes until the next productive (multiplier > 0) block that day (blank = none).',
    columns: ['date', 'start', 'end', 'minutes', 'activities', 'led_by', 'return_min'],
    rows: waste.stretches.map((s) => [s.dateKey, blockHHMM(s.startIdx), blockHHMM(s.endIdx + 1), s.minutes, s.activityIds.map(actName).join(' + '), ctxName(s.ledBy), s.returnMinutes]),
  };

  if (inc.timeline) {
    const tl: Cell[][] = [];
    const taskOf = new Map(input.taskBlocks.map((b) => [`${b.date_key}_${b.block_index}`, b.task_id]));
    for (const k of dateKeys) {
      const dayB = rangeBlocks.filter((b) => b.date_key === k && b.activity_id).sort((a, b) => a.block_index - b.block_index);
      let seg: { s: number; e: number; a: string; t: string | null } | null = null;
      const flush = () => { if (seg) tl.push([k, blockHHMM(seg.s), blockHHMM(seg.e + 1), (seg.e - seg.s + 1) * 10, actName(seg.a), inc.tasks && seg.t ? taskName(seg.t) : null]); };
      for (const b of dayB) {
        const t = b.task_id ?? taskOf.get(`${k}_${b.block_index}`) ?? null;
        if (seg && b.block_index === seg.e + 1 && b.activity_id === seg.a && t === seg.t) { seg.e = b.block_index; continue; }
        flush();
        seg = { s: b.block_index, e: b.block_index, a: b.activity_id!, t };
      }
      flush();
    }
    tables.timeline = { title: 'Timeline', description: 'Every tracked segment (adjacent identical blocks merged). Gaps between rows are untracked time.', columns: ['date', 'start', 'end', 'minutes', 'activity', 'task'], rows: tl };
  }

  if (inc.sleep) {
    tables.sleep = {
      title: 'Sleep',
      description: 'One row per night with tracked sleep. score is 0-100 (duration, continuity, regularity, rating). quality/energy are the user\'s 1-5 ratings.',
      columns: ['night', 'wake_date', 'total_min', 'main_min', 'bed', 'wake', 'efficiency_pct', 'wake_ups', 'nap_min', 'score', 'quality', 'energy', 'factors', ...(keepText ? ['notes'] : [])],
      rows: nights.filter((n) => n.totalMinutes > 0).map((n) => {
        const sc = nightByWake.get(n.wakeDate)?.score;
        return [
          n.nightDate, n.wakeDate, n.totalMinutes, n.main?.sleepMinutes ?? null, n.main ? hhmm(relToClock(n.main.startRel)) : null, n.main ? hhmm(relToClock(n.main.endRel)) : null,
          n.main ? Math.round(n.main.efficiency * 100) : null, n.main?.wakeUps ?? null, n.napMinutes, sc?.score ?? null, n.quality, n.energy, n.factors.join(' ') || null,
          ...(keepText ? [n.notes] : []),
        ];
      }),
    };
  }

  if (inc.habits && input.habits.length) {
    tables.habits = {
      title: 'Habits',
      description: 'Streaks and rates over the app\'s 90-day window ending today; done_in_period counts logs inside the export range.',
      columns: ['habit', 'schedule', 'done_in_period', 'current_streak', 'longest_streak', 'completion_rate_pct', 'rate_80pct_interval', 'strength'],
      rows: input.habits.map((h, i) => {
        const hl = { ...h, type: h.type ?? 'daily' };
        const st = computeHabitStats(hl, input.habitLogs, now);
        return [habitName(h, i), describeFrequency(hl), input.habitLogs.filter((l) => l.habit_id === h.id && inRange(l.date_key)).length, `${st.currentStreak} ${st.unit}`, `${st.longestStreak} ${st.unit}`, st.completionRate, st.rateLo !== null ? `${st.rateLo}-${st.rateHi}` : null, st.strength];
      }),
    };
  }

  if (inc.goals && input.goals.length) {
    const goalBlocks = input.blocks;
    tables.goals = {
      title: 'Goals',
      description: 'Hours on linked activities since each goal started. pace = recency-weighted hours/week.',
      columns: ['goal', 'status', 'hours', 'target_hours', 'target_date', 'pace_h_per_week', 'last_7_days_h', 'needed_h_per_week', 'weeks_to_target', ...(keepText ? ['description'] : [])],
      rows: input.goals.map((g, i) => {
        const p = getGoalPace(g, dailyMinutesFromBlocks(g, goalBlocks, now), now);
        return [goalName(g, i), g.status ?? 'active', r1(p.hours), p.targetHours, g.target_date ?? null, r1(p.currentWeekly), r1(p.lastWeek), r1(p.requiredWeekly), r1(p.weeksToTarget), ...(keepText ? [g.description ?? null] : [])];
      }),
    };
  }

  if (inc.tasks) {
    const trackedByTask = new Map<string, number>();
    for (const b of input.taskBlocks) trackedByTask.set(b.task_id, (trackedByTask.get(b.task_id) ?? 0) + 10);
    const timerByTask = new Map<string, number>();
    for (const s of input.sessions) if (s.task_id) timerByTask.set(s.task_id, (timerByTask.get(s.task_id) ?? 0) + s.duration_minutes);
    const relevant = input.tasks.filter((t) => inRange(t.date_key) || (t.completed_at && inRange(format(new Date(t.completed_at), 'yyyy-MM-dd'))));
    tables.tasks = {
      title: 'Tasks',
      description: 'Tasks dated in the period or completed in it. tracked = all-time minutes of blocks linked to the task.',
      columns: ['task', 'activity', 'date', 'completed', 'completed_on', 'estimate_min', 'tracked_min', 'timer_min', 'deadline', 'on_time', 'urgent', 'important'],
      rows: relevant.map((t) => {
        let onTime: boolean | null = null;
        if (t.deadline && t.completed_at) {
          const due = isDateOnlyDeadline(t.deadline) ? new Date(`${getDeadlineDateKey(t.deadline)}T23:59:59`) : new Date(t.deadline);
          onTime = new Date(t.completed_at).getTime() <= due.getTime();
        }
        return [taskName(t.id), actName(t.activity_id), t.date_key ?? null, t.completed, t.completed_at ? format(new Date(t.completed_at), 'yyyy-MM-dd') : null, getEstimatedMinutes(t), trackedByTask.get(t.id) ?? 0, timerByTask.get(t.id) ?? 0, t.deadline ?? null, onTime, !!t.urgency, !!t.importance];
      }),
    };
  }

  if (keepText) {
    const revs = input.reviews.filter((r) => (r.period_type === 'day' && inRange(r.period_key)) || (r.period_type !== 'day' && r.period_key >= fromKey.slice(0, 7) && r.period_key <= toKey));
    if (revs.length) {
      tables.reflections = {
        title: 'Reflections',
        description: 'The user\'s own written reviews (day, week or month).',
        columns: ['period', 'key', 'energy', 'what_happened', 'planned', 'what_changed', 'carry_over', 'notes'],
        rows: revs.map((r) => [r.period_type, r.period_key, r.energy ?? null, r.happened ?? null, r.planned ?? null, r.changed ?? null, r.carry_over ?? null, r.notes ?? null]),
      };
    }
  }

  // Backend analytics layer for the same range (the numbers the Analytics screens read), names resolved/anonymised here
  if (inc.analytics && input.backend) {
    const be = input.backend;
    const habitIdx = new Map(input.habits.map((h, i) => [h.id, i]));
    const goalIdx = new Map(input.goals.map((g, i) => [g.id, i]));
    tables.analytics_daily = {
      title: 'Analytics: daily',
      description: 'The backend accounting layer, one row per day (same period as above). attention_points = judged minutes x focus demand / 5; attention_efficiency = productivity_points / attention_points. Blank = not computable that day.',
      columns: ['date', 'elapsed_min', 'tracked_min', 'untracked_min', 'coverage_pct', 'judged_min', 'ignored_min', 'sleep_min', 'productivity_points', 'productivity_score', 'attention_points', 'attention_efficiency', 'waste_min', 'waste_points', 'waste_share_pct', 'switches', 'cross_switches', 'switches_per_h', 'longest_run_min', 'mean_run_min', 'task_focus_min', 'tasks_completed', 'goal_min'],
      rows: be.daily.map((d) => [d.date_key, d.elapsed_minutes, d.tracked_minutes, d.untracked_minutes, r1(d.coverage_pct), d.judged_minutes, d.ignored_minutes, d.sleep_minutes, r2(d.productivity_points), r2(d.productivity_score), r2(d.attention_points), r2(d.attention_efficiency), d.waste_minutes, r2(d.waste_points), r1(d.waste_share_pct), d.switch_count, d.cross_switch_count, r1(d.switches_per_hour), d.longest_run_minutes, r1(d.mean_run_minutes), d.task_focus_minutes, d.tasks_completed, d.goal_minutes]),
    };
    tables.analytics_activity = {
      title: 'Analytics: per activity per day',
      description: 'One row per activity per day with time. focus_demand_points is judged minutes x focus demand (0-5).',
      columns: ['date', 'activity', 'minutes', 'judged_min', 'ignored_min', 'productivity_points', 'productivity_score', 'focus_demand_points', 'waste_min', 'waste_points', 'runs', 'longest_run_min'],
      rows: be.activity.map((a) => [a.date_key, actName(a.activity_id), a.minutes, a.judged_minutes, a.ignored_minutes, r2(a.productivity_points), r2(a.productivity_score), r2(a.focus_demand_points), a.waste_minutes, r2(a.waste_points), a.run_count, a.longest_run_minutes]),
    };
    if (inc.goals) {
      tables.analytics_goals = {
        title: 'Analytics: per goal per day',
        description: 'Minutes on each goal per day and cumulative hours since the goal started.',
        columns: ['date', 'goal', 'goal_min', 'cumulative_h', 'linked_tasks', 'linked_habit_completions'],
        rows: be.goal.map((g) => [g.date_key, goalIdx.has(g.goal_id) ? goalName(input.goals[goalIdx.get(g.goal_id)!], goalIdx.get(g.goal_id)!) : 'Unknown goal', g.goal_minutes, r1(g.cumulative_hours), g.linked_task_count, g.linked_habit_completions]),
      };
    }
    if (inc.habits) {
      tables.analytics_habits = {
        title: 'Analytics: per habit per day',
        description: 'Whether each habit was due and completed each day.',
        columns: ['date', 'habit', 'due', 'completed', 'logs'],
        rows: be.habit.map((h) => [h.date_key, habitIdx.has(h.habit_id) ? habitName(input.habits[habitIdx.get(h.habit_id)!], habitIdx.get(h.habit_id)!) : 'Unknown habit', h.due, h.completed, h.log_count]),
      };
    }
    tables.analytics_transitions = {
      title: 'Analytics: activity transitions',
      description: 'How many times each activity was followed directly by another, per day.',
      columns: ['date', 'from', 'to', 'count'],
      rows: be.transition.map((t) => [t.date_key, actName(t.from_activity_id), actName(t.to_activity_id), t.transition_count]),
    };
  }

  // ── Insights (plain sentences computed from the engines) ──
  const w = focus.overall.window;
  const focusLines: string[] = [];
  if (w) {
    focusLines.push(`Peak focus window (model): ${formatWindow(w)}, score ${w.score} vs a typical working hour ${w.baseline}, ${w.confidence} confidence, reached deep focus on ${w.deepDayPct}% of ${w.sampleDays} working days.`);
    if (focus.secondary) focusLines.push(`Second window: ${formatWindow(focus.secondary)} (score ${focus.secondary.score}).`);
    for (const v of focus.variants) if (v.window) focusLines.push(`${v.label}: ${formatWindow(v.window)} (score ${v.window.score}).`);
  } else {
    focusLines.push(`No distinct peak focus window (${focus.activeDays} working days in range).`);
  }
  for (const r of af.rows.slice(0, 5)) {
    focusLines.push(`Focused on ${actName(r.id)}: ${mins(r.focusedMinutes)} in ${r.runs} runs over ${r.focusedDays} days; ${r.focusRatePct}% of its time was in 30+ min runs; half of it between ${r.core ? `${hhmm(r.core.startMin)} and ${hhmm(r.core.endMin)}` : '—'}.`);
  }
  if (hist.totalMinutes) focusLines.push(`Focus time by run length: ${hist.buckets.map((b) => `${b.label} ${b.sharePct}%`).join(', ')}.`);
  const hot = heat.cells.flatMap((row, d) => row.map((c, h) => ({ d, h, v: c.value, days: c.days }))).filter((c) => c.v !== null).sort((a, b) => (b.v as number) - (a.v as number)).slice(0, 3);
  if (hot.length) focusLines.push(`Deepest weekday hours: ${hot.map((c) => `${DOW[c.d]} ${hhmm(c.h * 60)} (${c.v}, ${c.days} days)`).join('; ')}.`);

  const wasteLines: string[] = [];
  if (!waste.hasWasteActivities) wasteLines.push('No activity has a negative multiplier, so waste is not measured.');
  else {
    wasteLines.push(`${mins(waste.totalMinutes)} of waste over ${waste.days} tracked days, in ${waste.stretches.length} stretches.`);
    for (const r of waste.rows.slice(0, 5)) wasteLines.push(`${actName(r.id)} (x${r.multiplier}): ${mins(r.minutes)} on ${r.days} days, typical stretch ${mins(r.medianStretchMinutes)}, longest ${mins(r.longestStretchMinutes)}${r.core ? `, half between ${hhmm(r.core.startMin)} and ${hhmm(r.core.endMin)}` : ''}.`);
    for (const t of waste.triggers.filter((x) => x.ratePct !== null && (x.runs ?? 0) >= 3).sort((a, b) => (b.ratePct ?? 0) - (a.ratePct ?? 0)).slice(0, 5)) {
      wasteLines.push(`After ${ctxName(t.id)}: followed by waste ${t.ratePct}% of the time (80% interval ${t.lo}-${t.hi}%, ${t.count} of ${t.runs}).`);
    }
    const ctx = waste.triggers.filter((t) => t.runs === null);
    if (ctx.length) wasteLines.push(`Stretches starting after ${ctx.map((t) => `${ctxName(t.id)}: ${t.count}`).join(', ')}.`);
    if (waste.medianReturnMinutes !== null) wasteLines.push(`Typical return to productive work after a stretch: ${mins(waste.medianReturnMinutes)}; ${waste.noReturnPct}% of stretches had no productive work after them that day.`);
  }

  const patternLines: string[] = [];
  for (const l of flow.strongest) patternLines.push(`After ${actName(l.from)} → ${actName(l.to)} ${l.pct}% of the time (n=${l.count}).`);
  for (const r of flow.routines) patternLines.push(`Routine seen ${r.count}x: ${r.steps.map(actName).join(' → ')}.`);
  if (!patternLines.length) patternLines.push('Not enough repeated activity changes to report habits or routines.');

  const sleepLines: string[] = [];
  if (sleepFx) {
    for (const { metric, effect } of sleepFx.results) {
      if (effect.n === 0) continue;
      sleepLines.push(`${metric.label}: ${effect.verdict} (${effect.n} nights${effect.association.rho !== null ? `, rho ${r2(effect.association.rho)}` : ''}${effect.association.p !== null ? `, p ${r2(effect.association.p)}` : ''}); median after <7h ${effect.short.median !== null ? metric.fmt(effect.short.median) : '—'} (${effect.short.n}) vs 7h+ ${effect.other.median !== null ? metric.fmt(effect.other.median) : '—'} (${effect.other.n}).`);
    }
    for (const f of getFactorImpacts(nights)) {
      if (f.sleepDelta !== null) sleepLines.push(`Nights with "${f.factor}" (${f.withN}) vs without (${f.withoutN}): ${f.sleepDelta >= 0 ? '+' : ''}${Math.round(f.sleepDelta)} min sleep${f.qualityDelta !== null ? `, quality ${f.qualityDelta >= 0 ? '+' : ''}${r1(f.qualityDelta)}` : ''}.`);
    }
    if (!sleepLines.length) sleepLines.push('Not enough nights with tracked sleep to test.');
  }

  const goalLines: string[] = [];
  if (inc.goals) for (const row of tables.goals?.rows ?? []) goalLines.push(`${row[0]}: ${row[2]}h${row[3] ? ` of ${row[3]}h` : ''}, pace ${row[5]}h/week${row[7] !== null ? `, needs ${row[7]}h/week` : ''}.`);

  const taskLines: string[] = [];
  if (inc.tasks) {
    const est = estimationAccuracy(input.tasks.map((t) => ({ id: t.id, completed: t.completed, estimatedMinutes: getEstimatedMinutes(t), trackedMinutes: (input.taskBlocks.filter((b) => b.task_id === t.id).length) * 10, group: actName(t.activity_id) || 'No activity' })));
    if (est.overall?.multiplier) taskLines.push(`Tasks take ${r2(est.overall.multiplier)}x their estimate (80% interval ${r2(est.overall.lo)}-${r2(est.overall.hi)}x, ${est.overall.n} tasks); ${est.overall.overPct}% ran over.`);
    const rel = deadlineReliability(input.tasks.filter((t) => t.completed && t.deadline && t.completed_at).map((t) => ({
      dueAt: isDateOnlyDeadline(t.deadline!) ? new Date(`${getDeadlineDateKey(t.deadline!)}T23:59:59`) : new Date(t.deadline!),
      doneAt: new Date(t.completed_at!),
    })));
    if (rel.measured) taskLines.push(`Deadlines met ${rel.pctOnTime}% of the time (${rel.onTime}/${rel.measured}, 80% interval ${rel.lo}-${rel.hi}%).`);
    if (!taskLines.length) taskLines.push('Not enough completed tasks with estimates or deadlines to judge.');
  }

  const dq: string[] = [];
  dq.push(`${sCur.days} of ${len} days have any tracking; coverage ${sCur.coveragePct ?? '—'}% of elapsed time.`);
  const spots = blindSpots(gaps.cells, 3);
  if (spots.length) dq.push(`Least-tracked weekday hours: ${spots.map((s) => `${DOW[s.weekday]} ${hhmm(s.hour * 60)} (${s.untrackedPct}% untracked)`).join(', ')}.`);
  if (ignored.size > sleepIds.size) dq.push(`Ignored (never judged): ${[...ignored].filter((id) => !sleepIds.has(id)).map(actName).join(', ')}.`);
  if (sleepIds.size === 0) dq.push('No sleep activity is set, so sleep is not measured from the grid.');

  return {
    schema_version: EXPORT_SCHEMA_VERSION,
    meta: {
      app: 'TimeBloker', generated_at: now.toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      from: fromKey, to: toKey, days: len, days_with_tracking: sCur.days, anonymised: anon, included: inc,
      settings: { sleep_goal_hours: input.settings?.sleep_goal_hours ?? null, default_wake_time: input.settings?.default_wake_time ?? null, default_sleep_time: input.settings?.default_sleep_time ?? null },
    },
    definitions: DEFINITIONS,
    summary,
    insights: { focus: focusLines, waste: wasteLines, patterns: patternLines, sleep: sleepLines, goals: goalLines, tasks: taskLines, data_quality: dq },
    tables,
  };
};

// ─── Renderers ───────────────────────────────────────────────────────────────

const cellText = (c: Cell): string => (c === null || c === undefined ? '' : typeof c === 'boolean' ? (c ? 'yes' : 'no') : String(c));
const mdCell = (c: Cell) => cellText(c).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export const mdTable = (t: Table): string => {
  if (!t.rows.length) return '_No rows._\n';
  const head = `| ${t.columns.join(' | ')} |\n| ${t.columns.map(() => '---').join(' | ')} |\n`;
  return head + t.rows.map((r) => `| ${r.map(mdCell).join(' | ')} |`).join('\n') + '\n';
};

export type ExportDetail = 'compact' | 'full';

/** The AI pack: a brief for the model, definitions, insights and tables, in one markdown file. */
export const toMarkdown = (d: ExportData, detail: ExportDetail = 'full'): string => {
  const out: string[] = [];
  out.push(`# TimeBloker data: ${d.meta.from} to ${d.meta.to}`);
  out.push('');
  out.push('## Brief for the AI reading this');
  out.push(`This is a personal time-tracking export (${d.meta.days} days, ${d.meta.days_with_tracking} with tracking, timezone ${d.meta.timezone}${d.meta.anonymised ? ', names anonymised' : ''}). The user records their day in 10-minute blocks and wants an honest analysis.`);
  out.push('- Use only this data. Cite dates and numbers for every claim.');
  out.push('- Untracked time is unknown, not idle and not waste. Weigh conclusions by coverage (see Data quality).');
  out.push('- Treat correlations as associations, not causes. Respect "no clear change", "not enough days" and wide intervals.');
  out.push('- The metrics are defined below; use those meanings, not everyday ones.');
  out.push('- Be direct and specific. Prefer 3 strong findings over 10 weak ones, then suggest measurable experiments.');
  out.push('');
  out.push('### Questions to answer (unless the user asks something else)');
  QUESTIONS.forEach((q, i) => out.push(`${i + 1}. ${q}`));
  out.push('');
  out.push('## Definitions');
  for (const x of d.definitions) out.push(`- **${x.term}**: ${x.meaning}`);
  out.push('');
  const s = d.meta.settings;
  out.push('## Settings');
  out.push(`Sleep goal ${s.sleep_goal_hours ?? '—'} h; default wake ${s.default_wake_time ?? '—'}; default sleep ${s.default_sleep_time ?? '—'}.`);
  out.push('');
  out.push('## Summary (this period vs the previous period of equal length)');
  out.push(mdTable({ title: '', description: '', columns: ['metric', 'this_period', 'previous_period', 'change'], rows: d.summary.map((r) => [r.metric, r.this_period, r.previous_period, r.change]) }));
  const sections: [string, string[]][] = [
    ['Data quality', d.insights.data_quality], ['Focus', d.insights.focus], ['Waste', d.insights.waste], ['Patterns (what follows what)', d.insights.patterns],
    ['Sleep vs next day', d.insights.sleep], ['Goals', d.insights.goals], ['Tasks', d.insights.tasks],
  ];
  out.push('## Computed findings');
  for (const [title, lines] of sections) {
    if (!lines.length) continue;
    out.push(`### ${title}`);
    for (const l of lines) out.push(`- ${l}`);
    out.push('');
  }
  const order = ['days', 'activities', 'analytics_daily', 'sleep', 'habits', 'goals', 'tasks', 'analytics_activity', 'analytics_goals', 'analytics_habits', 'analytics_transitions', 'waste_stretches', 'focus_runs', 'timeline', 'reflections'];
  const skipCompact = new Set(['focus_runs', 'timeline', 'reflections', 'waste_stretches', 'analytics_activity', 'analytics_goals', 'analytics_habits', 'analytics_transitions']);
  out.push('## Data tables');
  for (const k of order) {
    const t = d.tables[k];
    if (!t || (detail === 'compact' && skipCompact.has(k))) continue;
    out.push(`### ${t.title}`);
    out.push(`_${t.description}_`);
    out.push('');
    out.push(mdTable(t));
  }
  if (detail === 'compact') out.push('_Compact export: the per-segment timeline, focus runs, waste stretches, per-activity/goal/habit/transition analytics and written reflections were left out. Export "Full" for them._');
  return out.join('\n');
};

export const toJSON = (d: ExportData): string => JSON.stringify(d, null, 1);

const csvCell = (c: Cell): string => {
  const s = cellText(c);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const tableToCSV = (t: Table): string => [t.columns.join(','), ...t.rows.map((r) => r.map(csvCell).join(','))].join('\n');

/** One CSV per table, plus the summary and findings, keyed by file name. */
export const toCSVs = (d: ExportData): Record<string, string> => {
  const files: Record<string, string> = {};
  for (const [k, t] of Object.entries(d.tables)) files[`${k}.csv`] = tableToCSV(t);
  files['summary.csv'] = tableToCSV({ title: '', description: '', columns: ['metric', 'this_period', 'previous_period', 'change'], rows: d.summary.map((r) => [r.metric, r.this_period, r.previous_period, r.change]) });
  files['findings.csv'] = tableToCSV({ title: '', description: '', columns: ['section', 'finding'], rows: Object.entries(d.insights).flatMap(([sec, lines]) => lines.map((l) => [sec, l])) });
  files['definitions.csv'] = tableToCSV({ title: '', description: '', columns: ['term', 'meaning'], rows: d.definitions.map((x) => [x.term, x.meaning]) });
  return files;
};

/** Rough token count (about 4 characters per token for English and numbers). Good enough to know if it fits. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

export const weekdayOf = (k: string) => DOW[getDay(parseISO(k))];
