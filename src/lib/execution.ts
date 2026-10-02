// ─── Execution (Phase H, first slice) ────────────────────────────────────────
// How intentions (tasks, goals) turn into action, measured only from events the app actually stores:
// tasks.created_at / date_key / deadline / completed / completed_at / estimated_minutes, task-linked
// blocks and timer sessions, analytics_transition_daily and goal pace. Nothing here infers a hidden
// state; every result carries its sample size, and stages the data can't measure say so instead of
// reporting a zero.

import { differenceInCalendarDays, format, startOfWeek, subWeeks } from 'date-fns';
import { estimationAccuracy, type EstimationRow } from './analysis';
import { getDeadlineDateKey, isDateOnlyDeadline } from './deadlines';
import { median, quantile, theilSen, wilson } from './stats';
import { getExplicitEstimateMinutes } from './taskTime';

export interface ExecTask {
  id: string;
  created_at: string;
  date_key?: string | null;
  deadline?: string | null;
  completed: boolean;
  completed_at?: string | null;
  estimated_minutes?: number | null;
  estimated_pomodoros?: number | null;
}

/** Share with an 80% Wilson interval, as whole percentages. */
export interface Rate { pct: number | null; lo: number | null; hi: number | null; n: number }
const rate = (k: number, n: number): Rate => {
  const w = wilson(k, n);
  const r = (v: number | null) => (v === null ? null : Math.round(v * 100));
  return { pct: r(w.p), lo: r(w.lo), hi: r(w.hi), n };
};

const dueAtOf = (deadline: string): Date => {
  if (isDateOnlyDeadline(deadline)) {
    const [y, m, d] = getDeadlineDateKey(deadline).split('-').map(Number);
    return new Date(y, m - 1, d, 23, 59, 59, 999);
  }
  return new Date(deadline);
};

// ─── 1. Intention → outcome funnel ───────────────────────────────────────────

export interface FunnelStage {
  key: 'created' | 'scheduled' | 'worked' | 'completed' | 'onTime';
  label: string;
  count: number;
  /** conversion from the previous measurable stage (or from its own base for onTime) */
  conversion: Rate | null;
  /** false = the data can't measure this stage yet; `note` says why */
  measurable: boolean;
  note?: string;
}

/** Fewer task-linked tasks than this and "worked on" is a statement about logging habits, not execution. */
export const MIN_LINKED_TASKS = 5;

export const taskFunnel = (tasks: ExecTask[], linkedMinutes: Map<string, number>): FunnelStage[] => {
  const created = tasks.length;
  const scheduled = tasks.filter((t) => !!t.date_key).length;
  const linkedTasks = tasks.filter((t) => (linkedMinutes.get(t.id) ?? 0) > 0).length;
  const completed = tasks.filter((t) => t.completed).length;
  const timed = tasks.filter((t) => t.completed && t.deadline && t.completed_at);
  const onTime = timed.filter((t) => new Date(t.completed_at!).getTime() <= dueAtOf(t.deadline!).getTime()).length;

  const workedMeasurable = linkedTasks >= MIN_LINKED_TASKS;
  return [
    { key: 'created', label: 'Created', count: created, conversion: null, measurable: true },
    {
      key: 'scheduled', label: 'Given a day', count: scheduled, conversion: rate(scheduled, created), measurable: true,
      note: created > 0 && scheduled === created ? 'Every task gets a day when it is created, so nothing is lost here.' : undefined,
    },
    {
      key: 'worked', label: 'Worked on (time linked)', count: linkedTasks,
      conversion: workedMeasurable ? rate(linkedTasks, scheduled) : null, measurable: workedMeasurable,
      note: workedMeasurable ? undefined : `Only ${linkedTasks} task${linkedTasks === 1 ? ' has' : 's have'} any time linked to it (blocks assigned with a task, or a timer session). Until more do, this stage measures logging, not execution.`,
    },
    {
      key: 'completed', label: 'Completed', count: completed,
      conversion: rate(completed, workedMeasurable ? linkedTasks : scheduled), measurable: true,
      note: workedMeasurable ? undefined : 'Measured against tasks given a day, since the "worked on" stage is not measurable yet.',
    },
    {
      key: 'onTime', label: 'Done by the deadline', count: onTime, conversion: timed.length ? rate(onTime, timed.length) : null,
      measurable: timed.length > 0,
      note: timed.length
        ? `Out of ${timed.length} completed task${timed.length === 1 ? '' : 's'} that have both a deadline and a completion time.`
        : 'No completed task has both a deadline and a completion time yet.',
    },
  ];
};

/** Tracked + timer minutes per task. Blocks are 10 minutes each; timer sessions count their own duration. */
export const linkedMinutesByTask = (
  taskBlocks: { task_id: string }[],
  sessions: { task_id?: string | null; duration_minutes: number }[],
): Map<string, number> => {
  const m = new Map<string, number>();
  for (const b of taskBlocks) m.set(b.task_id, (m.get(b.task_id) ?? 0) + 10);
  for (const s of sessions) if (s.task_id) m.set(s.task_id, (m.get(s.task_id) ?? 0) + (s.duration_minutes || 0));
  return m;
};

// ─── 2. Task flow: arrivals vs completions (a queue) ─────────────────────────

export interface FlowWeek { weekStart: string; created: number; completed: number }
export interface TaskFlow {
  weeks: FlowWeek[];
  /** weeks since completion times started being recorded; only these compare arrivals with completions fairly */
  comparableWeeks: number;
  createdPerWeek: number | null;
  completedPerWeek: number | null;
  /** completed tasks without a completion time (recorded before completed_at existed): can't be placed in time */
  undatedCompletions: number;
  open: number;
  overdue: number;
  openAgeMedianDays: number | null;
  oldestOpenDays: number | null;
  ageBuckets: { label: string; count: number }[];
}

export const taskFlow = (tasks: ExecTask[], now: Date = new Date(), nWeeks = 8): TaskFlow => {
  const weekKey = (d: Date) => format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd');
  const thisWeek = startOfWeek(now, { weekStartsOn: 1 });
  const weeks: FlowWeek[] = [];
  for (let k = nWeeks - 1; k >= 0; k--) weeks.push({ weekStart: format(subWeeks(thisWeek, k), 'yyyy-MM-dd'), created: 0, completed: 0 });
  const byKey = new Map(weeks.map((w) => [w.weekStart, w]));
  for (const t of tasks) {
    const c = byKey.get(weekKey(new Date(t.created_at)));
    if (c) c.created++;
    if (t.completed && t.completed_at) {
      const d = byKey.get(weekKey(new Date(t.completed_at)));
      if (d) d.completed++;
    }
  }

  const firstCompletion = tasks.filter((t) => t.completed_at).map((t) => weekKey(new Date(t.completed_at!))).sort()[0] ?? null;
  const comparable = firstCompletion ? weeks.filter((w) => w.weekStart >= firstCompletion) : [];
  const perWeek = (f: (w: FlowWeek) => number) => (comparable.length ? comparable.reduce((a, w) => a + f(w), 0) / comparable.length : null);

  const open = tasks.filter((t) => !t.completed);
  const ages = open.map((t) => differenceInCalendarDays(now, new Date(t.created_at))).sort((a, b) => a - b);
  const overdue = open.filter((t) => t.deadline && dueAtOf(t.deadline).getTime() < now.getTime()).length;

  return {
    weeks,
    comparableWeeks: comparable.length,
    createdPerWeek: perWeek((w) => w.created),
    completedPerWeek: perWeek((w) => w.completed),
    undatedCompletions: tasks.filter((t) => t.completed && !t.completed_at).length,
    open: open.length,
    overdue,
    openAgeMedianDays: median(ages),
    oldestOpenDays: ages.length ? ages[ages.length - 1] : null,
    ageBuckets: [
      { label: 'under 1 week', count: ages.filter((a) => a < 7).length },
      { label: '1–4 weeks', count: ages.filter((a) => a >= 7 && a < 28).length },
      { label: '4+ weeks', count: ages.filter((a) => a >= 28).length },
    ],
  };
};

// ─── 3. Time to done ─────────────────────────────────────────────────────────

export interface TimeToDone { n: number; medianHours: number | null; p25Hours: number | null; p75Hours: number | null; sameDayPct: number | null }

export const timeToDone = (tasks: ExecTask[]): TimeToDone => {
  const done = tasks.filter((t) => t.completed && t.completed_at);
  const hours = done.map((t) => Math.max(0, (new Date(t.completed_at!).getTime() - new Date(t.created_at).getTime()) / 3_600_000));
  const sameDay = done.filter((t) => format(new Date(t.completed_at!), 'yyyy-MM-dd') === format(new Date(t.created_at), 'yyyy-MM-dd')).length;
  return {
    n: done.length,
    medianHours: median(hours),
    p25Hours: quantile(hours, 0.25),
    p75Hours: quantile(hours, 0.75),
    sameDayPct: done.length ? Math.round((sameDay / done.length) * 100) : null,
  };
};

// ─── 4. Estimate calibration by task size ────────────────────────────────────

export const SIZE_BUCKETS = [
  { label: 'Up to 30 min', max: 30 },
  { label: '31–90 min', max: 90 },
  { label: 'Over 90 min', max: Infinity },
] as const;

export interface Calibration {
  rows: EstimationRow[];
  /** completed tasks with an explicit estimate and 10+ linked minutes */
  usable: number;
  /** tasks whose only "estimate" is the pomodoro default: excluded, since it was never really estimated */
  defaultOnly: number;
}

/**
 * Tracked / estimated per size bucket. Only estimates the user actually made count (getExplicitEstimateMinutes):
 * `estimated_pomodoros` defaults to 1 on every new task, so a lone 1 would calibrate against a default.
 */
export const estimateCalibration = (tasks: ExecTask[], linkedMinutes: Map<string, number>): Calibration => {
  const explicit = tasks.map((t) => ({ t, est: getExplicitEstimateMinutes(t) })).filter((x): x is { t: ExecTask; est: number } => x.est !== null);
  const bucketOf = (m: number) => SIZE_BUCKETS.find((b) => m <= b.max)!.label;
  const res = estimationAccuracy(explicit.map(({ t, est }) => ({
    id: t.id, completed: t.completed, estimatedMinutes: est, trackedMinutes: linkedMinutes.get(t.id) ?? 0, group: bucketOf(est),
  })));
  const order = SIZE_BUCKETS.map((b) => b.label as string);
  return {
    rows: [...res.groups].sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label)),
    usable: res.overall?.n ?? 0,
    defaultOnly: tasks.length - explicit.length,
  };
};

// ─── 5. Day turbulence (transition entropy) ──────────────────────────────────

export interface TransitionRow { date_key: string; from_activity_id: string; to_activity_id: string; transition_count: number }
export interface TurbulenceDay {
  dateKey: string;
  switches: number;
  /** H(next | current) in bits over that day's switches; null under MIN_SWITCHES */
  entropyBits: number | null;
  /** 2^H: "after a switch you went to about this many different places" */
  choices: number | null;
}
export interface Bridge { activityId: string; outgoing: number; choices: number; top: { activityId: string; sharePct: number }[] }
export interface Turbulence { days: TurbulenceDay[]; medianChoices: number | null; medianSwitches: number | null; bridges: Bridge[] }

export const MIN_SWITCHES = 5;

const conditionalEntropy = (pairs: { from: string; to: string; n: number }[]): number | null => {
  const total = pairs.reduce((a, p) => a + p.n, 0);
  if (!total) return null;
  const byFrom = new Map<string, Map<string, number>>();
  for (const p of pairs) {
    const m = byFrom.get(p.from) ?? new Map<string, number>();
    m.set(p.to, (m.get(p.to) ?? 0) + p.n);
    byFrom.set(p.from, m);
  }
  let h = 0;
  for (const tos of byFrom.values()) {
    const nFrom = [...tos.values()].reduce((a, b) => a + b, 0);
    let hFrom = 0;
    for (const n of tos.values()) { const p = n / nFrom; hFrom -= p * Math.log2(p); }
    h += (nFrom / total) * hFrom;
  }
  return h;
};

/**
 * How predictable is what comes after a switch? Transitions are between runs (a switch, never A→A), from
 * analytics_transition_daily. Low entropy = the day's switches follow habitual paths; high = scattered.
 * Switch count and entropy are reported separately: many predictable switches are a different day from a
 * few scattered ones.
 */
export const dayTurbulence = (rows: TransitionRow[], dateKeys: string[]): Turbulence => {
  const inWindow = new Set(dateKeys);
  const byDay = new Map<string, { from: string; to: string; n: number }[]>();
  const all: { from: string; to: string; n: number }[] = [];
  for (const r of rows) {
    if (!inWindow.has(r.date_key) || r.transition_count <= 0) continue;
    const p = { from: r.from_activity_id, to: r.to_activity_id, n: r.transition_count };
    (byDay.get(r.date_key) ?? byDay.set(r.date_key, []).get(r.date_key)!).push(p);
    all.push(p);
  }
  const days: TurbulenceDay[] = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dateKey, pairs]) => {
    const switches = pairs.reduce((a, p) => a + p.n, 0);
    const h = switches >= MIN_SWITCHES ? conditionalEntropy(pairs) : null;
    return { dateKey, switches, entropyBits: h, choices: h === null ? null : 2 ** h };
  });

  // "Bridges": activities after which you scatter the most (needs 8+ outgoing switches to say anything)
  const out = new Map<string, Map<string, number>>();
  for (const p of all) {
    const m = out.get(p.from) ?? new Map<string, number>();
    m.set(p.to, (m.get(p.to) ?? 0) + p.n);
    out.set(p.from, m);
  }
  const bridges: Bridge[] = [...out.entries()].map(([activityId, tos]) => {
    const outgoing = [...tos.values()].reduce((a, b) => a + b, 0);
    const h = conditionalEntropy([...tos.entries()].map(([to, n]) => ({ from: activityId, to, n }))) ?? 0;
    const top = [...tos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, n]) => ({ activityId: id, sharePct: Math.round((n / outgoing) * 100) }));
    return { activityId, outgoing, choices: 2 ** h, top };
  }).filter((b) => b.outgoing >= 8).sort((a, b) => b.choices - a.choices).slice(0, 4);

  const choices = days.map((d) => d.choices).filter((v): v is number => v !== null);
  return { days, medianChoices: median(choices), medianSwitches: median(days.map((d) => d.switches)), bridges };
};

// ─── 6. Goal momentum (velocity + acceleration) ──────────────────────────────

export type MomentumState = 'accelerating' | 'steady' | 'slowing' | 'stalled' | 'too-early';
export interface Momentum {
  state: MomentumState;
  /** hours per week, recency-weighted (goal pace) */
  velocity: number;
  lastWeek: number;
  /** Theil-Sen slope of weekly hours: change in hours/week, per week; null under 4 complete weeks */
  accelerationPerWeek: number | null;
  /** IQR / median of weekly hours: >1 means weeks swing more than their typical size */
  volatility: number | null;
  weeks: number;
}

/** From getGoalPace's output. Momentum is relative to the goal's own typical week, never an absolute bar. */
export const goalMomentum = (pace: { currentWeekly: number; lastWeek: number; weeklyHistory: number[]; stalledDays: number | null }): Momentum => {
  const h = pace.weeklyHistory;
  const slope = h.length >= 4 ? theilSen(h) : null;
  const med = median(h);
  const q1 = quantile(h, 0.25), q3 = quantile(h, 0.75);
  const volatility = med && med > 0 && q1 !== null && q3 !== null ? (q3 - q1) / med : null;
  let state: MomentumState;
  if (pace.stalledDays !== null && pace.stalledDays >= 14) state = 'stalled';
  else if (slope === null) state = 'too-early';
  else {
    const rel = slope / Math.max(med ?? 0, 0.5);
    state = rel >= 0.15 ? 'accelerating' : rel <= -0.15 ? 'slowing' : 'steady';
  }
  return { state, velocity: pace.currentWeekly, lastWeek: pace.lastWeek, accelerationPerWeek: slope, volatility, weeks: h.length };
};
