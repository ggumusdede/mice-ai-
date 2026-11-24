import { describe, expect, it } from 'vitest';
import type { FxMovement } from '@mice/shared';
import { fillRatesFromTable, parseTcmbXml, rateOnValueDate, tcmbToEurRates, tcmbUrl } from '../src/fx-rates.js';
import { realizedFx } from '../src/realized-fx.js';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<Tarih_Date Tarih="06.03.2026" Date="03/06/2026" Bulten_No="2026/45">
  <Currency CrossOrder="0" Kod="USD" CurrencyCode="USD"><Unit>1</Unit><Isim>ABD DOLARI</Isim><ForexBuying>34.5000</ForexBuying><ForexSelling>34.6000</ForexSelling><BanknoteBuying>34.4800</BanknoteBuying><BanknoteSelling>34.6500</BanknoteSelling></Currency>
  <Currency CrossOrder="9" Kod="EUR" CurrencyCode="EUR"><Unit>1</Unit><Isim>EURO</Isim><ForexBuying>37.2000</ForexBuying><ForexSelling>37.3000</ForexSelling><BanknoteBuying>37.1800</BanknoteBuying><BanknoteSelling>37.3500</BanknoteSelling></Currency>
  <Currency Kod="JPY" CurrencyCode="JPY"><Unit>100</Unit><ForexBuying>23.0</ForexBuying><ForexSelling></ForexSelling><BanknoteBuying/><BanknoteSelling/></Currency>
</Tarih_Date>`;

describe('TCMB daily XML', () => {
  it('url: today and dated archive', () => {
    expect(tcmbUrl()).toBe('https://www.tcmb.gov.tr/kurlar/today.xml');
    expect(tcmbUrl('2026-03-06')).toBe('https://www.tcmb.gov.tr/kurlar/202603/06032026.xml');
  });
  it('parses date, units and four rate types; converts to 1 EUR = x (TRY direct, USD cross)', () => {
    const d = parseTcmbXml(XML);
    expect(d.date).toBe('2026-03-06');
    expect(d.currencies.find((c) => c.code === 'JPY')).toMatchObject({ unit: 100, forexBuying: 23, forexSelling: null });
    const rows = tcmbToEurRates(d);
    expect(rows.find((r) => r.currency === 'TRY' && r.rateType === 'tcmb_forex_buying')).toEqual({ currency: 'TRY', rateType: 'tcmb_forex_buying', rate: 37.2, rateDate: '2026-03-06' });
    expect(rows.find((r) => r.currency === 'TRY' && r.rateType === 'tcmb_banknote_selling')!.rate).toBe(37.35);
    expect(rows.find((r) => r.currency === 'USD' && r.rateType === 'tcmb_forex_buying')!.rate).toBeCloseTo(37.2 / 34.5, 6);
  });
  it('rejects non-TCMB content', () => {
    expect(() => parseTcmbXml('<html></html>')).toThrow();
  });
});

describe('rateOnValueDate — weekend / holiday fallback', () => {
  const rows = [{ rateDate: '2026-03-05', rate: 37.0 }, { rateDate: '2026-03-06', rate: 37.2 }, { rateDate: '2026-03-09', rate: 37.5 }];
  it('weekday: the rate of that day', () => {
    expect(rateOnValueDate(rows, '2026-03-06')).toEqual({ rate: 37.2, rateDate: '2026-03-06' });
  });
  it('Saturday / Sunday: Friday’s published rate (never Monday’s)', () => {
    expect(rateOnValueDate(rows, '2026-03-07')).toEqual({ rate: 37.2, rateDate: '2026-03-06' });
    expect(rateOnValueDate(rows, '2026-03-08')).toEqual({ rate: 37.2, rateDate: '2026-03-06' });
  });
  it('holiday: the last published rate before it; nothing within the window → null (evidence gap)', () => {
    expect(rateOnValueDate([{ rateDate: '2026-03-05', rate: 37 }], '2026-03-06')).toEqual({ rate: 37, rateDate: '2026-03-05' });
    expect(rateOnValueDate(rows, '2026-02-01')).toBeNull();
    expect(rateOnValueDate([{ rateDate: '2026-01-01', rate: 36 }], '2026-03-06')).toBeNull();
  });
});

describe('EUR debt paid in EUR → TRY cost at the payment-day TCMB rate (Q5 follow-up)', () => {
  const table = [{ currency: 'TRY', rateDate: '2026-03-02', rate: 36.0 }, { currency: 'TRY', rateDate: '2026-03-06', rate: 37.2 }, { currency: 'TRY', rateDate: '2026-03-20', rate: 38.0 }];
  const base: FxMovement[] = [
    { id: 'ci', type: 'customer_invoice', amount: 10000, currency: 'EUR', date: '2026-03-02', rateSource: 'currency' },
    { id: 'c', type: 'collection', amount: 10000, currency: 'EUR', date: '2026-03-07', rateSource: 'currency', settles: 'ci' }, // Saturday
    { id: 'si', type: 'supplier_invoice', amount: 8000, currency: 'EUR', date: '2026-03-02', rateSource: 'currency' },
    { id: 'p', type: 'payment', amount: 8000, currency: 'EUR', date: '2026-03-20', rateSource: 'currency', settles: 'si' },
  ];
  it('unconverted EUR movements get the value-date TCMB rate, source tcmb with a note', () => {
    const filled = fillRatesFromTable(base, table, 'tcmb_forex_buying');
    const p = filled.find((m) => m.id === 'p')!;
    expect(p).toMatchObject({ eurTryRate: 38, rateSource: 'tcmb', rateNote: 'TCMB 2026-03-20 döviz alış' });
    expect(filled.find((m) => m.id === 'c')!.rateNote).toBe('TCMB 2026-03-06 döviz alış'); // weekend → Friday
    const r = realizedFx(filled);
    expect(r.status).toBe('complete');
    expect(r.cost).toEqual({ eur: 8000, try: 304000 }); // 8000 × 38 (payment day), not the invoice day 36
    expect(r.revenue).toEqual({ eur: 10000, try: 372000 }); // 10000 × 37.2
    expect(r.profit).toEqual({ eur: 2000, try: 68000 });
    // collected at 37.2, paid at 38 → TRY loss 8000 × (37.2 − 38) = −6400
    expect(r.collectionVsPaymentFx.try).toBeCloseTo(-6400, 2);
  });
  it('converted movement (TL bought): the bank rate wins, TCMB never overwrites it', () => {
    const conv = base.map((m) => (m.id === 'p' ? { ...m, amount: 300000, currency: 'TRY' as const, eurTryRate: 37.5, rateSource: 'bank_derived' as const, rateNote: 'banka' } : m));
    const r = realizedFx(fillRatesFromTable(conv, table, 'tcmb_forex_buying'));
    expect(r.cost).toEqual({ eur: 8000, try: 300000 });
    expect(r.evidence.find((e) => e.movementId === 'p')).toMatchObject({ rateSource: 'bank_derived', rateNote: 'banka' });
  });
  it('no rate for the date → evidence gap, partial, no guessing', () => {
    const r = realizedFx(fillRatesFromTable(base, [], 'tcmb_forex_buying'));
    expect(r.status).toBe('partial');
    expect(r.cost.try).toBe(0);
    expect(r.missingRates.map((m) => m.movementId).sort()).toEqual(['c', 'p']);
  });
});
