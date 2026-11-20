import { describe, expect, it } from 'vitest';
import { toEur, fromEur, normalizeOffer, detectHiddenCosts, daysInclusive } from '../src/normalization.js';
import { evaluateOffer, median } from '../src/evaluation.js';
import type { NormalizedOffer } from '@mice/shared';
import { offer, RATES, rules } from './fixtures.js';

describe('toEur / fromEur', () => {
  it('converts with 1 EUR = rate units', () => {
    expect(toEur(3500, 'TRY', RATES)).toBeCloseTo(100);
    expect(fromEur(100, 'TRY', RATES)).toBeCloseTo(3500);
    expect(toEur(50, 'EUR', {})).toBe(50);
    expect(toEur(110, 'usd', RATES)).toBeCloseTo(100);
  });
  it('throws on unknown currency / invalid rate', () => {
    expect(() => toEur(1, 'JPY', RATES)).toThrow();
    expect(() => fromEur(1, 'TRY', { TRY: 0 })).toThrow();
  });
});

describe('normalizeOffer — 80 pax, 40 DBL × 2 nights', () => {
  const item = { kind: 'accommodation' as const, quantity: 40, nights: 2, dateFrom: '2027-03-12', dateTo: '2027-03-14' };
  const ctx = { item, pax: 80, days: 3, rates: RATES, accommodationTaxRate: 0.02 };

  it('strips VAT and accommodation tax, converts TRY → EUR, computes unit prices', () => {
    // net 3500 TRY/room-night = 100 EUR; quoted incl. 10% VAT and 2% accommodation tax → 3920 TRY
    const o = offer({ currency: 'TRY' }, [{ description: 'DBL BB', kind: 'accommodation', quantity: 40, unit: 'room_night', nights: 2, unitPrice: 3920, vatIncluded: true, vatRate: 0.1, accommodationTaxIncluded: true }]);
    const n = normalizeOffer(o, ctx);
    expect(n.totalNetExVatEur).toBe(8000);
    expect(n.vatEur).toBe(800);
    expect(n.accommodationTaxEur).toBe(160);
    expect(n.perRoomNightEur).toBe(100);
    expect(n.perPersonEur).toBe(100);
    expect(n.perPersonPerDayEur).toBeCloseTo(33.33, 2);
    expect(n.fxRate).toBe(35);
  });

  it('VAT-exclusive quote with tax excluded still reports tax and VAT separately', () => {
    const o = offer({}, [{ description: 'DBL', kind: 'accommodation', quantity: 40, unit: 'room_night', nights: 2, unitPrice: 100, vatIncluded: false, vatRate: 0.1 }]);
    const n = normalizeOffer(o, ctx);
    expect(n.totalNetExVatEur).toBe(8000);
    expect(n.vatEur).toBe(800);
    expect(n.accommodationTaxEur).toBe(160);
  });

  it('non-accommodation lines: no accommodation tax, no room-night price', () => {
    const o = offer({}, [
      { description: 'Salon', kind: 'hall', quantity: 2, unit: 'day', unitPrice: 1200, vatIncluded: true, vatRate: 0.2 },
      { description: 'Coffee break', kind: 'fnb', quantity: 160, unit: 'pax', unitPrice: 12, vatIncluded: false, vatRate: 0.2 },
    ]);
    const n = normalizeOffer(o, { ...ctx, item: { ...item, kind: 'hall' }, days: 2 });
    expect(n.totalNetExVatEur).toBe(2000 + 1920);
    expect(n.accommodationTaxEur).toBe(0);
    expect(n.perRoomNightEur).toBeNull();
    expect(n.perPersonPerDayEur).toBe(24.5);
  });

  it('missing pax / days → null per-person prices; days derived from item dates', () => {
    const o = offer({}, [{ description: 'x', kind: 'hall', quantity: 1, unit: 'lump_sum', unitPrice: 300, vatIncluded: false, vatRate: 0.2 }]);
    expect(normalizeOffer(o, { ...ctx, pax: null }).perPersonEur).toBeNull();
    expect(normalizeOffer(o, { ...ctx, pax: 0 }).perPersonPerDayEur).toBeNull();
    expect(normalizeOffer(o, { ...ctx, days: null }).perPersonPerDayEur).toBeCloseTo(300 / 80 / 3, 2);
  });

  it('empty offer yields zeros, throws on unknown currency', () => {
    expect(normalizeOffer(offer(), ctx).totalNetExVatEur).toBe(0);
    expect(() => normalizeOffer(offer({ currency: 'JPY' as never }), ctx)).toThrow();
  });

  it('daysInclusive', () => {
    expect(daysInclusive('2027-03-12', '2027-03-14')).toBe(3);
    expect(daysInclusive('2027-03-14', '2027-03-12')).toBeNull();
    expect(daysInclusive(null, '2027-03-12')).toBeNull();
  });
});

describe('detectHiddenCosts', () => {
  it('flags guarantee above pax as critical, attrition, prepayment, non-refundable cancellation, overtime', () => {
    const o = offer({ guaranteePax: 90, attritionTerms: '%10 düşüş hakkı', prepaymentRate: 0.5, paymentTerms: '30 gün vadeli', cancellationTerms: 'İadesiz', overtimeTerms: 'Saat başı 200 EUR' });
    const h = detectHiddenCosts(o, 80);
    expect(h.map((x) => x.type)).toEqual(['guarantee', 'attrition', 'payment', 'payment', 'cancellation', 'overtime']);
    expect(h[0].severity).toBe('critical');
    expect(h[2].severity).toBe('critical');
    expect(h[4].severity).toBe('critical');
  });
  it('guarantee close to pax → warning, otherwise info', () => {
    expect(detectHiddenCosts(offer({ guaranteePax: 76 }), 80)[0].severity).toBe('warning');
    expect(detectHiddenCosts(offer({ guaranteePax: 60 }), 80)[0].severity).toBe('info');
    expect(detectHiddenCosts(offer({ guaranteePax: 60 }), null)[0].severity).toBe('info');
  });
  it('nothing flagged for a clean offer', () => {
    expect(detectHiddenCosts(offer({ paymentTerms: '  ' }), 80)).toEqual([]);
  });
});

function norm(over: Partial<NormalizedOffer> = {}): NormalizedOffer {
  return { offerId: 'o', supplierId: 's', totalNetExVatEur: 8000, accommodationTaxEur: 0, vatEur: 0, perPersonEur: 100, perPersonPerDayEur: 33.33, perRoomNightEur: 80, fxRate: 1, hiddenCosts: [], ...over };
}

describe('evaluateOffer — accommodation vs channel', () => {
  const base = { kind: 'accommodation' as const, supplierStatus: 'accredited' as const, rules };
  it('20% advantage → good, 25% markup', () => {
    const e = evaluateOffer({ ...base, normalized: norm(), channel: { priceEur: 100, conditionsMatch: true } });
    expect(e.priceClass).toBe('good');
    expect(e.advantage).toBeCloseTo(0.2);
    expect(e.suggestedMarkup).toBe(0.25);
    expect(e.benchmark).toEqual({ type: 'channel', value: 100 });
    expect(e.candidateSupplier).toBe(false);
  });
  it('exactly 15% is good (threshold inclusive); below is normal', () => {
    expect(evaluateOffer({ ...base, normalized: norm({ perRoomNightEur: 85 }), channel: { priceEur: 100, conditionsMatch: true } }).priceClass).toBe('good');
    const e = evaluateOffer({ ...base, normalized: norm({ perRoomNightEur: 92 }), channel: { priceEur: 100, conditionsMatch: true } });
    expect(e.priceClass).toBe('normal');
    expect(e.suggestedMarkup).toBe(0.1);
  });
  it('never guesses: no channel → unknown, advantage null, lowest markup', () => {
    const e = evaluateOffer({ ...base, normalized: norm(), channel: null });
    expect(e.priceClass).toBe('unknown');
    expect(e.advantage).toBeNull();
    expect(e.benchmark.type).toBe('none');
    expect(e.suggestedMarkup).toBe(0.05);
  });
  it('non-refundable channel vs flexible group rate (conditions mismatch) → unknown', () => {
    const e = evaluateOffer({ ...base, normalized: norm(), channel: { priceEur: 150, conditionsMatch: false } });
    expect(e.priceClass).toBe('unknown');
    expect(e.advantage).toBeNull();
    expect(e.risks.join(' ')).toMatch(/koşulları farklı/);
  });
  it('missing room-night price or invalid channel → unknown', () => {
    expect(evaluateOffer({ ...base, normalized: norm({ perRoomNightEur: null }), channel: { priceEur: 100, conditionsMatch: true } }).priceClass).toBe('unknown');
    expect(evaluateOffer({ ...base, normalized: norm(), channel: { priceEur: 0, conditionsMatch: true } }).priceClass).toBe('unknown');
  });
  it('more expensive than channel → normal, lowest markup, risk line', () => {
    const e = evaluateOffer({ ...base, normalized: norm({ perRoomNightEur: 110 }), channel: { priceEur: 100, conditionsMatch: true } });
    expect(e.priceClass).toBe('normal');
    expect(e.suggestedMarkup).toBe(0.05);
    expect(e.risks.some((r) => r.includes('pahalı'))).toBe(true);
  });
  it('candidate supplier flagged with a risk line; hidden costs surface as risks', () => {
    const e = evaluateOffer({ ...base, supplierStatus: 'candidate', normalized: norm({ hiddenCosts: [{ type: 'payment', description: 'Tedarikçi %30 ön ödeme istiyor.', severity: 'warning' }, { type: 'guarantee', description: 'info', severity: 'info' }] }), channel: { priceEur: 100, conditionsMatch: true } });
    expect(e.candidateSupplier).toBe(true);
    expect(e.risks.some((r) => r.includes('Aday tedarikçi'))).toBe(true);
    expect(e.risks).toContain('Tedarikçi %30 ön ödeme istiyor.');
    expect(e.risks).not.toContain('info');
  });
  it('value-add item: no tier table', () => {
    const e = evaluateOffer({ ...base, normalized: norm(), channel: { priceEur: 100, conditionsMatch: true }, valueAdd: true });
    expect(e.suggestedMarkup).toBeNull();
  });
});

describe('evaluateOffer — other kinds vs history median', () => {
  const base = { kind: 'hall' as const, supplierStatus: 'accredited' as const, rules };
  it('10% below median → good, 15% markup tier', () => {
    const e = evaluateOffer({ ...base, normalized: norm({ perPersonPerDayEur: 27 }), history: [30, 28, 32] });
    expect(e.benchmark).toEqual({ type: 'history_median', value: 30, sampleSize: 3 });
    expect(e.advantage).toBeCloseTo(0.1);
    expect(e.priceClass).toBe('good');
    expect(e.suggestedMarkup).toBe(0.15);
  });
  it('at median → normal, 5% markup', () => {
    const e = evaluateOffer({ ...base, normalized: norm({ perPersonPerDayEur: 30 }), history: [30] });
    expect(e.priceClass).toBe('normal');
    expect(e.suggestedMarkup).toBe(0.05);
  });
  it('no history → unknown ("bilmiyorum"), lowest tier', () => {
    const e = evaluateOffer({ ...base, normalized: norm(), history: [] });
    expect(e.priceClass).toBe('unknown');
    expect(e.advantage).toBeNull();
    expect(e.suggestedMarkup).toBe(0.05);
    expect(evaluateOffer({ ...base, normalized: norm() }).priceClass).toBe('unknown');
  });
  it('explicit unitPriceEur overrides the normalized basis', () => {
    const e = evaluateOffer({ ...base, normalized: norm({ perPersonPerDayEur: 999 }), history: [100, 100], unitPriceEur: 80 });
    expect(e.advantage).toBeCloseTo(0.2);
    expect(e.suggestedMarkup).toBe(0.25);
  });
});

describe('median', () => {
  it('odd / even / empty / unsorted', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(median([NaN, 5])).toBe(5);
  });
});
