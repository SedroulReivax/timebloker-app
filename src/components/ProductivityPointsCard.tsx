import React, { memo, useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts';
import { ANIM, CURVE, TICK, chartH } from './ui/chart';
import { Section } from './ui/detail';
import { SetupNudge } from './ui/analysisNav';
import { ChangeChip } from './ChangeChip';
import { formatPoints, hasProductivityMultipliers } from '../lib/activityFlags';
import { explainSection } from '../lib/explain';
import { productivityPointsHistory, type PointsDailyRow } from '../lib/productivityHistory';
import { useDailyAnalyticsRange } from '../hooks/useAnalyticsRange';
import type { RangeWindow } from '../lib/insights';
import type { Activity } from '../types';

const GAIN = 'hsl(142 71% 45%)';
const LOSS = 'hsl(0 72% 51%)';
const EXPLAIN = explainSection('productivity-points-history');

type View = 'daily' | 'total';

interface ProductivityPointsCardProps {
  /** unique per page: the Section id (each tab passes its own prefix) */
  id: string;
  /** analytics_daily rows the screen already fetched; may also cover the previous period */
  rows: readonly PointsDailyRow[];
  win: Pick<RangeWindow, 'dateKeys' | 'prev'>;
  /** 6m / 1y: one bar per week */
  weekly: boolean;
  loading: boolean;
  activities: Pick<Activity, 'productivity_multiplier' | 'analysis_ignored'>[];
  className?: string;
}

const fmtSigned = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v))}`;

/**
 * Productivity points history for the range a tab has selected. Pure presentation over analytics_daily rows the
 * tab already holds (no extra query); only one series is drawn at a time, so even a 90-day range is a light chart.
 */
export const ProductivityPointsCard: React.FC<ProductivityPointsCardProps> = memo(({ id, rows, win, weekly, loading, activities, className }) => {
  const [view, setView] = useState<View>('daily');
  const hasMultipliers = useMemo(() => hasProductivityMultipliers(activities), [activities]);
  // future days (a week or month still in progress, or a future selected date) are left off rather than drawn as 0
  const todayKey = format(new Date(), 'yyyy-MM-dd');
  const h = useMemo(
    () => productivityPointsHistory(rows, win.dateKeys.filter((k) => k <= todayKey), { weekly, prevDateKeys: win.prev?.dateKeys ?? null }),
    [rows, win.dateKeys, win.prev, weekly, todayKey],
  );

  const toggle = (
    <div className="flex gap-1" role="tablist" aria-label="Points view">
      {(['daily', 'total'] as const).map((v) => (
        <button
          key={v}
          role="tab"
          aria-selected={view === v}
          onClick={() => setView(v)}
          className={`px-2.5 py-1 text-[11px] font-medium rounded-full border transition-colors ${view === v ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground border-border hover:bg-accent'}`}
        >
          {v === 'daily' ? (weekly ? 'Per week' : 'Per day') : 'Running total'}
        </button>
      ))}
    </div>
  );

  const tooltipLabel = (_: unknown, payload: readonly { payload?: { dateKey: string; trackedDays: number } }[] | undefined) => {
    const p = payload?.[0]?.payload;
    if (!p) return '';
    const day = format(parseISO(p.dateKey), weekly ? "'Week of' d MMM yyyy" : 'EEE d MMM yyyy');
    return weekly ? `${day} · ${p.trackedDays} tracked day${p.trackedDays === 1 ? '' : 's'}` : p.trackedDays ? day : `${day} · nothing counted`;
  };

  let body: React.ReactNode;
  if (!hasMultipliers) {
    body = <SetupNudge action="Set multipliers">No activity has a productivity multiplier yet, so every day scores 0 points.</SetupNudge>;
  } else if (loading && rows.length === 0) {
    body = <div className="rounded-md bg-muted/40 animate-pulse" style={{ height: chartH(180) }} aria-label="Loading points" />;
  } else if (h.trackedDays === 0) {
    body = <p className="text-sm text-muted-foreground">No counted time in this range yet.</p>;
  } else {
    body = (
      <>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-3">
          <div>
            <dt className="text-[11px] text-muted-foreground">Total</dt>
            <dd className="font-semibold ibm-mono tabular-nums">{formatPoints(h.total)}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted-foreground">Per tracked day</dt>
            <dd className="font-semibold ibm-mono tabular-nums">{h.perTrackedDay === null ? '—' : formatPoints(h.perTrackedDay)}</dd>
            {h.change && <dd><ChangeChip change={h.change} fmt={(v) => formatPoints(v).replace('+', '')} /></dd>}
          </div>
          <div>
            <dt className="text-[11px] text-muted-foreground">Best day</dt>
            <dd className="font-semibold ibm-mono tabular-nums">{h.best ? formatPoints(h.best.points) : '—'}</dd>
            {h.best && <dd className="text-[10px] text-muted-foreground">{format(parseISO(h.best.dateKey), 'EEE d MMM')}</dd>}
          </div>
          <div>
            <dt className="text-[11px] text-muted-foreground">Worst day</dt>
            <dd className="font-semibold ibm-mono tabular-nums">{h.worst ? formatPoints(h.worst.points) : '—'}</dd>
            {h.worst && <dd className="text-[10px] text-muted-foreground">{format(parseISO(h.worst.dateKey), 'EEE d MMM')}</dd>}
          </div>
        </dl>
        <div style={{ height: chartH(180) }}>
          <ResponsiveContainer width="100%" height="100%">
            {view === 'daily' ? (
              <BarChart data={h.bars} barCategoryGap={h.bars.length > 45 ? 1 : '15%'}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" tick={TICK} interval="preserveStartEnd" minTickGap={16} />
                <YAxis tick={TICK} width={40} tickFormatter={fmtSigned} />
                <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeOpacity={0.5} />
                <RechartsTooltip
                  cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }}
                  labelFormatter={tooltipLabel as never}
                  formatter={(v) => [formatPoints(Number(v)), weekly ? 'Points that week' : 'Points']}
                  contentStyle={{ fontSize: 12 }}
                />
                <Bar dataKey="points" radius={[2, 2, 0, 0]} {...ANIM}>
                  {h.bars.map((b) => <Cell key={b.dateKey} fill={b.points < 0 ? LOSS : GAIN} />)}
                </Bar>
              </BarChart>
            ) : (
              <AreaChart data={h.bars}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" tick={TICK} interval="preserveStartEnd" minTickGap={16} />
                <YAxis tick={TICK} width={48} tickFormatter={fmtSigned} />
                <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeOpacity={0.5} />
                <RechartsTooltip
                  labelFormatter={tooltipLabel as never}
                  formatter={(v) => [formatPoints(Number(v)), 'Running total']}
                  contentStyle={{ fontSize: 12 }}
                />
                <Area type={CURVE} dataKey="cumulative" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.12} strokeWidth={2} dot={false} {...ANIM} />
              </AreaChart>
            )}
          </ResponsiveContainer>
        </div>
      </>
    );
  }

  return (
    <Section
      id={id}
      className={className}
      title="Productivity points history"
      hint={`Points earned ${weekly ? 'each week' : 'each day'} (minutes × the activity's multiplier), and the running total across the range.`}
      summary={hasMultipliers && h.trackedDays > 0 ? formatPoints(h.total) : undefined}
      actions={hasMultipliers && h.trackedDays > 0 ? toggle : undefined}
      explain={EXPLAIN}
    >
      {body}
    </Section>
  );
});
ProductivityPointsCard.displayName = 'ProductivityPointsCard';

/**
 * For tabs that don't otherwise read analytics_daily. Fetches the same key Trends and Waste use (previous period +
 * range), so moving between those tabs on one range is a cache hit, not a second request.
 */
export const ProductivityPointsSelfFetch: React.FC<Omit<ProductivityPointsCardProps, 'rows' | 'loading'> & { win: RangeWindow }> = (props) => {
  const { win } = props;
  const { rows, loading } = useDailyAnalyticsRange(win.prev?.startKey ?? win.startKey, win.endKey);
  return <ProductivityPointsCard {...props} rows={rows} loading={loading} />;
};
