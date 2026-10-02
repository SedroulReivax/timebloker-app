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

const VERDICT_TEXT: Record<SleepEffect['verdict'], string> = {
  clear: 'A clear pattern in your data.',
  possible: 'Possibly a pattern, but not certain yet. Worth watching.',
  none: 'No relationship detectable in your data.',
  insufficient: 'Not enough nights yet (needs 10).',
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
          Last {WINDOW_DAYS} days ({format(parseISO(startKey), 'd MMM')} – {format(parseISO(endKey), 'd MMM')}) · {analysis.nights.length} nights with tracked sleep.
          Each result comes from a rank-correlation test, so a pattern is only called “clear” when it is unlikely to be chance. Associations, not proof of cause.
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
          <p className="text-[10px] text-muted-foreground">One dot per night: hours slept (x) and the day after (y). The verdict below is what the test says, not what the dots seem to say.</p>
        </div>
      )}

      {analysis.results.map(({ metric, effect }) => (
        <div key={metric.id} className="border-t border-border pt-3">
          <div className="flex items-baseline justify-between gap-3">
            <div className="text-xs font-semibold">{metric.label}</div>
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${effect.verdict === 'clear' ? 'bg-green-500/15 text-green-600 dark:text-green-400' : effect.verdict === 'possible' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-muted text-muted-foreground'}`}>
              {effect.verdict === 'clear' ? 'Clear' : effect.verdict === 'possible' ? 'Possible' : effect.verdict === 'none' ? 'No pattern' : 'Too early'}
            </span>
          </div>
          {effect.n === 0 ? (
            <p className="text-xs text-muted-foreground mt-1">No data yet.</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground mt-1">{VERDICT_TEXT[effect.verdict]} ({effect.n} nights{effect.association.p !== null ? `, p = ${effect.association.p < 0.001 ? '<0.001' : effect.association.p.toFixed(2)}` : ''})</p>
              {effect.diff && effect.verdict !== 'none' && effect.verdict !== 'insufficient' && (
                <p className="text-sm mt-1">
                  After under 7h: median <strong>{effect.short.median !== null ? metric.fmt(effect.short.median) : '—'}</strong> ({effect.short.n} nights) · 7h or more: median <strong>{effect.other.median !== null ? metric.fmt(effect.other.median) : '—'}</strong> ({effect.other.n} nights).
                  {' '}Likely difference {effect.diff.value >= 0 ? '+' : '−'}{metric.fmt(Math.abs(effect.diff.value))} ({metric.fmt(Math.min(effect.diff.lo, effect.diff.hi))} to {metric.fmt(Math.max(effect.diff.lo, effect.diff.hi))}).
                </p>
              )}
            </>
          )}
        </div>
      ))}
      <p className="text-[10px] text-muted-foreground">Shortest night counted as “short”: under {formatDur(SHORT_SLEEP_MIN)}.</p>
      </div>
    </Section>
  );
};
