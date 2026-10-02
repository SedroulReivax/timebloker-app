import { describe, expect, it, vi } from 'vitest';

// A fake table store: deletes succeed except on tables listed in `blocked`, which keep their rows silently,
// the way row-level security answers a disallowed delete.
const rows = new Map<string, number>();
const blocked = new Set<string>();
const calls: string[] = [];
vi.mock('../supabaseClient', () => ({
  supabase: {
    from: (table: string) => ({
      delete: () => ({ eq: async () => { calls.push(table); if (!blocked.has(table)) rows.set(table, 0); return { error: null }; } }),
      select: () => ({ eq: async () => ({ count: rows.get(table) ?? 0, error: null }) }),
    }),
  },
}));

import { deleteAllUserData, WIPE_ORDER } from './accountData';

describe('deleteAllUserData', () => {
  it('clears every table in order and reports none when all deletes land', async () => {
    for (const t of WIPE_ORDER) rows.set(t, 3);
    blocked.clear(); calls.length = 0;
    const steps: number[] = [];
    expect(await deleteAllUserData('u1', (done) => steps.push(done))).toEqual([]);
    expect(calls).toEqual([...WIPE_ORDER]);
    expect(steps[steps.length - 1]).toBe(WIPE_ORDER.length);
  });

  it('reports a table whose rows survive a "successful" delete instead of passing silently', async () => {
    for (const t of WIPE_ORDER) rows.set(t, 2);
    blocked.clear(); blocked.add('analytics_daily');
    expect(await deleteAllUserData('u1')).toEqual([{ table: 'analytics_daily', reason: '2 rows could not be deleted' }]);
  });
});
