/**
 * Sleep activity discovery.
 * 1. Activities explicitly flagged `is_sleep_activity` win (multiple allowed).
 * 2. Otherwise fall back to name detection (an activity whose name contains "sleep",
 *    preferring category Health) so existing users keep working until they flag one.
 */
export interface SleepCandidate {
  id: string;
  name: string;
  category?: string | null;
  archived?: boolean | null;
  is_sleep_activity?: boolean | null;
}

export const findSleepActivities = <T extends SleepCandidate>(activities: T[]): T[] => {
  const flagged = activities.filter((a) => a.is_sleep_activity);
  if (flagged.length > 0) return flagged;
  const byName = activities.filter((a) => a.name.toLowerCase().includes('sleep'));
  const preferred = byName.find((a) => a.category === 'Health' && !a.archived) ?? byName.find((a) => !a.archived) ?? byName[0];
  return preferred ? [preferred] : [];
};

export const getSleepActivityIds = (activities: SleepCandidate[]): Set<string> =>
  new Set(findSleepActivities(activities).map((a) => a.id));

/** True when the flag is set or (with no flags anywhere) the name matches. */
export const isSleepActivity = (activity: SleepCandidate, all: SleepCandidate[]): boolean =>
  getSleepActivityIds(all).has(activity.id);
