import { describe, expect, it } from 'vitest';
import { buildBackup, planImport, summarizePlan, validateBackup, type ExistingState } from './backup';
import { buildTaskTimeCsv } from './exportTasks';
import type { Task } from '../types';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const emptyExisting = (): ExistingState => ({
  ids: { activities: new Set(), habits: new Set(), tasks: new Set(), goals: new Set(), habit_logs: new Set(), sleep_logs: new Set(), task_focus_sessions: new Set() },
  blockSlots: new Set(), sleepDates: new Set(), hasSettings: false,
});

const data = {
  activities: [{ id: id(1), name: 'Study', color: '#fff', user_id: 'secret' }],
  habits: [{ id: id(2), name: 'Gym', type: 'event' }],
  tasks: [{ id: id(3), title: 'Report', activity_id: id(1) }, { id: id(4), title: 'Orphan', activity_id: id(99) }],
  time_blocks: [{ date_key: '2026-09-22', block_index: 5, activity_id: id(1), task_id: id(3), user_id: 'secret' }, { date_key: '2026-09-22', block_index: 6, activity_id: id(1) }],
  habit_logs: [{ id: id(5), habit_id: id(2), date_key: '2026-09-22' }, { id: id(6), habit_id: id(77), date_key: '2026-09-22' }],
  goals: [{ id: id(7), title: 'G', linked_activity_ids: [id(1), id(88)], linked_habit_ids: [id(2)] }],
  sleep_logs: [{ id: id(8), date_key: '2026-09-21' }],
  task_focus_sessions: [{ id: id(9), task_id: id(3), started_at: 'a', ended_at: 'b', duration_minutes: 25 }],
  settings: [{ sleep_goal_hours: 8, user_id: 'secret' }],
};

describe('buildBackup / validateBackup', () => {
  it('strips user_id and round-trips through validation', () => {
    const backup = buildBackup(data, new Date(2026, 8, 22));
    expect(JSON.stringify(backup)).not.toContain('secret');
    const r = validateBackup(JSON.parse(JSON.stringify(backup)));
    expect(r.ok).toBe(true);
    expect(r.backup?.version).toBe(1);
  });

  it('rejects wrong shapes, future versions and invalid rows', () => {
    expect(validateBackup(null).ok).toBe(false);
    expect(validateBackup([]).ok).toBe(false);
    expect(validateBackup({ version: 2 }).errors.join()).toMatch(/newer/);
    expect(validateBackup({ version: 1, tasks: [{ id: 'nope', title: 'x' }] }).errors.join()).toMatch(/tasks\[0\]/);
    expect(validateBackup({ version: 1, time_blocks: [{ date_key: '2026-09-22', block_index: 144 }] }).ok).toBe(false);
    expect(validateBackup({ version: 1, habits: 'x' }).ok).toBe(false);
  });

  it('missing tables are treated as empty', () => {
    const r = validateBackup({ version: 1 });
    expect(r.ok).toBe(true);
    expect(r.backup?.tasks).toEqual([]);
  });
});

describe('planImport', () => {
  const backup = validateBackup(JSON.parse(JSON.stringify(buildBackup(data)))).backup!;

  it('into an empty account writes everything valid, clearing dangling refs and skipping orphan logs', () => {
    const plan = planImport(backup, emptyExisting(), 'merge');
    const by = Object.fromEntries(summarizePlan(plan).map((s) => [s.table, s]));
    expect(by.activities.write).toBe(1);
    expect(by.time_blocks.write).toBe(2);
    expect(by.habit_logs).toEqual({ table: 'habit_logs', write: 1, skip: 1 });
    const tasks = plan.tables.find((t) => t.table === 'tasks')!.toWrite;
    expect(tasks.find((t) => t.id === id(4))?.activity_id).toBeNull();
    const goal = plan.tables.find((t) => t.table === 'goals')!.toWrite[0];
    expect(goal.linked_activity_ids).toEqual([id(1)]);
    expect(plan.warnings.length).toBeGreaterThan(0);
  });

  it('merge skips existing ids, block slots and sleep dates; never overwrites', () => {
    const ex = emptyExisting();
    ex.ids.activities.add(id(1));
    ex.blockSlots.add('2026-09-22_5');
    ex.sleepDates.add('2026-09-21');
    ex.hasSettings = true;
    const by = Object.fromEntries(summarizePlan(planImport(backup, ex, 'merge')).map((s) => [s.table, s]));
    expect(by.activities.write).toBe(0);
    expect(by.time_blocks).toEqual({ table: 'time_blocks', write: 1, skip: 1 });
    expect(by.sleep_logs.write).toBe(0);
    expect(by.settings.write).toBe(0);
  });

  it('overwrite writes matching rows too (but nothing is ever deleted)', () => {
    const ex = emptyExisting();
    ex.ids.activities.add(id(1));
    ex.blockSlots.add('2026-09-22_5');
    ex.hasSettings = true;
    const by = Object.fromEntries(summarizePlan(planImport(backup, ex, 'overwrite')).map((s) => [s.table, s]));
    expect(by.activities.write).toBe(1);
    expect(by.time_blocks.write).toBe(2);
    expect(by.settings.write).toBe(1);
  });
});

describe('buildTaskTimeCsv', () => {
  it('outputs a header and one row per task with escaped fields', () => {
    const tasks = [
      { id: 't1', title: 'Write, report', completed: false, activity_id: 'a', deadline: '2026-09-25T00:00:00.000Z', estimated_minutes: 60 },
    ] as Task[];
    const blocks = [{ date_key: '2020-01-01', block_index: 1, task_id: 't1' }];
    const csv = buildTaskTimeCsv(tasks, [{ id: 'a', name: 'Study', color: '#000' }], blocks, [], new Date(2026, 8, 22));
    const [head, row] = csv.split('\n');
    expect(head).toBe('task_id,task_title,activity,estimated_minutes,planned_minutes,tracked_minutes,focused_minutes,deadline,completed,completed_at');
    expect(row).toBe('t1,"Write, report",Study,60,0,10,0,2026-09-25,false,');
  });
});

describe('backups keep analysis settings and reflections', () => {
  const rich = {
    activities: [{ id: id(1), name: 'YouTube', color: '#f00', productivity_multiplier: -0.35, analysis_ignored: false, is_sleep_activity: false }, { id: id(2), name: 'Travel', color: '#999', analysis_ignored: true }],
    habits: [{ id: id(3), name: 'Gym', type: 'daily', frequency: 'times_per_week', target_count: 3, weekdays: null }],
    tasks: [{ id: id(4), title: 'T', completed: true, completed_at: '2026-09-20T10:00:00Z' }],
    sleep_logs: [{ id: id(5), date_key: '2026-09-21', energy: 4, factors: ['caffeine'] }],
    reviews: [{ id: id(6), period_type: 'week', period_key: '2026-09-21', happened: 'shipped', user_id: 'secret' }, { id: id(7), period_type: 'day', period_key: '2026-09-22', energy: 6 }],
  };

  it('multipliers, ignore flags, habit frequency, completion times, sleep factors and reviews survive build -> validate -> plan', () => {
    const b = buildBackup(rich);
    expect(JSON.stringify(b)).not.toContain('secret');
    const v = validateBackup(JSON.parse(JSON.stringify(b)));
    expect(v.ok).toBe(true);
    const plan = planImport(v.backup!, emptyExisting(), 'merge');
    const rows = (t: string) => plan.tables.find((p) => p.table === t)!.toWrite;
    expect(rows('activities')[0]).toMatchObject({ productivity_multiplier: -0.35, analysis_ignored: false });
    expect(rows('activities')[1]).toMatchObject({ analysis_ignored: true });
    expect(rows('habits')[0]).toMatchObject({ frequency: 'times_per_week', target_count: 3 });
    expect(rows('tasks')[0]).toMatchObject({ completed_at: '2026-09-20T10:00:00Z' });
    expect(rows('sleep_logs')[0]).toMatchObject({ energy: 4, factors: ['caffeine'] });
    expect(rows('reviews')[0]).toMatchObject({ period_type: 'week', happened: 'shipped' });
    expect(rows('reviews')[1]).toMatchObject({ period_type: 'day', energy: 6 });
  });

  it('merge skips a reflection whose period already exists; older backups without reviews still validate', () => {
    const b = buildBackup(rich);
    const ex = { ...emptyExisting(), reviewKeys: new Set(['week_2026-09-21']) };
    // the week review already exists (skipped on merge); the day review is new
    expect(planImport(b, ex, 'merge').tables.find((p) => p.table === 'reviews')!.toWrite).toHaveLength(1);
    expect(planImport(b, ex, 'overwrite').tables.find((p) => p.table === 'reviews')!.toWrite).toHaveLength(2);
    const old = JSON.parse(JSON.stringify(b));
    delete old.reviews;
    expect(validateBackup(old).ok).toBe(true);
    expect(validateBackup({ version: 1, reviews: [{ period_type: 'year', period_key: 'x' }] }).ok).toBe(false);
  });
});
