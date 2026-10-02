import React, { useId, useMemo, useState } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts';
import type { RangeBlock } from '../lib/blockRange';
import { productivityCurve, type AnalysisActivity, type CurvePoint } from '../lib/analysis';
import { formatMinuteOfDay } from '../lib/focusModel';
import { slotAxisLabel, SLOT_COUNT } from '../lib/timeOfDay';
import { ANIM, CURVE, smoothSeries, TICK, chartH } from './ui/chart';
import { Section } from './ui/detail';
import { SetupNudge } from './ui/analysisNav';
import { formatProductivity } from '../lib/activityFlags';

interface FocusCurveCardProps {
  activities: AnalysisActivity[];
  blocks: RangeBlock[];
  sleepIds: Set<string>;
  /** the days the curve is drawn for */
  dateKeys: string[];
  /** optional days drawn faintly behind it as "typical" (e.g. the last 28 days in the Day view) */
  typicalKeys?: string[];
  /** only the first N blocks of each typical day (today so far vs past days cut at the same time) */
  typicalCutoff?: number;
  detail?: boolean;
  id?: string;
  className?: string;
}

const AXIS_TICKS = [0, 6, 12, 18, 24, 30, 36, 42];
const GOOD = 'hsl(152 60% 42%)';
const BAD = 'hsl(0 72% 55%)';
const WINDOW = 4; // two hours

/** "avg": average multiplier of the judged time (how well); "points": multiplier x minutes per day (how well x how much) */
type CurveMode = 'avg' | 'points';
const MODE_KEY = 'blockday.focusCurveMode';
const readMode = (): CurveMode => {
  try { return localStorage.getItem(MODE_KEY) === 'points' ? 'points' : 'avg'; } catch { return 'avg'; }
};
const writeMode = (m: CurveMode) => {
  try { localStorage.setItem(MODE_KEY, m); } catch { /* storage blocked */ }
};

const sign = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '');
const signed = (v: number) => formatProductivity(v);
const signedPts = (v: number) => `${sign(v)}${Math.abs(v) >= 10 ? Math.round(Math.abs(v)) : Math.abs(v).toFixed(1)} pts`;
const fmt = (mode: CurveMode, v: number) => (mode === 'avg' ? signed(v) : signedPts(v));

/**
 * Best and worst two-hour stretch (needs at least an hour of judged time in it). Average mode weighs each half hour
 * by its minutes; points mode adds the points up, since points already carry the volume.
 */
const extremes = (pts: CurvePoint[], mode: CurveMode) => {
  let best: { slot: number; v: number } | null = null, worst: { slot: number; v: number } | null = null;
  for (let s = 0; s + WINDOW <= SLOT_COUNT; s++) {
    const win = pts.slice(s, s + WINDOW).filter((p) => p.value !== null);
    if (win.length < 2) continue;
    const mins = win.reduce((a, p) => a + p.minutes, 0);
    const v = mode === 'avg'
      ? win.reduce((a, p) => a + (p.value as number) * p.minutes, 0) / mins
      : win.reduce((a, p) => a + p.pointsPerDay, 0);
    if (!best || v > best.v) best = { slot: s, v };
    if (!worst || v < worst.v) worst = { slot: s, v };
  }
  const span = (s: number) => `${formatMinuteOfDay(s * 30)}–${formatMinuteOfDay((s + WINDOW) * 30)}`;
  return {
    best: best ? `${span(best.slot)} (${fmt(mode, best.v)}${mode === 'points' ? '/day' : ''})` : null,
    worst: worst && best && worst.slot !== best.slot && worst.v < best.v ? `${span(worst.slot)} (${fmt(mode, worst.v)}${mode === 'points' ? '/day' : ''})` : null,
  };
};

/**
 * "When am I productive?" Your own per-activity multipliers (Settings → Analysis) averaged per half hour and drawn
 * as one smooth curve: green above zero, red below.
 */
export const FocusCurveCard: React.FC<FocusCurveCardProps> = React.memo(({ activities, blocks, sleepIds, dateKeys, typicalKeys, typicalCutoff, detail, id = 'focus-curve', className }) => {
  const gid = useId().replace(/:/g, '');
  const raw = useMemo(() => productivityCurve({ blocks, activities, sleepIds }, dateKeys), [blocks, activities, sleepIds, dateKeys]);
  const typical = useMemo(
    () => (typicalKeys?.length ? productivityCurve({ blocks, activities, sleepIds }, typicalKeys, { cutoffBlocks: typicalCutoff }) : null),
    [blocks, activities, sleepIds, typicalKeys, typicalCutoff]
  );
  const [mode, setModeState] = useState<CurveMode>(readMode);
  const setMode = (m: CurveMode) => { setModeState(m); writeMode(m); };
  const pick = (p: CurvePoint | undefined) => (!p || p.value === null ? null : mode === 'avg' ? p.value : p.pointsPerDay);
  const data = useMemo(() => {
    const merged = raw.map((p, i) => ({ slot: p.slot, value: pick(p), minutes: p.minutes, typical: pick(typical?.[i]) }));
    return smoothSeries(typical ? smoothSeries(merged, 'typical') : merged, 'value');
  }, [raw, typical, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasMultipliers = activities.some((a) => (a.productivity_multiplier ?? 0) !== 0);
  const hasData = raw.some((p) => p.value !== null);
  const values = data.flatMap((p) => [p.value, p.typical]).filter((v): v is number => typeof v === 'number');
  const floor = mode === 'avg' ? 0.5 : 5;
  const max = Math.max(floor, ...values), min = Math.min(-floor, ...values);
  const zero = max / (max - min); // gradient offset where the curve crosses 0
  const { best, worst } = useMemo(() => extremes(raw, mode), [raw, mode]);
  const summary = best ? `best ${best}` : hasData ? 'flat' : 'no data';

  return (
    <Section
      id={id}
      className={className}
      detail={detail}
      title="Focus curve"
      summary={summary}
      hint={mode === 'avg'
        ? 'When in the day you are productive. Each half hour shows productivity points per minute (your own multipliers, averaged over the tracked minutes in it): how well, not how much. Above 0 is productive time, below 0 is waste. Sleep, ignored and untracked time are left out.'
        : 'Productivity points per half hour: multiplier × minutes, per day with tracking. Unlike the average, this grows with how much you did, so 30 min at +1× is 30 points and 10 min at +1× is 10. The same points as the Productivity numbers elsewhere. Sleep and ignored time are left out.'}
      actions={
        <div className="flex gap-1" role="tablist" aria-label="Curve units">
          {([['avg', 'Per minute'], ['points', 'Points']] as const).map(([m, label]) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-full border transition-colors ${mode === m ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground border-border hover:bg-accent'}`}
            >
              {label}
            </button>
          ))}
        </div>
      }
    >
      {!hasMultipliers ? (
        <SetupNudge action="Set multipliers">No activity has a productivity multiplier yet, so every minute is neutral and this curve stays flat.</SetupNudge>
      ) : !hasData ? (
        <p className="text-sm text-muted-foreground">Nothing tracked in this range yet.</p>
      ) : (
        <>
          <div style={{ height: chartH(190) }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ right: 8, top: 6, left: 0 }}>
                <defs>
                  <linearGradient id={`fc-stroke-${gid}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset={zero} stopColor={GOOD} />
                    <stop offset={zero} stopColor={BAD} />
                  </linearGradient>
                  <linearGradient id={`fc-fill-${gid}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset={0} stopColor={GOOD} stopOpacity={0.35} />
                    <stop offset={zero} stopColor={GOOD} stopOpacity={0.04} />
                    <stop offset={zero} stopColor={BAD} stopOpacity={0.04} />
                    <stop offset={1} stopColor={BAD} stopOpacity={0.35} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="slot" type="number" domain={[0, SLOT_COUNT - 1]} ticks={AXIS_TICKS} tickFormatter={slotAxisLabel} tick={TICK} />
                <YAxis tick={TICK} width={34} domain={[min, max]} tickFormatter={(v) => (mode === 'avg' ? Number(v).toFixed(1) : `${Math.round(Number(v))}`)} />
                <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" strokeOpacity={0.7} />
                <RechartsTooltip
                  labelFormatter={(s) => `${formatMinuteOfDay(Number(s) * 30)}–${formatMinuteOfDay(Number(s) * 30 + 30)}`}
                  formatter={(_v, name, p) => {
                    const row = p.payload as { valueRaw: number | null; typicalRaw?: number | null; minutes: number };
                    if (name === 'typical') return [row.typicalRaw == null ? '—' : fmt(mode, row.typicalRaw), 'Typical'];
                    return [row.valueRaw == null ? 'nothing counted' : `${fmt(mode, row.valueRaw)}${mode === 'points' ? '/day' : ''} · ${row.minutes} min`, mode === 'avg' ? 'Per minute' : 'Points'];
                  }}
                />
                {typical && <Line type={CURVE} dataKey="typical" stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} strokeDasharray="3 3" dot={false} strokeOpacity={0.7} {...ANIM} />}
                <Area type={CURVE} dataKey="value" baseValue={0} stroke={`url(#fc-stroke-${gid})`} fill={`url(#fc-fill-${gid})`} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} {...ANIM} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            {best && <>Best stretch <strong className="text-foreground">{best}</strong></>}
            {worst && <> · worst <strong className="text-foreground">{worst}</strong></>}
            {typical && <> · dashed line: your typical day</>}
          </p>
        </>
      )}
    </Section>
  );
});
FocusCurveCard.displayName = 'FocusCurveCard';
