import React, { useMemo, useState } from 'react';
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts';
import { Section } from './ui/detail';
import { format, parseISO, subDays } from 'date-fns';
import type { Activity, SleepLog, Task, TaskFocusSession } from '../types';
import { useBlockRange } from '../hooks/useBlockRange';
import type { RangeBlock } from '../lib/blockRange';
import { getSleepActivityIds } from '../lib/sleepActivity';
import { formatDur, type SleepEffect } from '../lib/sleepAnalysis';
import { analyzeSleepEffects, SHORT_SLEEP_MIN } from '../lib/sleepEffects';
import { chartH } from './ui/chart';

interface SleepInsightsProps {
  activities: Activity[];
  /** kept for callers; sleep ratings are not used in these next-day tests */
  sleepLogs: SleepLog[];
  tasks: Task[];
  focusSessions: TaskFocusSession[];
  liveBlocks: RangeBlock[];
  selectedDate: Date;
}

const WINDOW_DAYS = 90;

const MIN_NIGHTS = 10;

/** How sure we are, in plain words. */
const CONFIDENCE_TEXT: Record<Exclude<SleepEffect['verdict'], 'insufficient'>, string> = {
  clear: 'Strong enough that luck is unlikely to explain it.',
  possible: 'Could still be luck. Keep logging and check back.',
  none: "How long you sleep doesn't seem to change this.",
};

const VERDICT_LABEL: Record<SleepEffect['verdict'], string> = {
  clear: 'Real pattern',
  possible: 'Maybe',
  none: 'No link',
  insufficient: 'Too early',
};

/** What the data says for one measure, as one sentence (null when there is nothing to say yet). */
const describeEffect = (metric: { label: string; fmt: (v: number) => string }, effect: SleepEffect): string | null => {
  if (effect.verdict === 'none' || effect.verdict === 'insufficient') return null;
  const { diff, short, other, association } = effect;
  if (diff && short.median !== null && other.median !== null) {
    const size = metric.fmt(Math.abs(diff.value));
    return `After a night under ${formatDur(SHORT_SLEEP_MIN)}, your next day was usually about ${size} ${diff.value < 0 ? 'lower' : 'higher'}: ${metric.fmt(short.median)} versus ${metric.fmt(other.median)} after ${formatDur(SHORT_SLEEP_MIN)} or more.`;
  }
  if (association.rho === null) return null;
  const what = metric.label.replace('Next-day ', '').toLowerCase();
  return `The longer you sleep, the ${association.rho > 0 ? 'higher' : 'lower'} your ${what} tends to be the next day. There are too few short or long nights to say by how much.`;
};

export const SleepInsights: React.FC<SleepInsightsProps & { detail?: boolean }> = ({ activities, tasks, focusSessions, liveBlocks, selectedDate, detail }) => {
  const endKey = format(selectedDate, 'yyyy-MM-dd');
  const startKey = format(subDays(selectedDate, WINDOW_DAYS - 1), 'yyyy-MM-dd');
  const { blocks } = useBlockRange(startKey, endKey, liveBlocks);
  const sleepIds = useMemo(() => getSleepActivityIds(activities), [activities]);

  const analysis = useMemo(() => {
    const nightKeys: string[] = [];
    for (let i = WINDOW_DAYS - 1; i >= 1; i--) nightKeys.push(format(subDays(selectedDate, i), 'yyyy-MM-dd'));
    return analyzeSleepEffects({ blocks, activities, sleepIds, sessions: focusSessions, tasks }, nightKeys);
  }, [blocks, sleepIds, focusSessions, tasks, selectedDate, activities]);

  const [plotId, setPlotId] = useState('deep');
  const plotted = analysis.results.find((r) => r.metric.id === plotId && r.metric.pairs.length > 0) ?? analysis.results.find((r) => r.metric.pairs.length > 0);
  const points = plotted ? plotted.metric.pairs.map((p) => ({ hours: Math.round((p.sleepMinutes / 60) * 10) / 10, value: Math.round(p.value * 100) / 100 })) : [];

  if (sleepIds.size === 0) return null;

  return (
    <Section id="patterns-sleep" detail={detail} title="Sleep and next-day patterns" summary={`${analysis.nights.length} nights`}>
      <div className="space-y-4">
      <div>
        <p className="text-xs text-muted-foreground">
          We compare each night's sleep with the day that followed, over the last {WINDOW_DAYS} days ({format(parseISO(startKey), 'd MMM')} – {format(parseISO(endKey), 'd MMM')}, {analysis.nights.length} nights with tracked sleep).
          Something is only called a “real pattern” when it is unlikely to be luck. It shows a link, not a cause.
        </p>
      </div>

      {plotted && (
        <div>
          <div className="flex gap-1.5 flex-wrap" role="tablist" aria-label="Next-day measure to plot">
            {analysis.results.filter((r) => r.metric.pairs.length > 0).map((r) => (
              <button key={r.metric.id} role="tab" aria-selected={plotted.metric.id === r.metric.id} onClick={() => setPlotId(r.metric.id)} className={`px-2.5 py-1 text-[11px] rounded-full border transition-colors ${plotted.metric.id === r.metric.id ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground border-border hover:bg-accent'}`}>
                {r.metric.label.replace('Next-day ', '')}
              </button>
            ))}
          </div>
          <div style={{ height: chartH(190) }} className="mt-2" role="img" aria-label={`Sleep hours against ${plotted.metric.label.toLowerCase()}, one dot per night`}>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 8, right: 12, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" dataKey="hours" name="Sleep" domain={['dataMin - 0.5', 'dataMax + 0.5']} tick={{ fontSize: 10 }} tickFormatter={(v) => `${Number(v).toFixed(0)}h`} />
                <YAxis type="number" dataKey="value" name={plotted.metric.label} tick={{ fontSize: 10 }} width={44} tickFormatter={(v) => plotted.metric.fmt(Number(v))} />
                <RechartsTooltip cursor={{ strokeDasharray: '3 3' }} formatter={(v, n) => [n === 'Sleep' ? `${v}h` : plotted.metric.fmt(Number(v)), n]} contentStyle={{ fontSize: 12 }} />
                <Scatter data={points} fill="hsl(var(--primary))" fillOpacity={0.7} isAnimationActive={false} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[10px] text-muted-foreground">Each dot is one night: how long you slept (across) and how the next day went (up). The verdicts below are checked more carefully than the dots can be read by eye.</p>
        </div>
      )}

      {analysis.results.map(({ metric, effect }) => (
        <div key={metric.id} className="border-t border-border pt-3">
          <div className="flex items-baseline justify-between gap-3">
            <div className="text-xs font-semibold">{metric.label}</div>
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${effect.verdict === 'clear' ? 'bg-green-500/15 text-green-600 dark:text-green-400' : effect.verdict === 'possible' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-muted text-muted-foreground'}`}>
              {VERDICT_LABEL[effect.verdict]}
            </span>
          </div>
          {effect.n === 0 ? (
            <p className="text-xs text-muted-foreground mt-1">No data yet.</p>
          ) : effect.verdict === 'insufficient' ? (
            <p className="text-xs text-muted-foreground mt-1">Needs at least {MIN_NIGHTS} nights with this measure; you have {effect.n}.</p>
          ) : (
            <>
              {describeEffect(metric, effect) && <p className="text-sm mt-1">{describeEffect(metric, effect)}</p>}
              <p className="text-xs text-muted-foreground mt-1">{CONFIDENCE_TEXT[effect.verdict]} Based on {effect.n} nights.</p>
            </>
          )}
        </div>
      ))}
      <p className="text-[10px] text-muted-foreground">A night counts as “short” when it is under {formatDur(SHORT_SLEEP_MIN)}.</p>
      </div>
    </Section>
  );
};
