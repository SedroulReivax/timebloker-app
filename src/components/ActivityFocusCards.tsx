import React, { useMemo } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts';
import { ANIM, CURVE, smoothSeries, chartH } from './ui/chart';
import type { Activity, TaskFocusSession } from '../types';
import type { RangeBlock } from '../lib/blockRange';
import { activityFocus, peakSlotShare } from '../lib/activityFocus';
import { formatMinuteOfDay, formatWindow } from '../lib/focusModel';
import { axisMinutes, slotAxisLabel, SLOT_COUNT } from '../lib/timeOfDay';
import { formatMinutes } from '../lib/taskTime';
import { Card } from './TrendsTab';
import { Donut } from './ui/donut';

interface ActivityFocusCardsProps {
  activities: Activity[];
  focusSessions: TaskFocusSession[];
  blocks: RangeBlock[];
  sleepIds: Set<string>;
  dateKeys: string[];
  weekly: boolean;
  /** start collapsed in simple mode */
  detail?: boolean;
  /** leave out the hour-by-hour chart (the single-day Focus view shows it inside its depth chart instead) */
  hideHourByHour?: boolean;
}

const AXIS_TICKS = [0, 6, 12, 18, 24, 30, 36, 42];
const pctFmt = (v: number) => `${v}%`;

/** A 48-cell strip, one per 30 minutes, with the core window bracketed underneath. Shared with the waste tab. */
export const DayStrip: React.FC<{ slots: number[]; color: string; core: { startMin: number; endMin: number } | null; days: number; label: string }> = ({ slots, color, core, days, label }) => {
  const max = Math.max(...slots, 0);
  return (
    <div className="relative">
      <div className="grid gap-px" style={{ gridTemplateColumns: `repeat(${SLOT_COUNT}, minmax(0, 1fr))` }} role="img" aria-label={`${label} by time of day${core ? `, half of it between ${formatWindow(core)}` : ''}`}>
        {slots.map((m, i) => (
          <div
            key={i}
            title={`${formatMinuteOfDay(i * 30)}–${formatMinuteOfDay(i * 30 + 30)}: ${m === 0 ? 'never' : `${formatMinutes(m)} over ${days} day${days === 1 ? '' : 's'} (~${Math.round((m / (days * 30)) * 100)}% of the time)`}`}
            className={`h-4 rounded-[2px] ${m === 0 ? 'bg-muted/50' : ''}`}
            style={m === 0 ? undefined : { backgroundColor: color, opacity: Math.max(0.15, m / max) }}
          />
        ))}
      </div>
      {core && (
        <div
          className="absolute -bottom-1.5 h-1 border-x-2 border-b-2 border-foreground/70 rounded-b-sm"
          style={{ left: `${(core.startMin / 1440) * 100}%`, width: `${((core.endMin - core.startMin) / 1440) * 100}%` }}
          aria-hidden
        />
      )}
    </div>
  );
};

export const StripAxis: React.FC = () => (
  <div className="flex justify-between text-[9px] text-muted-foreground ibm-mono mt-2">
    <span>12a</span><span>3a</span><span>6a</span><span>9a</span><span>12p</span><span>3p</span><span>6p</span><span>9p</span><span>12a</span>
  </div>
);

/**
 * "When have I actually focused, and on what?" Descriptive only: counts of logged 30+ minute runs, no model.
 */
export const ActivityFocusCards: React.FC<ActivityFocusCardsProps> = ({ activities, focusSessions, blocks, sleepIds, dateKeys, weekly, detail, hideHourByHour }) => {
  const r = useMemo(
    () => activityFocus({ blocks, activities, sleepIds, sessions: focusSessions }, dateKeys, { weekly }),
    [blocks, activities, sleepIds, focusSessions, dateKeys, weekly]
  );

  if (r.rows.length === 0) {
    return (
      <Card detail={detail} title="What you actually focused on" hint="Your logged 30+ minute unbroken runs, by activity and time of day.">
        <p className="text-sm text-muted-foreground">
          {r.days === 0 ? 'Nothing tracked in this range yet.' : `No stretch of 30+ minutes on one activity in ${r.days} tracked day${r.days === 1 ? '' : 's'} yet.`}
        </p>
      </Card>
    );
  }

  const top = r.rows[0];
  const bySlot = r.chartIds.reduce<Record<string, unknown>[]>((pts, id) => smoothSeries(pts, id), r.bySlot as unknown as Record<string, unknown>[]);
  const peak = peakSlotShare(top, r.days);
  const barRows = r.rows.slice(0, 10).map((row) => ({ ...row, hours: Math.round((row.focusedMinutes / 60) * 10) / 10 }));

  return (
    <>
      {!hideHourByHour && <Card
        detail={detail}
        summary={`most on ${top.name}`}
        title="What you actually focused on, hour by hour"
        hint={`Share of your ${r.days} tracked day${r.days === 1 ? '' : 's'} spent inside a 30+ min unbroken run of each activity, per half hour. Counts only what happened.`}
      >
        <div style={{ height: chartH(200) }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={bySlot} margin={{ left: 0, right: 8, top: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="slot" type="number" domain={[0, SLOT_COUNT - 1]} ticks={AXIS_TICKS} tickFormatter={slotAxisLabel} tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} width={34} tickFormatter={pctFmt} allowDecimals={false} />
              <RechartsTooltip
                labelFormatter={(s) => `${formatMinuteOfDay(Number(s) * 30)} – ${formatMinuteOfDay(Number(s) * 30 + 30)}`}
                formatter={(_v, name, p) => { const raw = Number(p.payload[`${String(name)}Raw`] ?? 0); return [`${raw}% of days · ~${Math.round((raw / 100) * 30)} min`, r.names[String(name)] ?? name]; }}
                contentStyle={{ fontSize: 12 }}
              />
              {r.chartIds.map((id) => (
                <Area key={id} type={CURVE} dataKey={id} stackId="1" stroke={r.colors[id]} fill={r.colors[id]} fillOpacity={0.55} strokeWidth={1} {...ANIM} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
          {r.chartIds.map((id) => (
            <span key={id} className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: r.colors[id] }} />{r.names[id]}
            </span>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          Most focused time went to <strong className="text-foreground">{top.name}</strong> ({formatMinutes(top.focusedMinutes)})
          {top.core ? `, half of it between ${formatWindow(top.core)}` : ''}
          {peak ? `. At ${formatMinuteOfDay(peak.startMin)} you were deep in it about ${peak.pct}% of the time` : ''}.
        </p>
      </Card>}

      <Card detail={detail} summary={top.core ? `${top.name} ${formatWindow(top.core)}` : undefined} title="24-hour focus window by activity" hint="Each strip is one activity across the day; darker means more of its focused time fell there. The bracket marks the shortest window holding half of it.">
        <ul className="space-y-4">
          {r.rows.slice(0, 8).map((row) => (
            <li key={row.id}>
              <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
                <span className="flex items-center gap-1.5 text-sm font-medium min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: row.color }} />
                  <span className="truncate">{row.name}</span>
                </span>
                <span className="text-[11px] text-muted-foreground ibm-mono">
                  {row.core ? formatWindow(row.core) : '—'} · {formatMinutes(Math.round(row.perDayMinutes))}/day · {row.focusedDays} of {r.days} days · {row.focusRatePct}% focused
                </span>
              </div>
              <DayStrip slots={row.slots} color={row.color} core={row.core} days={r.days} label={`${row.name} focus`} />
            </li>
          ))}
        </ul>
        <StripAxis />
        {r.rows.length > 8 && <p className="text-[10px] text-muted-foreground mt-2">{r.rows.length - 8} more activit{r.rows.length - 8 === 1 ? 'y' : 'ies'} with less focused time not shown.</p>}
      </Card>

      <Card detail={detail} summary={`${r.rows.length} activit${r.rows.length === 1 ? 'y' : 'ies'}`} title="Focused time by activity" hint="Hours inside 30+ min unbroken runs. 'Focused' is the share of all your time on that activity that was in such a run.">
        <div className="flex flex-col sm:flex-row items-center gap-4">
        <Donut
          slices={r.rows.map((row) => ({ key: row.id, name: row.name, value: row.focusedMinutes, color: row.color }))}
          fmt={formatMinutes}
          centre={formatMinutes(r.rows.reduce((a, row) => a + row.focusedMinutes, 0))}
          centreSub="focused"
          label="Focused time by activity"
        />
        <div className="flex-1 w-full min-w-0" style={{ height: Math.max(120, barRows.length * 28) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={barRows} layout="vertical" margin={{ left: 8, right: 16 }}>
              <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}h`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={96} />
              <RechartsTooltip
                formatter={(_v, _n, p) => [`${formatMinutes(p.payload.focusedMinutes)} · ${p.payload.focusRatePct}% of its time · median run ${p.payload.medianRunMinutes === null ? '—' : formatMinutes(p.payload.medianRunMinutes)} · longest ${formatMinutes(p.payload.longestRunMinutes)}`, 'Focused']}
                contentStyle={{ fontSize: 12 }}
              />
              <Bar dataKey="hours" radius={[0, 3, 3, 0]} {...ANIM}>
                {barRows.map((row) => <Cell key={row.id} fill={row.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        </div>
        <div className="mt-4 text-[11px] text-muted-foreground font-medium">{weekly ? 'Per day, averaged by week' : 'Per day'}</div>
        <div style={{ height: chartH(150) }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={r.series} margin={{ right: 8, top: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10 }} width={34} tickFormatter={(v) => axisMinutes(Number(v))} />
              <RechartsTooltip formatter={(v, name) => [formatMinutes(Number(v)), r.names[String(name)] ?? name]} contentStyle={{ fontSize: 12 }} />
              {r.chartIds.map((id) => <Area key={id} type={CURVE} dataKey={id} stackId="f" stroke={r.colors[id]} fill={r.colors[id]} fillOpacity={0.55} strokeWidth={1.5} {...ANIM} />)}
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">Counts only what you logged. A run needs 30+ minutes of one activity; one 10-minute blip inside it is allowed. Sleep and ignored activities never count.</p>
      </Card>
    </>
  );
};
