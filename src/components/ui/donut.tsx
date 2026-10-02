import React from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';
import { ANIM } from './chart';

export interface DonutSlice { key: string; name: string; value: number; color: string }

/**
 * A donut with its total (or any label) in the middle. Slices under 1% are still drawn but never labelled, and
 * the tooltip shows the value formatted by `fmt` with its share.
 */
export const Donut: React.FC<{
  slices: DonutSlice[];
  fmt: (v: number) => string;
  centre?: React.ReactNode;
  centreSub?: string;
  size?: string;
  label?: string;
}> = ({ slices, fmt, centre, centreSub, size = 'w-36 h-36 sm:w-40 sm:h-40', label = 'Share' }) => {
  const total = slices.reduce((a, s) => a + s.value, 0);
  if (total <= 0) return null;
  return (
    <div className={`relative flex-shrink-0 ${size}`} role="img" aria-label={`${label}: ${slices.map((s) => `${s.name} ${Math.round((s.value / total) * 100)}%`).join(', ')}`}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={slices} dataKey="value" nameKey="name" innerRadius="64%" outerRadius="94%" paddingAngle={slices.length > 1 ? 2 : 0} cornerRadius={4} stroke="none" startAngle={90} endAngle={-270} {...ANIM}>
            {slices.map((s) => <Cell key={s.key} fill={s.color} />)}
          </Pie>
          <RechartsTooltip formatter={(v, n) => [`${fmt(Number(v))} · ${Math.round((Number(v) / total) * 100)}%`, n]} />
        </PieChart>
      </ResponsiveContainer>
      {centre !== undefined && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="font-display text-lg font-semibold leading-none tabular-nums">{centre}</span>
          {centreSub && <span className="text-[10px] text-muted-foreground mt-1">{centreSub}</span>}
        </div>
      )}
    </div>
  );
};

/** Donut plus a legend list: the common "where did it go" layout. Stacks on phones, side by side from sm. */
export const DonutWithLegend: React.FC<React.ComponentProps<typeof Donut> & { limit?: number }> = ({ limit = 8, ...props }) => {
  const total = props.slices.reduce((a, s) => a + s.value, 0);
  if (total <= 0) return null;
  const shown = [...props.slices].sort((a, b) => b.value - a.value).slice(0, limit);
  return (
    <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
      <Donut {...props} />
      <ul className="space-y-1.5 text-sm flex-1 w-full min-w-0">
        {shown.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
            <span className="flex-1 truncate">{s.name}</span>
            <span className="ibm-mono text-xs text-muted-foreground">{props.fmt(s.value)} · {Math.round((s.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

/** A small progress ring (no chart library): for goals and other "how far along" numbers. */
export const Ring: React.FC<{ pct: number; size?: number; stroke?: number; color?: string; children?: React.ReactNode }> = ({ pct, size = 56, stroke = 6, color = 'hsl(var(--primary))', children }) => {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, pct));
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${Math.round(p * 100)}%`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - p)} style={{ transition: 'stroke-dashoffset 600ms ease-out' }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold tabular-nums">{children ?? `${Math.round(p * 100)}%`}</div>
    </div>
  );
};
