import { format } from 'date-fns';
import type { RangeBlock } from './blockRange';
import { dailyValues, profileDays, type AnalysisActivity } from './analysis';
import type { FocusSession } from './focusModel';
import { getFocusByDate } from './insights';
import { analyzeSleepEffect, buildNights, type Night, type SleepEffect } from './sleepAnalysis';
import { formatMinutes } from './taskTime';
import { formatProductivity } from './activityFlags';

/**
 * Sleep vs the next day, shared by the Sleep/Patterns screens and the export. For every night with tracked sleep, pairs
 * the night's sleep with a measure of the following (finished) day, then runs the permutation-tested rank correlation
 * in analyzeSleepEffect, so chance patterns are not called findings.
 */

export const SHORT_SLEEP_MIN = 7 * 60;

export interface SleepMetric {
  id: 'deep' | 'timer' | 'coverage' | 'tasks' | 'waste' | 'productivity';
  label: string;
  fmt: (v: number) => string;
  pairs: { sleepMinutes: number; value: number; wakeDate: string }[];
}

export interface SleepEffectsInput {
  blocks: RangeBlock[];
  activities: AnalysisActivity[];
  sleepIds: Set<string>;
  sessions: (FocusSession & { task_id?: string | null })[];
  tasks: { completed: boolean; completed_at?: string | null }[];
}

export const analyzeSleepEffects = (
  input: SleepEffectsInput,
  nightKeys: string[],
  opts: { B?: number } = {}
): { nights: Night[]; results: { metric: SleepMetric; effect: SleepEffect }[] } => {
  const { blocks, activities, sleepIds, sessions, tasks } = input;
  const nights = buildNights(blocks.filter((b) => b.activity_id && sleepIds.has(b.activity_id)), nightKeys).filter((n) => n.totalMinutes > 0);
  const profiles = profileDays({ blocks, activities, sleepIds, sessions }, nights.map((n) => n.wakeDate));
  const profileByDay = new Map(profiles.map((p) => [p.dateKey, p]));
  const focusByDate = getFocusByDate(sessions);
  const anyCompletionTimes = tasks.some((t) => t.completed && t.completed_at);

  const metrics: SleepMetric[] = [
    { id: 'deep', label: 'Next-day deep focus', fmt: formatMinutes, pairs: [] },
    { id: 'timer', label: 'Next-day timer focus', fmt: formatMinutes, pairs: [] },
    { id: 'coverage', label: 'Next-day tracking coverage', fmt: (v) => `${Math.round(v)}%`, pairs: [] },
    { id: 'tasks', label: 'Next-day tasks completed', fmt: (v) => v.toFixed(1), pairs: [] },
    { id: 'waste', label: 'Next-day time waste', fmt: formatMinutes, pairs: [] },
    { id: 'productivity', label: 'Next-day productivity', fmt: (v) => formatProductivity(v), pairs: [] },
  ];
  const byId = Object.fromEntries(metrics.map((m) => [m.id, m])) as Record<SleepMetric['id'], SleepMetric>;
  const hasWaste = activities.some((a) => (a.productivity_multiplier ?? 0) < 0 && !a.analysis_ignored);
  const hasMultipliers = activities.some((a) => !!a.productivity_multiplier && !a.analysis_ignored);

  for (const n of nights) {
    const p = profileByDay.get(n.wakeDate);
    if (!p || !p.complete) continue; // only judge finished days
    const push = (m: SleepMetric, value: number | undefined) => { if (value !== undefined) m.pairs.push({ sleepMinutes: n.totalMinutes, value, wakeDate: n.wakeDate }); };
    if (p.assignedBlocks > 0) {
      push(byId.deep, dailyValues([p], 'deep')[0] ?? 0);
      push(byId.coverage, dailyValues([p], 'coverage')[0]);
      if (hasWaste) push(byId.waste, dailyValues([p], 'waste')[0]);
      if (hasMultipliers) push(byId.productivity, dailyValues([p], 'productivity')[0]);
    }
    if (focusByDate[n.wakeDate] !== undefined) push(byId.timer, focusByDate[n.wakeDate]);
    if (anyCompletionTimes) {
      push(byId.tasks, tasks.filter((t) => t.completed && t.completed_at && format(new Date(t.completed_at), 'yyyy-MM-dd') === n.wakeDate).length);
    }
  }
  return {
    nights,
    results: metrics
      .filter((m) => (m.id !== 'waste' || hasWaste) && (m.id !== 'productivity' || hasMultipliers))
      .map((m) => ({ metric: m, effect: analyzeSleepEffect(m.pairs, { thresholdMinutes: SHORT_SLEEP_MIN, B: opts.B ?? 600 }) })),
  };
};
