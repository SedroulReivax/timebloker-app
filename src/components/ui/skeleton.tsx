import React from 'react';

/** Placeholder that matches the analysis pages (tiles, then cards) while a lazy chunk loads. */
export const PageSkeleton: React.FC<{ tiles?: number; cards?: number }> = ({ tiles = 4, cards = 2 }) => (
  <div className="max-w-5xl 2xl:max-w-7xl mx-auto w-full space-y-4 animate-pulse" aria-busy="true" aria-label="Loading">
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {Array.from({ length: tiles }, (_, i) => <div key={i} className="h-[84px] rounded-2xl bg-muted/60" />)}
    </div>
    {Array.from({ length: cards }, (_, i) => <div key={i} className="h-56 rounded-2xl bg-muted/60" />)}
  </div>
);
