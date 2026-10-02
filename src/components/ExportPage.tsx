import { useEffect, useMemo, useState } from 'react';
import { Bot, Check, Copy, FileJson, FileText, Package, Sparkles } from 'lucide-react';
import { endOfMonth, format, parseISO, startOfMonth, subDays, subMonths } from 'date-fns';
import { zipSync, strToU8 } from 'fflate';
import { supabase } from '../supabaseClient';
import { Button } from './ui/button';
import { Section } from './ui/detail';
import { Input } from './ui/input';
import { BackupPanel } from './BackupPanel';
import type { RangeBlock } from '../lib/blockRange';
import {
  buildExportData, DEFAULT_INCLUDE, estimateTokens, exportFetchStart, toCSVs, toJSON, toMarkdown,
  type ExportDetail, type ExportHabitLog, type ExportInclude, type ExportInput,
} from '../lib/exportPack';
import { getOrCreateAnalysisPrompt, submitAnalysisResponse, type AIAnalysisPromptResult } from '../lib/aiAnalysisService';
import type { Activity, Goal, Review, SleepLog, Task, TaskBlockRef, TaskFocusSession, UserSettings } from '../types';
import { pageClass } from './ui/page';

interface ExportPageProps {
  activities: Activity[];
  habits: { id: string; name: string; type?: string | null; frequency?: string | null; target_count?: number | null; weekdays?: number[] | null; created_at?: string | null }[];
  sleepLogs: SleepLog[];
  goals: Goal[];
  tasks?: Task[];
  taskBlocks?: TaskBlockRef[];
  focusSessions?: TaskFocusSession[];
  reviews?: Review[];
  userSettings?: UserSettings | null;
}

type Preset = '7d' | '30d' | '90d' | 'this-month' | 'last-month' | 'custom';
const PRESETS: { id: Preset; label: string }[] = [
  { id: '7d', label: 'Last 7 days' }, { id: '30d', label: 'Last 30 days' }, { id: '90d', label: 'Last 90 days' },
  { id: 'this-month', label: 'This month' }, { id: 'last-month', label: 'Last month' }, { id: 'custom', label: 'Custom' },
];
const INCLUDE_LABELS: { key: keyof ExportInclude; label: string }[] = [
  { key: 'timeline', label: 'Timeline' }, { key: 'text', label: 'Notes & reflections' }, { key: 'tasks', label: 'Tasks' },
  { key: 'habits', label: 'Habits' }, { key: 'sleep', label: 'Sleep' }, { key: 'goals', label: 'Goals' },
];
const BIG_PACK_TOKENS = 100_000;

const presetRange = (p: Preset, today: Date): [string, string] | null => {
  const k = (d: Date) => format(d, 'yyyy-MM-dd');
  switch (p) {
    case '7d': return [k(subDays(today, 6)), k(today)];
    case '30d': return [k(subDays(today, 29)), k(today)];
    case '90d': return [k(subDays(today, 89)), k(today)];
    case 'this-month': return [k(startOfMonth(today)), k(today)];
    case 'last-month': { const m = subMonths(today, 1); return [k(startOfMonth(m)), k(endOfMonth(m))]; }
    default: return null;
  }
};

/** Paged fetch (Supabase returns at most 1000 rows per request). */
const fetchAll = async <T,>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> => {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
};

const download = (content: BlobPart, filename: string, mime: string) => {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

const fmtTokens = (n: number) => (n >= 1000 ? `~${Math.round(n / 1000)}k tokens` : `~${n} tokens`);
const fmtSize = (chars: number) => (chars >= 1_000_000 ? `${(chars / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(chars / 1000))} KB`);

/**
 * Export everything the app calculates for a date range: an AI-ready pack (markdown), the same data as JSON, or a
 * bundle of CSV tables. Built by src/lib/exportPack.ts from the same engines as the screens.
 */
export function ExportPage({ activities, habits, sleepLogs, goals, tasks = [], taskBlocks = [], focusSessions = [], reviews = [], userSettings = null }: ExportPageProps) {
  const today = useMemo(() => new Date(), []);
  const [preset, setPreset] = useState<Preset>('30d');
  const [fromDate, setFromDate] = useState(() => presetRange('30d', today)![0]);
  const [toDate, setToDate] = useState(() => presetRange('30d', today)![1]);
  const [include, setInclude] = useState<ExportInclude>(DEFAULT_INCLUDE);
  const [anonymise, setAnonymise] = useState(false);
  const [detail, setDetail] = useState<ExportDetail>('full');
  const [preview, setPreview] = useState<'md' | 'json' | 'csv'>('md');
  const [copied, setCopied] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [raw, setRaw] = useState<{ blocks: RangeBlock[]; habitLogs: ExportHabitLog[] } | null>(null);

  // Canonical (backend-analytics-backed) AI brief: generate a prompt, copy it into
  // whatever AI chat the user uses, then paste the reply back in to keep it with
  // the request that produced it. No provider call happens here or on the server.
  const [aiModel, setAiModel] = useState('claude');
  const [aiResult, setAiResult] = useState<AIAnalysisPromptResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiCopied, setAiCopied] = useState(false);
  const [aiReplyDraft, setAiReplyDraft] = useState('');
  const [aiSaved, setAiSaved] = useState(false);

  const choosePreset = (p: Preset) => {
    setPreset(p);
    const r = presetRange(p, today);
    if (r) { setFromDate(r[0]); setToDate(r[1]); }
  };

  // Fetch raw rows for the range plus the history needed for comparisons
  useEffect(() => {
    if (!fromDate || !toDate || fromDate > toDate) return;
    let cancelled = false;
    const start = exportFetchStart(fromDate, toDate);
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [blocks, habitLogs] = await Promise.all([
          fetchAll<RangeBlock>((f, t) => supabase.from('time_blocks').select('date_key, block_index, activity_id, task_id').gte('date_key', start).lte('date_key', toDate).not('activity_id', 'is', null).order('date_key').order('block_index').range(f, t)),
          fetchAll<ExportHabitLog>((f, t) => supabase.from('habit_logs').select('habit_id, date_key, logged_at').gte('date_key', subDays(parseISO(start), 90).toISOString().slice(0, 10)).lte('date_key', toDate).range(f, t)),
        ]);
        if (!cancelled) setRaw({ blocks, habitLogs });
      } catch (e) {
        console.error('export fetch failed', e);
        if (!cancelled) setError('Could not load your data for this range. Check your connection and try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fromDate, toDate]);

  const outputs = useMemo(() => {
    if (!raw || fromDate > toDate) return null;
    const input: ExportInput = {
      blocks: raw.blocks,
      activities,
      tasks,
      taskBlocks,
      sessions: focusSessions,
      habits,
      habitLogs: raw.habitLogs,
      goals,
      sleepLogs,
      reviews,
      settings: userSettings,
    };
    const data = buildExportData(input, fromDate, toDate, { include, anonymise });
    const md = toMarkdown(data, detail);
    const json = toJSON(data);
    const csvs = toCSVs(data);
    const csvChars = Object.values(csvs).reduce((s, c) => s + c.length, 0);
    return { data, md, json, csvs, csvChars };
  }, [raw, fromDate, toDate, activities, tasks, taskBlocks, focusSessions, habits, goals, sleepLogs, reviews, userSettings, include, anonymise, detail]);

  const base = `TimeBloker_${fromDate}_to_${toDate}${anonymise ? '_anon' : ''}`;
  const mdTokens = outputs ? estimateTokens(outputs.md) : 0;

  const copyPack = async () => {
    if (!outputs) return;
    await navigator.clipboard.writeText(outputs.md);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const generateAiBrief = async () => {
    if (fromDate > toDate) return;
    setAiLoading(true);
    setAiError(null);
    setAiSaved(false);
    try {
      const result = await getOrCreateAnalysisPrompt({ fromDate, toDate, analysisMode: 'export_range', model: aiModel.trim() || 'claude' });
      setAiResult(result);
      setAiReplyDraft(result.response ?? '');
    } catch (e: any) {
      console.error('AI brief generation failed', e);
      setAiError(e?.message || 'Could not build the analysis brief.');
    } finally {
      setAiLoading(false);
    }
  };

  const copyAiPrompt = async () => {
    if (!aiResult) return;
    await navigator.clipboard.writeText(aiResult.prompt);
    setAiCopied(true);
    setTimeout(() => setAiCopied(false), 2000);
  };

  const saveAiReply = async () => {
    if (!aiResult || !aiReplyDraft.trim()) return;
    try {
      await submitAnalysisResponse(aiResult.requestHash, aiReplyDraft.trim());
      setAiResult({ ...aiResult, status: 'success', response: aiReplyDraft.trim() });
      setAiSaved(true);
      setTimeout(() => setAiSaved(false), 2000);
    } catch (e: any) {
      console.error('saving AI reply failed', e);
      setAiError(e?.message || 'Could not save the reply.');
    }
  };

  const downloadZip = () => {
    if (!outputs) return;
    const files: Record<string, Uint8Array> = {};
    for (const [name, content] of Object.entries(outputs.csvs)) files[name] = strToU8(content);
    files['README_ai_pack.md'] = strToU8(outputs.md);
    download(zipSync(files, { level: 6 }) as BlobPart, `${base}_csv.zip`, 'application/zip');
  };

  const previewText = !outputs ? '' : preview === 'md' ? outputs.md : preview === 'json' ? outputs.json : outputs.csvs['days.csv'];
  const busy = loading || !outputs;

  return (
    <div className={pageClass('reading')}>
      <div>
        <h2 className="text-xl font-bold">Export</h2>
        <p className="text-sm text-muted-foreground">Everything the app calculates for a range: ready to paste into an AI, open in a spreadsheet or keep as a record.</p>
      </div>

      {/* Range and the one action most people want */}
      <Section id="export-main" title="Range">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button key={p.id} onClick={() => choosePreset(p.id)} aria-pressed={preset === p.id}
              className={`px-3 py-1.5 min-h-[36px] text-xs font-medium rounded-full border transition-colors ${preset === p.id ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground border-border hover:bg-accent'}`}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-muted-foreground">From
            <Input type="date" value={fromDate} max={toDate} onChange={(e) => { setPreset('custom'); setFromDate(e.target.value); }} className="min-h-[44px] ibm-mono mt-1" />
          </label>
          <label className="text-xs text-muted-foreground">To
            <Input type="date" value={toDate} min={fromDate} onChange={(e) => { setPreset('custom'); setToDate(e.target.value); }} className="min-h-[44px] ibm-mono mt-1" />
          </label>
        </div>
        {fromDate > toDate && <p className="text-xs text-red-500">The start date is after the end date.</p>}
        {error && <p className="text-sm text-red-500" role="alert">{error}</p>}
        <Button onClick={copyPack} disabled={busy} className="w-full min-h-[52px] justify-center gap-2 text-base">
          {copied ? <Check className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
          <span>{copied ? 'Copied: paste it into your AI chat' : 'Copy AI pack'}</span>
          {outputs && <span className="text-[11px] opacity-80 ibm-mono">{fmtTokens(mdTokens)}</span>}
        </Button>
        {outputs && mdTokens > BIG_PACK_TOKENS && (
          <p className="text-xs text-amber-700 dark:text-amber-400">This pack is large ({fmtTokens(mdTokens)}). Some AI chats will cut it off: try Compact, untick Timeline, or pick a shorter range.</p>
        )}
        {outputs && <p className="text-[11px] text-muted-foreground">{outputs.data.meta.days_with_tracking} of {outputs.data.meta.days} days have tracking. The AI pack starts with instructions for the AI, definitions and suggested questions, so you can paste it and ask "analyse this".</p>}
      </div>
      </Section>

      {/* Options */}
      <Section id="export-options" detail title="What to include" summary={`${INCLUDE_LABELS.filter(({ key }) => include[key]).length} of ${INCLUDE_LABELS.length} · ${detail}${anonymise ? ' · anonymised' : ''}`}>
      <div className="space-y-3">
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-2">Include</div>
          <div className="flex flex-wrap gap-2">
            {INCLUDE_LABELS.map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer px-3 py-2 min-h-[40px] border border-border rounded-lg hover:bg-muted transition-colors select-none text-sm">
                <input type="checkbox" className="w-4 h-4 accent-primary" checked={include[key]} disabled={key === 'text' && anonymise} onChange={(e) => setInclude((s) => ({ ...s, [key]: e.target.checked }))} />
                {label}
              </label>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-4 items-center">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" className="w-4 h-4 accent-primary" checked={anonymise} onChange={(e) => setAnonymise(e.target.checked)} />
            Anonymise <span className="text-xs text-muted-foreground">(names become "Activity A", "Task 3"; notes and reflections are left out)</span>
          </label>
          <div className="flex items-center border border-border rounded-lg overflow-hidden text-xs font-semibold" role="group" aria-label="Detail">
            {(['compact', 'full'] as const).map((d) => (
              <button key={d} onClick={() => setDetail(d)} aria-pressed={detail === d} className={`px-3 min-h-[36px] transition-colors ${detail === d ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>
                {d === 'compact' ? 'Compact' : 'Full'}
              </button>
            ))}
          </div>
        </div>
      </div>
      </Section>

      {/* Files */}
      <Section id="export-files" detail title="More formats" summary="markdown · JSON · CSV">
        <div className="grid sm:grid-cols-3 gap-2">
          <Button variant="outline" onClick={() => outputs && download(outputs.md, `${base}_ai_pack.md`, 'text/markdown')} disabled={busy} className="min-h-[48px] justify-start gap-2">
            <FileText className="w-4 h-4" /><span className="flex-1 text-left">AI pack (.md)</span>
            {outputs && <span className="text-[11px] text-muted-foreground ibm-mono">{fmtSize(outputs.md.length)}</span>}
          </Button>
          <Button variant="outline" onClick={() => outputs && download(outputs.json, `${base}_analysis.json`, 'application/json')} disabled={busy} className="min-h-[48px] justify-start gap-2">
            <FileJson className="w-4 h-4" /><span className="flex-1 text-left">Analysis (.json)</span>
            {outputs && <span className="text-[11px] text-muted-foreground ibm-mono">{fmtSize(outputs.json.length)}</span>}
          </Button>
          <Button variant="outline" onClick={downloadZip} disabled={busy} className="min-h-[48px] justify-start gap-2">
            <Package className="w-4 h-4" /><span className="flex-1 text-left">CSV tables (.zip)</span>
            {outputs && <span className="text-[11px] text-muted-foreground ibm-mono">{Object.keys(outputs.csvs).length} files · {fmtSize(outputs.csvChars)}</span>}
          </Button>
        </div>
      </Section>

      {/* Canonical AI brief: backend-analytics-backed, cached by request, no live provider call */}
      <Section id="export-ai-brief" detail title="AI analysis brief" summary="canonical, cached · you paste the reply back">
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Builds a prompt from the same deterministic backend numbers the app shows you (not a re-read of raw history). Nothing is sent to an AI provider automatically: copy the prompt into whatever AI chat you use, then paste its reply back in below to keep it with this request.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-muted-foreground">Model label
              <Input value={aiModel} onChange={(e) => setAiModel(e.target.value)} placeholder="e.g. claude, gpt-5" className="min-h-[40px] mt-1 w-40" />
            </label>
            <Button onClick={generateAiBrief} disabled={aiLoading || fromDate > toDate} className="min-h-[44px] gap-2">
              <Sparkles className="w-4 h-4" />
              {aiLoading ? 'Building…' : aiResult ? 'Regenerate for this range' : 'Generate brief'}
            </Button>
          </div>
          {aiError && <p className="text-sm text-red-500" role="alert">{aiError}</p>}
          {aiResult && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground ibm-mono">{aiResult.status === 'success' ? 'saved reply on file' : 'ready to copy'} · {fmtTokens(estimateTokens(aiResult.prompt))}</span>
                <Button variant="outline" size="sm" onClick={copyAiPrompt} className="gap-2">
                  {aiCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {aiCopied ? 'Copied' : 'Copy prompt'}
                </Button>
              </div>
              <pre className="bg-muted text-foreground border border-border rounded-xl p-3 h-48 overflow-auto ibm-mono text-[11px] leading-relaxed whitespace-pre">{aiResult.prompt}</pre>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Paste the AI's reply here to save it with this request</label>
                <textarea
                  value={aiReplyDraft}
                  onChange={(e) => setAiReplyDraft(e.target.value)}
                  rows={5}
                  className="w-full text-sm p-3 border border-border rounded-lg bg-background outline-none focus:ring-1 ring-primary"
                  placeholder="Paste the reply…"
                />
                <Button variant="outline" size="sm" onClick={saveAiReply} disabled={!aiReplyDraft.trim()} className="gap-2">
                  {aiSaved ? <Check className="w-4 h-4" /> : null}
                  {aiSaved ? 'Saved' : 'Save reply'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Section>

      {/* Preview */}
      <Section id="export-preview" detail title="Preview" summary={outputs ? fmtSize(outputs.md.length) : undefined}>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center border border-border rounded-lg overflow-hidden text-xs font-semibold" role="tablist" aria-label="Preview">
            {([['md', 'AI pack'], ['json', 'JSON'], ['csv', 'days.csv']] as const).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={preview === id} onClick={() => setPreview(id)} className={`px-3 py-1.5 transition-colors ${preview === id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50'}`}>{label}</button>
            ))}
          </div>
          {loading && <span className="text-xs text-muted-foreground animate-pulse">Loading…</span>}
          {!loading && outputs && (
            <button onClick={copyPack} className="p-2 rounded-md hover:bg-muted text-muted-foreground" aria-label="Copy AI pack"><Copy className="w-4 h-4" /></button>
          )}
        </div>
        <pre className="bg-muted text-foreground border border-border rounded-xl p-3 sm:p-4 h-80 overflow-auto ibm-mono text-[11px] leading-relaxed whitespace-pre">
          {previewText ? previewText.slice(0, 60_000) + (previewText.length > 60_000 ? '\n\n… preview cut here; the download has everything.' : '') : busy ? 'Building…' : 'No data in range.'}
        </pre>
      </div>
      </Section>

      <BackupPanel activities={activities} tasks={tasks} taskBlocks={taskBlocks} focusSessions={focusSessions} />
    </div>
  );
}
