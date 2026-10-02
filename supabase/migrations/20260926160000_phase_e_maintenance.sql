-- Phase E: Recomputation scheduling, dirty dates, repair, observability

create table if not exists public.analytics_dirty_dates (
  user_id uuid not null references auth.users(id) on delete cascade,
  date_key date not null,
  reason text,
  first_marked_at timestamptz not null default now(),
  last_marked_at timestamptz not null default now(),
  attempts integer not null default 0,
  status text not null default 'dirty',
  primary key (user_id, date_key)
);

alter table public.analytics_dirty_dates enable row level security;
create policy "Users can manage their own dirty dates" on public.analytics_dirty_dates for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.analytics_runs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  run_type text not null,
  from_date date,
  to_date date,
  analytics_version integer not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  rows_processed integer,
  error_message text
);

alter table public.analytics_runs enable row level security;
create policy "Users can manage their own runs" on public.analytics_runs for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.analytics_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data_version bigint not null default 0,
  last_recompute_at timestamptz,
  analytics_version integer not null default 1
);

alter table public.analytics_state enable row level security;
create policy "Users can manage their own state" on public.analytics_state for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.mark_analytics_dirty(p_user_id uuid, p_date date, p_reason text)
returns void
language sql
security invoker
as $$
  insert into public.analytics_dirty_dates (user_id, date_key, reason)
  values (p_user_id, p_date, p_reason)
  on conflict (user_id, date_key) do update set
    last_marked_at = now(),
    reason = excluded.reason,
    status = 'dirty',
    attempts = 0;
$$;
