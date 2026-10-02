import { supabase } from '../supabaseClient';
import {
  fetchDashboardSummary, fetchActivityAnalytics, fetchGoalAnalytics,
  fetchHabitAnalytics, fetchTransitionAnalytics, fetchAnalyticsState,
} from './backendAnalytics';

// Phase G, manual-paste variant (per explicit user direction: no live provider call --
// the user copies this prompt into whatever AI tool they use, then pastes the reply
// back in). There is therefore no provider secret to protect and no Edge Function
// needed; everything here runs as the authenticated user against their own rows
// (RLS-scoped), same as the rest of the analytics read path.
//
// What this still keeps from the original G design :
//   - one canonical request identity (request_hash over the exact inputs that can
//     change the output: range, mode, model, analytics_version, data_version,
//     prompt_version, options) so re-opening the same request doesn't regenerate it
//   - the prompt is built from canonical backend analytics facts (analytics_daily /
//     _activity_daily / _goal_daily / _habit_daily / _transition_daily), never from
//     raw time_blocks -- the AI interprets Postgres's numbers, it does not
//     recompute them
//   - provenance: model/prompt_version/analytics_version/data_version/range/status
//     are all persisted alongside the response

export const PROMPT_VERSION = 2; // 2: attention_points on the /5 demand scale (analytics_version 2)

export interface AIAnalysisRequest {
  fromDate: string;
  toDate: string;
  analysisMode: string;
  model: string;
  options?: Record<string, unknown>;
}

export interface AIAnalysisPromptResult {
  requestHash: string;
  status: 'ready' | 'success';
  prompt: string;
  response: string | null;
}

async function requireUserId(): Promise<string> {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error('Not authenticated');
  return user.id;
}

/** Deterministic JSON stringify: object keys sorted recursively, so the same logical payload always hashes the same. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function buildPrompt(
  req: AIAnalysisRequest,
  ctx: { analyticsVersion: number; dataVersion: number; dashboard: any; activity: unknown; goal: unknown; habit: unknown; transition: unknown }
): string {
  const out: string[] = [];
  out.push(`# Personal time-tracking analysis request`);
  out.push('');
  out.push(`Range: ${req.fromDate} to ${req.toDate}. Mode: ${req.analysisMode}. These numbers come from a deterministic backend accounting layer (Postgres), not from you -- please interpret them, don't recompute or second-guess the arithmetic. Where the data is genuinely ambiguous or thin, say so instead of guessing.`);
  out.push('');
  out.push('Key terms: `productivity_points`/`productivity_score` are the user\'s own value judgement per activity (a multiplier they set, -5..+5), not a measure of effort. `attention_points` = judged minutes x `focus_demand` (0..5) / 5, i.e. demand as a 0-1 weight (an hour at full demand = 60, the same unit as productivity points), and `attention_efficiency` = productivity_points / attention_points; they measure attention separately from that value judgement -- a high-attention, low-value activity is a real and valid combination, not a contradiction. `waste_*` is judged time with a negative multiplier. `coverage_pct` is tracked/elapsed; untracked time is unknown, not automatically waste. Ignored activities (including sleep) are tracked but excluded from judged/attention totals.');
  out.push('');
  out.push('## Totals for the range');
  out.push('```json');
  out.push(JSON.stringify(ctx.dashboard?.totals ?? {}, null, 1));
  out.push('```');
  out.push('');
  out.push('## Daily breakdown (analytics_daily)');
  out.push('```json');
  out.push(JSON.stringify(ctx.dashboard?.daily ?? [], null, 1));
  out.push('```');
  out.push('');
  out.push('## Per-activity daily breakdown (analytics_activity_daily)');
  out.push('```json');
  out.push(JSON.stringify(ctx.activity ?? [], null, 1));
  out.push('```');
  out.push('');
  out.push('## Per-goal daily breakdown (analytics_goal_daily)');
  out.push('```json');
  out.push(JSON.stringify(ctx.goal ?? [], null, 1));
  out.push('```');
  out.push('');
  out.push('## Per-habit daily breakdown (analytics_habit_daily)');
  out.push('```json');
  out.push(JSON.stringify(ctx.habit ?? [], null, 1));
  out.push('```');
  out.push('');
  out.push('## Activity transitions (analytics_transition_daily)');
  out.push('```json');
  out.push(JSON.stringify(ctx.transition ?? [], null, 1));
  out.push('```');
  out.push('');
  out.push('## What to do');
  out.push('Interpret the above: notable patterns, honest tradeoffs (not just praise), and 2-3 concrete, checkable hypotheses the user could test against their own future data. Do not invent numbers not present above.');
  out.push('');
  out.push(`_analytics_version=${ctx.analyticsVersion} data_version=${ctx.dataVersion} prompt_version=${PROMPT_VERSION} model=${req.model}_`);
  return out.join('\n');
}

/**
 * Get (or build, on first call for this exact request) the copy-pasteable prompt for a
 * range + mode + model. Identical requests (same range/mode/model/analytics state)
 * return the same cached prompt/response instead of rebuilding it.
 */
export async function getOrCreateAnalysisPrompt(req: AIAnalysisRequest): Promise<AIAnalysisPromptResult> {
  const userId = await requireUserId();
  const state = await fetchAnalyticsState();
  const analyticsVersion = state?.analytics_version ?? 1;
  const dataVersion = state?.data_version ?? 0;

  const fingerprint = {
    user_id: userId,
    from_date: req.fromDate,
    to_date: req.toDate,
    analysis_mode: req.analysisMode,
    model: req.model,
    analytics_version: analyticsVersion,
    data_version: dataVersion,
    prompt_version: PROMPT_VERSION,
    options: req.options ?? {},
  };
  const requestHash = await sha256Hex(stableStringify(fingerprint));

  const { data: existing, error: readError } = await supabase
    .from('ai_analysis_cache')
    .select('request_hash, status, prompt, response')
    .eq('user_id', userId)
    .eq('request_hash', requestHash)
    .maybeSingle();
  if (readError) throw new Error(readError.message);

  if (existing?.prompt) {
    return {
      requestHash,
      status: existing.status === 'success' ? 'success' : 'ready',
      prompt: existing.prompt,
      response: existing.status === 'success' ? JSON.stringify(existing.response) : null,
    };
  }

  const [dashboard, activity, goal, habit, transition] = await Promise.all([
    fetchDashboardSummary(req.fromDate, req.toDate),
    fetchActivityAnalytics(req.fromDate, req.toDate),
    fetchGoalAnalytics(req.fromDate, req.toDate),
    fetchHabitAnalytics(req.fromDate, req.toDate),
    fetchTransitionAnalytics(req.fromDate, req.toDate),
  ]);

  const prompt = buildPrompt(req, { analyticsVersion, dataVersion, dashboard, activity, goal, habit, transition });

  const { error: upsertError } = await supabase.from('ai_analysis_cache').upsert({
    user_id: userId,
    request_hash: requestHash,
    from_date: req.fromDate,
    to_date: req.toDate,
    analysis_mode: req.analysisMode,
    model: req.model,
    analytics_version: analyticsVersion,
    prompt_version: PROMPT_VERSION,
    data_version: dataVersion,
    status: 'ready',
    prompt,
  }, { onConflict: 'user_id,request_hash' });
  if (upsertError) throw new Error(upsertError.message);

  return { requestHash, status: 'ready', prompt, response: null };
}

/** Store the AI's pasted-back reply against the request that produced its prompt. */
export async function submitAnalysisResponse(requestHash: string, responseText: string): Promise<void> {
  const userId = await requireUserId();
  const { error } = await supabase
    .from('ai_analysis_cache')
    .update({ status: 'success', response: { text: responseText } as any, completed_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('request_hash', requestHash);
  if (error) throw new Error(error.message);
}
