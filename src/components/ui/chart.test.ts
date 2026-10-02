import { describe, expect, it } from 'vitest';
import css from '../../index.css?raw';
import { ANIM, chartH, smoothSeries } from './chart';

describe('charts stay visible', () => {
  it('never sizes .recharts-wrapper with max-width (Recharts 3 nests it in a 0x0 box, which made every chart 0px wide)', () => {
    expect(css).not.toMatch(/\.recharts-wrapper\s*\{[^}]*max-width/);
  });

  it('keeps the Recharts draw-in animation off (it could stall with the reveal clip at 0px)', () => {
    expect(ANIM.isAnimationActive).toBe(false);
  });

  it('chart height clamps around the base height', () => {
    expect(chartH(200)).toBe('clamp(170px, 23.53vh, 270px)');
  });

  it('smoothing keeps gaps and the raw value', () => {
    const out = smoothSeries([{ v: 0 }, { v: 3 }, { v: null }, { v: 6 }], 'v');
    expect(out.map((p) => p.v)).toEqual([1.5, 1.5, null, 6]);
    expect(out[1].vRaw).toBe(3);
  });
});
