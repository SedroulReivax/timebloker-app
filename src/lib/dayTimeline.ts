import { BLOCK_MINUTES } from './taskTime';

export interface DayBlock { block_index: number; activity_id: string | null; task_id?: string | null }

export type SegmentKind = 'tracked' | 'untracked' | 'future';

export interface TimelineSegment {
  kind: SegmentKind;
  startIdx: number;
  /** inclusive */
  endIdx: number;
  activityId: string | null;
  taskId: string | null;
  minutes: number;
}

/**
 * Merge a day's 144 blocks into chronological segments. Adjacent blocks merge when they share the same
 * kind, activity and task. `elapsedBlocks` marks where "future" starts (144 for past days).
 */
export const buildTimeline = (blocks: DayBlock[], elapsedBlocks: number = 144): TimelineSegment[] => {
  const byIndex = new Map(blocks.map((b) => [b.block_index, b]));
  const segments: TimelineSegment[] = [];
  for (let i = 0; i < 144; i++) {
    const b = byIndex.get(i);
    const future = i >= elapsedBlocks;
    const kind: SegmentKind = future ? 'future' : b?.activity_id ? 'tracked' : 'untracked';
    // Planned (future) blocks that already have an activity are still shown as planned
    const activityId = b?.activity_id ?? null;
    const taskId = b?.task_id ?? null;
    const last = segments[segments.length - 1];
    if (last && last.kind === kind && last.activityId === activityId && last.taskId === taskId && last.endIdx === i - 1) {
      last.endIdx = i;
      last.minutes += BLOCK_MINUTES;
    } else {
      segments.push({ kind, startIdx: i, endIdx: i, activityId, taskId, minutes: BLOCK_MINUTES });
    }
  }
  return segments;
};

const to12h = (blockIdx: number): string => {
  const total = (blockIdx % 144) * BLOCK_MINUTES;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

/** "9:00 AM–10:20 AM" for a segment. */
export const formatSegmentRange = (s: Pick<TimelineSegment, 'startIdx' | 'endIdx'>): string =>
  `${to12h(s.startIdx)}–${to12h(s.endIdx + 1)}`;
