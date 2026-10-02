-- TimeBloker base schema: the raw tracking tables every later migration builds on.
--
-- These tables were first created by hand in the Supabase dashboard, so no earlier migration describes them.
-- This file is generated from that live schema (catalogue queries only, no data) so a fresh Supabase project
-- can be set up from the repository alone: apply every file in supabase/migrations in name order.
--
-- It holds the tables as they stood before the analytics migrations. Columns, constraints and indexes that a
-- later migration adds itself are left out here on purpose:
--   activities.analysis_ignored                       20260926120000_phase_a_analytics_baseline.sql
--   idx_* indexes on time_blocks, tasks, habit_logs,   20260926120000_phase_a_analytics_baseline.sql
--     task_focus_sessions, sleep_logs
--   activities.focus_demand (+ range check)            20260926170000_phase_f_attention.sql
--   reviews.energy (+ range check)                     20260928100000_review_energy.sql
--
-- Idempotent: create ... if not exists, policies dropped and recreated, the realtime publication guarded.
-- Every row belongs to one auth user and row-level security keeps each user to their own rows.

-- ── Activities: what a block of time is spent on ─────────────────────────────

create table if not exists public.activities (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  color text not null default '#3b82f6'::text,
  description text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  category text,
  emoji text,
  is_sleep_activity boolean not null default false,
  -- value of a minute on this activity, -5..+5 (negative = time waste); see lib/activityFlags.ts
  productivity_multiplier numeric not null default 0,
  constraint activities_pkey primary key (id),
  constraint activities_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade
);

-- ── Tasks ─────────────────────────────────────────────────────────────────────

create table if not exists public.tasks (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  title text not null,
  completed boolean not null default false,
  activity_id uuid,
  date_key date,
  urgency boolean,
  importance boolean,
  estimated_pomodoros integer not null default 1,
  completed_pomodoros integer not null default 0,
  created_at timestamptz not null default now(),
  description text,
  deadline timestamptz,
  recurrence_type text default 'none'::text,
  recurrence_rule text,
  estimated_minutes integer,
  completed_at timestamptz,
  constraint tasks_pkey primary key (id),
  constraint tasks_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade,
  constraint tasks_activity_id_fkey foreign key (activity_id) references public.activities(id) on delete set null,
  constraint tasks_estimated_minutes_check check (estimated_minutes is null or estimated_minutes > 0),
  constraint tasks_recurrence_type_check check (recurrence_type = any (array['none', 'daily', 'weekly', 'monthly', 'yearly', 'custom']))
);

-- ── Time blocks: one row per filled 10-minute block (block_index 0-143) ─────────

create table if not exists public.time_blocks (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  date_key date not null,
  block_index integer not null,
  activity_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  task_id uuid,
  constraint time_blocks_pkey primary key (id),
  constraint time_blocks_user_id_date_key_block_index_key unique (user_id, date_key, block_index),
  constraint time_blocks_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade,
  constraint time_blocks_activity_id_fkey foreign key (activity_id) references public.activities(id) on delete set null,
  constraint time_blocks_task_id_fkey foreign key (task_id) references public.tasks(id) on delete set null
);

create index if not exists time_blocks_task_id_idx on public.time_blocks (task_id) where task_id is not null;

-- ── Focus-timer sessions ──────────────────────────────────────────────────────

create table if not exists public.task_focus_sessions (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  task_id uuid,
  activity_id uuid,
  timer_type text not null default 'pomodoro'::text,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  duration_minutes integer not null,
  created_at timestamptz not null default now(),
  constraint task_focus_sessions_pkey primary key (id),
  constraint task_focus_sessions_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade,
  constraint task_focus_sessions_task_id_fkey foreign key (task_id) references public.tasks(id) on delete set null,
  constraint task_focus_sessions_activity_id_fkey foreign key (activity_id) references public.activities(id) on delete set null,
  constraint task_focus_sessions_duration_minutes_check check (duration_minutes >= 0),
  constraint task_focus_sessions_timer_type_check check (timer_type = any (array['pomodoro', 'stopwatch']))
);

create index if not exists task_focus_sessions_task_idx on public.task_focus_sessions (task_id);
create index if not exists task_focus_sessions_user_started_idx on public.task_focus_sessions (user_id, started_at desc);

-- ── Habits and their logs ─────────────────────────────────────────────────────

create table if not exists public.habits (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  type text not null default 'daily'::text,
  color text,
  description text,
  created_at timestamptz not null default now(),
  frequency text not null default 'daily'::text,
  target_count integer,
  weekdays smallint[],
  constraint habits_pkey primary key (id),
  constraint habits_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade,
  constraint habits_type_check check (type = any (array['daily', 'event'])),
  constraint habits_frequency_check check (frequency = any (array['daily', 'weekly', 'times_per_week', 'weekdays'])),
  constraint habits_target_count_check check (target_count is null or target_count > 0)
);

create table if not exists public.habit_logs (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  habit_id uuid not null,
  date_key date,
  logged_at timestamptz not null default now(),
  notes text,
  constraint habit_logs_pkey primary key (id),
  constraint habit_logs_habit_id_date_key_key unique (habit_id, date_key),
  constraint habit_logs_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade,
  constraint habit_logs_habit_id_fkey foreign key (habit_id) references public.habits(id) on delete cascade
);

-- ── Goals (links to activities and habits are id arrays) ──────────────────────

create table if not exists public.goals (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  title text not null,
  description text,
  target_date timestamptz,
  target_hours numeric,
  emoji text,
  status text default 'active'::text,
  linked_activity_ids text[] default '{}'::text[],
  linked_habit_ids text[] default '{}'::text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  completion_note text,
  constraint goals_pkey primary key (id),
  constraint goals_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade,
  constraint goals_status_check check (status = any (array['active', 'completed', 'abandoned']))
);

-- ── Sleep logs (one per night, keyed by the date the night starts) ─────────────

create table if not exists public.sleep_logs (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  date_key text not null,
  sleep_time text,
  wake_time text,
  total_minutes integer,
  quality integer,
  notes text,
  created_at timestamptz default now(),
  factors text[] not null default '{}'::text[],
  energy smallint,
  constraint sleep_logs_pkey primary key (id),
  constraint sleep_logs_user_id_date_key_key unique (user_id, date_key),
  constraint sleep_logs_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade,
  constraint sleep_logs_quality_check check (quality >= 1 and quality <= 5),
  constraint sleep_logs_energy_check check (energy is null or (energy >= 1 and energy <= 5))
);

-- ── Day / week / month reflections ────────────────────────────────────────────

create table if not exists public.reviews (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  period_type text not null,
  period_key text not null,
  planned text,
  happened text,
  changed text,
  carry_over text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reviews_pkey primary key (id),
  constraint reviews_user_id_period_type_period_key_key unique (user_id, period_type, period_key),
  constraint reviews_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade,
  constraint reviews_period_type_check check (period_type = any (array['day', 'week', 'month']))
);

-- ── Per-day stats (legacy, still read by the day view) and per-user settings ───

create table if not exists public.daily_stats (
  user_id uuid not null,
  date_key date not null,
  total_blocks_assigned integer not null default 0,
  sleep_minutes integer not null default 0,
  wake_time time,
  sleep_time time,
  constraint daily_stats_pkey primary key (user_id, date_key),
  constraint daily_stats_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade
);

create table if not exists public.user_settings (
  user_id uuid not null,
  default_wake_time text default '06:00'::text,
  default_sleep_time text default '23:00'::text,
  sleep_goal_hours numeric default 7.66,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  enable_animations boolean default false,
  constraint user_settings_pkey primary key (user_id),
  constraint user_settings_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade
);

-- ── Row-level security: every user sees and changes only their own rows ────────

alter table public.activities enable row level security;
alter table public.tasks enable row level security;
alter table public.time_blocks enable row level security;
alter table public.task_focus_sessions enable row level security;
alter table public.habits enable row level security;
alter table public.habit_logs enable row level security;
alter table public.goals enable row level security;
alter table public.sleep_logs enable row level security;
alter table public.reviews enable row level security;
alter table public.daily_stats enable row level security;
alter table public.user_settings enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['activities', 'tasks', 'time_blocks', 'habits', 'habit_logs', 'goals', 'sleep_logs', 'daily_stats', 'user_settings'] loop
    execute format('drop policy if exists %I on public.%I', 'own_' || t, t);
    execute format('create policy %I on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)', 'own_' || t, t);
  end loop;
end
$$;

drop policy if exists "own focus sessions select" on public.task_focus_sessions;
create policy "own focus sessions select" on public.task_focus_sessions for select using (auth.uid() = user_id);
drop policy if exists "own focus sessions insert" on public.task_focus_sessions;
create policy "own focus sessions insert" on public.task_focus_sessions for insert with check (auth.uid() = user_id);
drop policy if exists "own focus sessions update" on public.task_focus_sessions;
create policy "own focus sessions update" on public.task_focus_sessions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own focus sessions delete" on public.task_focus_sessions;
create policy "own focus sessions delete" on public.task_focus_sessions for delete using (auth.uid() = user_id);

drop policy if exists "own reviews select" on public.reviews;
create policy "own reviews select" on public.reviews for select using (auth.uid() = user_id);
drop policy if exists "own reviews insert" on public.reviews;
create policy "own reviews insert" on public.reviews for insert with check (auth.uid() = user_id);
drop policy if exists "own reviews update" on public.reviews;
create policy "own reviews update" on public.reviews for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own reviews delete" on public.reviews;
create policy "own reviews delete" on public.reviews for delete using (auth.uid() = user_id);

-- ── Realtime: the app refreshes when these tables change (e.g. on another device) ─

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['activities', 'tasks', 'time_blocks', 'habits', 'habit_logs', 'goals', 'sleep_logs', 'daily_stats', 'user_settings'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end
$$;
