import React, { useMemo, useState } from 'react';
import { format, parseISO, startOfWeek } from 'date-fns';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts';
import { ANIM, CURVE, chartH } from './ui/chart';
import type { Activity, TaskFocusSession } from '../types';
import { useBlockRange } from '../hooks/useBlockRange';
import { useDailyAnalyticsRange } from '../hooks/useAnalyticsRange';
import type { RangeBlock } from '../lib/blockRange';
import { mean } from '../lib/stats';
import { bucketDailySeries, dailySeries, dailyValues, focusHeatmap, focusRunHistogram, profileDays, summarize } from '../lib/analysis';
import { analyzeFocus, describePeakContext, focusEligibilitySource, formatMinuteOfDay, formatWindow } from '../lib/focusModel';
import { buildNights, getAverages, getChronotype, relToClock } from '../lib/sleepAnalysis';
import { DEFAULT_RANGE, getRangeWindow, type InsightRange } from '../lib/insights';
import { getSleepActivityIds } from '../lib/sleepActivity';
import { formatMinutes } from '../lib/taskTime';
import { PeakFocusCard } from './PeakFocusCard';
import { RangePicker, type RangeState } from './RangePicker';
import { FocusDayView } from './DayModeViews';
import { ActivityFocusCards } from './ActivityFocusCards';
import { Card } from './TrendsTab';
import { FocusCurveCard } from './FocusCurveCard';
import { ProductivityPointsCard } from './ProductivityPointsCard';
import { StatTile } from './ui/detail';
import { Takeaways } from './ui/takeaways';
import { focusTakeaways } from '../lib/takeaways';
import { FULL, PAIR, pageClass } from './ui/page';

interface FocusTabProps {
  activities: Activity[];
  focusSessions: TaskFocusSession[];
  blocks: RangeBlock[];
  selectedDate: Date;
}

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const FocusRangeView: React.FC<FocusTabProps & RangeState> = ({ activities, focusSessions, blocks: liveBlocks, selectedDate, range, setRange }) => {
  const win = useMemo(() => getRangeWindow(range, selectedDate), [range, selectedDate]);
  // Raw blocks stay here on purpose: windows, runs, the heatmap and depth all need the block sequence. Bounded to
  // the selected range. Plain daily totals (timer minutes) come from analytics_daily instead.
  const { blocks, loading: blocksLoading } = useBlockRange(win.startKey, win.endKey, liveBlocks);
  // Same key as Trends/Waste (previous period + range): one cached fetch serves all three tabs, and the extra
  // previous-period rows let the points history compare periods. Everything else here reads only win.dateKeys.
  const { rows: dailyRows, loading: dailyLoading } = useDailyAnalyticsRange(win.prev?.startKey ?? win.startKey, win.endKey);
  const loading = blocksLoading || dailyLoading;
  const sleepIds = useMemo(() => getSleepActivityIds(activities), [activities]);

  const input = useMemo(() => ({ blocks, activities, sleepIds, sessions: focusSessions }), [blocks, activities, sleepIds, focusSessions]);
  const analysis = useMemo(() => analyzeFocus(input), [input]);
  const peakContext = useMemo(() => {
    const w = analysis.overall.window;
    if (!w) return [];
    const nights = buildNights(blocks.filter((b) => b.activity_id && sleepIds.has(b.activity_id)), win.dateKeys);
    const avg = getAverages(nights);
    const chrono = getChronotype(avg.midpointRel);
    return describePeakContext(w, {
      wakeClockMin: avg.wakeRel === null ? null : relToClock(avg.wakeRel),
      midpointClockMin: avg.midpointRel === null ? null : relToClock(avg.midpointRel),
      chronotypeLabel: chrono?.label ?? null,
    });
  }, [analysis, blocks, sleepIds, win.dateKeys]);
  const profiles = useMemo(() => profileDays(input, win.dateKeys), [input, win.dateKeys]);
  const heat = useMemo(() => focusHeatmap(profiles), [profiles]);
  const hist = useMemo(() => focusRunHistogram(profiles), [profiles]);

  const timerByDate = useMemo(() => Object.fromEntries(dailyRows.map((r) => [r.date_key, Number(r.task_focus_minutes) || 0])) as Record<string, number>, [dailyRows]);
  const longRange = range === '6m' || range === '1y';
  const qualitySeries = useMemo(() => bucketDailySeries(dailySeries(profiles), longRange), [profiles, longRange]);
  const qualityTrend = useMemo(() => {
    const pts = qualitySeries.filter((p) => p.focusQualityPct !== null);
    if (pts.length < 4) return null;
    const mid = Math.ceil(pts.length / 2);
    const avg = (arr: typeof pts) => arr.reduce((s, p) => s + (p.focusQualityPct as number), 0) / arr.length;
    return avg(pts.slice(mid)) - avg(pts.slice(0, mid));
  }, [qualitySeries]);
  const timerChart = useMemo(() => {
    const buckets = new Map<string, number>();
    for (const k of win.dateKeys) {
      const label = longRange ? format(startOfWeek(parseISO(k), { weekStartsOn: 1 }), 'd MMM') : format(parseISO(k), 'd MMM');
      buckets.set(label, (buckets.get(label) || 0) + (timerByDate[k] || 0));
    }
    return Array.from(buckets.entries()).map(([label, minutes]) => ({ label, minutes }));
  }, [win.dateKeys, timerByDate, longRange]);
  const timerTotal = win.dateKeys.reduce((s, k) => s + (timerByDate[k] || 0), 0);

  const topBucket = [...hist.buckets].sort((a, b) => b.minutes - a.minutes)[0];
  const sum = useMemo(() => summarize(profiles), [profiles]);
  const peak = analysis.overall.window;
  // same definition as Trends: the mean of each finished day with any tracking (a partial today or an untracked day never counts)
  const deepPerDay = useMemo(() => mean(dailyValues(profiles, 'deep')), [profiles]);
  const takeaways = useMemo(() => focusTakeaways({
    windowLabel: peak ? formatWindow(peak) : null,
    windowDays: peak?.sampleDays ?? 0,
    windowTentative: peak?.confidence === 'low',
    deepPerDay,
    sustainedSharePct: sum.sustainedSharePct,
    typicalStretch: topBucket && topBucket.minutes > 0 ? topBucket.label.toLowerCase() : null,
    focusQualityPct: sum.focusQualityPct,
  }), [peak, deepPerDay, sum, topBucket]);

  return (
    <div className={pageClass('wide', true)}>
      <div className={`flex items-center justify-between gap-3 flex-wrap ${FULL}`}>
        <p className="text-sm text-muted-foreground">
          {analysis.activeDays} working day{analysis.activeDays === 1 ? '' : 's'} of {analysis.observedDays} tracked{loading ? ' · loading…' : ''}
          <span className="block text-[11px]">
            {focusEligibilitySource(activities) === 'demand'
              ? 'Focus work = your focus demand (0-5) on activities with a positive multiplier.'
              : 'Focus work = Work and Admin categories. Set a focus demand on your activities to choose it yourself.'}
          </span>
        </p>
        <RangePicker range={range} onChange={setRange} selectedDate={selectedDate} exclude={['7d']} />
      </div>

      <Takeaways items={takeaways} loading={loading} className={FULL} />

      <div className={`grid grid-cols-2 md:grid-cols-4 gap-3 ${FULL}`}>
        <StatTile label="Peak window" value={<span className="text-base md:text-lg">{peak ? formatWindow(peak) : '—'}</span>} sub={peak ? 'when deep work is most reliable' : 'needs more working days'} to="focus-peak" />
        <StatTile label="Deep focus / day" value={deepPerDay === null ? '—' : formatMinutes(Math.round(deepPerDay))} sub={`${formatMinutes(sum.deepMinutes)} in total`} to="focus-runs" />
        <StatTile label="Focus quality" value={sum.focusQualityPct === null ? '—' : `${sum.focusQualityPct}%`} sub={qualityTrend === null ? 'depth of focus work' : `${qualityTrend >= 0 ? 'up' : 'down'} ${Math.abs(Math.round(qualityTrend))} pts`} to="focus-quality" />
        <StatTile label="Timer" value={formatMinutes(timerTotal)} sub="focus-timer sessions" to="focus-timer" />
      </div>

      <FocusCurveCard className={FULL} activities={activities} blocks={blocks} sleepIds={sleepIds} dateKeys={win.dateKeys} />

      <ProductivityPointsCard id="focus-points-history" className={FULL} rows={dailyRows} win={win} weekly={longRange} loading={dailyLoading} activities={activities} />

      <Card id="focus-peak" className={FULL} title="Peak focus window" hint="A model, not a record: when you most reliably do sustained deep work, and how sure we are.">
        <PeakFocusCard analysis={analysis} context={peakContext} />
      </Card>

      <ActivityFocusCards activities={activities} focusSessions={focusSessions} blocks={blocks} sleepIds={sleepIds} dateKeys={win.dateKeys} weekly={longRange} detail />

      <Card id="focus-heatmap" detail summary={`typical hour ${heat.baseline}`} title="Focus by weekday and hour" hint={`Deep-focus density. Brighter means deeper and more consistent. Your typical hour is ${heat.baseline}. Blank cells have too little data to say.`}>
        <div className="overflow-x-auto">
          <div className="min-w-[560px]">
            <div className="grid gap-1" style={{ gridTemplateColumns: '36px repeat(24, minmax(0, 1fr))' }}>
              <div />
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="text-[9px] text-muted-foreground text-center ibm-mono">{h % 3 === 0 ? formatMinuteOfDay(h * 60).replace(':00', '').replace(' ', '') : ''}</div>
              ))}
              {DAY_ORDER.map((d) => (
                <React.Fragment key={d}>
                  <div className="text-[10px] text-muted-foreground flex items-center">{DAY_NAMES[d]}</div>
                  {heat.cells[d].map((c, h) => (
                    <div
                      key={h}
                      title={c.value === null ? `${DAY_NAMES[d]} ${formatMinuteOfDay(h * 60)}: not enough data` : `${DAY_NAMES[d]} ${formatMinuteOfDay(h * 60)}–${formatMinuteOfDay(h * 60 + 60)}: depth ${c.value} · ${c.days} day${c.days === 1 ? '' : 's'}`}
                      className={`h-5 rounded-[3px] ${c.value === null ? 'border border-border/50' : ''}`}
                      style={c.value === null ? undefined : { backgroundColor: 'hsl(var(--primary))', opacity: Math.max(0.08, c.value / 100) }}
                    />
                  ))}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">Cells with little data are pulled toward your typical hour, so one lucky session cannot show as a hot spot.</p>
      </Card>

      <Card id="focus-quality" detail summary={sum.focusQualityPct === null ? '—' : `avg ${sum.focusQualityPct}%`} title="Focus quality over time" hint={`${longRange ? 'Weekly average' : 'Daily'} depth of focus-eligible time, 0-100. Blank points had under 30 min of focus work that day.`}>
        {qualitySeries.every((p) => p.focusQualityPct === null) ? (
          <p className="text-sm text-muted-foreground">Not enough focus time in this range yet.</p>
        ) : (
          <>
            <div style={{ height: chartH(160) }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={qualitySeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} width={28} domain={[0, 100]} />
                  <RechartsTooltip formatter={(v) => [`${v} pts`, 'Focus quality']} contentStyle={{ fontSize: 12 }} />
                  <Line type={CURVE} dataKey="focusQualityPct" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} connectNulls {...ANIM} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              {qualityTrend === null
                ? 'Too early to call a trend from this range.'
                : `Quality is ${qualityTrend >= 0 ? 'up' : 'down'} about ${Math.abs(Math.round(qualityTrend))} pts in the second half of this range versus the first.`}
            </p>
          </>
        )}
      </Card>

      <div className={PAIR}>
        <Card id="focus-runs" detail summary={topBucket && hist.totalMinutes ? `mostly ${topBucket.label.toLowerCase()}` : '—'} title="How long are your focus stretches?" hint="Share of your focus time by the length of the uninterrupted stretch it happened in.">
          {hist.totalMinutes === 0 ? (
            <p className="text-sm text-muted-foreground">No focus work in this range.</p>
          ) : (
            <>
              <div style={{ height: chartH(160) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hist.buckets} layout="vertical" margin={{ left: 8 }}>
                    <XAxis type="number" tick={{ fontSize: 9 }} tickFormatter={(v) => `${v}%`} />
                    <YAxis type="category" dataKey="label" tick={{ fontSize: 10 }} width={72} />
                    <RechartsTooltip formatter={(v, _n, p) => [`${formatMinutes(p.payload.minutes)} · ${v}%`, 'Focus time']} contentStyle={{ fontSize: 12 }} />
                    <Bar dataKey="sharePct" fill="hsl(var(--primary))" radius={[0, 3, 3, 0]} {...ANIM} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {topBucket && <p className="text-[11px] text-muted-foreground mt-3">Most of your focus time happens in stretches of {topBucket.label.toLowerCase()}.</p>}
            </>
          )}
        </Card>

        <Card id="focus-timer" detail summary={formatMinutes(timerTotal)} title="Timer sessions" hint={longRange ? 'Focus-timer minutes per week' : 'Focus-timer minutes per day'}>
          {timerTotal === 0 ? (
            <p className="text-sm text-muted-foreground">No timer sessions in this range.</p>
          ) : (
            <>
              <div style={{ height: chartH(160) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={timerChart} margin={{ right: 8, top: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} width={30} />
                    <RechartsTooltip formatter={(v) => [formatMinutes(Number(v)), 'Timer focus']} />
                    <Area type={CURVE} dataKey="minutes" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.25} strokeWidth={2} {...ANIM} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">{formatMinutes(timerTotal)} in total.</p>
            </>
          )}
        </Card>
      </div>
    </div>
  );
};

/** Holds the range; the "Day" option shows a single-day view, every other range the full view above. */
export const FocusTab: React.FC<FocusTabProps> = (props) => {
  const [range, setRange] = useState<InsightRange>(DEFAULT_RANGE);
  if (range === '1d') {
    return <FocusDayView {...props} picker={<RangePicker range={range} onChange={setRange} selectedDate={props.selectedDate} exclude={['7d']} />} />;
  }
  return <FocusRangeView {...props} range={range} setRange={setRange} />;
};
