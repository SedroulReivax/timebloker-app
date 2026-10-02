import React, { useState } from 'react';
import { format } from 'date-fns';
import type { Activity, Task } from '../types';
import { getDeadlineDateKey, isTimedDeadline } from '../lib/deadlines';

export type TaskEditValues = {
  title: string;
  description: string | null;
  /** "YYYY-MM-DD" (date-only), "YYYY-MM-DDTHH:mm" (timed, local) or null */
  deadline: string | null;
  recurrence_type: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';
  recurrence_rule: string | null;
  estimated_minutes: number | null;
  activity_id: string | null;
  importance: boolean | null;
  urgency: boolean | null;
};

interface TaskEditFormProps {
  task: Task;
  activities: Activity[];
  onSave: (values: TaskEditValues) => void;
  onCancel: () => void;
}

const inputClass =
  'w-full text-sm px-3 py-2 rounded-md bg-background text-foreground placeholder:text-muted-foreground border border-border focus:outline-none focus:ring-1 focus:ring-ring';
const labelClass = 'text-[11px] font-semibold text-muted-foreground ml-1';

const triState = (v: boolean | null | undefined) => (v === true ? 'yes' : v === false ? 'no' : '');
const fromTriState = (v: string): boolean | null => (v === 'yes' ? true : v === 'no' ? false : null);

export const TaskEditForm: React.FC<TaskEditFormProps> = ({ task, activities, onSave, onCancel }) => {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [date, setDate] = useState(task.deadline ? getDeadlineDateKey(task.deadline) : '');
  const [time, setTime] = useState(task.deadline && isTimedDeadline(task.deadline) ? format(new Date(task.deadline), 'HH:mm') : '');
  const [recurrence, setRecurrence] = useState<TaskEditValues['recurrence_type']>(task.recurrence_type ?? 'none');
  const [rule, setRule] = useState(task.recurrence_rule ?? '');
  const [estimate, setEstimate] = useState(task.estimated_minutes ? String(task.estimated_minutes) : '');
  const [activityId, setActivityId] = useState(task.activity_id ?? '');
  const [importance, setImportance] = useState(triState(task.importance));
  const [urgency, setUrgency] = useState(triState(task.urgency));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const minutes = parseInt(estimate, 10);
    onSave({
      title: title.trim(),
      description: description.trim() || null,
      deadline: date ? (time ? `${date}T${time}` : date) : null,
      recurrence_type: recurrence,
      recurrence_rule: recurrence === 'custom' ? rule.trim() || null : null,
      estimated_minutes: minutes > 0 ? minutes : null,
      activity_id: activityId || null,
      importance: fromTriState(importance),
      urgency: fromTriState(urgency),
    });
  };

  return (
    <form
      onSubmit={submit}
      onClick={(e) => e.stopPropagation()}
      className="flex flex-col gap-2 p-3 bg-muted rounded-lg border border-border"
      aria-label={`Edit task ${task.title}`}
    >
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" aria-label="Title" className={inputClass} />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (optional)"
        aria-label="Description"
        className={`${inputClass} min-h-[60px] resize-y`}
      />

      <div className="flex gap-2">
        <div className="flex-1 flex flex-col gap-1">
          <label className={labelClass}>Deadline date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
        </div>
        <div className="flex-1 flex flex-col gap-1">
          <label className={labelClass}>Time (optional)</label>
          <input type="time" value={time} disabled={!date} onChange={(e) => setTime(e.target.value)} className={inputClass} />
        </div>
      </div>

      <div className="flex gap-2">
        <div className="flex-1 flex flex-col gap-1">
          <label className={labelClass}>Recurrence</label>
          <select value={recurrence} onChange={(e) => setRecurrence(e.target.value as TaskEditValues['recurrence_type'])} className={inputClass}>
            <option value="none">None</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        <div className="flex-1 flex flex-col gap-1">
          <label className={labelClass}>Estimated effort (min)</label>
          <input type="number" min={1} inputMode="numeric" value={estimate} onChange={(e) => setEstimate(e.target.value)} placeholder="e.g. 90" className={inputClass} />
        </div>
      </div>

      {recurrence === 'custom' && (
        <input value={rule} onChange={(e) => setRule(e.target.value)} placeholder='e.g. "every 2 weeks"' aria-label="Custom recurrence rule" className={inputClass} />
      )}

      <div className="flex gap-2">
        <div className="flex-1 flex flex-col gap-1">
          <label className={labelClass}>Activity</label>
          <select value={activityId} onChange={(e) => setActivityId(e.target.value)} className={inputClass}>
            <option value="">None</option>
            {activities
              .filter((a) => !a.archived || a.id === task.activity_id)
              .map((a) => (
                <option key={a.id} value={a.id}>{a.emoji ? `${a.emoji} ` : ''}{a.name}</option>
              ))}
          </select>
        </div>
        <div className="flex-1 flex flex-col gap-1">
          <label className={labelClass}>Important</label>
          <select value={importance} onChange={(e) => setImportance(e.target.value)} className={inputClass}>
            <option value="">Not set</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </div>
        <div className="flex-1 flex flex-col gap-1">
          <label className={labelClass}>Urgent</label>
          <select value={urgency} onChange={(e) => setUrgency(e.target.value)} className={inputClass}>
            <option value="">Not set</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-xs font-semibold rounded-md border border-border text-muted-foreground hover:bg-accent">
          Cancel
        </button>
        <button type="submit" disabled={!title.trim()} className="px-3 py-1.5 text-xs font-semibold rounded-md bg-primary text-primary-foreground disabled:opacity-50 hover:opacity-90">
          Save
        </button>
      </div>
    </form>
  );
};
