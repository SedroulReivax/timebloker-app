/**
 * Task time semantics (kept separate on purpose):
 * - estimated:  expected effort (tasks.estimated_minutes, else estimated_pomodoros * 25)
 * - scheduled:  10-min blocks linked to the task whose start is still in the future (a plan)
 * - tracked:    10-min blocks linked to the task whose start has passed (what was recorded)
 * - focused:    real timer durations from focus sessions
 */

export const BLOCK_MINUTES = 10;
export const POMODORO_MINUTES = 25;

export interface TaskTimeBlock { date_key: string; block_index: number; task_id?: string | null }
export interface TaskTimeSession { task_id?: string | null; duration_minutes: number }
export interface TaskEstimateSource { estimated_minutes?: number | null; estimated_pomodoros?: number | null }

export interface TaskTimeSummary {
  estimatedMinutes: number | null;
  scheduledMinutes: number;
  trackedMinutes: number;
  focusedMinutes: number;
  /** tracked / estimated, or null without an estimate. Not a productivity score. */
  progress: number | null;
  remainingMinutes: number | null;
  /** tracked - estimated (positive = took longer than estimated), or null without an estimate. */
  estimateErrorMinutes: number | null;
}

export const getEstimatedMinutes = (task: TaskEstimateSource): number | null => {
  if (task.estimated_minutes && task.estimated_minutes > 0) return task.estimated_minutes;
  if (task.estimated_pomodoros && task.estimated_pomodoros > 0) return task.estimated_pomodoros * POMODORO_MINUTES;
  return null;
};

/**
 * An estimate the user actually made, for calibration. Every new task gets `estimated_pomodoros = 1` by default, so a
 * lone "1 pomodoro" is indistinguishable from "never estimated" and is not treated as a 25-minute estimate here.
 * Explicit minutes always count; 2+ pomodoros count (nobody gets those by default).
 */
export const getExplicitEstimateMinutes = (task: TaskEstimateSource): number | null => {
  if (task.estimated_minutes && task.estimated_minutes > 0) return task.estimated_minutes;
  if (task.estimated_pomodoros && task.estimated_pomodoros > 1) return task.estimated_pomodoros * POMODORO_MINUTES;
  return null;
};

/** Local start time of a block. */
export const blockStart = (dateKey: string, blockIndex: number): Date => {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d, 0, blockIndex * BLOCK_MINUTES);
};

export const summarizeTaskTime = (
  task: TaskEstimateSource & { id: string },
  blocks: TaskTimeBlock[],
  sessions: TaskTimeSession[],
  now: Date = new Date()
): TaskTimeSummary => {
  let scheduled = 0;
  let tracked = 0;
  for (const b of blocks) {
    if (b.task_id !== task.id) continue;
    if (blockStart(b.date_key, b.block_index) > now) scheduled += BLOCK_MINUTES;
    else tracked += BLOCK_MINUTES;
  }
  const focused = sessions.filter(s => s.task_id === task.id).reduce((sum, s) => sum + s.duration_minutes, 0);
  const estimated = getEstimatedMinutes(task);
  return {
    estimatedMinutes: estimated,
    scheduledMinutes: scheduled,
    trackedMinutes: tracked,
    focusedMinutes: focused,
    progress: estimated ? tracked / estimated : null,
    remainingMinutes: estimated ? Math.max(0, estimated - tracked) : null,
    estimateErrorMinutes: estimated ? tracked - estimated : null,
  };
};

/** "1h 40m" / "25m" / "0m". */
export const formatMinutes = (minutes: number): string => {
  const whole = Math.round(minutes); // round first, so 119.6 is 2h and not "1h 60m"
  const h = Math.floor(whole / 60);
  const m = whole % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
};
