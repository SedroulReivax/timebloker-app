import React, { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';
import type { Activity, Task } from '../types';
import { buildTimeline, formatSegmentRange, type DayBlock } from '../lib/dayTimeline';
import { elapsedBlocksForDate, getActivityDistribution, getCoverage, getDistribution } from '../lib/insights';
import { profileDays, summarize } from '../lib/analysis';
import { getSleepActivityIds } from '../lib/sleepActivity';
import { timerOnlyBlocks } from '../lib/focusModel';
import { useNow } from '../hooks/useNow';
import { formatMinutes } from '../lib/taskTime';
import { getDeadlineDateKey } from '../lib/deadlines';
import { getFocusByDate } from '../lib/insights';
import type { TaskFocusSession } from '../types';
import { Section, StatTile, useNerdMode } from './ui/detail';
import { Takeaways } from './ui/takeaways';
import { SetupNudge } from './ui/analysisNav';
import { dayTakeaways } from '../lib/takeaways';
import { formatPoints, formatProductivity, hasProductivityMultipliers } from '../lib/activityFlags';
import { ANIM } from './ui/chart';
import { EnergyRating } from './ui/rating';
import { ENERGY_LABELS, ENERGY_MAX } from '../lib/energy';

export interface ReflectionFields {
  planned: string;
  happened: string;
  changed: string;
  carry_over: string;
}

/** A day reflection also carries the 1-7 energy rating (week/month reviews don't). */
export type DayReflectionFields = ReflectionFields & { energy: number | null };

interface DayViewProps {
  selectedDate: Date;
  blocks: (DayBlock & { date_key: string })[];
  activities: Activity[];
  tasks: Task[];
  focusSessions: TaskFocusSession[];
  /** Saved reflection for this day (if any). */
  review?: ({ [K in keyof ReflectionFields]?: string | null } & { energy?: number | null }) | null;
  onSaveReview?: (fields: DayReflectionFields) => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  Work: 'hsl(217 91% 60%)', Health: 'hsl(142 71% 45%)', Admin: 'hsl(45 93% 47%)', Leisure: 'hsl(283 39% 53%)',
  Other: 'hsl(0 0% 50%)', Sleep: 'hsl(230 40% 40%)', Uncategorized: 'hsl(0 0% 60%)', Untracked: 'hsl(var(--muted))',
};

const PROMPTS: { key: keyof ReflectionFields; label: string }[] = [
  { key: 'planned', label: 'What was planned?' },
  { key: 'happened', label: 'What actually happened?' },
  { key: 'changed', label: 'What changed?' },
  { key: 'carry_over', label: 'What should move to tomorrow?' },
];

export const DayView: React.FC<DayViewProps> = ({ selectedDate, blocks, activities, tasks, focusSessions, review, onSaveReview }) => {
  const dateKey = format(selectedDate, 'yyyy-MM-dd');
  const now = useNow(60_000);
  const elapsed = elapsedBlocksForDate(dateKey, now);
  const isToday = dateKey === format(now, 'yyyy-MM-dd');

  // Only this day's blocks (the live state can briefly hold another day while navigating)
  const dayBlocks = useMemo(() => blocks.filter((b) => b.date_key === dateKey), [blocks, dateKey]);
  const activityById = useMemo(() => new Map(activities.map((a) => [a.id, a])), [activities]);
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const sleepIds = useMemo(() => getSleepActivityIds(activities), [activities]);

  // timer-only blocks count as tracked here too, so Tracked matches the tiles and the profile below
  const timerOnly = useMemo(() => timerOnlyBlocks(focusSessions, dayBlocks, dateKey, elapsed), [focusSessions, dayBlocks, dateKey, elapsed]);
  const coverage = useMemo(() => getCoverage(dayBlocks.map((b) => ({ ...b })), [dateKey], now, { [dateKey]: timerOnly }), [dayBlocks, dateKey, now, timerOnly]);
  const summary = useMemo(() => getDistribution(dayBlocks.filter((b) => b.block_index < elapsed), activities, sleepIds, coverage), [dayBlocks, activities, sleepIds, coverage, elapsed]);
  const activitySummary = useMemo(() => getActivityDistribution(dayBlocks.filter((b) => b.block_index < elapsed), activities, coverage), [dayBlocks, activities, coverage, elapsed]);
  const [breakdownBy, setBreakdownBy] = useState<'category' | 'activity'>('category');
  const remainingMinutes = (144 - elapsed) * 10;
  const timeline = useMemo(() => buildTimeline(dayBlocks, elapsed), [dayBlocks, elapsed]);
  const profile = useMemo(
    () => profileDays({ blocks: dayBlocks.map((b) => ({ date_key: b.date_key, block_index: b.block_index, activity_id: b.activity_id, task_id: b.task_id ?? null })), activities, sleepIds, sessions: focusSessions }, [dateKey])[0],
    [dayBlocks, activities, sleepIds, focusSessions, dateKey]
  );
  const daySummary = useMemo(() => summarize([profile]), [profile]);
  const switches = profile.switches;
  const focusByDate = useMemo(() => getFocusByDate(focusSessions), [focusSessions]);
  const focused = focusByDate[dateKey] || 0;

  // Z1: generated answers
  const completedToday = useMemo(
    () => tasks.filter((t) => t.completed && t.completed_at && format(new Date(t.completed_at), 'yyyy-MM-dd') === dateKey),
    [tasks, dateKey]
  );
  const openDueToday = useMemo(
    () => tasks.filter((t) => !t.completed && t.deadline && getDeadlineDateKey(t.deadline) === dateKey),
    [tasks, dateKey]
  );
  const topConsumer = summary.find((r) => r.category !== 'Untracked' && r.category !== 'Sleep') ?? null;
  const hasMultipliers = hasProductivityMultipliers(activities);
  const takeaways = useMemo(() => {
    // the biggest waste activity of the day, from the per-activity rows already computed for the donut
    const topWaste = activitySummary
      .filter((r) => {
        const a = activityById.get(r.id);
        return !!a && !a.analysis_ignored && !sleepIds.has(r.id) && (a.productivity_multiplier ?? 0) < 0;
      })
      .sort((a, b) => b.minutes - a.minutes)[0];
    return dayTakeaways({
      isToday,
      trackedMinutes: coverage.trackedMinutes,
      coveragePct: coverage.coveragePct,
      topCategory: topConsumer ? { name: topConsumer.category, minutes: topConsumer.minutes } : null,
      deepMinutes: daySummary.deepMinutes,
      focusQualityPct: daySummary.focusQualityPct,
      productivityScore: daySummary.productivityScore,
      hasMultipliers,
      wasteMinutes: daySummary.wasteMinutes,
      topWaste: topWaste ? { name: topWaste.name, minutes: topWaste.minutes } : null,
      completedCount: completedToday.length,
      openDueCount: openDueToday.length,
    });
  }, [isToday, coverage, topConsumer, daySummary, hasMultipliers, activitySummary, activityById, sleepIds, completedToday, openDueToday]);

  // Reflection form: the energy rating saves on tap; the written prompts sit behind "Write more"
  const fromReview = (): DayReflectionFields => ({
    planned: review?.planned ?? '', happened: review?.happened ?? '', changed: review?.changed ?? '', carry_over: review?.carry_over ?? '',
    energy: review?.energy ?? null,
  });
  const [fields, setFields] = useState<DayReflectionFields>(fromReview);
  const [dirty, setDirty] = useState(false);
  const hasText = PROMPTS.some((p) => !!review?.[p.key]);
  const [writeOpenState, setWriteOpen] = useState(hasText);
  const { nerd } = useNerdMode();
  const writeOpen = nerd || writeOpenState;
  useEffect(() => {
    setFields(fromReview());
    setDirty(false);
  }, [dateKey, review]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setWriteOpen(PROMPTS.some((p) => !!review?.[p.key])); }, [dateKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const rateEnergy = (energy: number | null) => {
    const next = { ...fields, energy };
    setFields(next);
    // one tap = saved; any unsaved text goes with it, so nothing typed is lost
    onSaveReview?.(next);
    setDirty(false);
  };
  const reflectionSummary = [
    review?.energy ? `energy ${review.energy}/${ENERGY_MAX}` : null,
    hasText ? 'written' : null,
  ].filter(Boolean).join(' · ') || 'not rated yet';

  const nameOf = (activityId: string | null) => (activityId ? activityById.get(activityId)?.name ?? 'Unknown activity' : 'Untracked');

  const donutRows = breakdownBy === 'category'
    ? summary.map((r) => ({ key: r.category, name: r.category, minutes: r.minutes, color: CATEGORY_COLORS[r.category] || CATEGORY_COLORS.Other }))
    : activitySummary.map((r) => ({ key: r.id, name: r.name, minutes: r.minutes, color: r.color }));

  return (
    <div className="w-full space-y-4 page-enter">
      <div>
        <h2 className="text-lg font-bold">{format(selectedDate, 'EEEE, d MMMM yyyy')}</h2>
        <p className="text-xs text-muted-foreground">
          {switches} activity switch{switches === 1 ? '' : 'es'} · {formatMinutes(focused)} timer focus{isToday ? ' · so far' : ''}
        </p>
      </div>

      <Takeaways items={takeaways} />

      {/* Headline: tap a number for the detail behind it */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile
          label="Tracked"
          to="day-timeline"
          value={formatMinutes(coverage.trackedMinutes)}
          sub={coverage.coveragePct !== null ? `${coverage.coveragePct}% of ${isToday ? 'the day so far' : 'the day'}` : undefined}
        />
        <StatTile
          label="Deep focus"
          to="dv-runs"
          value={formatMinutes(daySummary.deepMinutes)}
          sub={daySummary.focusQualityPct !== null ? `quality ${daySummary.focusQualityPct}%` : 'no focus work'}
        />
        <StatTile
          label="Productivity"
          to="day-points"
          value={daySummary.productivityScore === null ? '—' : formatProductivity(daySummary.productivityScore)}
          sub={!hasMultipliers ? 'no multipliers set yet' : daySummary.productivityScore === null ? undefined : `${formatPoints(daySummary.productivityPoints)} in total`}
        />
        <StatTile
          label="Waste"
          to="dv-waste-stretches"
          value={formatMinutes(daySummary.wasteMinutes)}
          sub={daySummary.wasteSharePct === null ? undefined : `${daySummary.wasteSharePct}% of counted time`}
        />
      </div>

      {/* L1 Day summary */}
      <Section
        id="day-summary"
        title="24h day"
        actions={
          <div className="flex gap-1.5" role="tablist" aria-label="Break down by">
            {(['category', 'activity'] as const).map((v) => (
              <button
                key={v}
                role="tab"
                aria-selected={breakdownBy === v}
                onClick={() => setBreakdownBy(v)}
                className={`px-2.5 py-1.5 text-[11px] font-medium rounded-full border transition-colors ${breakdownBy === v ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground border-border hover:bg-accent'}`}
              >
                {v === 'category' ? 'Category' : 'Activity'}
              </button>
            ))}
          </div>
        }
      >
        <div className="flex flex-col sm:flex-row items-center gap-4">
          {donutRows.length > 0 && (
            <div className="w-32 h-32 sm:w-40 sm:h-40 flex-shrink-0" role="img" aria-label={`Time by ${breakdownBy}`}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={donutRows} dataKey="minutes" nameKey="name" innerRadius="60%" outerRadius="90%" paddingAngle={donutRows.length > 1 ? 2 : 0} stroke="none" {...ANIM}>
                    {donutRows.map((r) => <Cell key={r.key} fill={r.color} />)}
                  </Pie>
                  <RechartsTooltip formatter={(v, n) => [formatMinutes(Number(v)), n]} contentStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
          <ul className="space-y-1.5 text-sm flex-1 w-full min-w-0">
            {donutRows.map((r) => (
              <li key={r.key} className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: r.color }} />
                <span className="flex-1 truncate">{r.name}</span>
                <span className="ibm-mono text-muted-foreground">{formatMinutes(r.minutes)}</span>
              </li>
            ))}
            {isToday && remainingMinutes > 0 && (
              <li className="flex items-center gap-2 text-muted-foreground">
                <span className="w-2.5 h-2.5 rounded-full border border-border flex-shrink-0" />
                <span className="flex-1">Still ahead</span>
                <span className="ibm-mono">{formatMinutes(remainingMinutes)}</span>
              </li>
            )}
          </ul>
        </div>
      </Section>

      {/* L2 + L3 Timeline with task layer */}
      <Section id="day-timeline" detail title="Timeline" summary={`${timeline.filter((s) => s.kind === 'tracked').length} stretches`}>
        <ol className="space-y-1">
          {timeline
            .filter((s) => !(s.kind === 'future' && !s.activityId))
            .map((s) => {
              const task = s.taskId ? taskById.get(s.taskId) : undefined;
              const act = s.activityId ? activityById.get(s.activityId) : undefined;
              const muted = s.kind !== 'tracked';
              return (
                <li key={`${s.startIdx}-${s.kind}`} className={`flex flex-col sm:flex-row gap-1 sm:gap-3 sm:items-start text-sm rounded-lg px-2 py-1.5 ${muted ? 'text-muted-foreground' : ''}`}>
                  <div className="flex items-center gap-2 sm:contents">
                    <span className="ibm-mono text-[11px] sm:text-xs sm:w-40 flex-shrink-0 sm:pt-0.5">{formatSegmentRange(s)}</span>
                    <span className="w-2 h-2 sm:w-1.5 sm:h-auto sm:self-stretch rounded-full flex-shrink-0" style={{ backgroundColor: act?.color ?? 'hsl(var(--border))' }} />
                  </div>
                  <div className="min-w-0">
                    {task ? (
                      <>
                        <div className="font-medium truncate">{task.title}</div>
                        <div className="text-[11px] text-muted-foreground truncate">{nameOf(s.activityId)}</div>
                      </>
                    ) : (
                      <div className="font-medium truncate">
                        {s.kind === 'future' ? 'Planned: ' : ''}{act?.emoji ? `${act.emoji} ` : ''}{nameOf(s.activityId)}
                      </div>
                    )}
                    <div className="text-[11px] text-muted-foreground">{formatMinutes(s.minutes)}</div>
                  </div>
                </li>
              );
            })}
        </ol>
      </Section>

      {/* Z1 Daily review (generated from the day's data) */}
      <Section id="day-review" detail defaultOpen title="Daily review" summary={`${completedToday.length} done · ${openDueToday.length} still due`}>
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="font-semibold text-xs">What did I complete?</dt>
            <dd className="text-muted-foreground">
              {completedToday.length === 0 ? 'No tasks marked complete today.' : completedToday.map((t) => t.title).join(', ')}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-xs">What consumed the most time?</dt>
            <dd className="text-muted-foreground">{topConsumer ? `${topConsumer.category} · ${formatMinutes(topConsumer.minutes)}` : 'Nothing tracked yet.'}</dd>
          </div>
          <div>
            <dt className="font-semibold text-xs">How productive was today?</dt>
            <dd className="text-muted-foreground">
              {daySummary.productivityScore === null
                ? 'Nothing tracked yet.'
                : !hasMultipliers
                  ? <SetupNudge action="Set multipliers">Can't say yet: no activity has a productivity multiplier, so every minute counts as neutral.</SetupNudge>
                  : `${formatProductivity(daySummary.productivityScore)} on average (${formatPoints(daySummary.productivityPoints)} in total).`}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-xs">What was left untracked?</dt>
            <dd className="text-muted-foreground">{formatMinutes(coverage.untrackedMinutes)}{isToday ? ' so far' : ''}</dd>
          </div>
          <div>
            <dt className="font-semibold text-xs">What could move to tomorrow?</dt>
            <dd className="text-muted-foreground">
              {openDueToday.length === 0 ? 'Nothing due today is still open.' : `${openDueToday.map((t) => t.title).join(', ')} (due today, not done)`}
            </dd>
          </div>
        </dl>
      </Section>

      {/* L4 Review questions */}
      {onSaveReview && (
        <Section
          id="day-reflection"
          title="Reflection"
          actions={<span className="text-[11px] text-muted-foreground ibm-mono">{reflectionSummary}</span>}
        >
          <div>
            <div className="text-xs font-semibold mb-2">
              How energetic did you feel {isToday ? 'today' : 'this day'}?
              {fields.energy !== null && <span className="ml-1.5 font-normal text-muted-foreground">{ENERGY_LABELS[fields.energy]}</span>}
            </div>
            <EnergyRating value={fields.energy} onChange={rateEnergy} ariaLabel="Energy across the day" />
            <p className="text-[10px] text-muted-foreground mt-1.5">Across the whole day, not just on waking (that one lives in Sleep). Saves as soon as you tap; tap again to clear.</p>
          </div>

          <div className="mt-4 border-t border-border pt-3">
            {!nerd && (
              <button
                type="button"
                onClick={() => setWriteOpen((o) => !o)}
                aria-expanded={writeOpen}
                className="text-xs font-semibold text-muted-foreground hover:text-foreground"
              >
                {writeOpen ? 'Hide written reflection' : hasText ? 'Show written reflection' : 'Write more'}
              </button>
            )}
            {writeOpen && (
              <>
                <div className="space-y-3 mt-3">
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
                  <button
                    onClick={() => { onSaveReview(fields); setDirty(false); }}
                    disabled={!dirty}
                    className="px-3 py-1.5 text-xs font-semibold rounded-md bg-primary text-primary-foreground disabled:opacity-50"
                  >
                    Save reflection
                  </button>
                </div>
              </>
            )}
          </div>
        </Section>
      )}
    </div>
  );
};
