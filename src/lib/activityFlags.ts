import { getSleepActivityIds, type SleepCandidate } from './sleepActivity';

/**
 * Per-activity analysis flags, in one place so every screen agrees.
 *
 *  ignored   tracked but never judged: still counts as logged time (coverage, distribution, timeline), but never as
 *            focus, waste or productivity. Sleep activities are always ignored.
 *  waste     an activity with a negative productivity multiplier that is not ignored.
 */

export interface FlaggedActivity extends SleepCandidate {
  analysis_ignored?: boolean | null;
  productivity_multiplier?: number | null;
}

export const MULTIPLIER_MIN = -5;
export const MULTIPLIER_MAX = 5;

/** Ids of activities analysis must not judge: the ones marked ignored, plus every sleep activity. */
export const getIgnoredActivityIds = (activities: FlaggedActivity[], sleepIds: Set<string> = getSleepActivityIds(activities)): Set<string> => {
  const out = new Set(sleepIds);
  for (const a of activities) if (a.analysis_ignored) out.add(a.id);
  return out;
};

export const isWasteActivity = (a: FlaggedActivity, ignored: Set<string>): boolean =>
  !ignored.has(a.id) && (a.productivity_multiplier ?? 0) < 0;

/** True once any activity analysis can judge has a productivity multiplier (ignored activities never count). */
export const hasProductivityMultipliers = (activities: Pick<FlaggedActivity, 'analysis_ignored' | 'productivity_multiplier'>[]): boolean =>
  activities.some((a) => !!a.productivity_multiplier && !a.analysis_ignored);

/**
 * Parse what the user typed into a multiplier field. Accepts "-0.35", "-.5", "+1", "1,5" (comma decimal).
 * Empty means neutral (0). Returns null for text that is not a number. Clamped and rounded to 2 decimals.
 */
export const parseMultiplier = (text: string): number | null => {
  const t = text.trim().replace(',', '.');
  if (t === '' || t === '-' || t === '+') return t === '' ? 0 : null;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const v = Number(t);
  if (!Number.isFinite(v)) return null;
  const clamped = Math.min(MULTIPLIER_MAX, Math.max(MULTIPLIER_MIN, v));
  const rounded = Math.round(clamped * 100) / 100;
  return rounded === 0 ? 0 : rounded; // no "-0"
};

export const formatMultiplier = (m: number): string => {
  const abs = Math.abs(m);
  const digits = Math.round(abs * 10) === abs * 10 ? 1 : 2;
  return `${m > 0 ? '+' : m < 0 ? '−' : ''}${abs.toFixed(digits)}×`;
};

/**
 * A productivity score (Summary.productivityScore): the minutes-weighted average multiplier, which is exactly
 * productivity points per counted minute. Shown in those words rather than as a bare "×".
 */
export const formatProductivity = (score: number, digits = 2): string =>
  `${score > 0 ? '+' : score < 0 ? '−' : ''}${Math.abs(score).toFixed(digits)} pts/min`;

/** A signed productivity points total, e.g. "+126 pts". */
export const formatPoints = (points: number): string => {
  const r = Math.round(points);
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r)} pts`;
};

export const multiplierTone = (m: number): string => {
  if (m > 0) return 'text-green-600 dark:text-green-400';
  if (m < 0) return 'text-red-600 dark:text-red-400';
  return 'text-muted-foreground';
};

// Focus demand: how much attention an activity requires (0 negligible .. 5 maximal). A
// separate dimension from productivity_multiplier -- a high-demand,
// low-value activity (an unproductive but attention-draining conversation) is valid and must
// not collapse into "focus == productive".
export const FOCUS_DEMAND_MIN = 0;
export const FOCUS_DEMAND_MAX = 5;

/** Parse what the user typed into a focus-demand field. Empty means 0 (negligible). Clamped 0-5, 2 decimals. */
export const parseFocusDemand = (text: string): number | null => {
  const t = text.trim().replace(',', '.');
  if (t === '') return 0;
  if (!/^\d+\.?\d*|\.\d+$/.test(t)) return null;
  const v = Number(t);
  if (!Number.isFinite(v)) return null;
  const clamped = Math.min(FOCUS_DEMAND_MAX, Math.max(FOCUS_DEMAND_MIN, v));
  return Math.round(clamped * 100) / 100;
};

export const formatFocusDemand = (d: number): string => {
  const digits = Math.round(d * 10) === d * 10 ? 1 : 2;
  return `${d.toFixed(digits)}`;
};

const FOCUS_DEMAND_LABELS = ['negligible', 'light', 'moderate', 'substantial', 'demanding', 'maximal'];
/** Nearest plain-language label for a focus-demand value (0-5), for a hint next to the number. */
export const focusDemandLabel = (d: number): string => FOCUS_DEMAND_LABELS[Math.max(0, Math.min(5, Math.round(d)))];
