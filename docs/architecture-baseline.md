# Architecture baseline

- Stack: React 19 + TypeScript + Vite 8, Tailwind, Recharts, Supabase (auth, Postgres, realtime), PWA (vite-plugin-pwa), Electron wrapper in `windows-app/`.
- State: `src/hooks/useSupabaseSync.ts` owns all data and mutations; `src/App.tsx` passes data/callbacks to screens.
- Data flow: optimistic local update -> Supabase write -> `finishSave()` sets status (`saving`/`saved`/`error`); on failed deletes/updates the hook reloads.
- Realtime: one `public` `*` channel triggers a full reload (suppressed for 2s after own writes). Known weakness, planned for Release 3.
- Pure logic lives in `src/lib/` (`deadlines`, `recurrence`, `taskCounts`, `sleepMetrics`, `analytics`) with vitest tests.
- Commands: `npm run dev | build | lint | typecheck | test`.
- Baseline (2026-09-22): typecheck clean, build OK, 20 unit tests pass (also under TZ=Asia/Kolkata and America/Los_Angeles); oxlint has 4 warnings (unused catch var x2, two exhaustive-deps).
- Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Supabase CLI is linked but Docker is not used; the DB has no local migrations (see known-issues).
