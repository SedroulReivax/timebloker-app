import React, { useState } from 'react';
import { useNerdMode } from './ui/detail';
import { Plus, Trash2, Palette, Edit2 } from 'lucide-react';
import type { Activity, ActivityCategory } from '../types';
import { formatMultiplier, multiplierTone } from '../lib/activityFlags';

interface ActivitiesManagerProps {
  activities: Activity[];
  onAddActivity: (activity: Omit<Activity, 'id'>) => void;
  onUpdateActivity: (id: string, updates: Partial<Activity>) => void;
  onArchiveActivity: (id: string) => void;
}

const PREDEFINED_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#84cc16', '#22c55e', '#10b981', '#14b8a6',
  '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
  '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
];

const CATEGORY_ORDER: ActivityCategory[] = ['Work', 'Admin', 'Health', 'Leisure', 'Other'];

const CATEGORY_META: Record<ActivityCategory, { label: string; accent: string; dot: string }> = {
  Work:    { label: 'Work',    accent: 'text-blue-600 dark:text-blue-400',   dot: 'bg-blue-500' },
  Admin:   { label: 'Admin',   accent: 'text-purple-600 dark:text-purple-400', dot: 'bg-purple-500' },
  Health:  { label: 'Health',  accent: 'text-green-600 dark:text-green-400',  dot: 'bg-green-500' },
  Leisure: { label: 'Leisure', accent: 'text-amber-600 dark:text-amber-400',  dot: 'bg-amber-500' },
  Other:   { label: 'Other',   accent: 'text-slate-500 dark:text-slate-400',  dot: 'bg-slate-400' },
};

const getNormalizedCategory = (cat?: string): ActivityCategory => {
  if (cat === 'Work' || cat === 'Admin' || cat === 'Health' || cat === 'Leisure') return cat;
  return 'Other';
};

// Productivity multipliers and "ignore in analysis" live in Settings → Analysis, not in this editor, so editing a
// name or colour here can never reset them.
type EditorData = { name: string; emoji: string; color: string; category: Activity['category']; is_sleep_activity: boolean };

// Reusable Apple-esque Editor Component
const ActivityEditor = ({
  initialName = '',
  initialEmoji = '🔥',
  initialColor = '#3b82f6',
  initialCategory = 'Work',
  initialSleep = false,
  onSave,
  onCancel,
  saveLabel = 'Save'
}: {
  initialName?: string;
  initialEmoji?: string;
  initialColor?: string;
  initialCategory?: Activity['category'];
  initialSleep?: boolean;
  onSave: (data: EditorData) => void;
  onCancel: () => void;
  saveLabel?: string;
}) => {
  const [name, setName] = useState(initialName);
  const [emoji, setEmoji] = useState(initialEmoji);
  const [color, setColor] = useState(initialColor);
  const [category, setCategory] = useState<Activity['category']>(initialCategory);
  const [isSleep, setIsSleep] = useState(initialSleep);

  return (
    <div className="p-4 sm:p-5 border border-border rounded-2xl bg-card shadow-sm space-y-5 animate-in fade-in slide-in-from-bottom-2">
      {/* Live Preview / Header */}
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-2 block">Live Preview</label>
        <div
          className="flex items-center gap-3 p-3 rounded-xl border border-border/50 bg-background transition-all duration-200"
          style={{ backgroundColor: `${color}15`, borderLeft: `4px solid ${color}` }}
        >
          <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition-colors duration-200" style={{ backgroundColor: `${color}20` }}>
            <input
              value={emoji}
              onChange={e => setEmoji(e.target.value)}
              className="w-full text-center bg-transparent border-none focus:ring-0 text-xl p-0 outline-none"
              maxLength={3}
              placeholder="📝"
            />
          </div>
          <div className="flex-1 min-w-0 flex flex-col">
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="bg-transparent border-none p-0 focus:ring-0 font-bold text-foreground placeholder:text-muted-foreground w-full outline-none text-base"
              placeholder="Activity Name"
              autoFocus
            />
            <select
              value={category}
              onChange={e => setCategory(e.target.value as Activity['category'])}
              className="bg-transparent border-none p-0 text-[11px] font-bold focus:ring-0 cursor-pointer outline-none w-auto -ml-0.5 mt-0.5 transition-colors duration-200 text-muted-foreground"
            >
              <option value="Work">Work</option>
              <option value="Admin">Admin</option>
              <option value="Health">Health</option>
              <option value="Leisure">Leisure</option>
              <option value="Other">Other</option>
            </select>
          </div>
        </div>
      </div>

      {/* Color Picker Section */}
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-2 block">Theme Color</label>
        <div className="flex flex-wrap gap-2 items-center">
          {PREDEFINED_COLORS.map(c => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`w-6 h-6 sm:w-8 sm:h-8 rounded-full transition-all duration-200 ${color === c ? 'scale-110 ring-2 ring-primary ring-offset-2 ring-offset-background' : 'hover:scale-110 border border-border/50'}`}
              style={{ backgroundColor: c }}
              title={c}
            />
          ))}
          <div className="w-px h-6 bg-border mx-2" />
          <div className="flex items-center gap-2">
            <div className="relative w-8 h-8 rounded-full overflow-hidden border border-border shadow-sm focus-within:ring-2 ring-primary cursor-pointer transition-transform hover:scale-105 shrink-0">
              <input
                type="color"
                value={color}
                onChange={e => setColor(e.target.value)}
                className="absolute -top-2 -left-2 w-12 h-12 cursor-pointer"
                title="Custom Color"
              />
            </div>
            <input
              type="text"
              value={color}
              onChange={e => setColor(e.target.value)}
              className="w-20 px-2 py-1 text-xs font-mono border border-border rounded-md bg-background focus:ring-1 ring-primary outline-none transition-colors"
              placeholder="#000000"
              maxLength={7}
            />
          </div>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">Productivity multiplier and "ignore in analysis" are set in Settings → Analysis.</p>

      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked={isSleep} onChange={(e) => setIsSleep(e.target.checked)} className="w-4 h-4 accent-primary" />
        <span>This is my sleep activity <span className="text-muted-foreground">(used by sleep tracking)</span></span>
      </label>

      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onCancel} className="px-4 py-2 text-sm font-medium hover:bg-accent rounded-xl transition-colors text-muted-foreground hover:text-foreground">
          Cancel
        </button>
        <button
          onClick={() => onSave({ name: name.trim(), emoji: emoji.trim(), color, category, is_sleep_activity: isSleep })}
          disabled={!name.trim()}
          className="px-5 py-2 text-sm font-semibold bg-primary text-primary-foreground rounded-xl hover:opacity-90 transition-all active:scale-95 disabled:opacity-50 shadow-sm"
        >
          {saveLabel}
        </button>
      </div>
    </div>
  );
};


export const ActivitiesManager: React.FC<ActivitiesManagerProps> = ({
  activities,
  onAddActivity,
  onUpdateActivity,
  onArchiveActivity,
}) => {
  const { nerd } = useNerdMode();
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const handleAdd = (data: EditorData) => {
    onAddActivity(data);
    setIsAdding(false);
  };

  const handleUpdate = (id: string, data: EditorData) => {
    onUpdateActivity(id, data);
    setEditingId(null);
  };

  return (
    <div className="flex flex-col flex-1 h-full bg-background p-3 sm:p-4 md:p-6 lg:p-8 overflow-y-auto relative pb-24">
      <div className="max-w-3xl 2xl:max-w-5xl uw:max-w-7xl mx-auto w-full flex flex-col h-full page-enter">
        <div className="mb-5 flex-shrink-0 flex items-baseline justify-between">
          <h2 className="text-xl font-bold tracking-tight">Activities</h2>
          <span className="text-xs text-muted-foreground">{activities.filter((a) => !a.archived).length} active · tap one to edit</span>
        </div>

        {/* Add New Activity Inline */}
        {isAdding && (
          <div className="mb-8">
            <ActivityEditor
              onSave={handleAdd}
              onCancel={() => setIsAdding(false)}
              saveLabel="Create Activity"
            />
          </div>
        )}

        {/* Empty State */}
        {!isAdding && activities.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 bg-accent rounded-full flex items-center justify-center mb-4">
              <Palette className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">No activities yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm mb-6">Create activities to categorize your time blocks and track your productivity.</p>
            <button
              onClick={() => setIsAdding(true)}
              className="px-6 py-2.5 bg-primary text-primary-foreground rounded-full font-semibold shadow-sm hover:opacity-90 transition-opacity"
            >
              Add First Activity
            </button>
          </div>
        )}

        {/* Existing Activities List */}
        <div className="space-y-6">
          {CATEGORY_ORDER.map(category => {
            const group = activities.filter(a => !a.archived && getNormalizedCategory(a.category) === category);
            if (group.length === 0) return null;
            const meta = CATEGORY_META[category];

            return (
              <div key={category} className="animate-in fade-in">
                {/* Category Header */}
                <div className="flex items-center gap-2 mb-2.5 px-1">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${meta.dot}`} />
                  <span className={`text-xs font-semibold ${meta.accent}`}>{meta.label}</span>
                  <div className="flex-1 h-px bg-border/50 ml-2" />
                </div>

                {/* Activities Grid */}
                <div className="grid md:grid-cols-2 uw:grid-cols-3 gap-2.5">
                  {group.map(activity => (
                    <div key={activity.id}>
                      {editingId === activity.id ? (
                        <ActivityEditor
                          initialName={activity.name}
                          initialEmoji={activity.emoji}
                          initialColor={activity.color}
                          initialCategory={activity.category}
                          initialSleep={!!activity.is_sleep_activity}
                          onSave={(data) => handleUpdate(activity.id, data)}
                          onCancel={() => setEditingId(null)}
                          saveLabel="Save Changes"
                        />
                      ) : (
                        <div
                          onClick={() => setEditingId(activity.id)}
                          className="group flex items-center justify-between gap-3 px-3.5 py-3 border border-border/60 rounded-2xl bg-card hover:bg-accent/30 hover:border-border cursor-pointer transition-all duration-200"
                        >
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div
                              className="flex items-center justify-center w-9 h-9 rounded-full flex-shrink-0 shadow-sm"
                              style={{ backgroundColor: activity.color + '20', color: activity.color }}
                            >
                              <span className="text-lg">{activity.emoji || <Palette size={16} />}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <h4 className="font-semibold text-foreground truncate">{activity.name}</h4>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span className="text-[11px] font-medium opacity-70 truncate" style={{ color: activity.color }}>
                                  {activity.category || 'WORK'}
                                </span>
                                {nerd && !!activity.productivity_multiplier && !activity.analysis_ignored && (
                                  <span className={`text-[10px] font-bold ibm-mono ${multiplierTone(activity.productivity_multiplier)}`} title="Set in Settings → Analysis">
                                    {formatMultiplier(activity.productivity_multiplier)}
                                  </span>
                                )}
                                {nerd && !!activity.analysis_ignored && (
                                  <span className="text-[10px] text-muted-foreground" title="Set in Settings → Analysis">ignored</span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 focus-visible:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (confirm(`Archive "${activity.name}"? It will be hidden from new scheduling, but past time blocks and history keep it.`)) {
                                  onArchiveActivity(activity.id);
                                }
                              }}
                              className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-xl transition-colors"
                              title="Archive Activity" aria-label={`Archive ${activity.name}`}
                            >
                              <Trash2 size={16} />
                            </button>
                            <div className="p-2 text-muted-foreground hover:text-foreground rounded-xl transition-colors">
                              <Edit2 size={16} />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* FAB for Adding Activity */}
      {!isAdding && (
        <button
          onClick={() => setIsAdding(true)}
          className="fixed bottom-[calc(5.5rem+var(--safe-b))] lg:bottom-10 right-5 lg:right-10 w-14 h-14 bg-primary text-primary-foreground rounded-full flex items-center justify-center shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition-all z-40 animate-in zoom-in-50 duration-200"
          title="Add Activity"
        >
          <Plus size={24} />
        </button>
      )}
    </div>
  );
};
