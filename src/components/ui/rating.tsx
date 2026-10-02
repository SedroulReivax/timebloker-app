import React, { useRef } from 'react';
import { ENERGY_LABELS, ENERGY_MAX } from '../../lib/energy';

// ─── Energy rating: numbered circles 1..max ──────────────────────────────────
// A radiogroup of numbered circles. Tapping the selected value again clears it; arrow keys move the
// selection (and the focus) like a native radio group. Circles up to the selected value are tinted so
// the row reads as a scale, not seven unrelated buttons.


interface EnergyRatingProps {
  value: number | null;
  onChange: (v: number | null) => void;
  max?: number;
  labels?: Record<number, string>;
  ariaLabel?: string;
  disabled?: boolean;
}

export const EnergyRating: React.FC<EnergyRatingProps> = ({
  value, onChange, max = ENERGY_MAX, labels = ENERGY_LABELS, ariaLabel = 'Energy', disabled = false,
}) => {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const values = Array.from({ length: max }, (_, i) => i + 1);

  const move = (to: number) => {
    const v = Math.min(max, Math.max(1, to));
    onChange(v);
    refs.current[v - 1]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const cur = value ?? 0;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); move(cur + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); move(cur <= 1 ? 1 : cur - 1); }
    else if (e.key === 'Home') { e.preventDefault(); move(1); }
    else if (e.key === 'End') { e.preventDefault(); move(max); }
  };

  return (
    <div className="inline-block">
      <div className="flex gap-1 sm:gap-1.5" role="radiogroup" aria-label={ariaLabel} onKeyDown={onKeyDown}>
        {values.map((v) => {
          const on = value === v;
          const within = value !== null && v <= value;
          // roving tabindex: only the selected circle (or the first, when nothing is selected) is tabbable
          const tabbable = value === null ? v === 1 : on;
          return (
            <button
              key={v}
              ref={(el) => { refs.current[v - 1] = el; }}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`${v} of ${max}${labels[v] ? `, ${labels[v]}` : ''}`}
              title={labels[v]}
              tabIndex={tabbable ? 0 : -1}
              disabled={disabled}
              onClick={() => onChange(on ? null : v)}
              className={`w-9 h-9 sm:w-10 sm:h-10 flex-shrink-0 rounded-full border text-sm font-semibold ibm-mono tabular-nums
                flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                disabled:opacity-50
                ${on
                  ? 'bg-primary text-primary-foreground border-primary'
                  : within
                    ? 'bg-primary/15 text-foreground border-primary/40'
                    : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'}`}
            >
              {v}
            </button>
          );
        })}
      </div>
      <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
        <span>1 · {labels[1]}</span>
        <span>{labels[max]} · {max}</span>
      </div>
    </div>
  );
};
