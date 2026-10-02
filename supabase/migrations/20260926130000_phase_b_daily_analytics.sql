-- Phase B: canonical daily analytics (backend analytics workstream).
-- Additive and idempotent. Run this in the Supabase SQL editor, after the phase A
-- baseline migration (20260926120000_phase_a_analytics_baseline.sql).
--
-- Scope (see the Phase B plan): one deterministic row per (user_id, date_key) in
-- analytics_daily, computed by recompute_daily_analytics(). Deliberately excludes
-- focus/depth columns (focus_eligible_minutes, deep_focus_minutes, focus_quality,
-- focus_share_pct, sustained_share_pct) — those depend on focusModel.ts's warm-up
-- scoring, which stays in TypeScript. If that model is ever
-- ported, it belongs in its own versioned table (e.g. analytics_focus_daily with a
-- model_version column), not bolted onto this one.

-- ── Table ─────────────────────────────────────────────────────────────────────

create table if not exists public.analytics_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  date_key date not null,

  elapsed_minutes integer not null default 0,
  tracked_minutes integer not null default 0,
  judged_minutes integer not null default 0,
  ignored_minutes integer not null default 0,
  sleep_minutes integer not null default 0,
  untracked_minutes integer not null default 0,

  productivity_points numeric(14,2) not null default 0,
  productivity_score numeric(10,4),

  waste_minutes integer not null default 0,
  waste_points numeric(14,2) not null default 0,
  waste_share_pct numeric(10,4),

  switch_count integer not null default 0,
  cross_switch_count integer not null default 0,
  switches_per_hour numeric(10,4),

  coverage_pct numeric(10,4),

  longest_run_minutes integer,
  mean_run_minutes numeric(10,4),

  goal_minutes integer not null default 0,
  task_focus_minutes integer not null default 0,
  tasks_completed integer not null default 0,

  calculated_at timestamptz not null default now(),
  analytics_version integer not null default 1,

  primary key (user_id, date_key)
);

alter table public.analytics_daily enable row level security;

drop policy if exists "Users can read their own daily analytics" on public.analytics_daily;
create policy "Users can read their own daily analytics"
on public.analytics_daily
for select
to authenticated
using (auth.uid() = user_id);

-- recompute_daily_analytics() below is security invoker and upserts as the calling
-- user, so it needs write policies too, not just a read policy
-- suggested on its own.
drop policy if exists "Users can upsert their own daily analytics" on public.analytics_daily;
create policy "Users can upsert their own daily analytics"
on public.analytics_daily
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own daily analytics" on public.analytics_daily;
create policy "Users can update their own daily analytics"
on public.analytics_daily
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- ── Helper: sleep activity ids ──────────────────────────────────────────────
-- Mirrors src/lib/sleepActivity.ts exactly: explicit is_sleep_activity flags win
-- (all of them); otherwise fall back to one name-matched activity, preferring
-- category "Health" among non-archived matches, then any non-archived match,
-- then the earliest-created match.

create or replace function public.get_sleep_activity_ids(p_user_id uuid)
returns table(activity_id uuid)
language plpgsql
stable
security invoker
as $$
begin
  if exists (
    select 1 from public.activities
    where user_id = p_user_id and is_sleep_activity
  ) then
    return query
      select a.id from public.activities a
      where a.user_id = p_user_id and a.is_sleep_activity;
  else
    return query
      select a.id from public.activities a
      where a.user_id = p_user_id and a.name ilike '%sleep%'
      order by
        (a.category = 'Health' and not a.archived) desc,
        (not a.archived) desc,
        a.created_at asc
      limit 1;
  end if;
end;
$$;

-- ── Helper: session-covered blocks ───────────────────────────────────────────
-- Mirrors focusModel.ts's sessionBlocksByDay: walk 10-minute-aligned windows a
-- session overlaps, keep a block only when the overlap is >= 5 minutes. Dates and
-- block indices are computed in Asia/Kolkata local time (no per-user timezone
-- setting exists yet; see the phase A/B plan notes).

create or replace function public.get_session_covered_blocks(p_user_id uuid, p_date date)
returns table(block_index int)
language sql
stable
security invoker
as $$
  with sessions as (
    select
      started_at,
      started_at + (duration_minutes || ' minutes')::interval as ended_at_calc
    from public.task_focus_sessions
    where user_id = p_user_id
      and started_at < ((p_date + 1)::text || ' 00:00:00')::timestamp at time zone 'Asia/Kolkata'
      and started_at + (duration_minutes || ' minutes')::interval
        > (p_date::text || ' 00:00:00')::timestamp at time zone 'Asia/Kolkata'
  ),
  slots as (
    select
      s.started_at,
      s.ended_at_calc,
      gs.slot_start
    from sessions s
    cross join lateral generate_series(
      to_timestamp(floor(extract(epoch from s.started_at) / 600) * 600),
      s.ended_at_calc - interval '1 microsecond',
      interval '10 minutes'
    ) as gs(slot_start)
  )
  select distinct
    floor((
      extract(hour from (slot_start at time zone 'Asia/Kolkata')) * 60
      + extract(minute from (slot_start at time zone 'Asia/Kolkata'))
    ) / 10)::int as block_index
  from slots
  where (slot_start at time zone 'Asia/Kolkata')::date = p_date
    and least(ended_at_calc, slot_start + interval '10 minutes') - greatest(started_at, slot_start)
      >= interval '5 minutes'
$$;

-- ── Helper: tracked block coverage ───────────────────────────────────────────
-- Union of activity-assigned blocks and session-only blocks (no assigned activity,
-- but covered by a timer session) for one user/date. activity_id is null for the
-- session-only rows. Isolated here so timer/session semantics live in one place.

create or replace function public.get_daily_tracked_coverage(p_user_id uuid, p_date date)
returns table(block_index int, activity_id uuid)
language sql
stable
security invoker
as $$
  select tb.block_index, tb.activity_id
  from public.time_blocks tb
  where tb.user_id = p_user_id
    and tb.date_key = p_date
    and tb.activity_id is not null
  union all
  select sc.block_index, null::uuid
  from public.get_session_covered_blocks(p_user_id, p_date) sc
  where not exists (
    select 1 from public.time_blocks tb2
    where tb2.user_id = p_user_id
      and tb2.date_key = p_date
      and tb2.block_index = sc.block_index
      and tb2.activity_id is not null
  )
$$;

-- ── Canonical recompute ───────────────────────────────────────────────────────
-- Bounded to one date's <=144 blocks. Idempotent: upserts (user_id, date_key).

create or replace function public.recompute_daily_analytics(p_user_id uuid, p_date date)
returns void
language plpgsql
security invoker
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
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
  if p_date < v_today then
    v_elapsed_blocks := 144;
  elsif p_date > v_today then
    v_elapsed_blocks := 0;
  else
    v_elapsed_blocks := least(144, floor((
      extract(hour from (now() at time zone 'Asia/Kolkata')) * 60
      + extract(minute from (now() at time zone 'Asia/Kolkata'))
    ) / 10)::int);
  end if;

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
  -- whose window includes p_date (not summed per goal — Phase C's
  -- analytics_goal_daily is the exact per-goal breakdown).
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
end;
$$;

-- ── Range rebuild ─────────────────────────────────────────────────────────────
-- Backs "rebuild 7d/30d/1y/everything". Bounded by the caller's
-- chosen range; no implicit full-history scan.

create or replace function public.rebuild_analytics_range(p_user_id uuid, p_from date, p_to date)
returns void
language plpgsql
security invoker
as $$
declare
  v_date date;
begin
  v_date := p_from;
  while v_date <= p_to loop
    perform public.recompute_daily_analytics(p_user_id, v_date);
    v_date := v_date + 1;
  end loop;
end;
$$;

-- ── Range read ────────────────────────────────────────────────────────────────
-- The RPC read boundary: callers (the comparator now, screens in
-- a later phase) read through this, never the table shape directly.

create or replace function public.get_daily_analytics_range(p_user_id uuid, p_from date, p_to date)
returns setof public.analytics_daily
language sql
stable
security invoker
as $$
  select *
  from public.analytics_daily
  where user_id = p_user_id
    and date_key between p_from and p_to
  order by date_key;
$$;
