import { describe, expect, it } from 'vitest';
import { analyzeFlow, buildDayFlows, buildFlowResult, flowMatrixFromTransitionRows, routinesFromBlocks, FLOW_OTHER } from './flow';
import { blindSpots, loggingGaps } from './insights';
import type { RangeBlock } from './blockRange';

const NOW = new Date(2026, 8, 30, 23, 59);
const acts = ['mail', 'yt', 'code', 'tr', 'z', 'a5', 'a6'].map((id) => ({ id, name: id.toUpperCase(), color: '#000', analysis_ignored: id === 'tr' }));
const run = (date: string, from: number, to: number, a: string): RangeBlock[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ date_key: date, block_index: from + i, activity_id: a }));
const days = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25'];
const flow = (blocks: RangeBlock[], keys = days, topN?: number) =>
  analyzeFlow({ blocks, activities: acts, sleepIds: new Set(['z']) }, keys, { now: NOW, topN, minCount: 2 });

describe('analyzeFlow', () => {
  it('turns consecutive runs into transition probabilities', () => {
    // every day: mail -> yt; on 2 of 5 days mail -> code instead
    const blocks = days.flatMap((d, i) => [...run(d, 54, 56, 'mail'), ...run(d, 57, 59, i < 3 ? 'yt' : 'code')]);
    const f = flow(blocks);
    const mail = f.nodes.indexOf('mail');
    expect(f.matrix[mail][f.nodes.indexOf('yt')]).toEqual({ count: 3, pct: 60 });
    expect(f.matrix[mail][f.nodes.indexOf('code')]).toEqual({ count: 2, pct: 40 });
    expect(f.strongest[0]).toEqual({ from: 'mail', to: 'yt', count: 3, pct: 60 });
    expect(f.totalTransitions).toBe(5);
  });

  it('a 30-minute gap breaks the chain; a shorter one does not', () => {
    const f = flow([...run(days[0], 54, 56, 'mail'), ...run(days[0], 60, 62, 'yt'), ...run(days[0], 65, 67, 'code')], [days[0]]);
    expect(f.totalTransitions).toBe(1); // mail -/-> yt (30 min gap), yt -> code (20 min gap)
    expect(f.matrix[f.nodes.indexOf('yt')][f.nodes.indexOf('code')].count).toBe(1);
  });

  it('sleep is never a node, ignored travel is, and three-step routines are counted', () => {
    const blocks = days.flatMap((d) => [...run(d, 0, 40, 'z'), ...run(d, 41, 43, 'tr'), ...run(d, 44, 50, 'code'), ...run(d, 51, 52, 'mail')]);
    const f = flow(blocks);
    expect(f.nodes).not.toContain('z');
    expect(f.ignored.has('tr')).toBe(true);
    expect(f.routines[0]).toEqual({ steps: ['tr', 'code', 'mail'], count: 5 });
  });

  it('beyond topN, destinations fold into Other', () => {
    const blocks = days.flatMap((d) => [...run(d, 54, 55, 'mail'), ...run(d, 56, 57, 'yt'), ...run(d, 58, 59, 'code'), ...run(d, 60, 61, 'a5')]);
    const f = flow(blocks, days, 2);
    expect(f.nodes).toHaveLength(3);
    expect(f.nodes[2]).toBe(FLOW_OTHER);
    for (const row of f.matrix) expect(row.reduce((s, c) => s + c.count, 0)).toBeGreaterThan(0);
  });
});

describe('flowMatrixFromTransitionRows / buildFlowResult', () => {
  it('matches analyzeFlow\'s matrix/strongest/totalTransitions when fed the equivalent pairwise counts', () => {
    const blocks = days.flatMap((d, i) => [...run(d, 54, 56, 'mail'), ...run(d, 57, 59, i < 3 ? 'yt' : 'code')]);
    const f = flow(blocks);
    const rows = [
      { from_activity_id: 'mail', to_activity_id: 'yt', transition_count: 3 },
      { from_activity_id: 'mail', to_activity_id: 'code', transition_count: 2 },
    ];
    const m = flowMatrixFromTransitionRows(rows, acts, { minCount: 2 });
    expect(m.totalTransitions).toBe(f.totalTransitions);
    expect(m.strongest).toEqual(f.strongest);
    const mail = m.nodes.indexOf('mail');
    expect(m.matrix[mail][m.nodes.indexOf('yt')]).toEqual({ count: 3, pct: 60 });
    expect(m.matrix[mail][m.nodes.indexOf('code')]).toEqual({ count: 2, pct: 40 });
  });

  it('never includes routines -- that key is absent from its return type', () => {
    const m = flowMatrixFromTransitionRows([{ from_activity_id: 'mail', to_activity_id: 'yt', transition_count: 5 }], acts);
    expect('routines' in m).toBe(false);
  });

  it('buildFlowResult merges the backend-fed matrix with routines computed from the given raw blocks', () => {
    const blocks = days.flatMap((d) => [...run(d, 0, 40, 'z'), ...run(d, 41, 43, 'tr'), ...run(d, 44, 50, 'code'), ...run(d, 51, 52, 'mail')]);
    const expectedRoutines = routinesFromBlocks({ blocks, activities: acts, sleepIds: new Set(['z']) }, days, { now: NOW });
    const rows = [{ from_activity_id: 'x', to_activity_id: 'y', transition_count: 9 }];
    const r = buildFlowResult(rows, { blocks, activities: acts, sleepIds: new Set(['z']) }, days, { now: NOW, minCount: 2 });
    expect(r.routines).toEqual(expectedRoutines);
    expect(r.totalTransitions).toBe(9);
  });
});

describe('loggingGaps', () => {
  it('measures untracked share per weekday x hour, with sleep counted as tracked, from the first tracked day on', () => {
    const keys = ['2026-09-13', '2026-09-14', '2026-09-21', '2026-09-28'];
    // no tracking on the 13th (before the user started); the three Mondays: 9-10 AM always tracked, 10-11 AM tracked once
    const blocks = [
      ...['2026-09-14', '2026-09-21', '2026-09-28'].flatMap((d) => run(d, 54, 59, 'code')),
      ...run('2026-09-14', 60, 65, 'code'),
      ...run('2026-09-21', 0, 5, 'z'),
    ];
    const g = loggingGaps(blocks, keys, NOW);
    expect(g.days).toBe(3);
    expect(g.cells[1][9].untrackedPct).toBe(0);
    expect(g.cells[1][10].untrackedPct).toBe(67);
    expect(g.cells[1][0].untrackedPct).toBe(67); // sleep logged on one Monday night
    expect(g.cells[0][9].untrackedPct).toBeNull(); // Sunday: before the first tracked day
    expect(blindSpots(g.cells, 1)[0].untrackedPct).toBe(100);
  });
});

describe('strongest links', () => {
  it('rank a well-supported 80% above a thin 100%', () => {
    const acts2 = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }, { id: 'd', name: 'D' }, { id: 'e', name: 'E' }];
    const m = flowMatrixFromTransitionRows([
      { from_activity_id: 'a', to_activity_id: 'b', transition_count: 5 }, // 5 of 5
      { from_activity_id: 'c', to_activity_id: 'd', transition_count: 160 }, // 160 of 200
      { from_activity_id: 'c', to_activity_id: 'e', transition_count: 40 },
    ], acts2);
    expect(m.strongest[0]).toMatchObject({ from: 'c', to: 'd', pct: 80 });
    expect(m.strongest[1]).toMatchObject({ from: 'a', to: 'b', pct: 100 });
  });
});

describe('loggingGaps: whole untracked days', () => {
  it('counts days with nothing tracked separately instead of painting every hour', () => {
    const keys = ['2026-09-21', '2026-09-22', '2026-09-23'];
    const g = loggingGaps([...run('2026-09-21', 0, 143, 'code'), ...run('2026-09-23', 0, 143, 'code')], keys, NOW);
    expect(g.days).toBe(2);
    expect(g.notTrackedDays).toBe(1);
    expect(g.overallPct).toBe(0);
    expect(g.cells[2][10].untrackedPct).toBeNull(); // Tuesday: only the untracked day, so no observations
  });
});

describe('routines of three to five steps and day flows', () => {
  const mk = (seq: string[], day = '2026-07-01') =>
    seq.map((a, i) => ({ date_key: day, block_index: i * 6, activity_id: a, user_id: 'u' }));
  const acts = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, name: id }));
  const run = (blocks: ReturnType<typeof mk>) => {
    // each activity is 2 blocks (the first block plus the next 5 empty ones would break the chain), so fill 6 blocks each
    const full = blocks.flatMap((b) => Array.from({ length: 6 }, (_, k) => ({ ...b, block_index: b.block_index + k })));
    return full;
  };

  it('finds a five-step routine seen twice and drops the shorter ones it contains', () => {
    const blocks = [...run(mk(['a', 'b', 'c', 'd', 'e'], '2026-07-01')), ...run(mk(['a', 'b', 'c', 'd', 'e'], '2026-07-02'))];
    const r = routinesFromBlocks({ blocks: blocks as any, activities: acts, sleepIds: new Set() }, ['2026-07-01', '2026-07-02'], { now: new Date('2026-08-01T12:00:00') });
    expect(r).toEqual([{ steps: ['a', 'b', 'c', 'd', 'e'], count: 2 }]);
  });

  it('keeps a shorter routine that also happens on its own', () => {
    const blocks = [
      ...run(mk(['a', 'b', 'c', 'd'], '2026-07-01')),
      ...run(mk(['a', 'b', 'c', 'd'], '2026-07-02')),
      ...run(mk(['a', 'b', 'c', 'e'], '2026-07-03')),
    ];
    const r = routinesFromBlocks({ blocks: blocks as any, activities: acts, sleepIds: new Set() }, ['2026-07-01', '2026-07-02', '2026-07-03'], { now: new Date('2026-08-01T12:00:00') });
    expect(r[0]).toEqual({ steps: ['a', 'b', 'c'], count: 3 });
    expect(r).toContainEqual({ steps: ['a', 'b', 'c', 'd'], count: 2 });
  });

  it('buildDayFlows breaks on a change of activity and on a 20 minute gap, but not on a single missed block', () => {
    const blocks = [0, 1, 3, 4].map((i) => ({ block_index: i, activity_id: 'a' }))
      .concat([5, 6].map((i) => ({ block_index: i, activity_id: 'b' })))
      .concat([9, 10].map((i) => ({ block_index: i, activity_id: 'b' })));
    expect(buildDayFlows(blocks, new Set())).toEqual([
      { activityId: 'a', start: 0, end: 4 },
      { activityId: 'b', start: 5, end: 6 },
      { activityId: 'b', start: 9, end: 10 },
    ]);
  });

  it('buildDayFlows ignores sleep and cuts at the elapsed block', () => {
    const blocks = [0, 1, 2, 3].map((i) => ({ block_index: i, activity_id: i < 2 ? 'z' : 'a' }));
    expect(buildDayFlows(blocks, new Set(['z']), 3)).toEqual([{ activityId: 'a', start: 2, end: 2 }]);
  });
});
