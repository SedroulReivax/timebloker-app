-- Phase G revision: manual copy/paste AI workflow, per explicit user direction
-- (no live provider call -- the user pastes the generated prompt into an AI chat
-- themselves and pastes the reply back in). This removes the need for a server-side
-- provider secret entirely, so the Supabase Edge Function stub
-- (supabase/functions/ai-analysis) is retired.
--
-- ai_analysis_cache keeps its existing request-hash/versioning/provenance columns
-- (still one canonical request identity as before); this only adds
-- a `prompt` column to hold the generated brief so it can be re-shown without
-- rebuilding it, and a `ready` status alongside the existing running/success/failed.

alter table public.ai_analysis_cache
add column if not exists prompt text;
