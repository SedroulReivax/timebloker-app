import { useMemo, useState } from 'react';
import { Target, Plus, CheckCircle, XCircle, Trash2, Calendar, Repeat, ChevronDown, Link2 } from 'lucide-react';
import { differenceInDays, format, parseISO } from 'date-fns';
import { useGoalAnalyticsRange } from '../hooks/useAnalyticsRange';
import { applyActivityLinkChange, getGoalHabitProgress, getGoalPace, getGoalReview, goalStartKey, groupGoalDailyRows, mergeGoalDailyLive, type GoalDayMinutes } from '../lib/goals';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from './ui/dialog';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { StatTile, useNerdMode } from './ui/detail';
import { pageClass } from './ui/page';
import { Ring } from './ui/donut';

interface GoalsPageProps {
  goals: any[];
  activities: any[];
  habits: any[];
  blocks: any[];
  habitLogs: any[];
  onAddGoal: (goal: any, linkedActivityIds: string[], linkedHabitIds: string[]) => void;
  onUpdateGoal: (goalId: string, updates: any) => void;
  onDeleteGoal: (goalId: string) => void;
  onCompleteGoal: (goalId: string, note?: string) => void;
  onAbandonGoal: (goalId: string) => void;
}

interface LinkPickerProps {
  activities: any[];
  habits: any[];
  selectedActivities: string[];
  selectedHabits: string[];
  onActivities: (ids: string[]) => void;
  onHabits: (ids: string[]) => void;
}

const toggleId = (ids: string[], id: string, on: boolean) => (on ? [...ids, id] : ids.filter((x) => x !== id));

/** The activity and habit checkbox lists, shared by the create and edit-links dialogs. */
function LinkPicker({ activities, habits, selectedActivities, selectedHabits, onActivities, onHabits }: LinkPickerProps) {
  return (
    <>
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-2 block">Linked Activities</label>
        <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-1">
          {activities.filter((a) => !a.archived || selectedActivities.includes(a.id)).map((a) => (
            <label key={a.id} className="flex items-center gap-2 p-2 border border-border rounded-md cursor-pointer hover:bg-muted min-w-[120px]">
              <input type="checkbox" checked={selectedActivities.includes(a.id)} onChange={(e) => onActivities(toggleId(selectedActivities, a.id, e.target.checked))} />
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: a.color }}></div>
              <span className="text-sm truncate">{a.name}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground mb-2 block">Linked Habits</label>
        <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-1">
          {habits.map((h) => (
            <label key={h.id} className="flex items-center gap-2 p-2 border border-border rounded-md cursor-pointer hover:bg-muted min-w-[120px]">
              <input type="checkbox" checked={selectedHabits.includes(h.id)} onChange={(e) => onHabits(toggleId(selectedHabits, h.id, e.target.checked))} />
              <span className="text-sm truncate">{h.name}</span>
            </label>
          ))}
        </div>
      </div>
    </>
  );
}

export function GoalsPage({
  goals,
  activities,
  habits,
  blocks,
  habitLogs,
  onAddGoal,
  onUpdateGoal,
  onDeleteGoal,
  onCompleteGoal,
  onAbandonGoal
}: GoalsPageProps) {
  // Historical progress comes from the backend's per-goal daily aggregate
  // (analytics_goal_daily), not a raw block scan since each goal started; the currently-selected/live date is overlaid on top per goal, the same
  // pattern useBlockRange/mergeLiveBlocks uses for other range views.
  const earliestStart = useMemo(
    () => goals.map((g) => goalStartKey(g)).filter((k): k is string => !!k).sort()[0] ?? format(new Date(), 'yyyy-MM-dd'),
    [goals]
  );
  const todayKey = format(new Date(), 'yyyy-MM-dd');
  const goalTo = earliestStart > todayKey ? earliestStart : todayKey;
  const { rows: goalDailyRows } = useGoalAnalyticsRange(earliestStart, goalTo);
  const goalDailyByGoal = useMemo<Map<string, GoalDayMinutes[]>>(() => groupGoalDailyRows(goalDailyRows as any[]), [goalDailyRows]);

  const dailyFor = (goal: any): GoalDayMinutes[] => mergeGoalDailyLive(goalDailyByGoal.get(goal.id) ?? [], goal, blocks);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newDate, setNewDate] = useState('');
  const [newHours, setNewHours] = useState('');
  const [newEmoji, setNewEmoji] = useState('🎯');
  const [selectedActivities, setSelectedActivities] = useState<string[]>([]);
  const [selectedHabits, setSelectedHabits] = useState<string[]>([]);
  const [showCompleted, setShowCompleted] = useState(false);

  const [completeNote, setCompleteNote] = useState('');
  const [completingGoalId, setCompletingGoalId] = useState<string | null>(null);
  const [abandoningGoalId, setAbandoningGoalId] = useState<string | null>(null);

  const handleAddSubmit = () => {
    onAddGoal(
      {
        title: newTitle,
        description: newDesc,
        target_date: newDate || null,
        target_hours: newHours ? parseFloat(newHours) : null,
        emoji: newEmoji,
      },
      selectedActivities,
      selectedHabits
    );
    setIsAddOpen(false);
    setNewTitle('');
    setNewDesc('');
    setNewDate('');
    setNewHours('');
    setNewEmoji('🎯');
    setSelectedActivities([]);
    setSelectedHabits([]);
  };

  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [editActivities, setEditActivities] = useState<string[]>([]);
  const [editHabits, setEditHabits] = useState<string[]>([]);
  const openEditLinks = (goal: any) => {
    setEditActivities(goal.linked_activity_ids ?? []);
    setEditHabits(goal.linked_habit_ids ?? []);
    setEditingGoalId(goal.id);
  };
  // Newly linked activities start counting today and unlinked ones stop after today (applyActivityLinkChange)
  const handleEditSubmit = (goal: any) => {
    onUpdateGoal(goal.id, {
      linked_activity_ids: editActivities,
      linked_activity_ranges: applyActivityLinkChange(goal, editActivities, format(new Date(), 'yyyy-MM-dd')),
      linked_habit_ids: editHabits,
    });
    setEditingGoalId(null);
  };

  const handleCompleteSubmit = () => {
    if (completingGoalId) {
      onCompleteGoal(completingGoalId, completeNote);
      setCompletingGoalId(null);
      setCompleteNote('');
    }
  };

  const activeGoals = goals.filter(g => g.status === 'active');
  const pastGoals = goals.filter(g => g.status !== 'active');
  const { nerd } = useNerdMode();
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const toggleOpen = (id: string) => setOpenIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const paces = useMemo(() => new Map(activeGoals.map((g) => [g.id, getGoalPace(g, dailyFor(g))])), [activeGoals, goalDailyByGoal, blocks]);
  const behind = activeGoals.filter((g) => { const p = paces.get(g.id); return p && p.requiredWeekly !== null && p.currentWeekly < p.requiredWeekly; }).length;
  const onPace = activeGoals.filter((g) => { const p = paces.get(g.id); return p && p.requiredWeekly !== null && p.currentWeekly >= p.requiredWeekly; }).length;

  return (
    <div className={`${pageClass('wide')} pb-20`}>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Target className="w-5 h-5 text-primary" /> Goals
        </h1>
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button className="min-h-[44px] flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add Goal
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Create New Goal</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="flex gap-4">
                <div className="w-16">
                  <label className="text-xs font-medium text-muted-foreground">Emoji</label>
                  <Input value={newEmoji} onChange={e => setNewEmoji(e.target.value)} className="text-center text-xl min-h-[44px]" />
                </div>
                <div className="flex-1">
                  <label className="text-xs font-medium text-muted-foreground">Title</label>
                  <Input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="e.g. Learn Spanish" className="min-h-[44px]" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Description (Optional)</label>
                <textarea
                  value={newDesc}
                  onChange={e => setNewDesc(e.target.value)}
                  className="w-full bg-background border border-border rounded-md p-3 text-sm min-h-[80px]"
                />
              </div>
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="text-xs font-medium text-muted-foreground">Target Date</label>
                  <Input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} className="min-h-[44px] ibm-mono" />
                </div>
                <div className="flex-1">
                  <label className="text-xs font-medium text-muted-foreground">Target Hours (Optional)</label>
                  <Input type="number" step="0.5" value={newHours} onChange={e => setNewHours(e.target.value)} placeholder="e.g. 100" className="min-h-[44px] ibm-mono" />
                </div>
              </div>

              <LinkPicker
                activities={activities} habits={habits}
                selectedActivities={selectedActivities} selectedHabits={selectedHabits}
                onActivities={setSelectedActivities} onHabits={setSelectedHabits}
              />
            </div>
            <DialogFooter>
              <Button onClick={handleAddSubmit} disabled={!newTitle.trim()} className="min-h-[44px]">Save Goal</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {activeGoals.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <StatTile label="Active" value={String(activeGoals.length)} />
          <StatTile label="On pace" value={<span className="text-green-600 dark:text-green-400">{onPace}</span>} sub="for their target date" />
          <StatTile label="Behind" value={<span className={behind ? 'text-amber-600 dark:text-amber-400' : ''}>{behind}</span>} sub="need more hours a week" />
        </div>
      )}

      {activeGoals.length === 0 ? (
        <div className="text-center py-20 bg-card border border-border rounded-xl">
          <Target className="w-12 h-12 text-muted mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-muted-foreground">No active goals</h3>
          <p className="text-sm text-muted-foreground mb-6">Add one to start tracking your progress.</p>
          <Button onClick={() => setIsAddOpen(true)} className="min-h-[44px]">
            <Plus className="w-4 h-4 mr-2" /> Add Goal
          </Button>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 2xl:grid-cols-3 uw:grid-cols-4 gap-4 items-start">
          {activeGoals.map(goal => {
            const linkedActivities = goal.linked_activity_ids?.map((id: string) => activities.find(a => a.id === id)).filter(Boolean) || [];
            const linkedHabits = goal.linked_habit_ids?.map((id: string) => habits.find(h => h.id === id)).filter(Boolean) || [];

            const pace = paces.get(goal.id) ?? getGoalPace(goal, dailyFor(goal));
            const open = nerd || openIds.has(goal.id);
            const progressHours = pace.hours;
            const habitProgress = getGoalHabitProgress(goal, habitLogs);

            let daysRemaining = null;
            let dateColor = 'text-muted-foreground';
            if (goal.target_date) {
              const target = parseISO(goal.target_date);
              daysRemaining = differenceInDays(target, new Date());
              if (daysRemaining < 0) dateColor = 'text-red-500';
              else if (daysRemaining < 7) dateColor = 'text-amber-500';
              else dateColor = 'text-green-500';
            }

            return (
              <div key={goal.id} className="bg-card border border-border rounded-2xl p-4 md:p-5 shadow-sm flex flex-col">
                <button
                  onClick={() => toggleOpen(goal.id)}
                  aria-expanded={open}
                  className="flex justify-between items-start gap-2 text-left -m-1 p-1 rounded-lg hover:bg-accent/40"
                >
                  <h3 className="text-base font-semibold flex items-center gap-2 min-w-0">
                    <span>{goal.emoji}</span> <span className="truncate">{goal.title}</span>
                    {!nerd && <ChevronDown size={14} className={`flex-shrink-0 text-muted-foreground transition-transform ${open ? '' : '-rotate-90'}`} />}
                  </h3>
                  {goal.target_date && (
                    <div className={`text-xs font-medium flex items-center gap-1 ${dateColor} bg-muted px-2 py-1 rounded-md`}>
                      <Calendar className="w-3 h-3" />
                      {daysRemaining !== null && daysRemaining < 0 ? `${Math.abs(daysRemaining)}d overdue` : `${daysRemaining}d left`}
                    </div>
                  )}
                </button>

                {goal.target_hours && (
                  <div className="pt-3 flex items-center gap-4">
                    <Ring pct={progressHours / goal.target_hours} size={64} color={pace.requiredWeekly !== null && pace.currentWeekly < pace.requiredWeekly ? 'hsl(38 92% 50%)' : 'hsl(var(--primary))'} />
                    <div className="text-xs space-y-0.5 min-w-0">
                      <div className="ibm-mono font-medium text-sm">{progressHours.toFixed(1)} / {goal.target_hours} h</div>
                      <div className="text-muted-foreground">{pace.currentWeekly.toFixed(1)}h a week{pace.requiredWeekly !== null ? ` · needs ${pace.requiredWeekly.toFixed(1)}` : ''}</div>
                    </div>
                  </div>
                )}

                {open && <div className="animate-in fade-in duration-200">
                {goal.description && (
                  <p className="text-sm text-muted-foreground mt-3">{goal.description}</p>
                )}

                {goal.target_hours && (
                  <div className="pt-3">
                    <div className="text-[11px] text-muted-foreground space-y-0.5">
                      <div>Current pace: {pace.currentWeekly.toFixed(1)}h/week{pace.weeksToTarget !== null ? ` · ~${Math.ceil(pace.weeksToTarget)} week${Math.ceil(pace.weeksToTarget) === 1 ? '' : 's'} to target at this pace` : ''}</div>
                      {pace.requiredWeekly !== null && (
                        <div className={pace.currentWeekly < pace.requiredWeekly ? 'text-amber-600 dark:text-amber-400' : ''}>
                          Required to finish by the target date: {pace.requiredWeekly.toFixed(1)}h/week
                        </div>
                      )}
                      <div>Counting time logged since {goalStartKey(goal) ?? 'the start'}.</div>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 mt-3">
                  {linkedActivities.map((a: any) => (
                    <span key={a.id} className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-muted rounded-md border border-border">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: a.color }}></div>
                      {a.name}
                    </span>
                  ))}
                  {linkedHabits.map((h: any) => {
                    const hp = habitProgress.find((x) => x.habitId === h.id);
                    return (
                      <span key={h.id} className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-muted rounded-md border border-border">
                        <Repeat className="w-3 h-3" />
                        {h.name}
                        {hp && <span className="text-muted-foreground">· {hp.daysLogged}/{hp.daysElapsed} days ({hp.perWeek.toFixed(1)}/wk)</span>}
                      </span>
                    );
                  })}
                </div>

                </div>}

                <div className="flex gap-2 mt-4 pt-3 border-t border-border">
                  <Dialog open={editingGoalId === goal.id} onOpenChange={(o) => !o && setEditingGoalId(null)}>
                    <DialogTrigger asChild>
                      <Button variant="ghost" className="min-h-[44px] px-3 text-muted-foreground" aria-label="Edit links" title="Edit linked activities and habits" onClick={() => openEditLinks(goal)}>
                        <Link2 className="w-4 h-4" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[500px]">
                      <DialogHeader>
                        <DialogTitle>Edit links · {goal.title}</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <LinkPicker
                          activities={activities} habits={habits}
                          selectedActivities={editActivities} selectedHabits={editHabits}
                          onActivities={setEditActivities} onHabits={setEditHabits}
                        />
                        <p className="text-xs text-muted-foreground">New activities count from today. Unlinked ones keep the hours they already added.</p>
                      </div>
                      <DialogFooter>
                        <Button onClick={() => handleEditSubmit(goal)} className="min-h-[44px]">Save links</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>

                  <Dialog open={completingGoalId === goal.id} onOpenChange={(open) => !open && setCompletingGoalId(null)}>
                    <DialogTrigger asChild>
                      <Button variant="outline" className="flex-1 min-h-[44px] text-green-500 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-950" onClick={() => setCompletingGoalId(goal.id)}>
                        <CheckCircle className="w-4 h-4 mr-2" /> Complete
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Complete Goal</DialogTitle>
                      </DialogHeader>
                      <div className="py-4">
                        <label className="text-sm font-medium text-muted-foreground block mb-2">Reflection Note (Optional)</label>
                        <textarea
                          value={completeNote}
                          onChange={e => setCompleteNote(e.target.value)}
                          className="w-full bg-background border border-border rounded-md p-3 text-sm min-h-[100px]"
                          placeholder="How did it go? What did you learn?"
                        />
                      </div>
                      <DialogFooter>
                        <Button onClick={handleCompleteSubmit} className="min-h-[44px]">Confirm Completion</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>

                  <Dialog open={abandoningGoalId === goal.id} onOpenChange={(open) => !open && setAbandoningGoalId(null)}>
                    <DialogTrigger asChild>
                      <Button variant="ghost" className="min-h-[44px] px-3 text-muted-foreground hover:text-red-500" onClick={() => setAbandoningGoalId(goal.id)}>
                        <XCircle className="w-4 h-4" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Abandon Goal?</DialogTitle>
                      </DialogHeader>
                      <p className="py-4 text-sm text-muted-foreground">Are you sure you want to abandon this goal? It will be moved to the completed section as abandoned.</p>
                      <DialogFooter>
                        <Button variant="destructive" onClick={() => { onAbandonGoal(goal.id); setAbandoningGoalId(null); }} className="min-h-[44px]">Abandon Goal</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>

                  <Button variant="ghost" className="min-h-[44px] px-3 text-muted-foreground" onClick={() => onDeleteGoal(goal.id)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {pastGoals.length > 0 && (
        <div className="mt-10">
          <button
            onClick={() => setShowCompleted(!showCompleted)}
            className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground mb-4 min-h-[44px]"
          >
            {showCompleted ? 'Hide' : 'Show'} Completed & Abandoned ({pastGoals.length})
          </button>

          {showCompleted && (
            <div className="grid md:grid-cols-2 2xl:grid-cols-3 uw:grid-cols-4 gap-4 opacity-75">
              {pastGoals.map(goal => (
                <div key={goal.id} className="bg-muted border border-border rounded-xl p-4">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-bold flex items-center gap-2 line-through text-muted-foreground">
                      <span>{goal.emoji}</span> {goal.title}
                    </h3>
                    <span className={`text-xs px-2 py-1 rounded-md border ${goal.status === 'completed' ? 'border-green-500/30 text-green-500' : 'border-red-500/30 text-red-500'}`}>
                      {goal.status}
                    </span>
                  </div>
                  {(() => {
                    const rv = getGoalReview(goal, dailyFor(goal), habitLogs);
                    const names = (goal.linked_habit_ids || []).map((id: string) => habits.find((h) => h.id === id)?.name).filter(Boolean);
                    return (
                      <dl className="text-xs text-muted-foreground grid grid-cols-2 gap-x-3 gap-y-1 mt-2">
                        <dt>Started</dt><dd className="text-foreground">{rv.startKey ?? '—'}</dd>
                        <dt>{goal.status === 'completed' ? 'Completed' : 'Closed'}</dt><dd className="text-foreground">{rv.endKey ?? '—'}</dd>
                        <dt>Actual hours</dt><dd className="text-foreground">{rv.actualHours.toFixed(1)}h</dd>
                        <dt>Planned hours</dt><dd className="text-foreground">{rv.plannedHours !== null ? `${rv.plannedHours}h` : '—'}</dd>
                        {names.length > 0 && (<><dt>Habits</dt><dd className="text-foreground">{names.join(', ')}</dd></>)}
                      </dl>
                    );
                  })()}
                  {goal.completion_note && (
                    <div className="text-sm italic text-muted-foreground bg-background/50 p-2 rounded mt-2 border border-border">
                      "{goal.completion_note}"
                    </div>
                  )}
                  <div className="flex justify-end mt-4">
                    <Button variant="ghost" size="sm" onClick={() => onDeleteGoal(goal.id)} className="text-muted-foreground hover:text-red-500">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
