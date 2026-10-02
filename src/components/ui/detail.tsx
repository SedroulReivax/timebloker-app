import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { ChevronDown, Info } from 'lucide-react';
import { explainLabel, explainSection, type Explanation } from '../../lib/explain';
import { ExplainPopover, useHoverIntent } from './explain';

// ─── Nerd mode ───────────────────────────────────────────────────────────────
// Simple mode shows each page's headline and core charts; detail sections sit collapsed one tap away.
// Nerd mode opens every detail section and shows every hint inline. "Start in nerd mode" is a per-device
// preference (localStorage), so it needs no database column.

const START_KEY = 'blockday.startInNerd';

const readStart = (): boolean => {
  try { return localStorage.getItem(START_KEY) === '1'; } catch { return false; }
};
const writeStart = (on: boolean) => {
  try { if (on) localStorage.setItem(START_KEY, '1'); else localStorage.removeItem(START_KEY); } catch { /* storage blocked */ }
};

interface NerdModeValue {
  nerd: boolean;
  setNerd: (on: boolean) => void;
  startInNerd: boolean;
  setStartInNerd: (on: boolean) => void;
}

const NerdModeContext = createContext<NerdModeValue>({ nerd: false, setNerd: () => undefined, startInNerd: false, setStartInNerd: () => undefined });

export const NerdModeProvider: React.FC<{ children: React.ReactNode; initial?: boolean }> = ({ children, initial }) => {
  const [startInNerd, setStart] = useState(readStart);
  const [nerd, setNerd] = useState(() => initial ?? readStart());
  const setStartInNerd = (on: boolean) => { writeStart(on); setStart(on); if (on) setNerd(true); };
  return <NerdModeContext.Provider value={{ nerd, setNerd, startInNerd, setStartInNerd }}>{children}</NerdModeContext.Provider>;
};

export const useNerdMode = () => useContext(NerdModeContext);

// ─── Opening a section from anywhere on the page ─────────────────────────────

const OPEN_EVENT = 'blockday:open-section';
/** ids asked for before their Section mounted (e.g. still inside a LazyMount); the Section opens itself on mount */
const pendingOpen = new Set<string>();

/** Open the detail section with this id (if collapsed) and scroll it into view. */
export const openSection = (id: string) => {
  pendingOpen.add(id);
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
  // wait for lazy sections to mount and the body to render, then scroll
  let tries = 0;
  const scroll = () => {
    const el = document.getElementById(id);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (++tries < 20) setTimeout(scroll, 50);
  };
  requestAnimationFrame(() => requestAnimationFrame(scroll));
  setTimeout(() => pendingOpen.delete(id), 2000);
};

// ─── Section: the one card used by every page ────────────────────────────────

interface SectionProps {
  id?: string;
  title: string;
  hint?: string;
  /** one-line headline shown next to the title while a detail section is collapsed */
  summary?: React.ReactNode;
  /** detail sections start collapsed in simple mode; core sections are always open */
  detail?: boolean;
  /** start a detail section open (e.g. a reflection that already has text) */
  defaultOpen?: boolean;
  /** controls shown at the right of the header (tabs, toggles) */
  actions?: React.ReactNode;
  className?: string;
  /** hover explanation; defaults to lib/explain.ts's entry for this id (or title). null turns it off. */
  explain?: Explanation | null;
  children: React.ReactNode;
}

export const Section: React.FC<SectionProps> = ({ id, title, hint, summary, detail = false, defaultOpen = false, actions, className = '', explain, children }) => {
  const { nerd } = useNerdMode();
  const [open, setOpen] = useState(defaultOpen);
  const [showHint, setShowHint] = useState(false);
  const expanded = !detail || nerd || open;
  const explanation = explain === null ? undefined : explain ?? explainSection(id) ?? explainSection(title);
  const hover = useHoverIntent();

  useEffect(() => {
    if (!id) return;
    if (pendingOpen.has(id)) { pendingOpen.delete(id); setOpen(true); }
    const onOpen = (e: Event) => { if ((e as CustomEvent<string>).detail === id) setOpen(true); };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, [id]);

  const heading = <h3 className="text-[13px] font-semibold text-foreground truncate">{title}</h3>;

  const header = (
      <div
        className={`flex items-center gap-2 px-4 md:px-5 ${expanded ? 'pt-4' : 'py-3'}`}
        onPointerEnter={explanation ? hover.enter : undefined}
        onPointerLeave={explanation ? hover.leave : undefined}
      >
        {detail && !nerd ? (
          <button
            onClick={() => setOpen((o) => !o)}
            aria-expanded={expanded}
            className="flex-1 min-w-0 flex items-center gap-2 text-left min-h-[28px] group"
          >
            <ChevronDown size={14} className={`flex-shrink-0 text-muted-foreground transition-transform duration-200 ${expanded ? '' : '-rotate-90'}`} />
            {heading}
            {!expanded && summary && <span className="ml-auto pl-2 text-xs text-muted-foreground truncate ibm-mono">{summary}</span>}
          </button>
        ) : (
          <div className="flex-1 min-w-0 flex items-center gap-2 min-h-[28px]">{heading}</div>
        )}
        {(explanation || (expanded && hint && !nerd)) && (
          <button
            // with an explanation the (i) opens it (the only way in on touch screens); otherwise it shows the hint inline
            onClick={() => (explanation ? hover.setOpen((o) => !o) : setShowHint((s) => !s))}
            aria-label={`About ${title}`}
            aria-expanded={explanation ? hover.open : showHint}
            className={`flex-shrink-0 p-1 rounded-md transition-colors ${(explanation ? hover.open : showHint) ? 'text-foreground bg-accent' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Info size={13} />
          </button>
        )}
        {expanded && actions && <div className="flex-shrink-0">{actions}</div>}
      </div>
  );

  return (
    <section id={id} className={`bg-card border border-border rounded-2xl shadow-sm scroll-mt-16 ${className}`}>
      {explanation ? (
        <ExplainPopover hover={hover} title={title} explain={explanation} note={hint && !nerd ? hint : undefined}>{header}</ExplainPopover>
      ) : header}
      {expanded && (
        <div className="px-4 md:px-5 pb-4 md:pb-5 animate-in fade-in duration-200">
          {hint && (nerd || showHint) && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
          <div className="mt-3">{children}</div>
        </div>
      )}
    </section>
  );
};

// ─── StatTile: a headline number that opens its detail ───────────────────────

interface StatTileProps {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  hint?: string;
  /** id of the Section this number is explained in */
  to?: string;
  className?: string;
  /** hover explanation; defaults to lib/explain.ts's entry for this label. null turns it off. */
  explain?: Explanation | null;
}

export const StatTile: React.FC<StatTileProps> = ({ label, value, sub, hint, to, className = '', explain }) => {
  const explanation = explain === null ? undefined : explain ?? explainLabel(label);
  const hover = useHoverIntent();
  const body = (
    <>
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className="text-xl md:text-2xl font-bold ibm-mono mt-0.5 tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5 space-y-0.5">{sub}</div>}
    </>
  );
  const base = `bg-card border border-border rounded-2xl p-3.5 md:p-4 shadow-sm text-left min-w-0 ${className}`;
  // with an explanation the hover panel replaces the browser tooltip (the hint goes into the panel)
  const pointer = explanation ? { onPointerEnter: hover.enter, onPointerLeave: hover.leave } : {};
  const tile = to ? (
    <button
      onClick={() => { hover.close(); openSection(to); }}
      title={explanation ? undefined : hint ? `${hint} (tap for details)` : 'Tap for details'}
      className={`${base} hover:border-foreground/30 hover:bg-accent/40 transition-colors`}
      {...pointer}
    >
      {body}
    </button>
  ) : (
    <div className={base} title={explanation ? undefined : hint} {...pointer}>{body}</div>
  );
  return explanation ? (
    <ExplainPopover hover={hover} title={label} explain={explanation} note={hint}>{tile}</ExplainPopover>
  ) : tile;
};

// ─── LazyMount: render children only when near the viewport ──────────────────

export const LazyMount: React.FC<{ children: React.ReactNode; minHeight?: number; rootMargin?: string }> = ({ children, minHeight = 240, rootMargin = '300px' }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (shown || !ref.current) return;
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { setShown(true); io.disconnect(); } }, { rootMargin });
    io.observe(ref.current);
    // a tile asked to open a section that may live in here: mount now
    const onOpen = () => setShown(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => { io.disconnect(); window.removeEventListener(OPEN_EVENT, onOpen); };
  }, [shown, rootMargin]);
  return shown ? <>{children}</> : <div ref={ref} style={{ minHeight }} aria-hidden="true" />;
};
