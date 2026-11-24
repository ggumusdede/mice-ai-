import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RealizedFx } from '@mice/shared';
import { RealizedFxBlock } from '../RealizedFxBlock';

const none: RealizedFx = {
  status: 'none', revenue: { eur: null, try: null }, cost: { eur: null, try: null }, profit: { eur: null, try: null },
  margin: { eur: null, try: null }, markup: { eur: null, try: null }, avgCollectionRate: null, avgPaymentRate: null, projectAvgRate: null,
  quoteRate: null, fxGainLoss: { eur: null, try: null }, collectionVsPaymentFx: { try: null }, evidence: [], missingRates: [],
  reasons: [{ code: 'no_movements', message: 'Henüz gerçekleşen hareket yok (fatura / tahsilat / ödeme)' }],
};

describe('RealizedFxBlock — Q5 kanıtlı gerçekleşen kâr', () => {
  it('no movement → "—" with the reason, never a negative profit / −100 % markup', () => {
    const html = renderToStaticMarkup(<RealizedFxBlock title="Gerçekleşen kâr" value={none} />);
    expect(html).toContain('Henüz gerçekleşen hareket yok');
    expect(html).not.toMatch(/-%100|−%100/);
  });
  it('EUR and TL side by side, margin and markup separately, partial badge and reasons', () => {
    const v: RealizedFx = {
      ...none, status: 'partial', revenue: { eur: 10000, try: 366000 }, cost: { eur: 7500, try: 288000 }, profit: { eur: 2500, try: 78000 },
      margin: { eur: 0.25, try: 78000 / 366000 }, markup: { eur: 1 / 3, try: 78000 / 288000 }, avgCollectionRate: 36.6, avgPaymentRate: 38.4,
      projectAvgRate: 37.37, quoteRate: 35, fxGainLoss: { eur: 728.57, try: 16000 }, collectionVsPaymentFx: { try: -13500 },
      evidence: [{ movementId: 'p', type: 'payment', date: '2026-03-25', amount: 288000, currency: 'TRY', eurRate: 38.4, eurTryRate: 38.4, rateSource: 'tcmb', rateNote: 'TCMB 2026-03-25 döviz alış', label: null, settles: null, eur: 7500, try: 288000, countedEur: 7500, countedTry: 288000, usage: 'cash' }],
      reasons: [{ code: 'unsettled_invoices', message: '1 fatura henüz tam tahsil edilmedi' }],
    };
    const html = renderToStaticMarkup(<RealizedFxBlock title="Gerçekleşen kâr" value={v} />);
    expect(html).toContain('Kısmi');
    expect(html).toContain('Marj');
    expect(html).toContain('Markup');
    expect(html).toContain('Ort. tahsilat kuru');
    expect(html).toContain('1 fatura henüz tam tahsil edilmedi');
    expect(html).toContain('Kanıt · 1 hareket');
    expect(html).toMatch(/₺|TRY|TL/);
  });
});
