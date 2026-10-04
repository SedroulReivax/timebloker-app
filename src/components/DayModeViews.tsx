import React, { useId, useMemo } from 'react';
import { format, isToday, parseISO } from 'date-fns';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts';
import { ANIM, CURVE, smoothSeries, chartH } from './ui/chart';
import type { Activity, SleepLog, Task, TaskFocusSession } from '../types';
import type { RangeBlock } from '../lib/blockRange';
import { useBlockRange } from '../hooks/useBlockRange';
import { dayVsTypical, elapsedBlocksFor, profileDays, summarize, type DayMetric, type DayProfile } from '../lib/analysis';
import { findRuns, judgedDays, TIMER_ID } from '../lib/activityFocus';
import { analyzeWaste } from '../lib/waste';
import { buildDayFlows } from '../lib/flow';
import { formatMinuteOfDay } from '../lib/focusModel';
import { getActivityDistribution, getCoverage, getRangeWindow } from '../lib/insights';
import { getSleepActivityIds } from '../lib/sleepActivity';
import { formatMinutes } from '../lib/taskTime';
import { slotAxisLabel, SLOT_COUNT } from '../lib/timeOfDay';
import { TypicalChip } from './ChangeChip';
import { ActivityFocusCards, DayStrip, StripAxis } from './ActivityFocusCards';
import { SleepInsights } from './SleepInsights';
import { Card } from './TrendsTab';
import { FocusCurveCard } from './FocusCurveCard';
import { StatTile } from './ui/detail';
import { SetupNudge } from './ui/analysisNav';
import { formatProductivity } from '../lib/activityFlags';
import { FULL, pageClass } from './ui/page';
import { Donut } from './ui/donut';

/**
 * Single-day views for the Trends, Focus, Waste and Patterns tabs (the "Day" range option). A single day has no
 * trend, so every number is set against your typical day instead: the middle half of your last 28 finished days.
 * For today, those days are cut at the same time of day, so a half-finished day is never judged against whole ones.
 */

interface DayBase {
  activities: Activity[];
  focusSessions: TaskFocusSession[];
  blocks: RangeBlock[];
  selectedDate: Date;
  /** range picker shown in the header (tab mode) */
  picker?: React.ReactNode;
  /** inside the Analysis → Day tab: no header, picker or "pick 7d" note; the parent provides headings */
  embedded?: boolean;
}

const blockTime = (idx: number) => formatMinuteOfDay(idx * 10);
const AXIS_TICKS = [0, 6, 12, 18, 24, 30, 36, 42];

const useDayData = ({ activities, focusSessions, blocks: liveBlocks, selectedDate }: DayBase) => {
  const win = useMemo(() => getRangeWindow('1d', selectedDate), [selectedDate]);
  const dayKey = win.endKey;
  const { blocks, loading } = useBlockRange(win.history!.startKey, dayKey, liveBlocks);
  const sleepIds = useMemo(() => getSleepActivityIds(activities), [activities]);
  const today = isToday(selectedDate);
  const elapsed = elapsedBlocksFor(dayKey, new Date());
  const input = useMemo(() => ({ blocks, activities, sleepIds, sessions: focusSessions }), [blocks, activities, sleepIds, focusSessions]);
  const day = useMemo(() => profileDays(input, [dayKey])[0], [input, dayKey]);
  const history = useMemo(
    () => profileDays(input, win.history!.dateKeys, today ? { cutoffBlocks: elapsed } : {}),
    [input, win.history, today, elapsed]
  );
  const dayBlocks = useMemo(() => blocks.filter((b) => b.date_key === dayKey && b.block_index < elapsed), [blocks, dayKey, elapsed]);
  return { dayKey, blocks, dayBlocks, loading, sleepIds, day, history, today, elapsed, historyKeys: win.history!.dateKeys };
};

const Header: React.FC<{ dayKey: string; loading: boolean; picker: React.ReactNode; today: boolean }> = ({ dayKey, loading, picker, today }) => (
  <div className={`flex items-center justify-between gap-3 flex-wrap ${FULL}`}>
    <p className="text-sm text-muted-foreground">
      {format(parseISO(dayKey), 'EEEE d MMM yyyy')}{today ? ' · so far' : ''} · vs your last 28 days{today ? ' up to this time' : ''}{loading ? ' · loading…' : ''}
    </p>
    {picker}
  </div>
);

interface TileSpec { label: string; metric: DayMetric; fmt: (v: number) => string; /** section the tile opens */ to?: string }

const DayTiles: React.FC<{ specs: TileSpec[]; day: DayProfile; history: DayProfile[]; today: boolean }> = ({ specs, day, history, today }) => (
  <div className={`grid grid-cols-2 md:grid-cols-4 gap-3 ${FULL}`}>
    {specs.map((s) => {
      const r = dayVsTypical(day, history, s.metric);
      return (
        <StatTile
          key={s.label}
          label={s.label}
          to={s.to}
          value={r.value === null ? '—' : s.fmt(r.value)}
          sub={<>
            {r.median !== null && <div>typical {s.fmt(r.median)}</div>}
            <TypicalChip result={r} fmt={s.fmt} qualifier={today ? 'for this time of day' : undefined} />
          </>}
        />
      );
    })}
  </div>
);

const MultiDayNote: React.FC<{ what: string; embedded?: boolean }> = ({ what, embedded }) => (embedded ? null : (
  <p className="text-[11px] text-muted-foreground border border-dashed border-border rounded-lg px-3 py-2">{what} need several days. Pick 7d or longer to see them.</p>
));

/** Tab mode: centred column with the date header and range picker. Embedded: just the content. */
const Frame: React.FC<DayBase & { d: { dayKey: string; loading: boolean; today: boolean }; children: React.ReactNode }> = ({ d, embedded, picker, children }) =>
  embedded ? <div className="space-y-4">{children}</div> : (
    <div className={pageClass('wide', true)}>
      <Header dayKey={d.dayKey} loading={d.loading} picker={picker} today={d.today} />
      {children}
    </div>
  );

const signed = (v: number) => formatProductivity(v);

// ─── Trends: one day ─────────────────────────────────────────────────────────

export const TrendsDayView: React.FC<DayBase> = (props) => {
  const d = useDayData(props);
  const dist = useMemo(() => {
    const coverage = getCoverage(d.dayBlocks, [d.dayKey]);
    return getActivityDistribution(d.dayBlocks, props.activities, coverage);
  }, [d.dayBlocks, d.dayKey, props.activities]);
  const hourly = useMemo(() => {
    const top = dist.filter((r) => r.id !== 'untracked').slice(0, 6).map((r) => r.id);
    const rows = Array.from({ length: 24 }, (_, h) => {
      const row: Record<string, number | string> = { hour: h };
      for (const id of [...top, 'other']) row[id] = 0;
      return row;
    });
    for (const b of d.dayBlocks) {
      if (!b.activity_id) continue;
      const k = top.includes(b.activity_id) ? b.activity_id : 'other';
      (rows[Math.floor(b.block_index / 6)][k] as number) += 10;
    }
    return { rows, keys: [...top, 'other'] };
  }, [dist, d.dayBlocks]);
  const colorOf = (id: string) => dist.find((r) => r.id === id)?.color ?? '#94a3b8';
  const nameOf = (id: string) => (id === 'other' ? 'Other' : dist.find((r) => r.id === id)?.name ?? id);
  const sum = summarize([d.day]);

  return (
    <Frame d={d} {...props}>
      <DayTiles
        day={d.day}
        history={d.history}
        today={d.today}
        specs={[
          { label: 'Tracked', metric: 'tracked', fmt: (v) => formatMinutes(Math.round(v)), to: 'dv-hourly' },
          { label: 'Deep focus', metric: 'deep', fmt: (v) => formatMinutes(Math.round(v)), to: props.embedded ? 'dv-runs' : undefined },
          { label: 'Focus quality', metric: 'quality', fmt: (v) => `${Math.round(v)}%`, to: props.embedded ? 'dv-depth' : undefined },
          { label: 'Logged', metric: 'coverage', fmt: (v) => `${Math.round(v)}%`, to: props.embedded ? 'dv-gaps' : 'dv-where' },
          { label: 'Productivity', metric: 'productivity', fmt: signed, to: props.embedded ? 'day-focus-curve' : undefined },
          { label: 'Waste', metric: 'waste', fmt: (v) => formatMinutes(Math.round(v)), to: props.embedded ? 'dv-waste-stretches' : undefined },
          { label: 'Switches / hour', metric: 'switchesPerHour', fmt: (v) => v.toFixed(1), to: props.embedded ? 'dv-flow' : undefined },
        ]}
      />
      <Card id="dv-hourly" className={FULL} title="Hour by hour" hint="Minutes of each activity in every hour of the day.">
        {d.dayBlocks.length === 0 ? <p className="text-sm text-muted-foreground">Nothing tracked this day.</p> : (
          <div style={{ height: chartH(180) }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={hourly.rows} margin={{ right: 8, top: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="hour" tick={{ fontSize: 9 }} tickFormatter={(h) => (Number(h) % 3 === 0 ? slotAxisLabel(Number(h) * 2) : '')} interval={0} />
                <YAxis tick={{ fontSize: 10 }} width={28} domain={[0, 60]} ticks={[0, 30, 60]} />
                <RechartsTooltip labelFormatter={(h) => `${formatMinuteOfDay(Number(h) * 60)}–${formatMinuteOfDay(Number(h) * 60 + 60)}`} formatter={(v, n) => [formatMinutes(Number(v)), nameOf(String(n))]} contentStyle={{ fontSize: 12 }} />
                {hourly.keys.map((k) => <Area key={k} type={CURVE} dataKey={k} stackId="h" stroke={colorOf(k)} fill={colorOf(k)} fillOpacity={0.55} strokeWidth={1.5} {...ANIM} />)}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
      {!props.embedded && <Card id="dv-where" detail summary={dist[0] ? `most: ${dist[0].name}` : '—'} title="Where the day went" hint={`Share of ${d.today ? 'the day so far' : 'the day'}. Untracked is time with no recorded activity, not idle time.`}>
        <div className="flex flex-col sm:flex-row items-center gap-5">
          <Donut
            slices={dist.map((r) => ({ key: r.id, name: r.name, value: r.minutes, color: r.id === 'untracked' ? 'hsl(var(--muted))' : r.color }))}
            fmt={formatMinutes}
            centre={formatMinutes(dist.filter((r) => r.id !== 'untracked').reduce((a, r) => a + r.minutes, 0))}
            centreSub="tracked"
            label="Where the day went"
          />
          <ul className="space-y-2 flex-1 w-full min-w-0">
            {dist.map((r) => (
              <li key={r.id}>
                <div className="flex justify-between text-xs mb-1"><span className="font-medium">{r.name}</span><span className="ibm-mono text-muted-foreground">{formatMinutes(r.minutes)} · {r.pct}%</span></div>
                <div className="h-2 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.min(100, r.pct)}%`, backgroundColor: r.color }} /></div>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-[11px] text-muted-foreground mt-3">
          {formatMinutes(sum.awakeMinutes)} counted awake time · {sum.ignoredMinutes > 0 ? `${formatMinutes(sum.ignoredMinutes)} ignored · ` : ''}{sum.focusSharePct === null ? 'no focus work' : `${sum.focusSharePct}% of it focus work`}
        </p>
      </Card>}
      <MultiDayNote embedded={props.embedded} what="Trend lines, fragmentation over time, estimates and goal pace" />
    </Frame>
  );
};

// ─── Focus: one day ──────────────────────────────────────────────────────────

export const FocusDayView: React.FC<DayBase> = (props) => {
  const d = useDayData(props);
  const dayKeys = useMemo(() => [d.dayKey], [d.dayKey]);
  const depth = useMemo(() => smoothSeries(Array.from({ length: SLOT_COUNT }, (_, s) => {
    const vals = d.day.scores.slice(s * 3, s * 3 + 3).filter((v): v is number => v !== null);
    return { slot: s, depth: vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) : null };
  }), 'depth'), [d.day]);
  const runs = useMemo(() => {
    const [only] = judgedDays({ blocks: d.blocks, activities: props.activities, sleepIds: d.sleepIds, sessions: props.focusSessions }, [d.dayKey], new Date());
    return findRuns(only.day).filter((r) => r.blocks >= 3);
  }, [d.blocks, props.activities, d.sleepIds, props.focusSessions, d.dayKey]);
  const nameOf = (id: string) => (id === TIMER_ID ? 'Focus timer' : props.activities.find((a) => a.id === id)?.name ?? 'Unknown activity');
  const colorOf = (id: string) => props.activities.find((a) => a.id === id)?.color ?? '#94a3b8';
  // Depth per half hour as one smooth curve, coloured along the day by the activity that filled most of each half
  // hour (a horizontal gradient, so colours blend where the activity changes). A non-focus activity has depth 0, so
  // the band under the axis repeats the colours and every dip still shows what caused it. Untracked and sleep
  // drop to 0 in faint grey instead of breaking the curve.
  const gid = useId().replace(/:/g, '');
  const depthByActivity = useMemo(() => {
    const byIdx = new Map<number, string>();
    for (const b of d.dayBlocks) if (b.activity_id && !d.sleepIds.has(b.activity_id)) byIdx.set(b.block_index, b.activity_id);
    return depth.map((p) => {
      const counts = new Map<string, number>();
      for (let i = p.slot * 3; i < p.slot * 3 + 3; i++) {
        const a = byIdx.get(i);
        if (a) counts.set(a, (counts.get(a) ?? 0) + 1);
      }
      const activityId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      return { ...p, activityId, curve: activityId ? (p.depth ?? 0) : 0, band: -8 };
    });
  }, [depth, d.dayBlocks, d.sleepIds]);
  // one gradient stop per half hour, at its centre; SVG blends linearly between neighbours
  const depthStops = depthByActivity.map((p) => ({
    offset: `${(p.slot / (SLOT_COUNT - 1)) * 100}%`,
    color: p.activityId ? colorOf(p.activityId) : '#94a3b8',
    tracked: !!p.activityId,
  }));
  const depthLegend = useMemo(() => [...new Set(depthByActivity.map((p) => p.activityId).filter((id): id is string => !!id))], [depthByActivity]);

  return (
    <Frame d={d} {...props}>
      <DayTiles
        day={d.day}
        history={d.history}
        today={d.today}
        specs={[
          { label: 'Deep focus', metric: 'deep', fmt: (v) => formatMinutes(Math.round(v)), to: 'dv-runs' },
          { label: 'Focus quality', metric: 'quality', fmt: (v) => `${Math.round(v)}%`, to: 'dv-depth' },
          { label: 'Focus-eligible time', metric: 'eligible', fmt: (v) => formatMinutes(Math.round(v)), to: 'dv-depth' },
          { label: 'Switches / hour', metric: 'switchesPerHour', fmt: (v) => v.toFixed(1), to: 'dv-runs' },
        ]}
      />
      <FocusCurveCard
        className={FULL}
        id={props.embedded ? 'day-focus-curve' : 'focus-curve'}
        activities={props.activities}
        blocks={d.blocks}
        sleepIds={d.sleepIds}
        dateKeys={dayKeys}
        typicalKeys={d.historyKeys}
        typicalCutoff={d.today ? d.elapsed : undefined}
      />
      <Card id="dv-runs" detail summary={runs.length ? `${runs.length} run${runs.length === 1 ? '' : 's'} · longest ${formatMinutes(Math.max(...runs.map((r) => r.blocks)) * 10)}` : 'none'} title="Focus runs this day" hint="Every stretch of 30+ minutes on one activity (one 10-minute blip allowed).">
        {runs.length === 0 ? <p className="text-sm text-muted-foreground">No 30+ minute stretch on one activity this day.</p> : (
          <ol className="space-y-1.5 text-xs">
            {runs.map((r) => (
              <li key={r.startIdx} className="flex justify-between gap-3">
                <span><span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: colorOf(r.activityId) }} /><span className="ibm-mono text-muted-foreground">{blockTime(r.startIdx)}–{blockTime(r.endIdx + 1)}</span> · {nameOf(r.activityId)}</span>
                <span className="ibm-mono font-semibold">{formatMinutes(r.blocks * 10)}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>
      <Card
        id="dv-depth"
        summary={d.day.eligibleBlocks ? `avg ${Math.round((d.day.depthSum / d.day.eligibleBlocks) * 100)}` : '—'}
        title="Focus depth through the day"
        hint="Depth (0-100) through the day, smoothed, coloured by the activity that filled most of each half hour; colours blend where the activity changes. The band under the axis shows the activity even when depth is 0 (non-focus time), so every dip shows what caused it. Faint grey is untracked or sleep."
      >
        {depthLegend.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing tracked this day yet.</p>
        ) : (
          <>
            <div style={{ height: chartH(200) }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={depthByActivity} margin={{ right: 8, top: 4 }}>
                  <defs>
                    {/* every series spans the whole day (no nulls), so each gradient maps 0-100% onto 00:00-24:00 */}
                    {(['fill', 'stroke', 'band'] as const).map((kind) => (
                      <linearGradient key={kind} id={`dv-depth-${kind}-${gid}`} x1="0" y1="0" x2="1" y2="0">
                        {depthStops.map((s, i) => (
                          <stop
                            key={i}
                            offset={s.offset}
                            stopColor={s.color}
                            stopOpacity={kind === 'fill' ? (s.tracked ? 0.45 : 0.06) : kind === 'stroke' ? (s.tracked ? 1 : 0.35) : (s.tracked ? 0.9 : 0)}
                          />
                        ))}
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="slot" type="number" domain={[0, SLOT_COUNT - 1]} ticks={AXIS_TICKS} tickFormatter={slotAxisLabel} tick={{ fontSize: 10 }} />
                  <YAxis domain={[-10, 100]} ticks={[0, 25, 50, 75, 100]} tick={{ fontSize: 10 }} width={28} />
                  <ReferenceLine y={0} stroke="hsl(var(--border))" />
                  <RechartsTooltip
                    labelFormatter={(s) => `${formatMinuteOfDay(Number(s) * 30)}–${formatMinuteOfDay(Number(s) * 30 + 30)}`}
                    formatter={(_v, _n, p) => [p.payload.activityId ? `${p.payload.depthRaw ?? 0} · ${nameOf(p.payload.activityId)}` : 'nothing tracked', 'Depth']}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Area type={CURVE} dataKey="band" stroke="none" fill={`url(#dv-depth-band-${gid})`} tooltipType="none" activeDot={false} {...ANIM} />
                  <Area type={CURVE} dataKey="curve" name="Depth" stroke={`url(#dv-depth-stroke-${gid})`} strokeWidth={2} fill={`url(#dv-depth-fill-${gid})`} {...ANIM} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
              {depthLegend.map((id) => (
                <span key={id} className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: colorOf(id) }} />{nameOf(id)}
                </span>
              ))}
            </div>
          </>
        )}
      </Card>
      {/* the hour-by-hour card is folded into "Focus depth through the day" above for a single day */}
      <ActivityFocusCards activities={props.activities} focusSessions={props.focusSessions} blocks={d.blocks} sleepIds={d.sleepIds} dateKeys={dayKeys} weekly={false} detail hideHourByHour />
      <MultiDayNote embedded={props.embedded} what="The peak focus window, the weekday × hour heatmap and focus quality over time" />
    </Frame>
  );
};

// ─── Waste: one day ──────────────────────────────────────────────────────────

export const WasteDayView: React.FC<DayBase> = (props) => {
  const d = useDayData(props);
  const w = useMemo(() => analyzeWaste({ blocks: d.blocks, activities: props.activities, sleepIds: d.sleepIds }, [d.dayKey]), [d.blocks, props.activities, d.sleepIds, d.dayKey]);
  const sum = summarize([d.day]);

  return (
    <Frame d={d} {...props}>
      {!w.hasWasteActivities ? (
        <Card title="Time waste"><SetupNudge action="Set multipliers">No activity counts as waste yet: give the ones you'd rather spend less time on a negative multiplier.</SetupNudge></Card>
      ) : (
        <>
          <DayTiles
            day={d.day}
            history={d.history}
            today={d.today}
            specs={[
              { label: 'Waste', metric: 'waste', fmt: (v) => formatMinutes(Math.round(v)), to: 'dv-waste-stretches' },
              { label: 'Productivity', metric: 'productivity', fmt: signed, to: props.embedded ? 'day-focus-curve' : undefined },
            ]}
          />
          <p className="text-xs text-muted-foreground">{sum.wasteSharePct === null ? '' : `${sum.wasteSharePct}% of counted time · `}{Math.round(sum.wastePoints)} weighted waste pts</p>
          <Card id="dv-waste-stretches" title="Waste stretches" hint="Each stretch, what came right before it, and how long until you were back on productive work.">
            {w.stretches.length === 0 ? <p className="text-sm text-muted-foreground">No waste logged this day.</p> : (
              <ol className="space-y-1.5 text-xs">
                {w.stretches.map((s) => (
                  <li key={s.startIdx} className="flex justify-between gap-3">
                    <span>
                      <span className="ibm-mono text-muted-foreground">{blockTime(s.startIdx)}–{blockTime(s.endIdx + 1)}</span> · {s.activityIds.map((id) => w.names[id]).join(' + ')}
                      <span className="text-muted-foreground"> · {(w.names[s.ledBy] ?? '—').replace(/^After /, 'after ').replace(/^(?!after )/, 'after ').toLowerCase()} · {s.returnMinutes === null ? 'no productive work after' : `back to work ${s.returnMinutes === 0 ? 'straight away' : `after ${formatMinutes(s.returnMinutes)}`}`}</span>
                    </span>
                    <span className="ibm-mono font-semibold">{formatMinutes(s.minutes)}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
          {w.totalMinutes > 0 && (
            <Card id="dv-waste-when" detail summary={`${w.rows.length} activit${w.rows.length === 1 ? 'y' : 'ies'}`} title="When it happened">
              <ul className="space-y-4">
                {w.rows.map((r) => (
                  <li key={r.id}>
                    <div className="flex items-center gap-1.5 text-sm font-medium mb-1"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: r.color }} />{r.name} <span className="text-muted-foreground text-xs ibm-mono">{formatMinutes(r.minutes)}</span></div>
                    <DayStrip slots={r.slots} color={r.color} core={null} days={1} label={`${r.name} waste`} />
                  </li>
                ))}
              </ul>
              <StripAxis />
            </Card>
          )}
          <MultiDayNote embedded={props.embedded} what="Weekday patterns, trigger rates and waste over time" />
        </>
      )}
    </Frame>
  );
};

// ─── Patterns: one day ───────────────────────────────────────────────────────

export const PatternsDayView: React.FC<DayBase & { tasks?: Task[]; sleepLogs?: SleepLog[] }> = (props) => {
  const d = useDayData(props);
  const flows = useMemo(() => buildDayFlows(d.dayBlocks, d.sleepIds, d.elapsed), [d.dayBlocks, d.sleepIds, d.elapsed]);
  const segments = useMemo(() => {
    const cells: string[] = new Array(144).fill('gap');
    for (let i = 0; i < 144; i++) if (i >= d.elapsed) cells[i] = 'future';
    for (const b of d.dayBlocks) if (b.activity_id && d.sleepIds.has(b.activity_id)) cells[b.block_index] = 'sleep';
    flows.forEach((f, n) => { for (let i = f.start; i <= f.end; i++) cells[i] = `flow:${n}`; });
    const out: { key: string; start: number; end: number }[] = [];
    cells.forEach((key, i) => {
      const last = out[out.length - 1];
      if (last && last.key === key) last.end = i; else out.push({ key, start: i, end: i });
    });
    return out;
  }, [flows, d.dayBlocks, d.sleepIds, d.elapsed]);
  const longest = flows.reduce((m, f) => Math.max(m, f.end - f.start + 1), 0);
  const gapSlots = useMemo(() => {
    const tracked = new Set(d.dayBlocks.filter((b) => b.activity_id).map((b) => b.block_index));
    const slots = new Array(SLOT_COUNT).fill(0);
    for (let i = 0; i < d.elapsed; i++) if (!tracked.has(i)) slots[Math.floor(i / 3)] += 10;
    return slots;
  }, [d.dayBlocks, d.elapsed]);
  const nameOf = (id: string) => props.activities.find((a) => a.id === id)?.name ?? 'Unknown activity';
  const untracked = gapSlots.reduce((a, b) => a + b, 0);

  return (
    <Frame d={d} {...props}>
      <Card id="dv-flow" className={FULL} title="How the day flowed" hint="Each block is one flow: an unbroken stretch of a single activity. Changing activity starts a new flow, and so does 20 minutes or more untracked. Hatched is untracked, grey is sleep, faded is still to come.">
        {flows.length === 0 ? <p className="text-sm text-muted-foreground">Nothing tracked this day.</p> : (
          <>
            <div className="flex h-8 w-full overflow-hidden rounded-md bg-muted/40" role="img" aria-label={`${flows.length} flows, the longest ${formatMinutes(longest * 10)}`}>
              {segments.map((s) => {
                const flow = s.key.startsWith('flow:') ? flows[Number(s.key.slice(5))] : null;
                const label = flow ? nameOf(flow.activityId) : s.key === 'gap' ? 'Untracked' : s.key === 'sleep' ? 'Sleep' : 'Later';
                const style: React.CSSProperties = { width: `${((s.end - s.start + 1) / 144) * 100}%` };
                if (flow) style.backgroundColor = props.activities.find((a) => a.id === flow.activityId)?.color || 'hsl(var(--primary))';
                else if (s.key === 'gap') style.backgroundImage = 'repeating-linear-gradient(45deg, transparent 0 3px, hsl(var(--foreground) / 0.18) 3px 4px)';
                else if (s.key === 'sleep') style.backgroundColor = 'hsl(var(--muted-foreground) / 0.35)';
                return <div key={s.start} title={`${blockTime(s.start)}–${blockTime(s.end + 1)} · ${label}`} className={`h-full border-r border-background/70 last:border-r-0 ${s.key === 'future' ? 'opacity-30' : ''}`} style={style} />;
              })}
            </div>
            <StripAxis />
            <p className="mt-3 text-xs text-muted-foreground">{flows.length} flow{flows.length === 1 ? '' : 's'} · longest {formatMinutes(longest * 10)}</p>
            <ol className="mt-2 space-y-1 text-xs">
              {flows.map((f) => (
                <li key={f.start} className="flex items-center gap-2">
                  <span className="ibm-mono text-muted-foreground w-[7.5rem] shrink-0">{blockTime(f.start)}–{blockTime(f.end + 1)}</span>
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: props.activities.find((a) => a.id === f.activityId)?.color || 'hsl(var(--primary))' }} />
                  <span className="font-medium">{nameOf(f.activityId)}</span>
                  <span className="text-muted-foreground">{formatMinutes((f.end - f.start + 1) * 10)}</span>
                </li>
              ))}
            </ol>
          </>
        )}
      </Card>
      <Card id="dv-gaps" detail summary={`${formatMinutes(untracked)} untracked`} title="Where tracking is missing" hint={`${formatMinutes(untracked)} of ${d.today ? 'the day so far' : 'the day'} has nothing recorded. Darker means more of that half hour is untracked.`}>
        <DayStrip slots={gapSlots} color="hsl(var(--foreground))" core={null} days={1} label="Untracked time" />
        <StripAxis />
      </Card>
      {!props.embedded && <SleepInsights activities={props.activities} sleepLogs={props.sleepLogs ?? []} tasks={props.tasks ?? []} focusSessions={props.focusSessions} liveBlocks={props.blocks} selectedDate={props.selectedDate} />}
      <MultiDayNote embedded={props.embedded} what="The flow map, strongest habits, routines and the weekly blind-spot map" />
    </Frame>
  );
};
