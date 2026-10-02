import { describe, expect, it } from 'vitest';
import { mapAnalyticsToProfiles } from './backendAdapter';
import type { FocusSupplement } from './analysis';
import type { Database } from '../database.types';

type DailyRow = Database['public']['Tables']['analytics_daily']['Row'];

const row = (overrides: Partial<DailyRow> = {}): DailyRow => ({
  user_id: 'u1',
  date_key: '2026-09-21',
  elapsed_minutes: 1440,
  tracked_minutes: 600,
  judged_minutes: 500,
  ignored_minutes: 0,
  sleep_minutes: 480,
  untracked_minutes: 360,
  productivity_points: 250,
  productivity_score: 0.5,
  attention_points: 0,
  attention_efficiency: null,
  waste_minutes: 40,
  waste_points: 20,
  waste_share_pct: 8,
  switch_count: 5,
  cross_switch_count: 2,
  switches_per_hour: 0.6,
  coverage_pct: 42,
  longest_run_minutes: 120,
  mean_run_minutes: 60,
  goal_minutes: 30,
  task_focus_minutes: 90,
  tasks_completed: 1,
  calculated_at: '2026-09-21T00:00:00Z',
  analytics_version: 1,
  ...overrides,
} as DailyRow);

describe('mapAnalyticsToProfiles', () => {
  it('maps deterministic fields straight from the row', () => {
    const [p] = mapAnalyticsToProfiles([row()], null);
    expect(p.elapsedBlocks).toBe(144);
    expect(p.assignedBlocks).toBe(60);
    expect(p.sleepBlocks).toBe(48);
    expect(p.awakeBlocks).toBe(50);
    expect(p.wasteBlocks).toBe(4);
    expect(p.wasteCost).toBe(20);
    expect(p.switches).toBe(5);
    expect(p.crossSwitches).toBe(2);
    expect(p.productivityBlocks).toBe(25); // was hardcoded 0 before this fix
  });

  it('never falls back to the wrong backend column for focus-model fields: 0/[] without a supplement, not an approximation', () => {
    const [p] = mapAnalyticsToProfiles([row()], null);
    expect(p.eligibleBlocks).toBe(0); // was wrongly sourced from task_focus_minutes
    expect(p.longestEligibleRun).toBe(0); // was wrongly sourced from longest_run_minutes
    expect(p.depthSum).toBe(0);
    expect(p.deepBlocks).toBe(0);
    expect(p.runs).toEqual([]);
  });

  it('uses the supplement for a matched date instead of the defaults', () => {
    const supp = new Map<string, FocusSupplement>([
      ['2026-09-21', { depthSum: 12.5, deepBlocks: 6, eligibleBlocks: 10, longestEligibleRun: 18, runs: [{ activityId: 'a', category: 'Work', startIdx: 0, blocks: 18, eligible: true }] }],
    ]);
    const [p] = mapAnalyticsToProfiles([row()], supp);
    expect(p.eligibleBlocks).toBe(10);
    expect(p.longestEligibleRun).toBe(18);
    expect(p.depthSum).toBe(12.5);
    expect(p.deepBlocks).toBe(6);
    expect(p.runs).toHaveLength(1);
  });
});
