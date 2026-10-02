import React, { useRef, useState } from 'react';
import { Download, FileJson, Upload } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '../supabaseClient';
import { Button } from './ui/button';
import type { Activity, Task, TaskBlockRef, TaskFocusSession } from '../types';
import {
  BACKUP_TABLES, buildBackup, planImport, summarizePlan, validateBackup, type Backup, type BackupTable, type ExistingState, type ImportMode, type ImportPlan, type Row,
} from '../lib/backup';
import { buildTaskTimeCsv } from '../lib/exportTasks';
import { fetchAllRows } from '../lib/paging';
import { invalidateBlockRangeCache } from '../hooks/useBlockRange';
import { markActivityDirty, markDatesDirty, markGoalDirty } from '../lib/analyticsInvalidation';
import { Section } from './ui/detail';

interface BackupPanelProps {
  activities: Activity[];
  tasks: Task[];
  taskBlocks: TaskBlockRef[];
  focusSessions: TaskFocusSession[];
}

// The table names here are dynamic, so use an untyped handle (rows are validated by lib/backup first).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (t: string) => any };

const DB_TABLE: Record<BackupTable, string> = {
  activities: 'activities', habits: 'habits', tasks: 'tasks', goals: 'goals', time_blocks: 'time_blocks',
  habit_logs: 'habit_logs', sleep_logs: 'sleep_logs', task_focus_sessions: 'task_focus_sessions', settings: 'user_settings',
  reviews: 'reviews',
};
const CONFLICT: Record<BackupTable, string> = {
  activities: 'id', habits: 'id', tasks: 'id', goals: 'id', habit_logs: 'id', task_focus_sessions: 'id',
  time_blocks: 'user_id,date_key,block_index', sleep_logs: 'user_id,date_key', settings: 'user_id',
  reviews: 'user_id,period_type,period_key',
};
const LABEL: Record<BackupTable, string> = {
  activities: 'Activities', habits: 'Habits', tasks: 'Tasks', goals: 'Goals', time_blocks: 'Time blocks',
  habit_logs: 'Habit logs', sleep_logs: 'Sleep logs', task_focus_sessions: 'Focus sessions', settings: 'Settings',
  reviews: 'Reflections',
};

const download = (content: string, filename: string, mime: string) => {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

async function requireUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('Not signed in.');
  return data.user.id;
}

async function fetchTable(name: BackupTable, userId: string, columns = '*'): Promise<Row[]> {
  if (name === 'settings') {
    const { data, error } = await db.from('user_settings').select(columns).eq('user_id', userId);
    if (error) throw new Error(`${name}: ${error.message}`);
    return data ?? [];
  }
  const order = name === 'time_blocks' ? ['date_key', 'block_index'] : ['id'];
  const { data, error } = await fetchAllRows<Row>((from, to) => {
    let q = db.from(DB_TABLE[name]).select(columns).eq('user_id', userId);
    for (const o of order) q = q.order(o);
    return q.range(from, to);
  });
  if (error) throw new Error(`${name}: ${error.message}`);
  return data;
}

const dayOf = (ts: unknown) => (typeof ts === 'string' && ts ? format(new Date(ts), 'yyyy-MM-dd') : null);

/**
 * Imported rows bypass the normal mutation paths, so queue their analytics recomputation here: every day an
 * imported dated row lands on, plus every date of an imported activity or goal (an overwrite can change a
 * multiplier, focus demand or goal links that apply to days already in the database).
 */
function markImportDirty(userId: string, tables: ImportPlan['tables']) {
  const dates: (string | null)[] = [];
  for (const t of tables) {
    for (const r of t.toWrite) {
      if (t.table === 'time_blocks' || t.table === 'habit_logs' || t.table === 'sleep_logs') dates.push(r.date_key as string);
      else if (t.table === 'tasks') dates.push(r.date_key as string, dayOf(r.completed_at));
      else if (t.table === 'task_focus_sessions') dates.push(dayOf(r.started_at));
      else if (t.table === 'activities') void markActivityDirty(userId, r.id as string, 'backup_import');
      else if (t.table === 'goals') void markGoalDirty(userId, r.id as string, 'backup_import');
    }
  }
  void markDatesDirty(userId, dates, 'backup_import');
}

async function loadExisting(userId: string): Promise<ExistingState> {
  const idsOf = async (t: BackupTable) => new Set((await fetchTable(t, userId, 'id')).map((r) => r.id as string));
  const [activities, habits, tasks, goals, habit_logs, task_focus_sessions, sleepRows, blocks, settings, reviewRows] = await Promise.all([
    idsOf('activities'), idsOf('habits'), idsOf('tasks'), idsOf('goals'), idsOf('habit_logs'), idsOf('task_focus_sessions'),
    fetchTable('sleep_logs', userId, 'id, date_key'),
    fetchTable('time_blocks', userId, 'date_key, block_index'),
    fetchTable('settings', userId, 'user_id'),
    fetchTable('reviews', userId, 'id, period_type, period_key'),
  ]);
  return {
    ids: { activities, habits, tasks, goals, habit_logs, task_focus_sessions, sleep_logs: new Set(sleepRows.map((r) => r.id as string)) },
    blockSlots: new Set(blocks.map((r) => `${r.date_key}_${r.block_index}`)),
    sleepDates: new Set(sleepRows.map((r) => r.date_key as string)),
    hasSettings: settings.length > 0,
    reviewKeys: new Set(reviewRows.map((r) => `${r.period_type}_${r.period_key}`)),
  };
}

export const BackupPanel: React.FC<BackupPanelProps> = ({ activities, tasks, taskBlocks, focusSessions }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [backup, setBackup] = useState<Backup | null>(null);
  const [existing, setExisting] = useState<ExistingState | null>(null);
  const [mode, setMode] = useState<ImportMode>('merge');
  const [done, setDone] = useState(false);

  const plan: ImportPlan | null = backup && existing ? planImport(backup, existing, mode) : null;
  const totalWrite = plan ? plan.tables.reduce((n, t) => n + t.toWrite.length, 0) : 0;

  const downloadTaskCsv = () => {
    download(buildTaskTimeCsv(tasks, activities, taskBlocks, focusSessions), `blockday-task-time-${format(new Date(), 'yyyy-MM-dd')}.csv`, 'text/csv;charset=utf-8');
  };

  const downloadBackup = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const userId = await requireUserId();
      const data: Partial<Record<BackupTable, Row[]>> = {};
      for (const t of BACKUP_TABLES) data[t] = await fetchTable(t, userId);
      const b = buildBackup(data);
      download(JSON.stringify(b, null, 2), `blockday-backup-${format(new Date(), 'yyyy-MM-dd-HHmm')}.json`, 'application/json');
      setMessage({ kind: 'ok', text: `Backup downloaded: ${b.time_blocks.length} blocks, ${b.tasks.length} tasks, ${b.habit_logs.length} habit logs.` });
    } catch (e) {
      setMessage({ kind: 'error', text: `Backup failed: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File | undefined) => {
    setBackup(null); setExisting(null); setErrors([]); setMessage(null); setDone(false);
    if (!file) return;
    setBusy(true);
    try {
      let raw: unknown;
      try { raw = JSON.parse(await file.text()); } catch { setErrors(['This file is not valid JSON.']); return; }
      const result = validateBackup(raw);
      if (!result.ok || !result.backup) { setErrors(result.errors); return; }
      const userId = await requireUserId();
      setExisting(await loadExisting(userId));
      setBackup(result.backup);
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const runImport = async () => {
    if (!plan) return;
    if (mode === 'overwrite' && !window.confirm('Overwrite matching rows with the versions in this file? Rows that are not in the file are kept. Tip: download a backup of your current data first.')) return;
    setBusy(true);
    setMessage(null);
    try {
      const userId = await requireUserId();
      for (const t of plan.tables) {
        if (t.toWrite.length === 0) continue;
        for (let i = 0; i < t.toWrite.length; i += 500) {
          const chunk = t.toWrite.slice(i, i + 500).map((r) => ({ ...r, user_id: userId }));
          const { error } = await db.from(DB_TABLE[t.table]).upsert(chunk, { onConflict: CONFLICT[t.table], ignoreDuplicates: mode === 'merge' });
          if (error) throw new Error(`${LABEL[t.table]}: ${error.message}`);
        }
      }
      invalidateBlockRangeCache();
      markImportDirty(userId, plan.tables);
      setDone(true);
      setMessage({ kind: 'ok', text: `Imported ${totalWrite} row(s). Reload to see them.` });
      setBackup(null);
    } catch (e) {
      setMessage({ kind: 'error', text: `Import stopped: ${(e as Error).message}. Rows written before the error are kept; re-running a merge is safe.` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section id="backup" detail title="Backup, restore and task time" summary="import never deletes anything">
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">Import never deletes anything.</p>

      <div className="flex flex-col sm:flex-row gap-2">
        <Button onClick={downloadTaskCsv} variant="outline" className="flex-1 min-h-[44px] gap-2">
          <Download className="w-4 h-4" /> Task time (.csv)
        </Button>
        <Button onClick={downloadBackup} disabled={busy} variant="outline" className="flex-1 min-h-[44px] gap-2">
          <FileJson className="w-4 h-4" /> Full backup (.json)
        </Button>
        <Button onClick={() => fileRef.current?.click()} disabled={busy} variant="outline" className="flex-1 min-h-[44px] gap-2">
          <Upload className="w-4 h-4" /> Import backup…
        </Button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      </div>

      {errors.length > 0 && (
        <ul className="text-xs text-red-500 list-disc pl-5" role="alert">
          {errors.slice(0, 6).map((e) => <li key={e}>{e}</li>)}
          {errors.length > 6 && <li>…and {errors.length - 6} more</li>}
        </ul>
      )}

      {plan && (
        <div className="space-y-3 border border-border rounded-lg p-3">
          <div className="text-xs text-muted-foreground">
            Backup from {backup?.exported_at ? format(new Date(backup.exported_at), 'd MMM yyyy HH:mm') : 'unknown date'}
          </div>
          <div className="flex gap-4 text-sm" role="radiogroup" aria-label="Import mode">
            <label className="flex items-center gap-2"><input type="radio" checked={mode === 'merge'} onChange={() => setMode('merge')} /> Merge (skip what exists)</label>
            <label className="flex items-center gap-2"><input type="radio" checked={mode === 'overwrite'} onChange={() => setMode('overwrite')} /> Overwrite matching</label>
          </div>
          <table className="w-full text-xs">
            <thead><tr className="text-left text-muted-foreground"><th className="py-1">Table</th><th>Will write</th><th>Skipped</th></tr></thead>
            <tbody>
              {summarizePlan(plan).map((s) => (
                <tr key={s.table} className="border-t border-border"><td className="py-1">{LABEL[s.table]}</td><td>{s.write}</td><td>{s.skip}</td></tr>
              ))}
            </tbody>
          </table>
          {plan.warnings.map((w) => <p key={w} className="text-xs text-amber-600 dark:text-amber-400">{w}</p>)}
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => { setBackup(null); setExisting(null); }} disabled={busy}>Cancel</Button>
            <Button onClick={runImport} disabled={busy || totalWrite === 0}>{busy ? 'Importing…' : `Import ${totalWrite} row(s)`}</Button>
          </div>
        </div>
      )}

      {message && (
        <p className={`text-xs ${message.kind === 'error' ? 'text-red-500' : 'text-green-600 dark:text-green-400'}`} role="status">
          {message.text} {done && <button className="underline" onClick={() => window.location.reload()}>Reload now</button>}
        </p>
      )}
    </div>
    </Section>
  );
};
