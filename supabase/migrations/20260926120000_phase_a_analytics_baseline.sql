-- Phase A: database baseline for the backend analytics workstream.
-- Additive and idempotent. Run this in the Supabase SQL editor.

-- Pending activity analysis flag (src/database.types.ts already hand-edited to
-- expect this column; regenerate types after running this).
alter table public.activities
add column if not exists analysis_ignored boolean not null default false;

-- Time-block indexes: user + date + block is the dominant analytical access key.
create index if not exists idx_time_blocks_user_date_block
on public.time_blocks (user_id, date_key, block_index);

create index if not exists idx_time_blocks_user_activity_date
on public.time_blocks (user_id, activity_id, date_key);

create index if not exists idx_time_blocks_user_task_date
on public.time_blocks (user_id, task_id, date_key)
where task_id is not null;

-- Task indexes.
create index if not exists idx_tasks_user_date
on public.tasks (user_id, date_key);

create index if not exists idx_tasks_user_completed_at
on public.tasks (user_id, completed_at)
where completed_at is not null;

create index if not exists idx_tasks_user_deadline
on public.tasks (user_id, deadline)
where deadline is not null;

-- Habit log indexes.
create index if not exists idx_habit_logs_user_habit_date
on public.habit_logs (user_id, habit_id, date_key);

create index if not exists idx_habit_logs_user_date
on public.habit_logs (user_id, date_key);

-- Focus session indexes.
create index if not exists idx_focus_sessions_user_started
on public.task_focus_sessions (user_id, started_at);

create index if not exists idx_focus_sessions_user_task_started
on public.task_focus_sessions (user_id, task_id, started_at)
where task_id is not null;

-- Sleep log index.
create index if not exists idx_sleep_logs_user_date
on public.sleep_logs (user_id, date_key);
