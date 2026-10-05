import React, { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis,
} from 'recharts';
import { ANIM, CURVE, chartH } from './ui/chart';
import { AttentionBudgetCard } from './AttentionBudgetCard';
import { ProductivityPointsCard } from './ProductivityPointsCard';
import { attentionPeriod, type AttentionActivityRow, type AttentionDailyRow } from '../lib/attention';
import { Section, StatTile } from './ui/detail';
import { SetupNudge } from './ui/analysisNav';
import { Takeaways } from './ui/takeaways';
import { trendsTakeaways } from '../lib/takeaways';
import { formatPoints, formatProductivity } from '../lib/activityFlags';
import type { Activity, Goal, Task, TaskBlockRef, TaskFocusSession } from '../types';
import { useBlockRange } from '../hooks/useBlockRange';
import { useDailyAnalyticsRange, useActivityAnalyticsRange, useGoalAnalyticsRange } from '../hooks/useAnalyticsRange';
import { mapAnalyticsToProfiles } from '../lib/backendAdapter';
import type { RangeBlock } from '../lib/blockRange';
import { activityDistributionFromActivityDaily, distributionFromActivityDaily, DEFAULT_RANGE, getRangeWindow, getTimeAccounting, type Coverage, type InsightRange } from '../lib/insights';
import { bucketDailySeries, compareMetric, dailySeries, dailyValues, deadlineReliability, estimationAccuracy, focusSupplementByDate, summarize } from '../lib/analysis';
import { getSleepActivityIds } from '../lib/sleepActivity';
import { getGoalPace, goalStartKey, groupGoalDailyRows, mergeGoalDailyLive } from '../lib/goals';
import { getDeadlineDateKey, isDateOnlyDeadline } from '../lib/deadlines';
import { mean } from '../lib/stats';
import { BLOCK_MINUTES, formatMinutes, getExplicitEstimateMinutes, summarizeTaskTime } from '../lib/taskTime';
import { ChangeChip } from './ChangeChip';
import { RangePicker, type RangeState } from './RangePicker';
import { TrendsDayView } from './DayModeViews';
import { FULL, PAIR, pageClass } from './ui/page';

/** Fixed metric hues, distinct from CATEGORY_COLORS below so a line never reads as a category. */
const METRIC_COLORS = { tracked: 'hsl(217 91% 60%)', deep: 'hsl(160 84% 39%)', ghost: 'hsl(var(--muted-foreground))' };

interface TrendsTabProps {
  activities: Activity[];
  tasks: Task[];
  taskBlocks: TaskBlockRef[];
  focusSessions: TaskFocusSession[];
  goals: Goal[];
  /** Live blocks of the selected date (optimistic). */
  blocks: RangeBlock[];
  selectedDate: Date;
}

const CATEGORY_COLORS: Record<string, string> = {
  Work: 'hsl(217 91% 60%)', Health: 'hsl(142 71% 45%)', Admin: 'hsl(45 93% 47%)', Leisure: 'hsl(283 39% 53%)',
  Other: 'hsl(0 0% 50%)', Sleep: 'hsl(230 40% 40%)', Uncategorized: 'hsl(0 0% 60%)', Untracked: 'hsl(var(--muted))',
};

/** kept as a name so every analysis view shares one card: see ui/detail Section */
export const Card = Section;

const TrendsRangeView: React.FC<TrendsTabProps & RangeState> = ({ activities, tasks, taskBlocks, focusSessions, goals, blocks: liveBlocks, selectedDate, range, setRange }) => {
  const win = useMemo(() => getRangeWindow(range, selectedDate), [range, selectedDate]);
  const fetchStart = win.prev?.startKey ?? win.startKey;
  
  const { rows: dailyRows, loading: dailyLoading } = useDailyAnalyticsRange(fetchStart, win.endKey);
  const { rows: activityDailyRows, loading: activityLoading } = useActivityAnalyticsRange(fetchStart, win.endKey);
  const { blocks: all, loading: blocksLoading } = useBlockRange(fetchStart, win.endKey, liveBlocks);
  const loading = dailyLoading || activityLoading || blocksLoading;

  const sleepIds = useMemo(() => getSleepActivityIds(activities), [activities]);
  const now = new Date();

  // Deterministic fields come from the backend; the focus-model fields analytics_daily
  // deliberately excludes (depth/deep/eligible/longestRun/runs) are enriched from
  // the same bounded raw-block fetch this screen already needs for accounting below -- never a
  // second, unbounded scan.
  const focusSupplement = useMemo(
    () => focusSupplementByDate({ blocks: all, activities, sleepIds, sessions: focusSessions }, [...win.dateKeys, ...(win.prev?.dateKeys ?? [])]),
    [all, activities, sleepIds, focusSessions, win.dateKeys, win.prev]
  );
  const mappedProfiles = useMemo(() => mapAnalyticsToProfiles(dailyRows as any[], focusSupplement), [dailyRows, focusSupplement]);
  const cur = useMemo(() => mappedProfiles.filter(p => win.dateKeys.includes(p.dateKey)), [mappedProfiles, win.dateKeys]);
  const prev = useMemo(() => (win.prev ? mappedProfiles.filter(p => win.prev!.dateKeys.includes(p.dateKey)) : null), [mappedProfiles, win.prev]);
  const sum = useMemo(() => summarize(cur), [cur]);

  const current = useMemo(() => all.filter((b) => b.date_key >= win.startKey), [all, win.startKey]);
  // Coverage built from the already-backend-derived summary instead of a raw getCoverage() scan.
  const coverage: Coverage = useMemo(() => ({
    trackedMinutes: sum.assignedMinutes,
    untrackedMinutes: sum.elapsedMinutes - sum.assignedMinutes,
    elapsedMinutes: sum.elapsedMinutes,
    coveragePct: sum.coveragePct,
  }), [sum]);
  const curActivityRows = useMemo(() => activityDailyRows.filter((r: any) => win.dateKeys.includes(r.date_key)), [activityDailyRows, win.dateKeys]);
  const prevActivityRows = useMemo(
    () => (win.prev ? activityDailyRows.filter((r: any) => win.prev!.dateKeys.includes(r.date_key)) : undefined),
    [activityDailyRows, win.prev]
  );
  const distribution = useMemo(
    () => distributionFromActivityDaily(curActivityRows as any[], activities, sleepIds, coverage, prevActivityRows as any[] | undefined),
    [curActivityRows, prevActivityRows, activities, sleepIds, coverage]
  );
  const accounting = useMemo(() => getTimeAccounting(current, coverage, sleepIds), [current, coverage, sleepIds]);
  // Time distribution: by category (default) or by individual activity, both from analytics_activity_daily
  const [breakdownBy, setBreakdownBy] = useState<'category' | 'activity'>('category');
  const distRows = useMemo(
    () => (breakdownBy === 'category'
      ? distribution.map((d) => ({ key: d.category, name: d.category, minutes: d.minutes, pct: d.pct, color: CATEGORY_COLORS[d.category] || CATEGORY_COLORS.Other }))
      : activityDistributionFromActivityDaily(curActivityRows as any[], activities, coverage).map((r) => ({ key: r.id, name: r.name, minutes: r.minutes, pct: r.pct, color: r.color }))),
    [breakdownBy, distribution, curActivityRows, activities, coverage]
  );

  const perDay = (m: Parameters<typeof dailyValues>[1]) => mean(dailyValues(cur, m));
  const trackedPerDay = perDay('tracked');
  const deepPerDay = perDay('deep');

  const longRange = range === '6m' || range === '1y';
  const chartSeries = useMemo(() => bucketDailySeries(dailySeries(cur), longRange), [cur, longRange]);
  const hasMultipliers = useMemo(() => activities.some((a) => !!a.productivity_multiplier), [activities]);
  const firstHalf = chartSeries.slice(0, Math.ceil(chartSeries.length / 2));
  const secondHalf = chartSeries.slice(Math.ceil(chartSeries.length / 2));
  const halfAvg = (pts: typeof chartSeries, pick: (p: (typeof chartSeries)[number]) => number | null) => mean(pts.map(pick).filter((v): v is number => v !== null));
  const trackedTrend = chartSeries.length >= 4 ? (halfAvg(secondHalf, (p) => p.trackedMinutes) ?? 0) - (halfAvg(firstHalf, (p) => p.trackedMinutes) ?? 0) : null;
  const qualityTrend = chartSeries.length >= 4 ? (() => {
    const a = halfAvg(firstHalf, (p) => p.focusQualityPct), b = halfAvg(secondHalf, (p) => p.focusQualityPct);
    return a !== null && b !== null ? b - a : null;
  })() : null;
  const productivityTrend = chartSeries.length >= 4 ? (() => {
    const a = halfAvg(firstHalf, (p) => p.productivityScore), b = halfAvg(secondHalf, (p) => p.productivityScore);
    return a !== null && b !== null ? b - a : null;
  })() : null;

  // Tasks and planning
  const doneInRange = tasks.filter((t) => t.completed && t.completed_at && format(new Date(t.completed_at), 'yyyy-MM-dd') >= win.startKey && format(new Date(t.completed_at), 'yyyy-MM-dd') <= win.endKey).length;
  const completedWithoutTime = tasks.filter((t) => t.completed && !t.completed_at).length;

  const estimation = useMemo(() => {
    const catOf = (t: Task) => activities.find((a) => a.id === t.activity_id)?.category || 'No activity';
    const tracked = new Map<string, number>();
    for (const b of taskBlocks) tracked.set(b.task_id, (tracked.get(b.task_id) || 0) + BLOCK_MINUTES);
    return estimationAccuracy(tasks.map((t) => ({
      id: t.id, completed: t.completed, estimatedMinutes: getExplicitEstimateMinutes(t), trackedMinutes: tracked.get(t.id) || 0, group: catOf(t),
    })));
  }, [tasks, taskBlocks, activities]);

  const reliability = useMemo(() => deadlineReliability(
    tasks.filter((t) => t.completed && t.deadline && t.completed_at).map((t) => {
      let dueAt: Date;
      if (isDateOnlyDeadline(t.deadline!)) {
        const [y, m, d] = getDeadlineDateKey(t.deadline!).split('-').map(Number);
        dueAt = new Date(y, m - 1, d, 23, 59, 59, 999);
      } else dueAt = new Date(t.deadline!);
      return { dueAt, doneAt: new Date(t.completed_at!) };
    })
  ), [tasks]);
  const unmeasured = tasks.filter((t) => t.completed && t.deadline && !t.completed_at).length;

  const planning = useMemo(() => {
    let estimated = 0, scheduled = 0, tracked = 0, focused = 0, n = 0;
    for (const t of tasks) {
      const s = summarizeTaskTime(t as Task & { id: string }, taskBlocks, focusSessions, now);
      if (!s.estimatedMinutes) continue;
      n++;
      estimated += s.estimatedMinutes; scheduled += s.scheduledMinutes; tracked += s.trackedMinutes; focused += s.focusedMinutes;
    }
    return { estimated, scheduled, tracked, focused, n };
  }, [tasks, taskBlocks, focusSessions]); // eslint-disable-line react-hooks/exhaustive-deps

  // Goals: historical progress from the backend's per-goal daily aggregate
  // (analytics_goal_daily), not an unbounded "goal start -> forever" raw block scan
  // -- mirrors GoalsPage exactly, including the live-date overlay.
  const activeGoals = useMemo(() => goals.filter((g) => (g.status ?? 'active') === 'active'), [goals]);
  const goalStart = useMemo(() => activeGoals.map((g) => goalStartKey(g)).filter((k): k is string => !!k).sort()[0] ?? win.endKey, [activeGoals, win.endKey]);
  const goalTo = goalStart > win.endKey ? goalStart : win.endKey;
  const { rows: goalDailyRows } = useGoalAnalyticsRange(goalStart, goalTo);
  const goalDailyByGoal = useMemo(() => groupGoalDailyRows(goalDailyRows as any[]), [goalDailyRows]);
  const goalRows = useMemo(
    () => activeGoals.map((g) => ({ goal: g, pace: getGoalPace(g, mergeGoalDailyLive(goalDailyByGoal.get(g.id) ?? [], g, liveBlocks)) })),
    [activeGoals, goalDailyByGoal, liveBlocks]
  );

  const attention = useMemo(() => attentionPeriod(dailyRows as AttentionDailyRow[], win.dateKeys), [dailyRows, win.dateKeys]);

  const topCategory = distribution.find((d) => d.category !== 'Untracked' && d.category !== 'Sleep');
  const overall = estimation.overall;
  const openTasks = tasks.filter((t) => !t.completed).length;
  const takeaways = useMemo(() => trendsTakeaways({
    topCategory: topCategory ? { name: topCategory.category, minutes: topCategory.minutes } : null,
    untrackedPct: coverage.coveragePct === null ? null : 100 - coverage.coveragePct,
    trackedPerDay,
    deepPerDay,
    productivityScore: hasMultipliers ? sum.productivityScore : null,
    changes: {
      tracked: prev ? compareMetric(cur, prev, 'tracked') : null,
      deep: prev ? compareMetric(cur, prev, 'deep') : null,
      productivity: prev && hasMultipliers ? compareMetric(cur, prev, 'productivity') : null,
    },
    attention,
    tasksDone: doneInRange,
    tasksOpen: openTasks,
  }), [topCategory, coverage, trackedPerDay, deepPerDay, hasMultipliers, sum, prev, cur, attention, doneInRange, openTasks]);

  return (
    <div className={pageClass('wide', true)}>
      <div className={`flex items-center justify-between gap-3 flex-wrap ${FULL}`}>
        <p className="text-sm text-muted-foreground">
          {format(parseISO(win.startKey), 'd MMM yyyy')} – {format(parseISO(win.endKey), 'd MMM yyyy')}{loading ? ' · loading…' : ''}
        </p>
        <RangePicker range={range} onChange={setRange} selectedDate={selectedDate} />
      </div>

      <Takeaways items={takeaways} loading={loading} className={FULL} />

      {/* Headline metrics: each one answers a different question; tap one for its chart */}
      <div className={`grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 ${FULL}`}>
        <StatTile
          to="trends-over-time"
          label="Tracked / day"
          value={trackedPerDay === null ? '—' : formatMinutes(trackedPerDay)}
          hint="Average tracked time on finished days that have any tracking"
          sub={<><div>{formatMinutes(sum.assignedMinutes)} in total</div><ChangeChip change={prev ? compareMetric(cur, prev, 'tracked') : null} fmt={formatMinutes} /></>}
        />
        <StatTile
          to="trends-over-time"
          label="Deep focus / day"
          value={deepPerDay === null ? '—' : formatMinutes(deepPerDay)}
          hint="Focus-eligible time inside uninterrupted runs of 30 minutes or more"
          sub={<><div>{sum.sustainedSharePct === null ? 'no focus work yet' : `${sum.sustainedSharePct}% of focus time is sustained`}</div><ChangeChip change={prev ? compareMetric(cur, prev, 'deep') : null} fmt={formatMinutes} /></>}
        />
        <StatTile
          to="trends-quality"
          label="Focus quality"
          value={sum.focusQualityPct === null ? '—' : `${sum.focusQualityPct}%`}
          hint="How deep your focus-eligible time was: warm-up, sustained runs, fragmentation"
          sub={<><div>{sum.focusSharePct === null ? '' : `${sum.focusSharePct}% of tracked time is focus work`}</div><ChangeChip change={prev ? compareMetric(cur, prev, 'quality') : null} fmt={(v) => `${Math.round(v)} pts`} /></>}
        />
        <StatTile
          to="trends-distribution"
          label="Logged"
          value={sum.coveragePct === null ? '—' : `${sum.coveragePct}%`}
          hint="Share of elapsed time that has any recorded activity. It measures logging, not productivity."
          sub={<><div>of elapsed time has something logged</div><ChangeChip change={prev ? compareMetric(cur, prev, 'coverage') : null} fmt={(v) => `${Math.round(v)} pts`} /></>}
        />
        <StatTile
          to="trends-productivity"
          label="Productivity"
          value={sum.productivityScore === null ? '—' : formatProductivity(sum.productivityScore)}
          hint="Productivity points per counted minute: each minute (sleep and ignored activities excluded) scored by its activity's multiplier, averaged."
          sub={<><div>{!hasMultipliers ? 'no multipliers set yet' : `${formatPoints(sum.productivityPoints)} in total`}</div><ChangeChip change={prev ? compareMetric(cur, prev, 'productivity') : null} fmt={(v) => formatProductivity(v)} /></>}
        />
        <StatTile
          to="trends-planning"
          label="Tasks done"
          value={String(doneInRange)}
          sub={completedWithoutTime > 0 ? `${completedWithoutTime} older completed task(s) have no completion time` : 'completed in range'}
        />
      </div>

      <Card
        id="trends-over-time"
        className={FULL}
        title="Tracked & deep focus over time"
        hint={`${longRange ? 'Weekly average' : 'Daily'} minutes tracked, and how much of that was deep-focus (30+ min uninterrupted runs).`}
      >
        {chartSeries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No days in this range yet.</p>
        ) : (
          <>
            <div style={{ height: chartH(200) }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartSeries} margin={{ left: 0, right: 8, top: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} width={40} tickFormatter={(v) => `${Math.round(v / 60)}h`} />
                  <RechartsTooltip formatter={(v, n) => [formatMinutes(Number(v)), n]} contentStyle={{ fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area type={CURVE} dataKey="trackedMinutes" name="Tracked" stroke={METRIC_COLORS.tracked} fill={METRIC_COLORS.tracked} fillOpacity={0.15} strokeWidth={2} {...ANIM} />
                  <Area type={CURVE} dataKey="deepMinutes" name="Deep focus" stroke={METRIC_COLORS.deep} fill={METRIC_COLORS.deep} fillOpacity={0.3} strokeWidth={2} {...ANIM} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              {trackedTrend === null
                ? `Averaging ${formatMinutes(Math.round(mean(chartSeries.map((p) => p.trackedMinutes)) ?? 0))} tracked per ${longRange ? 'week' : 'day'} across the range.`
                : `Tracked time in the second half of this range averages ${trackedTrend >= 0 ? 'up' : 'down'} ${formatMinutes(Math.abs(Math.round(trackedTrend)))} per ${longRange ? 'week' : 'day'} versus the first half.`}
            </p>
          </>
        )}
      </Card>

      <Card
        id="trends-distribution"
        detail
        summary={topCategory ? `most: ${topCategory.category}` : '—'}
        title="Time distribution"
        hint="Share of elapsed time. Untracked is time with no recorded activity, not idle time."
        actions={
          <div className="flex gap-1.5" role="tablist" aria-label="Break down by">
            {(['category', 'activity'] as const).map((v) => (
              <button
                key={v}
                role="tab"
                aria-selected={breakdownBy === v}
                onClick={() => setBreakdownBy(v)}
                className={`px-2.5 py-1.5 text-[11px] font-medium rounded-full border transition-colors ${breakdownBy === v ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground border-border hover:bg-accent'}`}
              >
                {v === 'category' ? 'Category' : 'Activity'}
              </button>
            ))}
          </div>
        }
      >
        {distRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tracked time in this range.</p>
        ) : (
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <div className="w-28 h-28 sm:w-32 sm:h-32 flex-shrink-0" role="img" aria-label={`Time distribution by ${breakdownBy}`}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={distRows} dataKey="minutes" nameKey="name" innerRadius="55%" outerRadius="90%" paddingAngle={distRows.length > 1 ? 2 : 0} stroke="none" {...ANIM}>
                    {distRows.map((d) => <Cell key={d.key} fill={d.color} />)}
                  </Pie>
                  <RechartsTooltip formatter={(v, n) => [formatMinutes(Number(v)), n]} contentStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="space-y-2 flex-1 w-full min-w-0">
              {distRows.map((d) => (
                <li key={d.key}>
                  <div className="flex justify-between gap-2 text-xs mb-1">
                    <span className="font-medium truncate">{d.name}</span>
                    <span className="ibm-mono text-muted-foreground flex-shrink-0">{formatMinutes(d.minutes)} · {d.pct}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden" role="img" aria-label={`${d.name} ${d.pct}%`}>
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, d.pct)}%`, backgroundColor: d.color }} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground mt-3">
          Awake tracked time: {formatMinutes(accounting.taskLinked)} linked to a task, {formatMinutes(accounting.otherTracked)} other. Untracked across the whole range: {formatMinutes(accounting.untracked)}.
        </p>
      </Card>

      <div className={`grid md:grid-cols-2 gap-4 items-start ${PAIR}`}>
        <Card id="trends-quality" detail summary={sum.focusQualityPct === null ? '—' : `avg ${sum.focusQualityPct}%`} title="Focus quality over time" hint={`${longRange ? 'Weekly average' : 'Daily'} depth of focus-eligible time, 0-100. Blank points had under 30 min of focus work.`}>
          {chartSeries.every((p) => p.focusQualityPct === null) ? (
            <p className="text-sm text-muted-foreground">Not enough focus time yet.</p>
          ) : (
            <>
              <div style={{ height: chartH(160) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} width={28} domain={[0, 100]} />
                    <RechartsTooltip formatter={(v) => [`${v} pts`, 'Focus quality']} contentStyle={{ fontSize: 12 }} />
                    <Line type={CURVE} dataKey="focusQualityPct" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} connectNulls {...ANIM} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="text-[11px] text-muted-foreground mt-2">
                {qualityTrend === null ? 'Too early to call a trend.' : `Quality is ${qualityTrend >= 0 ? 'up' : 'down'} about ${Math.abs(Math.round(qualityTrend))} pts in the second half of this range versus the first.`}
              </p>
            </>
          )}
        </Card>

        <Card id="trends-productivity" detail summary={sum.productivityScore === null ? '—' : `avg ${formatProductivity(sum.productivityScore)}`} title="Productivity over time" hint={`Is your time getting more or less productive? ${longRange ? 'Weekly average' : 'Daily'} productivity points per counted minute (sleep and ignored activities excluded).`}>
          {!hasMultipliers ? (
            <SetupNudge action="Set multipliers">No activity has a productivity multiplier yet, so this stays flat at 0.</SetupNudge>
          ) : (
            <>
              <div style={{ height: chartH(160) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} width={32} tickFormatter={(v) => `${v > 0 ? '+' : ''}${v}`} />
                    <RechartsTooltip formatter={(v) => [formatProductivity(Number(v)), 'Productivity']} contentStyle={{ fontSize: 12 }} />
                    <Line type={CURVE} dataKey="productivityScore" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} connectNulls {...ANIM} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="text-[11px] text-muted-foreground mt-2">
                {productivityTrend === null ? 'Too early to call a trend.' : `Productivity is ${productivityTrend >= 0 ? 'up' : 'down'} about ${formatProductivity(Math.abs(productivityTrend)).replace('+', '')} in the second half of this range versus the first.`}
              </p>
            </>
          )}
        </Card>
      </div>

      <ProductivityPointsCard
        id="trends-points-history"
        className={FULL}
        rows={dailyRows}
        win={win}
        weekly={longRange}
        loading={dailyLoading}
        activities={activities}
      />

      <AttentionBudgetCard
        className={FULL}
        activities={activities}
        dailyRows={dailyRows as AttentionDailyRow[]}
        activityRows={activityDailyRows as AttentionActivityRow[]}
        dateKeys={win.dateKeys}
        prevDateKeys={win.prev?.dateKeys}
        loading={dailyLoading || activityLoading}
      />

      <div className={`grid md:grid-cols-2 gap-4 items-start ${PAIR}`}>
        <Card id="trends-fragmentation" detail summary={sum.switchesPerHour === null ? '—' : `${sum.switchesPerHour.toFixed(1)} switches/h`} title="Switching" hint="How long you stay on one thing and how often you change, measured from your blocks.">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {([
              ['Typical stretch on one activity', sum.meanRunMinutes === null ? '—' : formatMinutes(sum.meanRunMinutes)],
              ['Longest focus stretch', sum.longestRunMinutes ? formatMinutes(sum.longestRunMinutes) : '—'],
              ['Switches per tracked hour', sum.switchesPerHour === null ? '—' : sum.switchesPerHour.toFixed(1)],
              ['…of which change category', sum.crossSwitchesPerHour === null ? '—' : sum.crossSwitchesPerHour.toFixed(1)],
            ] as const).map(([k, v]) => (
              <div key={k}>
                <dt className="text-[11px] text-muted-foreground font-medium">{k}</dt>
                <dd className="ibm-mono font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
          {!chartSeries.every((p) => p.switchesPerHour === null) && (
            <div style={{ height: chartH(100) }} className="mt-3">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartSeries}>
                  <XAxis dataKey="label" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 9 }} width={20} />
                  <RechartsTooltip formatter={(v) => [`${v}/h`, 'Switches']} contentStyle={{ fontSize: 12 }} />
                  <Line type={CURVE} dataKey="switchesPerHour" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} connectNulls {...ANIM} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground mt-3">A 30+ minute gap between tracked blocks ends a stretch instead of counting as a switch.</p>
        </Card>

        <Card id="trends-estimates" detail summary={overall ? `×${overall.multiplier!.toFixed(2)} your estimate` : '—'} title="Estimates vs reality" hint="Per task, on a multiplicative scale, so one huge task cannot hide the typical one.">
          {!overall ? (
            <p className="text-sm text-muted-foreground">Needs completed tasks with a real estimate (minutes, or 2+ pomodoros: the default 1 pomodoro does not count) and linked blocks.</p>
          ) : (
            <div className="space-y-2 text-sm">
              <div>
                Tasks take about <strong className="ibm-mono">×{overall.multiplier!.toFixed(2)}</strong> your estimate
                {overall.lo !== null && overall.hi !== null && <span className="text-muted-foreground"> (likely ×{overall.lo.toFixed(2)}–×{overall.hi.toFixed(2)})</span>}
              </div>
              <div className="text-xs text-muted-foreground">
                {overall.n} task{overall.n === 1 ? '' : 's'} · {overall.overPct}% ran over{overall.overLo !== null ? ` (${overall.overLo}–${overall.overHi}%)` : ''} · median task ×{overall.medianRatio!.toFixed(2)}
              </div>
              {overall.n >= 5 && overall.lo !== null && overall.lo > 1 && (
                <div className="text-xs bg-muted rounded-lg px-3 py-2">Try multiplying your next estimates by about ×{overall.multiplier!.toFixed(1)}.</div>
              )}
              {overall.n < 5 && <div className="text-[11px] text-muted-foreground">Tentative: fewer than 5 tasks so far.</div>}
              {estimation.groups.length > 1 && (
                <>
                  <div style={{ height: Math.max(60, estimation.groups.length * 28) }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={estimation.groups.map((g) => ({ label: g.label, multiplier: g.multiplier ?? 0 }))} layout="vertical" margin={{ left: 8 }}>
                        <XAxis type="number" tick={{ fontSize: 9 }} tickFormatter={(v) => `×${v}`} />
                        <YAxis type="category" dataKey="label" tick={{ fontSize: 10 }} width={80} />
                        <RechartsTooltip formatter={(v) => [`×${Number(v).toFixed(2)}`, 'Multiplier']} contentStyle={{ fontSize: 12 }} />
                        <Bar dataKey="multiplier" fill="hsl(var(--primary))" radius={[0, 3, 3, 0]} {...ANIM} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <ul className="pt-1 space-y-1">
                    {estimation.groups.map((g) => (
                      <li key={g.label} className="flex justify-between text-xs"><span>{g.label} <span className="text-muted-foreground">({g.n})</span></span><span className="ibm-mono">×{g.multiplier!.toFixed(2)}</span></li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </Card>
      </div>

      <div className={`grid md:grid-cols-2 gap-4 items-start ${PAIR}`}>
        <Card id="trends-planning" detail summary={planning.n ? `${planning.n} estimated task${planning.n === 1 ? '' : 's'}` : '—'} title="Planning" hint={`${planning.n} task(s) with an estimate. Shown side by side, not scored.`}>
          {planning.n === 0 ? (
            <p className="text-sm text-muted-foreground">Add estimates to tasks to compare estimated, scheduled and actual time.</p>
          ) : (
            <>
              <div style={{ height: chartH(120) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={[['Estimated', planning.estimated], ['Scheduled', planning.scheduled], ['Tracked', planning.tracked], ['Timer', planning.focused]].map(([label, minutes]) => ({ label, minutes }))}>
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 9 }} width={30} tickFormatter={(v) => `${Math.round(v / 60)}h`} />
                    <RechartsTooltip formatter={(v) => [formatMinutes(Number(v)), '']} contentStyle={{ fontSize: 12 }} />
                    <Bar dataKey="minutes" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} {...ANIM} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <dl className="grid grid-cols-2 gap-3 text-sm mt-3">
                {([['Estimated', planning.estimated], ['Scheduled (future)', planning.scheduled], ['Tracked', planning.tracked], ['Timer focus', planning.focused]] as const).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-[11px] text-muted-foreground font-medium">{k}</dt>
                    <dd className="ibm-mono font-semibold">{formatMinutes(v)}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </Card>

        <Card id="trends-deadlines" detail summary={reliability.measured ? `${reliability.pctOnTime}% on time` : '—'} title="Deadline reliability" hint="Completed tasks with a deadline, on time or late.">
          {reliability.measured === 0 ? (
            <p className="text-sm text-muted-foreground">No measurable tasks yet{unmeasured > 0 ? ` (${unmeasured} completed before completion times were recorded)` : ''}.</p>
          ) : (
            <div>
              <div className="text-2xl font-bold ibm-mono">{reliability.pctOnTime}%</div>
              <div className="text-xs text-muted-foreground">
                {reliability.onTime} of {reliability.measured} on time{reliability.lo !== null ? ` · likely ${reliability.lo}–${reliability.hi}%` : ''}
                {reliability.medianLateHours !== null ? ` · late ones were a median ${reliability.medianLateHours.toFixed(1)}h late` : ''}
              </div>
              {reliability.measured < 8 && <div className="text-[11px] text-muted-foreground mt-1">Tentative: fewer than 8 tasks.</div>}
            </div>
          )}
        </Card>
      </div>

      <Card id="trends-goals" detail summary={`${goalRows.length} active`} title="Goal progress" hint="Hours on linked activities since each goal started.">
        {goalRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active goals.</p>
        ) : (
          <>
          {goalRows.length > 1 && (
            <div style={{ height: Math.max(60, goalRows.length * 32) }} className="mb-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={goalRows.map(({ goal, pace }) => ({ label: `${goal.emoji} ${goal.title}`, hours: Math.round(pace.hours * 10) / 10, target: pace.targetHours ?? undefined }))} layout="vertical" margin={{ left: 8 }}>
                  <XAxis type="number" tick={{ fontSize: 9 }} tickFormatter={(v) => `${v}h`} />
                  <YAxis type="category" dataKey="label" tick={{ fontSize: 10 }} width={110} />
                  <RechartsTooltip formatter={(v, n) => [`${v}h`, n]} contentStyle={{ fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="hours" name="So far" fill={METRIC_COLORS.tracked} radius={[0, 3, 3, 0]} {...ANIM} />
                  <Bar dataKey="target" name="Target" fill="hsl(var(--border))" radius={[0, 3, 3, 0]} {...ANIM} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <ul className="space-y-4">
            {goalRows.map(({ goal, pace }) => (
              <li key={goal.id}>
                <div className="flex justify-between text-sm">
                  <span className="font-medium">{goal.emoji} {goal.title}</span>
                  <span className="ibm-mono text-muted-foreground">{pace.hours.toFixed(1)}{pace.targetHours ? ` / ${pace.targetHours}` : ''} h</span>
                </div>
                {pace.targetHours ? (
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden mt-1"><div className="h-full bg-primary" style={{ width: `${Math.min(100, (pace.hours / pace.targetHours) * 100)}%` }} /></div>
                ) : null}
                <div className="text-[11px] text-muted-foreground mt-1 space-y-0.5">
                  <div>
                    Recent pace {pace.currentWeekly.toFixed(1)}h/wk (last 7 days: {pace.lastWeek.toFixed(1)}h)
                    {pace.requiredWeekly !== null ? ` · needs ${pace.requiredWeekly.toFixed(1)}h/wk` : ''}
                    {pace.daysRemaining !== null ? ` · ${pace.daysRemaining >= 0 ? `${pace.daysRemaining}d left` : `${Math.abs(pace.daysRemaining)}d overdue`}` : ''}
                  </div>
                  {pace.weeksToTargetRange && <div>At a slow to good week you would finish in {Math.ceil(pace.weeksToTargetRange[0])}–{Number.isFinite(pace.weeksToTargetRange[1]) ? Math.ceil(pace.weeksToTargetRange[1]) : '∞'} weeks.</div>}
                  {pace.stalledDays !== null && pace.stalledDays >= 7 && <div className="text-amber-600 dark:text-amber-400">No time logged on this goal for {pace.stalledDays} days.</div>}
                </div>
              </li>
            ))}
          </ul>
          </>
        )}
      </Card>

    </div>
  );
};

/** Holds the range; the "Day" option shows a single-day view, every other range the full view above. */
export const TrendsTab: React.FC<TrendsTabProps> = (props) => {
  const [range, setRange] = useState<InsightRange>(DEFAULT_RANGE);
  if (range === '1d') {
    return <TrendsDayView {...props} picker={<RangePicker range={range} onChange={setRange} selectedDate={props.selectedDate} />} />;
  }
  return <TrendsRangeView {...props} range={range} setRange={setRange} />;
};
