import { describe, expect, it } from 'vitest';
import { buildExportData, estimateTokens, exportFetchStart, tableToCSV, toCSVs, toJSON, toMarkdown, type ExportInput } from './exportPack';
import { profileDays, summarize } from './analysis';
import { analyzeWaste } from './waste';
import type { RangeBlock } from './blockRange';

const NOW = new Date(2026, 8, 30, 23, 0);
const run = (date: string, from: number, to: number, a: string, task: string | null = null): RangeBlock[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ date_key: date, block_index: from + i, activity_id: a, task_id: task }));
const keys = Array.from({ length: 14 }, (_, i) => `2026-09-${String(15 + i).padStart(2, '0')}`); // 15..28 Sep

const activities = [
  { id: 'code', name: 'Secret Startup Coding', color: '#3b82f6', category: 'Work', productivity_multiplier: 1 },
  { id: 'yt', name: 'YouTube Rabbit Hole', color: '#ef4444', category: 'Leisure', productivity_multiplier: -0.5 },
  { id: 'tr', name: 'Commute To Office', color: '#999999', category: 'Other', analysis_ignored: true },
  { id: 'z', name: 'Sleep', color: '#333333', category: 'Health', is_sleep_activity: true },
];
const blocks: RangeBlock[] = keys.flatMap((k, i) => [
  ...run(k, 0, 41, 'z'),
  ...run(k, 48, 50, 'tr'),
  ...run(k, 54, 65, 'code', i % 2 ? 't1' : null),
  ...(i % 3 === 0 ? run(k, 66, 69, 'yt') : []),
  ...run(k, 70, 75, 'code'),
]);
const input: ExportInput = {
  blocks,
  activities,
  tasks: [
    { id: 't1', title: 'Fix the "auth", bug', completed: true, activity_id: 'code', date_key: '2026-09-20', estimated_minutes: 60, completed_at: '2026-09-20T15:00:00', deadline: '2026-09-21' },
    { id: 't2', title: 'Private thing', completed: false, activity_id: null, date_key: '2026-09-25' },
  ],
  taskBlocks: blocks.filter((b) => b.task_id).map((b) => ({ date_key: b.date_key, block_index: b.block_index, task_id: b.task_id! })),
  sessions: [{ task_id: 't1', started_at: new Date(2026, 8, 20, 9, 0).toISOString(), duration_minutes: 50 }],
  habits: [{ id: 'h1', name: 'Meditate secretly', type: 'daily', created_at: '2026-09-01T00:00:00' }],
  habitLogs: keys.slice(0, 7).map((k) => ({ habit_id: 'h1', date_key: k })),
  goals: [{ id: 'g1', title: 'Launch the secret app', status: 'active', target_hours: 100, created_at: '2026-09-01T00:00:00', linked_activity_ids: ['code'], description: 'my private plan' }],
  sleepLogs: [{ date_key: '2026-09-20', quality: 4, energy: 3, factors: ['caffeine'], notes: 'dreamt about my ex' }],
  reviews: [{ period_type: 'day', period_key: '2026-09-22', energy: 5, happened: 'argued with boss', planned: null, changed: null, carry_over: null, notes: null }],
  settings: { sleep_goal_hours: 7.5, default_wake_time: '07:00', default_sleep_time: '23:00' },
};
const FROM = '2026-09-15', TO = '2026-09-28';

describe('buildExportData', () => {
  const d = buildExportData(input, FROM, TO, { now: NOW });

  it('uses the same numbers as the screens', () => {
    const s = summarize(profileDays({ blocks, activities, sleepIds: new Set(['z']), sessions: input.sessions }, keys, { now: NOW }));
    const days = d.tables.days;
    const col = (c: string) => days.columns.indexOf(c);
    const sumCol = (c: string) => days.rows.reduce((t, r) => t + (Number(r[col(c)]) || 0), 0);
    expect(days.rows).toHaveLength(14);
    expect(sumCol('tracked_min')).toBe(s.assignedMinutes);
    expect(sumCol('deep_min')).toBe(s.deepMinutes);
    expect(sumCol('waste_min')).toBe(s.wasteMinutes);
    expect(sumCol('ignored_min')).toBe(s.ignoredMinutes);
    const w = analyzeWaste({ blocks, activities, sleepIds: new Set(['z']) }, keys, { now: NOW });
    expect(d.tables.waste_stretches.rows).toHaveLength(w.stretches.length);
    expect(d.meta.days_with_tracking).toBe(14);
  });

  it('carries the daily energy rating into the days table (blank when not rated)', () => {
    const days = d.tables.days;
    const at = (k: string) => days.rows.find((r) => r[0] === k)!;
    expect(at('2026-09-22')[days.columns.indexOf('energy')]).toBe(5);
    expect(at('2026-09-23')[days.columns.indexOf('energy')]).toBeNull();
  });

  it('includes every section: definitions, summary, findings and tables', () => {
    expect(d.definitions.length).toBeGreaterThan(10);
    expect(d.summary.find((r) => r.metric.startsWith('waste per'))).toBeTruthy();
    expect(d.insights.focus.join(' ')).toContain('Focused on Secret Startup Coding');
    expect(d.insights.waste.join(' ')).toContain('YouTube Rabbit Hole');
    for (const t of ['days', 'activities', 'focus_runs', 'waste_stretches', 'timeline', 'sleep', 'habits', 'goals', 'tasks', 'reflections']) expect(d.tables[t]).toBeTruthy();
    expect(d.tables.activities.rows.find((r) => r[0] === 'Commute To Office')![3]).toBe('ignored');
  });

  it('anonymising removes every name and all free text', () => {
    const a = buildExportData(input, FROM, TO, { now: NOW, anonymise: true });
    const all = toJSON(a) + toMarkdown(a, 'full') + Object.values(toCSVs(a)).join('\n');
    for (const secret of ['Secret Startup Coding', 'YouTube Rabbit Hole', 'Commute To Office', 'auth', 'Private thing', 'Meditate secretly', 'Launch the secret app', 'my private plan', 'dreamt about my ex', 'argued with boss']) {
      expect(all).not.toContain(secret);
    }
    expect(all).toContain('Activity');
    expect(a.tables.reflections).toBeUndefined();
    expect(a.meta.anonymised).toBe(true);
  });

  it('respects the include switches', () => {
    const lean = buildExportData(input, FROM, TO, { now: NOW, include: { timeline: false, tasks: false, sleep: false, habits: false, goals: false, text: false } });
    for (const t of ['timeline', 'tasks', 'sleep', 'habits', 'goals', 'reflections']) expect(lean.tables[t]).toBeUndefined();
  });
});

describe('renderers', () => {
  const d = buildExportData(input, FROM, TO, { now: NOW });

  it('the AI pack briefs the model and is smaller in compact mode', () => {
    const full = toMarkdown(d, 'full');
    const compact = toMarkdown(d, 'compact');
    expect(full).toContain('## Brief for the AI reading this');
    expect(full).toContain('Untracked time is unknown, not idle');
    expect(full).toContain('## Definitions');
    expect(full).toContain('### Timeline');
    expect(compact).not.toContain('### Timeline');
    expect(compact.length).toBeLessThan(full.length);
    expect(full).not.toContain('NaN');
    expect(full).not.toContain('undefined');
  });

  it('CSV quoting survives commas, quotes and newlines, and row counts match', () => {
    const csv = tableToCSV({ title: '', description: '', columns: ['a', 'b'], rows: [['x, y', 'say "hi"'], ['line\nbreak', null]] });
    expect(csv).toBe('a,b\n"x, y","say ""hi"""\n"line\nbreak",');
    const files = toCSVs(d);
    expect(files['days.csv'].split('\n')).toHaveLength(15);
    expect(files['tasks.csv']).toContain('"Fix the ""auth"", bug"');
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['days.csv', 'activities.csv', 'timeline.csv', 'summary.csv', 'findings.csv', 'definitions.csv']));
  });

  it('JSON round-trips and carries the schema version', () => {
    const back = JSON.parse(toJSON(d));
    expect(back.schema_version).toBe(1);
    expect(back.tables.days.rows).toHaveLength(14);
  });

  it('estimates tokens and fetches enough history for comparisons', () => {
    expect(estimateTokens('a'.repeat(400))).toBe(100);
    expect(exportFetchStart('2026-09-15', '2026-09-28')).toBe('2026-08-18');
    expect(exportFetchStart('2026-06-01', '2026-09-28')).toBe('2026-02-01');
  });
});
