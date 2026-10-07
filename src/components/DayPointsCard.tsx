import React, { memo, useId, useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts';
import type { Activity } from '../types';
import type { RangeBlock } from '../lib/blockRange';
import { dayPoints, typicalCumulativePoints, type PointsSlot } from '../lib/dayPoints';
import { formatMinuteOfDay } from '../lib/focusModel';
import { formatMinutes } from '../lib/taskTime';
import { formatMultiplier, formatPoints, hasProductivityMultipliers } from '../lib/activityFlags';
import { slotAxisLabel } from '../lib/timeOfDay';
import { ANIM, CURVE, TICK, chartH } from './ui/chart';
import { Section } from './ui/detail';
import { SetupNudge } from './ui/analysisNav';

interface DayPointsCardProps {
  activities: Activity[];
  blocks: RangeBlock[];
  sleepIds: Set<string>;
  dateKey: string;
  /** past days for the dashed "typical running total" line */
  typicalKeys?: string[];
  /** today: cut the typical days at the same time */
  typicalCutoff?: number;
  id: string;
  className?: string;
}

const GAIN = 'hsl(142 71% 45%)';
const LOSS = 'hsl(0 72% 51%)';
const tone = (v: number) => (v > 0 ? 'text-green-600 dark:text-green-400' : v < 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground');
const span = (slot: number) => `${formatMinuteOfDay(slot * 30)}–${formatMinuteOfDay(slot * 30 + 30)}`;
const fmtAxis = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v))}`;

interface Row { slot: number; points: number; cumulative: number | null; typical: number | null; s: PointsSlot }

/**
 * Analysis → Day: where this day's productivity points came from, half hour by half hour. Bars are each half
 * hour's net points (minutes × the activity's multiplier); the line is the running total through the day, against
 * your typical running total. The tooltip and the lists below name the activities behind every gain and loss.
 */
export const DayPointsCard: React.FC<DayPointsCardProps> = memo(({ activities, blocks, sleepIds, dateKey, typicalKeys, typicalCutoff, id, className }) => {
  const syncId = `dp-${useId().replace(/:/g, '')}`; // the two charts share one hover position
  const d = useMemo(() => dayPoints({ blocks, activities, sleepIds }, dateKey), [blocks, activities, sleepIds, dateKey]);
  const typical = useMemo(
    () => (typicalKeys?.length ? typicalCumulativePoints({ blocks, activities, sleepIds }, typicalKeys, { cutoffBlocks: typicalCutoff }) : null),
    [blocks, activities, sleepIds, typicalKeys, typicalCutoff],
  );
  const byId = useMemo(() => new Map(activities.map((a) => [a.id, a])), [activities]);
  const nameOf = (aid: string) => byId.get(aid)?.name ?? 'Unknown activity';
  const colorOf = (aid: string) => byId.get(aid)?.color ?? '#94a3b8';

  const data: Row[] = useMemo(
    () => d.slots.map((s) => ({ slot: s.slot, points: s.points, cumulative: s.cumulative, typical: typical?.[s.slot] ?? null, s })),
    [d.slots, typical],
  );
  // the typical running total at the last half hour this day has (for today: now)
  const lastSlot = d.slots.reduce((acc, s) => (s.cumulative !== null ? s.slot : acc), -1);
  const typicalNow = lastSlot >= 0 && typical ? typical[lastSlot] : null;
  const maxAbs = Math.max(1, ...d.byActivity.map((a) => Math.abs(a.points)));
  const counted = d.slots.filter((s) => s.minutes > 0);

  const hasMultipliers = hasProductivityMultipliers(activities);
  const hasData = d.countedMinutes > 0;

  const TooltipBody = ({ active, payload }: { active?: boolean; payload?: readonly { payload?: Row }[] }) => {
    const row = active ? payload?.[0]?.payload : undefined;
    if (!row) return null;
    return (
      <div className="rounded-md border border-border bg-popover text-popover-foreground shadow-md px-3 py-2 text-xs space-y-1 w-[260px] max-w-[70vw] -translate-y-full -mt-2">
        <div className="font-medium">{span(row.slot)}</div>
        {row.s.minutes === 0 ? <div className="text-muted-foreground">nothing counted</div> : (
          <>
            <div><strong className={tone(row.points)}>{formatPoints(row.points)}</strong> <span className="text-muted-foreground">this half hour · {row.s.minutes} min</span></div>
            <ul className="space-y-0.5">
              {row.s.activities.map((a) => (
                <li key={a.id} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: colorOf(a.id) }} />
                  <span className="truncate flex-1">{nameOf(a.id)}</span>
                  <span className="text-muted-foreground ibm-mono">{a.minutes}m</span>
                  <span className={`ibm-mono ${tone(a.points)}`}>{formatPoints(a.points)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {row.cumulative !== null && (
          <div className="pt-1 border-t border-border">
            Running total <strong>{formatPoints(row.cumulative)}</strong>
            {row.typical !== null && <span className="text-muted-foreground"> · typical {formatPoints(row.typical)}</span>}
          </div>
        )}
      </div>
    );
  };

  let body: React.ReactNode;
  if (!hasMultipliers) {
    body = <SetupNudge action="Set multipliers">No activity has a productivity multiplier yet, so every half hour scores 0 points.</SetupNudge>;
  } else if (!hasData) {
    body = <p className="text-sm text-muted-foreground">Nothing counted this day yet.</p>;
  } else {
    body = (
      <>
        <dl className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm mb-3">
          <div>
            <dt className="text-[11px] text-muted-foreground">Total</dt>
            <dd className={`font-semibold ibm-mono tabular-nums ${tone(d.total)}`}>{formatPoints(d.total)}</dd>
            {typicalNow !== null && <dd className="text-[10px] text-muted-foreground">typical {formatPoints(typicalNow)}{typicalCutoff !== undefined ? ' by now' : ''}</dd>}
          </div>
          <div>
            <dt className="text-[11px] text-muted-foreground">Earned</dt>
            <dd className="font-semibold ibm-mono tabular-nums text-green-600 dark:text-green-400">{formatPoints(d.gained)}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted-foreground">Lost</dt>
            <dd className="font-semibold ibm-mono tabular-nums text-red-600 dark:text-red-400">{d.lost < 0 ? formatPoints(d.lost) : '0 pts'}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted-foreground">Best half hour</dt>
            <dd className="font-semibold ibm-mono tabular-nums">{d.best ? formatPoints(d.best.points) : '—'}</dd>
            {d.best && <dd className="text-[10px] text-muted-foreground">{span(d.best.slot)}</dd>}
          </div>
          <div>
            <dt className="text-[11px] text-muted-foreground">Worst half hour</dt>
            <dd className="font-semibold ibm-mono tabular-nums">{d.worst ? formatPoints(d.worst.points) : '—'}</dd>
            {d.worst && <dd className="text-[10px] text-muted-foreground">{span(d.worst.slot)}</dd>}
          </div>
        </dl>

        <p className="text-[11px] font-medium text-muted-foreground mb-1">Points in each half hour</p>
        <div style={{ height: chartH(150) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} syncId={syncId} margin={{ right: 8, top: 6, left: 0 }} barCategoryGap={1}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="slot" tick={TICK} interval={5} tickFormatter={(s) => slotAxisLabel(Number(s))} />
              <YAxis tick={TICK} width={40} tickFormatter={fmtAxis} />
              <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeOpacity={0.5} />
              <RechartsTooltip cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }} content={TooltipBody as never} position={{ y: 0 }} allowEscapeViewBox={{ x: false, y: true }} wrapperStyle={{ zIndex: 30, pointerEvents: 'none' }} />
              <Bar dataKey="points" radius={[2, 2, 0, 0]} {...ANIM}>
                {data.map((r) => <Cell key={r.slot} fill={r.points < 0 ? LOSS : GAIN} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <p className="text-[11px] font-medium text-muted-foreground mt-3 mb-1">Running total through the day{typical && <span className="font-normal"> · dashed: your typical</span>}</p>
        <div style={{ height: chartH(150) }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} syncId={syncId} margin={{ right: 8, top: 6, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="slot" tick={TICK} interval={5} tickFormatter={(s) => slotAxisLabel(Number(s))} />
              <YAxis tick={TICK} width={40} tickFormatter={fmtAxis} />
              <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeOpacity={0.5} />
              {/* hover line and dot only: the details popup shows once, above the top chart */}
              <RechartsTooltip content={() => null} />
              {typical && <Line type={CURVE} dataKey="typical" stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} strokeDasharray="3 3" strokeOpacity={0.7} dot={false} connectNulls={false} {...ANIM} />}
              <Line type={CURVE} dataKey="cumulative" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} activeDot={{ r: 3 }} connectNulls={false} {...ANIM} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <h3 className="text-xs font-semibold mt-4 mb-2">Where the points came from</h3>
        <ul className="space-y-2">
          {d.byActivity.map((a) => (
            <li key={a.id}>
              <div className="flex items-center gap-2 text-xs mb-1">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: colorOf(a.id) }} />
                <span className="font-medium truncate flex-1 min-w-0">{nameOf(a.id)}</span>
                <span className="ibm-mono text-muted-foreground whitespace-nowrap">{formatMinutes(a.minutes)} × {formatMultiplier(a.multiplier)}</span>
                <span className={`ibm-mono font-semibold w-16 text-right whitespace-nowrap ${tone(a.points)}`}>{formatPoints(a.points)}</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${(Math.abs(a.points) / maxAbs) * 100}%`, backgroundColor: a.points < 0 ? LOSS : GAIN }} />
              </div>
            </li>
          ))}
        </ul>

        <details className="mt-4 group">
          <summary className="text-xs font-semibold cursor-pointer select-none">Every half hour ({counted.length})</summary>
          <ol className="mt-2 divide-y divide-border text-xs">
            {counted.map((s) => (
              <li key={s.slot} className="py-1.5 flex items-start gap-3">
                <span className="ibm-mono text-muted-foreground w-24 flex-shrink-0">{span(s.slot)}</span>
                <span className="flex-1 min-w-0 text-muted-foreground">
                  {s.activities.map((a, i) => (
                    <React.Fragment key={a.id}>{i > 0 && ', '}<span className="text-foreground">{nameOf(a.id)}</span> {a.minutes}m</React.Fragment>
                  ))}
                </span>
                <span className={`ibm-mono font-semibold w-14 text-right flex-shrink-0 ${tone(s.points)}`}>{formatPoints(s.points)}</span>
                <span className="ibm-mono text-muted-foreground w-16 text-right flex-shrink-0" title="Running total">{s.cumulative === null ? '' : formatPoints(s.cumulative)}</span>
              </li>
            ))}
          </ol>
        </details>
      </>
    );
  }

  return (
    <Section
      id={id}
      className={className}
      title="Points through the day"
      summary={hasMultipliers && hasData ? formatPoints(d.total) : undefined}
      hint="Productivity points earned or lost in every half hour (minutes × the activity's multiplier), the running total through the day, and the activities behind them. Sleep and ignored time are left out."
    >
      {body}
    </Section>
  );
});
DayPointsCard.displayName = 'DayPointsCard';
