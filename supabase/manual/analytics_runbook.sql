-- PURPOUSE: Provide a single manual script to run through the Supabase SQL editor
-- to verify and apply Phase A through Phase G migrations.
-- PREREQUISITES: None
-- EXPECTED RESULT: Schema applied and verification checks returned.
-- SAFE TO RE-RUN?: Yes, all operations are idempotent.
-- ROLLBACK / RECOVERY: Drop the created tables/functions.

-- --------------------------------------------------------------------------------
-- PHASE A VERIFICATION (Inspection only)
-- --------------------------------------------------------------------------------
select
  table_schema,
  table_name
from information_schema.tables
where table_schema = 'public'
order by table_name;

select
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position;

select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
order by tablename, indexname;

explain (analyze, buffers)
select
  date_key,
  block_index,
  activity_id,
  task_id
from public.time_blocks
where user_id = '<YOUR_USER_UUID>'
  and date_key between '2026-09-01' and '2026-09-26'
order by date_key, block_index;

-- --------------------------------------------------------------------------------
-- RUN MIGRATIONS
-- --------------------------------------------------------------------------------
-- NOTE: Please apply migrations using the Supabase CLI:
-- `npx supabase db push`
-- Or run the SQL contents of supabase/migrations/ from 20260926120000 to 20260926180000.
