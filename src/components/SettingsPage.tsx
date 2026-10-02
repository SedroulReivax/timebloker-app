import React, { useState } from 'react';
import { AlertTriangle, BarChart3, Database, Download, Monitor, Moon, Palette, ShieldCheck, SlidersHorizontal, Trash2 } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from './ui/dialog';
import { AnalysisSettings } from './AnalysisSettings';
import { AccountSecurity } from './AccountSecurity';
import { openSection, useNerdMode } from './ui/detail';
import { Notice } from './ui/password';
import { deleteAllUserData, WIPE_ORDER, type WipeFailure } from '../lib/accountData';
import type { Activity } from '../types';

interface SettingsPageProps {
  session: any;
  userSettings: any;
  onUpdateSettings: (updates: any) => void;
  theme: string;
  onSetTheme: (theme: any) => void;
  onSignOut: () => void;
  activities: Activity[];
  onUpdateActivity: (id: string, updates: Partial<Activity>) => void;
  onOpenExport?: () => void;
  habits: any[];
  sleepLogs: any[];
  goals: any[];
}

const NAV = [
  { id: 'settings-account', label: 'Account', icon: ShieldCheck },
  { id: 'settings-appearance', label: 'Appearance', icon: Palette },
  { id: 'settings-preferences', label: 'Preferences', icon: SlidersHorizontal },
  { id: 'settings-sleep', label: 'Sleep', icon: Moon },
  { id: 'settings-analysis', label: 'Analysis', icon: BarChart3 },
  { id: 'settings-data', label: 'Your data', icon: Database },
  { id: 'settings-danger', label: 'Danger zone', icon: AlertTriangle },
] as const;

const THEMES = [
  { id: 'theme-stark-white', name: 'Stark White', dot: '#f5f5f5', border: '#e0e0e0' },
  { id: 'theme-stark-black', name: 'Stark Black', dot: '#111111', border: '#333333' },
  { id: 'theme-solarized-light', name: 'Solarized Light', dot: '#fdf6e3', border: '#eee8d5' },
  { id: 'theme-solarized-dark', name: 'Solarized Dark', dot: '#002b36', border: '#073642' },
] as const;

/** One settings group: icon, title and a line on what it controls. */
const SettingsCard: React.FC<{
  id: string;
  icon: React.ElementType;
  title: string;
  description: string;
  danger?: boolean;
  children: React.ReactNode;
}> = ({ id, icon: Icon, title, description, danger, children }) => (
  <section id={id} className={`bg-card border rounded-2xl shadow-sm scroll-mt-16 ${danger ? 'border-destructive/30' : 'border-border'}`}>
    <header className="flex items-start gap-3 px-4 md:px-5 pt-4 pb-3 border-b border-border/60">
      <span className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${danger ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'}`}>
        <Icon size={16} aria-hidden />
      </span>
      <div className="min-w-0">
        <h2 className={`text-sm font-semibold ${danger ? 'text-destructive' : 'text-foreground'}`}>{title}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
    </header>
    <div className="px-4 md:px-5 py-4">{children}</div>
  </section>
);

/** Label and explanation on the left, the control on the right; stacks on narrow screens. */
const Row: React.FC<{ title: string; description?: string; children: React.ReactNode }> = ({ title, description, children }) => (
  <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0 border-b border-border/60 last:border-0">
    <div className="min-w-0">
      <div className="text-sm font-medium">{title}</div>
      {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
    </div>
    <div className="flex-shrink-0">{children}</div>
  </div>
);

const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string }> = ({ checked, onChange, label }) => (
  <label className="relative inline-flex items-center cursor-pointer">
    <input type="checkbox" className="sr-only peer" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} />
    <div className="w-11 h-6 bg-muted peer-focus-visible:ring-2 peer-focus-visible:ring-ring rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-foreground after:border-border after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary peer-checked:after:bg-primary-foreground" />
  </label>
);

export function SettingsPage({
  session,
  userSettings,
  onUpdateSettings,
  theme,
  onSetTheme,
  onSignOut,
  activities,
  onUpdateActivity,
  onOpenExport,
}: SettingsPageProps) {
  const { startInNerd, setStartInNerd } = useNerdMode();
  const [defWake, setDefWake] = useState(userSettings?.default_wake_time || '06:00');
  const [defSleep, setDefSleep] = useState(userSettings?.default_sleep_time || '23:00');
  const [sleepGoalTime, setSleepGoalTime] = useState(() => {
    const h = userSettings?.sleep_goal_hours || 7.66;
    const hrs = Math.floor(h);
    const mins = Math.round((h - hrs) * 60);
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  });
  const [sleepSaved, setSleepSaved] = useState(false);

  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [wipeStep, setWipeStep] = useState<number | null>(null);
  const [wipeFailures, setWipeFailures] = useState<WipeFailure[]>([]);

  const email: string = session?.user?.email ?? '';
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const handleSaveDefaults = () => {
    const [h, m] = sleepGoalTime.split(':').map(Number);
    onUpdateSettings({ default_wake_time: defWake, default_sleep_time: defSleep, sleep_goal_hours: h + m / 60 });
    setSleepSaved(true);
  };

  const handleDeleteData = async () => {
    if (deleteConfirm !== 'DELETE') return;
    setWipeFailures([]);
    const failures = await deleteAllUserData(session.user.id, (done) => setWipeStep(done));
    setWipeStep(null);
    if (failures.length) { setWipeFailures(failures); return; }
    setIsDeleteDialogOpen(false);
    window.location.reload();
  };

  return (
    <div className="max-w-5xl 3xl:max-w-6xl mx-auto w-full page-enter pb-20">
      <div className="mb-5">
        <h1 className="text-xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">{email ? `Signed in as ${email}` : 'Your account, appearance and how analysis works.'}</p>
      </div>

      {/* phones and tablets: a scrollable row of jumps */}
      <nav aria-label="Settings sections" className="lg:hidden -mx-1 px-1 mb-4 flex gap-1.5 overflow-x-auto no-scrollbar">
        {NAV.map(({ id, label }) => (
          <button key={id} onClick={() => openSection(id)} className="px-3 py-1.5 text-xs rounded-full border border-border text-muted-foreground hover:bg-accent hover:text-foreground whitespace-nowrap flex-shrink-0">
            {label}
          </button>
        ))}
      </nav>

      <div className="lg:grid lg:grid-cols-[180px_minmax(0,1fr)] lg:gap-8">
        {/* desktops: a sticky side list */}
        <nav aria-label="Settings sections" className="hidden lg:block sticky top-4 self-start">
          <ul className="space-y-0.5">
            {NAV.map(({ id, label, icon: Icon }) => (
              <li key={id}>
                <button
                  onClick={() => openSection(id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg text-left transition-colors hover:bg-accent ${id === 'settings-danger' ? 'text-destructive' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  <Icon size={15} aria-hidden /> {label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="space-y-4 min-w-0">
          <SettingsCard id="settings-account" icon={ShieldCheck} title="Account and security" description="Your email, password and signed-in devices.">
            <AccountSecurity email={email} onSignOut={onSignOut} />
          </SettingsCard>

          <SettingsCard id="settings-appearance" icon={Palette} title="Appearance" description="Theme and motion. The theme is also one tap away in the top bar.">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => onSetTheme(t.id)}
                  aria-pressed={theme === t.id}
                  className={`flex flex-col items-center gap-2.5 p-3.5 border rounded-xl transition-all min-h-[44px] ${
                    theme === t.id ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : 'border-border hover:bg-muted'
                  }`}
                >
                  <span className="w-9 h-9 rounded-full shadow-inner" style={{ backgroundColor: t.dot, border: `2px solid ${t.border}` }} />
                  <span className="text-xs font-medium text-center">{t.name}</span>
                </button>
              ))}
            </div>
            <div className="mt-4">
              <Row title="Animations" description="Smooth transitions when switching pages.">
                <Toggle label="Animations" checked={userSettings?.enable_animations ?? false} onChange={(v) => onUpdateSettings({ enable_animations: v })} />
              </Row>
            </div>
          </SettingsCard>

          <SettingsCard id="settings-preferences" icon={SlidersHorizontal} title="Preferences" description="How screens open on this device.">
            <Row title="Start in nerd mode" description="Open every detail section and hint by default, instead of headlines first. Saved on this device.">
              <Toggle label="Start in nerd mode" checked={startInNerd} onChange={setStartInNerd} />
            </Row>
            <Row title="Timezone" description="Detected from your device; days and hours follow it.">
              <span className="inline-flex items-center gap-1.5 text-sm ibm-mono text-muted-foreground"><Monitor size={14} aria-hidden /> {timezone}</span>
            </Row>
          </SettingsCard>

          <SettingsCard id="settings-sleep" icon={Moon} title="Sleep defaults" description="Used to prefill sleep logs and to judge sleep against your goal.">
            <div className="grid sm:grid-cols-3 gap-4">
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground block mb-1">Usual wake time</span>
                <Input type="time" value={defWake} onChange={(e) => { setDefWake(e.target.value); setSleepSaved(false); }} className="min-h-[44px] ibm-mono" />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground block mb-1">Usual bedtime</span>
                <Input type="time" value={defSleep} onChange={(e) => { setDefSleep(e.target.value); setSleepSaved(false); }} className="min-h-[44px] ibm-mono" />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground block mb-1">Sleep goal (hours:minutes)</span>
                <Input type="time" value={sleepGoalTime} onChange={(e) => { setSleepGoalTime(e.target.value); setSleepSaved(false); }} className="min-h-[44px] ibm-mono" />
              </label>
            </div>
            <div className="flex items-center gap-3 mt-4">
              <Button onClick={handleSaveDefaults} className="min-h-[40px]">Save sleep defaults</Button>
              {sleepSaved && <span className="text-xs text-muted-foreground" role="status">Saved.</span>}
            </div>
          </SettingsCard>

          {/* its own card (id settings-analysis): the "set it up" buttons across Analysis jump here */}
          <AnalysisSettings detail activities={activities} onUpdateActivity={onUpdateActivity} />

          <SettingsCard id="settings-data" icon={Database} title="Your data" description="Everything you track is yours to take with you.">
            <Row title="Export and backup" description="An AI-ready analysis brief, JSON or CSV tables for any date range, plus full backup and restore.">
              {onOpenExport && (
                <Button variant="outline" onClick={onOpenExport} className="min-h-[40px]">
                  <Download className="w-4 h-4 mr-2" /> Open export
                </Button>
              )}
            </Row>
          </SettingsCard>

          <SettingsCard id="settings-danger" icon={AlertTriangle} title="Danger zone" description="Irreversible. Download a backup first if you might want anything back." danger>
            <Row title="Delete all data" description="Removes every activity, block, task, habit, goal, sleep log, reflection, setting and all analytics. Your login stays.">
              <Dialog open={isDeleteDialogOpen} onOpenChange={(o) => { if (wipeStep === null) { setIsDeleteDialogOpen(o); setWipeFailures([]); setDeleteConfirm(''); } }}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="min-h-[40px] border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground">
                    <Trash2 className="w-4 h-4 mr-2" /> Delete all data
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle className="text-destructive">Delete all data</DialogTitle>
                  </DialogHeader>
                  <div className="py-2 space-y-4">
                    <p className="text-sm">
                      This permanently deletes everything in your account: activities, time blocks, tasks and timer sessions, habits, goals, sleep logs,
                      reflections, settings and all derived analytics. It cannot be undone. Your login stays, so you can start fresh.
                    </p>
                    <label className="block">
                      <span className="text-xs font-medium block mb-1">Type DELETE to confirm</span>
                      <Input value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} placeholder="DELETE" className="min-h-[44px]" disabled={wipeStep !== null} />
                    </label>
                    {wipeStep !== null && (
                      <div role="status" aria-live="polite">
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full bg-destructive transition-all" style={{ width: `${(wipeStep / WIPE_ORDER.length) * 100}%` }} />
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">Deleting… {wipeStep} of {WIPE_ORDER.length} tables</p>
                      </div>
                    )}
                    {wipeFailures.length > 0 && (
                      <Notice kind="error">
                        Some data could not be deleted, so nothing was reloaded:
                        <ul className="list-disc pl-5 mt-1 text-xs">
                          {wipeFailures.map((f) => <li key={f.table}><span className="ibm-mono">{f.table}</span>: {f.reason}</li>)}
                        </ul>
                        Try again; if it keeps failing, the backup still has everything.
                      </Notice>
                    )}
                  </div>
                  <DialogFooter>
                    <Button variant="destructive" onClick={() => void handleDeleteData()} disabled={deleteConfirm !== 'DELETE' || wipeStep !== null} className="min-h-[44px]">
                      {wipeStep !== null ? 'Deleting…' : 'Permanently delete everything'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </Row>
          </SettingsCard>
        </div>
      </div>
    </div>
  );
}
