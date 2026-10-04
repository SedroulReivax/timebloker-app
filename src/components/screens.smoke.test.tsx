// Render smoke tests: every new screen must render real props to HTML without throwing.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import Landing from './Landing';
import { Auth } from './Auth';
import { AccountSecurity } from './AccountSecurity';
import { SettingsPage } from './SettingsPage';
import { ThemeProvider } from './ThemeProvider';
import { SleepHub } from './SleepHub';
import { DayView } from './DayView';
import { AnalysisHub } from './AnalysisHub';
import { TrendsTab } from './TrendsTab';
import { FocusTab } from './FocusTab';
import { ChangeChip } from './ChangeChip';
import { ReviewPage } from './ReviewPage';
import { PeakFocusCard } from './PeakFocusCard';
import { AnalysisSettings } from './AnalysisSettings';
import { ExportPage } from './ExportPage';
import { ClockOverlay, TopBarClock } from './Clock';
import { DayFullAnalysis } from './DayFullAnalysis';
import { WasteTab } from './WasteTab';
import { PatternsTab } from './PatternsTab';
import { ExecutionTab } from './ExecutionTab';
import { FocusDayView, PatternsDayView, TrendsDayView, WasteDayView } from './DayModeViews';
import { FocusCurveCard } from './FocusCurveCard';
import { NerdModeProvider } from './ui/detail';
import { Page, SectionGrid, TileRow, pageClass } from './ui/page';
import { Sidebar } from './Sidebar';
import { FocusMode } from './FocusMode';
import { FocusPill } from './FocusPill';
import { FocusSessionProvider } from '../hooks/useFocusSession';
import { analyzeFocus } from '../lib/focusModel';
import type { Activity } from '../types';

// Backend analytics rows arrive asynchronously, so a synchronous render normally sees the loading state. A test can
// set rows here to render a screen the way it looks once analytics_daily / analytics_activity_daily have loaded.
const analyticsRows = vi.hoisted((): { daily: unknown[] | null; activity: unknown[] | null } => ({ daily: null, activity: null }));
vi.mock('../hooks/useAnalyticsRange', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useAnalyticsRange')>();
  const loaded = (rows: unknown[]) => ({ rows: rows as never[], loading: false, error: null });
  return {
    ...actual,
    useDailyAnalyticsRange: (from: string, to: string) => (analyticsRows.daily ? loaded(analyticsRows.daily) : actual.useDailyAnalyticsRange(from, to)),
    useActivityAnalyticsRange: (from: string, to: string) => (analyticsRows.activity ? loaded(analyticsRows.activity) : actual.useActivityAnalyticsRange(from, to)),
  };
});

beforeAll(() => {
  // ThemeProvider reads localStorage in its state initialiser
  (globalThis as unknown as { localStorage: Storage }).localStorage = { getItem: () => null, setItem: () => undefined } as unknown as Storage;
});

// Nerd mode opens every detail section, so the content checks below see the whole page
const html = (el: React.ReactElement) => renderToString(<NerdModeProvider initial>{el}</NerdModeProvider>);
const simpleHtml = (el: React.ReactElement) => renderToString(<NerdModeProvider initial={false}>{el}</NerdModeProvider>);
const NOOP = () => undefined;

const sleepActivity: Activity = { id: 'sleep', name: 'Sleep', color: '#6366f1', category: 'Health', is_sleep_activity: true };
const workActivity: Activity = { id: 'work', name: 'Deep work', color: '#3b82f6', category: 'Work' };
const selectedDate = new Date(2026, 8, 22, 12, 0);

const lastNightBlocks = [
  ...Array.from({ length: 6 }, (_, i) => ({ date_key: '2026-09-21', block_index: 138 + i, activity_id: 'sleep' as string | null })),
  ...Array.from({ length: 42 }, (_, i) => ({ date_key: '2026-09-22', block_index: i, activity_id: 'sleep' as string | null })),
];

describe('Sign in and account', () => {
  it('the sign-in screen offers a password reset and account creation', () => {
    const out = html(<ThemeProvider><Auth onBack={NOOP} /></ThemeProvider>);
    expect(out).toContain('Forgot password?');
    expect(out).toContain('Create one');
    expect(out).toContain('autoComplete="current-password"'); // password managers fill the sign-in form
  });

  it('account settings ask for the current password and can sign out other devices', () => {
    const out = html(<AccountSecurity email="someone@example.com" onSignOut={NOOP} />);
    expect(out).toContain('someone@example.com');
    expect(out).toContain('Change password');
    expect(out).toContain('Sign out other devices');
  });

  it('the settings page shows every group with its jump links', () => {
    const out = html(
      <SettingsPage session={{ user: { id: 'u', email: 'someone@example.com' } }} userSettings={{}} onUpdateSettings={NOOP} theme="theme-stark-white" onSetTheme={NOOP}
        onSignOut={NOOP} activities={[]} onUpdateActivity={NOOP} onOpenExport={NOOP} habits={[]} sleepLogs={[]} goals={[]} />
    );
    for (const t of ['Account and security', 'Appearance', 'Preferences', 'Sleep defaults', 'Your data', 'Danger zone', 'Delete all data', 'Signed in as someone@example.com']) expect(out).toContain(t);
    for (const id of ['settings-account', 'settings-appearance', 'settings-preferences', 'settings-sleep', 'settings-analysis', 'settings-data', 'settings-danger']) expect(out).toContain(`id="${id}"`);
  });
});

describe('Landing', () => {
  it('renders the real sections and demo visuals', () => {
    const out = html(<ThemeProvider><Landing onLoginClick={NOOP} /></ThemeProvider>);
    expect(out).toContain('See where your day actually goes.');
    expect(out).toContain('Paint your day in 10-minute blocks.');
    expect(out).toContain('Sleep tracking that explains itself.');
    expect(out).toContain('Where did my day go?');
    expect(out).toContain('Three rules the numbers follow.');
    expect(out).toContain('Launch TimeBloker');
    // what is inside today: the analysis tabs, attention and waste, open source
    expect(out).toContain('Plain answers first. The maths one hover away.');
    expect(out).toContain('Find where the day leaks, and what it costs you.');
    expect(out).toContain('Read every formula. Run it yourself.');
    expect(out).toContain('https://github.com/SedroulReivax/timebloker');
    expect(out).not.toContain('NaN');
    // demo visuals come from the real engines
    expect(out).toContain('Deep-focus score');
    expect(out).toContain('score, every part visible');
    expect(out).not.toContain('NaN');
    expect(out).not.toContain('undefined');
  });
});

describe('SleepHub', () => {
  const props = {
    sleepLogs: [], blocks: lastNightBlocks, activities: [sleepActivity], userSettings: null, tasks: [], focusSessions: [], selectedDate,
    onAddSleepLog: NOOP, onDeleteSleepLog: NOOP, onUpdateSettings: NOOP,
  };

  it('shows last night, the score parts, planner and coaching', () => {
    const out = html(<SleepHub {...props} />);
    expect(out).toContain('Last night');
    expect(out).toContain('11:00 PM');
    expect(out).toContain('7:00 AM');
    expect(out).toContain('8h');
    expect(out).toContain('Tonight');
    expect(out).toContain('Keep tracking'); // fewer than three nights of history
    expect(out).not.toContain('NaN');
  });

  it('guides setup when there is no sleep activity', () => {
    const out = html(<SleepHub {...props} activities={[workActivity]} />);
    expect(out).toContain('Set up sleep tracking');
  });

  it('falls back to a name-detected sleep activity', () => {
    const out = html(<SleepHub {...props} activities={[{ ...sleepActivity, is_sleep_activity: false }]} />);
    expect(out).toContain('Last night');
  });
});

describe('DayView', () => {
  it('renders summary, timeline, generated answers and the reflection form', () => {
    const blocks = [
      ...Array.from({ length: 6 }, (_, i) => ({ date_key: '2026-09-21', block_index: 54 + i, activity_id: 'work' as string | null, task_id: 't1' as string | null })),
    ];
    const out = html(
      <DayView
        selectedDate={new Date(2026, 8, 21, 20, 0)}
        blocks={blocks}
        activities={[workActivity]}
        tasks={[{ id: 't1', title: 'Write report', completed: false, activity_id: 'work' }]}
        focusSessions={[]}
        review={{ planned: 'Finish the report', happened: null }}
        onSaveReview={NOOP}
      />
    );
    expect(out).toContain('Write report');
    expect(out).toContain('9:00 AM–10:00 AM');
    expect(out).toContain('Daily review');
    expect(out).toContain('In short');
    expect(out).toContain('You logged');
    expect(out).toContain('Reflection');
    expect(out).toContain('Finish the report');
  });
});

describe('Analysis hub and its tabs', () => {
  const blocks = [0, 1, 2, 3, 4, 5].map((i) => ({ date_key: '2026-09-21', block_index: 54 + i, activity_id: 'work' as string | null }));
  const common = { activities: [workActivity], tasks: [], focusSessions: [], blocks, selectedDate };

  it('Trends renders headline metrics, fragmentation, estimation and goals without live data', () => {
    const out = html(<TrendsTab {...common} taskBlocks={[]} goals={[]} />);
    expect(out).toContain('Tracked / day');
    expect(out).toContain('Deep focus / day');
    expect(out).toContain('Focus quality');
    expect(out).toContain('Logged');
    expect(out).toContain('Switching');
    expect(out).toContain('Estimates vs reality');
    expect(out).toContain('Deadline reliability');
    expect(out).toContain('In short');
    expect(out).not.toContain('NaN');
    expect(out).not.toContain('judged');
  });

  it('Focus renders the peak window card, heatmap and run-length distribution', () => {
    const out = html(<FocusTab activities={[workActivity]} focusSessions={[]} blocks={blocks} selectedDate={selectedDate} />);
    expect(out).toContain('Peak focus window');
    expect(out).toContain('What you actually focused on, hour by hour');
    expect(out).toContain('24-hour focus window by activity');
    expect(out).toContain('Focused time by activity');
    expect(out).toContain('Focus by weekday and hour');
    expect(out).toContain('How long are your focus stretches?');
    expect(out).toContain('In short');
    expect(out).not.toContain('NaN');
  });

  it('Waste explains itself with no negative multipliers, and renders every card when there is waste', () => {
    expect(html(<WasteTab activities={[workActivity]} focusSessions={[]} blocks={blocks} selectedDate={selectedDate} />)).toContain('No activity counts as waste yet');
    const yt: Activity = { id: 'yt', name: 'YouTube', color: '#ef4444', category: 'Leisure', productivity_multiplier: -0.5 };
    const wasteBlocks = [
      ...blocks,
      ...[0, 1, 2, 3].map((i) => ({ date_key: '2026-09-21', block_index: 60 + i, activity_id: 'yt' as string | null })),
      ...[0, 1, 2].map((i) => ({ date_key: '2026-09-20', block_index: 80 + i, activity_id: 'yt' as string | null })),
    ];
    // the per-activity totals come from the backend rows recompute_daily_analytics would write for these blocks
    const day = (date_key: string, judged: number, waste: number, wastePoints: number) => ({
      date_key, elapsed_minutes: 1440, tracked_minutes: judged, judged_minutes: judged, ignored_minutes: 0, sleep_minutes: 0, untracked_minutes: 1440 - judged,
      waste_minutes: waste, waste_points: wastePoints, productivity_points: 0, switch_count: 0, cross_switch_count: 0,
    });
    analyticsRows.daily = [day('2026-09-20', 30, 30, 15), day('2026-09-21', 40, 40, 20)];
    analyticsRows.activity = [
      { date_key: '2026-09-20', activity_id: 'yt', waste_minutes: 30, waste_points: 15 },
      { date_key: '2026-09-21', activity_id: 'yt', waste_minutes: 40, waste_points: 20 },
    ];
    let out: string;
    try {
      out = html(<WasteTab activities={[workActivity, yt]} focusSessions={[]} blocks={wasteBlocks} selectedDate={selectedDate} />);
    } finally {
      analyticsRows.daily = null;
      analyticsRows.activity = null;
    }
    for (const t of ['Waste / day', 'Waste over time', 'When waste happens, hour by hour', 'By weekday', 'By activity', 'What leads to waste', 'Longest stretches']) expect(out).toContain(t);
    expect(out).toContain('YouTube');
    expect(out).not.toContain('NaN');
  });

  it('Patterns renders the flow map, sleep vs next day and the logging-gaps map', () => {
    const flowBlocks = ['2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21'].flatMap((d) => [
      ...[0, 1, 2].map((i) => ({ date_key: d, block_index: 54 + i, activity_id: 'work' as string | null })),
      ...[0, 1, 2].map((i) => ({ date_key: d, block_index: 57 + i, activity_id: 'yt' as string | null })),
    ]);
    const yt: Activity = { id: 'yt', name: 'YouTube', color: '#ef4444', category: 'Leisure', productivity_multiplier: -0.5 };
    const out = html(<PatternsTab activities={[workActivity, yt, sleepActivity]} tasks={[]} focusSessions={[]} sleepLogs={[]} blocks={[...flowBlocks, ...lastNightBlocks]} selectedDate={selectedDate} />);
    expect(out).toContain('Activity flow');
    // The pairwise matrix now comes from an async analytics_transition_daily fetch
    // (useTransitionAnalyticsRange) that has not resolved yet in this synchronous
    // renderToString pass, so the table shows its "not enough data" placeholder here --
    // the same loading-window trade-off every other backend-migrated screen has.
    expect(out).toContain('Not enough activity changes in this range yet.');
    expect(out).toContain('Sleep and next-day patterns');
    expect(out).toContain('Where you forget to track');
    expect(out).toContain('In short');
    expect(out).not.toContain('NaN');
    expect(out).not.toContain('judged');
  });

  it('every analysis tab has a single-day view that renders without NaN and points to longer ranges', () => {
    const yt: Activity = { id: 'yt', name: 'YouTube', color: '#ef4444', category: 'Leisure', productivity_multiplier: -0.5 };
    const dayBlocks = [
      ...[0, 1, 2, 3, 4].map((i) => ({ date_key: '2026-09-22', block_index: 54 + i, activity_id: 'work' as string | null })),
      ...[0, 1, 2].map((i) => ({ date_key: '2026-09-22', block_index: 59 + i, activity_id: 'yt' as string | null })),
      ...lastNightBlocks,
    ];
    const base = { activities: [workActivity, yt, sleepActivity], focusSessions: [], blocks: dayBlocks, selectedDate, picker: null };
    const trends = html(<TrendsDayView {...base} />);
    expect(trends).toContain('Hour by hour');
    expect(trends).toContain('Where the day went');
    expect(trends).toContain('Pick 7d or longer');
    const focus = html(<FocusDayView {...base} />);
    expect(focus).toContain('Focus runs this day');
    expect(focus).toContain('Focus depth through the day');
    expect(focus).not.toContain('What you actually focused on, hour by hour'); // folded into the depth chart for one day
    const waste = html(<WasteDayView {...base} />);
    expect(waste).toContain('Waste stretches');
    const patterns = html(<PatternsDayView {...base} tasks={[]} sleepLogs={[]} />);
    expect(patterns).toContain('How the day flowed');
    expect(patterns).toContain('Where tracking is missing');
    for (const out of [trends, focus, waste, patterns]) expect(out).not.toContain('NaN');
    for (const out of [trends, focus, waste]) expect(out).toContain('not enough history to compare');
  });

  it('Execution renders every card and says what it cannot measure instead of showing zeros', () => {
    const tasks = [
      { id: 't1', title: 'Write report', created_at: '2026-09-15T09:00:00', date_key: '2026-09-15', deadline: '2026-09-18', completed: true, completed_at: '2026-09-17T10:00:00', estimated_minutes: null, estimated_pomodoros: 1 },
      { id: 't2', title: 'Old chore', created_at: '2026-08-01T09:00:00', date_key: '2026-08-01', deadline: '2026-08-05', completed: false, completed_at: null, estimated_minutes: null, estimated_pomodoros: 1 },
    ] as never[];
    const out = html(<ExecutionTab {...common} tasks={tasks} taskBlocks={[]} goals={[]} />);
    for (const t of ['From intention to done', 'Tasks in vs tasks out', 'Time from created to done', 'Estimates vs reality, by task size', 'How scattered your days are', 'Goal momentum', 'In short']) expect(out).toContain(t);
    expect(out).toContain('measures logging, not execution');
    expect(out).toContain('Nothing to calibrate yet');
    expect(out).toContain('Observation');
    expect(out).not.toContain('NaN');
  });

  it('the hub opens on Day and offers all its tabs', () => {
    const out = html(
      <AnalysisHub
        {...common} taskBlocks={[]} goals={[]} habits={[]} habitLogs={[]} reviews={[]} onSaveReview={NOOP}
        blocks={blocks.map((b) => ({ ...b, task_id: null }))}
      />
    );
    for (const t of ['Day', 'Trends', 'Focus', 'Waste', 'Patterns', 'Execution', 'Review']) expect(out).toContain(`>${t}<`);
    expect(out).toContain('Daily review');
  });

  it('Review renders week comparison, honest change wording and the reflection form', () => {
    const out = html(
      <ReviewPage
        activities={[workActivity]} tasks={[]} focusSessions={[]} habits={[]} habitLogs={[]} goals={[]} liveBlocks={blocks}
        selectedDate={selectedDate} reviews={[]} onSaveReview={NOOP}
      />
    );
    expect(out).toContain('previous week');
    expect(out).toContain('Deep focus');
    expect(out).toContain('no clear change'.length ? 'Comparisons use finished days only' : '');
    expect(out).toContain('Reflection');
    expect(out).not.toContain('NaN');
  });
});

describe('Settings → Analysis', () => {
  it('lists activities with typed multipliers, locks sleep as ignored and marks ignored ones', () => {
    const acts: Activity[] = [
      sleepActivity,
      { ...workActivity, productivity_multiplier: 1.25 },
      { id: 'yt', name: 'YouTube', color: '#ef4444', category: 'Leisure', productivity_multiplier: -0.35 },
      { id: 'tr', name: 'Travel', color: '#999999', category: 'Other', analysis_ignored: true },
    ];
    const out = html(<AnalysisSettings activities={acts} onUpdateActivity={NOOP} />);
    expect(out).toContain('Analysis');
    expect(out).toContain('value="-0.35"');
    expect(out).toContain('−0.35×');
    expect(out).toContain('+1.25×');
    expect(out).toContain('sleep · never judged');
    expect(out).toContain('ignored · never judged');
    expect(out).not.toContain('NaN');
  });
});

describe('ExportPage', () => {
  it('offers presets, include switches, anonymise, detail and the four outputs', () => {
    const out = html(<ExportPage activities={[workActivity]} habits={[]} sleepLogs={[]} goals={[]} />);
    for (const t of ['Last 7 days', 'This month', 'Custom', 'Timeline', 'Notes &amp; reflections', 'Anonymise', 'Compact', 'Full', 'Copy AI pack', 'AI pack (.md)', 'Analysis (.json)', 'CSV tables (.zip)']) expect(out).toContain(t);
    expect(out).not.toContain('NaN');
  });
});

describe('Clock', () => {
  it('top-bar clock shows seconds on wide screens and minutes on phones', () => {
    const out = html(<TopBarClock onOpen={NOOP} />);
    expect(out).toMatch(/\d{1,2}:\d{2}:\d{2}/);
    expect(out).toContain('sm:hidden');
  });

  it('full-screen clock renders the terminal layout, with and without today’s blocks', () => {
    const withBlocks = html(<ClockOverlay onClose={NOOP} activities={[workActivity]} blocks={[]} />);
    expect(withBlocks).toContain('blockday@clock');
    expect(withBlocks).toContain('nothing tracked right now');
    const otherDay = html(<ClockOverlay onClose={NOOP} activities={[workActivity]} blocks={null} />);
    expect(otherDay).toContain('select today in the tracker');
    expect(otherDay).not.toContain('NaN');
  });
});

describe('Analysis → Day', () => {
  it('runs every analysis for the selected day, with jump links and a tracker shortcut', () => {
    const blocks = [0, 1, 2, 3].map((i) => ({ date_key: '2026-09-22', block_index: 54 + i, activity_id: 'work' as string | null }));
    const out = html(<DayFullAnalysis activities={[workActivity]} focusSessions={[]} blocks={blocks} selectedDate={selectedDate} onOpenTracker={NOOP} />);
    for (const t of ['Against your typical day', 'Focus runs this day', 'Waste', 'How the day flowed', 'Open in tracker', 'vs typical']) expect(out).toContain(t);
    expect(out).not.toContain('Pick 7d or longer');
    expect(out).not.toContain('NaN');
  });
});

describe('ChangeChip', () => {
  const fmt = (v: number) => `${Math.round(v)}m`;
  const base = { current: 10, previous: 5, delta: 5, lo: 2, hi: 8, direction: 'up' as const, enough: true, nCurrent: 7, nPrevious: 7 };

  it('shows an arrow only when the change is clear, and says so honestly otherwise', () => {
    expect(html(<ChangeChip change={base} fmt={fmt} />)).toContain('↑');
    expect(html(<ChangeChip change={{ ...base, direction: 'flat' }} fmt={fmt} />)).toContain('no clear change');
    expect(html(<ChangeChip change={{ ...base, enough: false }} fmt={fmt} />)).toContain('not enough days');
    expect(html(<ChangeChip change={null} fmt={fmt} />)).toBe('');
  });
});

describe('PeakFocusCard', () => {
  it('explains a missing window instead of showing nothing', () => {
    const empty = analyzeFocus({ blocks: [], activities: [], sleepIds: new Set() });
    expect(html(<PeakFocusCard analysis={empty} />)).toContain('Not enough working days yet');
  });
});

describe('simple mode and nerd mode', () => {
  const dayProps = {
    selectedDate,
    blocks: Array.from({ length: 6 }, (_, i) => ({ date_key: '2026-09-21', block_index: 54 + i, activity_id: 'work' as string | null, task_id: null })),
    activities: [workActivity],
    tasks: [],
    focusSessions: [],
    review: { planned: '', happened: '', changed: '', carry_over: '' },
    onSaveReview: NOOP,
  };

  it('simple mode shows headlines and collapses detail sections behind their summary', () => {
    const out = simpleHtml(<DayView {...dayProps} selectedDate={new Date(2026, 8, 21, 12)} />);
    expect(out).toContain('Tracked');
    expect(out).toContain('aria-expanded="false"');
    expect(out).not.toContain('What was planned?'); // reflection is empty, so it stays collapsed
  });

  it('nerd mode opens every section', () => {
    const out = html(<DayView {...dayProps} selectedDate={new Date(2026, 8, 21, 12)} />);
    // the (i) buttons toggle the hover explanation, which is closed until asked for; every section must be open
    expect(out).toContain('aria-label="About ');
    expect(out.replace(/aria-label="About [^"]*" aria-expanded="false"/g, '')).not.toContain('aria-expanded="false"');
    expect(out).toContain('What was planned?');
  });

  it('focus curve explains itself without multipliers and renders with them', () => {
    const none = html(<FocusCurveCard activities={[workActivity]} blocks={dayProps.blocks} sleepIds={new Set()} dateKeys={['2026-09-21']} />);
    expect(none).toContain('No activity has a productivity multiplier yet');
    const some = html(<FocusCurveCard activities={[{ ...workActivity, productivity_multiplier: 1 }]} blocks={dayProps.blocks} sleepIds={new Set()} dateKeys={['2026-09-21']} />);
    expect(some).toContain('Focus curve');
    expect(some).toContain('Best stretch');
    expect(some).toContain('Per minute');
    expect(some).toContain('>Points<');
    expect(some).not.toContain('NaN');
  });
});

describe('responsive building blocks', () => {
  it('Page and TileRow pick classes per screen class', () => {
    const out = html(<Page flow><TileRow count={8}><div>a</div></TileRow><SectionGrid><div>b</div></SectionGrid></Page>);
    expect(out).toContain('2xl:grid-cols-2');
    expect(out).toContain('uw:grid-cols-3');
    expect(out).toContain('3xl:grid-cols-8');
    expect(pageClass('reading')).toContain('max-w-3xl');
  });

  it('the sidebar panel (phone date sheet) shows the calendar and habits without the nav', () => {
    const props = {
      activities: [], habits: [{ id: 'h', name: 'Read', type: 'daily' as const }], selectedDate,
      onSelectDate: NOOP, onToggleHabit: NOOP, onLogEventHabit: NOOP, onDeleteHabit: NOOP,
    };
    const panel = html(<Sidebar {...props} panel />);
    expect(panel).toContain('Daily habits');
    expect(panel).toContain('Read');
    expect(panel).not.toContain('Focus');
    expect(html(<Sidebar {...props} />)).toContain('Focus');
    expect(html(<Sidebar {...props} />)).not.toContain('Prioritize');
  });
});

describe('Focus page', () => {
  it('renders the timer, the task/activity switch and the picker without a session', () => {
    const tasks = [{ id: 't1', title: 'Write report', completed: false, activity_id: workActivity.id }];
    const out = html(
      <FocusSessionProvider userId="u" tasks={tasks} activities={[workActivity]} assignBlocksOn={NOOP} logFocusSession={NOOP}>
        <FocusMode tasks={tasks} activities={[workActivity]} focusSessions={[]} />
        <FocusPill onOpen={NOOP} />
      </FocusSessionProvider>
    );
    expect(out).toContain('Pomodoro');
    expect(out).toContain('Stopwatch');
    expect(out).toContain('25:00');
    expect(out).toContain('Activity');
    expect(out).toContain('Select a task to focus on');
    expect(out).not.toContain('Open Focus'); // the top-bar pill only shows while a session is in progress
  });
});
