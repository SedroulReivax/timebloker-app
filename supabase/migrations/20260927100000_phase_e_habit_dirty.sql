-- Phase E completion: scoped invalidation for habit deletion, mirroring
-- mark_activity_dates_dirty's exact pattern (20260926190000_phase_ef_worker_and_attention.sql).
-- Additive only -- new function, no existing objects touched.

create or replace function public.mark_habit_dates_dirty(p_user_id uuid, p_habit_id uuid, p_reason text)
returns void
language sql
security invoker
as $$
  select public.mark_analytics_dirty(p_user_id, d.date_key, p_reason)
  from (select distinct date_key from public.habit_logs where user_id = p_user_id and habit_id = p_habit_id) d;
$$;
