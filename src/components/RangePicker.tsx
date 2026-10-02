import React from 'react';
import { isToday } from 'date-fns';
import { INSIGHT_RANGES, type InsightRange } from '../lib/insights';

export interface RangeState {
  range: InsightRange;
  setRange: (r: InsightRange) => void;
}

/**
 * Range picker for the Analysis tabs: Day · 7d · 30d · 90d · 6m · 1y. "Day" is an extra option that shows the
 * selected day on its own ("Today" when it is today); the other ranges are unchanged. `exclude` keeps a tab's
 * existing set of ranges (Focus never offered 7d).
 */
export const RangePicker: React.FC<{ range: InsightRange; onChange: (r: InsightRange) => void; selectedDate: Date; exclude?: InsightRange[] }> = ({ range, onChange, selectedDate, exclude = [] }) => {
  const options: { id: InsightRange; label: string }[] = [
    { id: '1d', label: isToday(selectedDate) ? 'Today' : 'Day' },
    ...INSIGHT_RANGES.filter((r) => !exclude.includes(r.id)),
  ];
  return (
    <div className="flex gap-1.5 flex-wrap" role="tablist" aria-label="Range">
      {options.map((r) => (
        <button
          key={r.id}
          role="tab"
          aria-selected={range === r.id}
          onClick={() => onChange(r.id)}
          className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${range === r.id ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground border-border hover:bg-accent'}`}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
};
