// ─── Takeaways: each Analysis tab's numbers, said in a few plain sentences ───────
// Pure presentation over values the tabs already compute; nothing here measures anything new.
// One rule keeps it honest: a sentence only says "up" or "down" when the same interval-based comparison the
// change chips use (stats.compareSamples) says the difference is real. Otherwise it says "about the same", or
// leaves the comparison out when there are too few days to tell.

import type { ChangeResult } from './stats';
import { formatProductivity } from './activityFlags';
import { formatMinutes } from './taskTime';

export interface Takeaway {
  text: string;
  /** id of the Section that explains it; tapping the sentence opens that section */
  to?: string;
}

const MAX = 4;
type Maybe = Takeaway | null | undefined | false | '';
const take = (items: Maybe[], max = MAX): Takeaway[] => items.filter((t): t is Takeaway => !!t).slice(0, max);

/** "up" / "down" only when the comparison is real; "same" when there is enough data and no clear change; null when too thin. */
export const realChange = (c: ChangeResult | null | undefined): 'up' | 'down' | 'same' | null => {
  if (!c || !c.enough) return null;
  if (c.direction === 'flat' || c.delta === null) return 'same';
  return c.direction;
};

/** ", up 40m a day on the previous period" / ", about the same as the previous period" / "" */
export const changePhrase = (c: ChangeResult | null | undefined, fmt: (v: number) => string, versus = 'the previous period'): string => {
  const d = realChange(c);
  if (d === null) return '';
  if (d === 'same') return `, about the same as ${versus}`;
  return `, ${d} ${fmt(Math.abs(c!.delta!))} a day on ${versus}`;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

// ─── Day ──────────────────────────────────────────────────────────────────────

export interface DayTakeawayInput {
  isToday: boolean;
  trackedMinutes: number;
  coveragePct: number | null;
  topCategory: { name: string; minutes: number } | null;
  deepMinutes: number;
  focusQualityPct: number | null;
  productivityScore: number | null;
  hasMultipliers: boolean;
  wasteMinutes: number;
  topWaste: { name: string; minutes: number } | null;
  completedCount: number;
  openDueCount: number;
}

export const dayTakeaways = (d: DayTakeawayInput): Takeaway[] => {
  const soFar = d.isToday ? ' so far' : '';
  if (d.trackedMinutes === 0) {
    return [{ text: d.isToday ? 'Nothing logged yet today.' : 'Nothing was logged on this day.', to: 'day-timeline' }];
  }
  const logged: Takeaway = {
    text: `You logged ${formatMinutes(d.trackedMinutes)}${soFar}${d.coveragePct !== null ? ` (${d.coveragePct}% of the ${d.isToday ? 'day so far' : 'day'})` : ''}`
      + (d.topCategory ? `; most of it went to ${d.topCategory.name} (${formatMinutes(d.topCategory.minutes)}).` : '.'),
    to: 'day-summary',
  };
  const focus: Takeaway = d.deepMinutes > 0
    ? { text: `${formatMinutes(d.deepMinutes)} of deep focus${d.focusQualityPct !== null ? `, at ${d.focusQualityPct}% depth` : ''}.`, to: 'dv-runs' }
    : { text: 'No deep focus: no focus work ran 30 minutes or more without a break.', to: 'dv-runs' };
  const value: Maybe = d.hasMultipliers && d.productivityScore !== null && {
    text: `Productivity ${formatProductivity(d.productivityScore)}`
      + (d.wasteMinutes > 0 ? `; ${formatMinutes(d.wasteMinutes)} went to waste${d.topWaste ? `, mostly ${d.topWaste.name}` : ''}.` : ', with no waste.'),
    to: d.wasteMinutes > 0 ? 'dv-waste-stretches' : 'day-summary',
  };
  const tasks: Maybe = (d.completedCount > 0 || d.openDueCount > 0) && {
    text: [
      d.completedCount > 0 ? `${plural(d.completedCount, 'task')} done` : 'No tasks done',
      d.openDueCount > 0 ? `${d.openDueCount} due ${d.isToday ? 'today' : 'that day'} still open` : '',
    ].filter(Boolean).join('; ') + '.',
    to: 'day-review',
  };
  return take([logged, focus, value, tasks]);
};

// ─── Trends ───────────────────────────────────────────────────────────────────

export interface TrendsTakeawayInput {
  topCategory: { name: string; minutes: number } | null;
  untrackedPct: number | null;
  trackedPerDay: number | null;
  deepPerDay: number | null;
  productivityScore: number | null;
  changes: { tracked: ChangeResult | null; deep: ChangeResult | null; productivity: ChangeResult | null };
  attention: { configured: boolean; total: number; value: number; efficiency: number | null };
  tasksDone: number;
  tasksOpen: number;
}

export const trendsTakeaways = (t: TrendsTakeawayInput): Takeaway[] => {
  if (!t.topCategory) return [{ text: 'Nothing tracked in this range yet.', to: 'trends-over-time' }];
  const prod = realChange(t.changes.productivity);
  return take([
    {
      text: `${t.topCategory.name} took the most time (${formatMinutes(t.topCategory.minutes)})`
        + (t.untrackedPct !== null && t.untrackedPct > 0 ? `; ${t.untrackedPct}% of the time is unlogged.` : '.'),
      to: 'trends-distribution',
    },
    t.trackedPerDay !== null && {
      text: `You log about ${formatMinutes(Math.round(t.trackedPerDay))} a day${changePhrase(t.changes.tracked, formatMinutes)}.`,
      to: 'trends-over-time',
    },
    t.deepPerDay !== null && {
      text: `Deep focus averages ${formatMinutes(Math.round(t.deepPerDay))} a day${changePhrase(t.changes.deep, formatMinutes)}.`,
      to: 'trends-over-time',
    },
    (prod === 'up' || prod === 'down') && t.productivityScore !== null && {
      text: `Productivity is ${prod} (now ${formatProductivity(t.productivityScore)}), more than normal day-to-day swing.`,
      to: 'trends-productivity',
    },
    t.attention.configured && {
      text: `You spent ${Math.round(t.attention.total)} attention points for ${t.attention.value > 0 ? '+' : ''}${Math.round(t.attention.value)} points of value`
        + (t.attention.efficiency !== null ? ` (${t.attention.efficiency.toFixed(2)} per attention point).` : '.'),
      to: 'attention-budget',
    },
    { text: `${plural(t.tasksDone, 'task')} completed in this range, ${t.tasksOpen} still open.`, to: 'trends-planning' },
  ]);
};

// ─── Focus ────────────────────────────────────────────────────────────────────

export interface FocusTakeawayInput {
  /** formatted best window ("9:30–11:30"), or null when there is none yet */
  windowLabel: string | null;
  windowDays: number;
  windowTentative: boolean;
  deepPerDay: number | null;
  sustainedSharePct: number | null;
  /** label of the run-length bucket holding the most focus time, e.g. "30–60 min" */
  typicalStretch: string | null;
  focusQualityPct: number | null;
}

export const focusTakeaways = (f: FocusTakeawayInput): Takeaway[] => {
  if (f.deepPerDay === null && !f.windowLabel) return [{ text: 'No focus work in this range yet.', to: 'focus-runs' }];
  return take([
    f.windowLabel
      ? { text: `Your best focus window is ${f.windowLabel}${f.windowTentative ? ` (tentative: ${plural(f.windowDays, 'day')} of data)` : ''}.`, to: 'focus-peak' }
      : { text: 'Not enough focus days yet to find your best time of day.', to: 'focus-peak' },
    f.deepPerDay !== null && {
      text: `About ${formatMinutes(Math.round(f.deepPerDay))} of deep focus a day`
        + (f.sustainedSharePct !== null ? `; ${f.sustainedSharePct}% of your focus time comes in stretches of 30+ minutes.` : '.'),
      to: 'focus-runs',
    },
    f.typicalStretch && { text: `Most of your focus time comes in ${f.typicalStretch} stretches.`, to: 'focus-runs' },
    f.focusQualityPct !== null && { text: `Focus depth averages ${f.focusQualityPct}% (100% = fully warmed up, uninterrupted).`, to: 'focus-quality' },
  ]);
};

// ─── Waste ────────────────────────────────────────────────────────────────────

export interface WasteTakeawayInput {
  perDay: number | null;
  change: ChangeResult | null;
  top: { name: string; minutes: number } | null;
  totalMinutes: number;
  trigger: { name: string; ratePct: number } | null;
  /** clock label of the hour waste most often starts, e.g. "22:00" */
  peakStart: string | null;
  medianReturnMinutes: number | null;
  noReturnPct: number | null;
}

export const wasteTakeaways = (w: WasteTakeawayInput): Takeaway[] => {
  if (w.totalMinutes === 0 || w.perDay === null) return [{ text: 'No waste logged in this range.', to: 'waste-over-time' }];
  return take([
    { text: `About ${formatMinutes(Math.round(w.perDay))} a day goes to waste${changePhrase(w.change, formatMinutes)}.`, to: 'waste-over-time' },
    w.top && {
      text: `Most of it is ${w.top.name} (${Math.round((w.top.minutes / w.totalMinutes) * 100)}%)${w.peakStart ? `, usually starting around ${w.peakStart}` : ''}.`,
      to: 'waste-by-activity',
    },
    w.trigger && { text: `After ${w.trigger.name}, waste follows within 20 minutes ${w.trigger.ratePct}% of the time.`, to: 'waste-triggers' },
    w.medianReturnMinutes !== null && {
      text: `You're usually back to productive work about ${formatMinutes(w.medianReturnMinutes)} after a waste stretch`
        + (w.noReturnPct ? `; ${w.noReturnPct}% of stretches end the productive day.` : '.'),
      to: 'waste-longest',
    },
  ]);
};

// ─── Patterns ─────────────────────────────────────────────────────────────────

export interface PatternsTakeawayInput {
  strongest: { from: string; to: string; pct: number } | null;
  /** e.g. "Sundays around 14:00" */
  blindSpot: string | null;
  untrackedPct: number | null;
  notTrackedDays: number;
}

export const patternsTakeaways = (p: PatternsTakeawayInput): Takeaway[] => take([
  p.strongest
    ? { text: `After ${p.strongest.from}, you most often switch to ${p.strongest.to} (${p.strongest.pct}% of the time).`, to: 'patterns-flow' }
    : { text: 'Not enough activity changes yet to see what usually follows what.', to: 'patterns-flow' },
  p.blindSpot && { text: `Your biggest logging gap is ${p.blindSpot}.`, to: 'patterns-gaps' },
  p.untrackedPct !== null && {
    text: `${p.untrackedPct}% of the time on days you track is unlogged`
      + (p.notTrackedDays ? `, and ${plural(p.notTrackedDays, 'day')} had no tracking at all.` : '.'),
    to: 'patterns-gaps',
  },
]);

// ─── Execution ────────────────────────────────────────────────────────────────

export interface ExecutionTakeawayInput {
  /** measurable funnel stages after the first, in order */
  stages: { label: string; pct: number | null; measurable: boolean; note?: string }[];
  open: number;
  overdue: number;
  /** created minus completed per week; null without completion times */
  netPerWeek: number | null;
  stalledGoals: string[];
  medianHoursToDone: number | null;
}

export const executionTakeaways = (e: ExecutionTakeawayInput): Takeaway[] => {
  const measured = e.stages.filter((s) => s.measurable && s.pct !== null);
  const weakest = measured.length ? measured.reduce((a, b) => (b.pct! < a.pct! ? b : a)) : null;
  const unmeasured = e.stages.find((s) => !s.measurable);
  return take([
    {
      text: `${plural(e.open, 'open task')}${e.overdue ? `, ${e.overdue} past their deadline` : ', none overdue'}`
        + (e.netPerWeek === null ? '.' : e.netPerWeek > 0.5 ? `; the list grows by about ${e.netPerWeek.toFixed(1)} a week.`
          : e.netPerWeek < -0.5 ? `; the list shrinks by about ${(-e.netPerWeek).toFixed(1)} a week.` : '; about as many get done as get added.'),
      to: 'exec-flow',
    },
    weakest && { text: `The biggest drop-off is at "${lower(weakest.label)}": ${weakest.pct}% get there.`, to: 'exec-funnel' },
    unmeasured && { text: `"${unmeasured.label}" can't be measured yet${unmeasured.note ? ` (${lower(unmeasured.note)})` : ''}.`, to: 'exec-funnel' },
    e.medianHoursToDone !== null && {
      text: `A task typically takes ${e.medianHoursToDone < 24 ? `${Math.round(e.medianHoursToDone)} hours` : `${(e.medianHoursToDone / 24).toFixed(1)} days`} from created to done.`,
      to: 'exec-done',
    },
    e.stalledGoals.length > 0 && { text: `Stalled: ${e.stalledGoals.join(', ')}.`, to: 'exec-goals' },
  ]);
};

// ─── Review ───────────────────────────────────────────────────────────────────

export interface ReviewTakeawayInput {
  period: 'week' | 'month';
  trackedMinutes: number;
  deepMinutes: number;
  days: number;
  /** fmt carries its own unit, e.g. "40m/day", "+0.10 pts/min" */
  changes: { label: string; change: ChangeResult; fmt: (v: number) => string }[];
  busiest: { label: string; minutes: number } | null;
  energyMean: number | null;
  energyMax: number;
}

export const reviewTakeaways = (r: ReviewTakeawayInput): Takeaway[] => {
  const prev = r.period === 'week' ? 'last week' : 'last month';
  if (r.trackedMinutes === 0) return [{ text: `Nothing tracked this ${r.period} yet.`, to: 'review-days' }];
  const real = r.changes.filter((c) => { const d = realChange(c.change); return d === 'up' || d === 'down'; });
  const comparable = r.changes.some((c) => realChange(c.change) !== null);
  return take([
    { text: `This ${r.period}: ${formatMinutes(r.trackedMinutes)} logged over ${plural(r.days, 'day')}, ${formatMinutes(r.deepMinutes)} of it deep focus.`, to: 'review-days' },
    real.length
      ? {
        text: `Compared with ${prev}: ${real.map((c) => `${lower(c.label)} ${c.change.direction} ${c.fmt(Math.abs(c.change.delta!))}`).join(', ')}.`,
        to: 'review-numbers',
      }
      : { text: comparable ? `Nothing changed clearly compared with ${prev}.` : `Too few finished days to compare with ${prev} yet.`, to: 'review-numbers' },
    r.busiest && { text: `Busiest day: ${r.busiest.label} (${formatMinutes(r.busiest.minutes)} logged).`, to: 'review-days' },
    r.energyMean !== null && { text: `Energy averaged ${r.energyMean.toFixed(1)} out of ${r.energyMax}.`, to: 'review-energy' },
  ]);
};
