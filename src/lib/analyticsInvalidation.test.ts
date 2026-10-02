import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rpcMock = vi.fn();
// the drain's stale-day sweep reads analytics_daily first; no stale rows here
const emptyQuery: Record<string, unknown> = {
  select: () => emptyQuery, eq: () => emptyQuery, lt: () => emptyQuery,
  then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
};
vi.mock('../supabaseClient', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args), from: () => emptyQuery },
}));
vi.mock('./analyticsRangeCache', () => ({
  invalidateAnalyticsRangeCaches: vi.fn(),
}));

import { markDateDirty, markActivityDirty } from './analyticsInvalidation';
import { invalidateAnalyticsRangeCaches } from './analyticsRangeCache';

/**
 * Covers the debounced drain trigger added in analyticsInvalidation.ts: rapid successive
 * mark-dirty calls must coalesce into one process_dirty_analytics() call (not one per mark), and
 * a failed drain must never throw or otherwise surface to a caller (fire-and-forget philosophy).
 */
describe('analyticsInvalidation drain', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    rpcMock.mockReset();
    vi.mocked(invalidateAnalyticsRangeCaches).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces several mark-dirty calls into a single debounced drain', async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === 'process_dirty_analytics') return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    });

    await markDateDirty('u1', '2026-01-01', 'r1');
    await markDateDirty('u1', '2026-01-02', 'r2');
    await markActivityDirty('u1', 'act1', 'r3');

    expect(rpcMock.mock.calls.filter((c) => c[0] === 'process_dirty_analytics')).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(4000);

    expect(rpcMock.mock.calls.filter((c) => c[0] === 'process_dirty_analytics')).toHaveLength(1);
    expect(invalidateAnalyticsRangeCaches).toHaveBeenCalledTimes(1);
  });

  it('never throws when the drain RPC errors', async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === 'process_dirty_analytics') return Promise.resolve({ data: null, error: { message: 'boom' } });
      return Promise.resolve({ data: null, error: null });
    });

    await markDateDirty('u2', '2026-01-01', 'r1');
    await expect(vi.advanceTimersByTimeAsync(4000)).resolves.not.toThrow();
    expect(invalidateAnalyticsRangeCaches).not.toHaveBeenCalled();
  });

  it('never schedules a drain when the mark-dirty call itself fails', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'nope' } });
    await markDateDirty('u3', '2026-01-01', 'r1');
    await vi.advanceTimersByTimeAsync(10000);
    expect(rpcMock.mock.calls.filter((c) => c[0] === 'process_dirty_analytics')).toHaveLength(0);
  });
});
