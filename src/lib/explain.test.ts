import { describe, expect, it } from 'vitest';
import { explainLabel, explainSection } from './explain';

describe('hover explanations', () => {
  it('cover the headline tiles and the cards by id, with all three parts filled', () => {
    const tiles = ['Tracked', 'Deep focus / day', 'Focus quality', 'Logged', 'Productivity', 'Waste / day', 'Peak window', 'Attention efficiency', 'How scattered days are'];
    const cards = ['day-summary', 'trends-over-time', 'focus-peak', 'waste-triggers', 'patterns-flow', 'exec-funnel', 'review-numbers', 'attention-budget'];
    for (const e of [...tiles.map(explainLabel), ...cards.map(explainSection)]) {
      expect(e).toBeDefined();
      for (const part of [e!.what, e!.how, e!.read]) expect(part.length).toBeGreaterThan(20);
    }
  });

  it('review rows reuse the tile wording', () => {
    expect(explainLabel('Tracked time')).toBe(explainLabel('Tracked'));
    expect(explainLabel('Time waste')).toBe(explainLabel('Waste'));
    expect(explainLabel('Timer focus')).toBe(explainLabel('Timer'));
  });

  it('says how attention efficiency is calculated, with demand as a 0-1 weight', () => {
    const e = explainLabel('Attention efficiency')!;
    expect(e.how).toContain('productivity points ÷ attention points');
    expect(e.how).toContain('demand ÷ 5');
  });

  it('has nothing for unknown cards, so they render without a hover', () => {
    expect(explainLabel('No such tile')).toBeUndefined();
    expect(explainSection(undefined)).toBeUndefined();
  });
});
