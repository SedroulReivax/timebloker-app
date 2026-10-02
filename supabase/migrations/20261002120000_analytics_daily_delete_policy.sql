-- analytics_daily had read, insert and update policies but no delete policy, unlike every other analytics_*
-- table. Row-level security therefore filtered a user's own delete down to zero rows without an error, so
-- Settings -> "Delete all data" left that user's daily analytics behind. Same shape as the other tables' policy.
-- Additive and idempotent; derived data only.

drop policy if exists "Users can delete their own daily analytics" on public.analytics_daily;
create policy "Users can delete their own daily analytics"
  on public.analytics_daily for delete to authenticated
  using (auth.uid() = user_id);
