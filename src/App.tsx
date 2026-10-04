import React, { useState, useEffect, useMemo, Suspense, lazy } from 'react';
import './App.css';
import { Sidebar } from './components/Sidebar';
import type { SidebarView } from './components/Sidebar';
import { TimeGrid } from './components/TimeGrid';
import { TaskList } from './components/TaskList';
const ActivitiesManager = lazy(() => import('./components/ActivitiesManager').then(m => ({ default: m.ActivitiesManager })));
const FocusMode = lazy(() => import('./components/FocusMode').then(m => ({ default: m.FocusMode })));
const CalendarView = lazy(() => import('./components/CalendarView').then(m => ({ default: m.CalendarView })));
const MonthlyCalendar = lazy(() => import('./components/MonthlyCalendar').then(m => ({ default: m.MonthlyCalendar })));
const EisenhowerMatrix = lazy(() => import('./components/EisenhowerMatrix').then(m => ({ default: m.EisenhowerMatrix })));
const AnalysisHub = lazy(() => import('./components/AnalysisHub').then(m => ({ default: m.AnalysisHub })));
const HabitHistory = lazy(() => import('./components/HabitHistory').then(m => ({ default: m.HabitHistory })));
const SleepHub = lazy(() => import('./components/SleepHub').then(m => ({ default: m.SleepHub })));
const GoalsPage = lazy(() => import('./components/GoalsPage').then(m => ({ default: m.GoalsPage })));
const ExportPage = lazy(() => import('./components/ExportPage').then(m => ({ default: m.ExportPage })));
const SettingsPage = lazy(() => import('./components/SettingsPage').then(m => ({ default: m.SettingsPage })));
import { useSupabaseSync } from './hooks/useSupabaseSync';
import { Auth } from './components/Auth';
import { supabase } from './supabaseClient';
import { ThemeProvider, useTheme } from './components/ThemeProvider';
import Landing from './components/Landing';
import { ClockOverlay, TopBarClock } from './components/Clock';
import { NerdModeProvider, openSection, useNerdMode } from './components/ui/detail';
import { prefetchView } from './lib/prefetch';
import type { AnalysisTab } from './components/AnalysisHub';
import { computeHabitStats } from './lib/habits';
import { format } from 'date-fns';
import {
  LayoutGrid, ListTodo, BarChart2, LogOut, Sun, Moon, Zap, TreePine,
  CalendarDays, Grid2x2, Palette,
  CheckCircle2, AlertCircle, Loader2, Target, Settings, BedDouble, Microscope, Menu, Download, ChevronDown
} from 'lucide-react';
import { Sheet } from './components/ui/sheet';

/** bottom-nav tab on phones and tablets; everything outside the four main pages lives under More */
type MobileTab = 'tracker' | 'tasks' | 'prioritize' | 'analysis' | 'more';
const mobileTabOf = (view: SidebarView): MobileTab =>
  view === 'today' ? 'tracker' : view === 'tasks' ? 'tasks' : view === 'prioritize' ? 'prioritize' : view === 'analysis' ? 'analysis' : 'more';
/** 4:3 and small 16:10 screens start with the slim sidebar so the page gets the room */
const startCollapsed = () => { try { return window.matchMedia('(min-width: 1024px) and (max-width: 1279px)').matches; } catch { return false; } };
type ThemeName = 'theme-stark-white' | 'theme-stark-black' | 'theme-solarized-light' | 'theme-solarized-dark';

export default function AppWrapper() {
  return (
    <ThemeProvider>
      <App />
    </ThemeProvider>
  );
}

function App() {
  const [session, setSession] = useState<any>(null);
  const [showAuth, setShowAuth] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (!session) {
    if (showAuth) return <Auth onBack={() => setShowAuth(false)} />;
    return <Landing onLoginClick={() => setShowAuth(true)} />;
  }

  return (
    <NerdModeProvider>
      <TrackerApp session={session} />
    </NerdModeProvider>
  );
}

/** Top-bar switch between simple (headlines, details one tap away) and nerd mode (every detail open). */
const NerdToggle: React.FC = () => {
  const { nerd, setNerd } = useNerdMode();
  return (
    <button
      onClick={() => setNerd(!nerd)}
      aria-pressed={nerd}
      title={nerd ? 'Nerd mode on: every detail is open. Tap for the simple view' : 'Nerd mode: open every detail and hint'}
      aria-label="Nerd mode"
      className={`p-1.5 rounded-md transition-colors flex-shrink-0 ${nerd ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
    >
      <Microscope size={16} />
    </button>
  );
};

interface ThemeSwatch {
  value: ThemeName;
  label: string;
  dot: string;
  icon: React.ReactNode;
}

const THEMES: ThemeSwatch[] = [
  { value: 'theme-stark-white', label: 'White', icon: <Sun size={12} />, dot: '#f5f5f5' },
  { value: 'theme-stark-black', label: 'Black', icon: <Moon size={12} />, dot: '#111111' },
  { value: 'theme-solarized-light', label: 'Sol Light', icon: <Zap size={12} />, dot: '#fdf6e3' },
  { value: 'theme-solarized-dark', label: 'Sol Dark', icon: <TreePine size={12} />, dot: '#002b36' },
];

function TrackerApp({ session }: { session: any }) {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const {
    activities, habits, blocks, tasks, habitLogs, sleepLogs, goals, userSettings, saveStatus,
    assignBlocks, previewCopyFromDate, copyBlocksFromDate, toggleDailyHabit, logEventHabit, deleteHabitLog, updateHabitLogNote, toggleTask, addTask, updateTask,
    addActivity, addHabit, deleteHabit, deleteTask, updateActivity, archiveActivity,
    logFocusSession, focusSessions, taskBlocks, reviews, saveReview, addSleepLog, updateSleepLog: _updateSleepLog, deleteSleepLog,
    addGoal, updateGoal, deleteGoal, completeGoal, abandonGoal,
    updateUserSettings,
  } = useSupabaseSync(session, selectedDate);

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<SidebarView>('today');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(startCollapsed);
  const mobileTab = mobileTabOf(activeView);
  const [moreOpen, setMoreOpen] = useState(false);
  const [dayPanelOpen, setDayPanelOpen] = useState(false);
  const [trackerSubView, setTrackerSubView] = useState<'grid' | 'week' | 'month'>('grid');
  const [taskSubView, setTaskSubView] = useState<'list' | 'focus'>('list');
  const [analysisTab, setAnalysisTab] = useState<AnalysisTab>('day');
  const [clockOpen, setClockOpen] = useState(false);
  const { theme, setTheme } = useTheme();

  const [historyHabitId, setHistoryHabitId] = useState<string | null>(null);

  const handleSelectTask = (id: string) => {
    setSelectedTaskId((prev) => (prev === id ? null : id));
  };

  const handleSignOut = () => supabase.auth.signOut();

  const handleNavigate = (view: SidebarView) => {
    setActiveView(view);
    setMoreOpen(false);
  };

  // Page entrance motion follows Settings → View Animations
  useEffect(() => {
    document.documentElement.dataset.anim = userSettings?.enable_animations ? 'on' : 'off';
  }, [userSettings?.enable_animations]);

  // ── Enrich habits ──────────────────────────────────────────────────────────
  const today = format(new Date(), 'yyyy-MM-dd');

  const enrichedHabits = useMemo(() => {
    return habits.map((h: any) => {
      const completedToday = habitLogs.some(
        (l: any) => l.habit_id === h.id && l.date_key === today
      );

      const stats = computeHabitStats(h, habitLogs);
      const streak = stats.currentStreak;

      // Days since last log (event habits)
      let daysSince: number | null = null;
      let lastLogDate: string | null = null;
      if (h.type === 'event') {
        const logs = habitLogs
          .filter((l: any) => l.habit_id === h.id)
          .sort((a: any, b: any) => new Date(b.logged_at).getTime() - new Date(a.logged_at).getTime());
        if (logs.length > 0) {
          const lastLog = new Date(logs[0].logged_at);
          daysSince = Math.floor((Date.now() - lastLog.getTime()) / (1000 * 60 * 60 * 24));
          lastLogDate = lastLog.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }
      }

      return { ...h, completedToday, streak, streakUnit: stats.unit, daysSince, lastLogDate };
    });
  }, [habits, habitLogs, today]);

  const viewTitles: Record<SidebarView, string> = {
    today: 'Tracker',
    tasks: 'Tasks',
    prioritize: 'Prioritize',
    analysis: 'Analysis',
    activities: 'Activities',
    sleep: 'Sleep',
    goals: 'Goals',
    export: 'Export',
    settings: 'Settings',
  };

  const renderMainContent = () => {
    switch (activeView) {
      case 'today':
        switch (trackerSubView) {
          case 'grid':
            return (
              <div className="flex flex-1 min-h-0">
                <div className="flex-1 overflow-y-auto min-h-0">
                  <TimeGrid
                    blocks={blocks}
                    activities={activities}
                    tasks={tasks}
                    onAssignActivity={(blockIndices, actId, taskId) => assignBlocks(blockIndices, actId, taskId ?? null)}
                    onPreviewCopy={previewCopyFromDate}
                    onCopyFromDate={copyBlocksFromDate}
                    selectedTaskId={selectedTaskId}
                    onAddActivity={addActivity}
                    selectedDate={selectedDate}
                  />
                </div>
              </div>
            );
          case 'week':
            return (
              <div className="flex flex-1 min-h-0 min-w-0">
                <div className="flex-1 min-h-0 min-w-0 flex">
                  <CalendarView
                    blocks={blocks}
                    activities={activities}
                    tasks={tasks}
                    habits={enrichedHabits}
                    selectedDate={selectedDate}
                    onSelectDate={setSelectedDate}
                    onNavigateToDaily={() => setTrackerSubView('grid')}
                    onToggleTask={(id, completed) => toggleTask(id, !completed)}
                    onDeleteTask={deleteTask}
                  />
                </div>
              </div>
            );
          case 'month':
            return (
              <div className="flex flex-1 min-h-0 min-w-0">
                <div className="flex-1 min-h-0 min-w-0 flex">
                  <MonthlyCalendar
                    tasks={tasks}
                    activities={activities}
                    selectedDate={selectedDate}
                    onSelectDate={setSelectedDate}
                    onNavigateToDaily={() => setTrackerSubView('grid')}
                    onToggleTask={(id, completed) => toggleTask(id, !completed)}
                    onDeleteTask={deleteTask}
                  />
                </div>
              </div>
            );
          default:
            return null;
        }

      case 'tasks':
        return taskSubView === 'focus' ? (
          <Suspense fallback={null}><FocusMode
            tasks={tasks}
            activities={activities}
            selectedTaskId={selectedTaskId}
            onSelectTask={handleSelectTask}
            onPomodoroComplete={logFocusSession}
            onBack={() => setTaskSubView('list')}
          /></Suspense>
        ) : (
          <div className="flex-1 h-full overflow-y-auto bg-card">
            <TaskList
              tasks={tasks}
              onToggleTask={(id) => {
                const task = tasks.find((t: any) => t.id === id);
                if (task) toggleTask(id, !task.completed);
              }}
              onAddTask={addTask}
              onDeleteTask={deleteTask}
              activities={activities}
              onUpdateTask={updateTask}
              taskBlocks={taskBlocks}
              focusSessions={focusSessions}
              selectedTaskId={selectedTaskId}
              onSelectTask={handleSelectTask}
              onNavigateToFocus={() => setTaskSubView('focus')}
            />
          </div>
        );

      case 'activities':
        return (
          <ActivitiesManager
            activities={activities}
            onAddActivity={addActivity}
            onUpdateActivity={updateActivity}
            onArchiveActivity={archiveActivity}
          />
        );

      case 'prioritize':
        return (
          <EisenhowerMatrix
            tasks={tasks}
            activities={activities}
            onUpdateTask={updateTask}
            onToggleTask={(id, completed) => toggleTask(id, !completed)}
          />
        );

      case 'analysis':
        return (
          <AnalysisHub
            activities={activities}
            tasks={tasks}
            taskBlocks={taskBlocks}
            focusSessions={focusSessions}
            goals={goals}
            habits={habits}
            habitLogs={habitLogs}
            reviews={reviews}
            sleepLogs={sleepLogs}
            blocks={blocks}
            selectedDate={selectedDate}
            onSaveReview={saveReview}
            tab={analysisTab}
            onTabChange={setAnalysisTab}
            onOpenTracker={() => { setTrackerSubView('grid'); handleNavigate('today'); }}
            onOpenSettings={() => { handleNavigate('settings'); openSection('settings-analysis'); }}
          />
        );

      case 'sleep':
        return (
          <SleepHub
            sleepLogs={sleepLogs}
            blocks={blocks}
            activities={activities}
            userSettings={userSettings}
            onAddSleepLog={addSleepLog}
            onDeleteSleepLog={deleteSleepLog}
            onUpdateSettings={updateUserSettings}
            selectedDate={selectedDate}
            tasks={tasks}
            focusSessions={focusSessions}
          />
        );

      case 'goals':
        return (
          <GoalsPage
            goals={goals}
            activities={activities}
            habits={enrichedHabits}
            blocks={blocks}
            habitLogs={habitLogs}
            onAddGoal={addGoal}
            onUpdateGoal={updateGoal}
            onDeleteGoal={deleteGoal}
            onCompleteGoal={completeGoal}
            onAbandonGoal={abandonGoal}
          />
        );

      case 'export':
        return (
          <ExportPage
            activities={activities}
            habits={habits}
            sleepLogs={sleepLogs}
            goals={goals}
            tasks={tasks}
            taskBlocks={taskBlocks}
            focusSessions={focusSessions}
            reviews={reviews}
            userSettings={userSettings}
          />
        );

      case 'settings':
        return (
          <SettingsPage
            session={session}
            userSettings={userSettings}
            onUpdateSettings={updateUserSettings}
            theme={theme}
            onSetTheme={setTheme}
            onSignOut={handleSignOut}
            activities={activities}
            onUpdateActivity={updateActivity}
            onOpenExport={() => handleNavigate('export')}
            habits={habits}
            sleepLogs={sleepLogs}
            goals={goals}
          />
        );

      default:
        return null;
    }
  };

  return (
    <div className="tracker-layout">
      {/* SIDEBAR */}
      <div className={`tracker-sidebar${sidebarCollapsed ? ' collapsed' : ''}`}>
        <Sidebar
          activities={activities}
          habits={enrichedHabits}
          tasks={tasks}
          onToggleTask={toggleTask}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          onToggleHabit={toggleDailyHabit}
          onLogEventHabit={logEventHabit}
          onOpenHabitHistory={setHistoryHabitId}
          onDeleteHabit={deleteHabit}
          onAddActivity={addActivity}
          onAddHabit={addHabit}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
          activeView={activeView}
          onNavigate={handleNavigate}
        />
      </div>

      {/* MAIN PANEL */}
      <div
        className="tracker-main mobile-active"
      >
        {/* Top bar */}
        <div className="flex items-center gap-1.5 sm:gap-2 px-3 md:px-5 py-2 lg:py-3 short:py-2 border-b border-border flex-shrink-0 bg-background/80 backdrop-blur-md z-10 min-w-0">
          <div className="flex items-center gap-1.5 sm:gap-2 mr-auto min-w-0">
            <span className="font-display text-sm font-semibold text-foreground hidden sm:block">
              {viewTitles[activeView] || 'TimeBloker'}
            </span>
            {/* Phones and tablets: the date and habits live behind this chip (the sidebar is hidden there) */}
            <button
              onClick={() => setDayPanelOpen(true)}
              className="lg:hidden inline-flex items-center gap-1 px-2.5 py-1 min-h-[34px] rounded-full bg-muted text-xs font-medium flex-shrink-0"
              aria-label={`Date ${format(selectedDate, 'EEEE d MMMM')}. Change date and see habits`}
            >
              {format(selectedDate, 'EEE d MMM')}
              <ChevronDown size={13} className="text-muted-foreground" />
            </button>
            {activeView === 'today' && (
              <div className="flex items-center gap-0.5 bg-muted p-0.5 rounded-lg border border-border sm:ml-4 flex-shrink-0">
                <button
                  onClick={() => setTrackerSubView('grid')}
                  title="24H Block View"
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                    trackerSubView === 'grid'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Grid2x2 size={13} />
                  <span className="hidden md:inline">24H Block</span>
                </button>
                <button
                  onClick={() => setTrackerSubView('week')}
                  title="Weekly View"
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                    trackerSubView === 'week'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <CalendarDays size={13} />
                  <span className="hidden md:inline">Weekly</span>
                </button>
                <button
                  onClick={() => setTrackerSubView('month')}
                  title="Monthly View"
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                    trackerSubView === 'month'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <CalendarDays size={13} />
                  <span className="hidden md:inline">Monthly</span>
                </button>
              </div>
            )}
            {activeView === 'today' && (
              <button
                onClick={() => { setAnalysisTab('day'); handleNavigate('analysis'); }}
                onPointerEnter={() => prefetchView('analysis')}
                title={`Analyse ${format(selectedDate, 'd MMM')}: focus, waste and flow for this day`}
                aria-label="Analyse this day"
                className="flex items-center gap-1.5 px-2 py-1 min-h-[30px] rounded-md border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0"
              >
                <BarChart2 size={13} />
                <span className="hidden lg:inline">Analyse day</span>
              </button>
            )}
          </div>

          {/* Save status */}
          <div className="flex items-center sm:min-w-[72px] justify-end flex-shrink-0" aria-live="polite">
            {saveStatus === 'saving' && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground ibm-mono" title="Saving">
                <Loader2 size={12} className="animate-spin" /> <span className="hidden sm:inline">Saving</span>
              </span>
            )}
            {saveStatus === 'saved' && (
              <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400 ibm-mono animate-in fade-in duration-150" title="Saved">
                <CheckCircle2 size={12} /> <span className="hidden sm:inline">Saved</span>
              </span>
            )}
            {saveStatus === 'error' && (
              <span className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400 ibm-mono" title="Could not save">
                <AlertCircle size={12} /> <span className="hidden sm:inline">Error</span>
              </span>
            )}
          </div>

          <TopBarClock onOpen={() => setClockOpen(true)} />
          <NerdToggle />

          {/* Top Bar Navigation (Sleep, Goals, Settings) */}
          <div className="hidden lg:flex items-center gap-1 ml-2 border-l border-border pl-3 flex-shrink-0">
            <button
              onClick={() => handleNavigate('sleep')}
              onPointerEnter={() => prefetchView('sleep')}
              title="Sleep Tracker"
              className={`p-1.5 rounded-md transition-colors ${activeView === 'sleep' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
            >
              <BedDouble size={16} />
            </button>
            <button
              onClick={() => handleNavigate('goals')}
              onPointerEnter={() => prefetchView('goals')}
              title="Goals"
              className={`p-1.5 rounded-md transition-colors ${activeView === 'goals' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
            >
              <Target size={16} />
            </button>
            <button
              onClick={() => handleNavigate('settings')}
              onPointerEnter={() => prefetchView('settings')}
              title="Settings"
              className={`p-1.5 rounded-md transition-colors ${activeView === 'settings' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
            >
              <Settings size={16} />
            </button>
          </div>

          {/* Theme swatches: inline on wide screens, one button with a small menu on phones */}
          <div className="hidden lg:flex items-center gap-1 ml-2 border-l border-border pl-3">
            {THEMES.map((t) => (
              <button
                key={t.value}
                title={t.label}
                aria-label={`${t.label} theme`}
                aria-pressed={theme === t.value}
                onClick={() => setTheme(t.value)}
                className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 ${
                  theme === t.value ? 'border-foreground scale-110' : 'border-border'
                }`}
                style={{ backgroundColor: t.dot }}
              />
            ))}
          </div>

          {/* Sign out (also in Settings on phones) */}
          <button
            onClick={handleSignOut}
            title="Sign out"
            className="ml-1 hidden lg:flex items-center gap-1.5 px-2 py-1.5 rounded text-xs text-muted-foreground hover:text-destructive hover:bg-accent transition-colors min-h-[36px]"
          >
            <LogOut size={13} />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>

        <div className="flex-1 overflow-hidden min-h-0 flex flex-col relative">
          <Suspense fallback={<div className="flex-1 flex items-center justify-center p-8"><Loader2 className="animate-spin text-muted-foreground" size={24} /></div>}>
            <div key={activeView} className={`flex-1 flex flex-col min-h-0 ${userSettings?.enable_animations ? 'animate-in fade-in slide-in-from-bottom-2 duration-150' : ''}`}>
              {(['sleep', 'goals', 'export', 'settings', 'analysis'].includes(activeView))
                ? <div className="flex-1 overflow-y-auto p-4 md:p-6">{renderMainContent()}</div>
                : renderMainContent()
              }
            </div>
          </Suspense>
        </div>
      </div>

      {clockOpen && <ClockOverlay onClose={() => setClockOpen(false)} activities={activities} blocks={format(selectedDate, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd') ? blocks : null} />}

      {/* Phone and tablet bottom nav */}
      <nav className="mobile-tab-nav" aria-label="Main">
        {([
          ['tracker', 'today', 'Today', <LayoutGrid size={20} key="i" />],
          ['tasks', 'tasks', 'Tasks', <ListTodo size={20} key="i" />],
          ['prioritize', 'prioritize', 'Priority', <Grid2x2 size={20} key="i" />],
          ['analysis', 'analysis', 'Analysis', <BarChart2 size={20} key="i" />],
        ] as const).map(([tab, view, label, icon]) => (
          <button key={tab} className={`mobile-tab-btn${mobileTab === tab ? ' active' : ''}`} aria-current={mobileTab === tab ? 'page' : undefined} onClick={() => handleNavigate(view)}>
            {icon}
            {label}
          </button>
        ))}
        <button className={`mobile-tab-btn${mobileTab === 'more' ? ' active' : ''}`} onClick={() => setMoreOpen(true)} aria-haspopup="dialog">
          <Menu size={20} />
          {mobileTab === 'more' ? viewTitles[activeView] : 'More'}
        </button>
      </nav>

      {/* More: every page that is not in the bottom nav, plus theme and sign out */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen} title="More">
        <div className="grid grid-cols-3 gap-2 px-2">
          {([
            ['activities', 'Activities', <Palette size={20} key="i" />],
            ['sleep', 'Sleep', <BedDouble size={20} key="i" />],
            ['goals', 'Goals', <Target size={20} key="i" />],
            ['export', 'Export', <Download size={20} key="i" />],
            ['settings', 'Settings', <Settings size={20} key="i" />],
          ] as const).map(([view, label, icon]) => (
            <button
              key={view}
              onClick={() => handleNavigate(view)}
              onPointerEnter={() => prefetchView(view)}
              className={`flex flex-col items-center justify-center gap-1.5 rounded-2xl py-4 text-xs font-medium transition-colors ${activeView === view ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-accent'}`}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
        <div className="mt-5 px-2">
          <div className="text-xs font-semibold text-muted-foreground mb-2">Theme</div>
          <div className="grid grid-cols-4 gap-2">
            {THEMES.map((t) => (
              <button
                key={t.value}
                onClick={() => setTheme(t.value)}
                aria-pressed={theme === t.value}
                className={`flex flex-col items-center gap-1.5 rounded-xl py-2.5 text-[11px] ${theme === t.value ? 'bg-accent font-semibold' : 'hover:bg-accent'}`}
              >
                <span className={`w-6 h-6 rounded-full border-2 ${theme === t.value ? 'border-foreground' : 'border-border'}`} style={{ backgroundColor: t.dot }} />
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <button onClick={handleSignOut} className="mt-5 mx-2 w-[calc(100%-1rem)] flex items-center justify-center gap-2 rounded-xl border border-border py-3 text-sm text-muted-foreground hover:text-destructive">
          <LogOut size={15} /> Sign out
        </button>
      </Sheet>

      {/* Phones and tablets: date picker and habits */}
      <Sheet open={dayPanelOpen} onOpenChange={setDayPanelOpen} title="Day and habits">
        <Sidebar
          panel
          activities={activities}
          habits={enrichedHabits}
          tasks={tasks}
          onToggleTask={toggleTask}
          selectedDate={selectedDate}
          onSelectDate={(d) => { setSelectedDate(d); setDayPanelOpen(false); }}
          onToggleHabit={toggleDailyHabit}
          onLogEventHabit={logEventHabit}
          onOpenHabitHistory={(id) => { setDayPanelOpen(false); setHistoryHabitId(id); }}
          onDeleteHabit={deleteHabit}
          onAddActivity={addActivity}
          onAddHabit={addHabit}
          activeView={activeView}
        />
      </Sheet>

      {historyHabitId && (() => {
        const habit = habits.find((h: any) => h.id === historyHabitId);
        if (!habit) return null;
        return (
          <Suspense fallback={null}>
            <HabitHistory
              habit={habit}
              logs={habitLogs.filter((l: any) => l.habit_id === historyHabitId)}
              onClose={() => setHistoryHabitId(null)}
              onToggleDate={(id, key) => toggleDailyHabit(id, key)}
              onLogEvent={(id, note, key) => logEventHabit(id, note, key)}
              onDeleteLog={deleteHabitLog}
              onUpdateNote={updateHabitLogNote}
            />
          </Suspense>
        );
      })()}
    </div>
  );
}
