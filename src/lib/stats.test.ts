import { describe, expect, it } from 'vitest';
import {
  bootstrapCI, compareSamples, ewma, geometricMean, mean, median, medianDifference, pearson, quantile, ranks, spearman, spearmanTest, stdev, theilSen, wilson,
} from './stats';

describe('basics', () => {
  it('mean, median, quantile, stdev', () => {
    expect(mean([])).toBeNull();
    expect(mean([1, 2, 3])).toBe(2);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(quantile([1, 2, 3, 4, 5], 0.25)).toBe(2);
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 2);
    expect(stdev([1])).toBeNull();
  });

  it('geometric mean ignores non-positive values; ewma weights recent values', () => {
    expect(geometricMean([1, 4])).toBeCloseTo(2);
    expect(geometricMean([0, -1])).toBeNull();
    expect(ewma([0, 0, 10], 0.5)).toBe(5);
    expect(ewma([], 0.5)).toBeNull();
  });
});

describe('wilson interval', () => {
  it('is wider for small n, narrower for large n, and stays inside 0..1', () => {
    const small = wilson(3, 4), large = wilson(75, 100);
    expect(small.hi! - small.lo!).toBeGreaterThan(large.hi! - large.lo!);
    expect(wilson(0, 5).lo!).toBeCloseTo(0);
    expect(wilson(5, 5).hi!).toBeCloseTo(1);
    expect(wilson(0, 0).p).toBeNull();
    expect(large.p).toBe(0.75);
    expect(large.lo!).toBeLessThan(0.75);
    expect(large.hi!).toBeGreaterThan(0.75);
  });

  it('known value: 8/10 at 95% is about 0.49-0.94', () => {
    const w = wilson(8, 10, 1.96);
    expect(w.lo!).toBeCloseTo(0.49, 1);
    expect(w.hi!).toBeCloseTo(0.943, 2);
  });
});

describe('bootstrap', () => {
  it('interval contains the estimate and is reproducible', () => {
    const v = [5, 7, 6, 9, 4, 8, 6, 7, 5, 10];
    const a = bootstrapCI(v, mean), b = bootstrapCI(v, mean);
    expect(a).toEqual(b);
    expect(a.lo!).toBeLessThanOrEqual(a.estimate!);
    expect(a.hi!).toBeGreaterThanOrEqual(a.estimate!);
  });

  it('a single value has no interval', () => {
    expect(bootstrapCI([3], mean).lo).toBeNull();
  });
});

describe('compareSamples', () => {
  const noise = (base: number, k: number) => Array.from({ length: 14 }, (_, i) => base + ((i * 7 + k) % 5) - 2);

  it('detects a real shift and stays flat on noise', () => {
    const up = compareSamples(noise(110, 1), noise(100, 2));
    expect(up.direction).toBe('up');
    expect(up.lo!).toBeGreaterThan(0);
    const flat = compareSamples(noise(100, 1), noise(100, 3));
    expect(flat.direction).toBe('flat');
  });

  it('refuses to judge with too little data', () => {
    const r = compareSamples([1, 2], [3, 4, 5]);
    expect(r.enough).toBe(false);
    expect(r.direction).toBe('flat');
    expect(r.delta).toBeCloseTo(-2.5);
  });

  it('handles high-variance data honestly (wide interval spans zero)', () => {
    const r = compareSamples([0, 100, 0, 100, 0, 100], [50, 60, 40, 55, 45, 50]);
    expect(r.direction).toBe('flat');
  });
});

describe('association', () => {
  it('ranks average ties', () => {
    expect(ranks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
  });

  it('spearman is 1 for any monotonic relation, unlike pearson', () => {
    const x = [1, 2, 3, 4, 5, 6, 7, 8];
    const y = x.map((v) => v ** 3);
    expect(spearman(x, y)).toBeCloseTo(1);
    expect(pearson(x, y)!).toBeLessThan(1);
  });

  it('permutation test: strong signal has a small p; noise does not', () => {
    const x = Array.from({ length: 20 }, (_, i) => i);
    const signal = x.map((v) => v * 2 + ((v * 37) % 5));
    const s = spearmanTest(x, signal);
    expect(s.rho!).toBeGreaterThan(0.9);
    expect(s.p!).toBeLessThan(0.01);
    expect(s.lo!).toBeGreaterThan(0.5);
    const noiseY = x.map((v) => (v * 7919) % 13);
    const nz = spearmanTest(x, noiseY);
    expect(nz.p!).toBeGreaterThan(0.05);
  });

  it('needs at least 5 pairs', () => {
    expect(spearmanTest([1, 2, 3], [1, 2, 3]).p).toBeNull();
  });

  it('median difference: interval excludes zero for a clear gap', () => {
    const a = [60, 62, 58, 65, 61, 59, 63, 60];
    const b = [90, 88, 95, 92, 91, 89, 94, 90];
    const d = medianDifference(a, b);
    expect(d.diff!).toBeLessThan(-25);
    expect(d.hi!).toBeLessThan(0);
  });
});

describe('theilSen', () => {
  it('recovers a slope and ignores an outlier', () => {
    expect(theilSen([1, 2, 3, 4, 5])).toBeCloseTo(1);
    expect(theilSen([1, 2, 3, 40, 5, 6, 7])).toBeCloseTo(1, 0);
    expect(theilSen([1, 2])).toBeNull();
  });
});
