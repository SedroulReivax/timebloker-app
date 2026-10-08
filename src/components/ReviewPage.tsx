import React, { useEffect, useMemo, useState } from 'react';
import { addMonths, addWeeks, format, parseISO, subDays } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis,
} from 'recharts';
import { ANIM, CURVE, chartH } from './ui/chart';
import { Section, StatTile } from './ui/detail';
import { formatPoints, formatProductivity } from '../lib/activityFlags';
import { Takeaways } from './ui/takeaways';
import { Explained } from './ui/explain';
import { reviewTakeaways } from '../lib/takeaways';
import type { Activity, Goal, Habit, HabitLog, Review, Task, TaskFocusSession } from '../types';
import { useBlockRange } from '../hooks/useBlockRange';
import { useDailyAnalyticsRange, useActivityAnalyticsRange, useHabitAnalyticsRange, useGoalAnalyticsRange } from '../hooks/useAnalyticsRange';
import type { RangeBlock } from '../lib/blockRange';
import { comparePeriods, energyForPeriod, getReviewWindows, reviewPeriodKey, summarizePeriod, type DailyFactsLike, type PeriodInput, type ReviewPeriod } from '../lib/reviews';
import { compareAttention, formatAttention, formatEfficiency } from '../lib/attention';
import { getSleepActivityIds } from '../lib/sleepActivity';
import { dailySeries, focusSupplementByDate } from '../lib/analysis';
import { mapAnalyticsToProfiles } from '../lib/backendAdapter';
import { groupGoalDailyRows } from '../lib/goals';
import { analyzeFocus, formatWindow } from '../lib/focusModel';
import { formatMinutes } from '../lib/taskTime';
import type { ChangeResult } from '../lib/stats';
import { ChangeChip } from './ChangeChip';
import { ProductivityPointsCard } from './ProductivityPointsCard';
import type { ReflectionFields } from './DayView';
import { FULL, PAIR, pageClass } from './ui/page';
import { ENERGY_LABELS, ENERGY_MAX } from '../lib/energy';

const CATEGORY_COLORS: Record<string, string> = {
  Work: 'hsl(217 91% 60%)', Health: 'hsl(142 71% 45%)', Admin: 'hsl(45 93% 47%)', Leisure: 'hsl(283 39% 53%)',
  Other: 'hsl(0 0% 50%)', Sleep: 'hsl(230 40% 40%)', Uncategorized: 'hsl(0 0% 60%)', Untracked: 'hsl(var(--muted))',
};
const METRIC_COLORS = { tracked: 'hsl(217 91% 60%)', deep: 'hsl(160 84% 39%)' };

interface ReviewPageProps {
  activities: Activity[];
  tasks: Task[];
  focusSessions: TaskFocusSession[];
  habits: (Habit & { created_at?: string | null; frequency?: string | null; weekdays?: number[] | null; target_count?: number | null })[];
  habitLogs: HabitLog[];
  goals: Goal[];
  liveBlocks: RangeBlock[];
  selectedDate: Date;
  /** All saved reflections; the one for the shown period is picked here. */
  reviews?: Review[];
  onSaveReview?: (period: ReviewPeriod, periodKey: string, fields: ReflectionFields) => void;
}

const PROMPTS: { key: keyof ReflectionFields; label: string }[] = [
  { key: 'planned', label: 'What was the plan?' },
  { key: 'happened', label: 'What actually happened?' },
  { key: 'changed', label: 'What changed?' },
  { key: 'carry_over', label: 'What carries over to the next period?' },
];

const Row: React.FC<{ label: string; value: string; sub?: string; change?: ChangeResult; fmt?: (v: number) => string }> = ({ label, value, sub, change, fmt }) => (
  <Explained label={label}>
  <div className="flex items-baseline justify-between gap-3 py-2 border-b border-border last:border-0 text-sm">
    <span className="text-muted-foreground">{label}</span>
    <span className="text-right">
      <strong className="ibm-mono">{value}</strong>
      {sub && <span className="text-[11px] text-muted-foreground ml-2">{sub}</span>}
      {change && fmt && <span className="block"><ChangeChip change={change} fmt={fmt} /></span>}
    </span>
  </div>
  </Explained>
);

export const ReviewPage: React.FC<ReviewPageProps> = ({
  activities, tasks, focusSessions, habits, goals, liveBlocks, selectedDate, reviews = [], onSaveReview,
}) => {
  const [period, setPeriod] = useState<ReviewPeriod>('week');
  const [offset, setOffset] = useState(0);
  const anchor = useMemo(() => (period === 'week' ? addWeeks(selectedDate, offset) : addMonths(selectedDate, offset)), [period, offset, selectedDate]);
  const { current, previous } = useMemo(() => getReviewWindows(period, anchor), [period, anchor]);
  const periodKey = reviewPeriodKey(period, anchor);

  // one day earlier than the window: the night that ends on its first morning starts the evening before, and without those
  // blocks that night would count only its after-midnight part
  const blockStart = useMemo(() => format(subDays(parseISO(previous.startKey), 1), 'yyyy-MM-dd'), [previous.startKey]);
  const { blocks, loading: blocksLoading } = useBlockRange(blockStart, current.endKey, liveBlocks);
  const sleepIds = useMemo(() => getSleepActivityIds(activities), [activities]);

  const { rows: dailyRows, loading: dailyLoading } = useDailyAnalyticsRange(previous.startKey, current.endKey);
  const { rows: activityDailyRows, loading: activityLoading } = useActivityAnalyticsRange(previous.startKey, current.endKey);
  const { rows: habitDailyRows, loading: habitLoading } = useHabitAnalyticsRange(previous.startKey, current.endKey);
  const goalStart = useMemo(
    () => goals.map((g) => (g.created_at ? format(new Date(g.created_at), 'yyyy-MM-dd') : null)).filter((k): k is string => !!k).sort()[0] ?? previous.startKey,
    [goals, previous.startKey]
  );
  const goalTo = goalStart > current.endKey ? goalStart : current.endKey;
  const { rows: goalDailyRows, loading: goalLoading } = useGoalAnalyticsRange(goalStart, goalTo);
  const loading = blocksLoading || dailyLoading || activityLoading || habitLoading || goalLoading;

  // Deterministic inputs come from the backend; the focus-model fields analytics_daily
  // deliberately excludes are enriched from the same bounded raw-block fetch this screen
  // already needs for sleep-nights and the "Best focus window" model below.
  const focusSupplement = useMemo(
    () => focusSupplementByDate({ blocks, activities, sleepIds, sessions: focusSessions }, [...current.dateKeys, ...previous.dateKeys]),
    [blocks, activities, sleepIds, focusSessions, current, previous]
  );
  const profiles = useMemo(() => mapAnalyticsToProfiles(dailyRows as any[], focusSupplement, { dateKeys: [...current.dateKeys, ...previous.dateKeys] }), [dailyRows, focusSupplement, current, previous]);
  const pointsWin = useMemo(() => ({ dateKeys: current.dateKeys, prev: previous }), [current, previous]);
  const goalDailyByGoal = useMemo(() => groupGoalDailyRows(goalDailyRows as any[]), [goalDailyRows]);
  const sleepBlocks = useMemo(() => blocks.filter((b) => b.activity_id && sleepIds.has(b.activity_id)), [blocks, sleepIds]);

  const input: PeriodInput = useMemo(() => ({
    profiles,
    daily: dailyRows as DailyFactsLike[],
    activityDaily: activityDailyRows as any[],
    habitDaily: habitDailyRows as any[],
    goalDailyByGoal,
    sleepBlocks,
    activities, sleepIds,
    tasks,
    habits: habits as never[],
    goals: goals.map((g) => ({ id: g.id, title: g.title, linked_activity_ids: g.linked_activity_ids })),
  }), [profiles, dailyRows, activityDailyRows, habitDailyRows, goalDailyByGoal, sleepBlocks, activities, sleepIds, tasks, habits, goals]);

  const cur = useMemo(() => summarizePeriod(input, current), [input, current]);
  const prev = useMemo(() => summarizePeriod(input, previous), [input, previous]);
  const cmp = useMemo(() => comparePeriods(cur, prev), [cur, prev]);
  const attentionCmp = useMemo(() => compareAttention(cur.attention, prev.attention), [cur, prev]);
  const focusAnalysis = useMemo(
    () => analyzeFocus({ blocks: blocks.filter((b) => b.date_key >= current.startKey && b.date_key <= current.endKey), activities, sleepIds, sessions: focusSessions }),
    [blocks, current, activities, sleepIds, focusSessions]
  );
  const focusWindow = focusAnalysis.overall.window;
  const energy = useMemo(() => energyForPeriod(reviews, current), [reviews, current]);
  const energyPrev = useMemo(() => energyForPeriod(reviews, previous), [reviews, previous]);

  // Reflection form
  const review = reviews.find((r) => r.period_type === period && r.period_key === periodKey) ?? null;
  const [fields, setFields] = useState<ReflectionFields>({ planned: review?.planned ?? '', happened: review?.happened ?? '', changed: review?.changed ?? '', carry_over: review?.carry_over ?? '' });
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    setFields({ planned: review?.planned ?? '', happened: review?.happened ?? '', changed: review?.changed ?? '', carry_over: review?.carry_over ?? '' });
    setDirty(false);
  }, [periodKey, period, review]);

  const label = `${format(parseISO(current.startKey), 'd MMM')} – ${format(parseISO(current.endKey), 'd MMM yyyy')}`;
  const prevLabel = period === 'week' ? 'previous week' : 'previous month';
  const topCats = cur.distribution.filter((d) => d.category !== 'Untracked').slice(0, 4);
  const s = cur.summary;
  const daysCount = s.days;

  const dailyChart = useMemo(
    () => dailySeries(cur.profiles).map((p) => ({ ...p, label: format(parseISO(p.dateKey), period === 'week' ? 'EEE' : 'd MMM') })),
    [cur.profiles, period]
  );
  const takeaways = useMemo(() => {
    const perDay = (v: number) => `${formatMinutes(v)}/day`;
    const peak = dailyChart.reduce<(typeof dailyChart)[number] | null>((a, b) => (b.trackedMinutes > (a?.trackedMinutes ?? 0) ? b : a), null);
    return reviewTakeaways({
      period,
      trackedMinutes: s.assignedMinutes,
      deepMinutes: s.deepMinutes,
      days: s.days,
      changes: [
        { label: 'Tracked time', change: cmp.tracked, fmt: perDay },
        { label: 'Deep focus', change: cmp.deep, fmt: perDay },
        { label: 'Productivity', change: cmp.productivity, fmt: (v) => formatProductivity(v).replace('+', '') },
        { label: 'Waste', change: cmp.waste, fmt: perDay },
        { label: 'Sleep', change: cmp.sleep, fmt: (v) => `${formatMinutes(v)}/night` },
      ],
      busiest: peak ? { label: format(parseISO(peak.dateKey), 'EEEE d MMM'), minutes: peak.trackedMinutes } : null,
      energyMean: energy.mean,
      energyMax: ENERGY_MAX,
    });
  }, [period, s, cmp, dailyChart, energy]);

  const comparisonChart = useMemo(() => ([
    { label: 'Tracked/day', cur: s.days ? Math.round(s.assignedMinutes / s.days) : 0, prev: prev.summary.days ? Math.round(prev.summary.assignedMinutes / prev.summary.days) : 0 },
    { label: 'Deep/day', cur: s.days ? Math.round(s.deepMinutes / s.days) : 0, prev: prev.summary.days ? Math.round(prev.summary.deepMinutes / prev.summary.days) : 0 },
    { label: 'Timer/day', cur: daysCount ? Math.round(cur.focusedMinutes / daysCount) : 0, prev: prev.summary.days ? Math.round(prev.focusedMinutes / prev.summary.days) : 0 },
  ]), [s, prev, cur.focusedMinutes, daysCount]);

  return (
    <div className={pageClass('wide', true)}>
      <div className={`flex items-center justify-between gap-3 flex-wrap ${FULL}`}>
        <div className="flex gap-1.5" role="tablist" aria-label="Review period">
          {(['week', 'month'] as ReviewPeriod[]).map((p) => (
            <button
              key={p}
              role="tab"
              aria-selected={period === p}
              onClick={() => { setPeriod(p); setOffset(0); }}
              className={`px-3 py-1.5 text-xs font-medium rounded-full border ${period === p ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground border-border hover:bg-accent'}`}
            >
              {p === 'week' ? 'Weekly' : 'Monthly'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setOffset((o) => o - 1)} className="p-1.5 rounded hover:bg-accent" aria-label="Previous period"><ChevronLeft size={16} /></button>
          <span className="text-sm font-semibold">{label}{loading ? ' · loading…' : ''}</span>
          <button onClick={() => setOffset((o) => o + 1)} disabled={offset >= 0} className="p-1.5 rounded hover:bg-accent disabled:opacity-40" aria-label="Next period"><ChevronRight size={16} /></button>
        </div>
      </div>

      <Takeaways items={takeaways} loading={loading} className={FULL} />

      {/* Headline: tap a number for the detail behind it */}
      <div className={`grid grid-cols-2 md:grid-cols-4 gap-3 ${FULL}`}>
        <StatTile to="review-days" label="Tracked" value={formatMinutes(s.assignedMinutes)} sub={<ChangeChip change={cmp.tracked} fmt={formatMinutes} />} />
        <StatTile to="review-days" label="Deep focus" value={formatMinutes(s.deepMinutes)} sub={<ChangeChip change={cmp.deep} fmt={formatMinutes} />} />
        <StatTile
          to="review-numbers"
          label="Productivity"
          value={s.productivityScore === null ? '—' : formatProductivity(s.productivityScore)}
          sub={<ChangeChip change={cmp.productivity} fmt={(v) => formatProductivity(v)} />}
        />
        <StatTile to="review-goals" label="Goal hours" value={`${cur.goalHours.reduce((a, g) => a + g.hours, 0).toFixed(1)}h`} sub={<ChangeChip change={cmp.goalHours} fmt={(v) => `${v.toFixed(1)}h`} />} />
      </div>

      <Section id="review-days" className={FULL} title={`Day by day this ${period}`}>
        {dailyChart.every((p) => p.trackedMinutes === 0) ? (
          <p className="text-sm text-muted-foreground">Nothing tracked yet this {period}.</p>
        ) : (
          <div style={{ height: chartH(160) }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyChart} margin={{ left: 0, right: 8, top: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={period === 'week' ? 0 : 'preserveStartEnd'} />
                <YAxis tick={{ fontSize: 10 }} width={40} tickFormatter={(v) => `${Math.round(v / 60)}h`} />
                <RechartsTooltip formatter={(v, n) => [formatMinutes(Number(v)), n]} contentStyle={{ fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area type={CURVE} dataKey="trackedMinutes" name="Tracked" stroke={METRIC_COLORS.tracked} fill={METRIC_COLORS.tracked} fillOpacity={0.15} strokeWidth={2} {...ANIM} />
                <Area type={CURVE} dataKey="deepMinutes" name="Deep focus" stroke={METRIC_COLORS.deep} fill={METRIC_COLORS.deep} fillOpacity={0.3} strokeWidth={2} {...ANIM} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground mt-2">
          {(() => {
            const tracked = dailyChart.map((p) => p.trackedMinutes);
            if (!tracked.some((v) => v > 0)) return null;
            const peak = dailyChart.reduce((a, b) => (b.trackedMinutes > a.trackedMinutes ? b : a));
            return `Busiest day: ${peak.label} at ${formatMinutes(peak.trackedMinutes)} tracked.`;
          })()}
        </p>
      </Section>

      <ProductivityPointsCard
        id="review-points-history"
        className={FULL}
        rows={dailyRows}
        win={pointsWin}
        weekly={false}
        loading={dailyLoading}
        activities={activities}
      />

      <Section
        id="review-energy"
        detail
        defaultOpen={energy.n > 0}
        title="Energy"
        summary={energy.mean !== null ? `avg ${energy.mean.toFixed(1)}/${ENERGY_MAX} · ${energy.n} of ${energy.days.length} days rated` : 'no days rated'}
      >
        {energy.n === 0 ? (
          <p className="text-sm text-muted-foreground">No energy ratings this {period}. Rate a day in Analysis → Day → Reflection.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {energy.days.map((d) => (
                <div key={d.dateKey} className="flex flex-col items-center gap-0.5 w-9" title={d.energy ? `${d.energy}/${ENERGY_MAX} · ${ENERGY_LABELS[d.energy]}` : 'not rated'}>
                  <span
                    className={`w-8 h-8 rounded-full border flex items-center justify-center text-xs font-semibold ibm-mono tabular-nums ${d.energy ? 'border-primary/50 text-foreground' : 'border-dashed border-border text-muted-foreground'}`}
                    style={d.energy ? { background: `hsl(var(--primary) / ${(0.08 + (d.energy / ENERGY_MAX) * 0.5).toFixed(2)})` } : undefined}
                  >
                    {d.energy ?? '·'}
                  </span>
                  <span className="text-[9px] text-muted-foreground">{format(parseISO(d.dateKey), period === 'week' ? 'EEE' : 'd')}</span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              Average {energy.mean!.toFixed(1)}/{ENERGY_MAX} over {energy.n} rated day{energy.n === 1 ? '' : 's'}
              {energyPrev.mean !== null ? ` (${prevLabel}: ${energyPrev.mean.toFixed(1)} over ${energyPrev.n}).` : '.'}
              {' '}Links to sleep, focus and waste need at least 14 rated days before they mean anything.
            </p>
          </>
        )}
      </Section>

      <Section id="review-numbers" detail title={`This ${period} vs ${prevLabel}`} summary={`${daysCount} day${daysCount === 1 ? '' : 's'} · all numbers`}>
        <Row label="Tracked time" value={formatMinutes(s.assignedMinutes)} sub={`${daysCount} day${daysCount === 1 ? '' : 's'} with tracking`} change={cmp.tracked} fmt={formatMinutes} />
        <Row label="Deep focus (30+ min runs)" value={formatMinutes(s.deepMinutes)} sub={s.sustainedSharePct !== null ? `${s.sustainedSharePct}% of focus time is sustained` : undefined} change={cmp.deep} fmt={formatMinutes} />
        <Row label="Focus quality" value={s.focusQualityPct === null ? '—' : `${s.focusQualityPct}%`} sub={s.focusSharePct !== null ? `${s.focusSharePct}% of tracked time is focus work` : undefined} change={cmp.quality} fmt={(v) => `${Math.round(v)} pts`} />
        <Row label="Productivity" value={s.productivityScore === null ? '—' : formatProductivity(s.productivityScore)} sub={s.productivityScore === null ? undefined : `${formatPoints(s.productivityPoints)} in total`} change={cmp.productivity} fmt={(v) => formatProductivity(v)} />
        {cur.attention.configured ? (
          <>
            <Row
              label="Attention spent"
              value={formatAttention(cur.attention.total)}
              sub={`for ${cur.attention.value > 0 ? '+' : ''}${formatAttention(cur.attention.value)} of value`}
              change={attentionCmp.attention}
              fmt={formatAttention}
            />
            <Row
              label="Attention efficiency"
              value={cur.attention.efficiency === null ? '—' : formatEfficiency(cur.attention.efficiency)}
              sub={cur.attention.efficiency === null ? 'needs 6+ attention points' : 'value per attention point'}
              change={attentionCmp.efficiency}
              fmt={formatEfficiency}
            />
          </>
        ) : (
          <Row label="Attention spent" value="—" sub="no focus demand set on any activity yet" />
        )}
        <Row label="Time waste" value={formatMinutes(s.wasteMinutes)} sub={s.wasteSharePct !== null && s.wasteMinutes > 0 ? `${s.wasteSharePct}% of counted time` : undefined} change={cmp.waste} fmt={formatMinutes} />
        <Row label="Timer focus" value={formatMinutes(cur.focusedMinutes)} change={cmp.timerFocus} fmt={formatMinutes} />
        <Row label="Tasks completed" value={String(cur.tasksDone)} change={cmp.tasksDone} fmt={(v) => v.toFixed(1)} />
        <Row label="Average sleep" value={cur.sleepAvgMinutes === null ? '—' : formatMinutes(cur.sleepAvgMinutes)} sub={`${cur.sleepNights} night${cur.sleepNights === 1 ? '' : 's'}`} change={cmp.sleep} fmt={formatMinutes} />
        <Row label="Habit consistency" value={cur.habitConsistencyPct === null ? '—' : `${cur.habitConsistencyPct}%`} sub={cur.habitLo !== null ? `likely ${cur.habitLo}–${cur.habitHi}%` : undefined} />
        <Row label="Goal hours" value={`${cur.goalHours.reduce((a, g) => a + g.hours, 0).toFixed(1)}h`} change={cmp.goalHours} fmt={(v) => `${v.toFixed(1)}h`} />
        <p className="text-[11px] text-muted-foreground mt-2">
          {s.coveragePct === null ? '—' : `${s.coveragePct}%`} of elapsed time has something logged · {cur.tasksOverdue} open task{cur.tasksOverdue === 1 ? '' : 's'} were past deadline by the end of the period.
          Comparisons use finished days only and say “no clear change” unless the difference stands out from normal day-to-day variation.
        </p>
      </Section>


      <div className={PAIR}>
        <Section id="review-where" detail title="Where time went" summary={topCats[0] ? `most: ${topCats[0].category}` : undefined}>
          {topCats.length === 0 ? <p className="text-sm text-muted-foreground">Nothing tracked.</p> : (
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 flex-shrink-0" role="img" aria-label="Where time went by category">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={topCats} dataKey="minutes" nameKey="category" innerRadius="55%" outerRadius="90%" paddingAngle={topCats.length > 1 ? 2 : 0} stroke="none" {...ANIM}>
                      {topCats.map((d) => <Cell key={d.category} fill={CATEGORY_COLORS[d.category] || CATEGORY_COLORS.Other} />)}
                    </Pie>
                    <RechartsTooltip formatter={(v, n) => [formatMinutes(Number(v)), n]} contentStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="space-y-1 text-sm flex-1 min-w-0">
                {topCats.map((d) => (
                  <li key={d.category} className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: CATEGORY_COLORS[d.category] || CATEGORY_COLORS.Other }} />
                    <span className="flex-1 truncate">{d.category}</span>
                    <span className="ibm-mono text-muted-foreground text-xs">{formatMinutes(d.minutes)} · {d.pct}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>

        <Section id="review-goals" detail title="Goals and focus" summary={focusWindow ? `best ${formatWindow(focusWindow)}` : `${cur.goalHours.length} goals`}>
          {cur.goalHours.length === 0 ? <p className="text-sm text-muted-foreground">No goal time this {period}.</p> : (
            <>
              {cur.goalHours.length > 1 && (
                <div style={{ height: Math.max(50, cur.goalHours.length * 28) }} className="mb-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={cur.goalHours.map((g) => ({ label: g.title, hours: Math.round(g.hours * 10) / 10 }))} layout="vertical" margin={{ left: 8 }}>
                      <XAxis type="number" tick={{ fontSize: 9 }} tickFormatter={(v) => `${v}h`} />
                      <YAxis type="category" dataKey="label" tick={{ fontSize: 10 }} width={80} />
                      <RechartsTooltip formatter={(v) => [`${v}h`, 'Hours']} contentStyle={{ fontSize: 12 }} />
                      <Bar dataKey="hours" fill={METRIC_COLORS.tracked} radius={[0, 3, 3, 0]} {...ANIM} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              <ul className="space-y-1 text-sm mb-2">
                {cur.goalHours.map((g) => <li key={g.goalId} className="flex justify-between"><span className="truncate">{g.title}</span><span className="ibm-mono text-muted-foreground">{g.hours.toFixed(1)}h</span></li>)}
              </ul>
            </>
          )}
          <p className="text-xs text-muted-foreground">
            {focusWindow
              ? `Best focus window: ${formatWindow(focusWindow)} (${focusWindow.sampleDays} day${focusWindow.sampleDays === 1 ? '' : 's'} of data${focusWindow.confidence === 'low' ? ', tentative' : ''}).`
              : 'No focus window yet.'}
          </p>
        </Section>
      </div>

      <Section id="review-compare" detail title={`This ${period} vs ${prevLabel}, per day`} summary="side by side">
        <p className="text-[11px] text-muted-foreground mb-2">Same rows as above, side by side. This is the shape behind the change chips.</p>
        <div style={{ height: chartH(140) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={comparisonChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} width={40} tickFormatter={(v) => `${Math.round(v / 60)}h`} />
              <RechartsTooltip formatter={(v, n) => [formatMinutes(Number(v)), n]} contentStyle={{ fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="prev" name={prevLabel === 'previous week' ? 'Last week' : 'Last month'} fill="hsl(var(--border))" radius={[3, 3, 0, 0]} {...ANIM} />
              <Bar dataKey="cur" name="This period" fill={METRIC_COLORS.tracked} radius={[3, 3, 0, 0]} {...ANIM} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Section>

      {onSaveReview && (
        <Section
          key={`${period}-${periodKey}`}
          id="review-reflection"
          detail
          defaultOpen={PROMPTS.some((p) => !!review?.[p.key])}
          title="Reflection"
          summary={PROMPTS.some((p) => !!review?.[p.key]) ? 'saved' : 'not written yet'}
        >
          <div className="space-y-3">
            {PROMPTS.map((p) => (
              <label key={p.key} className="block">
                <span className="text-xs font-semibold">{p.label}</span>
                <textarea
                  value={fields[p.key]}
                  onChange={(e) => { setFields((f) => ({ ...f, [p.key]: e.target.value })); setDirty(true); }}
                  className="mt-1 w-full text-sm px-3 py-2 rounded-md bg-background text-foreground border border-border focus:outline-none focus:ring-1 focus:ring-ring min-h-[56px] resize-y"
                />
              </label>
            ))}
          </div>
          <div className="flex justify-end mt-3">
            <button onClick={() => { onSaveReview(period, periodKey, fields); setDirty(false); }} disabled={!dirty} className="px-3 py-1.5 text-xs font-semibold rounded-md bg-primary text-primary-foreground disabled:opacity-50">
              Save reflection
            </button>
          </div>
        </Section>
      )}
    </div>
  );
};
