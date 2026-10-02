-- Phase C: activity/goal/habit/transition aggregates (backend analytics workstream,
-- additive and idempotent. Run this after the phase B migration
-- (20260926130000_phase_b_daily_analytics.sql). Does not touch any existing table's
-- data; the new child tables are empty until recompute_daily_analytics() is called.
--
-- Deliberately excludes analytics_activity_daily's suggested focus_demand_points /
-- focus_eligible_minutes / deep_minutes — same reasoning as
-- Phase B: they depend on focusModel.ts and a focus_demand concept that doesn't
-- exist yet (Phase F).
--
-- analytics_transition_daily replicates src/lib/flow.ts's run/chain algorithm
-- exactly (see get_daily_activity_transitions below): a run merges consecutive
-- same-activity blocks across gaps under 3 blocks (30 min); a transition between
-- two different runs is recorded only when the gap between them is also under 3
-- blocks; sleep blocks are excluded entirely, but ignored activities (e.g. Travel)
-- are not — they are real routine steps. It carries a model_version column
-- (separate from analytics_version) because it encodes that specific algorithm; a
-- deliberate change to the gap-tolerance rule should be distinguishable from a
-- silent overwrite.
--
-- Child tables use delete-then-insert per recompute, not upsert: unlike
-- analytics_daily (always exactly one row per day), each child table's row set for
-- a day can shrink as well as grow (an activity/goal/habit no longer touched that
-- day should not leave a stale row behind).

-- ── Shared helper: elapsed blocks for a date ────────────────────────────────────
-- Extracted from recompute_daily_analytics()'s inline calc so the four new per-day
-- helper functions below don't each duplicate it.

create or replace function public.get_elapsed_blocks(p_date date)
returns int
language sql
stable
as $$
  select case
    when p_date < (now() at time zone 'Asia/Kolkata')::date then 144
    when p_date > (now() at time zone 'Asia/Kolkata')::date then 0
    else least(144, floor((
      extract(hour from (now() at time zone 'Asia/Kolkata')) * 60
      + extract(minute from (now() at time zone 'Asia/Kolkata'))
    ) / 10)::int)
  end
$$;

-- ── Tables ───────────────────────────────────────────────────────────────────

create table if not exists public.analytics_activity_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  date_key date not null,
  activity_id uuid not null references public.activities(id) on delete cascade,

  minutes integer not null default 0,
  judged_minutes integer not null default 0,
  ignored_minutes integer not null default 0,

  productivity_points numeric(14,2) not null default 0,
  productivity_score numeric(10,4),

  waste_minutes integer not null default 0,
  waste_points numeric(14,2) not null default 0,

  run_count integer not null default 0,
  longest_run_minutes integer,

  calculated_at timestamptz not null default now(),
  analytics_version integer not null default 1,

  primary key (user_id, date_key, activity_id)
);

create table if not exists public.analytics_goal_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  date_key date not null,
  goal_id uuid not null references public.goals(id) on delete cascade,

  goal_minutes integer not null default 0,
  linked_habit_completions integer not null default 0,
  linked_task_count integer not null default 0,

  cumulative_minutes integer not null default 0,
  cumulative_hours numeric(12,2) not null default 0,

  calculated_at timestamptz not null default now(),
  analytics_version integer not null default 1,

  primary key (user_id, date_key, goal_id)
);

create table if not exists public.analytics_habit_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  date_key date not null,
  habit_id uuid not null references public.habits(id) on delete cascade,

  due boolean not null default false,
  completed boolean not null default false,
  log_count integer not null default 0,

  calculated_at timestamptz not null default now(),
  analytics_version integer not null default 1,

  primary key (user_id, date_key, habit_id)
);

create table if not exists public.analytics_transition_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  date_key date not null,
  from_activity_id uuid not null references public.activities(id) on delete cascade,
  to_activity_id uuid not null references public.activities(id) on delete cascade,

  transition_count integer not null default 0,

  calculated_at timestamptz not null default now(),
  analytics_version integer not null default 1,
  model_version integer not null default 1,

  primary key (user_id, date_key, from_activity_id, to_activity_id)
);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Owner-only select/insert/update/delete on all four (recompute_daily_analytics()
-- is security invoker and now deletes+inserts child rows as the calling user, so
-- it needs all four, not just select).

do $$
declare
  t text;
begin
  foreach t in array array[
    'analytics_activity_daily', 'analytics_goal_daily',
    'analytics_habit_daily', 'analytics_transition_daily'
  ] loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists "Users can read their own rows" on public.%I', t);
    execute format(
      'create policy "Users can read their own rows" on public.%I for select to authenticated using (auth.uid() = user_id)',
      t
    );

    execute format('drop policy if exists "Users can insert their own rows" on public.%I', t);
    execute format(
      'create policy "Users can insert their own rows" on public.%I for insert to authenticated with check (auth.uid() = user_id)',
      t
    );

    execute format('drop policy if exists "Users can update their own rows" on public.%I', t);
    execute format(
      'create policy "Users can update their own rows" on public.%I for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      t
    );

    execute format('drop policy if exists "Users can delete their own rows" on public.%I', t);
    execute format(
      'create policy "Users can delete their own rows" on public.%I for delete to authenticated using (auth.uid() = user_id)',
      t
    );
  end loop;
end;
$$;

-- ── Helper: per-activity breakdown for one day ──────────────────────────────────
-- "minutes" is every block assigned to the activity that day, regardless of
-- ignore/sleep status. judged_minutes/productivity/waste and the run stats are all
-- over the *judged* subset (same definition as recompute_daily_analytics's judged
-- CTE, minus the session sentinel: neither ignored nor sleep), grouped by
-- activity_id instead of summed across all of them, per the Phase C plan -- this
-- also matches src/lib/analysis.ts's `runs` array, which likewise only builds runs
-- over awake (judged) blocks and skips ignored/sleep activities entirely.

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
    coalesce(ra.run_count, 0) as run_count,
    ra.longest_run_blocks * 10 as longest_run_minutes
  from totals t
  left join public.activities a on a.id = t.activity_id
  left join judged_totals jt on jt.activity_id = t.activity_id
  left join run_agg ra on ra.activity_id = t.activity_id
$$;

-- ── Helper: per-goal progress for one day ───────────────────────────────────────
-- cumulative_minutes/cumulative_hours are recomputed by direct summation from the
-- goal's own start date through p_date every time, not a running total built on
-- the previous day's stored row (incremental delta accounting is deliberately avoided
-- accounting; a running total would also need every rebuild to proceed in strict
-- ascending date order to stay correct).

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
      g.linked_activity_ids::text[] as activity_ids,
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
      and ag.activity_ids is not null and tb.activity_id::text = any(ag.activity_ids)
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
      and ag.activity_ids is not null and tk.activity_id::text = any(ag.activity_ids)
    group by ag.goal_id
  ),
  cumulative as (
    select ag.goal_id, coalesce(count(distinct (tb2.date_key, tb2.block_index)), 0) * 10 as cumulative_minutes
    from active_goals ag
    left join public.time_blocks tb2
      on tb2.user_id = p_user_id
      and tb2.date_key between ag.start_date and p_date
      and (tb2.date_key < p_date or tb2.block_index < (select v from elapsed))
      and ag.activity_ids is not null and tb2.activity_id::text = any(ag.activity_ids)
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

-- ── Helper: per-habit status for one day ────────────────────────────────────────
-- "due" ports src/lib/habits.ts's isDueOn: weekdays-frequency habits are due only
-- on their selected weekdays (all days if none selected); event-type habits are
-- never "due" (no streak concept); everything else (daily/weekly/times_per_week) is
-- due every day, matching isDueOn's fallback. The streak/strength engine itself
-- stays in TypeScript (Rule D) and keeps reading habit_logs directly.

create or replace function public.get_daily_habit_status(p_user_id uuid, p_date date)
returns table(
  habit_id uuid,
  due boolean,
  completed boolean,
  log_count integer
)
language sql
stable
security invoker
as $$
  select
    h.id as habit_id,
    case
      when h.type = 'event' then false
      when h.frequency = 'weekdays' then
        case
          when h.weekdays is null or array_length(h.weekdays, 1) is null then true
          else extract(dow from p_date)::int = any(h.weekdays)
        end
      else true
    end as due,
    exists (
      select 1 from public.habit_logs hl
      where hl.habit_id = h.id and hl.user_id = p_user_id and hl.date_key = p_date
    ) as completed,
    coalesce((
      select count(*) from public.habit_logs hl
      where hl.habit_id = h.id and hl.user_id = p_user_id and hl.date_key = p_date
    ), 0)::int as log_count
  from public.habits h
  where h.user_id = p_user_id
$$;

-- ── Helper: activity transitions for one day ────────────────────────────────────
-- Faithful port of src/lib/flow.ts's run/chain algorithm (model_version 1). Unlike
-- Phase B's judged-block run detection, this only excludes null-activity blocks and
-- sleep; ignored activities (e.g. Travel) stay in as real nodes, and there is no
-- session pseudo-activity (flow.ts never considers timer sessions).
--
-- Runs: a new run starts whenever the activity differs from the immediately
-- preceding tracked block, or the gap between them is >= 4 blocks (i.e. >= 3 blocks
-- of nothing in between) -- equivalent to flow.ts's "i - last.end - 1 < GAP_BREAK"
-- extend rule, since after processing any tracked block, that block's own
-- (activity, block_index) always equals what flow.ts's `last` reflects at that
-- point (proven: last.a/last.end are updated to exactly the current block on both
-- the "extend" and "new run" paths).
-- Transitions: a pair (prev run's activity -> this run's activity) is recorded only
-- when the gap between the two runs is also < 3 blocks, mirroring flow.ts's chain
-- reset. Consecutive runs by construction always have different activities (same
-- activity within gap tolerance would already have merged into one run), so no
-- same-activity pairs are ever produced.

create or replace function public.get_daily_activity_transitions(p_user_id uuid, p_date date)
returns table(
  from_activity_id uuid,
  to_activity_id uuid,
  transition_count integer
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
  ordered_runs as (
    select
      activity_id,
      run_start,
      lag(activity_id) over (order by run_start) as prev_activity_id,
      lag(run_end) over (order by run_start) as prev_run_end
    from run_stats
  )
  select prev_activity_id as from_activity_id, activity_id as to_activity_id, count(*)::int as transition_count
  from ordered_runs
  where prev_activity_id is not null
    and run_start - prev_run_end - 1 < 3
  group by prev_activity_id, activity_id;
end;
$$;

-- ── Extend recompute_daily_analytics() ──────────────────────────────────────────
-- Same function as Phase B, with the elapsed-block calc now delegating to the
-- shared get_elapsed_blocks() helper (identical formula, no behavior change), plus
-- delete-then-insert of the four Phase C child tables at the end. One
-- mutation-triggered recompute still produces every derived row for that day
-- (Rule E). rebuild_analytics_range() needs no change -- it already loops this.

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

  -- Tracked coverage (activity-assigned blocks unioned with session-only blocks).
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

  -- "judged" (TS DayProfile's "awake") = tracked minus sleep minus ignored: real,
  -- non-ignored, non-sleep activity blocks PLUS session-only blocks (which carry
  -- no activity but still count as observed time, exactly like analysis.ts).
  v_judged_blocks := v_tracked_blocks - v_sleep_blocks - v_ignored_blocks;

  -- Judged rows for productivity/waste/run/switch stats. Session-only blocks act
  -- as a shared pseudo-activity (the sentinel uuid, category "Work", multiplier 0)
  -- so consecutive session-only blocks still form runs, matching analysis.ts's
  -- '__session__' pseudo-activity.
  with judged as (
    select
      c.block_index,
      coalesce(c.activity_id, v_session_sentinel) as run_key,
      coalesce(a.productivity_multiplier, 0) as multiplier
    from public.get_daily_tracked_coverage(p_user_id, p_date) c
    left join public.activities a on a.id = c.activity_id
    where c.block_index < v_elapsed_blocks
      -- c.activity_id is null for session-only blocks: "null = any(...)" is null,
      -- not false, so this must be guarded or those blocks are silently dropped.
      and (c.activity_id is null or not (c.activity_id = any(v_sleep_ids)))
      and not coalesce(a.analysis_ignored, false)
  ),
  runs_base as (
    select
      block_index,
      run_key,
      multiplier,
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
      sum(new_run) over (order by block_index) as run_id
    from runs_base
  ),
  run_stats as (
    select
      run_id,
      -- postgres has no min/max aggregate for uuid; run_key is constant within a
      -- run by construction, so grabbing any one value (via array_agg) is exact.
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
    coalesce(sum(case when j.multiplier < 0 then 10 else 0 end), 0),
    coalesce(round(sum(case when j.multiplier < 0 then -j.multiplier * 10 else 0 end), 2), 0),
    coalesce((select sum(is_switch) from switch_flags), 0),
    coalesce((select sum(is_cross_switch) from switch_flags), 0),
    (select max(run_blocks) * 10 from run_stats),
    (select avg(run_blocks) * 10 from run_stats)
  into
    v_productivity_points,
    v_waste_minutes,
    v_waste_points,
    v_switch_count,
    v_cross_switch_count,
    v_longest_run_blocks,
    v_mean_run_blocks
  from judged j;

  -- Coarse, day-level goal minutes: union of activity ids linked to any goal
  -- whose window includes p_date (not summed per goal -- analytics_goal_daily is
  -- the exact per-goal breakdown).
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
    -- cast to text: linked_activity_ids' element type may be text[] or uuid[]
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
    v_waste_minutes, v_waste_points,
    case when v_judged_blocks > 0 then round((v_waste_minutes::numeric / (v_judged_blocks * 10)) * 100, 4) else null end,
    v_switch_count, v_cross_switch_count,
    case when v_judged_blocks > 0 then round(v_switch_count / ((v_judged_blocks * 10) / 60.0), 4) else null end,
    case when v_elapsed_blocks > 0 then round((v_tracked_blocks::numeric / v_elapsed_blocks) * 100, 4) else null end,
    v_longest_run_blocks, v_mean_run_blocks,
    v_goal_minutes, v_task_focus_minutes, v_tasks_completed,
    now(), 1
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

  -- Phase C: per-activity/goal/habit/transition breakdown for this date.
  -- Delete-then-insert (not upsert): the row *set* for a day can shrink -- e.g. an
  -- activity no longer touched that day must not leave a stale row behind.
  delete from public.analytics_activity_daily where user_id = p_user_id and date_key = p_date;
  insert into public.analytics_activity_daily (
    user_id, date_key, activity_id, minutes, judged_minutes, ignored_minutes,
    productivity_points, productivity_score, waste_minutes, waste_points,
    run_count, longest_run_minutes, calculated_at, analytics_version
  )
  select p_user_id, p_date, b.activity_id, b.minutes, b.judged_minutes, b.ignored_minutes,
    b.productivity_points, b.productivity_score, b.waste_minutes, b.waste_points,
    b.run_count, b.longest_run_minutes, now(), 1
  from public.get_daily_activity_breakdown(p_user_id, p_date) b;

  delete from public.analytics_goal_daily where user_id = p_user_id and date_key = p_date;
  insert into public.analytics_goal_daily (
    user_id, date_key, goal_id, goal_minutes, linked_habit_completions, linked_task_count,
    cumulative_minutes, cumulative_hours, calculated_at, analytics_version
  )
  select p_user_id, p_date, g.goal_id, g.goal_minutes, g.linked_habit_completions, g.linked_task_count,
    g.cumulative_minutes, g.cumulative_hours, now(), 1
  from public.get_daily_goal_progress(p_user_id, p_date) g;

  delete from public.analytics_habit_daily where user_id = p_user_id and date_key = p_date;
  insert into public.analytics_habit_daily (
    user_id, date_key, habit_id, due, completed, log_count, calculated_at, analytics_version
  )
  select p_user_id, p_date, h.habit_id, h.due, h.completed, h.log_count, now(), 1
  from public.get_daily_habit_status(p_user_id, p_date) h;

  delete from public.analytics_transition_daily where user_id = p_user_id and date_key = p_date;
  insert into public.analytics_transition_daily (
    user_id, date_key, from_activity_id, to_activity_id, transition_count, calculated_at, analytics_version, model_version
  )
  select p_user_id, p_date, t.from_activity_id, t.to_activity_id, t.transition_count, now(), 1, 1
  from public.get_daily_activity_transitions(p_user_id, p_date) t;
end;
$$;

-- ── Range reads ──────────────────────────────────────────────────────────────
-- Mirrors get_daily_analytics_range: the RPC read boundary future callers (the
-- comparator now, screens in a later phase) go through, never the table directly.

create or replace function public.get_activity_analytics_range(p_user_id uuid, p_from date, p_to date)
returns setof public.analytics_activity_daily
language sql
stable
security invoker
as $$
  select * from public.analytics_activity_daily
  where user_id = p_user_id and date_key between p_from and p_to
  order by date_key, activity_id;
$$;

create or replace function public.get_goal_analytics_range(p_user_id uuid, p_from date, p_to date)
returns setof public.analytics_goal_daily
language sql
stable
security invoker
as $$
  select * from public.analytics_goal_daily
  where user_id = p_user_id and date_key between p_from and p_to
  order by date_key, goal_id;
$$;

create or replace function public.get_habit_analytics_range(p_user_id uuid, p_from date, p_to date)
returns setof public.analytics_habit_daily
language sql
stable
security invoker
as $$
  select * from public.analytics_habit_daily
  where user_id = p_user_id and date_key between p_from and p_to
  order by date_key, habit_id;
$$;

create or replace function public.get_transition_analytics_range(p_user_id uuid, p_from date, p_to date)
returns setof public.analytics_transition_daily
language sql
stable
security invoker
as $$
  select * from public.analytics_transition_daily
  where user_id = p_user_id and date_key between p_from and p_to
  order by date_key, from_activity_id, to_activity_id;
$$;
