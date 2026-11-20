import { describe, expect, it } from 'vitest';
import { channelAdvantage, markupForAdvantage, priceFromCost, marginFromMarkup, markupFromMargin, profitSummary, sumProfit, round2 } from '../src/pricing.js';
import { rules } from './fixtures.js';

const tiers = rules.markupTiers;

describe('channelAdvantage', () => {
  it('(channel − net) / channel', () => {
    expect(channelAdvantage(100, 80)).toBeCloseTo(0.2);
    expect(channelAdvantage(150, 135)).toBeCloseTo(0.1);
  });
  it('negative when net is above channel', () => {
    expect(channelAdvantage(100, 110)).toBeCloseTo(-0.1);
  });
  it('null for zero / negative / non-finite channel price', () => {
    expect(channelAdvantage(0, 80)).toBeNull();
    expect(channelAdvantage(-5, 80)).toBeNull();
    expect(channelAdvantage(NaN, 80)).toBeNull();
  });
});

describe('markupForAdvantage (§9 table)', () => {
  it.each([
    [0, 0.05], [0.03, 0.05], [0.0499, 0.05],
    [0.05, 0.1], [0.07, 0.1],
    [0.1, 0.15], [0.149, 0.15],
    [0.15, 0.2], [0.1999, 0.2],
    [0.2, 0.25], [0.35, 0.25],
  ])('advantage %f → markup %f', (adv, mk) => {
    expect(markupForAdvantage(adv, tiers)).toBe(mk);
  });
  it('exact boundaries computed from prices stay in the upper tier despite float noise', () => {
    expect(markupForAdvantage(channelAdvantage(100, 95)!, tiers)).toBe(0.1); // exactly 5%
    expect(markupForAdvantage(channelAdvantage(100, 80)!, tiers)).toBe(0.25); // exactly 20%
    expect(markupForAdvantage(channelAdvantage(120, 102)!, tiers)).toBe(0.2); // exactly 15%
  });
  it('negative advantage → lowest tier', () => {
    expect(markupForAdvantage(-0.3, tiers)).toBe(0.05);
  });
  it('works with unsorted tier tables', () => {
    expect(markupForAdvantage(0.12, [...tiers].reverse())).toBe(0.15);
  });
  it('throws on empty tier table', () => {
    expect(() => markupForAdvantage(0.1, [])).toThrow();
  });
});

describe('markup vs margin', () => {
  it('100 cost → 25% markup → 125 sale; margin 20%', () => {
    expect(priceFromCost(100, 0.25)).toBe(125);
    expect(marginFromMarkup(0.25)).toBeCloseTo(0.2);
    expect(markupFromMargin(0.2)).toBeCloseTo(0.25);
  });
  it('round-trips', () => {
    for (const mk of [0, 0.05, 0.1, 0.15, 0.2, 0.25, 1]) expect(markupFromMargin(marginFromMarkup(mk))).toBeCloseTo(mk);
  });
  it('priceFromCost rounds to 2 decimals', () => {
    expect(priceFromCost(33.33, 0.15)).toBe(38.33);
    expect(priceFromCost(0, 0.25)).toBe(0);
  });
  it('guards invalid inputs', () => {
    expect(() => markupFromMargin(1)).toThrow();
    expect(() => marginFromMarkup(-1)).toThrow();
  });
});

describe('profitSummary / sumProfit', () => {
  it('keeps margin (÷ sale) and markup (÷ cost) separate', () => {
    const p = profitSummary(100, 125);
    expect(p).toMatchObject({ costEur: 100, saleEur: 125, profitEur: 25 });
    expect(p.margin).toBeCloseTo(0.2);
    expect(p.markup).toBeCloseTo(0.25);
  });
  it('is zero-safe', () => {
    expect(profitSummary(0, 0)).toEqual({ costEur: 0, saleEur: 0, profitEur: 0, margin: 0, markup: 0 });
    const valueAdd = profitSummary(0, 500); // yalnız satış: cost 0
    expect(valueAdd.margin).toBe(1);
    expect(valueAdd.markup).toBe(0);
  });
  it('handles a loss', () => {
    const p = profitSummary(100, 90);
    expect(p.profitEur).toBe(-10);
    expect(p.margin).toBeCloseTo(-0.1111, 3);
  });
  it('sums parts and recomputes ratios', () => {
    const s = sumProfit([profitSummary(100, 125), profitSummary(0, 50), profitSummary(200, 210)]);
    expect(s).toMatchObject({ costEur: 300, saleEur: 385, profitEur: 85 });
    expect(s.margin).toBeCloseTo(85 / 385);
    expect(s.markup).toBeCloseTo(85 / 300);
    expect(sumProfit([])).toMatchObject({ costEur: 0, saleEur: 0, margin: 0 });
  });
});

describe('round2', () => {
  it('rounds half away from zero', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.675)).toBe(2.68);
    expect(round2(-1.005)).toBe(-1.01);
    expect(round2(0.125)).toBe(0.13);
    expect(round2(10)).toBe(10);
    expect(Object.is(round2(-0.001), 0)).toBe(true);
  });
});
