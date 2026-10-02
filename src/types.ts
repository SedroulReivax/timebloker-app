export type ActivityCategory = 'Work' | 'Leisure' | 'Health' | 'Admin' | 'Other';

export interface Activity {
  id: string;
  name: string;
  color: string;
  category?: ActivityCategory;
  emoji?: string;
  archived?: boolean;
  description?: string | null;
  is_sleep_activity?: boolean | null;
  /** How much this activity counts toward the productivity score, per minute. 0 = neutral, negative = counts against you. */
  productivity_multiplier?: number | null;
  /** Tracked but never judged: excluded from focus, waste and productivity (e.g. travel). Sleep is always ignored. */
  analysis_ignored?: boolean | null;
}

export interface Task {
  id: string;
  title: string;
  completed: boolean;
  activity_id: string | null;
  date_key?: string;
  urgency?: boolean | null;
  importance?: boolean | null;
  estimated_minutes?: number | null;
  completed_at?: string | null;
  estimated_pomodoros?: number;
  completed_pomodoros?: number;
  description?: string;
  deadline?: string;
  recurrence_type?: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';
  recurrence_rule?: string;
}

export interface Block {
  block_index: number;
  activity_id: string | null;
  task_id?: string | null;
  date_key: string;
  user_id: string;
}

/** Task-linked block reference across all dates (used for per-task time summaries). */
export interface TaskBlockRef {
  date_key: string;
  block_index: number;
  task_id: string;
}

export interface Habit {
  id: string;
  name: string;
  type?: 'daily' | 'event';
  streak?: number;
  completedToday?: boolean;
}

export interface TimeBlock {
  id: string;      // e.g., "09:00"
  time: string;    // e.g., "9:00 AM"
  activityId: string | null;
  taskId: string | null;
}

export const DEFAULT_ACTIVITIES: Activity[] = [
  { id: 'work-1', name: 'Deep Work', color: '#000000', category: 'Work' },
  { id: 'leisure-1', name: 'Reading', color: '#555555', category: 'Leisure' },
  { id: 'health-1', name: 'Workout', color: '#888888', category: 'Health' },
  { id: 'admin-1', name: 'Emails', color: '#cccccc', category: 'Admin' },
];

export const generateDailyBlocks = (): TimeBlock[] => {
  const blocks: TimeBlock[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 10) {
      const hh = h.toString().padStart(2, '0');
      const mm = m.toString().padStart(2, '0');
      const id = `${hh}:${mm}`;
      
      const ampm = h >= 12 ? 'PM' : 'AM';
      const displayH = h % 12 === 0 ? 12 : h % 12;
      const time = `${displayH}:${mm} ${ampm}`;
      
      blocks.push({ id, time, activityId: null, taskId: null });
    }
  }
  return blocks;
};

// Row types derived from the generated Supabase schema (src/database.types.ts).
import type { Database } from './database.types';
type Row<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];

export type Goal = Row<'goals'>;
export type SleepLog = Row<'sleep_logs'>;
export type HabitLog = Row<'habit_logs'>;
export type TaskFocusSession = Row<'task_focus_sessions'>;
export type DailyStats = Row<'daily_stats'>;
export type Review = Row<'reviews'>;
export type UserSettings = Row<'user_settings'>;
