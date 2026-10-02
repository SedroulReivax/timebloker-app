import React, { useEffect, useMemo, useState } from 'react';
import { format, parseISO, subDays } from 'date-fns';
import { Area, CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { Section, StatTile } from './ui/detail';
import { ANIM, CURVE, chartH } from './ui/chart';
import { AlertCircle, BedDouble, Moon, Star, Trash2, Zap } from 'lucide-react';
import type { Activity, SleepLog, Task, TaskFocusSession, UserSettings } from '../types';
import { useBlockRange } from '../hooks/useBlockRange';
import type { RangeBlock } from '../lib/blockRange';
import { findSleepActivities, getSleepActivityIds } from '../lib/sleepActivity';
import {
  SCORE_WEIGHTS, SLEEP_FACTORS, buildNights, formatClock, formatDur, formatRel, getAverages, getBaseline, getBedtimeStreak, getChronotype,
  getFactorImpacts, getGoalStreak, getInsights, getRegularity, getSleepDebt, getSocialJetLag, getWeekdayPattern, parseClockText, planTonight,
  scoreNight, type Night, type SleepScoreParts,
} from '../lib/sleepAnalysis';
import { Ring, SleepRibbon, scoreColor } from './SleepCharts';
import { SleepInsights } from './SleepInsights';
import { pageClass } from './ui/page';

interface SleepHubProps {
  sleepLogs: SleepLog[];
  blocks: RangeBlock[];
  activities: Activity[];
  userSettings: UserSettings | null;
  tasks: Task[];
  focusSessions: TaskFocusSession[];
  selectedDate: Date;
  onAddSleepLog: (log: { date_key: string; quality?: number; notes?: string; factors?: string[]; energy?: number | null }) => void;
  onDeleteSleepLog: (id: string) => void;
  onUpdateSettings: (updates: Partial<UserSettings>) => void;
}

type Tab = 'overview' | 'trends' | 'patterns' | 'log';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'trends', label: 'Trends' },
  { id: 'patterns', label: 'Patterns' },
  { id: 'log', label: 'Log' },
];

const WINDOW = 90;
const PART_LABEL: Record<keyof SleepScoreParts, string> = { duration: 'Duration', continuity: 'Continuity', regularity: 'Regularity', rating: 'Your rating' };
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const Card = Section;

const Stat: React.FC<{ label: string; value: string; sub?: string; tone?: 'good' | 'watch' | 'neutral'; to?: string }> = ({ label, value, sub, tone = 'neutral', to }) => (
  <StatTile
    label={label}
    to={to}
    value={<span className={tone === 'good' ? 'text-green-600 dark:text-green-400' : tone === 'watch' ? 'text-amber-600 dark:text-amber-400' : ''}>{value}</span>}
    sub={sub}
  />
);

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export const SleepHub: React.FC<SleepHubProps> = ({
  sleepLogs, blocks: liveBlocks, activities, userSettings, tasks, focusSessions, selectedDate, onAddSleepLog, onDeleteSleepLog, onUpdateSettings,
}) => {
  const [tab, setTab] = useState<Tab>('overview');
  const [trendDays, setTrendDays] = useState<14 | 30 | 90>(30);

  const sleepActs = useMemo(() => findSleepActivities(activities), [activities]);
  const sleepIds = useMemo(() => getSleepActivityIds(activities), [activities]);

  const endKey = format(selectedDate, 'yyyy-MM-dd');
  const startKey = format(subDays(selectedDate, WINDOW), 'yyyy-MM-dd');
  const { blocks, loading } = useBlockRange(startKey, endKey, liveBlocks);

  const goalMinutes = Math.round((userSettings?.sleep_goal_hours || 8) * 60);
  const wakeClock = parseClockText(userSettings?.default_wake_time) ?? 7 * 60;

  const logsByNight = useMemo(() => {
    const m: Record<string, { quality: number | null; energy: number | null; factors: string[]; notes: string | null }> = {};
    for (const l of sleepLogs) m[l.date_key] = { quality: l.quality, energy: l.energy ?? null, factors: l.factors ?? [], notes: l.notes };
    return m;
  }, [sleepLogs]);

  const nights = useMemo(() => {
    const sleepBlocks = blocks.filter((b) => b.activity_id && sleepIds.has(b.activity_id));
    const keys: string[] = [];
    for (let i = WINDOW; i >= 1; i--) keys.push(format(subDays(selectedDate, i), 'yyyy-MM-dd'));
    return buildNights(sleepBlocks, keys, logsByNight);
  }, [blocks, sleepIds, selectedDate, logsByNight]);

  const baseline = useMemo(() => getBaseline(nights.slice(-14)), [nights]);
  const scores = useMemo(() => nights.map((n) => scoreNight(n, goalMinutes, baseline)), [nights, goalMinutes, baseline]);
  const last = nights[nights.length - 1];
  const lastScore = scores[scores.length - 1];
  const tracked = nights.filter((n) => n.main);

  if (sleepActs.length === 0) {
    return (
      <div className="max-w-2xl mx-auto w-full">
        <div className="bg-card border border-border rounded-2xl p-8 text-center shadow-sm">
          <BedDouble className="w-12 h-12 mx-auto text-primary mb-4" />
          <h2 className="text-xl font-bold mb-2">Set up sleep tracking</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Sleep is tracked with your normal 10-minute blocks. Create an activity for it (for example "Sleep"), tick
            "This is my sleep activity" in Activities, then paint the blocks you slept in the Today grid.
          </p>
          <ul className="text-sm text-muted-foreground text-left max-w-sm mx-auto space-y-1.5">
            <li>• Duration, naps and wake-ups come from your blocks</li>
            <li>• A score with visible components, sleep debt and regularity</li>
            <li>• A bedtime planner, patterns and what affects your nights</li>
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className={pageClass('wide')}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div role="tablist" aria-label="Sleep sections" className="flex gap-1 overflow-x-auto no-scrollbar min-w-0">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`px-3.5 sm:px-4 py-1.5 text-sm font-medium rounded-full transition-colors ${tab === t.id ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-muted-foreground hidden sm:inline">
            {tracked.length} night{tracked.length === 1 ? '' : 's'} in the last {WINDOW} days{loading ? ' · loading…' : ''}
          </span>
          {tab !== 'log' && (
            <button onClick={() => setTab('log')} className="px-3 py-1.5 min-h-[34px] text-xs font-semibold rounded-full bg-primary text-primary-foreground hover:opacity-90">
              Log a night
            </button>
          )}
        </div>
      </div>

      {tab === 'overview' && (
        <Overview
          nights={nights} last={last} lastScore={lastScore} goalMinutes={goalMinutes} wakeClock={wakeClock}
          onSaveSettings={onUpdateSettings} settings={userSettings}
        />
      )}
      {tab === 'trends' && (
        <Trends nights={nights} scores={scores} goalMinutes={goalMinutes} days={trendDays} onDays={setTrendDays} wakeClock={wakeClock} />
      )}
      {tab === 'patterns' && (
        <Patterns
          nights={nights} goalMinutes={goalMinutes} activities={activities} sleepLogs={sleepLogs} tasks={tasks} focusSessions={focusSessions}
          liveBlocks={liveBlocks} selectedDate={selectedDate}
        />
      )}
      {tab === 'log' && (
        <LogTab nights={nights} sleepLogs={sleepLogs} onSave={onAddSleepLog} onDelete={onDeleteSleepLog} selectedDate={selectedDate} />
      )}
    </div>
  );
};

// ─── Overview ────────────────────────────────────────────────────────────────

const Overview: React.FC<{
  nights: Night[];
  last: Night | undefined;
  lastScore: ReturnType<typeof scoreNight> | undefined;
  goalMinutes: number;
  wakeClock: number;
  settings: UserSettings | null;
  onSaveSettings: (u: Partial<UserSettings>) => void;
}> = ({ nights, last, lastScore, goalMinutes, wakeClock, settings, onSaveSettings }) => {
  const recent14 = nights.slice(-14);
  const debt = getSleepDebt(nights, goalMinutes);
  const reg = getRegularity(nights);
  const avg7 = getAverages(nights.slice(-7));
  const prev7 = getAverages(nights.slice(-14, -7));
  const goalStreak = getGoalStreak(nights, goalMinutes);
  const bedStreak = getBedtimeStreak(nights, 30);
  const insights = useMemo(() => getInsights(nights, goalMinutes), [nights, goalMinutes]);
  const overhead = mean(recent14.filter((n) => n.main).map((n) => (n.main!.inBedMinutes - n.main!.sleepMinutes))) ?? 0;
  const plan = planTonight(goalMinutes, wakeClock, overhead);
  const delta = avg7.totalMinutes !== null && prev7.totalMinutes !== null ? avg7.totalMinutes - prev7.totalMinutes : null;

  const [wakeText, setWakeText] = useState(`${String(Math.floor(wakeClock / 60)).padStart(2, '0')}:${String(wakeClock % 60).padStart(2, '0')}`);
  const [goalText, setGoalText] = useState(String(settings?.sleep_goal_hours ?? 8));
  useEffect(() => { setGoalText(String(settings?.sleep_goal_hours ?? 8)); }, [settings?.sleep_goal_hours]);

  return (
    <div className="space-y-4">
      {/* Last night hero */}
      <Card title={last ? `Last night · ${format(parseISO(last.nightDate), 'EEE d MMM')} → ${format(parseISO(last.wakeDate), 'EEE d MMM')}` : 'Last night'}>
        {last && last.main ? (
          <div className="flex flex-col md:flex-row gap-6 items-center md:items-start">
            <Ring value={last.totalMinutes / goalMinutes} color={lastScore ? scoreColor(lastScore.score) : undefined} label={`${formatDur(last.totalMinutes)} slept of a ${formatDur(goalMinutes)} goal`}>
              <div className="text-2xl font-bold ibm-mono leading-none">{formatDur(last.totalMinutes)}</div>
              <div className="text-[10px] text-muted-foreground mt-1">of {formatDur(goalMinutes)}</div>
            </Ring>

            <div className="flex-1 w-full space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div><div className="text-[11px] text-muted-foreground font-medium">Bedtime</div><div className="font-semibold ibm-mono">{formatRel(last.main.startRel)}</div></div>
                <div><div className="text-[11px] text-muted-foreground font-medium">Wake-up</div><div className="font-semibold ibm-mono">{formatRel(last.main.endRel)}</div></div>
                <div><div className="text-[11px] text-muted-foreground font-medium">Efficiency</div><div className="font-semibold ibm-mono">{Math.round(last.main.efficiency * 100)}%</div></div>
                <div><div className="text-[11px] text-muted-foreground font-medium">Wake-ups</div><div className="font-semibold ibm-mono">{last.main.wakeUps}{last.main.longestAwakeMinutes ? ` · longest ${formatDur(last.main.longestAwakeMinutes)}` : ''}</div></div>
              </div>
              {last.napMinutes > 0 && <p className="text-xs text-muted-foreground">Includes {formatDur(last.napMinutes)} of napping.</p>}

              {lastScore ? (
                <div>
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className="text-3xl font-bold ibm-mono" style={{ color: scoreColor(lastScore.score) }}>{lastScore.score}</span>
                    <span className="text-xs text-muted-foreground">sleep score · built from the parts below, nothing hidden</span>
                  </div>
                  <ul className="space-y-1.5">
                    {(Object.keys(lastScore.parts) as (keyof SleepScoreParts)[]).map((k) => {
                      const v = lastScore.parts[k];
                      return (
                        <li key={k} className="flex items-center gap-2 text-xs">
                          <span className="w-24 text-muted-foreground">{PART_LABEL[k]}</span>
                          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                            {v !== null && <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(v)}%` }} />}
                          </div>
                          <span className="w-16 text-right ibm-mono">{v === null ? 'not logged' : Math.round(v)}</span>
                          <span className="w-9 text-right text-[10px] text-muted-foreground">{SCORE_WEIGHTS[k]}%</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3 text-sm text-muted-foreground">
            <Moon className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <p>No sleep tracked for last night. Paint the blocks you slept in the Today grid (and any naps) and this fills in.</p>
          </div>
        )}
      </Card>

      {/* Key numbers */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat to="sleep-insights" label="7-night average" value={avg7.totalMinutes !== null ? formatDur(avg7.totalMinutes) : '—'} sub={delta !== null ? `${delta >= 0 ? '+' : '−'}${formatDur(Math.abs(delta))} vs the week before` : `goal ${formatDur(goalMinutes)}`} tone={avg7.totalMinutes !== null && avg7.totalMinutes >= goalMinutes * 0.95 ? 'good' : 'neutral'} />
        <Stat to="sleep-insights" label="Sleep debt" value={debt.nights >= 3 ? (debt.netMinutes === 0 ? 'None' : formatDur(debt.netMinutes)) : '—'} sub={debt.nights >= 3 ? `over the last ${debt.nights} nights` : 'needs 3 nights'} tone={debt.nights >= 3 ? (debt.netMinutes === 0 ? 'good' : debt.netMinutes >= 120 ? 'watch' : 'neutral') : 'neutral'} />
        <Stat to="sleep-insights" label="Regularity" value={reg.score !== null ? `${reg.score}` : '—'} sub={reg.bedSdMin !== null ? `bedtime ±${Math.round(reg.bedSdMin)} min · wake ±${Math.round(reg.wakeSdMin ?? 0)} min` : 'needs 2 nights'} tone={reg.score !== null ? (reg.score >= 80 ? 'good' : reg.score < 50 ? 'watch' : 'neutral') : 'neutral'} />
        <Stat label="Streaks" value={`${goalStreak}🌙`} sub={`nights meeting goal · ${bedStreak} on a steady bedtime`} />
      </div>

      {/* Tonight planner */}
      <Card title="Tonight" hint="Working back from your wake-up time so you can actually hit your goal.">
        <div className="grid md:grid-cols-[1fr_auto] gap-4 items-end">
          <div className="grid grid-cols-3 gap-3 text-center">
            {([['Wind down', plan.windDownClock], ['In bed', plan.inBedClock], ['Asleep by', plan.asleepByClock]] as const).map(([k, v]) => (
              <div key={k} className="bg-muted rounded-xl py-3">
                <div className="text-[11px] text-muted-foreground font-medium">{k}</div>
                <div className="text-lg font-bold ibm-mono">{formatClock(v)}</div>
              </div>
            ))}
          </div>
          <div className="flex gap-3 items-end">
            <label className="text-[11px] text-muted-foreground flex flex-col gap-1 font-medium">
              Wake-up
              <input
                type="time" value={wakeText}
                onChange={(e) => setWakeText(e.target.value)}
                onBlur={() => wakeText && wakeText !== (settings?.default_wake_time ?? '').slice(0, 5) && onSaveSettings({ default_wake_time: wakeText })}
                className="px-2 py-1.5 text-sm rounded-md border border-border bg-background text-foreground normal-case tracking-normal"
              />
            </label>
            <label className="text-[11px] text-muted-foreground flex flex-col gap-1 font-medium">
              Goal (h)
              <input
                type="number" min={4} max={12} step={0.25} value={goalText}
                onChange={(e) => setGoalText(e.target.value)}
                onBlur={() => { const v = parseFloat(goalText); if (v >= 4 && v <= 12 && v !== settings?.sleep_goal_hours) onSaveSettings({ sleep_goal_hours: v }); }}
                className="w-20 px-2 py-1.5 text-sm rounded-md border border-border bg-background text-foreground normal-case tracking-normal"
              />
            </label>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          Includes about {Math.round(overhead)} min you usually spend awake in bed plus 15 min to fall asleep. Wind-down is 45 min before bed.
        </p>
      </Card>

      {/* Coach */}
      <Card id="sleep-insights" detail summary={`${insights.length} finding${insights.length === 1 ? '' : 's'}`} title="What your data says" hint="Each line shows the evidence behind it.">
        <ul className="space-y-3">
          {insights.map((i) => (
            <li key={i.id} className="flex gap-3">
              <span className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${i.tone === 'good' ? 'bg-green-500' : i.tone === 'watch' ? 'bg-amber-500' : 'bg-muted-foreground'}`} aria-hidden />
              <div>
                <div className="text-sm font-semibold">{i.title}</div>
                <div className="text-xs text-muted-foreground">{i.detail}</div>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
};

// ─── Trends ──────────────────────────────────────────────────────────────────

const Trends: React.FC<{
  nights: Night[];
  scores: ReturnType<typeof scoreNight>[];
  goalMinutes: number;
  days: 14 | 30 | 90;
  onDays: (d: 14 | 30 | 90) => void;
  wakeClock: number;
}> = ({ nights, scores, goalMinutes, days, onDays, wakeClock }) => {
  const slice = nights.slice(-days);
  const sliceScores = scores.slice(-days);
  const goalH = goalMinutes / 60;

  const durationData = slice.map((n, i) => {
    const window = slice.slice(Math.max(0, i - 6), i + 1).filter((x) => x.totalMinutes > 0);
    const avg = window.length >= 3 ? window.reduce((s, x) => s + x.totalMinutes, 0) / window.length / 60 : null;
    return {
      label: format(parseISO(n.wakeDate), 'd MMM'),
      main: n.main ? Number((n.main.sleepMinutes / 60).toFixed(2)) : 0,
      nap: n.napMinutes ? Number((n.napMinutes / 60).toFixed(2)) : 0,
      avg: avg !== null ? Number(avg.toFixed(2)) : null,
    };
  });
  const scoreData = slice.map((n, i) => ({ label: format(parseISO(n.wakeDate), 'd MMM'), score: sliceScores[i]?.score ?? null }));
  const timingData = slice.map((n) => ({ label: format(parseISO(n.wakeDate), 'd MMM'), bed: n.main ? n.main.startRel : null, wake: n.main ? n.main.endRel : null }));

  const targetWakeRel = ((wakeClock - 18 * 60 + 1440) % 1440);
  const targetBedRel = Math.max(0, targetWakeRel - goalMinutes);
  const tick = { fontSize: 10, fill: 'hsl(var(--muted-foreground))' };
  const tip = { background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 };

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5" role="tablist" aria-label="Range">
        {([14, 30, 90] as const).map((d) => (
          <button key={d} role="tab" aria-selected={days === d} onClick={() => onDays(d)} className={`px-3 py-1.5 text-xs font-medium rounded-full border ${days === d ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground border-border hover:bg-accent'}`}>
            {d} nights
          </button>
        ))}
      </div>


      <Card id="sleep-duration" title="Duration" hint={`Hours slept per night with a 7-night average. Dashed line = your ${formatDur(goalMinutes)} goal.`}>
        <div style={{ height: chartH(220) }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={durationData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="label" tick={tick} interval="preserveStartEnd" />
              <YAxis tick={tick} width={28} domain={[0, (max: number) => Math.max(10, Math.ceil(max))]} />
              <RTooltip contentStyle={tip} formatter={(v, name) => [`${Number(v).toFixed(1)}h`, name === 'main' ? 'Main sleep' : name === 'nap' ? 'Naps' : '7-night avg']} />
              <ReferenceLine y={goalH} stroke="hsl(var(--primary))" strokeDasharray="5 4" />
              <Area type={CURVE} dataKey="main" stackId="s" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.3} strokeWidth={2} {...ANIM} />
              <Area type={CURVE} dataKey="nap" stackId="s" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.45} strokeWidth={1.5} {...ANIM} />
              <Line type={CURVE} dataKey="avg" stroke="hsl(var(--foreground))" strokeWidth={2} dot={false} connectNulls {...ANIM} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card id="sleep-timeline" detail summary={`${slice.length} nights`} title="Sleep timeline" hint="Each row is a night from 6 PM to 6 PM. Blue = main sleep, gaps = awake, amber = naps. The pale band is your target window.">
        <SleepRibbon nights={slice.length > 45 ? slice.slice(-45) : slice} targetBedRel={targetBedRel} targetWakeRel={targetWakeRel} />
        {slice.length > 45 && <p className="text-[11px] text-muted-foreground mt-1">Showing the latest 45 nights.</p>}
      </Card>

      <div className="grid md:grid-cols-2 gap-4 items-start">
        <Card id="sleep-score" detail summary={(() => { const v = sliceScores.map((x) => x?.score).filter((x): x is number => typeof x === 'number'); return v.length ? `avg ${Math.round(v.reduce((a, b) => a + b, 0) / v.length)}` : '—'; })()} title="Sleep score" hint="Duration, continuity, regularity and your rating, weighted 40/20/25/15.">
          <div style={{ height: chartH(180) }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={scoreData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" tick={tick} interval="preserveStartEnd" />
                <YAxis tick={tick} width={28} domain={[0, 100]} />
                <RTooltip contentStyle={tip} formatter={(v) => [String(v), 'Score']} />
                <ReferenceLine y={80} stroke="hsl(142 71% 45%)" strokeDasharray="4 4" opacity={0.6} />
                <Line type={CURVE} dataKey="score" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 2 }} connectNulls {...ANIM} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card id="sleep-timing" detail title="Bedtime and wake-up" hint="Flatter lines mean a steadier body clock.">
          <div style={{ height: chartH(180) }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={timingData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" tick={tick} interval="preserveStartEnd" />
                <YAxis tick={tick} width={52} tickFormatter={(v) => formatRel(Number(v))} domain={['dataMin - 30', 'dataMax + 30']} />
                <RTooltip contentStyle={tip} formatter={(v, name) => [formatRel(Number(v)), name === 'bed' ? 'Bedtime' : 'Wake-up']} />
                <Line type={CURVE} dataKey="bed" stroke="hsl(230 60% 60%)" strokeWidth={2} dot={{ r: 2 }} connectNulls {...ANIM} />
                <Line type={CURVE} dataKey="wake" stroke="hsl(35 90% 55%)" strokeWidth={2} dot={{ r: 2 }} connectNulls {...ANIM} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  );
};

// ─── Patterns ────────────────────────────────────────────────────────────────

const Patterns: React.FC<{
  nights: Night[];
  goalMinutes: number;
  activities: Activity[];
  sleepLogs: SleepLog[];
  tasks: Task[];
  focusSessions: TaskFocusSession[];
  liveBlocks: RangeBlock[];
  selectedDate: Date;
}> = ({ nights, goalMinutes, activities, sleepLogs, tasks, focusSessions, liveBlocks, selectedDate }) => {
  const avgs = getAverages(nights);
  const chrono = getChronotype(avgs.midpointRel);
  const sjl = getSocialJetLag(nights);
  const weekday = getWeekdayPattern(nights);
  const factors = getFactorImpacts(nights);
  const maxMin = Math.max(goalMinutes, ...weekday.map((w) => w.avgMinutes ?? 0));
  const order = [1, 2, 3, 4, 5, 6, 0];
  const napNights = nights.filter((n) => n.napMinutes > 0).length;
  const loggedNights = nights.filter((n) => n.quality !== null || n.factors.length > 0).length;

  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-3 gap-3">
        <Stat label="Average bedtime" value={avgs.bedRel !== null ? formatRel(avgs.bedRel) : '—'} sub={avgs.wakeRel !== null ? `wake ${formatRel(avgs.wakeRel)} on average` : undefined} />
        <Stat label="Mid-sleep" value={avgs.midpointRel !== null ? formatRel(avgs.midpointRel) : '—'} sub={chrono ? `${chrono.label} (rough guide from your mid-sleep)` : 'needs tracked nights'} />
        <Stat label="Weekend shift" value={sjl ? `${sjl.minutes >= 0 ? '+' : '−'}${formatDur(Math.abs(sjl.minutes))}` : '—'} sub={sjl ? `weekend vs weekday mid-sleep (${sjl.freeNights}/${sjl.workNights} nights)` : 'needs 3+ weekend and weekday nights'} tone={sjl && Math.abs(sjl.minutes) >= 60 ? 'watch' : 'neutral'} />
      </div>

      <Card id="sleep-weekday" title="By weekday" hint="Average total sleep for the morning you woke up on.">
        <ul className="space-y-2">
          {order.map((d) => {
            const w = weekday[d];
            return (
              <li key={d} className="flex items-center gap-3 text-sm">
                <span className="w-9 text-muted-foreground">{WEEKDAYS[d]}</span>
                <div className="flex-1 h-3 rounded-full bg-muted overflow-hidden relative">
                  {w.avgMinutes !== null && <div className="h-full rounded-full bg-primary" style={{ width: `${(w.avgMinutes / maxMin) * 100}%` }} />}
                  <div className="absolute top-0 bottom-0 w-px bg-foreground/40" style={{ left: `${(goalMinutes / maxMin) * 100}%` }} title="goal" />
                </div>
                <span className="w-20 text-right ibm-mono text-xs">{w.avgMinutes !== null ? formatDur(w.avgMinutes) : '—'}</span>
                <span className="w-10 text-right text-[10px] text-muted-foreground">n={w.n}</span>
              </li>
            );
          })}
        </ul>
      </Card>

      <div className="grid md:grid-cols-2 gap-4 items-start">
        <Card id="sleep-factors" detail summary={`${loggedNights} logged night${loggedNights === 1 ? '' : 's'}`} title="What affects your nights" hint="Compares nights with and without each factor. Needs 4+ nights in both groups. An association, not proof.">
          {factors.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {loggedNights < 8 ? `Tag what happened in the Log tab (${loggedNights} nights logged so far). After a couple of weeks this shows what helps and hurts.` : 'No factor has enough nights on both sides yet.'}
            </p>
          ) : (
            <ul className="space-y-3">
              {factors.map((f) => {
                const meta = SLEEP_FACTORS.find((x) => x.id === f.factor)!;
                return (
                  <li key={f.factor} className="text-sm">
                    <div className="flex justify-between gap-3">
                      <span>{meta.emoji} {meta.label}</span>
                      <span className="ibm-mono text-xs text-muted-foreground">{f.withN} vs {f.withoutN} nights</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {f.sleepDelta !== null && `${f.sleepDelta >= 0 ? '+' : '−'}${formatDur(Math.abs(f.sleepDelta))} sleep`}
                      {f.qualityDelta !== null && ` · quality ${f.qualityDelta >= 0 ? '+' : ''}${f.qualityDelta}`}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card id="sleep-naps" detail summary={`${napNights} night${napNights === 1 ? '' : 's'} with naps`} title="Naps" hint="Counted in your total, kept out of the main-sleep numbers.">
          <div className="text-2xl font-bold ibm-mono">{napNights}</div>
          <div className="text-xs text-muted-foreground">days with a nap in the last {nights.length} · about {formatDur(avgs.napMinutesPerDay ?? 0)} per day on average</div>
          {avgs.efficiency !== null && (
            <div className="mt-4 text-xs text-muted-foreground">
              Sleep efficiency <strong className="text-foreground">{Math.round(avgs.efficiency * 100)}%</strong> · {avgs.wakeUps?.toFixed(1)} wake-ups a night
            </div>
          )}
        </Card>
      </div>

      <SleepInsights detail activities={activities} sleepLogs={sleepLogs} tasks={tasks} focusSessions={focusSessions} liveBlocks={liveBlocks} selectedDate={selectedDate} />
    </div>
  );
};

// ─── Log ─────────────────────────────────────────────────────────────────────

const Scale: React.FC<{ value: number; onChange: (v: number) => void; labels: string[]; ariaLabel: string; icon?: React.ReactNode }> = ({ value, onChange, labels, ariaLabel, icon }) => (
  <div className="flex gap-1.5" role="radiogroup" aria-label={ariaLabel}>
    {labels.map((l, i) => {
      const v = i + 1;
      const on = value === v;
      return (
        <button
          key={v}
          role="radio"
          aria-checked={on}
          aria-label={`${ariaLabel} ${v}`}
          onClick={() => onChange(on ? 0 : v)}
          className={`min-w-[44px] min-h-[44px] rounded-xl border text-lg flex items-center justify-center transition-colors ${on ? 'bg-primary/10 border-primary' : 'border-border hover:bg-accent'}`}
          title={l}
        >
          {icon ?? l}
          {icon && <span className="sr-only">{l}</span>}
        </button>
      );
    })}
  </div>
);

const LogTab: React.FC<{
  nights: Night[];
  sleepLogs: SleepLog[];
  onSave: SleepHubProps['onAddSleepLog'];
  onDelete: (id: string) => void;
  selectedDate: Date;
}> = ({ nights, sleepLogs, onSave, onDelete, selectedDate }) => {
  const defaultNight = format(subDays(selectedDate, 1), 'yyyy-MM-dd');
  const [night, setNight] = useState(defaultNight);
  const existing = sleepLogs.find((l) => l.date_key === night);
  const [quality, setQuality] = useState(0);
  const [energy, setEnergy] = useState(0);
  const [factors, setFactors] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => { setNight(defaultNight); }, [defaultNight]);
  useEffect(() => {
    setQuality(existing?.quality ?? 0);
    setEnergy(existing?.energy ?? 0);
    setFactors(existing?.factors ?? []);
    setNotes(existing?.notes ?? '');
    setSaved(false);
  }, [night, existing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const n = nights.find((x) => x.nightDate === night);
  const recent = [...sleepLogs].sort((a, b) => b.date_key.localeCompare(a.date_key)).slice(0, 14);

  const save = () => {
    onSave({ date_key: night, quality: quality || undefined, energy: energy || null, factors, notes: notes.trim() || undefined });
    setSaved(true);
  };

  return (
    <div className="space-y-4">
      <Card title="Log a night" hint="30 seconds. Quality and factors unlock the score's rating part and the “what affects your nights” analysis.">
        <div className="space-y-5">
          <label className="flex flex-col gap-1 text-xs font-semibold max-w-xs">
            Night starting on
            <input type="date" value={night} max={format(new Date(), 'yyyy-MM-dd')} onChange={(e) => e.target.value && setNight(e.target.value)} className="px-3 py-2 text-sm rounded-md border border-border bg-background font-normal" />
            <span className="text-[11px] font-normal text-muted-foreground">
              {n?.main ? `${formatDur(n.totalMinutes)} tracked (${formatRel(n.main.startRel)} → ${formatRel(n.main.endRel)})` : 'No sleep blocks tracked for this night yet.'}
            </span>
          </label>

          <div>
            <div className="text-xs font-semibold mb-2">How well did you sleep?</div>
            <Scale value={quality} onChange={setQuality} ariaLabel="Sleep quality" labels={['Terrible', 'Poor', 'Okay', 'Good', 'Great']} icon={<Star className={`w-5 h-5 ${quality ? 'fill-amber-500 text-amber-500' : ''}`} />} />
          </div>
          <div>
            <div className="text-xs font-semibold mb-2">How did you feel on waking?</div>
            <Scale value={energy} onChange={setEnergy} ariaLabel="Morning energy" labels={['Drained', 'Tired', 'Fine', 'Rested', 'Energised']} />
            <div className="flex gap-1.5 mt-1 text-[10px] text-muted-foreground"><Zap className="w-3 h-3" /> 1 drained · 5 energised</div>
          </div>
          <div>
            <div className="text-xs font-semibold mb-2">What happened?</div>
            <div className="flex flex-wrap gap-2">
              {SLEEP_FACTORS.map((f) => {
                const on = factors.includes(f.id);
                return (
                  <button
                    key={f.id}
                    aria-pressed={on}
                    onClick={() => setFactors((cur) => (on ? cur.filter((x) => x !== f.id) : [...cur, f.id]))}
                    className={`px-3 py-2 rounded-full text-sm border transition-colors ${on ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-accent'}`}
                  >
                    {f.emoji} {f.label}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="block text-xs font-semibold">
            Notes
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Vivid dreams, hot room, late call…" className="mt-1 w-full px-3 py-2 text-sm rounded-md border border-border bg-background font-normal" />
          </label>
          <div className="flex items-center gap-3">
            <button onClick={save} className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 active:scale-95 transition">Save night</button>
            {saved && <span className="text-xs text-green-600 dark:text-green-400" role="status">Saved</span>}
          </div>
        </div>
      </Card>

      <Card id="sleep-recent" detail summary={`${recent.length} shown`} title="Recent logs">
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2"><AlertCircle className="w-4 h-4" /> Nothing logged yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {recent.map((l) => {
              const nt = nights.find((x) => x.nightDate === l.date_key);
              return (
                <li key={l.id} className="py-2 flex items-center gap-3 text-sm">
                  <button onClick={() => setNight(l.date_key)} className="w-24 text-left font-medium hover:underline">{format(parseISO(l.date_key), 'EEE d MMM')}</button>
                  <span className="ibm-mono text-xs w-16">{nt?.main ? formatDur(nt.totalMinutes) : '—'}</span>
                  <span className="text-xs w-14">{l.quality ? `★ ${l.quality}` : ''}</span>
                  <span className="flex-1 text-xs text-muted-foreground truncate">{(l.factors ?? []).map((f) => SLEEP_FACTORS.find((x) => x.id === f)?.emoji).join(' ')} {l.notes ?? ''}</span>
                  <button onClick={() => onDelete(l.id)} className="p-1.5 text-muted-foreground hover:text-destructive" aria-label={`Delete log for ${l.date_key}`}><Trash2 size={14} /></button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
};
