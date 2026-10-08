-- Two small, behaviour-preserving database clean-ups found in the Supabase performance review.
--
-- 1) RLS initplan. Every owner policy was written as (auth.uid() = user_id). Postgres re-evaluates auth.uid() for each row
--    it checks; wrapping it as ((select auth.uid()) = user_id) evaluates it once per statement. Same rule, same result
--    (the Supabase advisor "auth_rls_initplan" flagged 45 policies). Only policies whose condition is exactly the plain
--    form are rewritten; roles and commands are untouched. Re-running does nothing, because rewritten policies no longer
--    match the plain form.
--
-- 2) Realtime scope. The app subscribes to postgres_changes on time_blocks and tasks only (useSupabaseSync.ts); other
--    tables catch up through the refresh when the tab becomes visible again. The publication also carried seven tables
--    nobody listens to, which Realtime still had to decode for every write. They are removed from the publication only:
--    no table or data is touched, and `alter publication ... add table` puts any of them back.

do $$
declare
  pol record;
  using_part text;
  check_part text;
begin
  for pol in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (qual = '(auth.uid() = user_id)' or with_check = '(auth.uid() = user_id)')
  loop
    using_part := case when pol.qual = '(auth.uid() = user_id)' then ' using (((select auth.uid()) = user_id))' else '' end;
    check_part := case when pol.with_check = '(auth.uid() = user_id)' then ' with check (((select auth.uid()) = user_id))' else '' end;
    execute format('alter policy %I on %I.%I%s%s', pol.policyname, pol.schemaname, pol.tablename, using_part, check_part);
  end loop;
end
$$;

do $$
declare
  t text;
begin
  foreach t in array array['activities', 'daily_stats', 'goals', 'habit_logs', 'habits', 'sleep_logs', 'user_settings']
  loop
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
    end if;
  end loop;
end
$$;
