import { format, getDay, subDays } from 'date-fns';

export interface CopySource { label: string; dateKey: string }

/** Quick sources for "copy time pattern": yesterday, previous weekday (Mon-Fri), last Monday. */
export const getCopySources = (selected: Date): CopySource[] => {
  const key = (d: Date) => format(d, 'yyyy-MM-dd');
  const yesterday = subDays(selected, 1);

  let prevWeekday = subDays(selected, 1);
  while (getDay(prevWeekday) === 0 || getDay(prevWeekday) === 6) prevWeekday = subDays(prevWeekday, 1);

  // Most recent Monday strictly before the selected date
  let lastMonday = subDays(selected, 1);
  while (getDay(lastMonday) !== 1) lastMonday = subDays(lastMonday, 1);

  const out: CopySource[] = [
    { label: `Yesterday (${format(yesterday, 'EEE d MMM')})`, dateKey: key(yesterday) },
    { label: `Previous weekday (${format(prevWeekday, 'EEE d MMM')})`, dateKey: key(prevWeekday) },
    { label: `Last Monday (${format(lastMonday, 'd MMM')})`, dateKey: key(lastMonday) },
  ];
  // Drop duplicates (e.g. yesterday == previous weekday on a Tuesday)
  return out.filter((s, i) => out.findIndex((o) => o.dateKey === s.dateKey) === i);
};

export interface CopyPlan {
  toWrite: { block_index: number; activity_id: string }[];
  skippedFilled: number;
  skippedArchived: number;
}

/**
 * Plan copying a day's blocks onto the current day. Never overwrites: only empty target blocks are filled.
 * Task links and task completion are not copied. Archived activities are not scheduled again.
 */
export const planCopy = (
  source: { block_index: number; activity_id: string | null }[],
  target: { block_index: number; activity_id: string | null }[],
  archivedActivityIds: Set<string> = new Set()
): CopyPlan => {
  const filled = new Set(target.filter((b) => b.activity_id).map((b) => b.block_index));
  const plan: CopyPlan = { toWrite: [], skippedFilled: 0, skippedArchived: 0 };
  for (const s of source) {
    if (!s.activity_id) continue;
    if (filled.has(s.block_index)) { plan.skippedFilled++; continue; }
    if (archivedActivityIds.has(s.activity_id)) { plan.skippedArchived++; continue; }
    plan.toWrite.push({ block_index: s.block_index, activity_id: s.activity_id });
  }
  return plan;
};

