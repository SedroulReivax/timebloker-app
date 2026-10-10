-- Hardens goal_activity_counts (20261009120000_goal_activity_ranges).
--
-- linked_activity_ranges is free-form jsonb that a signed-in user can write through the API, and the function cast its
-- since / until strings straight to date. A value such as {"<id>": {"since": "banana"}} made the cast throw, which broke
-- get_daily_goal_progress and recompute_daily_analytics (so the analytics rebuild) for that user's goals. It could only
-- ever hit the writer's own rows (RLS), but one bad entry should not stop a rebuild.
--
-- - goal_safe_date: text -> date that returns null instead of throwing; a null since/until is treated as "not set".
-- - goal_activity_counts uses it, and is declared stable (text -> date depends on DateStyle, so immutable was wrong).
-- - A check constraint keeps linked_activity_ranges a JSON object. The column is new and every row is '{}', so it is
--   safe to add validated.

create or replace function public.goal_safe_date(p_value text)
returns date
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_value is null or p_value !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;
  return p_value::date;
exception when others then
  return null;
end;
$$;

create or replace function public.goal_activity_counts(p_ranges jsonb, p_linked boolean, p_activity_id text, p_date date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select
    (
      coalesce(p_linked, false)
      or public.goal_safe_date(case when jsonb_typeof(coalesce(p_ranges, '{}'::jsonb) -> p_activity_id) = 'object'
                                 then coalesce(p_ranges, '{}'::jsonb) -> p_activity_id ->> 'until' end) is not null
    )
    and coalesce(
      public.goal_safe_date(case when jsonb_typeof(coalesce(p_ranges, '{}'::jsonb) -> p_activity_id) = 'object'
                              then coalesce(p_ranges, '{}'::jsonb) -> p_activity_id ->> 'since' end) <= p_date,
      true)
    and coalesce(
      p_date <= public.goal_safe_date(case when jsonb_typeof(coalesce(p_ranges, '{}'::jsonb) -> p_activity_id) = 'object'
                                        then coalesce(p_ranges, '{}'::jsonb) -> p_activity_id ->> 'until' end),
      true)
$$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'goals_linked_activity_ranges_is_object') then
    alter table public.goals
      add constraint goals_linked_activity_ranges_is_object check (jsonb_typeof(linked_activity_ranges) = 'object');
  end if;
end;
$$;
