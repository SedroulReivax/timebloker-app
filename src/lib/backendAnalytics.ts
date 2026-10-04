import { supabase } from '../supabaseClient';
import type { Database } from '../database.types';

export interface DashboardSummaryTotals {
  days: number;
  tracked_minutes: number;
  coverage_pct: number | null;
  productivity_score: number | null;
  waste_minutes: number;
  waste_points: number;
  goal_minutes: number;
  tasks_completed: number;
}

export interface DashboardSummaryResponse {
  range: { from: string; to: string };
  totals: DashboardSummaryTotals;
  daily: Database['public']['Tables']['analytics_daily']['Row'][];
  top_activities: { activity_id: string; total_minutes: number }[];
  top_goals: { goal_id: string; total_minutes: number }[];
}

export async function fetchDashboardSummary(
  from: string,
  to: string
): Promise<DashboardSummaryResponse> {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Not authenticated');

  const { data, error } = await supabase.rpc('get_dashboard_summary', {
    p_user_id: user.id,
    p_from: from,
    p_to: to,
  });

  if (error) {
    throw new Error(`Failed to fetch dashboard summary: ${error.message}`);
  }

  return data as unknown as DashboardSummaryResponse;
}

async function requireUserId(): Promise<string> {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error('Not authenticated');
  return user.id;
}

export async function fetchDailyAnalytics(from: string, to: string) {
  const userId = await requireUserId();
  const { data, error } = await supabase.rpc('get_daily_analytics_range', { p_user_id: userId, p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchActivityAnalytics(from: string, to: string) {
  const userId = await requireUserId();
  const { data, error } = await supabase.rpc('get_activity_analytics_range', { p_user_id: userId, p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchGoalAnalytics(from: string, to: string) {
  const userId = await requireUserId();
  const { data, error } = await supabase.rpc('get_goal_analytics_range', { p_user_id: userId, p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchHabitAnalytics(from: string, to: string) {
  const userId = await requireUserId();
  const { data, error } = await supabase.rpc('get_habit_analytics_range', { p_user_id: userId, p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchTransitionAnalytics(from: string, to: string) {
  const userId = await requireUserId();
  const { data, error } = await supabase.rpc('get_transition_analytics_range', { p_user_id: userId, p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  return data;
}

/** Range totals of repeated 3-5 step sequences (seen 2+ times), not per-day rows; see flow.ts rankRoutines. */
export async function fetchRoutineAnalytics(from: string, to: string) {
  const userId = await requireUserId();
  const { data, error } = await supabase.rpc('get_routine_analytics_range', { p_user_id: userId, p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchAnalyticsState(): Promise<{ data_version: number; analytics_version: number; last_recompute_at: string | null } | null> {
  const userId = await requireUserId();
  const { data, error } = await supabase.from('analytics_state').select('data_version, analytics_version, last_recompute_at').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}
