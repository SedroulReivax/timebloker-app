import React, { useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts';
import type { Activity } from '../types';
import {
  attentionBudget, attentionPeriod, compareAttention, formatAttention, formatEfficiency,
  type AttentionActivityRow, type AttentionClass, type AttentionDailyRow,
} from '../lib/attention';
import { formatMinutes } from '../lib/taskTime';
import { ChangeChip } from './ChangeChip';
import { Section } from './ui/detail';
import { SetupNudge } from './ui/analysisNav';
import { Explained } from './ui/explain';
import { ANIM, TICK, chartH } from './ui/chart';

const CLASS_META: Record<AttentionClass, { label: string; color: string; note: string }> = {
  valuable: { label: 'Valuable', color: 'var(--attn-valuable)', note: 'multiplier above 0' },
  neutral: { label: 'Neutral', color: 'var(--attn-neutral)', note: 'multiplier 0' },
  costly: { label: 'Costly', color: 'var(--attn-costly)', note: 'multiplier below 0' },
};
const ORDER: AttentionClass[] = ['valuable', 'neutral', 'costly'];

const pts = formatAttention;
const signedPts = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)} pts`;

interface Props {
  id?: string;
  className?: string;
  activities: Activity[];
  /** analytics_daily rows covering at least `dateKeys` (and `prevDateKeys`, when given) */
  dailyRows: AttentionDailyRow[];
  /** analytics_activity_daily rows covering at least `dateKeys` */
  activityRows: AttentionActivityRow[];
  dateKeys: string[];
  /** the previous period, for "vs before" chips */
  prevDateKeys?: string[];
  loading?: boolean;
}

/**
 * Attention spent next to productivity value: two separate dimensions (focus demand vs multiplier), plus the
 * backend's ratio of the two. All numbers are the canonical analytics_daily / analytics_activity_daily values.
 */
export const AttentionBudgetCard: React.FC<Props> = ({ id = 'attention-budget', className, activities, dailyRows, activityRows, dateKeys, prevDateKeys, loading }) => {
  const b = useMemo(() => attentionBudget(dailyRows, activityRows, dateKeys), [dailyRows, activityRows, dateKeys]);
  const change = useMemo(
    () => (prevDateKeys ? compareAttention(b, attentionPeriod(dailyRows, prevDateKeys)) : null),
    [b, dailyRows, prevDateKeys]
  );
  const nameOf = useMemo(() => {
    const m = new Map(activities.map((a) => [a.id, a.name]));
    return (id: string) => m.get(id) ?? 'Unknown activity';
  }, [activities]);
  const anyDemandSet = activities.some((a) => Number((a as { focus_demand?: number | null }).focus_demand ?? 0) > 0);
  const chartData = b.days.map((d) => ({ ...d, label: format(parseISO(d.dateKey), b.days.length > 14 ? 'd MMM' : 'EEE d') }));

  const hint =
    'Where your attention goes, and what it buys. Attention points = counted minutes × the activity\'s focus demand ÷ 5 (an hour at full demand = 60). ' +
    'Productivity value = counted minutes × the activity\'s multiplier. The two are separate: a draining activity you rate as worthless costs attention without adding value. ' +
    'Efficiency is value per attention point, shown only once at least 6 attention points were spent. ' +
    'The daily split uses each activity\'s own multiplier: it shows what your attention bought, not how productive you were.';

  if (!b.configured) {
    return (
      <Section id={id} className={className} title="Attention vs value" hint={hint}>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          anyDemandSet ? (
            <p className="text-sm text-muted-foreground">
              Focus demand is set, but the analytics for this range have not been recalculated yet. This usually takes a few seconds after a change.
            </p>
          ) : (
            <SetupNudge action="Set focus demand">
              No activity has a focus demand yet, so there is no attention to count (this is not a zero). Give your main activities one from
              0 (effortless) to 5 (all of you): e.g. deep coding 4-5, classes 3, social 2-4, rest 0-1.
            </SetupNudge>
          )
        )}
      </Section>
    );
  }

  const latest = b.latest;
  return (
    <Section
      id={id}
      className={className}
      title="Attention vs value"
      hint={hint}
      summary={`${pts(b.total)} spent · efficiency ${b.efficiency !== null ? formatEfficiency(b.efficiency) : '—'}`}
    >
      {/* the two dimensions side by side, then their ratio */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm mb-4">
        <Explained label="Attention spent">
        <div className="rounded-lg border border-border p-3">
          <div className="text-[11px] text-muted-foreground">Attention spent</div>
          <div className="text-xl font-bold ibm-mono tabular-nums">{pts(b.total)}</div>
          <div className="text-[10px] text-muted-foreground">minutes × focus demand ÷ 5</div>
          {change && <ChangeChip change={change.attention} fmt={pts} />}
        </div>
        </Explained>
        <Explained label="Productivity value">
        <div className="rounded-lg border border-border p-3">
          <div className="text-[11px] text-muted-foreground">Productivity value</div>
          <div className="text-xl font-bold ibm-mono tabular-nums">{signedPts(b.value)}</div>
          <div className="text-[10px] text-muted-foreground">minutes × multiplier, same period</div>
        </div>
        </Explained>
        <Explained label="Attention efficiency">
        <div className="rounded-lg border border-border p-3">
          <div className="text-[11px] text-muted-foreground">Attention efficiency</div>
          <div className="text-xl font-bold ibm-mono tabular-nums">{b.efficiency !== null ? formatEfficiency(b.efficiency) : '—'}</div>
          <div className="text-[10px] text-muted-foreground">
            {b.efficiency === null
              ? 'needs 6+ attention points'
              : `value per attention point${b.typicalEfficiency !== null ? ` · typical day ${formatEfficiency(b.typicalEfficiency)}` : ''}`}
          </div>
          {change && <ChangeChip change={change.efficiency} fmt={formatEfficiency} />}
        </div>
        </Explained>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div>
          <div className="text-[11px] text-muted-foreground">Typical day</div>
          <div className="font-bold ibm-mono tabular-nums">{b.median !== null ? pts(b.median) : '—'}</div>
          <div className="text-[10px] text-muted-foreground">median of {b.days.length} day{b.days.length === 1 ? '' : 's'}</div>
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground">High day</div>
          <div className="font-bold ibm-mono tabular-nums">{b.p90 !== null ? pts(b.p90) : '—'}</div>
          <div className="text-[10px] text-muted-foreground">{b.p90 !== null ? '90th percentile' : 'needs 10+ days'}</div>
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground">{latest ? format(parseISO(latest.dateKey), 'EEE d MMM') : 'Latest day'}</div>
          <div className="font-bold ibm-mono tabular-nums">{latest ? pts(latest.total) : '—'}</div>
          <div className="text-[10px] text-muted-foreground">
            {latest?.vsMedianPct != null ? `${latest.vsMedianPct > 0 ? '+' : ''}${latest.vsMedianPct}% vs your other days` : 'needs 5+ other days to compare'}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground">Spent on costly</div>
          <div className="font-bold ibm-mono tabular-nums">{b.costlySharePct}%</div>
          <div className="text-[10px] text-muted-foreground">{pts(b.split.costly)} of {pts(b.total)}</div>
        </div>
      </div>

      {chartData.length > 1 && (
        <div className="mt-4" style={{ height: chartH(180) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ left: 0, right: 8, top: 4 }} barCategoryGap="20%">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="label" tick={TICK} interval="preserveStartEnd" />
              <YAxis tick={TICK} width={40} />
              <RechartsTooltip
                formatter={(v, n) => [pts(Number(v)), n]}
                labelFormatter={(_, p) => (p?.[0]?.payload ? `${format(parseISO(p[0].payload.dateKey), 'EEE d MMM')} · ${pts(p[0].payload.total)}` : '')}
                contentStyle={{ fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {b.median !== null && <ReferenceLine y={b.median} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />}
              {ORDER.map((cls, i) => (
                <Bar
                  key={cls}
                  dataKey={cls}
                  stackId="a"
                  name={CLASS_META[cls].label}
                  fill={CLASS_META[cls].color}
                  stroke="hsl(var(--card))"
                  strokeWidth={1}
                  radius={i === ORDER.length - 1 ? [4, 4, 0, 0] : undefined}
                  {...ANIM}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="text-[10px] text-muted-foreground mt-1">Dashed line: your typical day. Bars stack valuable, neutral and costly attention.</p>

      {/* table view: where the attention went, labelled in text (never colour alone) */}
      <div className="mt-4">
        <div className="text-xs font-semibold mb-1.5">Biggest attention consumers</div>
        <ul className="space-y-1 text-sm">
          {b.consumers.slice(0, 6).map((c) => (
            <li key={c.activityId} className="flex items-center gap-2 min-w-0">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: CLASS_META[c.cls].color }} aria-hidden />
              <span className="truncate">{nameOf(c.activityId)}</span>
              <span className="text-[10px] text-muted-foreground flex-shrink-0">{CLASS_META[c.cls].label.toLowerCase()}</span>
              <span className="ml-auto ibm-mono tabular-nums text-xs flex-shrink-0">{pts(c.points)} · {c.sharePct}%</span>
              <span className="ibm-mono tabular-nums text-[10px] text-muted-foreground flex-shrink-0 w-14 text-right">{formatMinutes(c.minutes)}</span>
            </li>
          ))}
        </ul>
        {b.consumers.some((c) => c.cls !== 'valuable' && c.sharePct >= 15) && (
          <p className="text-[11px] text-muted-foreground mt-2">
            {(() => {
              const c = b.consumers.find((x) => x.cls !== 'valuable' && x.sharePct >= 15)!;
              return `${nameOf(c.activityId)} took ${c.sharePct}% of your attention while being rated ${c.cls}. That is an observation about where attention went, not a verdict.`;
            })()}
          </p>
        )}
      </div>
    </Section>
  );
};
