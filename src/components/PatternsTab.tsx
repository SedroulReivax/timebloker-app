import React, { useMemo, useState } from 'react';
import type { Activity, SleepLog, Task, TaskFocusSession } from '../types';
import type { RangeBlock } from '../lib/blockRange';
import { useBlockRange } from '../hooks/useBlockRange';
import { useRoutineAnalyticsRange, useTransitionAnalyticsRange } from '../hooks/useAnalyticsRange';
import { buildFlowResult, FLOW_OTHER, ROUTINE_TOP, routinesFromBlocks } from '../lib/flow';
import { formatMinuteOfDay } from '../lib/focusModel';
import { blindSpots, DEFAULT_RANGE, getRangeWindow, loggingGaps, type InsightRange } from '../lib/insights';
import { getSleepActivityIds } from '../lib/sleepActivity';
import { SleepInsights } from './SleepInsights';
import { RangePicker, type RangeState } from './RangePicker';
import { PatternsDayView } from './DayModeViews';
import { Card } from './TrendsTab';
import { ProductivityPointsSelfFetch } from './ProductivityPointsCard';
import { StatTile, useNerdMode } from './ui/detail';
import { Takeaways } from './ui/takeaways';
import { patternsTakeaways } from '../lib/takeaways';
import { FULL, pageClass } from './ui/page';

interface PatternsTabProps {
  activities: Activity[];
  tasks: Task[];
  focusSessions: TaskFocusSession[];
  sleepLogs: SleepLog[];
  blocks: RangeBlock[];
  selectedDate: Date;
}

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_PLURALS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const MIN_CELL = 5;

// Activities taken out of routine detection. Per device (this browser only), edited in nerd mode, applied in both modes.
const SKIP_KEY = 'blockday.routineSkip';
const readSkip = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(SKIP_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
};
const useRoutineSkip = () => {
  const [skip, setSkipState] = useState<string[]>(readSkip);
  const setSkip = (next: string[]) => {
    setSkipState(next);
    try { localStorage.setItem(SKIP_KEY, JSON.stringify(next)); } catch { /* storage unavailable: keeps working for this visit */ }
  };
  return [skip, setSkip] as const;
};

/** Patterns: what follows what, where the data is blind, and how sleep lines up with the next day. */
const PatternsRangeView: React.FC<PatternsTabProps & RangeState> = ({ activities, tasks, focusSessions, sleepLogs, blocks: liveBlocks, selectedDate, range, setRange }) => {
  const win = useMemo(() => getRangeWindow(range, selectedDate), [range, selectedDate]);
  // Raw blocks are still needed for the logging-gap heatmap below, which is hour-of-day grain --
  // analytics_daily is day-grain only, no hourly breakdown exists or is planned. The flow matrix and
  // routines both come from backend tables (analytics_transition_daily / analytics_routine_daily).
  const { blocks, loading: blocksLoading } = useBlockRange(win.startKey, win.endKey, liveBlocks);
  const { rows: transitionRows, loading: transitionsLoading } = useTransitionAnalyticsRange(win.startKey, win.endKey);
  const { rows: routineRows, loading: routinesLoading } = useRoutineAnalyticsRange(win.startKey, win.endKey);
  const loading = blocksLoading || transitionsLoading || routinesLoading;

  const { nerd } = useNerdMode();
  const [skipIds, setSkipIds] = useRoutineSkip();
  const [allRoutines, setAllRoutines] = useState(false);
  // only skip activities that still exist, so a deleted one can't silently hide anything
  const skip = useMemo(() => new Set(skipIds.filter((id) => activities.some((a) => a.id === id))), [skipIds, activities]);

  const flow = useMemo(
    () => buildFlowResult(transitionRows, routineRows, activities, { routineLimit: Infinity }),
    [transitionRows, routineRows, activities]
  );
  // The backend stores sequences with every activity in them, so a skipped activity can't be cut out of those rows.
  // With anything skipped, routines are found from the raw blocks already loaded for the gaps map below instead.
  const routines = useMemo(() => {
    if (skip.size === 0) return flow.routines;
    const sleepIds = getSleepActivityIds(activities);
    return routinesFromBlocks({ blocks, activities, sleepIds }, win.dateKeys, { skip, limit: Infinity });
  }, [skip, flow.routines, blocks, activities, win.dateKeys]);
  const shownRoutines = allRoutines ? routines : routines.slice(0, ROUTINE_TOP);
  const skippable = useMemo(() => {
    const inRoutines = new Set((skip.size ? routines : flow.routines).flatMap((r) => r.steps));
    return activities.filter((a) => inRoutines.has(a.id) && !skip.has(a.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [routines, flow.routines, activities, skip]);
  const skippedNames = activities.filter((a) => skip.has(a.id)).map((a) => a.name);
  const gaps = useMemo(() => loggingGaps(blocks, win.dateKeys), [blocks, win.dateKeys]);
  const spots = useMemo(() => blindSpots(gaps.cells), [gaps]);
  const takeaways = useMemo(() => {
    const top = flow.strongest[0];
    return patternsTakeaways({
      strongest: top ? { from: flow.names[top.from], to: flow.names[top.to], pct: top.pct } : null,
      blindSpot: spots[0] ? `${DAY_PLURALS[spots[0].weekday]} around ${formatMinuteOfDay(spots[0].hour * 60)} (${spots[0].untrackedPct}% unlogged)` : null,
      untrackedPct: gaps.overallPct,
      notTrackedDays: gaps.notTrackedDays,
    });
  }, [flow, spots, gaps]);
  const rowNodes = flow.nodes.filter((n) => n !== FLOW_OTHER);
  const name = (id: string) => `${flow.names[id]}${flow.ignored.has(id) ? ' (ignored)' : ''}`;

  return (
    <div className={pageClass('wide', true)}>
      <div className={`flex items-center justify-between gap-3 flex-wrap ${FULL}`}>
        <p className="text-sm text-muted-foreground">{flow.totalTransitions} activity change{flow.totalTransitions === 1 ? '' : 's'} in this range{loading ? ' · loading…' : ''}</p>
        <RangePicker range={range} onChange={setRange} selectedDate={selectedDate} />
      </div>

      <Takeaways items={takeaways} loading={loading} className={FULL} />

      <div className={`grid grid-cols-2 md:grid-cols-3 gap-3 ${FULL}`}>
        <StatTile to="patterns-flow" label="Switches" value={String(flow.totalTransitions)} sub="activity changes in this range" />
        <StatTile
          to="patterns-flow"
          label="Most common next step"
          value={<span className="text-sm md:text-base">{flow.strongest[0] ? `${flow.names[flow.strongest[0].from]} → ${flow.names[flow.strongest[0].to]}` : '—'}</span>}
          sub={flow.strongest[0] ? `${flow.strongest[0].pct}% of the time` : 'not enough changes yet'}
        />
        <StatTile to="patterns-gaps" label="Untracked" value={gaps.overallPct === null ? '—' : `${gaps.overallPct}%`} sub={gaps.notTrackedDays ? `on tracked days · ${gaps.notTrackedDays} day${gaps.notTrackedDays === 1 ? '' : 's'} not tracked at all` : 'of elapsed time on tracked days'} className="col-span-2 md:col-span-1" />
      </div>

      <Card id="patterns-flow" className={FULL} title="Activity flow" hint="Row → column: when you finish the row activity and start something else within 30 minutes, how often it is the column one. Each row adds up to 100%.">
        {rowNodes.length < 2 ? (
          <p className="text-sm text-muted-foreground">Not enough activity changes in this range yet.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="text-[11px] border-separate" style={{ borderSpacing: 2 }}>
                <thead>
                  <tr>
                    <th className="text-left font-medium text-muted-foreground pr-2">from ↓ to →</th>
                    {flow.nodes.map((id) => (
                      <th key={id} className="font-medium text-muted-foreground px-1 max-w-[72px] truncate" title={name(id)}>
                        <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ backgroundColor: flow.colors[id] }} />{flow.names[id]}
                      </th>
                    ))}
                    <th className="font-medium text-muted-foreground px-1">n</th>
                  </tr>
                </thead>
                <tbody>
                  {rowNodes.map((from, r) => (
                    <tr key={from}>
                      <th className="text-left font-medium pr-2 whitespace-nowrap">
                        <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ backgroundColor: flow.colors[from] }} />{name(from)}
                      </th>
                      {flow.matrix[r].map((cell, c) => {
                        const thin = flow.outTotals[r] < MIN_CELL;
                        return (
                          <td
                            key={flow.nodes[c]}
                            title={`${flow.names[from]} → ${flow.names[flow.nodes[c]]}: ${cell.count} of ${flow.outTotals[r]}${thin ? ' (too few to read much into)' : ''}`}
                            className={`w-12 h-8 text-center rounded ibm-mono ${cell.count === 0 ? 'text-muted-foreground/40' : ''}`}
                            style={cell.count === 0 ? { backgroundColor: 'hsl(var(--muted) / 0.4)' } : { backgroundColor: `hsl(var(--primary) / ${thin ? 0.12 : Math.max(0.12, cell.pct / 100)})`, color: !thin && cell.pct >= 50 ? 'hsl(var(--primary-foreground))' : undefined }}
                          >
                            {cell.count === 0 ? '·' : `${cell.pct}%`}
                          </td>
                        );
                      })}
                      <td className="text-center text-muted-foreground ibm-mono">{flow.outTotals[r]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid md:grid-cols-2 gap-4 mt-4">
              <div>
                <div className="text-[11px] text-muted-foreground mb-1 font-medium">Most common next steps</div>
                {flow.strongest.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No link seen 5+ times yet.</p>
                ) : (
                  <ul className="text-xs space-y-1">
                    {flow.strongest.map((l) => (
                      <li key={`${l.from}-${l.to}`}>After <strong>{flow.names[l.from]}</strong> you go to <strong>{flow.names[l.to]}</strong> {l.pct}% of the time <span className="text-muted-foreground">(n = {l.count})</span></li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground mb-1 font-medium">Most common routines</div>
                {routines.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No sequence of three to five steps repeated yet.</p>
                ) : (
                  <ul className="text-xs space-y-1">
                    {shownRoutines.map((rt) => (
                      <li key={rt.steps.join('>')}>{rt.steps.map((s) => flow.names[s] ?? '?').join(' → ')} <span className="text-muted-foreground">× {rt.count}</span></li>
                    ))}
                  </ul>
                )}
                {routines.length > ROUTINE_TOP && (
                  <button onClick={() => setAllRoutines((v) => !v)} className="mt-1.5 text-[11px] font-medium text-primary hover:underline">
                    {allRoutines ? 'Show fewer' : `Show all ${routines.length}`}
                  </button>
                )}
                {nerd ? (
                  <div className="mt-3 pt-2 border-t border-border/60">
                    <div className="text-[11px] text-muted-foreground mb-1.5 font-medium" title="Skipped activities are taken out of the timeline before routines are found, so the steps around them join up and other activities get the room.">Skip in routines</div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {activities.filter((a) => skip.has(a.id)).map((a) => (
                        <button
                          key={a.id}
                          onClick={() => setSkipIds(skipIds.filter((id) => id !== a.id))}
                          className="inline-flex items-center gap-1 rounded-full bg-muted pl-2 pr-1.5 py-0.5 text-[11px] hover:bg-accent"
                          aria-label={`Stop skipping ${a.name}`}
                          title={`Stop skipping ${a.name}`}
                        >
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: a.color }} />{a.name}<span className="text-muted-foreground">×</span>
                        </button>
                      ))}
                      {skippable.length > 0 && (
                        <select
                          value=""
                          onChange={(e) => { if (e.target.value) setSkipIds([...skipIds.filter((id) => skip.has(id)), e.target.value]); }}
                          className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground"
                          aria-label="Skip an activity in routines"
                        >
                          <option value="">+ Skip activity</option>
                          {skippable.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                      )}
                      {skip.size === 0 && skippable.length === 0 && <span className="text-[11px] text-muted-foreground">No routines to skip from yet.</span>}
                    </div>
                  </div>
                ) : skippedNames.length > 0 && (
                  <p className="mt-2 text-[10px] text-muted-foreground">Skipping {skippedNames.join(', ')} · change in nerd mode</p>
                )}
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground mt-3">Sleep is left out. Ignored activities (like travel) are kept here because they are real steps in your routine; to leave one out of routines, skip it above in nerd mode (this device only). Rows with under {MIN_CELL} changes are shaded faintly.</p>
          </>
        )}
      </Card>

      <SleepInsights detail activities={activities} sleepLogs={sleepLogs} tasks={tasks} focusSessions={focusSessions} liveBlocks={liveBlocks} selectedDate={selectedDate} />

      <Card id="patterns-gaps" className={FULL} detail summary={gaps.overallPct === null ? undefined : `${gaps.overallPct}% untracked`} title="Where you forget to track" hint={`Untracked share of each weekday hour on days you tracked anything${gaps.overallPct !== null ? `; ${gaps.overallPct}% of their elapsed time overall` : ''}. Days with nothing tracked at all are counted separately${gaps.notTrackedDays ? ` (${gaps.notTrackedDays} in this range)` : ''}. Every other graph is blind where this is dark. Sleep counts as tracked.`}>
        {gaps.days === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing tracked in this range yet.</p>
        ) : (
          <>
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
                      {gaps.cells[d].map((c, h) => (
                        <div
                          key={h}
                          title={c.untrackedPct === null ? `${DAY_NAMES[d]} ${formatMinuteOfDay(h * 60)}: not enough days` : `${DAY_NAMES[d]} ${formatMinuteOfDay(h * 60)}–${formatMinuteOfDay(h * 60 + 60)}: ${c.untrackedPct}% untracked · ${c.days} days`}
                          className={`h-5 rounded-[3px] ${c.untrackedPct === null ? 'border border-border/50' : ''}`}
                          style={c.untrackedPct === null ? undefined : { backgroundColor: 'hsl(var(--foreground))', opacity: Math.max(0.05, c.untrackedPct / 100) }}
                        />
                      ))}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>
            {spots.length > 0 && (
              <p className="text-[11px] text-muted-foreground mt-3">
                Biggest blind spots: {spots.map((s) => `${DAY_NAMES[s.weekday]} ${formatMinuteOfDay(s.hour * 60)} (${s.untrackedPct}% untracked)`).join(', ')}. Filling these in makes every other graph more honest.
              </p>
            )}
          </>
        )}
      </Card>

      <ProductivityPointsSelfFetch id="patterns-points-history" className={FULL} win={win} weekly={range === '6m' || range === '1y'} activities={activities} />
    </div>
  );
};

/** Holds the range; the "Day" option shows a single-day view, every other range the full view above. */
export const PatternsTab: React.FC<PatternsTabProps> = (props) => {
  const [range, setRange] = useState<InsightRange>(DEFAULT_RANGE);
  if (range === '1d') {
    return <PatternsDayView {...props} picker={<RangePicker range={range} onChange={setRange} selectedDate={props.selectedDate} />} />;
  }
  return <PatternsRangeView {...props} range={range} setRange={setRange} />;
};
