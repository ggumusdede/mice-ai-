import { describe, expect, it } from 'vitest';
import type { Quote, ServiceItemDetail } from '@mice/shared';
import { canRevise, prefillFromQuote, revisionLabel } from '../quoteRevision';
import { periodFor } from '../../pages/admin/TeamPerformancePage';

const ev = (offerId: string, supplierId: string, total: number) => ({ offerId, suggestedMarkup: 0.15, candidateSupplier: false, normalized: { supplierId, totalNetExVatEur: total } });
const items = [
  { id: 'acc', kind: 'accommodation', valueAdd: false, quantity: 1, selectedOfferId: 'o2', status: 'selected',
    offers: [{ id: 'o1', supplierId: 's1', supersededBy: 'o1b' }, { id: 'o1b', supplierId: 's1', supersededBy: null }, { id: 'o2', supplierId: 's2', supersededBy: null }],
    evaluations: [ev('o1b', 's1', 1200), ev('o2', 's2', 900)] },
  { id: 'hall', kind: 'hall', valueAdd: false, quantity: 1, selectedOfferId: 'h1', status: 'selected', offers: [{ id: 'h1', supplierId: 's3', supersededBy: null }], evaluations: [ev('h1', 's3', 500)] },
  { id: 'va', kind: 'other', valueAdd: true, quantity: 2, selectedOfferId: null, status: 'open', offers: [], evaluations: [] },
] as unknown as ServiceItemDetail[];
const quote = {
  id: 'q1', version: 1, status: 'sent', supersededBy: null, currency: 'EUR',
  options: [{ optionNo: 1, title: 'A', lines: [
    { serviceItemId: 'acc', offerId: 'o1', markup: 0.22, valueAdd: false, unitPriceEur: 1464 },
    { serviceItemId: 'va', offerId: null, markup: 0, valueAdd: true, unitPriceEur: 40 },
  ] }],
} as unknown as Quote;

describe('Q9 quick revision prefill', () => {
  it('reuses options, markups and value-add prices; follows a superseded offer to its latest version; unchecks missing items', () => {
    const [o] = prefillFromQuote(items, quote);
    expect(o.title).toBe('A');
    expect(o.lines[0]).toMatchObject({ serviceItemId: 'acc', include: true, offerId: 'o1b', costEur: 1200, markup: 0.22 });
    expect(o.lines[1]).toMatchObject({ serviceItemId: 'hall', include: false });
    expect(o.lines[2]).toMatchObject({ serviceItemId: 'va', include: true, valueAdd: true, unitPriceEur: 40, offerId: null });
  });
  it('labels and revisable rule', () => {
    expect(revisionLabel(2)).toBe('Rev.2');
    expect(canRevise(quote, 'open')).toBe(true);
    expect(canRevise({ ...quote, status: 'superseded' }, 'open')).toBe(false);
    expect(canRevise({ ...quote, status: 'accepted' }, 'won')).toBe(false);
    expect(canRevise(quote, 'lost')).toBe(false);
  });
});

describe('Q7 team performance period', () => {
  it('rolling presets end today (inclusive)', () => {
    expect(periodFor('12m', '2026-11-20')).toEqual({ from: '2025-11-21', to: '2026-11-20' });
    expect(periodFor('3m', '2026-11-20')).toEqual({ from: '2026-08-21', to: '2026-11-20' });
    expect(periodFor('ytd', '2026-11-20')).toEqual({ from: '2026-01-01', to: '2026-11-20' });
  });
});
