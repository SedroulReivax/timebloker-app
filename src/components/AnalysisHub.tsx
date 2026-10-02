import React, { Suspense, lazy, useState } from 'react';
import type { Activity, Goal, Habit, HabitLog, Review, SleepLog, Task, TaskBlockRef, TaskFocusSession } from '../types';
import type { RangeBlock } from '../lib/blockRange';
import { DayView, type ReflectionFields } from './DayView';
import { PageSkeleton } from './ui/skeleton';
import { AnalysisNavProvider } from './ui/analysisNav';

// Each tab is its own chunk: opening Analysis only loads the Day tab, and a tab's code is fetched on first hover.
const load = {
  trends: () => import('./TrendsTab'),
  focus: () => import('./FocusTab'),
  waste: () => import('./WasteTab'),
  patterns: () => import('./PatternsTab'),
  execution: () => import('./ExecutionTab'),
  review: () => import('./ReviewPage'),
  day: () => import('./DayFullAnalysis'),
};
const TrendsTab = lazy(() => load.trends().then((m) => ({ default: m.TrendsTab })));
const FocusTab = lazy(() => load.focus().then((m) => ({ default: m.FocusTab })));
const WasteTab = lazy(() => load.waste().then((m) => ({ default: m.WasteTab })));
const PatternsTab = lazy(() => load.patterns().then((m) => ({ default: m.PatternsTab })));
const ExecutionTab = lazy(() => load.execution().then((m) => ({ default: m.ExecutionTab })));
const ReviewPage = lazy(() => load.review().then((m) => ({ default: m.ReviewPage })));
const DayFullAnalysis = lazy(() => load.day().then((m) => ({ default: m.DayFullAnalysis })));
import type { ReviewPeriod } from '../lib/reviews';
import { format } from 'date-fns';

interface AnalysisHubProps {
  activities: Activity[];
  tasks: Task[];
  taskBlocks: TaskBlockRef[];
  focusSessions: TaskFocusSession[];
  goals: Goal[];
  habits: (Habit & { created_at?: string | null; frequency?: string | null; weekdays?: number[] | null; target_count?: number | null })[];
  habitLogs: HabitLog[];
  reviews: Review[];
  sleepLogs?: SleepLog[];
  /** Live blocks of the selected date (optimistic). */
  blocks: (RangeBlock & { date_key: string })[];
  selectedDate: Date;
  /** day reflections also carry `energy` (1-7); week/month ones don't */
  onSaveReview: (periodType: 'day' | 'week' | 'month', periodKey: string, fields: ReflectionFields & { energy?: number | null }) => void;
  /** controlled tab (lets the tracker's "Analyse day" shortcut open the Day tab); uncontrolled when omitted */
  tab?: AnalysisTab;
  onTabChange?: (tab: AnalysisTab) => void;
  /** open the selected day in the 24h grid */
  onOpenTracker?: () => void;
  /** open Settings → Analysis (multipliers, ignore, focus demand) from a "set it up" prompt */
  onOpenSettings?: () => void;
}

export type AnalysisTab = 'day' | 'trends' | 'focus' | 'waste' | 'patterns' | 'execution' | 'review';
type Tab = AnalysisTab;

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'day', label: 'Day', hint: 'Where did this day go?' },
  { id: 'trends', label: 'Trends', hint: 'How are things changing?' },
  { id: 'focus', label: 'Focus', hint: 'When and on what have I focused?' },
  { id: 'waste', label: 'Waste', hint: 'Where does wasted time go, and what leads to it?' },
  { id: 'patterns', label: 'Patterns', hint: 'What follows what, sleep vs the next day, and where you forget to track?' },
  { id: 'execution', label: 'Execution', hint: 'Do my tasks and goals turn into action, and where does it stall?' },
  { id: 'review', label: 'Review', hint: 'How did this week or month go, compared with the one before?' },
];

/**
 * One home for analysis. All tabs read the same per-day profiles (src/lib/analysis.ts), so a day can never show
 * different numbers on different screens.
 */
export const AnalysisHub: React.FC<AnalysisHubProps> = ({
  activities, tasks, taskBlocks, focusSessions, goals, habits, habitLogs, reviews, sleepLogs = [], blocks, selectedDate, onSaveReview,
  tab: controlledTab, onTabChange, onOpenTracker, onOpenSettings,
}) => {
  const [ownTab, setOwnTab] = useState<Tab>('day');
  const tab = controlledTab ?? ownTab;
  const setTab = (t: Tab) => { setOwnTab(t); onTabChange?.(t); };
  const dayKey = format(selectedDate, 'yyyy-MM-dd');
  const activeHint = TABS.find((t) => t.id === tab)?.hint;

  return (
    <AnalysisNavProvider openAnalysisSettings={onOpenSettings}>
    <div className="space-y-4">
      <div role="tablist" aria-label="Analysis sections" className="flex gap-1 max-w-5xl 2xl:max-w-7xl 3xl:max-w-[1600px] uw:max-w-[2000px] mx-auto w-full overflow-x-auto no-scrollbar scroll-fade-x sm:[mask-image:none] -mx-1 px-1 pb-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            title={t.hint}
            onClick={() => setTab(t.id)}
            onPointerEnter={() => { void load[t.id === 'day' ? 'day' : t.id](); }}
            onFocus={() => { void load[t.id === 'day' ? 'day' : t.id](); }}
            className={`px-3.5 sm:px-4 py-1.5 text-sm font-medium rounded-full transition-colors whitespace-nowrap flex-shrink-0 ${tab === t.id ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {/* the question the open tab answers, visible on phones too (the buttons' title only shows on hover) */}
      {activeHint && <p className="max-w-5xl 2xl:max-w-7xl 3xl:max-w-[1600px] uw:max-w-[2000px] mx-auto w-full -mt-2 text-xs text-muted-foreground">{activeHint}</p>}

      {/* Day: one column; from 1920px the summary sits on the left (sticky) and the full analysis scrolls beside it */}
      {tab === 'day' && (
      <div className="max-w-3xl 3xl:max-w-[1800px] mx-auto w-full space-y-4 3xl:space-y-0 3xl:grid 3xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] 3xl:gap-6 3xl:items-start">
        <div className="3xl:sticky 3xl:top-0 3xl:max-h-[calc(100dvh-9rem)] 3xl:overflow-y-auto no-scrollbar">
        <DayView
          selectedDate={selectedDate}
          blocks={blocks}
          activities={activities}
          tasks={tasks}
          focusSessions={focusSessions}
          review={reviews.find((r) => r.period_type === 'day' && r.period_key === dayKey) ?? null}
          onSaveReview={(fields) => onSaveReview('day', dayKey, fields)}
        />
        </div>
        <Suspense fallback={<PageSkeleton cards={3} />}>
          <DayFullAnalysis activities={activities} focusSessions={focusSessions} blocks={blocks} selectedDate={selectedDate} onOpenTracker={onOpenTracker} />
        </Suspense>
      </div>
      )}
      <Suspense fallback={<PageSkeleton />}>
      {tab === 'trends' && (
        <TrendsTab activities={activities} tasks={tasks} taskBlocks={taskBlocks} focusSessions={focusSessions} goals={goals} blocks={blocks} selectedDate={selectedDate} />
      )}
      {tab === 'focus' && <FocusTab activities={activities} focusSessions={focusSessions} blocks={blocks} selectedDate={selectedDate} />}
      {tab === 'waste' && <WasteTab activities={activities} focusSessions={focusSessions} blocks={blocks} selectedDate={selectedDate} />}
      {tab === 'patterns' && <PatternsTab activities={activities} tasks={tasks} focusSessions={focusSessions} sleepLogs={sleepLogs} blocks={blocks} selectedDate={selectedDate} />}
      {tab === 'execution' && (
        <ExecutionTab activities={activities} tasks={tasks} taskBlocks={taskBlocks} focusSessions={focusSessions} goals={goals} blocks={blocks} selectedDate={selectedDate} />
      )}
      {tab === 'review' && (
        <ReviewPage
          activities={activities}
          tasks={tasks}
          focusSessions={focusSessions}
          habits={habits}
          habitLogs={habitLogs}
          goals={goals}
          liveBlocks={blocks}
          selectedDate={selectedDate}
          reviews={reviews}
          onSaveReview={(period: ReviewPeriod, key: string, fields: ReflectionFields) => onSaveReview(period, key, fields)}
        />
      )}
      </Suspense>
    </div>
    </AnalysisNavProvider>
  );
};
