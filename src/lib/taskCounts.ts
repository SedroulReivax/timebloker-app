import type { Task } from '../types';

const isRecurring = (t: Task) => !!t.recurrence_type && t.recurrence_type !== 'none';

export interface TaskGroups {
  inbox: Task[];
  scheduled: Task[];
  recurring: Task[];
  completed: Task[];
}

export const groupTasks = (tasks: Task[]): TaskGroups => ({
  inbox: tasks.filter(t => !t.completed && !t.deadline && !isRecurring(t)),
  scheduled: tasks.filter(t => !t.completed && !!t.deadline && !isRecurring(t)),
  recurring: tasks.filter(t => !t.completed && isRecurring(t)),
  completed: tasks.filter(t => t.completed),
});

/** Active = not completed: inbox + scheduled + recurring. */
export const countActiveTasks = (tasks: Task[]): number => {
  const g = groupTasks(tasks);
  return g.inbox.length + g.scheduled.length + g.recurring.length;
};
