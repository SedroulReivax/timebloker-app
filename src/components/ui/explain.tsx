import React, { useEffect, useRef, useState } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { explainLabel, type Explanation } from '../../lib/explain';

// Hover explanations: what a number is, how it is calculated, and what to make of it (lib/explain.ts).
// Mouse: opens after a short pause on the card or tile and stays open while the pointer is over it or the panel.
// Touch has no hover, so cards also open it from their (i) button (see Section).

const OPEN_DELAY = 350;
const CLOSE_DELAY = 150;

export function useHoverIntent() {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  useEffect(() => clear, []);
  const enter = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    clear();
    if (!open) timer.current = setTimeout(() => setOpen(true), OPEN_DELAY);
  };
  const leave = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    clear();
    timer.current = setTimeout(() => setOpen(false), CLOSE_DELAY);
  };
  const close = () => { clear(); setOpen(false); };
  return { open, setOpen, enter, leave, close };
}

export type HoverIntent = ReturnType<typeof useHoverIntent>;

const ExplainBody: React.FC<{ title: string; explain: Explanation; note?: string }> = ({ title, explain, note }) => (
  <div className="space-y-2">
    <div className="text-[13px] font-semibold text-foreground">{title}</div>
    <p className="text-muted-foreground">{explain.what}</p>
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">How it's calculated</div>
      <p className="ibm-mono text-[11px] leading-relaxed mt-0.5">{explain.how}</p>
    </div>
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">What to make of it</div>
      <p className="mt-0.5">{explain.read}</p>
    </div>
    {note && <p className="text-[11px] text-muted-foreground border-t border-border pt-2">{note}</p>}
  </div>
);

interface ExplainPopoverProps {
  hover: HoverIntent;
  title: string;
  explain: Explanation;
  /** card-specific detail (the card's own hint), shown under the explanation */
  note?: string;
  /** the element the panel is attached to; it must forward a ref (a DOM element does) */
  children: React.ReactElement;
}

export const ExplainPopover: React.FC<ExplainPopoverProps> = ({ hover, title, explain, note, children }) => (
  <PopoverPrimitive.Root open={hover.open} onOpenChange={hover.setOpen}>
    <PopoverPrimitive.Anchor asChild>{children}</PopoverPrimitive.Anchor>
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        side="bottom"
        align="start"
        sideOffset={6}
        collisionPadding={12}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onPointerEnter={hover.enter}
        onPointerLeave={hover.leave}
        className="z-50 w-80 max-w-[calc(100vw-24px)] rounded-xl border border-border bg-popover text-popover-foreground shadow-lg p-3.5 text-xs leading-snug animate-in fade-in-0 zoom-in-95"
      >
        <ExplainBody title={title} explain={explain} note={note} />
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  </PopoverPrimitive.Root>
);

/** Hover explanation on any single element (review rows, small boxes): looked up by label unless given. */
export const Explained: React.FC<{ label: string; explain?: Explanation; children: React.ReactElement<React.HTMLAttributes<HTMLElement>> }> = ({ label, explain, children }) => {
  const hover = useHoverIntent();
  const e = explain ?? explainLabel(label);
  if (!e) return children;
  return (
    <ExplainPopover hover={hover} title={label} explain={e}>
      {React.cloneElement(children, { onPointerEnter: hover.enter, onPointerLeave: hover.leave })}
    </ExplainPopover>
  );
};
