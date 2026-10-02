# Contributing

## Setup

```bash
npm install
cp .env.example .env   # fill in a Supabase project's URL + anon key
npm run dev
```

## Before opening a PR

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

## Database changes

- All schema changes are **additive** SQL migrations under `supabase/migrations/`, named
  `YYYYMMDDHHMMSS_description.sql`. Never drop or destructively alter the raw tracking tables
  (`time_blocks`, `tasks`, `activities`, `habits`, `habit_logs`, `goals`, `sleep_logs`,
  `task_focus_sessions`). The derived `analytics_*` tables are rebuildable from raw data and safe
  to backfill or rebuild.
- Migrations should be idempotent (`create table if not exists`, `add column if not exists`,
  `create or replace function`). If a function's return-row shape changes, Postgres refuses
  `create or replace`; add `drop function if exists name(arg types);` right before the
  `create function` — still idempotent, a no-op if the old version never existed.
- Never edit a migration that's already merged. Add a new one.

## Commit messages

Explain what changed and why, not just a one-line summary — what was broken or missing, what you
found while fixing it, what you verified. Look at the existing history for the style.

## Code style

- Small, understandable functions over generic abstractions.
- Every analytics metric has exactly one definition (SQL or a pure TypeScript function), used
  everywhere it's shown. If you're duplicating a calculation a screen could read from the
  backend instead, that's a sign to refactor.
- Add a hover explanation (`src/lib/explain.ts`) for any new Analysis card or number.
