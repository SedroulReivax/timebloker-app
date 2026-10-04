/**
 * Warm a page's code chunk before it is opened (on hover or keyboard focus of its nav item), so switching pages feels
 * instant while the first load stays small. Each import resolves to the same chunk the page's lazy() uses.
 */
const loaders: Record<string, () => Promise<unknown>> = {
  focus: () => import('../components/FocusMode'),
  matrix: () => import('../components/EisenhowerMatrix'),
  analysis: () => import('../components/AnalysisHub'),
  activities: () => import('../components/ActivitiesManager'),
  sleep: () => import('../components/SleepHub'),
  goals: () => import('../components/GoalsPage'),
  export: () => import('../components/ExportPage'),
  settings: () => import('../components/SettingsPage'),
};

const done = new Set<string>();

export const prefetchView = (view: string) => {
  if (done.has(view) || !loaders[view]) return;
  done.add(view);
  loaders[view]().catch(() => done.delete(view));
};
