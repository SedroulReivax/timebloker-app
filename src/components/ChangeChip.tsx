import React from 'react';
import type { ChangeResult } from '../lib/stats';

interface ChangeChipProps {
  change: ChangeResult | null | undefined;
  /** format a value in the metric's own unit (e.g. minutes -> "1h 5m") */
  fmt: (v: number) => string;
  /** what the comparison is against, shown in the tooltip */
  versus?: string;
}

/**
 * Honest change indicator. It only shows an arrow when the day-level data supports a real difference (an 80% interval
 * that excludes zero). Otherwise it says "no clear change", or "not enough days" when either side is too thin.
 * Arrows are neutral in colour: more is not automatically better.
 */
export const ChangeChip: React.FC<ChangeChipProps> = ({ change, fmt, versus = 'the previous period' }) => {
  if (!change) return null;
  if (!change.enough) {
    return <span className="text-[10px] text-muted-foreground" title={`Needs at least 3 finished days on both sides (${change.nCurrent} vs ${change.nPrevious})`}>not enough days to compare</span>;
  }
  if (change.direction === 'flat' || change.delta === null) {
    return <span className="text-[10px] text-muted-foreground" title={`The difference from ${versus} is within normal day-to-day variation`}>no clear change</span>;
  }
  const up = change.direction === 'up';
  return (
    <span
      className="text-[10px] font-medium text-foreground"
      title={`vs ${versus}: ${up ? '+' : '−'}${fmt(Math.abs(change.delta))} per day (likely ${fmt(Math.abs(change.lo ?? 0))} to ${fmt(Math.abs(change.hi ?? 0))})`}
    >
      {up ? '↑' : '↓'} {fmt(Math.abs(change.delta))}/day vs {versus === 'the previous period' ? 'before' : versus}
    </span>
  );
};

interface TypicalChipProps {
  result: { position: 'above' | 'within' | 'below' | 'insufficient'; p25: number | null; p75: number | null; n: number; value: number | null };
  fmt: (v: number) => string;
  /** e.g. "by this time of day" when comparing today so far */
  qualifier?: string;
}

/**
 * One day against your typical day (the middle half of your recent finished days). Neutral in colour, like ChangeChip:
 * above is not automatically better.
 */
export const TypicalChip: React.FC<TypicalChipProps> = ({ result, fmt, qualifier }) => {
  if (result.value === null) return <span className="text-[10px] text-muted-foreground">not enough data that day</span>;
  if (result.position === 'insufficient') {
    return <span className="text-[10px] text-muted-foreground" title={`Needs 7 recent finished days to compare with (${result.n} so far)`}>not enough history to compare</span>;
  }
  const range = `${fmt(result.p25 ?? 0)}–${fmt(result.p75 ?? 0)}`;
  const text = result.position === 'within' ? 'within your typical range' : result.position === 'above' ? '↑ above your typical range' : '↓ below your typical range';
  return (
    <span className="text-[10px] font-medium text-foreground" title={`Typical${qualifier ? ` ${qualifier}` : ''}: ${range} (middle half of your last ${result.n} days)`}>
      {text}{qualifier ? ` ${qualifier}` : ''}
    </span>
  );
};
