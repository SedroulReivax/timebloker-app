import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

/**
 * A panel that slides up from the bottom on phones and tablets (thumb reach, safe-area aware) and shows as a small
 * centred panel on desktops. Used for the phone "More" menu, the date and habits panel, and pickers.
 */
export const Sheet: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
  /** keep the title for screen readers only */
  hideTitle?: boolean;
}> = ({ open, onOpenChange, title, children, hideTitle }) => (
  <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content
        aria-describedby={undefined}
        className="fixed z-50 bg-popover text-popover-foreground border border-border shadow-2xl flex flex-col
          inset-x-0 bottom-0 max-h-[85dvh] rounded-t-3xl pb-[var(--safe-b)]
          data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom duration-200
          lg:inset-auto lg:left-1/2 lg:top-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2 lg:w-[420px] lg:max-h-[80dvh] lg:rounded-2xl lg:pb-0 lg:data-[state=open]:slide-in-from-bottom-4 lg:data-[state=open]:zoom-in-95"
      >
        <div className="lg:hidden mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted-foreground/30" aria-hidden />
        <div className={`flex items-center justify-between gap-2 px-5 pt-3 pb-2 ${hideTitle ? 'sr-only' : ''}`}>
          <DialogPrimitive.Title className="font-display text-base font-semibold">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Close className="p-2 -mr-2 rounded-full text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Close">
            <X size={16} />
          </DialogPrimitive.Close>
        </div>
        <div className="overflow-y-auto px-3 pb-4">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>
);
