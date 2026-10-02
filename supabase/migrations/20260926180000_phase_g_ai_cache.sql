-- Phase G: AI Request Infrastructure

create table if not exists public.ai_analysis_cache (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  request_hash text not null,
  from_date date not null,
  to_date date not null,
  analysis_mode text not null,

  model text not null,
  analytics_version integer not null,
  prompt_version integer not null,
  data_version bigint,

  request_created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,

  status text not null default 'running',
  response jsonb,
  error_message text,

  unique (user_id, request_hash)
);

alter table public.ai_analysis_cache enable row level security;
create policy "Users can manage their own AI cache" on public.ai_analysis_cache for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
