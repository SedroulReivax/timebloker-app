import React, { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts';
import { ArrowDownRight, ArrowRight, ArrowUpRight, CircleHelp, PauseCircle } from 'lucide-react';
import type { Activity, Goal, Task, TaskBlockRef, TaskFocusSession } from '../types';
import type { RangeBlock } from '../lib/blockRange';
import { useGoalAnalyticsRange, useTransitionAnalyticsRange } from '../hooks/useAnalyticsRange';
import {
  dayTurbulence, estimateCalibration, goalMomentum, linkedMinutesByTask, taskFlow, taskFunnel, timeToDone,
  type ExecTask, type MomentumState, type Rate, type TransitionRow,
} from '../lib/execution';
import { getGoalPace, goalStartKey, groupGoalDailyRows, mergeGoalDailyLive, type GoalDayMinutes } from '../lib/goals';
import { DEFAULT_RANGE, getRangeWindow, type InsightRange } from '../lib/insights';
import { RangePicker } from './RangePicker';
import { ProductivityPointsSelfFetch } from './ProductivityPointsCard';
import { Section, StatTile } from './ui/detail';
import { Takeaways } from './ui/takeaways';
import { executionTakeaways } from '../lib/takeaways';
import { ANIM, CURVE, TICK, chartH } from './ui/chart';
import { FULL, PAIR, pageClass } from './ui/page';

interface ExecutionTabProps {
  activities: Activity[];
  tasks: Task[];
  taskBlocks: TaskBlockRef[];
  focusSessions: TaskFocusSession[];
  goals: Goal[];
  blocks: RangeBlock[];
  selectedDate: Date;
}

// Two-series palette (created vs completed), validated for CVD separation in light and dark.
const FLOW_COLORS = { created: '#3b82f6', completed: '#d97706' };

const hours = (h: number | null) => {
  if (h === null) return '—';
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 48) return `${h < 10 ? h.toFixed(1) : Math.round(h)}h`;
  return `${(h / 24).toFixed(1)}d`;
};
const pct = (r: Rate | null) => (r && r.pct !== null ? `${r.pct}%` : '—');
const interval = (r: Rate | null) => (r && r.lo !== null && r.hi !== null && r.n >= 5 ? `likely ${r.lo}–${r.hi}%` : r && r.n < 5 ? 'too few to say' : '');

const Observation: React.FC<{ n: number; window: string; children?: React.ReactNode }> = ({ n, window, children }) => (
  <p className="text-[10px] text-muted-foreground mt-2">
    <span className="font-semibold uppercase tracking-wide">Observation</span> · n = {n} · {window}{children ? <> · {children}</> : null}
  </p>
);

const MOMENTUM: Record<MomentumState, { label: string; icon: React.ReactNode; tone: string }> = {
  accelerating: { label: 'Speeding up', icon: <ArrowUpRight size={13} />, tone: 'text-foreground' },
  steady: { label: 'Steady', icon: <ArrowRight size={13} />, tone: 'text-foreground' },
  slowing: { label: 'Slowing', icon: <ArrowDownRight size={13} />, tone: 'text-foreground' },
  stalled: { label: 'Stalled', icon: <PauseCircle size={13} />, tone: 'text-foreground' },
  'too-early': { label: 'Too early', icon: <CircleHelp size={13} />, tone: 'text-muted-foreground' },
};

export const ExecutionTab: React.FC<ExecutionTabProps> = ({ activities, tasks, taskBlocks, focusSessions, goals, blocks, selectedDate }) => {
  const [range, setRange] = useState<InsightRange>(DEFAULT_RANGE);
  const win = useMemo(() => getRangeWindow(range === '1d' ? '7d' : range, selectedDate), [range, selectedDate]);
  const nameOf = useMemo(() => {
    const m = new Map(activities.map((a) => [a.id, a.name]));
    return (id: string) => m.get(id) ?? 'Unknown';
  }, [activities]);

  // ── Tasks (all history: the task list is already fully loaded) ──
  const execTasks: ExecTask[] = tasks as unknown as ExecTask[];
  const linked = useMemo(() => linkedMinutesByTask(taskBlocks, focusSessions), [taskBlocks, focusSessions]);
  const funnel = useMemo(() => taskFunnel(execTasks, linked), [execTasks, linked]);
  const flow = useMemo(() => taskFlow(execTasks), [execTasks]);
  const ttd = useMemo(() => timeToDone(execTasks), [execTasks]);
  const calib = useMemo(() => estimateCalibration(execTasks, linked), [execTasks, linked]);
  const firstTask = useMemo(() => execTasks.map((t) => t.created_at).sort()[0] ?? null, [execTasks]);
  const taskWindow = firstTask ? `since ${format(new Date(firstTask), 'd MMM')}` : 'no tasks yet';

  // ── Turbulence (range) ──
  const { rows: transitionRows, loading: tLoading } = useTransitionAnalyticsRange(win.startKey, win.endKey);
  const turb = useMemo(() => dayTurbulence(transitionRows as TransitionRow[], win.dateKeys), [transitionRows, win.dateKeys]);
  const turbChart = turb.days.map((d) => ({ ...d, label: format(parseISO(d.dateKey), turb.days.length > 14 ? 'd MMM' : 'EEE d') }));

  // ── Goals: same data path as GoalsPage (analytics_goal_daily + live overlay) ──
  const activeGoals = useMemo(() => goals.filter((g) => g.status === 'active'), [goals]);
  const todayKey = format(new Date(), 'yyyy-MM-dd');
  const goalFrom = useMemo(() => activeGoals.map((g) => goalStartKey(g)).filter((k): k is string => !!k).sort()[0] ?? todayKey, [activeGoals, todayKey]);
  const { rows: goalRows } = useGoalAnalyticsRange(goalFrom, goalFrom > todayKey ? goalFrom : todayKey);
  const momentum = useMemo(() => {
    const byGoal = groupGoalDailyRows(goalRows as { goal_id: string; date_key: string; goal_minutes: number }[]);
    return activeGoals.map((g) => {
      const daily: GoalDayMinutes[] = mergeGoalDailyLive(byGoal.get(g.id) ?? [], g, blocks);
      const pace = getGoalPace(g, daily);
      return { goal: g, pace, m: goalMomentum(pace) };
    });
  }, [activeGoals, goalRows, blocks]);

  const flowChart = flow.weeks.map((w) => ({ ...w, label: format(parseISO(w.weekStart), 'd MMM') }));
  const netPerWeek = flow.createdPerWeek !== null && flow.completedPerWeek !== null ? flow.createdPerWeek - flow.completedPerWeek : null;
  const takeaways = useMemo(() => executionTakeaways({
    stages: funnel.slice(1).map((s) => ({ label: s.label, pct: s.conversion?.pct ?? null, measurable: s.measurable, note: s.note })),
    open: flow.open,
    overdue: flow.overdue,
    netPerWeek,
    stalledGoals: momentum.filter((x) => x.m.state === 'stalled').map((x) => x.goal.title),
    medianHoursToDone: ttd.medianHours,
  }), [funnel, flow, netPerWeek, momentum, ttd]);

  return (
    <div className={pageClass('wide')}>
      <Takeaways items={takeaways} className={FULL} />
      <div className={FULL}>
        <p className="text-xs text-muted-foreground max-w-3xl">
          How intentions turn into action, measured only from what the app records. Each card is an observation with its
          sample size. Where the data can’t measure something yet, the card says so instead of showing a zero.
        </p>
      </div>

      <div className={`grid grid-cols-2 md:grid-cols-4 gap-3 ${FULL}`}>
        <StatTile to="exec-flow" label="Open tasks" value={String(flow.open)} sub={flow.overdue ? `${flow.overdue} past their deadline` : 'none overdue'} />
        <StatTile
          to="exec-flow"
          label="Created vs done / week"
          value={flow.createdPerWeek !== null ? `${flow.createdPerWeek.toFixed(1)} / ${flow.completedPerWeek!.toFixed(1)}` : '—'}
          sub={netPerWeek === null ? 'no completion times yet' : netPerWeek > 0.5 ? `backlog grows ~${netPerWeek.toFixed(1)}/week` : netPerWeek < -0.5 ? `backlog shrinks ~${(-netPerWeek).toFixed(1)}/week` : 'roughly balanced'}
        />
        <StatTile to="exec-done" label="Typical time to done" value={hours(ttd.medianHours)} sub={ttd.n ? `median of ${ttd.n} task${ttd.n === 1 ? '' : 's'}` : 'no completion times yet'} />
        <StatTile
          to="exec-turbulence"
          label="How scattered days are"
          value={turb.medianChoices !== null ? `${turb.medianChoices.toFixed(1)}` : '—'}
          sub={turb.medianChoices !== null ? 'places you scatter to after a switch' : 'not enough switches yet'}
        />
      </div>

      {/* ── Funnel ── */}
      <Section id="exec-funnel" className={FULL} title="From intention to done" hint="Each stage counts tasks that reached it. The percentage is the share of the previous measurable stage, with an 80% interval.">
        <ol className="space-y-2.5">
          {funnel.map((s) => {
            const width = funnel[0].count ? Math.max(2, (s.count / funnel[0].count) * 100) : 0;
            return (
              <li key={s.key}>
                <div className="flex items-baseline gap-2 text-sm">
                  <span className="font-medium">{s.label}</span>
                  <span className="ml-auto ibm-mono tabular-nums">{s.count}</span>
                  <span className="ibm-mono tabular-nums text-xs text-muted-foreground w-20 text-right">{s.measurable ? pct(s.conversion) : 'n/a'}</span>
                </div>
                <div className="h-2 rounded-full bg-muted mt-1 overflow-hidden" aria-hidden>
                  <div className={`h-full rounded-full ${s.measurable ? 'bg-primary' : 'bg-muted-foreground/30'}`} style={{ width: `${width}%` }} />
                </div>
                {(s.note || (s.measurable && s.conversion)) && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {[s.measurable ? interval(s.conversion) : '', s.note ?? ''].filter(Boolean).join(' · ')}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
        <Observation n={funnel[0].count} window={taskWindow}>recurring tasks count once</Observation>
      </Section>

      {/* ── Task flow ── */}
      <Section id="exec-flow" className={FULL} title="Tasks in vs tasks out" hint="Your task list as a queue: tasks created per week against tasks completed per week. If more arrive than leave for weeks on end, the backlog grows regardless of effort.">
        <div style={{ height: chartH(170) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={flowChart} margin={{ left: 0, right: 8, top: 4 }} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="label" tick={TICK} interval="preserveStartEnd" />
              <YAxis tick={TICK} width={28} allowDecimals={false} />
              <RechartsTooltip labelFormatter={(l) => `Week of ${l}`} contentStyle={{ fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="created" name="Created" fill={FLOW_COLORS.created} radius={[4, 4, 0, 0]} {...ANIM} />
              <Bar dataKey="completed" name="Completed (with a time)" fill={FLOW_COLORS.completed} radius={[4, 4, 0, 0]} {...ANIM} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="grid sm:grid-cols-2 gap-4 mt-3 text-sm">
          <div>
            <div className="text-xs font-semibold mb-1">Open backlog by age</div>
            <ul className="space-y-0.5">
              {flow.ageBuckets.map((b) => (
                <li key={b.label} className="flex justify-between"><span className="text-muted-foreground">{b.label}</span><span className="ibm-mono tabular-nums">{b.count}</span></li>
              ))}
            </ul>
            <p className="text-[11px] text-muted-foreground mt-1">
              {flow.open ? `Median open task is ${flow.openAgeMedianDays} day${flow.openAgeMedianDays === 1 ? '' : 's'} old; the oldest ${flow.oldestOpenDays}.` : 'Nothing open.'}
            </p>
          </div>
          <div className="text-[11px] text-muted-foreground space-y-1">
            {flow.comparableWeeks > 0 ? (
              <p>
                Over the {flow.comparableWeeks} week{flow.comparableWeeks === 1 ? '' : 's'} since completion times began being recorded, you created{' '}
                {flow.createdPerWeek!.toFixed(1)} and completed {flow.completedPerWeek!.toFixed(1)} tasks a week.
                {flow.comparableWeeks < 4 ? ' That is too short a stretch to call a trend.' : ''}
              </p>
            ) : <p>No task has a completion time yet, so arrivals can’t be compared with completions.</p>}
            {flow.undatedCompletions > 0 && (
              <p>{flow.undatedCompletions} task{flow.undatedCompletions === 1 ? ' was' : 's were'} completed before completion times were recorded, so {flow.undatedCompletions === 1 ? 'it isn’t' : 'they aren’t'} in the weekly bars.</p>
            )}
          </div>
        </div>
        <Observation n={funnel[0].count} window={`last ${flow.weeks.length} weeks`} />
      </Section>

      {/* ── Time to done + calibration ── */}
      <div className={`grid md:grid-cols-2 gap-4 items-start ${PAIR}`}>
        <Section id="exec-done" title="Time from created to done">
          {ttd.n === 0 ? (
            <p className="text-sm text-muted-foreground">No completed task has a completion time yet.</p>
          ) : (
            <>
              <dl className="grid grid-cols-3 gap-3 text-sm">
                <div><dt className="text-[11px] text-muted-foreground">Quick quarter</dt><dd className="ibm-mono font-semibold">{hours(ttd.p25Hours)}</dd></div>
                <div><dt className="text-[11px] text-muted-foreground">Typical</dt><dd className="ibm-mono font-semibold">{hours(ttd.medianHours)}</dd></div>
                <div><dt className="text-[11px] text-muted-foreground">Slow quarter</dt><dd className="ibm-mono font-semibold">{hours(ttd.p75Hours)}</dd></div>
              </dl>
              <p className="text-[11px] text-muted-foreground mt-2">{ttd.sameDayPct}% were finished the same day they were created.</p>
            </>
          )}
          <Observation n={ttd.n} window="completed tasks with a completion time" />
        </Section>

        <Section id="exec-calibration" title="Estimates vs reality, by task size" hint="Tracked time ÷ your estimate, as a geometric mean (2× over and 2× under are equally wrong). Only estimates you actually made count (minutes, or 2+ pomodoros; the default 1 pomodoro doesn’t), on completed tasks with 10+ minutes of linked time.">
          {calib.rows.length === 0 ? (
            <div className="text-sm text-muted-foreground space-y-1.5">
              <p>Nothing to calibrate yet: no completed task has both a real estimate and 10+ minutes of time linked to it.</p>
              <p className="text-[11px]">
                To start: give tasks an estimate in minutes, and when you paint blocks in the 24h grid, pick the task too (or run the Focus timer on it).
                {calib.defaultOnly > 0 && ` ${calib.defaultOnly} task${calib.defaultOnly === 1 ? ' has' : 's have'} only the default “1 pomodoro”, which isn’t treated as a real estimate.`}
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] text-muted-foreground text-left">
                  <th className="font-medium">Size</th><th className="font-medium text-right">n</th><th className="font-medium text-right">Takes</th><th className="font-medium text-right">Over estimate</th>
                </tr>
              </thead>
              <tbody>
                {calib.rows.map((r) => (
                  <tr key={r.label}>
                    <td>{r.label}</td>
                    <td className="text-right ibm-mono">{r.n}</td>
                    <td className="text-right ibm-mono">{r.multiplier !== null ? `${r.multiplier.toFixed(2)}×` : '—'}{r.n >= 5 && r.lo !== null && r.hi !== null ? <span className="text-[10px] text-muted-foreground"> ({r.lo.toFixed(1)}–{r.hi.toFixed(1)})</span> : null}</td>
                    <td className="text-right ibm-mono">{r.overPct !== null ? `${r.overPct}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Observation n={calib.usable} window={taskWindow}>size buckets with under 5 tasks show no interval</Observation>
        </Section>
      </div>

      {/* ── Turbulence ── */}
      <Section
        id="exec-turbulence"
        className={FULL}
        title="How scattered your days are"
        hint="After you switch activity, how many different places do you typically go? 1 means your switches follow fixed paths; higher means the day scatters. Computed from the switches between activity runs (transition entropy, shown as 2^bits)."
        actions={<RangePicker range={range} onChange={setRange} selectedDate={selectedDate} exclude={['1d']} />}
      >
        {tLoading && turb.days.length === 0 ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : turbChart.filter((d) => d.choices !== null).length < 2 ? (
          <p className="text-sm text-muted-foreground">Not enough days with {5}+ switches in this range.</p>
        ) : (
          <div style={{ height: chartH(160) }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={turbChart} margin={{ left: 0, right: 8, top: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" tick={TICK} interval="preserveStartEnd" />
                <YAxis tick={TICK} width={28} domain={[1, 'auto']} allowDecimals />
                <RechartsTooltip
                  formatter={(v) => [Number(v).toFixed(1), 'Places after a switch']}
                  labelFormatter={(_, p) => (p?.[0]?.payload ? `${format(parseISO(p[0].payload.dateKey), 'EEE d MMM')} · ${p[0].payload.switches} switches` : '')}
                  contentStyle={{ fontSize: 12 }}
                />
                {turb.medianChoices !== null && <ReferenceLine y={turb.medianChoices} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />}
                <Line type={CURVE} dataKey="choices" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} {...ANIM} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        {turb.bridges.length > 0 && (
          <div className="mt-3">
            <div className="text-xs font-semibold mb-1">After these, the day scatters most</div>
            <ul className="space-y-1 text-sm">
              {turb.bridges.map((b) => (
                <li key={b.activityId} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{nameOf(b.activityId)}</span>
                  <span className="ibm-mono text-xs">{b.choices.toFixed(1)} places</span>
                  <span className="text-[11px] text-muted-foreground">→ {b.top.map((t) => `${nameOf(t.activityId)} ${t.sharePct}%`).join(', ')} · {b.outgoing} switches</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Observation n={turb.days.length} window={`${format(parseISO(win.startKey), 'd MMM')} – ${format(parseISO(win.endKey), 'd MMM')}`}>
          days under 5 switches are left blank; dashed line = your typical day
        </Observation>
      </Section>

      {/* same range as the turbulence picker above */}
      <ProductivityPointsSelfFetch id="exec-points-history" className={FULL} win={win} weekly={range === '6m' || range === '1y'} activities={activities} />

      {/* ── Goal momentum ── */}
      <Section id="exec-goals" className={FULL} title="Goal momentum" hint="Velocity is your recency-weighted hours per week. Acceleration is the robust (Theil–Sen) trend of weekly hours over up to 8 complete weeks, judged against the goal’s own typical week. Needs 4+ complete weeks.">
        {momentum.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active goals.</p>
        ) : (
          <ul className="divide-y divide-border">
            {momentum.map(({ goal, pace, m }) => {
              const meta = MOMENTUM[m.state];
              const maxW = Math.max(1, ...pace.weeklyHistory);
              return (
                <li key={goal.id} className="py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  <div className="min-w-0 flex-1 basis-40">
                    <div className="text-sm font-medium truncate">{goal.emoji ? `${goal.emoji} ` : ''}{goal.title}</div>
                    <div className={`text-[11px] flex items-center gap-1 ${meta.tone}`}>{meta.icon}<span>{meta.label}</span>
                      {m.state === 'stalled' && pace.stalledDays !== null && <span className="text-muted-foreground">· nothing for {pace.stalledDays} days</span>}
                    </div>
                  </div>
                  <div className="text-xs ibm-mono tabular-nums">
                    <div>{m.velocity.toFixed(1)} h/wk</div>
                    <div className="text-[10px] text-muted-foreground">last 7 days {m.lastWeek.toFixed(1)}h</div>
                  </div>
                  <div className="text-xs ibm-mono tabular-nums w-28">
                    <div>{m.accelerationPerWeek === null ? '—' : `${m.accelerationPerWeek >= 0 ? '+' : ''}${m.accelerationPerWeek.toFixed(1)} h/wk²`}</div>
                    <div className="text-[10px] text-muted-foreground">{m.volatility === null ? `${m.weeks} complete week${m.weeks === 1 ? '' : 's'}` : m.volatility > 1 ? 'bursty weeks' : 'even weeks'}</div>
                  </div>
                  {pace.weeklyHistory.length > 0 && (
                    <div className="flex items-end gap-0.5 h-8" role="img" aria-label={`Weekly hours, oldest first: ${pace.weeklyHistory.map((h) => h.toFixed(1)).join(', ')}`}>
                      {pace.weeklyHistory.map((h, i) => (
                        <span key={i} className="w-2 rounded-t-[2px] bg-primary/70" style={{ height: `${Math.max(2, (h / maxW) * 100)}%` }} title={`${h.toFixed(1)}h`} />
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <Observation n={momentum.length} window="active goals, complete weeks since each started" />
      </Section>
    </div>
  );
};
