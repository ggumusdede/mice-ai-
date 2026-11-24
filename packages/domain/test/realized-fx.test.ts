import { describe, expect, it } from 'vitest';
import type { FxMovement } from '@mice/shared';
import { deriveMovementRates, normalizeMovementRates, realizedFx } from '../src/realized-fx.js';

const mv = (o: Partial<FxMovement> & Pick<FxMovement, 'id' | 'type' | 'amount' | 'currency'>): FxMovement => ({ date: '2026-03-01', rateSource: 'invoice', ...o });

describe('realizedFx — evidence-based EUR + TRY realized profit (Q5)', () => {
  it('no movements → status none, every figure null ("henüz gerçekleşen hareket yok")', () => {
    const r = realizedFx([]);
    expect(r.status).toBe('none');
    expect(r.profit).toEqual({ eur: null, try: null });
    expect(r.margin).toEqual({ eur: null, try: null });
    expect(r.markup).toEqual({ eur: null, try: null });
    expect(r.reasons.map((x) => x.code)).toEqual(['no_movements']);
  });

  it('only a supplier invoice → cost shown, profit / margin / markup NOT computed (no misleading −100 %), partial', () => {
    const r = realizedFx([mv({ id: 'si', type: 'supplier_invoice', amount: 5300, currency: 'EUR', eurTryRate: 36 })]);
    expect(r.status).toBe('partial');
    expect(r.cost).toEqual({ eur: 5300, try: 190800 });
    expect(r.revenue).toEqual({ eur: null, try: null });
    expect(r.profit.eur).toBeNull();
    expect(r.markup.eur).toBeNull();
    expect(r.reasons.map((x) => x.code)).toContain('no_revenue');
  });

  it('mixed EUR / TRY: each movement at its own actual rate; cash replaces settled invoices; weighted averages', () => {
    const r = realizedFx([
      mv({ id: 'ci', type: 'customer_invoice', amount: 10000, currency: 'EUR', eurTryRate: 35, rateSource: 'efatura', date: '2026-03-01' }),
      // customer pays 40 % in EUR (TRY value at 36) and 60 % in TRY at 37 → TRY line ÷ EUR invoice
      mv({ id: 'c1', type: 'collection', amount: 4000, currency: 'EUR', eurTryRate: 36, rateSource: 'bank_derived', settles: 'ci', date: '2026-03-05' }),
      mv({ id: 'c2', type: 'collection', amount: 222000, currency: 'TRY', eurTryRate: 37, rateSource: 'bank_derived', settles: 'ci', date: '2026-03-20' }),
      mv({ id: 'si', type: 'supplier_invoice', amount: 288000, currency: 'TRY', eurTryRate: 36, rateSource: 'invoice', date: '2026-03-02' }),
      mv({ id: 'p1', type: 'payment', amount: 288000, currency: 'TRY', eurTryRate: 38.4, rateSource: 'payment_record', date: '2026-03-25' }),
    ], { quoteRates: { eurTry: 35 } });
    expect(r.status).toBe('complete');
    expect(r.revenue).toEqual({ eur: 10000, try: 366000 }); // 4000×36 + 222000
    expect(r.cost).toEqual({ eur: 7500, try: 288000 }); // 288000 ÷ 38.4
    expect(r.profit).toEqual({ eur: 2500, try: 78000 });
    expect(r.margin.eur).toBeCloseTo(0.25, 6);
    expect(r.markup.eur).toBeCloseTo(2500 / 7500, 6);
    expect(r.margin.try).toBeCloseTo(78000 / 366000, 6);
    expect(r.markup.try).toBeCloseTo(78000 / 288000, 6);
    expect(r.avgCollectionRate).toBeCloseTo(366000 / 10000, 6); // 36.6
    expect(r.avgPaymentRate).toBeCloseTo(38.4, 6);
    expect(r.projectAvgRate).toBeCloseTo((366000 + 288000) / 17500, 4);
    // invoices are replaced by their cash (counted 0), cash counted whole
    const ev = Object.fromEntries(r.evidence.map((e) => [e.movementId, e]));
    expect(ev.ci.usage).toBe('settled');
    expect(ev.ci.countedEur).toBe(0);
    expect(ev.c2.eur).toBe(6000);
    expect(ev.p1.usage).toBe('cash');
    expect(ev.si.rateSource).toBe('invoice');
    // FX gain/loss vs quote (35), on the obligations: EUR invoice → no EUR effect; TRY supplier invoice 288000/35 = 8228.57 at quote
    // → EUR profit at quote 1771.43; actual 2500 → +728.57 (kazanç)
    expect(r.fxGainLoss.eur).toBeCloseTo(728.57, 2);
    // TRY at quote: revenue 10000×35 = 350000, cost 288000 → 62000; actual 78000 → +16000
    expect(r.fxGainLoss.try).toBeCloseTo(16000, 2);
  });

  it('FX gain/loss sign: TRY weakens against EUR between quote and collection of a TRY receivable → loss in EUR', () => {
    const r = realizedFx([
      mv({ id: 'ci', type: 'customer_invoice', amount: 350000, currency: 'TRY', eurTryRate: 35 }),
      mv({ id: 'c', type: 'collection', amount: 350000, currency: 'TRY', eurTryRate: 40, settles: 'ci' }),
      mv({ id: 'si', type: 'supplier_invoice', amount: 8000, currency: 'EUR', eurTryRate: 35 }),
      mv({ id: 'p', type: 'payment', amount: 8000, currency: 'EUR', eurTryRate: 35 }),
    ], { quoteRates: { eurTry: 35 } });
    expect(r.revenue.eur).toBe(8750);
    expect(r.profit.eur).toBe(750);
    expect(r.fxGainLoss.eur).toBeCloseTo(-1250, 2); // quote: 10000 − 8000 = 2000 → actual 750
    expect(r.fxGainLoss.eur!).toBeLessThan(0);
  });

  it('partial evidence: missing rate is not guessed, listed, excluded from the affected currency; open invoice at invoice rate', () => {
    const r = realizedFx([
      mv({ id: 'ci', type: 'customer_invoice', amount: 10000, currency: 'EUR', eurTryRate: null, rateSource: 'missing' }),
      mv({ id: 'c', type: 'collection', amount: 6000, currency: 'EUR', eurTryRate: 36, settles: 'ci' }),
      mv({ id: 'si', type: 'supplier_invoice', amount: 100000, currency: 'TRY', eurTryRate: null, rateSource: 'missing' }),
    ]);
    expect(r.status).toBe('partial');
    const codes = r.reasons.map((x) => x.code);
    expect(codes).toEqual(expect.arrayContaining(['rate_missing', 'unsettled_invoices']));
    expect(r.missingRates).toEqual(expect.arrayContaining([
      { movementId: 'ci', type: 'customer_invoice', currency: 'EUR', need: ['TRY'] },
      { movementId: 'si', type: 'supplier_invoice', currency: 'TRY', need: ['EUR'] },
    ]));
    expect(r.revenue.eur).toBe(10000); // 6000 cash + 4000 open remainder (EUR exact)
    expect(r.revenue.try).toBe(216000); // only the proven part (6000 × 36); the open 4000 has no rate
    expect(r.cost.try).toBe(100000);
    expect(r.cost.eur).toBe(0); // unknown → excluded, flagged
    const ev = r.evidence.find((e) => e.movementId === 'si')!;
    expect(ev.rateSource).toBe('missing');
    expect(ev.eur).toBeNull();
  });

  it('unbilled cash (prepayment) is counted at its own rate and flagged; FIFO settles unlinked cash', () => {
    const r = realizedFx([
      mv({ id: 'si', type: 'supplier_invoice', amount: 1000, currency: 'EUR', eurTryRate: 36, date: '2026-02-01' }),
      mv({ id: 'p', type: 'payment', amount: 1500, currency: 'EUR', eurTryRate: 36, date: '2026-01-15' }),
      mv({ id: 'ci', type: 'customer_invoice', amount: 2000, currency: 'EUR', eurTryRate: 36 }),
      mv({ id: 'c', type: 'collection', amount: 2000, currency: 'EUR', eurTryRate: 36 }),
    ]);
    expect(r.cost.eur).toBe(1500);
    expect(r.evidence.find((e) => e.movementId === 'p')!.usage).toBe('partly_unbilled');
    expect(r.reasons.map((x) => x.code)).toEqual(['unbilled_cash']);
  });
});

describe('deriveMovementRates', () => {
  it('TRY bank line settling an EUR invoice → rate = TRY ÷ EUR', () => {
    expect(deriveMovementRates({ amount: 37000, currency: 'TRY', eurAmount: 1000 })).toEqual({ eurRate: 37, eurTryRate: 37 });
  });
  it('EUR payment with TL equivalent → EUR/TRY; explicit rate wins', () => {
    expect(deriveMovementRates({ amount: 1000, currency: 'EUR', tryAmount: 36500 })).toEqual({ eurRate: 1, eurTryRate: 36.5 });
    expect(deriveMovementRates({ amount: 1000, currency: 'EUR', tryAmount: 36500, eurTryRate: 36 })).toEqual({ eurRate: 1, eurTryRate: 36 });
  });
  it('nothing proven → nulls (no guessing)', () => {
    expect(deriveMovementRates({ amount: 1000, currency: 'TRY' })).toEqual({ eurRate: null, eurTryRate: null });
    expect(deriveMovementRates({ amount: 1000, currency: 'USD', tryAmount: 38000 })).toEqual({ eurRate: null, eurTryRate: null });
  });
  it('normalize: EUR rate 1, TRY eurRate = eurTryRate, invalid → null', () => {
    expect(normalizeMovementRates({ currency: 'EUR', eurRate: null, eurTryRate: 36 })).toEqual({ eurRate: 1, eurTryRate: 36 });
    expect(normalizeMovementRates({ currency: 'TRY', eurRate: 35, eurTryRate: null })).toEqual({ eurRate: 35, eurTryRate: 35 });
    expect(normalizeMovementRates({ currency: 'USD', eurRate: -1, eurTryRate: 0 })).toEqual({ eurRate: null, eurTryRate: null });
  });
});
