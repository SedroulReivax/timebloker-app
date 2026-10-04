-- Read-only verification script . read-only. Safe to run any time -- it never
-- mutates data. Paste the full result back when asked to confirm live schema state;
-- do not summarize it manually.
--
-- 1. Open Supabase -> SQL Editor.
-- 2. Create a new query, paste this whole file, run it.
-- 3. Paste the complete output back.

-- Which analytics tables exist, and how many rows each has for you.
select
  'analytics_daily' as table_name, count(*) as row_count from public.analytics_daily
union all select 'analytics_activity_daily', count(*) from public.analytics_activity_daily
union all select 'analytics_goal_daily', count(*) from public.analytics_goal_daily
union all select 'analytics_habit_daily', count(*) from public.analytics_habit_daily
union all select 'analytics_transition_daily', count(*) from public.analytics_transition_daily
union all select 'analytics_routine_daily', count(*) from public.analytics_routine_daily
union all select 'analytics_dirty_dates', count(*) from public.analytics_dirty_dates
union all select 'analytics_runs', count(*) from public.analytics_runs
union all select 'analytics_state', count(*) from public.analytics_state
union all select 'ai_analysis_cache', count(*) from public.ai_analysis_cache;

-- Which of the functions this plan depends on actually exist right now.
select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'get_sleep_activity_ids', 'get_session_covered_blocks', 'get_daily_tracked_coverage',
    'get_elapsed_blocks', 'get_daily_activity_breakdown', 'get_daily_goal_progress',
    'get_daily_habit_status', 'get_daily_activity_transitions', 'get_daily_activity_routines',
    'recompute_daily_analytics', 'rebuild_analytics_range', 'get_daily_analytics_range',
    'get_activity_analytics_range', 'get_goal_analytics_range', 'get_habit_analytics_range',
    'get_transition_analytics_range', 'get_routine_analytics_range', 'get_dashboard_summary',
    'mark_analytics_dirty', 'mark_activity_dates_dirty', 'mark_goal_dates_dirty',
    'process_dirty_analytics', 'process_dirty_analytics_for_user',
    'drain_all_dirty_analytics', 'repair_recent_analytics'
  )
order by routine_name;

-- Which indexes from the Phase A baseline actually exist.
select indexname
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'idx_time_blocks_user_date_block', 'idx_time_blocks_user_activity_date', 'idx_time_blocks_user_task_date',
    'idx_tasks_user_date', 'idx_tasks_user_completed_at', 'idx_tasks_user_deadline',
    'idx_habit_logs_user_habit_date', 'idx_habit_logs_user_date',
    'idx_focus_sessions_user_started', 'idx_focus_sessions_user_task_started',
    'idx_sleep_logs_user_date'
  )
order by indexname;

-- Column presence for the additive columns this plan depends on.
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'activities' and column_name in ('analysis_ignored', 'focus_demand'))
    or (table_name = 'analytics_daily' and column_name in ('attention_points', 'attention_efficiency'))
    or (table_name = 'analytics_activity_daily' and column_name = 'focus_demand_points')
    or (table_name = 'ai_analysis_cache' and column_name = 'prompt')
  )
order by table_name, column_name;

-- Dirty-queue and run-log snapshot (your own rows only, RLS-scoped).
select status, count(*) from public.analytics_dirty_dates group by status;
select run_type, status, count(*), max(started_at) as most_recent
from public.analytics_runs group by run_type, status order by most_recent desc nulls last;
select * from public.analytics_state;
