import React from 'react';
import { formatWindow, type FocusAnalysis, type FocusGroupResult, type FocusWindowResult } from '../lib/focusModel';

interface PeakFocusCardProps {
  analysis: FocusAnalysis;
  compact?: boolean;
  /** plain-language context from sleep timing (see describePeakContext) */
  context?: string[];
}

const CONF_STYLE = {
  high: 'bg-green-500/15 text-green-600 dark:text-green-400',
  medium: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  low: 'bg-muted text-muted-foreground',
} as const;

const CONF_LABEL = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' } as const;

const Curve: React.FC<{ group: FocusGroupResult }> = ({ group }) => {
  const w = group.window;
  return (
    <div>
      <div className="flex items-end gap-px h-20" role="img" aria-label="Deep-focus density across the day in 30 minute slots">
        {group.curve.map((c) => {
          const inWindow = !!w && c.startMin >= w.startMin && c.startMin < w.endMin;
          return (
            <div
              key={c.startMin}
              title={c.observed ? `${formatWindow({ startMin: c.startMin, endMin: c.startMin + 30 })}: ${Math.round(c.value)}` : `${formatWindow({ startMin: c.startMin, endMin: c.startMin + 30 })}: no data`}
              className={`flex-1 rounded-t-sm ${!c.observed ? 'bg-muted/40' : inWindow ? 'bg-primary' : 'bg-muted-foreground/40'}`}
              style={{ height: c.observed ? `${Math.max(4, c.value)}%` : '4%' }}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1 ibm-mono">
        <span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>12a</span>
      </div>
    </div>
  );
};

const WindowLine: React.FC<{ w: FocusWindowResult; label?: string }> = ({ w, label }) => (
  <div>
    {label && <div className="text-[11px] text-muted-foreground font-medium">{label}</div>}
    <div className="text-xl font-bold ibm-mono">{formatWindow(w)}</div>
    <div className="text-xs text-muted-foreground mt-0.5">
      Deep-focus score {w.score} vs {w.baseline} on a typical working hour
      {w.liftPct !== null && w.liftPct > 0 ? ` (+${w.liftPct}%)` : ''} · likely range {w.ci80[0]}–{w.ci80[1]}
    </div>
  </div>
);

export const PeakFocusCard: React.FC<PeakFocusCardProps> = ({ analysis, compact = false, context = [] }) => {
  const { overall, variants, secondary } = analysis;
  const w = overall.window;

  if (!w) {
    return (
      <p className="text-sm text-muted-foreground">
        {analysis.activeDays < 3
          ? `Not enough working days yet (${analysis.activeDays}). Track a few days of focus work to see your peak window.`
          : 'No distinct peak yet: your focus is spread evenly, or too little was tracked.'}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <WindowLine w={w} />
        <span className={`text-[10px] font-semibold px-2 py-1 rounded-full whitespace-nowrap ${CONF_STYLE[w.confidence]}`}>{CONF_LABEL[w.confidence]}</span>
      </div>

      {!compact && <Curve group={overall} />}

      <ul className="text-[11px] text-muted-foreground space-y-0.5">
        <li>
          Reached deep focus (60+) on {w.deepDayPct}% of working days · {w.sampleDays} day{w.sampleDays === 1 ? '' : 's'}, {w.sampleBlocks} blocks
          {w.effectiveDays < w.sampleDays ? ` (≈${w.effectiveDays} after weighting recent weeks more)` : ''}
        </li>
        {w.stability !== null && <li>Stability: the same window came out in {Math.round(w.stability * 100)}% of {overall.days >= 5 ? 'resamples of your days' : 'checks'}.</li>}
        {w.confidence === 'low' && <li>Tentative: more tracked working days will sharpen this.</li>}
      </ul>

      {!compact && context.length > 0 && (
        <ul className="text-[11px] text-muted-foreground space-y-0.5 border-l-2 border-border pl-2">
          {context.map((c) => <li key={c}>{c}</li>)}
        </ul>
      )}

      {secondary && <WindowLine w={secondary} label="Second wind" />}

      {variants.map((v) => v.window && (
        <div key={v.label} className="border-t border-border pt-2">
          <WindowLine w={v.window} label={v.label} />
        </div>
      ))}

      {!compact && (
        <p className="text-[10px] text-muted-foreground">
          Only tracked, awake time counts; untracked time is never treated as distraction. Recent weeks carry more weight (half-life {analysis.halfLifeDays} days).
        </p>
      )}
    </div>
  );
};
