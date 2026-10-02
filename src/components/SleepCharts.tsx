import React from 'react';
import { format, getDay, parseISO } from 'date-fns';
import { formatDur, formatRel, type Night } from '../lib/sleepAnalysis';

/** Circular progress with a centre label. */
export const Ring: React.FC<{
  value: number; // 0-1
  size?: number;
  stroke?: number;
  color?: string;
  children?: React.ReactNode;
  label: string;
}> = ({ value, size = 132, stroke = 10, color = 'hsl(var(--primary))', children, label }) => {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - v)} style={{ transition: 'stroke-dashoffset 600ms ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
};

/** Colour for a 0-100 score. */
export const scoreColor = (score: number): string =>
  score >= 80 ? 'hsl(142 71% 45%)' : score >= 60 ? 'hsl(45 93% 47%)' : 'hsl(0 72% 55%)';

interface RibbonProps {
  /** chronological */
  nights: Night[];
  /** clock band to highlight (relative minutes since 18:00) */
  targetBedRel?: number | null;
  targetWakeRel?: number | null;
}

const AXIS = [
  { rel: 0, label: '6p' }, { rel: 180, label: '9p' }, { rel: 360, label: '12a' }, { rel: 540, label: '3a' }, { rel: 720, label: '6a' },
  { rel: 900, label: '9a' }, { rel: 1080, label: '12p' }, { rel: 1260, label: '3p' }, { rel: 1440, label: '6p' },
];

/**
 * One row per night on a shared 18:00 -> 18:00 axis: main sleep, awake gaps inside it, and naps.
 * Makes irregular bed/wake times, short nights and naps visible at a glance.
 */
export const SleepRibbon: React.FC<RibbonProps> = ({ nights, targetBedRel, targetWakeRel }) => {
  const rows = [...nights].reverse(); // latest first
  const left = 74, right = 64, W = 1000, rowH = 20, top = 22;
  const plotW = W - left - right;
  const x = (rel: number) => left + (Math.max(0, Math.min(1440, rel)) / 1440) * plotW;
  const H = top + rows.length * rowH + 6;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Sleep timeline: one row per night from 6 PM to 6 PM">
      {targetBedRel != null && targetWakeRel != null && targetWakeRel > targetBedRel && (
        <rect x={x(targetBedRel)} y={top - 4} width={x(targetWakeRel) - x(targetBedRel)} height={rows.length * rowH + 4} fill="hsl(var(--primary))" opacity={0.07} />
      )}
      {AXIS.map((a) => (
        <g key={a.rel}>
          <line x1={x(a.rel)} x2={x(a.rel)} y1={top - 4} y2={H - 2} stroke="hsl(var(--border))" strokeDasharray="2 4" />
          <text x={x(a.rel)} y={12} textAnchor="middle" fontSize={11} fill="hsl(var(--muted-foreground))">{a.label}</text>
        </g>
      ))}
      {rows.map((n, i) => {
        const y = top + i * rowH;
        const wd = getDay(parseISO(n.wakeDate));
        const weekend = wd === 0 || wd === 6;
        return (
          <g key={n.nightDate}>
            {weekend && <rect x={0} y={y - 2} width={W} height={rowH} fill="hsl(var(--muted))" opacity={0.35} />}
            <text x={left - 8} y={y + 12} textAnchor="end" fontSize={11} fill="hsl(var(--muted-foreground))">{format(parseISO(n.wakeDate), 'EEE d')}</text>
            {n.main ? (
              <>
                <rect x={x(n.main.startRel)} y={y} width={Math.max(2, x(n.main.endRel) - x(n.main.startRel))} height={rowH - 6} rx={4} fill="hsl(var(--primary))" opacity={0.85}>
                  <title>{`${formatRel(n.main.startRel)} – ${formatRel(n.main.endRel)} · ${formatDur(n.main.sleepMinutes)}${n.main.wakeUps ? ` · ${n.main.wakeUps} wake-up${n.main.wakeUps > 1 ? 's' : ''}` : ''}`}</title>
                </rect>
                {n.main.gaps.map((g, k) => (
                  <rect key={k} x={x(g.startRel)} y={y} width={Math.max(1.5, x(g.endRel) - x(g.startRel))} height={rowH - 6} fill="hsl(var(--card))" />
                ))}
                {n.naps.map((p, k) => (
                  <rect key={k} x={x(p.startRel)} y={y} width={Math.max(3, x(p.endRel) - x(p.startRel))} height={rowH - 6} rx={3} fill="#f59e0b">
                    <title>{`Nap ${formatRel(p.startRel)} – ${formatRel(p.endRel)} · ${formatDur(p.sleepMinutes)}`}</title>
                  </rect>
                ))}
                <text x={W - right + 8} y={y + 12} fontSize={11} fill="hsl(var(--foreground))">{formatDur(n.totalMinutes)}</text>
              </>
            ) : (
              <text x={x(360)} y={y + 12} fontSize={10} textAnchor="middle" fill="hsl(var(--muted-foreground))" opacity={0.6}>no sleep tracked</text>
            )}
          </g>
        );
      })}
    </svg>
  );
};
