import React from 'react';

interface TimeBlockCellProps {
  idx: number;
  color: string | null;
  emoji: string | null;
  isPast: boolean;
  isCurrent: boolean;
  isSelected: boolean;
  isHoverPreview: boolean;
  /** Roving tabindex: only the keyboard cursor cell is tabbable. */
  isCursor: boolean;
  title: string;
  onMouseDown: (idx: number) => void;
  onMouseEnter: (idx: number) => void;
  onMouseLeave: () => void;
  onFocusCell: (idx: number) => void;
}

/**
 * One 10-minute block. Memoized: props are primitives plus stable callbacks, so changing one block's
 * selection/assignment re-renders only the cells whose visual state changed (not all 144).
 */
export const TimeBlockCell = React.memo(function TimeBlockCell({
  idx, color, emoji, isPast, isCurrent, isSelected, isHoverPreview, isCursor, title,
  onMouseDown, onMouseEnter, onMouseLeave, onFocusCell,
}: TimeBlockCellProps) {
  const isAssigned = !!color;
  let style: React.CSSProperties = {};
  let classes = 'w-[var(--cell)] h-[var(--cell)] rounded-full flex items-center justify-center transition-all relative cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background ';

  if (isAssigned) {
    if (isPast) {
      style = { backgroundColor: color!, border: `2px solid ${color}` };
      classes += ' opacity-80';
    } else {
      style = { borderColor: color!, borderWidth: '3.5px' };
      classes += ' bg-transparent';
    }
  } else if (isPast) {
    classes += ' bg-muted scale-[0.65]';
  } else {
    classes += ' border-[1.5px] border-border/70 bg-transparent hover:border-border hover:scale-105';
  }

  if (isSelected) classes += ' ring-2 ring-primary ring-offset-2 ring-offset-background scale-110 z-10';
  else if (isHoverPreview) classes += ' ring-2 ring-muted ring-offset-1 ring-offset-background opacity-70 z-10';

  if (isCurrent && !isAssigned) classes += ' ring-1 ring-destructive ring-offset-1';

  return (
    <div className="flex items-center justify-center" style={{ height: 'var(--cell)' }}>
      <div
        data-idx={idx}
        role="button"
        tabIndex={isCursor ? 0 : -1}
        aria-pressed={isSelected}
        aria-label={title + (isSelected ? ', selected' : '')}
        onMouseDown={() => onMouseDown(idx)}
        onMouseEnter={() => onMouseEnter(idx)}
        onMouseLeave={onMouseLeave}
        onFocus={() => onFocusCell(idx)}
        className={classes}
        style={style}
        title={title}
      >
        {!isPast && !isAssigned && !isCurrent && <div className="w-1 h-1 rounded-full bg-border/40 pointer-events-none" />}
        {isCurrent && !isAssigned && <div className="w-1.5 h-1.5 rounded-full bg-destructive animate-pulse pointer-events-none" />}
        {isAssigned && emoji && <span className="text-sm select-none pointer-events-none">{emoji}</span>}
      </div>
    </div>
  );
});
