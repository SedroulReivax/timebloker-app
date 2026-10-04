-- Routines (repeated 3-, 4- and 5-step activity sequences) move from the browser to the backend.
-- Additive and idempotent. Run after 20261002130000_scope_activity_joins_to_owner.sql.
--
-- Before this, the Patterns screen fetched every raw time_blocks row in the range and found routines
-- in src/lib/flow.ts. Routines cannot be rebuilt from analytics_transition_daily's pairwise counts (an
-- A->B pair and a B->C pair on the same day do not say A->B->C happened in sequence), so this adds a
-- per-day table of sequence counts:
--
--   analytics_routine_daily        one row per (user, day, sequence of 3-5 activity ids)
--   get_daily_activity_routines()  the SQL port of flow.ts's buildChains + routineCountsFromChains
--   recompute_daily_analytics()    same as 20261002130000's version, plus delete+insert of the new rows
--   get_routine_analytics_range()  sums a range, keeps sequences seen 2+ times
--
-- The "drop a shorter routine contained in an equally common longer one" step depends on the range
-- totals, so it is not stored; the client applies it (flow.ts rankRoutines).
--
-- Chain rules, identical to get_daily_activity_transitions and flow.ts buildChains: sleep blocks are
-- removed first; a run is consecutive blocks of one activity, merging across untracked gaps under 3
-- blocks (30 min); a chain breaks when the gap between two runs is 3+ blocks; chains never cross a
-- date; the current day is cut at the elapsed block. Ignored activities (analysis_ignored) stay in, as
-- they are real routine steps. Every window of 3, 4 and 5 consecutive runs in a chain is one occurrence.
--
-- steps is a uuid[] and cannot carry a foreign key, so a deleted activity's sequences are not removed
-- by cascade like analytics_transition_daily's rows are. get_routine_analytics_range drops any sequence
-- with a step that is not one of the user's current activities instead (this also keeps the read scoped
-- to the owner's own activities, the same hardening as 20261002130000).
--
-- Existing days have no routine rows until recomputed: run rebuild_analytics_range over the account's
-- date range after applying (derived table, always safe to rebuild).

-- ── Table ───────────────────────────────────────────────────────────────────

create table if not exists public.analytics_routine_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  date_key date not null,
  steps uuid[] not null check (cardinality(steps) between 3 and 5),

  occurrences integer not null default 0,

  calculated_at timestamptz not null default now(),
  analytics_version integer not null default 2,
  model_version integer not null default 1,

  primary key (user_id, date_key, steps)
);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Owner-only select/insert/update/delete, same as the other analytics_* child tables
-- (recompute_daily_analytics is security invoker and deletes+inserts as the calling user).

alter table public.analytics_routine_daily enable row level security;

drop policy if exists "Users can read their own rows" on public.analytics_routine_daily;
create policy "Users can read their own rows" on public.analytics_routine_daily
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Users can insert their own rows" on public.analytics_routine_daily;
create policy "Users can insert their own rows" on public.analytics_routine_daily
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "Users can update their own rows" on public.analytics_routine_daily;
create policy "Users can update their own rows" on public.analytics_routine_daily
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own rows" on public.analytics_routine_daily;
create policy "Users can delete their own rows" on public.analytics_routine_daily
  for delete to authenticated using (auth.uid() = user_id);

-- ── Per-day sequence counts ─────────────────────────────────────────────────
-- own_blocks / runs_base / runs_grp / run_stats are the same as get_daily_activity_transitions.
-- chain_base starts a new chain where the gap after the previous run is 3+ blocks, which is
-- exactly where get_daily_activity_transitions declines to record a transition.

create or replace function public.get_daily_activity_routines(p_user_id uuid, p_date date)
returns table(
  steps uuid[],
  occurrences integer
)
language plpgsql
stable
security invoker
as $$
declare
  v_elapsed int := public.get_elapsed_blocks(p_date);
  v_sleep_ids uuid[];
begin
  select coalesce(array_agg(activity_id), array[]::uuid[])
  into v_sleep_ids
  from public.get_sleep_activity_ids(p_user_id);

  return query
  with own_blocks as (
    select tb.block_index, tb.activity_id
    from public.time_blocks tb
    where tb.user_id = p_user_id
      and tb.date_key = p_date
      and tb.block_index < v_elapsed
      and tb.activity_id is not null
      and not (tb.activity_id = any(v_sleep_ids))
  ),
  runs_base as (
    select
      block_index, activity_id,
      case
        when lag(activity_id) over (order by block_index) is distinct from activity_id
          or block_index - lag(block_index) over (order by block_index) >= 4
        then 1 else 0
      end as new_run
    from own_blocks
  ),
  runs_grp as (
    select block_index, activity_id, sum(new_run) over (order by block_index) as run_id
    from runs_base
  ),
  run_stats as (
    select
      run_id,
      (array_agg(activity_id))[1] as activity_id,
      min(block_index) as run_start,
      max(block_index) as run_end
    from runs_grp
    group by run_id
  ),
  chain_base as (
    select
      activity_id,
      run_start,
      case
        when lag(run_end) over (order by run_start) is null
          or run_start - lag(run_end) over (order by run_start) - 1 >= 3
        then 1 else 0
      end as new_chain
    from run_stats
  ),
  chain_grp as (
    select activity_id, run_start, sum(new_chain) over (order by run_start) as chain_id
    from chain_base
  ),
  chains as (
    select array_agg(activity_id order by run_start) as acts
    from chain_grp
    group by chain_id
  ),
  windows as (
    select c.acts[k - len + 1 : k] as seq
    from chains c
    cross join generate_series(3, 5) as len
    cross join lateral generate_series(len, cardinality(c.acts)) as k
  )
  select w.seq, count(*)::int
  from windows w
  group by w.seq;
end;
$$;

-- ── Extend recompute_daily_analytics() ──────────────────────────────────────
-- Identical to 20261002130000_scope_activity_joins_to_owner.sql's version except for the
-- analytics_routine_daily delete+insert after the transition rows. Same return type, so plain
-- create or replace. rebuild_analytics_range and the dirty-queue drain already call this.

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
      case when prev_run_end is not null and run_start - prev_run_end < 3 then 1 else 0 end as is_switch,
      case
        when prev_run_end is not null and run_start - prev_run_end < 3
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

-- ── Range read ──────────────────────────────────────────────────────────────
-- Unlike the other get_*_analytics_range functions this returns range totals, not per-day rows:
-- the screen only needs totals, and a 90-day range of per-day sequences would be far larger than
-- the summed set. Sequences seen once are left out (the client needs 2+), and so are sequences
-- with a step that is not one of the user's current activities (see the header).

create or replace function public.get_routine_analytics_range(p_user_id uuid, p_from date, p_to date)
returns table(
  steps uuid[],
  occurrences integer
)
language sql
stable
security invoker
as $$
  select r.steps, sum(r.occurrences)::int as occurrences
  from public.analytics_routine_daily r
  where r.user_id = p_user_id
    and r.date_key between p_from and p_to
    and r.steps <@ (
      select coalesce(array_agg(a.id), array[]::uuid[])
      from public.activities a
      where a.user_id = p_user_id
    )
  group by r.steps
  having sum(r.occurrences) >= 2
  order by sum(r.occurrences) desc, cardinality(r.steps) desc;
$$;
