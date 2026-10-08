import { describe, expect, it, vi } from 'vitest';
import { createRangeCache } from './analyticsRangeCache';

interface Row { date_key: string }
const day = (k: string): Row => ({ date_key: k });
const all = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05'].map(day);
const fetcher = () => vi.fn(async (from: string, to: string) => all.filter((r) => r.date_key >= from && r.date_key <= to));

describe('createRangeCache', () => {
  it('serves the same range twice from one request', async () => {
    const f = fetcher();
    const c = createRangeCache<Row>(f, (r) => r.date_key);
    await c.getRange('u', '2026-09-01', '2026-09-05');
    await c.getRange('u', '2026-09-01', '2026-09-05');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('answers a range inside a cached one by cutting it down, without a request', async () => {
    const f = fetcher();
    const c = createRangeCache<Row>(f, (r) => r.date_key);
    await c.getRange('u', '2026-09-01', '2026-09-05');
    const inner = await c.getRange('u', '2026-09-02', '2026-09-04');
    expect(inner.map((r) => r.date_key)).toEqual(['2026-09-02', '2026-09-03', '2026-09-04']);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('fetches when the range is not covered, for another user, or when it cannot be sliced', async () => {
    const f = fetcher();
    const c = createRangeCache<Row>(f, (r) => r.date_key);
    await c.getRange('u', '2026-09-02', '2026-09-03');
    await c.getRange('u', '2026-09-01', '2026-09-03'); // starts earlier than anything cached
    await c.getRange('other', '2026-09-02', '2026-09-03'); // different user
    expect(f).toHaveBeenCalledTimes(3);

    const g = fetcher();
    const totals = createRangeCache<Row>(g); // no dateOf: exact-key only (range totals can't be sliced)
    await totals.getRange('u', '2026-09-01', '2026-09-05');
    await totals.getRange('u', '2026-09-02', '2026-09-04');
    expect(g).toHaveBeenCalledTimes(2);
  });

  it('forgets everything on invalidate', async () => {
    const f = fetcher();
    const c = createRangeCache<Row>(f, (r) => r.date_key);
    await c.getRange('u', '2026-09-01', '2026-09-05');
    c.invalidate();
    await c.getRange('u', '2026-09-02', '2026-09-03');
    expect(f).toHaveBeenCalledTimes(2);
  });
});
