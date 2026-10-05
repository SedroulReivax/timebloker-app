import React, { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts';
import { ANIM, CURVE, smoothSeries, chartH } from './ui/chart';
import type { Activity, TaskFocusSession } from '../types';
import type { RangeBlock } from '../lib/blockRange';
import { useBlockRange } from '../hooks/useBlockRange';
import { useActivityAnalyticsRange, useDailyAnalyticsRange } from '../hooks/useAnalyticsRange';
import { compareMetric, dailyValues, summarize } from '../lib/analysis';
import { mapAnalyticsToProfiles } from '../lib/backendAdapter';
import { analyzeWaste } from '../lib/waste';
import { formatMultiplier } from '../lib/activityFlags';
import { formatMinuteOfDay, formatWindow } from '../lib/focusModel';
import { DEFAULT_RANGE, getRangeWindow, type InsightRange } from '../lib/insights';
import { getSleepActivityIds } from '../lib/sleepActivity';
import { mean } from '../lib/stats';
import { formatMinutes } from '../lib/taskTime';
import { axisMinutes, slotAxisLabel, SLOT_COUNT } from '../lib/timeOfDay';
import { ChangeChip } from './ChangeChip';
import { RangePicker, type RangeState } from './RangePicker';
import { WasteDayView } from './DayModeViews';
import { DayStrip, StripAxis } from './ActivityFocusCards';
import { Card } from './TrendsTab';
import { ProductivityPointsCard } from './ProductivityPointsCard';
import { StatTile } from './ui/detail';
import { SetupNudge } from './ui/analysisNav';
import { Takeaways } from './ui/takeaways';
import { wasteTakeaways } from '../lib/takeaways';
import { FULL, PAIR, pageClass } from './ui/page';
import { Donut } from './ui/donut';

interface WasteTabProps {
  activities: Activity[];
  focusSessions: TaskFocusSession[];
  blocks: RangeBlock[];
  selectedDate: Date;
}

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const AXIS_TICKS = [0, 6, 12, 18, 24, 30, 36, 42];
const blockTime = (idx: number) => formatMinuteOfDay(idx * 10);

/** Time waste: time on activities with a negative productivity multiplier. Counts only what was logged. */
const WasteRangeView: React.FC<WasteTabProps & RangeState> = ({ activities, blocks: liveBlocks, selectedDate, range, setRange }) => {
  const win = useMemo(() => getRangeWindow(range, selectedDate), [range, selectedDate]);
  const fetchStart = win.prev?.startKey ?? win.startKey;
  // Raw blocks only for this window's sequence analysis; the previous period is only ever compared through
  // analytics_daily, so its blocks are not fetched.
  const { blocks: all, loading: blocksLoading } = useBlockRange(win.startKey, win.endKey, liveBlocks);
  const { rows: dailyRows, loading: dailyLoading } = useDailyAnalyticsRange(fetchStart, win.endKey);
  const { rows: activityDailyRows, loading: activityLoading } = useActivityAnalyticsRange(win.startKey, win.endKey);
  const loading = blocksLoading || dailyLoading || activityLoading;
  const sleepIds = useMemo(() => getSleepActivityIds(activities), [activities]);
  const weekly = range === '6m' || range === '1y';

  // Top-line waste/day, share and cost come straight from analytics_daily (the canonical deterministic total)
  // instead of a second recomputation from raw blocks. This screen reads no focus-model field, so no supplement.
  const mappedProfiles = useMemo(() => mapAnalyticsToProfiles(dailyRows as any[], null), [dailyRows]);
  const cur = useMemo(() => mappedProfiles.filter((p) => win.dateKeys.includes(p.dateKey)), [mappedProfiles, win.dateKeys]);
  const prev = useMemo(() => (win.prev ? mappedProfiles.filter((p) => win.prev!.dateKeys.includes(p.dateKey)) : null), [mappedProfiles, win.prev]);
  const sum = useMemo(() => summarize(cur), [cur]);
  // Per-activity totals, the daily series and weekday averages use analytics_activity_daily; stretches, triggers,
  // return time and time-of-day placement are sequence-dependent and stay on the bounded raw blocks.
  const w = useMemo(
    () => analyzeWaste({ blocks: all, activities, sleepIds }, win.dateKeys, { weekly, totals: { daily: dailyRows as any[], activityDaily: activityDailyRows as any[] } }),
    [all, activities, sleepIds, win.dateKeys, weekly, dailyRows, activityDailyRows]
  );

  const perDay = mean(dailyValues(cur, 'waste'));
  const wasteDays = cur.filter((p) => p.complete && p.wasteBlocks > 0).length;
  const judgedDays = cur.filter((p) => p.complete && p.awakeBlocks > 0).length;
  const triggerRows = w.triggers.filter((t) => t.ratePct !== null && (t.runs ?? 0) >= 3).sort((a, b) => (b.ratePct ?? 0) - (a.ratePct ?? 0)).slice(0, 8);
  const contextRows = w.triggers.slice(0, 6);
  const topStart = [...w.startHours].sort((a, b) => b.count - a.count)[0];
  const takeaways = useMemo(() => wasteTakeaways({
    perDay,
    change: prev ? compareMetric(cur, prev, 'waste') : null,
    top: w.rows[0] ? { name: w.rows[0].name, minutes: w.rows[0].minutes } : null,
    totalMinutes: w.totalMinutes,
    trigger: triggerRows[0] ? { name: triggerRows[0].name, ratePct: triggerRows[0].ratePct! } : null,
    peakStart: topStart && topStart.count > 0 ? formatMinuteOfDay(topStart.hour * 60) : null,
    medianReturnMinutes: w.medianReturnMinutes,
    noReturnPct: w.noReturnPct,
  }), [perDay, prev, cur, w, triggerRows, topStart]);

  const header = (
    <div className={`flex items-center justify-between gap-3 flex-wrap ${FULL}`}>
      <p className="text-sm text-muted-foreground">{w.days} day{w.days === 1 ? '' : 's'} with counted tracking{loading ? ' · loading…' : ''}</p>
      <RangePicker range={range} onChange={setRange} selectedDate={selectedDate} />
    </div>
  );

  if (!w.hasWasteActivities) {
    return (
      <div className={pageClass('wide', true)}>
        {header}
        <Card title="Time waste">
          <SetupNudge action="Set multipliers">No activity counts as waste yet. Give the ones you'd rather spend less time on a negative multiplier (for example YouTube at -0.5) and this tab shows where that time goes.</SetupNudge>
        </Card>
      </div>
    );
  }

  return (
    <div className={pageClass('wide', true)}>
      {header}

      <Takeaways items={takeaways} loading={loading} className={FULL} />

      <div className={`grid grid-cols-2 md:grid-cols-4 gap-3 ${FULL}`}>
        <StatTile to="waste-over-time" label="Waste / day" value={perDay === null ? '—' : formatMinutes(Math.round(perDay))} sub={<ChangeChip change={prev ? compareMetric(cur, prev, 'waste') : null} fmt={formatMinutes} />} />
        <StatTile to="waste-by-activity" label="Share of your time" value={sum.wasteSharePct === null ? '—' : `${sum.wasteSharePct}%`} sub="of counted time (awake, not ignored)" />
        <StatTile to="waste-triggers" label="Weighted waste" value={`${Math.round(sum.wastePoints)} pts`} sub="minutes × how negative you rated it" />
        <StatTile to="waste-weekday" label="Days with waste" value={judgedDays ? `${wasteDays} / ${judgedDays}` : '—'} sub="finished days" />
      </div>

      <Card id="waste-over-time" className={FULL} title="Waste over time" hint={`${weekly ? 'Average per tracked day, by week' : 'Minutes per day'}, by activity. The dashed line is the average per tracked day. Days with nothing tracked show empty, not as zero waste.`}>
        {w.totalMinutes === 0 ? (
          <p className="text-sm text-muted-foreground">No waste logged in this range.</p>
        ) : (
          <div style={{ height: chartH(180) }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={w.series} margin={{ right: 8, top: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} width={38} tickFormatter={(v) => axisMinutes(Number(v))} />
                <RechartsTooltip formatter={(v, n) => [formatMinutes(Number(v)), w.names[String(n)] ?? n]} contentStyle={{ fontSize: 12 }} />
                {w.rows.map((r) => <Area key={r.id} type={CURVE} dataKey={r.id} stackId="w" stroke={r.color} fill={r.color} fillOpacity={0.55} strokeWidth={1.5} {...ANIM} />)}
                <ReferenceLine y={perDay ?? 0} stroke="hsl(var(--foreground))" strokeDasharray="4 4" strokeOpacity={0.6} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <ProductivityPointsCard id="waste-points-history" className={FULL} rows={dailyRows} win={win} weekly={weekly} loading={dailyLoading} activities={activities} />

      {w.totalMinutes > 0 && (
        <>
          <Card id="waste-when" detail summary={topStart && topStart.count > 0 ? `peaks ${formatMinuteOfDay(topStart.hour * 60)}` : undefined} title="When waste happens, hour by hour" hint={`Share of your ${w.days} tracked days spent on each waste activity, per half hour.`}>
            <div style={{ height: chartH(180) }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={w.rows.reduce<Record<string, unknown>[]>((pts, r) => smoothSeries(pts, r.id), w.bySlot as unknown as Record<string, unknown>[])} margin={{ right: 8, top: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="slot" type="number" domain={[0, SLOT_COUNT - 1]} ticks={AXIS_TICKS} tickFormatter={slotAxisLabel} tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} width={34} tickFormatter={(v) => `${v}%`} allowDecimals={false} />
                  <RechartsTooltip
                    labelFormatter={(s) => `${formatMinuteOfDay(Number(s) * 30)} – ${formatMinuteOfDay(Number(s) * 30 + 30)}`}
                    formatter={(_v, n, p) => [`${p.payload[`${String(n)}Raw`] ?? 0}% of days`, w.names[String(n)] ?? n]}
                    contentStyle={{ fontSize: 12 }}
                  />
                  {w.rows.map((r) => <Area key={r.id} type={CURVE} dataKey={r.id} stackId="1" stroke={r.color} fill={r.color} fillOpacity={0.55} {...ANIM} />)}
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <ul className="space-y-4 mt-4">
              {w.rows.slice(0, 6).map((r) => (
                <li key={r.id}>
                  <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
                    <span className="flex items-center gap-1.5 text-sm font-medium"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: r.color }} />{r.name}</span>
                    <span className="text-[11px] text-muted-foreground ibm-mono">{r.core ? `half between ${formatWindow(r.core)}` : '—'}</span>
                  </div>
                  <DayStrip slots={r.slots} color={r.color} core={r.core} days={w.days} label={`${r.name} waste`} />
                </li>
              ))}
            </ul>
            <StripAxis />
          </Card>

          <div className={`grid md:grid-cols-2 gap-4 items-start ${PAIR}`}>
            <Card id="waste-weekday" detail title="By weekday" hint="Average waste per tracked day of each weekday.">
              <div style={{ height: chartH(170) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={WEEKDAY_ORDER.map((d) => ({ name: DAY_NAMES[d], ...w.byWeekday[d] }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} width={38} tickFormatter={(v) => axisMinutes(Number(v))} />
                    <RechartsTooltip formatter={(v, _n, p) => [p.payload.minutes === null ? 'no tracked days' : `${formatMinutes(Number(v))} · ${p.payload.days} day${p.payload.days === 1 ? '' : 's'}`, 'Average waste']} contentStyle={{ fontSize: 12 }} />
                    <Bar dataKey="minutes" fill="hsl(0 72% 51%)" radius={[3, 3, 0, 0]} {...ANIM} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card id="waste-by-activity" detail summary={w.rows[0] ? `most: ${w.rows[0].name}` : undefined} title="By activity" hint="Total, how often, and how long each stretch lasts.">
              <div className="flex justify-center mb-4">
                <Donut
                  slices={w.rows.map((r) => ({ key: r.id, name: r.name, value: r.minutes, color: r.color }))}
                  fmt={formatMinutes}
                  centre={formatMinutes(w.totalMinutes)}
                  centreSub="wasted"
                  label="Waste by activity"
                />
              </div>
              <div className="overflow-x-auto -mx-1 px-1">
              <table className="w-full text-xs min-w-[420px]">
                <thead className="text-muted-foreground">
                  <tr><th className="text-left font-medium pb-1">Activity</th><th className="text-right font-medium pb-1">Total</th><th className="text-right font-medium pb-1">Days</th><th className="text-right font-medium pb-1">Typical</th><th className="text-right font-medium pb-1">Longest</th></tr>
                </thead>
                <tbody>
                  {w.rows.map((r) => (
                    <tr key={r.id} className="border-t border-border">
                      <td className="py-1.5"><span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: r.color }} />{r.name} <span className="text-muted-foreground ibm-mono">{formatMultiplier(r.multiplier)}</span></td>
                      <td className="text-right ibm-mono">{formatMinutes(r.minutes)}</td>
                      <td className="text-right ibm-mono">{r.days}</td>
                      <td className="text-right ibm-mono">{r.medianStretchMinutes === null ? '—' : formatMinutes(r.medianStretchMinutes)}</td>
                      <td className="text-right ibm-mono">{formatMinutes(r.longestStretchMinutes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </Card>
          </div>

          <Card id="waste-triggers" detail summary={contextRows[0] ? `often after ${contextRows[0].name.toLowerCase()}` : undefined} title="What leads to waste" hint="What you were doing right before each waste stretch started (within 20 minutes), and how often each activity is followed by waste.">
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <div className="text-[11px] text-muted-foreground mb-2 font-medium">Right before a stretch ({w.stretches.length} stretches)</div>
                <ul className="space-y-1.5">
                  {contextRows.map((t) => (
                    <li key={t.id} className="text-xs">
                      <div className="flex justify-between mb-0.5">
                        <span className="font-medium">{t.name}</span>
                        <span className="ibm-mono text-muted-foreground">{t.count} · typical {t.medianStretchMinutes === null ? '—' : formatMinutes(t.medianStretchMinutes)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${(t.count / Math.max(1, w.stretches.length)) * 100}%`, backgroundColor: t.color ?? 'hsl(var(--muted-foreground))' }} />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground mb-2 font-medium">Followed by waste, as a share of that activity's stretches</div>
                {triggerRows.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Not enough repeated activities before waste yet (each needs 3+ stretches).</p>
                ) : (
                  <div style={{ height: Math.max(100, triggerRows.length * 26) }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={triggerRows} layout="vertical" margin={{ left: 8, right: 16 }}>
                        <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 9 }} tickFormatter={(v) => `${v}%`} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={90} />
                        <RechartsTooltip formatter={(v, _n, p) => [`${v}% (likely ${p.payload.lo}–${p.payload.hi}%) · ${p.payload.count} of ${p.payload.runs}`, 'Followed by waste']} contentStyle={{ fontSize: 12 }} />
                        <Bar dataKey="ratePct" radius={[0, 3, 3, 0]} {...ANIM}>
                          {triggerRows.map((t) => <Cell key={t.id} fill={t.color ?? 'hsl(var(--muted-foreground))'} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-5 text-[11px] text-muted-foreground mb-1 font-medium">Stretch start times</div>
            <div style={{ height: chartH(110) }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={w.startHours} margin={{ right: 8, top: 4 }}>
                  <XAxis dataKey="hour" tick={{ fontSize: 9 }} tickFormatter={(h) => (Number(h) % 3 === 0 ? slotAxisLabel(Number(h) * 2) : '')} interval={0} />
                  <YAxis hide allowDecimals={false} />
                  <RechartsTooltip labelFormatter={(h) => `${formatMinuteOfDay(Number(h) * 60)} – ${formatMinuteOfDay(Number(h) * 60 + 60)}`} formatter={(v) => [String(v), 'Stretches started']} contentStyle={{ fontSize: 12 }} />
                  <Area type={CURVE} dataKey="count" stroke="hsl(0 72% 51%)" fill="hsl(0 72% 51%)" fillOpacity={0.25} strokeWidth={2} {...ANIM} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              {topStart && topStart.count > 0 ? `Stretches most often start between ${formatMinuteOfDay(topStart.hour * 60)} and ${formatMinuteOfDay(topStart.hour * 60 + 60)}. ` : ''}
              {w.medianReturnMinutes !== null ? `After a stretch, you are typically back on productive work (multiplier above 0) within ${formatMinutes(w.medianReturnMinutes)}` : 'You have not yet gone back to productive work the same day after a stretch'}
              {w.noReturnPct ? `; ${w.noReturnPct}% of stretches had no productive work after them that day.` : '.'}
            </p>
          </Card>

          <Card id="waste-longest" detail summary={w.longest[0] ? `longest ${formatMinutes(w.longest[0].minutes)}` : undefined} title="Longest stretches">
            <ol className="space-y-1.5 text-xs">
              {w.longest.map((s) => (
                <li key={`${s.dateKey}-${s.startIdx}`} className="flex justify-between gap-3">
                  <span>
                    <span className="font-medium">{format(parseISO(s.dateKey), 'EEE d MMM')}</span>{' '}
                    <span className="text-muted-foreground ibm-mono">{blockTime(s.startIdx)}–{blockTime(s.endIdx + 1)}</span>{' '}
                    · {s.activityIds.map((id) => w.names[id]).join(' + ')}
                    <span className="text-muted-foreground"> · {(w.names[s.ledBy] ?? '—').replace(/^After /, 'after ').replace(/^(?!after )/, 'after ').toLowerCase()}</span>
                  </span>
                  <span className="ibm-mono font-semibold">{formatMinutes(s.minutes)}</span>
                </li>
              ))}
            </ol>
          </Card>
        </>
      )}

      <p className="text-[10px] text-muted-foreground">Waste is time on an activity with a negative multiplier. Untracked time is never counted as waste, and ignored activities (like travel) are never counted. Both are set per activity in Settings → Analysis.</p>
    </div>
  );
};

/** Holds the range; the "Day" option shows a single-day view, every other range the full view above. */
export const WasteTab: React.FC<WasteTabProps> = (props) => {
  const [range, setRange] = useState<InsightRange>(DEFAULT_RANGE);
  if (range === '1d') {
    return <WasteDayView {...props} picker={<RangePicker range={range} onChange={setRange} selectedDate={props.selectedDate} />} />;
  }
  return <WasteRangeView {...props} range={range} setRange={setRange} />;
};
