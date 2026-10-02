# Data model (live schema, 2026-09-22; see `src/database.types.ts`)

| Table | Key columns |
|---|---|
| activities | id, user_id, name, color, category, emoji, description, archived (NOT NULL) |
| time_blocks | user_id, date_key, block_index (0-143, 10 min each), activity_id, task_id (nullable FK, on delete set null), notes; upsert key `user_id,date_key,block_index` |
| tasks | title, completed, activity_id, date_key, deadline (timestamptz), urgency, importance, estimated_minutes (nullable), estimated_pomodoros, completed_pomodoros, recurrence_type, recurrence_rule |
| habits / habit_logs | habits(name, type daily\|event); logs(habit_id, date_key, logged_at, notes) |
| goals | title, target_date, target_hours, status, linked_activity_ids[], linked_habit_ids[], completion_note |
| sleep_logs | date_key (text), sleep_time, wake_time, total_minutes, quality, notes |
| task_focus_sessions | user_id, task_id, activity_id, timer_type (pomodoro\|stopwatch), started_at, ended_at, duration_minutes; RLS own rows |
| daily_stats, user_settings | per-user aggregates and settings |

Conventions
- Deadline: date-only = UTC midnight instant; timed = real instant (local intent). Use `src/lib/deadlines.ts`.
- Sleep night: blocks from 18:00 of day X to 18:00 of X+1; bedtime index anchored at 18:00 (negative = evening).
- Task time (`src/lib/taskTime.ts`): estimated (minutes, else pomodoros x 25), scheduled (linked blocks starting in the future), tracked (linked blocks already started), focused (sum of focus sessions). Progress = tracked / estimated; it is not a score.
- Blocks get `task_id` only via the TimeGrid task picker or Focus mode; clearing/reassigning a block without a task clears the link.
