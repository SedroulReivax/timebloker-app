/**
 * JSON backup format (version 1) and safe import planning.
 * Import never deletes anything: "merge" skips rows that already exist, "overwrite" replaces rows with the
 * same id (or block slot) and leaves everything else untouched.
 */

export const BACKUP_VERSION = 1;

export type Row = Record<string, unknown>;

export const BACKUP_TABLES = [
  'activities', 'habits', 'tasks', 'goals', 'time_blocks', 'habit_logs', 'sleep_logs', 'task_focus_sessions', 'settings', 'reviews',
] as const;
export type BackupTable = (typeof BACKUP_TABLES)[number];

export interface Backup {
  version: number;
  exported_at: string;
  /** the app's former name; kept so backups made before the rename still import */
  app: 'blockday';
  activities: Row[];
  habits: Row[];
  tasks: Row[];
  goals: Row[];
  time_blocks: Row[];
  habit_logs: Row[];
  sleep_logs: Row[];
  task_focus_sessions: Row[];
  settings: Row[];
  /** day/week/month reflections (absent in older backups) */
  reviews: Row[];
}

/** Columns kept per table (user_id is never exported; it is set from the importing account). */
export const TABLE_COLUMNS: Record<BackupTable, string[]> = {
  activities: ['id', 'name', 'color', 'description', 'archived', 'created_at', 'category', 'emoji', 'is_sleep_activity', 'productivity_multiplier', 'analysis_ignored'],
  habits: ['id', 'name', 'type', 'color', 'description', 'created_at', 'frequency', 'target_count', 'weekdays'],
  tasks: ['id', 'title', 'completed', 'activity_id', 'date_key', 'urgency', 'importance', 'estimated_pomodoros', 'completed_pomodoros', 'created_at', 'description', 'deadline', 'recurrence_type', 'recurrence_rule', 'estimated_minutes', 'completed_at'],
  goals: ['id', 'title', 'description', 'target_date', 'target_hours', 'emoji', 'status', 'linked_activity_ids', 'linked_habit_ids', 'created_at', 'updated_at', 'completion_note'],
  time_blocks: ['date_key', 'block_index', 'activity_id', 'task_id', 'notes', 'created_at'],
  habit_logs: ['id', 'habit_id', 'date_key', 'logged_at', 'notes'],
  sleep_logs: ['id', 'date_key', 'sleep_time', 'wake_time', 'total_minutes', 'quality', 'notes', 'created_at', 'energy', 'factors'],
  task_focus_sessions: ['id', 'task_id', 'activity_id', 'timer_type', 'started_at', 'ended_at', 'duration_minutes', 'created_at'],
  settings: ['default_wake_time', 'default_sleep_time', 'sleep_goal_hours', 'enable_animations', 'created_at', 'updated_at'],
  reviews: ['id', 'period_type', 'period_key', 'planned', 'happened', 'changed', 'carry_over', 'notes', 'energy', 'created_at', 'updated_at'],
};

const pick = (row: Row, cols: string[]): Row => {
  const out: Row = {};
  for (const c of cols) if (c in row && row[c] !== undefined) out[c] = row[c];
  return out;
};

export const buildBackup = (data: Partial<Record<BackupTable, Row[]>>, now: Date = new Date()): Backup => {
  const t = (name: BackupTable): Row[] => (data[name] ?? []).map((r) => pick(r, TABLE_COLUMNS[name]));
  return {
    version: BACKUP_VERSION,
    exported_at: now.toISOString(),
    app: 'blockday',
    activities: t('activities'),
    habits: t('habits'),
    tasks: t('tasks'),
    goals: t('goals'),
    time_blocks: t('time_blocks'),
    habit_logs: t('habit_logs'),
    sleep_logs: t('sleep_logs'),
    task_focus_sessions: t('task_focus_sessions'),
    settings: t('settings'),
    reviews: t('reviews'),
  };
};

// ─── Validation ──────────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface ValidationResult { ok: boolean; errors: string[]; backup: Backup | null }

export const validateBackup = (raw: unknown): ValidationResult => {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['Not a TimeBloker backup (expected a JSON object).'], backup: null };
  const o = raw as Record<string, unknown>;
  if (typeof o.version !== 'number') errors.push('Missing backup version.');
  else if (o.version > BACKUP_VERSION) errors.push(`Backup version ${o.version} is newer than this app supports (${BACKUP_VERSION}).`);
  else if (o.version < 1) errors.push(`Invalid backup version ${o.version}.`);

  const tables: Partial<Record<BackupTable, Row[]>> = {};
  for (const name of BACKUP_TABLES) {
    const v = o[name];
    if (v === undefined) { tables[name] = []; continue; }
    if (!Array.isArray(v) || v.some((r) => !r || typeof r !== 'object' || Array.isArray(r))) {
      errors.push(`"${name}" must be an array of objects.`);
      tables[name] = [];
      continue;
    }
    tables[name] = v as Row[];
  }

  const need = (name: BackupTable, test: (r: Row) => boolean, what: string) => {
    const bad = (tables[name] ?? []).findIndex((r) => !test(r));
    if (bad >= 0) errors.push(`${name}[${bad}]: ${what}`);
  };
  for (const name of ['activities', 'habits', 'tasks', 'goals', 'habit_logs', 'sleep_logs', 'task_focus_sessions'] as BackupTable[]) {
    need(name, (r) => typeof r.id === 'string' && UUID.test(r.id), 'missing or invalid id');
  }
  need('activities', (r) => typeof r.name === 'string' && typeof r.color === 'string', 'needs name and color');
  need('habits', (r) => typeof r.name === 'string' && (r.type === 'daily' || r.type === 'event'), 'needs name and type daily|event');
  need('tasks', (r) => typeof r.title === 'string', 'needs a title');
  need('goals', (r) => typeof r.title === 'string', 'needs a title');
  need('time_blocks', (r) => typeof r.date_key === 'string' && DATE.test(r.date_key) && Number.isInteger(r.block_index) && (r.block_index as number) >= 0 && (r.block_index as number) <= 143, 'needs date_key (YYYY-MM-DD) and block_index 0-143');
  need('habit_logs', (r) => typeof r.habit_id === 'string' && UUID.test(r.habit_id), 'missing habit_id');
  need('sleep_logs', (r) => typeof r.date_key === 'string' && DATE.test(r.date_key), 'needs date_key (YYYY-MM-DD)');
  need('reviews', (r) => (r.period_type === 'day' || r.period_type === 'week' || r.period_type === 'month') && typeof r.period_key === 'string', 'needs period_type day|week|month and period_key');
  need('task_focus_sessions', (r) => typeof r.started_at === 'string' && typeof r.ended_at === 'string' && Number.isInteger(r.duration_minutes), 'needs started_at, ended_at, duration_minutes');

  if (errors.length > 0) return { ok: false, errors, backup: null };
  return {
    ok: true,
    errors: [],
    backup: {
      version: o.version as number,
      exported_at: typeof o.exported_at === 'string' ? o.exported_at : '',
      app: 'blockday',
      activities: tables.activities!, habits: tables.habits!, tasks: tables.tasks!, goals: tables.goals!,
      time_blocks: tables.time_blocks!, habit_logs: tables.habit_logs!, sleep_logs: tables.sleep_logs!,
      task_focus_sessions: tables.task_focus_sessions!, settings: tables.settings!, reviews: tables.reviews!,
    },
  };
};

// ─── Import planning ─────────────────────────────────────────────────────────

export type ImportMode = 'merge' | 'overwrite';

export interface ExistingState {
  ids: Record<'activities' | 'habits' | 'tasks' | 'goals' | 'habit_logs' | 'sleep_logs' | 'task_focus_sessions', Set<string>>;
  /** "date_key_block_index" of filled/existing block rows. */
  blockSlots: Set<string>;
  sleepDates: Set<string>;
  hasSettings: boolean;
  /** "period_type_period_key" of existing reviews (one per period) */
  reviewKeys?: Set<string>;
}

export interface TablePlan { table: BackupTable; incoming: number; toWrite: Row[]; skipped: number }
export interface ImportPlan {
  mode: ImportMode;
  tables: TablePlan[];
  warnings: string[];
}

const slot = (r: Row) => `${r.date_key}_${r.block_index}`;

/**
 * Decide what to write. Row order follows foreign-key dependencies. Optional references to rows that exist in
 * neither the backup nor the account are nulled (with a warning); rows whose required parent is missing are skipped.
 */
export const planImport = (backup: Backup, existing: ExistingState, mode: ImportMode): ImportPlan => {
  const warnings: string[] = [];
  const known = {
    activities: new Set<string>([...existing.ids.activities, ...backup.activities.map((r) => r.id as string)]),
    habits: new Set<string>([...existing.ids.habits, ...backup.habits.map((r) => r.id as string)]),
    tasks: new Set<string>([...existing.ids.tasks, ...backup.tasks.map((r) => r.id as string)]),
  };
  let nulledRefs = 0;
  const cleanRef = (row: Row, col: string, set: Set<string>): Row => {
    const v = row[col];
    if (typeof v === 'string' && !set.has(v)) { nulledRefs++; return { ...row, [col]: null }; }
    return row;
  };

  const byId = (name: 'activities' | 'habits' | 'tasks' | 'goals' | 'habit_logs' | 'task_focus_sessions' | 'sleep_logs', rows: Row[]): TablePlan => {
    const seen = existing.ids[name];
    const toWrite = mode === 'merge' ? rows.filter((r) => !seen.has(r.id as string)) : rows;
    return { table: name, incoming: rows.length, toWrite, skipped: rows.length - toWrite.length };
  };

  const plans: TablePlan[] = [];
  plans.push(byId('activities', backup.activities.map((r) => pick(r, TABLE_COLUMNS.activities))));
  plans.push(byId('habits', backup.habits.map((r) => pick(r, TABLE_COLUMNS.habits))));
  plans.push(byId('tasks', backup.tasks.map((r) => cleanRef(pick(r, TABLE_COLUMNS.tasks), 'activity_id', known.activities))));
  plans.push(byId('goals', backup.goals.map((r) => {
    const g = pick(r, TABLE_COLUMNS.goals);
    for (const [col, set] of [['linked_activity_ids', known.activities], ['linked_habit_ids', known.habits]] as const) {
      if (Array.isArray(g[col])) g[col] = (g[col] as string[]).filter((id) => set.has(id));
    }
    return g;
  })));

  const blockRows = backup.time_blocks.map((r) => cleanRef(cleanRef(pick(r, TABLE_COLUMNS.time_blocks), 'activity_id', known.activities), 'task_id', known.tasks));
  const blocksToWrite = mode === 'merge' ? blockRows.filter((r) => !existing.blockSlots.has(slot(r))) : blockRows;
  plans.push({ table: 'time_blocks', incoming: blockRows.length, toWrite: blocksToWrite, skipped: blockRows.length - blocksToWrite.length });

  const logs = backup.habit_logs.map((r) => pick(r, TABLE_COLUMNS.habit_logs));
  const logsWithHabit = logs.filter((r) => known.habits.has(r.habit_id as string));
  if (logsWithHabit.length < logs.length) warnings.push(`${logs.length - logsWithHabit.length} habit log(s) skipped: their habit is not in the backup or your account.`);
  const logPlan = byId('habit_logs', logsWithHabit);
  logPlan.incoming = logs.length;
  logPlan.skipped += logs.length - logsWithHabit.length;
  plans.push(logPlan);

  const sleepRows = backup.sleep_logs.map((r) => pick(r, TABLE_COLUMNS.sleep_logs));
  const sleepToWrite = mode === 'merge' ? sleepRows.filter((r) => !existing.ids.sleep_logs.has(r.id as string) && !existing.sleepDates.has(r.date_key as string)) : sleepRows;
  plans.push({ table: 'sleep_logs', incoming: sleepRows.length, toWrite: sleepToWrite, skipped: sleepRows.length - sleepToWrite.length });

  plans.push(byId('task_focus_sessions', backup.task_focus_sessions.map((r) => cleanRef(cleanRef(pick(r, TABLE_COLUMNS.task_focus_sessions), 'task_id', known.tasks), 'activity_id', known.activities))));

  const settings = backup.settings.slice(0, 1).map((r) => pick(r, TABLE_COLUMNS.settings));
  const writeSettings = settings.length > 0 && (mode === 'overwrite' || !existing.hasSettings);
  plans.push({ table: 'settings', incoming: settings.length, toWrite: writeSettings ? settings : [], skipped: settings.length - (writeSettings ? settings.length : 0) });

  const reviewRows = backup.reviews.map((r) => pick(r, TABLE_COLUMNS.reviews));
  const reviewKeys = existing.reviewKeys ?? new Set<string>();
  const reviewsToWrite = mode === 'merge' ? reviewRows.filter((r) => !reviewKeys.has(`${r.period_type}_${r.period_key}`)) : reviewRows;
  plans.push({ table: 'reviews', incoming: reviewRows.length, toWrite: reviewsToWrite, skipped: reviewRows.length - reviewsToWrite.length });

  if (nulledRefs > 0) warnings.push(`${nulledRefs} reference(s) to missing activities/tasks were cleared.`);
  return { mode, tables: plans, warnings };
};

export const summarizePlan = (plan: ImportPlan): { table: BackupTable; write: number; skip: number }[] =>
  plan.tables.filter((t) => t.incoming > 0).map((t) => ({ table: t.table, write: t.toWrite.length, skip: t.skipped }));
