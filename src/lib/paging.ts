/**
 * Fetch every row of a query in pages (PostgREST silently caps a single response at ~1000 rows).
 * `page(from, to)` must run the same ordered query for the inclusive range [from, to].
 */
export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>,
  pageSize = 1000
): Promise<{ data: T[]; error: { message?: string } | null }> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) return { data: all, error };
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
  }
  return { data: all, error: null };
}
