import React, { useEffect, useMemo, useState } from 'react';
import { Section } from './ui/detail';
import type { Activity, ActivityCategory } from '../types';
import { formatMultiplier, multiplierTone, parseMultiplier, MULTIPLIER_MAX, MULTIPLIER_MIN, parseFocusDemand, focusDemandLabel, FOCUS_DEMAND_MAX } from '../lib/activityFlags';
import { getSleepActivityIds } from '../lib/sleepActivity';

interface AnalysisSettingsProps {
  activities: Activity[];
  onUpdateActivity: (id: string, updates: Partial<Activity>) => void;
}

const CATEGORY_ORDER: ActivityCategory[] = ['Work', 'Admin', 'Health', 'Leisure', 'Other'];
const normalize = (c?: string | null): ActivityCategory =>
  c === 'Work' || c === 'Admin' || c === 'Health' || c === 'Leisure' ? c : 'Other';

const MultiplierInput: React.FC<{ activity: Activity; disabled: boolean; onSave: (v: number) => void }> = ({ activity, disabled, onSave }) => {
  const saved = activity.productivity_multiplier ?? 0;
  const [text, setText] = useState(String(saved));
  const [error, setError] = useState(false);
  useEffect(() => { setText(String(saved)); }, [saved]);

  const commit = () => {
    const v = parseMultiplier(text);
    if (v === null) { setError(true); setText(String(saved)); return; }
    setError(false);
    setText(String(v));
    if (v !== saved) onSave(v);
  };

  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        inputMode="decimal"
        aria-label={`Productivity multiplier for ${activity.name}`}
        value={text}
        disabled={disabled}
        onChange={(e) => { setText(e.target.value); setError(false); }}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setText(String(saved)); setError(false); } }}
        className={`w-20 px-2 py-1.5 text-sm ibm-mono text-right border rounded-md bg-background outline-none focus:ring-1 ring-primary disabled:opacity-40 ${error ? 'border-red-500' : 'border-border'}`}
      />
      <span className={`w-14 text-xs font-bold ibm-mono ${disabled ? 'text-muted-foreground opacity-40' : multiplierTone(saved)}`}>{formatMultiplier(saved)}</span>
      {error && <span className="text-[10px] text-red-500" role="alert">not a number</span>}
    </div>
  );
};

const FocusDemandInput: React.FC<{ activity: Activity; disabled: boolean; onSave: (v: number) => void }> = ({ activity, disabled, onSave }) => {
  const saved = (activity as any).focus_demand ?? 0;
  const [text, setText] = useState(String(saved));
  const [error, setError] = useState(false);
  useEffect(() => { setText(String(saved)); }, [saved]);

  const commit = () => {
    const v = parseFocusDemand(text);
    if (v === null) { setError(true); setText(String(saved)); return; }
    setError(false);
    setText(String(v));
    if (v !== saved) onSave(v);
  };

  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        inputMode="decimal"
        aria-label={`Focus demand for ${activity.name}`}
        value={text}
        disabled={disabled}
        onChange={(e) => { setText(e.target.value); setError(false); }}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setText(String(saved)); setError(false); } }}
        className={`w-14 px-2 py-1.5 text-sm ibm-mono text-right border rounded-md bg-background outline-none focus:ring-1 ring-primary disabled:opacity-40 ${error ? 'border-red-500' : 'border-border'}`}
      />
      <span className={`w-20 text-xs text-muted-foreground ${disabled ? 'opacity-40' : ''}`}>/{FOCUS_DEMAND_MAX} · {focusDemandLabel(saved)}</span>
      {error && <span className="text-[10px] text-red-500" role="alert">0-5 only</span>}
    </div>
  );
};

/**
 * Settings → Analysis: the per-activity knobs that change how time is judged. Multipliers are typed (so "-0.35" is
 * easy), and "ignore" marks activities that are tracked but never judged. Sleep is always ignored.
 */
export const AnalysisSettings: React.FC<AnalysisSettingsProps & { detail?: boolean }> = ({ activities, onUpdateActivity, detail }) => {
  const sleepIds = useMemo(() => getSleepActivityIds(activities), [activities]);
  const visible = activities.filter((a) => !a.archived);

  return (
    <Section id="settings-analysis" detail={detail} title="Analysis: multipliers and ignored activities" summary={`${visible.filter((x) => (x.productivity_multiplier ?? 0) !== 0).length} multipliers set`}>
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground space-y-1">
        <p><span className="font-medium text-foreground">Multiplier</span>: how each minute on an activity counts. <span className="ibm-mono">1</span> is a fully productive minute, <span className="ibm-mono">-0.5</span> costs half a minute, <span className="ibm-mono">0</span> is neutral. Anything below 0 counts as time waste. Range {MULTIPLIER_MIN} to +{MULTIPLIER_MAX}, up to 2 decimals.</p>
        <p><span className="font-medium text-foreground">Ignore</span>: still tracked (it shows in your day and in coverage) but never judged: not focus, not waste, not productivity. Good for travel. Sleep is always ignored.</p>
        <p><span className="font-medium text-foreground">Focus demand</span> (0-5): how much attention the activity takes, separate from whether it's worthwhile. A demanding, low-value activity (an unproductive but draining conversation) is a real and valid combination -- this is not a second productivity score.</p>
        <p>
          It also decides what counts as <span className="font-medium text-foreground">focus work</span> on the Focus tab: an activity with demand{' '}
          <span className="ibm-mono">5</span> counts fully, <span className="ibm-mono">3</span> counts 60%, <span className="ibm-mono">0</span> not at all, and only
          if its multiplier is above 0 (demanding but not worthwhile is attention, not deep work).{' '}
          {visible.some((x) => Number((x as { focus_demand?: number | null }).focus_demand ?? 0) > 0)
            ? 'In use now.'
            : 'Until you set a demand on any activity, focus work falls back to the Work (100%) and Admin (80%) categories.'}
        </p>
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">No activities yet.</p>
      ) : (
        <div className="space-y-5">
          {CATEGORY_ORDER.map((cat) => {
            const group = visible.filter((a) => normalize(a.category) === cat);
            if (group.length === 0) return null;
            return (
              <div key={cat}>
                <div className="text-xs font-semibold text-muted-foreground mb-2">{cat}</div>
                <ul className="divide-y divide-border border border-border rounded-lg">
                  {group.map((a) => {
                    const isSleep = sleepIds.has(a.id);
                    const ignored = isSleep || !!a.analysis_ignored;
                    return (
                      <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2 flex-wrap">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: a.color }} />
                          {a.emoji && <span className="text-base">{a.emoji}</span>}
                          <span className={`text-sm font-medium truncate ${ignored ? 'text-muted-foreground' : ''}`}>{a.name}</span>
                          {ignored && <span className="text-[10px] text-muted-foreground whitespace-nowrap">{isSleep ? 'sleep · never judged' : 'ignored · never judged'}</span>}
                        </div>
                        <div className="flex items-center gap-4">
                          <MultiplierInput activity={a} disabled={ignored} onSave={(v) => onUpdateActivity(a.id, { productivity_multiplier: v })} />
                          <FocusDemandInput activity={a} disabled={false} onSave={(v) => onUpdateActivity(a.id, { focus_demand: v } as any)} />
                          <label className={`flex items-center gap-1.5 text-xs ${isSleep ? 'opacity-60' : 'cursor-pointer'}`} title={isSleep ? 'Sleep is always ignored' : undefined}>
                            <input
                              type="checkbox"
                              className="w-4 h-4 accent-primary"
                              checked={ignored}
                              disabled={isSleep}
                              onChange={(e) => onUpdateActivity(a.id, { analysis_ignored: e.target.checked })}
                            />
                            Ignore
                          </label>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
    </Section>
  );
};
