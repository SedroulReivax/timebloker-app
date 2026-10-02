import { parseISO } from 'date-fns';
import { type DayProfile, type FocusSupplement } from './analysis';
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
 */
export function mapAnalyticsToProfiles(rows: AnalyticsDailyRow[], focusSupplement: Map<string, FocusSupplement> | null): DayProfile[] {
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
