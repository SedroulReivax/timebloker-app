-- Phase D: frontend migration (backend analytics workstream)
-- Create dashboard summary RPC returning jsonb

create or replace function public.get_dashboard_summary(p_user_id uuid, p_from date, p_to date)
returns jsonb
language sql
stable
security invoker
as $$
  with daily_stats as (
    select * from public.analytics_daily
    where user_id = p_user_id and date_key between p_from and p_to
  ),
  totals as (
    select
      count(*) as days,
      sum(tracked_minutes) as tracked_minutes,
      sum(elapsed_minutes) as elapsed_minutes,
      sum(judged_minutes) as judged_minutes,
      sum(productivity_points) as productivity_points,
      sum(waste_minutes) as waste_minutes,
      sum(waste_points) as waste_points,
      sum(goal_minutes) as goal_minutes,
      sum(tasks_completed) as tasks_completed
    from daily_stats
  ),
  top_acts as (
    select
      activity_id,
      sum(minutes) as total_minutes
    from public.analytics_activity_daily
    where user_id = p_user_id and date_key between p_from and p_to
    group by activity_id
    order by total_minutes desc
    limit 5
  ),
  top_gls as (
    select
      goal_id,
      sum(goal_minutes) as total_minutes
    from public.analytics_goal_daily
    where user_id = p_user_id and date_key between p_from and p_to
    group by goal_id
    order by total_minutes desc
    limit 5
  )
  select jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'totals', (
      select jsonb_build_object(
        'days', coalesce(t.days, 0),
        'tracked_minutes', coalesce(t.tracked_minutes, 0),
        'coverage_pct', case when t.elapsed_minutes > 0 then round((t.tracked_minutes::numeric / t.elapsed_minutes) * 100, 4) else null end,
        'productivity_score', case when t.judged_minutes > 0 then round(t.productivity_points / (t.judged_minutes), 4) else null end,
        'waste_minutes', coalesce(t.waste_minutes, 0),
        'waste_points', coalesce(t.waste_points, 0),
        'goal_minutes', coalesce(t.goal_minutes, 0),
        'tasks_completed', coalesce(t.tasks_completed, 0)
      )
      from totals t
    ),
    'daily', coalesce((select jsonb_agg(d.* order by d.date_key) from daily_stats d), '[]'::jsonb),
    'top_activities', coalesce((select jsonb_agg(a.*) from top_acts a), '[]'::jsonb),
    'top_goals', coalesce((select jsonb_agg(g.*) from top_gls g), '[]'::jsonb)
  );
$$;
