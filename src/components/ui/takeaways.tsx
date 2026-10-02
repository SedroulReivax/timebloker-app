import React from 'react';
import { ArrowRight } from 'lucide-react';
import type { Takeaway } from '../../lib/takeaways';
import { openSection } from './detail';

interface TakeawaysProps {
  items: Takeaway[];
  loading?: boolean;
  className?: string;
}

/**
 * The first thing on every Analysis tab: what the numbers below say, in a few sentences. Each sentence opens
 * the card that explains it. Shows a loading line instead of sentences built from half-loaded data.
 */
export const Takeaways: React.FC<TakeawaysProps> = ({ items, loading, className = '' }) => (
  <section aria-label="In short" className={`bg-card border border-border rounded-2xl shadow-sm px-4 md:px-5 py-3.5 ${className}`}>
    <h3 className="text-[13px] font-semibold text-foreground mb-2">In short</h3>
    {loading ? (
      <p className="text-sm text-muted-foreground">Still loading…</p>
    ) : (
      <ul className="space-y-1.5">
        {items.map((t, i) => (
          <li key={i} className="text-sm leading-snug">
            {t.to ? (
              <button onClick={() => openSection(t.to!)} className="group text-left hover:text-primary transition-colors">
                {t.text}
                <ArrowRight size={12} className="inline ml-1 -mt-0.5 text-muted-foreground group-hover:text-primary" aria-hidden />
              </button>
            ) : (
              t.text
            )}
          </li>
        ))}
      </ul>
    )}
  </section>
);
