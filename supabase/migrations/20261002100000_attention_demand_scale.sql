-- Attention points on a 0-1 demand scale (analytics_version 2).
--
-- Before: attention_points = judged minutes x focus_demand (0-5), so an hour at full demand was 300 points and
-- attention_efficiency (productivity_points / attention_points) compared a -5..+5 value scale against a 0..300
-- attention scale: typical values sat around 0.05-0.3 and even the best possible activity (multiplier 1,
-- demand 5) scored only 0.2.
-- Now: attention_points = judged minutes x focus_demand / 5, i.e. demand is a 0-1 weight and an hour at full
-- demand is 60 points, the same unit as productivity points. Efficiency for a single activity is then
-- multiplier / (demand / 5): multiplier 0.8 at demand 5 = 0.8.
--
-- Changed, and nothing else:
--   get_daily_activity_breakdown.focus_demand_points  x focus_demand  ->  x focus_demand / 5
--   recompute_daily_analytics attention_points        same
--   attention_efficiency floor 30 -> 6 points: the same amount of attention as before (about 10 minutes at
--     demand 3), expressed in the new unit
--   analytics_version 1 -> 2 on every row recompute_daily_analytics writes, and on analytics_state, so rows on
--     the old formula are distinguishable and AI-brief cache keys (which include analytics_version) roll over.
-- Return shapes are unchanged, so `create or replace` applies in place. Rows already stored keep the old
-- formula until recomputed: run rebuild_analytics_range over the account's history after applying.
-- Derived tables only; no raw data is touched.

create or replace function public.get_daily_activity_breakdown(p_user_id uuid, p_date date)
returns table(
  activity_id uuid,
  minutes integer,
  judged_minutes integer,
  ignored_minutes integer,
  productivity_points numeric,
  productivity_score numeric,
  waste_minutes integer,
  waste_points numeric,
  focus_demand_points numeric,
  run_count integer,
  longest_run_minutes integer
)
language sql
stable
security invoker
as $$
  with sleep_ids as (
    select coalesce(array_agg(activity_id), array[]::uuid[]) as ids
    from public.get_sleep_activity_ids(p_user_id)
  ),
  own_blocks as (
    select tb.block_index, tb.activity_id
    from public.time_blocks tb
    where tb.user_id = p_user_id
      and tb.date_key = p_date
      and tb.activity_id is not null
      and tb.block_index < public.get_elapsed_blocks(p_date)
  ),
  judged_blocks as (
    select ob.block_index, ob.activity_id
    from own_blocks ob
    join public.activities a on a.id = ob.activity_id
    where not coalesce(a.analysis_ignored, false)
      and not (ob.activity_id in (select activity_id from public.get_sleep_activity_ids(p_user_id)))
  ),
  runs_base as (
    select
      block_index, activity_id,
      case
        when lag(activity_id) over (order by block_index) is distinct from activity_id
          or lag(block_index) over (order by block_index) is distinct from block_index - 1
        then 1 else 0
      end as new_run
    from judged_blocks
  ),
  runs_grp as (
    select block_index, activity_id, sum(new_run) over (order by block_index) as run_id
    from runs_base
  ),
  run_stats as (
    select run_id, (array_agg(activity_id))[1] as activity_id, count(*) as run_blocks
    from runs_grp
    group by run_id
  ),
  run_agg as (
    select activity_id, count(*) as run_count, max(run_blocks) as longest_run_blocks
    from run_stats
    group by activity_id
  ),
  totals as (
    select activity_id, count(*) as blocks
    from own_blocks
    group by activity_id
  ),
  judged_totals as (
    select activity_id, count(*) as blocks
    from judged_blocks
    group by activity_id
  )
  select
    t.activity_id,
    t.blocks * 10 as minutes,
    coalesce(jt.blocks, 0) * 10 as judged_minutes,
    case when coalesce(a.analysis_ignored, false) then t.blocks * 10 else 0 end as ignored_minutes,
    round(coalesce(jt.blocks, 0) * 10 * coalesce(a.productivity_multiplier, 0), 2) as productivity_points,
    case when coalesce(jt.blocks, 0) > 0 then a.productivity_multiplier else null end as productivity_score,
    case when coalesce(jt.blocks, 0) > 0 and coalesce(a.productivity_multiplier, 0) < 0 then jt.blocks * 10 else 0 end as waste_minutes,
    case when coalesce(jt.blocks, 0) > 0 and coalesce(a.productivity_multiplier, 0) < 0
      then round(jt.blocks * 10 * -a.productivity_multiplier, 2) else 0 end as waste_points,
    round(coalesce(jt.blocks, 0) * 10 * coalesce(a.focus_demand, 0) / 5.0, 2) as focus_demand_points,
    coalesce(ra.run_count, 0) as run_count,
    ra.longest_run_blocks * 10 as longest_run_minutes
  from totals t
  left join public.activities a on a.id = t.activity_id
  left join judged_totals jt on jt.activity_id = t.activity_id
  left join run_agg ra on ra.activity_id = t.activity_id
$$;

create or replace function public.recompute_daily_analytics(p_user_id uuid, p_date date)
returns void
language plpgsql
security invoker
as $$
declare
  v_elapsed_blocks int;
  v_sleep_ids uuid[];
  v_tracked_blocks int;
  v_sleep_blocks int;
  v_ignored_blocks int;
  v_judged_blocks int;
  v_productivity_points numeric;
  v_attention_points numeric;
  v_attention_efficiency numeric;
  v_waste_minutes int;
  v_waste_points numeric;
  v_switch_count int;
  v_cross_switch_count int;
  v_longest_run_blocks int;
  v_mean_run_blocks numeric;
  v_goal_minutes int;
  v_task_focus_minutes int;
  v_tasks_completed int;
  v_session_sentinel uuid := '00000000-0000-0000-0000-000000000000';
begin
  v_elapsed_blocks := public.get_elapsed_blocks(p_date);

  select coalesce(array_agg(activity_id), array[]::uuid[])
  into v_sleep_ids
  from public.get_sleep_activity_ids(p_user_id);

  select count(*) into v_tracked_blocks
  from public.get_daily_tracked_coverage(p_user_id, p_date) c
  where c.block_index < v_elapsed_blocks;

  select count(*) into v_sleep_blocks
  from public.time_blocks tb
  where tb.user_id = p_user_id and tb.date_key = p_date
    and tb.block_index < v_elapsed_blocks
    and tb.activity_id = any(v_sleep_ids);

  select count(*) into v_ignored_blocks
  from public.time_blocks tb
  join public.activities a on a.id = tb.activity_id
  where tb.user_id = p_user_id and tb.date_key = p_date
    and tb.block_index < v_elapsed_blocks
    and not (tb.activity_id = any(v_sleep_ids))
    and a.analysis_ignored;

  v_judged_blocks := v_tracked_blocks - v_sleep_blocks - v_ignored_blocks;

  with judged as (
    select
      c.block_index,
      coalesce(c.activity_id, v_session_sentinel) as run_key,
      coalesce(a.productivity_multiplier, 0) as multiplier,
      coalesce(a.focus_demand, 0) as focus_demand
    from public.get_daily_tracked_coverage(p_user_id, p_date) c
    left join public.activities a on a.id = c.activity_id
    where c.block_index < v_elapsed_blocks
      and (c.activity_id is null or not (c.activity_id = any(v_sleep_ids)))
      and not coalesce(a.analysis_ignored, false)
  ),
  runs_base as (
    select
      block_index,
      run_key,
      multiplier,
      focus_demand,
      case
        when lag(run_key) over (order by block_index) is distinct from run_key
          or lag(block_index) over (order by block_index) is distinct from block_index - 1
        then 1 else 0
      end as new_run
    from judged
  ),
  runs_grp as (
    select
      block_index,
      run_key,
      multiplier,
      focus_demand,
      sum(new_run) over (order by block_index) as run_id
    from runs_base
  ),
  run_stats as (
    select
      run_id,
      (array_agg(run_key))[1] as run_key,
      min(block_index) as run_start,
      count(*) as run_blocks
    from runs_grp
    group by run_id
  ),
  run_switches as (
    select
      run_start,
      run_key,
      run_blocks,
      lag(run_start + run_blocks) over (order by run_start) as prev_run_end,
      lag(run_key) over (order by run_start) as prev_run_key
    from run_stats
  ),
  switch_flags as (
    select
      case when prev_run_end is not null and run_start - prev_run_end < 3 then 1 else 0 end as is_switch,
      case
        when prev_run_end is not null and run_start - prev_run_end < 3
          and (case when run_key = '00000000-0000-0000-0000-000000000000'
                 then 'Work' else coalesce((select category from public.activities where id = run_key), 'Uncategorized') end)
            is distinct from
              (case when prev_run_key = '00000000-0000-0000-0000-000000000000'
                 then 'Work' else coalesce((select category from public.activities where id = prev_run_key), 'Uncategorized') end)
        then 1 else 0
      end as is_cross_switch
    from run_switches
  )
  select
    coalesce(sum(j.multiplier) * 10, 0),
    coalesce(sum(j.focus_demand) * 10 / 5.0, 0),
    coalesce(sum(case when j.multiplier < 0 then 10 else 0 end), 0),
    coalesce(round(sum(case when j.multiplier < 0 then -j.multiplier * 10 else 0 end), 2), 0),
    coalesce((select sum(is_switch) from switch_flags), 0),
    coalesce((select sum(is_cross_switch) from switch_flags), 0),
    (select max(run_blocks) * 10 from run_stats),
    (select avg(run_blocks) * 10 from run_stats)
  into
    v_productivity_points,
    v_attention_points,
    v_waste_minutes,
    v_waste_points,
    v_switch_count,
    v_cross_switch_count,
    v_longest_run_blocks,
    v_mean_run_blocks
  from judged j;

  v_attention_efficiency := case when v_attention_points >= 6 then round(v_productivity_points / v_attention_points, 4) else null end;

  with active_goal_activities as (
    select distinct unnest(g.linked_activity_ids) as activity_id
    from public.goals g
    where g.user_id = p_user_id
      and g.linked_activity_ids is not null
      and (g.created_at at time zone 'Asia/Kolkata')::date <= p_date
      and (
        g.status is null or g.status = 'active'
        or (g.updated_at is not null and (g.updated_at at time zone 'Asia/Kolkata')::date >= p_date)
      )
  )
  select count(distinct tb.block_index) * 10 into v_goal_minutes
  from public.time_blocks tb
  where tb.user_id = p_user_id and tb.date_key = p_date
    and tb.block_index < v_elapsed_blocks
    and tb.activity_id::text in (select activity_id::text from active_goal_activities);

  select coalesce(sum(duration_minutes), 0) into v_task_focus_minutes
  from public.task_focus_sessions
  where user_id = p_user_id
    and (started_at at time zone 'Asia/Kolkata')::date = p_date;

  select count(*) into v_tasks_completed
  from public.tasks
  where user_id = p_user_id
    and completed_at is not null
    and (completed_at at time zone 'Asia/Kolkata')::date = p_date;

  insert into public.analytics_daily as ad (
    user_id, date_key,
    elapsed_minutes, tracked_minutes, judged_minutes, ignored_minutes, sleep_minutes, untracked_minutes,
    productivity_points, productivity_score,
    attention_points, attention_efficiency,
    waste_minutes, waste_points, waste_share_pct,
    switch_count, cross_switch_count, switches_per_hour,
    coverage_pct,
    longest_run_minutes, mean_run_minutes,
    goal_minutes, task_focus_minutes, tasks_completed,
    calculated_at, analytics_version
  )
  values (
    p_user_id, p_date,
    v_elapsed_blocks * 10, v_tracked_blocks * 10, v_judged_blocks * 10, v_ignored_blocks * 10,
    v_sleep_blocks * 10, (v_elapsed_blocks - v_tracked_blocks) * 10,
    v_productivity_points,
    case when v_judged_blocks > 0 then round(v_productivity_points / (v_judged_blocks * 10), 4) else null end,
    v_attention_points, v_attention_efficiency,
    v_waste_minutes, v_waste_points,
    case when v_judged_blocks > 0 then round((v_waste_minutes::numeric / (v_judged_blocks * 10)) * 100, 4) else null end,
    v_switch_count, v_cross_switch_count,
    case when v_judged_blocks > 0 then round(v_switch_count / ((v_judged_blocks * 10) / 60.0), 4) else null end,
    case when v_elapsed_blocks > 0 then round((v_tracked_blocks::numeric / v_elapsed_blocks) * 100, 4) else null end,
    v_longest_run_blocks, v_mean_run_blocks,
    v_goal_minutes, v_task_focus_minutes, v_tasks_completed,
    now(), 2
  )
  on conflict (user_id, date_key) do update set
    elapsed_minutes = excluded.elapsed_minutes,
    tracked_minutes = excluded.tracked_minutes,
    judged_minutes = excluded.judged_minutes,
    ignored_minutes = excluded.ignored_minutes,
    sleep_minutes = excluded.sleep_minutes,
    untracked_minutes = excluded.untracked_minutes,
    productivity_points = excluded.productivity_points,
    productivity_score = excluded.productivity_score,
    attention_points = excluded.attention_points,
    attention_efficiency = excluded.attention_efficiency,
    waste_minutes = excluded.waste_minutes,
    waste_points = excluded.waste_points,
    waste_share_pct = excluded.waste_share_pct,
    switch_count = excluded.switch_count,
    cross_switch_count = excluded.cross_switch_count,
    switches_per_hour = excluded.switches_per_hour,
    coverage_pct = excluded.coverage_pct,
    longest_run_minutes = excluded.longest_run_minutes,
    mean_run_minutes = excluded.mean_run_minutes,
    goal_minutes = excluded.goal_minutes,
    task_focus_minutes = excluded.task_focus_minutes,
    tasks_completed = excluded.tasks_completed,
    calculated_at = excluded.calculated_at,
    analytics_version = excluded.analytics_version;

  delete from public.analytics_activity_daily where user_id = p_user_id and date_key = p_date;
  insert into public.analytics_activity_daily (
    user_id, date_key, activity_id, minutes, judged_minutes, ignored_minutes,
    productivity_points, productivity_score, waste_minutes, waste_points, focus_demand_points,
    run_count, longest_run_minutes, calculated_at, analytics_version
  )
  select p_user_id, p_date, b.activity_id, b.minutes, b.judged_minutes, b.ignored_minutes,
    b.productivity_points, b.productivity_score, b.waste_minutes, b.waste_points, b.focus_demand_points,
    b.run_count, b.longest_run_minutes, now(), 2
  from public.get_daily_activity_breakdown(p_user_id, p_date) b;

  delete from public.analytics_goal_daily where user_id = p_user_id and date_key = p_date;
  insert into public.analytics_goal_daily (
    user_id, date_key, goal_id, goal_minutes, linked_habit_completions, linked_task_count,
    cumulative_minutes, cumulative_hours, calculated_at, analytics_version
  )
  select p_user_id, p_date, g.goal_id, g.goal_minutes, g.linked_habit_completions, g.linked_task_count,
    g.cumulative_minutes, g.cumulative_hours, now(), 2
  from public.get_daily_goal_progress(p_user_id, p_date) g;

  delete from public.analytics_habit_daily where user_id = p_user_id and date_key = p_date;
  insert into public.analytics_habit_daily (
    user_id, date_key, habit_id, due, completed, log_count, calculated_at, analytics_version
  )
  select p_user_id, p_date, h.habit_id, h.due, h.completed, h.log_count, now(), 2
  from public.get_daily_habit_status(p_user_id, p_date) h;

  delete from public.analytics_transition_daily where user_id = p_user_id and date_key = p_date;
  insert into public.analytics_transition_daily (
    user_id, date_key, from_activity_id, to_activity_id, transition_count, calculated_at, analytics_version, model_version
  )
  select p_user_id, p_date, t.from_activity_id, t.to_activity_id, t.transition_count, now(), 2, 1
  from public.get_daily_activity_transitions(p_user_id, p_date) t;

  insert into public.analytics_state (user_id, data_version, last_recompute_at, analytics_version)
  values (p_user_id, 1, now(), 2)
  on conflict (user_id) do update set
    last_recompute_at = now(),
    analytics_version = 2;
end;
$$;
