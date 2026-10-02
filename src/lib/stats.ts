/**
 * Small, dependency-free statistics toolkit used by the analysis engines.
 * Everything that resamples is seeded, so results are reproducible (same data -> same answer).
 */

export const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

/** Linear-interpolated quantile (q in 0..1). */
export const quantile = (xs: number[], q: number): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
};

export const median = (xs: number[]): number | null => quantile(xs, 0.5);

export const stdev = (xs: number[]): number | null => {
  if (xs.length < 2) return null;
  const m = mean(xs)!;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
};

// ─── Seeded randomness ───────────────────────────────────────────────────────

export const mulberry32 = (seed: number) => () => {
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Stable seed from data so the same input always resamples the same way. */
export const seedFrom = (xs: number[]): number => {
  let h = 2166136261;
  for (const x of xs) h = Math.imul(h ^ (Math.round(x * 1000) | 0), 16777619);
  return h >>> 0;
};

// ─── Proportions ─────────────────────────────────────────────────────────────

export interface Proportion { p: number | null; lo: number | null; hi: number | null; n: number }

/**
 * Wilson score interval for a proportion. Behaves well for small n and for p near 0 or 1, unlike the
 * normal approximation. z = 1.2816 gives an 80% interval, 1.96 gives 95%.
 */
export const wilson = (successes: number, n: number, z = 1.2816): Proportion => {
  if (n <= 0) return { p: null, lo: null, hi: null, n: 0 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half), n };
};

// ─── Bootstrap ───────────────────────────────────────────────────────────────

export interface Interval { estimate: number | null; lo: number | null; hi: number | null; n: number }

/** Percentile bootstrap interval of `stat` over `values`. */
export const bootstrapCI = (values: number[], stat: (xs: number[]) => number | null, opts: { B?: number; level?: number; seed?: number } = {}): Interval => {
  const n = values.length;
  const est = stat(values);
  if (n < 2) return { estimate: est, lo: null, hi: null, n };
  const B = opts.B ?? 400;
  const level = opts.level ?? 0.8;
  const rand = mulberry32(opts.seed ?? seedFrom(values));
  const draws: number[] = [];
  const buf = new Array<number>(n);
  for (let b = 0; b < B; b++) {
    for (let i = 0; i < n; i++) buf[i] = values[Math.floor(rand() * n)];
    const v = stat(buf);
    if (v !== null && Number.isFinite(v)) draws.push(v);
  }
  return { estimate: est, lo: quantile(draws, (1 - level) / 2), hi: quantile(draws, 1 - (1 - level) / 2), n };
};

export type ChangeDirection = 'up' | 'down' | 'flat';

export interface ChangeResult {
  current: number | null;
  previous: number | null;
  /** current - previous (same units as the values) */
  delta: number | null;
  lo: number | null;
  hi: number | null;
  /** 'flat' when the interval includes zero, or when there is too little data to say */
  direction: ChangeDirection;
  /** true when both sides have at least `minEach` observations */
  enough: boolean;
  nCurrent: number;
  nPrevious: number;
}

/**
 * Is `current` really different from `previous`? Bootstraps the difference of means of two samples of
 * day-level values. A change is only called up/down when the interval excludes zero; otherwise it is "flat"
 * (no clear change). This stops noise from being reported as a trend.
 */
export const compareSamples = (current: number[], previous: number[], opts: { B?: number; level?: number; minEach?: number } = {}): ChangeResult => {
  const minEach = opts.minEach ?? 3;
  const cm = mean(current), pm = mean(previous);
  const base: ChangeResult = {
    current: cm, previous: pm, delta: cm !== null && pm !== null ? cm - pm : null, lo: null, hi: null,
    direction: 'flat', enough: current.length >= minEach && previous.length >= minEach, nCurrent: current.length, nPrevious: previous.length,
  };
  if (!base.enough) return base;
  const B = opts.B ?? 400;
  const level = opts.level ?? 0.8;
  const rand = mulberry32(seedFrom([...current, ...previous, current.length]));
  const diffs: number[] = [];
  for (let b = 0; b < B; b++) {
    let s1 = 0, s2 = 0;
    for (let i = 0; i < current.length; i++) s1 += current[Math.floor(rand() * current.length)];
    for (let i = 0; i < previous.length; i++) s2 += previous[Math.floor(rand() * previous.length)];
    diffs.push(s1 / current.length - s2 / previous.length);
  }
  const lo = quantile(diffs, (1 - level) / 2)!, hi = quantile(diffs, 1 - (1 - level) / 2)!;
  return { ...base, lo, hi, direction: lo > 0 ? 'up' : hi < 0 ? 'down' : 'flat' };
};

// ─── Association ─────────────────────────────────────────────────────────────

/** Ranks with ties averaged (1-based). */
export const ranks = (xs: number[]): number[] => {
  const idx = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k][1]] = r;
    i = j + 1;
  }
  return out;
};

export const pearson = (x: number[], y: number[]): number | null => {
  const n = x.length;
  if (n < 3 || y.length !== n) return null;
  const mx = mean(x)!, my = mean(y)!;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy);
};

/** Spearman rank correlation: robust to outliers and to non-linear but monotonic relationships. */
export const spearman = (x: number[], y: number[]): number | null => pearson(ranks(x), ranks(y));

export interface Association { rho: number | null; p: number | null; n: number; lo: number | null; hi: number | null }

/**
 * Spearman correlation with a two-sided permutation p-value and a bootstrap interval. The permutation test makes no
 * distributional assumptions, which matters for skewed data like minutes of focus.
 */
export const spearmanTest = (x: number[], y: number[], opts: { B?: number; level?: number } = {}): Association => {
  const n = x.length;
  const rho = spearman(x, y);
  if (rho === null || n < 5) return { rho, p: null, n, lo: null, hi: null };
  const B = opts.B ?? 1000;
  const rand = mulberry32(seedFrom([...x, ...y]));
  const rx = ranks(x);
  const ry = ranks(y);
  let extreme = 0;
  const perm = [...ry];
  for (let b = 0; b < B; b++) {
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
    const r = pearson(rx, perm);
    if (r !== null && Math.abs(r) >= Math.abs(rho) - 1e-12) extreme++;
  }
  const p = (extreme + 1) / (B + 1);
  // bootstrap interval for rho
  const level = opts.level ?? 0.8;
  const rr = mulberry32(seedFrom([n, ...x.slice(0, 5), ...y.slice(0, 5)]));
  const draws: number[] = [];
  for (let b = 0; b < Math.min(B, 500); b++) {
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i < n; i++) { const k = Math.floor(rr() * n); xs.push(x[k]); ys.push(y[k]); }
    const r = spearman(xs, ys);
    if (r !== null) draws.push(r);
  }
  return { rho, p, n, lo: quantile(draws, (1 - level) / 2), hi: quantile(draws, 1 - (1 - level) / 2) };
};

/** Median difference (a - b) with a bootstrap interval; robust to skew and outliers. */
export const medianDifference = (a: number[], b: number[], opts: { B?: number; level?: number } = {}): { diff: number | null; lo: number | null; hi: number | null; nA: number; nB: number } => {
  const ma = median(a), mb = median(b);
  if (a.length < 2 || b.length < 2) return { diff: ma !== null && mb !== null ? ma - mb : null, lo: null, hi: null, nA: a.length, nB: b.length };
  const B = opts.B ?? 500;
  const level = opts.level ?? 0.8;
  const rand = mulberry32(seedFrom([...a, ...b, a.length]));
  const diffs: number[] = [];
  const ba = new Array<number>(a.length), bb = new Array<number>(b.length);
  for (let i = 0; i < B; i++) {
    for (let k = 0; k < a.length; k++) ba[k] = a[Math.floor(rand() * a.length)];
    for (let k = 0; k < b.length; k++) bb[k] = b[Math.floor(rand() * b.length)];
    diffs.push(median(ba)! - median(bb)!);
  }
  return { diff: ma! - mb!, lo: quantile(diffs, (1 - level) / 2), hi: quantile(diffs, 1 - (1 - level) / 2), nA: a.length, nB: b.length };
};

// ─── Trends ──────────────────────────────────────────────────────────────────

/** Theil-Sen slope: the median of all pairwise slopes; robust to outliers. Units: y per x-step. */
export const theilSen = (y: number[]): number | null => {
  const n = y.length;
  if (n < 3) return null;
  const slopes: number[] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) slopes.push((y[j] - y[i]) / (j - i));
  return median(slopes);
};

/** Exponentially weighted moving average (alpha = weight of the newest value). */
export const ewma = (values: number[], alpha: number): number | null => {
  if (values.length === 0) return null;
  let s = values[0];
  for (let i = 1; i < values.length; i++) s = alpha * values[i] + (1 - alpha) * s;
  return s;
};

export const geometricMean = (xs: number[]): number | null => {
  const pos = xs.filter((x) => x > 0);
  return pos.length ? Math.exp(pos.reduce((s, x) => s + Math.log(x), 0) / pos.length) : null;
};
