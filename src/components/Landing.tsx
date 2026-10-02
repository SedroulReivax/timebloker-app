import React, { useEffect, useMemo, useRef, useState } from 'react';
import { addDays, format, subDays } from 'date-fns';
import {
  ArrowRight, BarChart2, BedDouble, Brain, CheckCircle2, Clock, Code2, Download, FileJson, Flame, Gauge, Grid2x2, Info, Keyboard,
  LayoutGrid, ListTodo, Monitor, Palette, Repeat, Scale, Server, Sparkles, Star, Target, Timer, Upload, Zap,
} from 'lucide-react';
import { useTheme } from './ThemeProvider';
import { PeakFocusCard } from './PeakFocusCard';
import { Ring, SleepRibbon, scoreColor } from './SleepCharts';
import { analyzeFocus } from '../lib/focusModel';
import { trendsTakeaways } from '../lib/takeaways';
import { attentionBudget, formatEfficiency, type AttentionActivityRow, type AttentionDailyRow } from '../lib/attention';
import { buildNights, formatDur, getBaseline, getRegularity, getSleepDebt, scoreNight, SCORE_WEIGHTS, type SleepBlock, type SleepScoreParts } from '../lib/sleepAnalysis';

const THEMES = [
  { id: 'theme-stark-white' as const, label: 'Stark White', bg: 'bg-white border border-gray-200' },
  { id: 'theme-stark-black' as const, label: 'Stark Black', bg: 'bg-black border border-white/20' },
  { id: 'theme-solarized-light' as const, label: 'Solaris Light', bg: 'bg-[#fdf6e3] border border-[#eee8d5]' },
  { id: 'theme-solarized-dark' as const, label: 'Solaris Dark', bg: 'bg-[#002b36] border border-[#073642]' },
];

interface LandingProps {
  onLoginClick: () => void;
}

/** The GitHub mark (lucide no longer ships brand logos). */
const GithubMark: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
  </svg>
);

/** Where the source lives; shown in the nav, the open-source section and the footer. */
const REPO_URL = 'https://github.com/SedroulReivax/timebloker';

// ─── Deterministic demo data (so the page always looks the same) ─────────────

const rng = (seed: number) => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
  return ((seed >>> 0) % 10000) / 10000;
};

const C = { sleep: '#6366f1', work: '#3b82f6', admin: '#a855f7', health: '#22c55e', food: '#f59e0b', leisure: '#ec4899' };

/** Colour of a block (0-143) in the hero day, or null when untracked. */
const heroBlock = (i: number): string | null => {
  const h = i / 6;
  if (h < 6.5) return C.sleep;
  if (h < 7) return null;
  if (h < 8) return C.health;
  if (h < 8.5) return C.food;
  if (h < 9) return null;
  if (h < 11) return C.work;
  if (h < 12) return C.admin;
  if (h < 13) return C.food;
  if (h < 15) return C.work;
  if (h < 15.5) return null;
  if (h < 16.5) return C.admin;
  if (h < 17) return null;
  if (h < 18) return C.health;
  if (h < 19) return C.food;
  if (h < 19.5) return null;
  if (h < 22) return C.leisure;
  if (h < 22.5) return null;
  return C.sleep;
};

// ─── Small building blocks ───────────────────────────────────────────────────

const Reveal: React.FC<{ children: React.ReactNode; className?: string; delay?: number }> = ({ children, className = '', delay = 0 }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setShown(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setShown(true); io.disconnect(); } }, { threshold: 0.12 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`transition-all duration-700 ease-out ${shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
};

const Eyebrow: React.FC<{ icon: React.ReactNode; children: React.ReactNode }> = ({ icon, children }) => (
  <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary mb-4">{icon}{children}</div>
);

const Feature: React.FC<{
  id?: string;
  eyebrow: string;
  icon: React.ReactNode;
  title: string;
  body: string;
  bullets: string[];
  visual: React.ReactNode;
  flip?: boolean;
  tint?: boolean;
}> = ({ id, eyebrow, icon, title, body, bullets, visual, flip, tint }) => (
  <section id={id} className={`py-20 md:py-28 ${tint ? 'bg-muted/40' : ''}`}>
    <div className="max-w-[1200px] mx-auto px-6 grid md:grid-cols-2 gap-12 md:gap-16 items-center">
      <Reveal className={flip ? 'md:order-2' : ''}>
        <Eyebrow icon={icon}>{eyebrow}</Eyebrow>
        <h2 className="text-4xl md:text-5xl font-bold tracking-tight leading-[1.05] mb-5">{title}</h2>
        <p className="text-lg text-muted-foreground leading-relaxed mb-6">{body}</p>
        <ul className="space-y-3">
          {bullets.map((b) => (
            <li key={b} className="flex gap-3 text-[15px]">
              <CheckCircle2 size={18} className="text-primary flex-shrink-0 mt-0.5" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </Reveal>
      <Reveal delay={120} className={flip ? 'md:order-1' : ''}>{visual}</Reveal>
    </div>
  </section>
);

const Panel: React.FC<{ children: React.ReactNode; className?: string; title?: string }> = ({ children, className = '', title }) => (
  <div className={`bg-card border border-border rounded-3xl p-5 md:p-6 shadow-xl ${className}`}>
    {title && <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-3">{title}</div>}
    {children}
  </div>
);

// ─── Visuals ─────────────────────────────────────────────────────────────────

/** The real 6x24 grid: filled circles for the past, outlines for what is still ahead. */
const MiniGrid: React.FC<{ nowIdx?: number; cell?: number; animate?: boolean }> = ({ nowIdx = 86, cell = 22, animate = true }) => (
  <div className="flex gap-3" aria-hidden>
    <div className="flex flex-col text-[10px] text-muted-foreground ibm-mono" style={{ width: 30 }}>
      {Array.from({ length: 12 }).map((_, i) => {
        const h = i * 2;
        return <div key={i} className="text-right pr-1" style={{ height: (cell + 8) * 2, paddingTop: 4 }}>{h % 12 === 0 ? 12 : h % 12}{h >= 12 ? 'p' : 'a'}</div>;
      })}
    </div>
    <div className="grid grid-cols-6 gap-x-2 gap-y-2">
      {Array.from({ length: 144 }).map((_, i) => {
        const color = heroBlock(i);
        const past = i < nowIdx;
        const current = i === nowIdx;
        const style: React.CSSProperties = { width: cell, height: cell };
        if (color) {
          if (past) { style.backgroundColor = color; style.border = `2px solid ${color}`; style.opacity = 0.85; }
          else { style.borderColor = color; style.borderWidth = 3; style.borderStyle = 'solid'; }
        }
        if (animate && past) style.animation = `blockFade 500ms ease-out ${Math.min(i * 6, 900)}ms both`;
        return (
          <div
            key={i}
            style={style}
            className={`rounded-full ${!color ? (past ? 'bg-muted scale-[0.6]' : 'border border-border/70') : ''} ${current ? 'ring-2 ring-primary ring-offset-2 ring-offset-card animate-pulse' : ''}`}
          />
        );
      })}
    </div>
  </div>
);

const TaskVisual: React.FC = () => (
  <Panel title="Tasks">
    <div className="space-y-3">
      <div className="rounded-2xl border border-border bg-background p-4">
        <div className="flex items-start gap-3">
          <div className="w-5 h-5 rounded-full border-2 border-muted-foreground/50 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold">Embedded Systems report</div>
            <div className="flex flex-wrap gap-1.5 mt-2 text-[11px]">
              <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">Fri 5:00 PM</span>
              <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Study</span>
            </div>
            <div className="grid grid-cols-4 gap-2 mt-4 text-center">
              {[['Estimated', '2h'], ['Planned', '40m'], ['Tracked', '1h 15m'], ['Focused', '55m']].map(([k, v]) => (
                <div key={k} className="bg-muted rounded-lg py-2">
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{k}</div>
                  <div className="text-sm font-bold ibm-mono">{v}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary" style={{ width: '62%' }} /></div>
            <div className="text-[11px] text-muted-foreground mt-1">62% of the estimate tracked · a measurement, not a grade</div>
          </div>
        </div>
      </div>
      <div className="rounded-2xl border border-border bg-background p-4 flex items-center gap-4">
        <div className="relative w-16 h-16 flex items-center justify-center">
          <svg viewBox="0 0 64 64" className="-rotate-90 w-16 h-16"><circle cx="32" cy="32" r="28" fill="none" stroke="hsl(var(--muted))" strokeWidth="6" /><circle cx="32" cy="32" r="28" fill="none" stroke="hsl(var(--primary))" strokeWidth="6" strokeLinecap="round" strokeDasharray="176" strokeDashoffset="52" /></svg>
          <span className="absolute text-xs font-bold ibm-mono">17:42</span>
        </div>
        <div>
          <div className="text-sm font-semibold flex items-center gap-1.5"><Timer size={14} /> Focus session running</div>
          <div className="text-xs text-muted-foreground">Saved with its real start, end and length, and it tags the blocks it covers.</div>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2 text-[11px]">
        {[['Do', 'bg-red-500/15 text-red-500'], ['Plan', 'bg-blue-500/15 text-blue-500'], ['Delegate', 'bg-yellow-500/15 text-yellow-600'], ['Drop', 'bg-muted text-muted-foreground']].map(([k, c]) => (
          <div key={k} className={`rounded-xl py-3 text-center font-semibold ${c}`}>{k}</div>
        ))}
      </div>
    </div>
  </Panel>
);

/** Insights visual: the real peak-focus model run on a generated 8 weeks of days. */
const useDemoFocus = () =>
  useMemo(() => {
    const r = rng(7);
    const now = new Date();
    const blocks: { date_key: string; block_index: number; activity_id: string }[] = [];
    for (let age = 1; age <= 56; age++) {
      const d = subDays(now, age);
      const wd = d.getDay();
      const key = format(d, 'yyyy-MM-dd');
      const put = (from: number, to: number, a: string) => { for (let i = from; i <= to; i++) blocks.push({ date_key: key, block_index: i, activity_id: a }); };
      if (wd >= 1 && wd <= 5) {
        const start = 54 + Math.round((r() - 0.5) * 4); // ~9:00 +- 20 min
        put(start, start + 11 + Math.round(r() * 3), 'w'); // ~2 hours of deep work
        put(start + 16, start + 24, 'l');
        if (r() > 0.35) put(88 + Math.round(r() * 3), 95 + Math.round(r() * 4), 'w'); // lighter afternoon block
      } else {
        put(66 + Math.round(r() * 6), 90, 'l');
      }
    }
    return analyzeFocus(
      { blocks, activities: [{ id: 'w', category: 'Work' }, { id: 'l', category: 'Leisure' }], sleepIds: new Set() },
      { now }
    );
  }, []);

/** The "In short" card every Analysis tab opens with, written by the real takeaways engine from demo numbers. */
const demoTakeaways = () => trendsTakeaways({
  topCategory: { name: 'Work', minutes: 2580 },
  untrackedPct: 22,
  trackedPerDay: 8 * 60 + 40,
  deepPerDay: 125,
  productivityScore: 0.46,
  changes: {
    tracked: { current: 520, previous: 470, delta: 50, lo: 18, hi: 80, direction: 'up', enough: true, nCurrent: 14, nPrevious: 14 },
    deep: { current: 125, previous: 118, delta: 7, lo: -12, hi: 26, direction: 'flat', enough: true, nCurrent: 14, nPrevious: 14 },
    productivity: null,
  },
  attention: { configured: false, total: 0, value: 0, efficiency: null },
  tasksDone: 23,
  tasksOpen: 9,
});

const InsightsVisual: React.FC = () => {
  const analysis = useDemoFocus();
  const takeaways = useMemo(demoTakeaways, []);
  return (
    <div className="space-y-4">
      <Panel title="In short · last 30 days">
        <ul className="space-y-2">
          {takeaways.map((t) => (
            <li key={t.text} className="text-sm leading-snug flex gap-2"><ArrowRight size={14} className="text-primary flex-shrink-0 mt-0.5" />{t.text}</li>
          ))}
        </ul>
      </Panel>
      <div className="grid grid-cols-3 gap-3">
        {[['Tracked / day', '8h 40m', '↑ 50m/day vs before'], ['Logged', '78%', 'of elapsed time'], ['Switches', '2.1 /h', 'between activities']].map(([k, v, s]) => (
          <div key={k} className="relative bg-card border border-border rounded-2xl p-3 shadow-sm">
            <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">{k === 'Logged' && <Gauge size={11} />}{k}</div>
            <div className="text-xl font-bold ibm-mono mt-0.5">{v}</div>
            <div className="text-[10px] text-muted-foreground">{s}</div>
            {k === 'Logged' && (
              <div className="absolute left-2 right-2 top-full mt-2 z-10 rounded-xl border border-border bg-popover p-2.5 text-[10px] leading-snug shadow-lg hidden sm:block">
                <div className="font-semibold flex items-center gap-1"><Info size={10} /> Hover any number</div>
                <div className="ibm-mono text-muted-foreground mt-1">Logged % = tracked ÷ elapsed × 100</div>
                <div className="mt-1">A data-quality number, not a productivity one.</div>
              </div>
            )}
          </div>
        ))}
      </div>
      <Panel title="Peak focus window · computed live on demo data" className="sm:mt-16">
        <PeakFocusCard analysis={analysis} />
      </Panel>
    </div>
  );
};

/** Attention vs value, from the real attention engine over a demo week. */
const useDemoAttention = () =>
  useMemo(() => {
    const keys = Array.from({ length: 7 }, (_, i) => format(subDays(new Date(), 7 - i), 'yyyy-MM-dd'));
    // minutes, multiplier, focus demand (0-5) per activity per day; attention = minutes x demand / 5
    const plan: [string, number, number, number][] = [['code', 150, 0.9, 5], ['study', 90, 0.6, 3], ['chat', 60, 0, 3], ['scroll', 50, -0.6, 2]];
    const activity: AttentionActivityRow[] = [];
    const daily: AttentionDailyRow[] = [];
    keys.forEach((k, i) => {
      let value = 0, attention = 0, judged = 0;
      for (const [id, min, mult, demand] of plan) {
        const m = id === 'scroll' ? min + (i % 3) * 20 : min;
        activity.push({ date_key: k, activity_id: id, judged_minutes: m, productivity_points: m * mult, focus_demand_points: (m * demand) / 5 });
        value += m * mult; attention += (m * demand) / 5; judged += m;
      }
      daily.push({ date_key: k, elapsed_minutes: 1440, judged_minutes: judged, productivity_points: value, attention_points: attention, attention_efficiency: value / attention });
    });
    return attentionBudget(daily, activity, keys);
  }, []);

const ATTN_NAMES: Record<string, string> = { code: 'Coding', study: 'Lectures', chat: 'Group chat', scroll: 'Scrolling' };
const ATTN_COLORS = { valuable: 'var(--attn-valuable)', neutral: 'var(--attn-neutral)', costly: 'var(--attn-costly)' } as const;

const LeaksVisual: React.FC = () => {
  const b = useDemoAttention();
  return (
    <div className="space-y-4">
      <Panel title="Attention vs value · this week">
        <div className="grid grid-cols-3 gap-2 text-center">
          {[['Attention spent', `${Math.round(b.total)} pts`], ['Value', `+${Math.round(b.value)} pts`], ['Efficiency', b.efficiency !== null ? formatEfficiency(b.efficiency) : '—']].map(([k, v]) => (
            <div key={k} className="rounded-xl border border-border bg-background py-2.5">
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{k}</div>
              <div className="text-base font-bold ibm-mono">{v}</div>
            </div>
          ))}
        </div>
        <ul className="mt-4 space-y-1.5 text-xs">
          {b.consumers.map((c) => (
            <li key={c.activityId} className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: ATTN_COLORS[c.cls] }} />
              <span className="flex-1">{ATTN_NAMES[c.activityId]}</span>
              <span className="text-[10px] text-muted-foreground">{c.cls}</span>
              <span className="ibm-mono w-10 text-right">{c.sharePct}%</span>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="What leads to waste">
        <ul className="space-y-2 text-sm">
          {[['After group chat', '41% of the time', 'within 20 minutes'], ['First thing after waking', '6 stretches', 'median 35m'], ['Back to real work', 'after ~25m', 'median return time']].map(([k, v, s]) => (
            <li key={k} className="flex items-baseline justify-between gap-3">
              <span>{k}</span>
              <span className="text-right"><span className="font-semibold ibm-mono">{v}</span> <span className="text-[11px] text-muted-foreground">{s}</span></span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
};

/** Sleep visual: the real engine over 14 generated nights. */
const useDemoSleep = () =>
  useMemo(() => {
    const r = rng(21);
    const today = new Date();
    const dates: string[] = [];
    const blocks: SleepBlock[] = [];
    for (let i = 14; i >= 1; i--) {
      const night = subDays(today, i);
      const key = format(night, 'yyyy-MM-dd');
      const wakeKey = format(addDays(night, 1), 'yyyy-MM-dd');
      dates.push(key);
      const weekend = [0, 6].includes(addDays(night, 1).getDay());
      const bed = 138 + Math.round((r() - 0.5) * 8) + (weekend ? 6 : 0) - (i % 5 === 0 ? 0 : 0);
      const wake = 42 + Math.round((r() - 0.4) * 8) + (weekend ? 6 : 0);
      const gapAt = r() > 0.6 ? 12 + Math.round(r() * 12) : -1;
      for (let b = Math.min(bed, 143); b < 144; b++) blocks.push({ date_key: key, block_index: b });
      for (let b = 0; b < wake; b++) if (!(gapAt >= 0 && b >= gapAt && b < gapAt + 3)) blocks.push({ date_key: wakeKey, block_index: b });
      if (i % 4 === 0) for (let b = 84; b < 87; b++) blocks.push({ date_key: wakeKey, block_index: b }); // a short nap
    }
    const logs: Record<string, { quality: number }> = {};
    dates.forEach((d) => { logs[d] = { quality: 3 + Math.round(r() * 2) }; });
    const nights = buildNights(blocks, dates, logs);
    const base = getBaseline(nights);
    return { nights, scores: nights.map((n) => scoreNight(n, 480, base)), debt: getSleepDebt(nights, 480), reg: getRegularity(nights) };
  }, []);

const PART_LABEL: Record<keyof SleepScoreParts, string> = { duration: 'Duration', continuity: 'Continuity', regularity: 'Regularity', rating: 'Your rating' };

const SleepVisual: React.FC = () => {
  const { nights, scores, debt, reg } = useDemoSleep();
  const last = nights[nights.length - 1];
  const score = scores[scores.length - 1];
  return (
    <div className="space-y-4">
      <Panel>
        <div className="flex gap-5 items-center">
          <Ring value={last.totalMinutes / 480} size={112} stroke={9} color={score ? scoreColor(score.score) : undefined} label="Sleep last night">
            <div className="text-xl font-bold ibm-mono leading-none">{formatDur(last.totalMinutes)}</div>
            <div className="text-[10px] text-muted-foreground mt-1">of 8h</div>
          </Ring>
          {score && (
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 mb-2"><span className="text-3xl font-bold ibm-mono" style={{ color: scoreColor(score.score) }}>{score.score}</span><span className="text-[11px] text-muted-foreground">score, every part visible</span></div>
              <ul className="space-y-1">
                {(Object.keys(score.parts) as (keyof SleepScoreParts)[]).map((k) => (
                  <li key={k} className="flex items-center gap-2 text-[11px]">
                    <span className="w-20 text-muted-foreground">{PART_LABEL[k]}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">{score.parts[k] !== null && <div className="h-full bg-primary" style={{ width: `${Math.round(score.parts[k] as number)}%` }} />}</div>
                    <span className="w-8 text-right text-muted-foreground">{SCORE_WEIGHTS[k]}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Panel>
      <Panel title="Every night, 6 PM to 6 PM">
        <SleepRibbon nights={nights.slice(-10)} targetBedRel={300} targetWakeRel={780} />
      </Panel>
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-card border border-border rounded-2xl p-3 shadow-sm"><div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Sleep debt</div><div className="text-xl font-bold ibm-mono">{debt.netMinutes ? formatDur(debt.netMinutes) : 'None'}</div><div className="text-[10px] text-muted-foreground">last {debt.nights} nights</div></div>
        <div className="bg-card border border-border rounded-2xl p-3 shadow-sm"><div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Regularity</div><div className="text-xl font-bold ibm-mono">{reg.score ?? '—'}</div><div className="text-[10px] text-muted-foreground">bedtime ±{Math.round(reg.bedSdMin ?? 0)} min</div></div>
      </div>
    </div>
  );
};

const DayVisual: React.FC = () => {
  const rows: [string, string, string, string][] = [
    ['9:00 – 10:00 AM', 'Embedded Systems report', 'Study', C.work],
    ['10:00 – 10:20 AM', 'Untracked', '', 'hsl(var(--border))'],
    ['10:20 – 11:10 AM', 'Linear algebra problem set', 'Study', C.work],
    ['11:10 AM – 12:00 PM', 'Inbox and admin', 'Admin', C.admin],
    ['5:00 – 6:00 PM', 'Gym', 'Health', C.health],
  ];
  return (
    <Panel title="Today, reconstructed">
      <ol className="space-y-1.5">
        {rows.map(([t, name, act, color], i) => (
          <li key={i} className={`flex gap-3 items-stretch text-sm rounded-lg px-2 py-1.5 ${act ? '' : 'text-muted-foreground'}`}>
            <span className="ibm-mono text-[11px] w-32 flex-shrink-0 pt-0.5">{t}</span>
            <span className="w-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
            <div className="min-w-0"><div className="font-medium truncate">{name}</div>{act && <div className="text-[11px] text-muted-foreground">{act}</div>}</div>
          </li>
        ))}
      </ol>
      <div className="mt-4 border-t border-border pt-3 grid grid-cols-2 gap-2 text-[11px]">
        {[['What did I complete?', '2 tasks'], ['Most time on', 'Study · 3h 10m'], ['Left untracked', '2h 30m'], ['Move to tomorrow', '1 task due today']].map(([k, v]) => (
          <div key={k}><div className="text-muted-foreground">{k}</div><div className="font-semibold">{v}</div></div>
        ))}
      </div>
    </Panel>
  );
};

const HabitGoalVisual: React.FC = () => {
  const cells = ['✓', '✓', '✓', '–', '✓', '✓', '·', '✓', '✓', '✓', '✓', '–', '✓', '○'];
  return (
    <div className="space-y-4">
      <Panel title="Gym · 3× per week">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2"><Flame size={18} className="text-orange-500" /><span className="text-2xl font-bold ibm-mono">6w</span><span className="text-xs text-muted-foreground">current streak · best 9w</span></div>
          <span className="text-xs text-muted-foreground">89% of weeks</span>
        </div>
        <div className="grid grid-cols-7 gap-1.5 text-center text-xs">
          {cells.map((c, i) => (
            <div key={i} className={`h-9 rounded-md flex items-center justify-center ${c === '✓' ? 'bg-primary text-primary-foreground' : c === '·' ? 'bg-destructive/10 text-destructive' : c === '○' ? 'border border-primary' : 'text-muted-foreground/60'}`}>{c}</div>
          ))}
        </div>
      </Panel>
      <Panel title="Goal · Ship the MVP">
        <div className="flex justify-between items-end mb-2"><div className="font-bold">Ship the MVP</div><div className="ibm-mono text-sm">218 / 300 h</div></div>
        <div className="h-3 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary rounded-full" style={{ width: '73%' }} /></div>
        <div className="text-[11px] text-muted-foreground mt-2 space-y-0.5">
          <div>Current pace 9.1 h/week · about 9 weeks to target</div>
          <div className="text-amber-600 dark:text-amber-400">Required to finish by the deadline: 11.4 h/week</div>
          <div>Counted from your tracked blocks since the goal started</div>
        </div>
      </Panel>
    </div>
  );
};

const DataVisual: React.FC = () => (
  <Panel title="Your data, your call">
    <div className="grid grid-cols-2 gap-3">
      {[
        [<Download size={18} key="a" />, 'CSV and Markdown', 'Blocks, tasks, habits, goals, sleep'],
        [<Timer size={18} key="b" />, 'Task-time CSV', 'Estimated, planned, tracked, focused'],
        [<FileJson size={18} key="c" />, 'Full JSON backup', 'Versioned, machine-readable'],
        [<Upload size={18} key="d" />, 'Safe import', 'Preview first. Never deletes anything'],
        [<Brain size={18} key="e" />, 'AI analysis brief', 'Your numbers as a prompt for any AI you like'],
        [<Monitor size={18} key="f" />, 'Windows app', 'Tray, notifications, always-on-top'],
      ].map(([icon, k, v], i) => (
        <div key={i} className="rounded-2xl border border-border bg-background p-4">
          <div className="text-primary mb-2">{icon as React.ReactNode}</div>
          <div className="font-semibold text-sm">{k as string}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">{v as string}</div>
        </div>
      ))}
    </div>
    <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
      {['Installable app (PWA)', 'Works offline-first', 'Private per account (row-level security)', 'Self-hostable'].map((t) => (
        <span key={t} className="px-2.5 py-1 rounded-full bg-muted text-muted-foreground">{t}</span>
      ))}
    </div>
  </Panel>
);

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Landing({ onLoginClick }: LandingProps) {
  const { theme, setTheme } = useTheme();

  return (
    <div className="bg-background text-foreground min-h-screen overflow-x-hidden font-sans selection:bg-primary selection:text-primary-foreground">
      <style>{`@keyframes blockFade { from { opacity: 0; transform: scale(0.4); } to { opacity: 1; transform: scale(1); } }`}</style>

      {/* NAV */}
      <nav className="fixed top-0 w-full z-50 bg-background/75 backdrop-blur-xl border-b border-border/50 pt-[var(--safe-t)]">
        <div className="max-w-[1200px] mx-auto px-6 h-14 flex justify-between items-center text-sm font-medium">
          <span className="font-semibold tracking-tight text-lg">TimeBloker.</span>
          <div className="hidden md:flex items-center gap-7 text-muted-foreground">
            <a href="#grid" className="hover:text-foreground transition-colors">Track</a>
            <a href="#analysis" className="hover:text-foreground transition-colors">Analysis</a>
            <a href="#sleep" className="hover:text-foreground transition-colors">Sleep</a>
            <a href="#data" className="hover:text-foreground transition-colors">Your data</a>
            <a href="#open-source" className="hover:text-foreground transition-colors">Open source</a>
          </div>
          <div className="flex items-center gap-5">
            <div className="hidden sm:flex gap-3 items-center border-r border-border/50 pr-5">
              {THEMES.map(({ id, label, bg }) => (
                <button
                  key={id}
                  onClick={() => setTheme(id)}
                  title={label}
                  aria-label={`Theme: ${label}`}
                  className={`w-4 h-4 rounded-full ${bg} transition-all ${theme === id ? 'ring-2 ring-foreground ring-offset-2 ring-offset-background scale-110' : 'opacity-50 hover:opacity-100'}`}
                />
              ))}
            </div>
            <a href={REPO_URL} target="_blank" rel="noreferrer" aria-label="TimeBloker on GitHub" className="text-muted-foreground hover:text-foreground transition-colors"><GithubMark size={18} /></a>
            <button onClick={onLoginClick} className="text-foreground hover:text-primary transition-colors">Sign in</button>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="pt-28 md:pt-32 pb-16 md:pb-24">
        <div className="max-w-[1200px] mx-auto px-6 grid lg:grid-cols-[1.05fr_0.95fr] gap-14 items-center">
          <div>
            <Eyebrow icon={<Zap size={14} />}>Open-source personal time system</Eyebrow>
            <h1 className="text-[2.6rem] sm:text-5xl md:text-7xl font-bold tracking-tighter leading-[0.98] mb-6">See where your day actually goes.</h1>
            <p className="text-lg sm:text-xl text-muted-foreground leading-relaxed max-w-xl mb-8">
              TimeBloker records your day in 10-minute blocks, ties them to your tasks, goals, habits and sleep, then tells you
              what the numbers really say in plain words, with the evidence one hover away.
            </p>
            <div className="flex flex-wrap gap-3">
              <button onClick={onLoginClick} className="px-7 py-3.5 bg-foreground text-background font-semibold rounded-full hover:scale-105 transition-all flex items-center gap-2">
                Start tracking <ArrowRight size={18} />
              </button>
              <a href="#grid" className="px-7 py-3.5 rounded-full border border-border font-semibold hover:bg-accent transition-colors">See how it works</a>
            </div>
            <dl className="grid grid-cols-3 gap-6 mt-12 max-w-lg">
              {[['144', 'blocks in a day'], ['10', 'minutes per block'], ['0', 'mystery scores']].map(([n, l]) => (
                <div key={l}><dt className="text-3xl font-bold ibm-mono">{n}</dt><dd className="text-xs text-muted-foreground mt-1">{l}</dd></div>
              ))}
            </dl>
          </div>

          <div className="relative">
            <div className="absolute -inset-6 bg-gradient-to-br from-primary/15 via-transparent to-transparent rounded-[3rem] blur-2xl pointer-events-none" />
            <div className="relative bg-card border border-border rounded-[2rem] p-5 md:p-7 shadow-2xl">
              <div className="flex items-center justify-between mb-4">
                <div><div className="text-sm font-bold">Today</div><div className="text-[11px] text-muted-foreground">each circle is 10 minutes</div></div>
                <span className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-md border border-border ibm-mono"><Clock size={11} className="text-destructive" /> Now 2:20 PM</span>
              </div>
              <div className="flex justify-center overflow-hidden"><MiniGrid cell={16} /></div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-4 text-[11px] text-muted-foreground">
                {[['Sleep', C.sleep], ['Deep work', C.work], ['Admin', C.admin], ['Health', C.health], ['Meals', C.food], ['Leisure', C.leisure]].map(([n, c]) => (
                  <span key={n} className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: c }} />{n}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* THE LOOP */}
      <section className="py-12 border-y border-border bg-muted/30">
        <div className="max-w-[1200px] mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-6">
          {[
            [<ListTodo key="1" size={20} />, 'Plan', 'Tasks with deadlines, estimates and priorities'],
            [<LayoutGrid key="2" size={20} />, 'Track', 'Paint blocks, run a focus timer, log sleep and habits'],
            [<BarChart2 key="3" size={20} />, 'Understand', 'Seven analysis tabs that lead with a plain-language summary'],
            [<Repeat key="4" size={20} />, 'Adjust', 'Daily, weekly and monthly reviews that feed tomorrow'],
          ].map(([icon, k, v], i) => (
            <Reveal key={i} delay={i * 80}>
              <div className="flex items-center gap-2 text-primary mb-1.5">{icon as React.ReactNode}<span className="font-bold text-foreground">{k as string}</span></div>
              <p className="text-sm text-muted-foreground">{v as string}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <Feature
        id="grid"
        eyebrow="Track"
        icon={<LayoutGrid size={14} />}
        title="Paint your day in 10-minute blocks."
        body="A 6 by 24 grid turns time into something you can see. Select a stretch, pick an activity, done. It is built to be fast enough that you actually keep doing it."
        bullets={[
          'Drag, tap, or use the keyboard: arrows to move, Shift to extend, Enter repeats your last activity',
          'Link blocks to a task so its tracked time adds up on its own',
          'Copy yesterday, the previous weekday, last Monday or any date. Only empty blocks are filled',
          'Untracked time is just untracked. It is never counted against you',
        ]}
        visual={<Panel><div className="flex justify-center overflow-hidden"><MiniGrid animate={false} cell={18} nowIdx={100} /></div><div className="mt-4 flex items-center gap-2 text-[11px] text-muted-foreground"><Keyboard size={13} /> Press <kbd className="px-1.5 py-0.5 rounded border border-border ibm-mono">?</kbd> in the grid for every shortcut</div></Panel>}
      />

      <Feature
        eyebrow="Tasks and focus"
        icon={<Timer size={14} />}
        title="Estimate it. Do it. See what it really took."
        body="Give a task an estimate and TimeBloker shows what was scheduled, what you tracked and how long you truly focused, side by side. No verdicts, just the numbers."
        bullets={[
          'Deadlines with optional times, recurring tasks that roll forward correctly, and an Eisenhower matrix',
          'A Pomodoro or stopwatch timer that saves every session and tags the blocks it covers',
          'Search and filter by today, overdue, upcoming, recurring or unscheduled',
          'Edit anything inline: estimate, activity, importance, urgency',
        ]}
        visual={<TaskVisual />}
        flip
        tint
      />

      <Feature
        id="analysis"
        eyebrow="Analysis"
        icon={<BarChart2 size={14} />}
        title="Plain answers first. The maths one hover away."
        body="Seven tabs: Day, Trends, Focus, Waste, Patterns, Execution and Review. Each opens with a few sentences on what happened, and every card and number explains what it is, how it is calculated and what to make of it when you hover it."
        bullets={[
          'Changes are only called up or down when they beat your normal day-to-day swing; otherwise it says "about the same"',
          'A peak-focus model with its stability, and a depth curve coloured by what you were doing, so every dip has a cause',
          'Trends by category or by single activity, switching per hour, estimates vs reality and deadline reliability',
          'Weekly and monthly reviews against the previous period, and an execution view from task idea to done',
        ]}
        visual={<InsightsVisual />}
      />

      <Feature
        id="leaks"
        eyebrow="Waste, patterns and attention"
        icon={<Sparkles size={14} />}
        title="Find where the day leaks, and what it costs you."
        body="Rate activities once: how valuable they are, and how much attention they take. TimeBloker then shows what your attention bought, which habits lead into waste, and what usually follows what."
        bullets={[
          'Waste with its triggers, typical start time and how long it takes to get back to real work',
          'Attention vs value: a draining but worthless activity shows up for what it is',
          'What follows what, your most common next steps, and the hours you usually forget to log',
          'Nothing is guessed: untracked time is unknown, never counted as waste',
        ]}
        visual={<LeaksVisual />}
        flip
        tint
      />

      <Feature
        id="sleep"
        eyebrow="Sleep"
        icon={<BedDouble size={14} />}
        title="Sleep tracking that explains itself."
        body="Sleep is just blocks in your day, so there is nothing extra to wear or start. From them TimeBloker finds your main sleep, naps and wake-ups, and turns them into something useful."
        bullets={[
          'A timeline of every night, with the awake gaps and naps drawn in',
          'A 0 to 100 score built from duration, continuity, regularity and your own rating, all four parts shown',
          'Sleep debt, bedtime regularity, weekend shift and a rough chronotype',
          'A tonight planner that works back from your wake-up, and factors that show what helps and hurts, with sample sizes',
        ]}
        visual={<SleepVisual />}
      />

      <Feature
        eyebrow="Reflect"
        icon={<Palette size={14} />}
        title="Where did my day go?"
        body="Every day can be rebuilt as a timeline with the tasks you worked on. Then close the loop with a short reflection, and see week and month reviews compared with the last."
        bullets={[
          'A 24-hour summary, a chronological timeline and a task layer',
          'Generated daily answers: what you completed, what took the most time, what stayed untracked',
          'Weekly and monthly reviews: tracked and focused time, tasks done, sleep, habits and goal hours vs the previous period',
          'Reflections are saved per day, week or month',
        ]}
        visual={<DayVisual />}
        flip
        tint
      />

      <Feature
        eyebrow="Habits and goals"
        icon={<Target size={14} />}
        title="Streaks that mean something. Goals that count real hours."
        body="Habits can be daily, on certain weekdays, weekly or a few times a week, and a day in progress never breaks your streak. Goals read your tracked blocks instead of a counter you have to maintain."
        bullets={[
          'A history calendar you can edit for any past date, with notes on event habits',
          'Goal progress from linked activities since the goal started',
          'Current pace next to the pace you need to hit the deadline',
          'A review card for every goal you finish',
        ]}
        visual={<HabitGoalVisual />}
      />

      <Feature
        id="data"
        eyebrow="Your data"
        icon={<Download size={14} />}
        title="Yours to keep, easy to leave with."
        body="Export what you want, back up everything, and import it again without fear. Restoring merges by default and never deletes a row."
        bullets={[
          'CSV, Markdown, a task-time CSV and a full versioned JSON backup',
          'Import shows a preview and lets you merge or overwrite matching rows only',
          'An AI analysis brief: your real numbers as a prompt to paste into whichever AI you trust, nothing sent automatically',
          'Installable as an app, plus a Windows desktop version with tray and notifications',
        ]}
        visual={<DataVisual />}
        flip
        tint
      />

      {/* OPEN SOURCE */}
      <section id="open-source" className="py-20 md:py-28">
        <div className="max-w-[1200px] mx-auto px-6">
          <Reveal>
            <Eyebrow icon={<Code2 size={14} />}>Open source</Eyebrow>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight leading-[1.05] mb-5 max-w-3xl">Read every formula. Run it yourself.</h2>
            <p className="text-lg text-muted-foreground leading-relaxed mb-10 max-w-2xl">
              TimeBloker is MIT-licensed. The analytics are plain SQL and TypeScript you can audit, and the whole app runs on your own Supabase project.
            </p>
          </Reveal>
          <div className="grid md:grid-cols-3 gap-5">
            {[
              [<Scale key="a" size={20} />, 'MIT licensed', 'Use it, change it, ship it. Keep the notice; that is all.'],
              [<Server key="b" size={20} />, 'Self-host in minutes', 'Create a Supabase project, apply the migrations, set two environment variables.'],
              [<Code2 key="c" size={20} />, 'Auditable numbers', 'Every metric is defined once, in SQL or a small pure function, with tests and a written explanation.'],
            ].map(([icon, k, v], i) => (
              <Reveal key={k as string} delay={i * 80}>
                <div className="rounded-3xl border border-border bg-card p-6 h-full">
                  <div className="text-primary mb-3">{icon as React.ReactNode}</div>
                  <h3 className="text-lg font-bold mb-1.5">{k as string}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{v as string}</p>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal delay={200}>
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="mt-10 inline-flex items-center gap-2 px-6 py-3 rounded-full border border-border font-semibold hover:bg-accent transition-colors">
              <GithubMark size={18} /> View the source on GitHub
            </a>
          </Reveal>
        </div>
      </section>

      {/* PRINCIPLES */}
      <section className="py-20 md:py-24 bg-foreground text-background">
        <div className="max-w-[1200px] mx-auto px-6">
          <Reveal><h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-12 max-w-2xl">Three rules the numbers follow.</h2></Reveal>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              ['Not recorded is not bad', 'Empty blocks measure your logging, not your discipline. Coverage and focus are separate numbers.'],
              ['No mystery scores', 'When a score exists, every part and weight is on screen. When data is thin, it says so.'],
              ['Association is not cause', 'Sleep and habit comparisons show sample sizes and timeframes, and never claim more than the data supports.'],
            ].map(([k, v], i) => (
              <Reveal key={k} delay={i * 100}>
                <div className="rounded-3xl border border-background/15 p-6 h-full">
                  <Star size={18} className="mb-4 opacity-70" />
                  <h3 className="text-xl font-bold mb-2">{k}</h3>
                  <p className="text-background/70 leading-relaxed">{v}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="py-24 md:py-32 text-center">
        <Reveal>
          <div className="w-16 h-16 rounded-3xl bg-primary mx-auto flex items-center justify-center mb-8"><Grid2x2 size={30} className="text-primary-foreground" /></div>
          <h2 className="text-5xl md:text-7xl font-bold tracking-tighter leading-none mb-6">Start with one day.</h2>
          <p className="text-xl text-muted-foreground max-w-xl mx-auto mb-10">Create an account, paint today's blocks, and see what tomorrow's insights look like.</p>
          <button onClick={onLoginClick} className="px-10 py-5 bg-primary text-primary-foreground font-bold rounded-full hover:scale-105 transition-transform text-xl shadow-2xl shadow-primary/30">
            Launch TimeBloker
          </button>
          <p className="text-xs text-muted-foreground mt-6">Demo charts on this page are generated from sample data with the same engines the app uses.</p>
        </Reveal>
      </section>

      <footer className="border-t border-border py-8 text-center text-xs font-semibold text-muted-foreground uppercase tracking-widest">
        TimeBloker · Open source under the MIT license ·{' '}
        <a href={REPO_URL} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-foreground">GitHub</a>
      </footer>
    </div>
  );
}
