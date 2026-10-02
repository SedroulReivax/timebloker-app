import React from 'react';
import { Grid2x2 } from 'lucide-react';
import type { Activity, TaskFocusSession } from '../types';
import type { RangeBlock } from '../lib/blockRange';
import { FocusDayView, PatternsDayView, TrendsDayView, WasteDayView } from './DayModeViews';
import { LazyMount } from './ui/detail';

interface DayFullAnalysisProps {
  activities: Activity[];
  focusSessions: TaskFocusSession[];
  blocks: RangeBlock[];
  selectedDate: Date;
  /** jump to the 24h grid for this day */
  onOpenTracker?: () => void;
}

const SECTIONS = [
  { id: 'day-vs-typical', label: 'vs typical' },
  { id: 'day-focus', label: 'Focus' },
  { id: 'day-waste', label: 'Waste' },
  { id: 'day-flow', label: 'Flow' },
] as const;

const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

const Heading: React.FC<{ id: string; children: React.ReactNode }> = ({ id, children }) => (
  <h2 id={id} className="text-base font-semibold pt-4 scroll-mt-16">{children}</h2>
);

/**
 * Analysis → Day, below the day summary: every analysis the other tabs run, for this one day. Uses the same
 * single-day views as the "Day" option in Trends, Focus, Waste and Patterns, so the numbers always match.
 * Each part mounts only as it scrolls near, so the summary above paints straight away.
 */
export const DayFullAnalysis: React.FC<DayFullAnalysisProps> = ({ onOpenTracker, ...props }) => (
  <div className="w-full space-y-3">
    <nav aria-label="This day's analysis" className="sticky top-0 z-10 -mx-1 px-1 py-2 bg-background/90 backdrop-blur flex items-center gap-1.5 overflow-x-auto no-scrollbar">
      {SECTIONS.map((s) => (
        <button key={s.id} onClick={() => jump(s.id)} className="px-3 py-1 min-h-[32px] text-xs rounded-full bg-muted text-muted-foreground hover:bg-accent hover:text-foreground whitespace-nowrap flex-shrink-0">
          {s.label}
        </button>
      ))}
      {onOpenTracker && (
        <button onClick={onOpenTracker} className="ml-auto inline-flex items-center gap-1.5 px-3 py-1 min-h-[32px] text-xs rounded-full border border-border hover:bg-accent whitespace-nowrap flex-shrink-0" title="Open this day in the 24h grid" aria-label="Open this day in the tracker">
          <Grid2x2 size={12} /><span className="hidden sm:inline">Open in tracker</span>
        </button>
      )}
    </nav>

    <Heading id="day-vs-typical">Against your typical day</Heading>
    <LazyMount minHeight={320}><TrendsDayView {...props} embedded /></LazyMount>
    <Heading id="day-focus">Focus</Heading>
    <LazyMount minHeight={420}><FocusDayView {...props} embedded /></LazyMount>
    <Heading id="day-waste">Waste</Heading>
    <LazyMount minHeight={240}><WasteDayView {...props} embedded /></LazyMount>
    <Heading id="day-flow">Flow and tracking gaps</Heading>
    <LazyMount minHeight={200}><PatternsDayView {...props} embedded /></LazyMount>
  </div>
);
