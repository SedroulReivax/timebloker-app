-- Goal links with dates: a newly linked activity counts toward a goal from the day it was linked, and an unlinked one
-- keeps the days it already counted but stops after the day it was unlinked.
--
-- goals.linked_activity_ids stays "linked right now". goals.linked_activity_ranges records when each activity counted:
--   { "<activity_id>": { "since": "YYYY-MM-DD" | null, "until": "YYYY-MM-DD" | null } }
-- No entry means the goal's whole life, so every existing goal keeps exactly its current numbers. An activity counts on
-- date d when it is linked now (or has an "until"), d >= since (if set) and d <= until (if set). The rule lives once in
-- goal_activity_counts and mirrors activityCountsOn in src/lib/goals.ts.
--
-- Changed: get_daily_goal_progress (today / tasks / cumulative) and the goal_minutes statement in
-- recompute_daily_analytics (otherwise byte-for-byte 20261007120000_switch_same_activity). Return shapes are unchanged,
-- so create or replace is enough. Derived analytics are unchanged until rebuilt: run rebuild_analytics_range afterwards.

alter table public.goals add column if not exists linked_activity_ranges jsonb not null default '{}'::jsonb;

create or replace function public.goal_activity_counts(p_ranges jsonb, p_linked boolean, p_activity_id text, p_date date)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (coalesce(p_linked, false) or (coalesce(p_ranges, '{}'::jsonb) -> p_activity_id ->> 'until') is not null)
    and coalesce((coalesce(p_ranges, '{}'::jsonb) -> p_activity_id ->> 'since')::date <= p_date, true)
    and coalesce(p_date <= (coalesce(p_ranges, '{}'::jsonb) -> p_activity_id ->> 'until')::date, true)
$$;

create or replace function public.get_daily_goal_progress(p_user_id uuid, p_date date)
returns table(
  goal_id uuid,
  goal_minutes integer,
  linked_habit_completions integer,
  linked_task_count integer,
  cumulative_minutes integer,
  cumulative_hours numeric
)
language sql
stable
security invoker
as $$
  with elapsed as (select public.get_elapsed_blocks(p_date) as v),
  active_goals as (
    select
      g.id as goal_id,
      coalesce(g.linked_activity_ids::text[], '{}'::text[]) as activity_ids,
      g.linked_activity_ranges as ranges,
      g.linked_habit_ids::text[] as habit_ids,
      (g.created_at at time zone 'Asia/Kolkata')::date as start_date
    from public.goals g
    where g.user_id = p_user_id
      and (g.created_at at time zone 'Asia/Kolkata')::date <= p_date
      and (
        g.status is null or g.status = 'active'
        or (g.updated_at is not null and (g.updated_at at time zone 'Asia/Kolkata')::date >= p_date)
      )
  ),
  today_minutes as (
    select ag.goal_id, coalesce(count(distinct tb.block_index), 0) * 10 as goal_minutes
    from active_goals ag
    left join public.time_blocks tb
      on tb.user_id = p_user_id and tb.date_key = p_date
      and tb.block_index < (select v from elapsed)
      and public.goal_activity_counts(ag.ranges, tb.activity_id::text = any(ag.activity_ids), tb.activity_id::text, tb.date_key)
    group by ag.goal_id
  ),
  habit_completions as (
    select ag.goal_id, count(distinct hl.habit_id) as linked_habit_completions
    from active_goals ag
    left join public.habit_logs hl
      on hl.user_id = p_user_id and hl.date_key = p_date
      and ag.habit_ids is not null and hl.habit_id::text = any(ag.habit_ids)
    group by ag.goal_id
  ),
  task_counts as (
    select ag.goal_id, count(tk.id) as linked_task_count
    from active_goals ag
    left join public.tasks tk
      on tk.user_id = p_user_id and tk.date_key = p_date
      and public.goal_activity_counts(ag.ranges, tk.activity_id::text = any(ag.activity_ids), tk.activity_id::text, tk.date_key)
    group by ag.goal_id
  ),
  cumulative as (
    select ag.goal_id, coalesce(count(distinct (tb2.date_key, tb2.block_index)), 0) * 10 as cumulative_minutes
    from active_goals ag
    left join public.time_blocks tb2
      on tb2.user_id = p_user_id
      and tb2.date_key between ag.start_date and p_date
      and (tb2.date_key < p_date or tb2.block_index < (select v from elapsed))
      and public.goal_activity_counts(ag.ranges, tb2.activity_id::text = any(ag.activity_ids), tb2.activity_id::text, tb2.date_key)
    group by ag.goal_id
  )
  select
    ag.goal_id,
    coalesce(tm.goal_minutes, 0)::int,
    coalesce(hc.linked_habit_completions, 0)::int,
    coalesce(tc.linked_task_count, 0)::int,
    coalesce(cm.cumulative_minutes, 0)::int,
    round(coalesce(cm.cumulative_minutes, 0) / 60.0, 2)
  from active_goals ag
  left join today_minutes tm on tm.goal_id = ag.goal_id
  left join habit_completions hc on hc.goal_id = ag.goal_id
  left join task_counts tc on tc.goal_id = ag.goal_id
  left join cumulative cm on cm.goal_id = ag.goal_id
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
  join public.activities a on a.id = tb.activity_id and a.user_id = p_user_id
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
    left join public.activities a on a.id = c.activity_id and a.user_id = p_user_id
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
      case when prev_run_end is not null and run_start - prev_run_end < 3 and run_key is distinct from prev_run_key then 1 else 0 end as is_switch,
      case
        when prev_run_end is not null and run_start - prev_run_end < 3 and run_key is distinct from prev_run_key
          and (case when run_key = '00000000-0000-0000-0000-000000000000'
                 then 'Work' else coalesce((select category from public.activities where id = run_key and user_id = p_user_id), 'Uncategorized') end)
            is distinct from
              (case when prev_run_key = '00000000-0000-0000-0000-000000000000'
                 then 'Work' else coalesce((select category from public.activities where id = prev_run_key and user_id = p_user_id), 'Uncategorized') end)
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

  select count(distinct tb.block_index) * 10 into v_goal_minutes
  from public.time_blocks tb
  where tb.user_id = p_user_id and tb.date_key = p_date
    and tb.block_index < v_elapsed_blocks
    and exists (
      select 1
      from public.goals g
      where g.user_id = p_user_id
        and (g.created_at at time zone 'Asia/Kolkata')::date <= p_date
        and (
          g.status is null or g.status = 'active'
          or (g.updated_at is not null and (g.updated_at at time zone 'Asia/Kolkata')::date >= p_date)
        )
        and public.goal_activity_counts(
          g.linked_activity_ranges,
          tb.activity_id::text = any(coalesce(g.linked_activity_ids::text[], '{}'::text[])),
          tb.activity_id::text,
          p_date
        )
    );

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

  delete from public.analytics_routine_daily where user_id = p_user_id and date_key = p_date;
  insert into public.analytics_routine_daily (
    user_id, date_key, steps, occurrences, calculated_at, analytics_version, model_version
  )
  select p_user_id, p_date, r.steps, r.occurrences, now(), 2, 1
  from public.get_daily_activity_routines(p_user_id, p_date) r;

  insert into public.analytics_state (user_id, data_version, last_recompute_at, analytics_version)
  values (p_user_id, 1, now(), 2)
  on conflict (user_id) do update set
    last_recompute_at = now(),
    analytics_version = 2;
end;
$$;
