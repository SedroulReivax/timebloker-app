-- Phase E scheduled repair . backup mechanism. Recommended as a BACKUP, not the primary
-- mechanism: the client now drains its own dirty queue automatically a few seconds after each
-- edit (see src/lib/analyticsInvalidation.ts's debounced process_dirty_analytics() call), so a
-- single-device user's analytics should already be fresh within seconds of an edit without this
-- script. This cron job still matters for: a second device that never opens the app to drain its
-- own queue, a session that closes before its debounce fires and is never reopened, and
-- repair_recent_analytics's rolling 7-day rebuild as insurance against any mutation class the
-- client-side dirty-marking doesn't cover.
--
-- What this does: schedules two jobs via pg_cron, both calling SECURITY DEFINER
-- functions that are revoked from anon/authenticated (see
-- 20260926190000_phase_ef_worker_and_attention.sql) -- they can only run as the
-- database role that owns them (here, whatever role runs this script / pg_cron's
-- default role), never from the browser.
--   1. drain_all_dirty_analytics(20)   every 15 minutes -- processes queued dirty
--      dates for every user, 20 dates per user per run.
--   2. repair_recent_analytics(7)      once a night at 03:17 -- rebuilds the last 7
--      days for every user (catches anything the dirty queue missed) and drains any
--      remaining backlog.
--
-- Not additive in the sense of column/table changes, but idempotent: re-running this
-- unschedules and reschedules the same two named jobs rather than creating duplicates.
--
-- 1. Open Supabase -> SQL Editor.
-- 2. Confirm the pg_cron extension is available (Database -> Extensions -> pg_cron),
--    enable it if not.
-- 3. Paste and run this whole file.
-- 4. Paste back the result of the final select (it lists the jobs now scheduled).

create extension if not exists pg_cron;

select cron.unschedule(jobid) from cron.job where jobname = 'blockday_drain_dirty_analytics';
select cron.unschedule(jobid) from cron.job where jobname = 'blockday_repair_recent_analytics';

select cron.schedule(
  'blockday_drain_dirty_analytics',
  '*/15 * * * *',
  $$select public.drain_all_dirty_analytics(20);$$
);

select cron.schedule(
  'blockday_repair_recent_analytics',
  '17 3 * * *',
  $$select public.repair_recent_analytics(7);$$
);

select jobid, jobname, schedule, active from cron.job where jobname like 'blockday_%';
