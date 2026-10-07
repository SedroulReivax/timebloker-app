import { format, parseISO } from 'date-fns';
import { elapsedBlocksFor, type DayProfile, type FocusSupplement } from './analysis';
import type { Database } from '../database.types';

type AnalyticsDailyRow = Database['public']['Tables']['analytics_daily']['Row'];

/**
 * Maps analytics_daily rows (the backend's deterministic canonical daily aggregate) into the
 * DayProfile shape every screen's presentation/comparison code already expects.
 *
 * analytics_daily deliberately excludes the focus-model fields (depthSum, deepBlocks, eligibleBlocks,
 * longestEligibleRun, runs, scores): they need the block sequence and live in focusModel.ts. The caller
 * states what it needs:
 *  - a screen that reads them passes `focusSupplement`, built by analysis.ts's focusSupplementByDate()
 *    over its bounded raw-block fetch of the same range;
 *  - a screen that reads none of them (Waste) passes null, and those fields are left at 0/[] for that
 *    caller only. `scores` (the per-block heatmap input) is never filled here; the heatmap reads raw
 *    profiles from profileDays.
 *
 * analytics_daily only has a row for days that were recomputed, so a day nothing was tracked on is missing entirely and would
 * drop out of coverage (Logged %) and untracked time, unlike Day, Focus and Patterns, which profile every date. Pass
 * `dateKeys` to fill those days with an empty profile (elapsed but nothing tracked). Days before the first row are left out:
 * time before tracking began is not a logging gap.
 */
export function mapAnalyticsToProfiles(
  rows: AnalyticsDailyRow[],
  focusSupplement: Map<string, FocusSupplement> | null,
  options: { dateKeys?: string[]; now?: Date } = {}
): DayProfile[] {
  const mapped = mapRows(rows, focusSupplement);
  if (!options.dateKeys || rows.length === 0) return mapped;
  const now = options.now ?? new Date();
  const have = new Set(rows.map((r) => r.date_key));
  const first = rows.reduce((m, r) => (r.date_key < m ? r.date_key : m), rows[0].date_key);
  const todayKey = format(now, 'yyyy-MM-dd');
  for (const dateKey of options.dateKeys) {
    if (have.has(dateKey) || dateKey < first) continue;
    const elapsedBlocks = elapsedBlocksFor(dateKey, now);
    if (elapsedBlocks === 0) continue;
    const supp = focusSupplement?.get(dateKey);
    mapped.push({
      dateKey,
      weekday: parseISO(dateKey).getDay(),
      elapsedBlocks,
      complete: dateKey < todayKey,
      assignedBlocks: 0, sleepBlocks: 0, awakeBlocks: 0, ignoredBlocks: 0, wasteBlocks: 0, wasteCost: 0,
      eligibleBlocks: supp?.eligibleBlocks ?? 0,
      depthSum: supp?.depthSum ?? 0,
      deepBlocks: supp?.deepBlocks ?? 0,
      longestEligibleRun: supp?.longestEligibleRun ?? 0,
      runs: supp?.runs ?? [],
      switches: 0, crossSwitches: 0, productivityBlocks: 0,
      scores: [],
    });
  }
  return mapped.sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0));
}

function mapRows(rows: AnalyticsDailyRow[], focusSupplement: Map<string, FocusSupplement> | null): DayProfile[] {
  return rows.map((d) => {
    const supp = focusSupplement?.get(d.date_key);
    return {
      dateKey: d.date_key,
      weekday: parseISO(d.date_key).getDay(),
      elapsedBlocks: Math.round(d.elapsed_minutes / 10),
      complete: d.elapsed_minutes >= 1440,
      assignedBlocks: Math.round(d.tracked_minutes / 10),
      sleepBlocks: Math.round(d.sleep_minutes / 10),
      awakeBlocks: Math.round(d.judged_minutes / 10),
      ignoredBlocks: Math.round(d.ignored_minutes / 10),
      wasteBlocks: Math.round(d.waste_minutes / 10),
      wasteCost: d.waste_points,
      eligibleBlocks: supp?.eligibleBlocks ?? 0,
      depthSum: supp?.depthSum ?? 0,
      deepBlocks: supp?.deepBlocks ?? 0,
      longestEligibleRun: supp?.longestEligibleRun ?? 0,
      runs: supp?.runs ?? [],
      switches: d.switch_count,
      crossSwitches: d.cross_switch_count,
      productivityBlocks: d.productivity_points / 10,
      scores: [],
    };
  });
}
