import { describe, expect, it } from 'vitest';
import { fetchAllRows } from './paging';

const source = Array.from({ length: 2500 }, (_, i) => i);
const page = (from: number, to: number) => Promise.resolve({ data: source.slice(from, to + 1), error: null });

describe('fetchAllRows', () => {
  it('returns every row across pages', async () => {
    const { data, error } = await fetchAllRows<number>(page);
    expect(error).toBeNull();
    expect(data).toHaveLength(2500);
    expect(data[2499]).toBe(2499);
  });

  it('stops on an exact multiple of the page size', async () => {
    const { data } = await fetchAllRows<number>((f, t) => Promise.resolve({ data: source.slice(f, Math.min(t + 1, 2000)), error: null }));
    expect(data).toHaveLength(2000);
  });

  it('returns rows so far plus the error', async () => {
    let calls = 0;
    const { data, error } = await fetchAllRows<number>((f, t) =>
      Promise.resolve(++calls === 2 ? { data: null, error: { message: 'boom' } } : { data: source.slice(f, t + 1), error: null })
    );
    expect(error?.message).toBe('boom');
    expect(data).toHaveLength(1000);
  });

  it('handles empty', async () => {
    expect((await fetchAllRows<number>(() => Promise.resolve({ data: [], error: null }))).data).toEqual([]);
  });
});
