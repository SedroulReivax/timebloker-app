import type { RangeBlock } from './blockRange';
import { elapsedBlocksFor } from './analysis';
import { wilson } from './stats';

/**
 * Activity flow: what usually follows what. Built from runs of the same activity; a transition is one run ending and
 * a different activity starting within 30 minutes (a longer gap breaks the chain, the same rule as the day profile's
 * switch count). Sleep is not a node. Ignored activities (like travel) ARE nodes, because they are real routine steps;
 * they are only excluded from judgement, not from description.
 */

const GAP_BREAK = 3; // 30+ minutes of nothing ends a chain
export const FLOW_OTHER = '__other__';

export interface FlowActivityInfo { id: string; name: string; color?: string | null; analysis_ignored?: boolean | null }

export interface FlowInput {
  blocks: RangeBlock[];
  activities: FlowActivityInfo[];
  sleepIds: Set<string>;
}

export interface FlowLink { from: string; to: string; count: number; /** share of `from`'s transitions, 0-100 */ pct: number }

export interface FlowResult {
  /** node ids in matrix order (top N by transitions), plus FLOW_OTHER as a column when needed */
  nodes: string[];
  /** matrix[fromIdx][toIdx] over `nodes` (rows exclude FLOW_OTHER) */
  matrix: { count: number; pct: number }[][];
  /** transitions out of each row node, all destinations */
  outTotals: number[];
  totalTransitions: number;
  /** strongest links with at least `minCount` observations, by probability */
  strongest: FlowLink[];
  /** most common three- to five-step chains (A -> B -> C ...), longest-first when equally common */
  routines: { steps: string[]; count: number }[];
  names: Record<string, string>;
  colors: Record<string, string>;
  ignored: Set<string>;
}

/**
 * Runs of the same activity, grouped into gap-tolerant chains (a chain breaks when the gap
 * between two runs is >= GAP_BREAK, exactly as flow.ts's doc describes). Chains never cross a
 * date boundary. This is the one place the run/chain algorithm is implemented; analyzeFlow's
 * pairwise counting and routinesFromBlocks's triple counting both walk these chains instead of
 * re-deriving the run/gap logic separately.
 */
function buildChains(input: FlowInput, dateKeys: string[], now: Date): string[][] {
  const inRange = new Set(dateKeys);
  const byDate = new Map<string, (string | null)[]>();
  for (const b of input.blocks) {
    if (!b.activity_id || input.sleepIds.has(b.activity_id) || !inRange.has(b.date_key)) continue;
    (byDate.get(b.date_key) ?? byDate.set(b.date_key, new Array(144).fill(null)).get(b.date_key)!)[b.block_index] = b.activity_id;
  }
  const chains: string[][] = [];
  for (const dateKey of dateKeys) {
    const day = byDate.get(dateKey);
    if (!day) continue;
    const elapsed = elapsedBlocksFor(dateKey, now);
    const runs: { a: string; start: number; end: number }[] = [];
    for (let i = 0; i < elapsed; i++) {
      const a = day[i];
      if (!a) continue;
      const last = runs[runs.length - 1];
      if (last && last.a === a && i - last.end - 1 < GAP_BREAK) { last.end = i; continue; }
      runs.push({ a, start: i, end: i });
    }
    let chain: string[] = runs.length ? [runs[0].a] : [];
    for (let k = 1; k < runs.length; k++) {
      const prev = runs[k - 1], cur = runs[k];
      if (cur.start - prev.end - 1 >= GAP_BREAK) { chains.push(chain); chain = [cur.a]; continue; }
      chain.push(cur.a);
    }
    if (chain.length) chains.push(chain);
  }
  return chains;
}

/**
 * Most common three-step chains (A -> B -> C). This cannot be reconstructed from stored pairwise
 * transition_count sums alone -- a day with an A->B pair and a B->C pair does not tell you
 * whether A->B->C happened in sequence or the two pairs came from unrelated moments in the day --
 * so this stays raw-block-based even once the pairwise matrix moves to the backend (see
 * flowMatrixFromTransitionRows / buildFlowResult below).
 */
const ROUTINE_MIN_STEPS = 3;
const ROUTINE_MAX_STEPS = 5;

const routinesFromChains = (chains: string[][]): { steps: string[]; count: number }[] => {
  const seen = new Map<string, number>();
  for (const chain of chains) {
    for (let len = ROUTINE_MIN_STEPS; len <= ROUTINE_MAX_STEPS; len++) {
      for (let k = len - 1; k < chain.length; k++) {
        const t = chain.slice(k - len + 1, k + 1).join('|');
        seen.set(t, (seen.get(t) ?? 0) + 1);
      }
    }
  }
  const repeated = [...seen.entries()].filter(([, c]) => c >= 2).map(([k, count]) => ({ steps: k.split('|'), count }));
  // A routine inside a longer one seen just as often is the same habit, not a second one ("A→B→C" is implied by
  // "A→B→C→D" seen 4x). It stays when it also happens on its own, i.e. more often than the longer sequence.
  const contains = (long: string[], short: string[]) => {
    for (let i = 0; i + short.length <= long.length; i++) if (short.every((s, j) => long[i + j] === s)) return true;
    return false;
  };
  return repeated
    .filter((r) => !repeated.some((o) => o.steps.length > r.steps.length && o.count >= r.count && contains(o.steps, r.steps)))
    .sort((a, b) => b.count - a.count || b.steps.length - a.steps.length)
    .slice(0, 5);
};

/** One run of a single activity within a day, as block indexes (inclusive). */
export interface DayFlow { activityId: string; start: number; end: number }

const DAY_FLOW_TOLERANCE = 2; // a lone untracked 10-minute block inside a stretch doesn't end it; 20+ minutes does

/**
 * The day's flows: each is an unbroken stretch of ONE activity. A change of activity ends a flow (the next one starts
 * right away), and so does an untracked gap of DAY_FLOW_TOLERANCE blocks or more. Sleep and untracked time are not
 * flows. `elapsedBlocks` cuts a day that is still in progress.
 */
export const buildDayFlows = (
  blocks: { block_index: number; activity_id: string | null }[],
  sleepIds: Set<string>,
  elapsedBlocks = 144
): DayFlow[] => {
  const day: (string | null)[] = new Array(144).fill(null);
  for (const b of blocks) if (b.activity_id && !sleepIds.has(b.activity_id)) day[b.block_index] = b.activity_id;
  const flows: DayFlow[] = [];
  for (let i = 0; i < Math.min(elapsedBlocks, 144); i++) {
    const a = day[i];
    if (!a) continue;
    const last = flows[flows.length - 1];
    if (last && last.activityId === a && i - last.end - 1 < DAY_FLOW_TOLERANCE) { last.end = i; continue; }
    flows.push({ activityId: a, start: i, end: i });
  }
  return flows;
};

export const routinesFromBlocks = (
  input: FlowInput,
  dateKeys: string[],
  opts: { now?: Date } = {}
): { steps: string[]; count: number }[] => routinesFromChains(buildChains(input, dateKeys, opts.now ?? new Date()));

/**
 * Pairwise transition matrix/strongest-links built from already-aggregated transition rows
 * (analytics_transition_daily -- a verified SQL port of this file's run/chain algorithm, summed
 * over a range and grouped by from/to), instead of re-deriving pair counts from raw blocks.
 * `routines` is deliberately not part of this function's output -- see routinesFromBlocks above.
 */
export const flowMatrixFromTransitionRows = (
  rows: { from_activity_id: string; to_activity_id: string; transition_count: number }[],
  activities: FlowActivityInfo[],
  opts: { topN?: number; minCount?: number } = {}
): Omit<FlowResult, 'routines'> => {
  const topN = opts.topN ?? 8;
  const minCount = opts.minCount ?? 5;
  const info = new Map(activities.map((a) => [a.id, a]));

  const pairs = new Map<string, number>();
  const involvement = new Map<string, number>();
  for (const r of rows) {
    if (r.transition_count <= 0) continue;
    const k = `${r.from_activity_id}|${r.to_activity_id}`;
    pairs.set(k, (pairs.get(k) ?? 0) + r.transition_count);
    involvement.set(r.from_activity_id, (involvement.get(r.from_activity_id) ?? 0) + r.transition_count);
    involvement.set(r.to_activity_id, (involvement.get(r.to_activity_id) ?? 0) + r.transition_count);
  }

  const ranked = [...involvement.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const rowNodes = ranked.slice(0, topN);
  const hasOther = ranked.length > topN;
  const nodes = hasOther ? [...rowNodes, FLOW_OTHER] : rowNodes;
  const col = (id: string) => (rowNodes.includes(id) ? rowNodes.indexOf(id) : nodes.length - 1);

  const outAll = new Map<string, number>();
  for (const [k, c] of pairs) { const [a] = k.split('|'); outAll.set(a, (outAll.get(a) ?? 0) + c); }

  const matrix = rowNodes.map(() => nodes.map(() => ({ count: 0, pct: 0 })));
  for (const [k, c] of pairs) {
    const [a, b] = k.split('|');
    const r = rowNodes.indexOf(a);
    if (r < 0) continue;
    matrix[r][col(b)].count += c;
  }
  rowNodes.forEach((a, r) => {
    const tot = outAll.get(a) ?? 0;
    for (const cell of matrix[r]) cell.pct = tot ? Math.round((cell.count / tot) * 100) : 0;
  });

  // Ranked by the lower end of an 80% Wilson interval, not the raw share: "5 of 5" (100%, but could easily be
  // 70%) should not outrank "160 of 200" (80%, and almost certainly 75%+).
  const strongest: FlowLink[] = [...pairs.entries()]
    .map(([k, count]) => {
      const [from, to] = k.split('|');
      const out = outAll.get(from) ?? count;
      return { link: { from, to, count, pct: Math.round((count / out) * 100) }, lo: wilson(count, out).lo ?? 0 };
    })
    .filter((l) => l.link.count >= minCount)
    .sort((a, b) => b.lo - a.lo || b.link.count - a.link.count)
    .slice(0, 6)
    .map((l) => l.link);

  const names: Record<string, string> = { [FLOW_OTHER]: 'Other' };
  const colors: Record<string, string> = { [FLOW_OTHER]: '#94a3b8' };
  const ignored = new Set<string>();
  for (const id of ranked) {
    const a = info.get(id);
    names[id] = a?.name ?? 'Unknown activity';
    colors[id] = a?.color || '#94a3b8';
    if (a?.analysis_ignored) ignored.add(id);
  }

  return {
    nodes,
    matrix,
    outTotals: rowNodes.map((a) => outAll.get(a) ?? 0),
    totalTransitions: [...pairs.values()].reduce((s, c) => s + c, 0),
    strongest,
    names,
    colors,
    ignored,
  };
};

/**
 * Combines the backend-fed pairwise matrix with the still-raw-block-based routines into one
 * FlowResult, so PatternsTab's rendering code needs no changes -- the shape is identical to
 * analyzeFlow's. `routineBlocks` should be the same bounded raw-block fetch the screen already
 * needs for routines/logging-gap analysis, not a new fetch.
 */
export const buildFlowResult = (
  transitionRows: { from_activity_id: string; to_activity_id: string; transition_count: number }[],
  routineBlocks: FlowInput,
  dateKeys: string[],
  opts: { now?: Date; topN?: number; minCount?: number } = {}
): FlowResult => ({
  ...flowMatrixFromTransitionRows(transitionRows, routineBlocks.activities, opts),
  routines: routinesFromBlocks(routineBlocks, dateKeys, opts),
});

/** Raw-block version (export pack, tests): the same chains, counted into pairs, through the same matrix builder. */
export const analyzeFlow = (input: FlowInput, dateKeys: string[], opts: { now?: Date; topN?: number; minCount?: number } = {}): FlowResult => {
  const chains = buildChains(input, dateKeys, opts.now ?? new Date());
  const pairs = new Map<string, number>();
  for (const chain of chains) {
    for (let k = 1; k < chain.length; k++) {
      const p = `${chain[k - 1]}|${chain[k]}`;
      pairs.set(p, (pairs.get(p) ?? 0) + 1);
    }
  }
  const rows = [...pairs.entries()].map(([k, transition_count]) => {
    const [from_activity_id, to_activity_id] = k.split('|');
    return { from_activity_id, to_activity_id, transition_count };
  });
  return { ...flowMatrixFromTransitionRows(rows, input.activities, opts), routines: routinesFromChains(chains) };
};
