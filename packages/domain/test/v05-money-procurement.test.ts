// v0.5-A — para ve tedarik çekirdeği: S-19 base currency, S-03 contract rate / allotment / options, S-06 kapora önce, S-07 kur politikası
import { describe, expect, it } from 'vitest';
import type { AllotmentBlock, FxMovement, SupplierOffer } from '@mice/shared';
import { DEFAULT_RULES } from '@mice/shared';
import {
  allotmentSummary, attritionPenalty, blockNights, contractAdvantage, convertAmount, crossRate, depositFirstCheck, evaluateOffer,
  fillRatesFromTable, findContractRate, fxBufferAmount, isBaseCurrency, needsReleaseCard, nextOptionRank, normalizeOffer, optionCardDue,
  optionRankWarning, realizedFx, rebaseRates, resolveFxPolicy, sumInCurrency, validateExtension,
} from '../src/index.js';

const EUR_RATES = { TRY: 40, USD: 1.25, GBP: 0.85 }; // 1 EUR = 40 TRY = 1.25 USD

describe('S-19 base currency helpers', () => {
  it('rebases an EUR table on TRY / USD; EUR base is identity', () => {
    const t = rebaseRates(EUR_RATES, 'TRY');
    expect(t.TRY).toBe(1);
    expect(t.EUR).toBeCloseTo(1 / 40, 10);
    expect(t.USD).toBeCloseTo(1.25 / 40, 10);
    const u = rebaseRates(EUR_RATES, 'USD');
    expect(u.USD).toBe(1);
    expect(u.TRY).toBeCloseTo(32, 10); // 1 USD = 32 TRY
    expect(rebaseRates(EUR_RATES, 'EUR')).toMatchObject({ EUR: 1, TRY: 40, USD: 1.25 });
    expect(() => rebaseRates({ TRY: 40 }, 'USD')).toThrow(/kur yok/);
  });
  it('cross rate / conversion; unknown → null (never guessed)', () => {
    expect(crossRate('USD', 'TRY', EUR_RATES)).toBeCloseTo(32, 10);
    expect(convertAmount(1000, 'EUR', 'TRY', EUR_RATES)).toBe(40000);
    expect(convertAmount(3200, 'TRY', 'USD', EUR_RATES)).toBe(100);
    expect(convertAmount(10, 'CHF', 'EUR', EUR_RATES)).toBeNull();
    expect(isBaseCurrency('TRY')).toBe(true);
    expect(isBaseCurrency('GBP')).toBe(false);
  });
  it('agency report sums projects of different bases in the CURRENT base, listing what has no rate', () => {
    const r = sumInCurrency([{ amount: 1000, currency: 'EUR' }, { amount: 40000, currency: 'TRY' }, { amount: 5, currency: 'CHF' }], 'TRY', EUR_RATES);
    expect(r.total).toBe(80000);
    expect(r.byCurrency).toEqual({ EUR: 1000, TRY: 40000, CHF: 5 });
    expect(r.unconverted).toEqual({ CHF: 5 });
  });
  it('normalizeOffer with rebased rates computes in the project base (TRY base: TRY offer unchanged, EUR offer × 40)', () => {
    const offer = (currency: 'EUR' | 'TRY', unitPrice: number): SupplierOffer => ({
      id: 'o', tenantId: 't', rfqId: null, serviceItemId: 'i', supplierId: 's', version: 1, source: 'manual', currency,
      lines: [{ kind: 'accommodation', description: 'DBL', quantity: 10, nights: 2, unitPrice, vatRate: 0.1, vatIncluded: false } as never],
      optionUntil: null, guaranteePax: null, attritionTerms: null, paymentTerms: null, prepaymentRate: null, cancellationTerms: null,
      overtimeTerms: null, notes: null, confidence: null, verifiedBy: null, supersededBy: null, negotiationRound: 0, createdAt: '',
    });
    const ctx = { item: { kind: 'accommodation' as const, quantity: 10, nights: 2, dateFrom: null, dateTo: null }, pax: 20, days: 2, accommodationTaxRate: 0.02 };
    const tryBase = { ...ctx, rates: rebaseRates(EUR_RATES, 'TRY'), baseCurrency: 'TRY' as const };
    expect(normalizeOffer(offer('TRY', 4000), tryBase)).toMatchObject({ totalNetExVatEur: 80000, perRoomNightEur: 4000, baseCurrency: 'TRY' });
    expect(normalizeOffer(offer('EUR', 100), tryBase)).toMatchObject({ totalNetExVatEur: 80000, perRoomNightEur: 4000 });
    // legacy EUR table: unchanged behaviour
    expect(normalizeOffer(offer('TRY', 4000), { ...ctx, rates: EUR_RATES })).toMatchObject({ totalNetExVatEur: 2000, baseCurrency: 'EUR' });
  });
});

describe('S-19 realized profit in the base currency', () => {
  const mv = (id: string, type: FxMovement['type'], amount: number, currency: FxMovement['currency'], date: string, eurRate: number | null, eurTryRate: number | null): FxMovement =>
    ({ id, type, amount, currency, date, eurRate, eurTryRate, rateSource: 'bank' });
  it('TRY base = the TL figures; EUR base = EUR figures', () => {
    const ms = [mv('ci', 'customer_invoice', 50000, 'TRY', '2026-12-01', 40, 40), mv('si', 'supplier_invoice', 1000, 'EUR', '2026-12-01', 1, 40)];
    const t = realizedFx(ms, { baseCurrency: 'TRY' });
    expect(t.base).toMatchObject({ currency: 'TRY', revenue: 50000, cost: 40000, profit: 10000 });
    expect(t.base!.margin).toBeCloseTo(0.2, 10);
    expect(t.base!.markup).toBeCloseTo(0.25, 10);
    expect(realizedFx(ms).base).toMatchObject({ currency: 'EUR', revenue: 1250, cost: 1000, profit: 250 });
  });
  it('USD base: USD movements exact, others at their own EUR/USD rate (from the dated table); missing → counted, not guessed', () => {
    const ms = [mv('ci', 'customer_invoice', 1500, 'USD', '2026-12-01', 1.25, null), mv('si', 'supplier_invoice', 32000, 'TRY', '2026-12-02', 40, 40)];
    const filled = fillRatesFromTable(ms, [{ currency: 'USD', rateDate: '2026-12-02', rate: 1.25 }, { currency: 'TRY', rateDate: '2026-12-01', rate: 40 }], 'tcmb_forex_buying', 10, 'USD');
    const r = realizedFx(filled, { baseCurrency: 'USD' });
    expect(r.base).toMatchObject({ currency: 'USD', revenue: 1500, cost: 1000, profit: 500, missing: 0 });
    const noTable = realizedFx(ms, { baseCurrency: 'USD' });
    expect(noTable.base).toMatchObject({ cost: 0, missing: 1 });
  });
});

describe('S-03 contract rates (K-11)', () => {
  const rates = [
    { id: 'a', supplierId: 's1', kind: 'accommodation', roomType: null, board: null, validFrom: '2026-01-01', validTo: '2026-12-31', status: 'active' as const },
    { id: 'b', supplierId: 's1', kind: 'accommodation', roomType: 'DBL', board: 'BB', validFrom: '2026-04-01', validTo: '2026-10-31', status: 'active' as const },
    { id: 'c', supplierId: 's1', kind: 'accommodation', roomType: 'DBL', board: 'BB', validFrom: '2026-04-01', validTo: '2026-10-31', status: 'archived' as const },
  ];
  it('picks the most specific active rate valid on the service date', () => {
    expect(findContractRate(rates, { supplierId: 's1', kind: 'accommodation', date: '2026-05-10', roomType: 'DBL', board: 'BB' })?.id).toBe('b');
    expect(findContractRate(rates, { supplierId: 's1', kind: 'accommodation', date: '2026-11-10', roomType: 'DBL', board: 'BB' })?.id).toBe('a');
    expect(findContractRate(rates, { supplierId: 's1', kind: 'accommodation', date: '2026-05-10', roomType: 'SGL' })?.id).toBe('a');
    expect(findContractRate(rates, { supplierId: 's2', kind: 'accommodation', date: '2026-05-10' })).toBeNull();
    expect(findContractRate(rates, { supplierId: 's1', kind: 'accommodation', date: null })).toBeNull();
  });
  it('evaluation shows the contract price as anchor; above contract → risk line; decides the class without channel data', () => {
    const n = { offerId: 'o', supplierId: 's1', totalNetExVatEur: 2400, accommodationTaxEur: 0, vatEur: 0, perPersonEur: null, perPersonPerDayEur: null, perRoomNightEur: 120, fxRate: 1, hiddenCosts: [] };
    const ev = evaluateOffer({ kind: 'accommodation', normalized: n, supplierStatus: 'accredited', channel: null, rules: DEFAULT_RULES, contract: { contractRateId: 'b', price: 100 } });
    expect(ev.contractBenchmark).toMatchObject({ contractRateId: 'b', price: 100, basis: 'room_night' });
    expect(ev.contractBenchmark!.advantage).toBeCloseTo(-0.2, 10);
    expect(ev.benchmark.type).toBe('contract');
    expect(ev.priceClass).toBe('normal');
    expect(ev.risks.join(' ')).toMatch(/kontrat fiyatının %20 üzerinde/);
    const cheaper = evaluateOffer({ kind: 'accommodation', normalized: { ...n, perRoomNightEur: 90 }, supplierStatus: 'accredited', rules: DEFAULT_RULES, contract: { contractRateId: 'b', price: 100 } });
    expect(cheaper.priceClass).toBe('good');
    // channel data present: the channel still decides the class / markup, contract only shown
    const withChannel = evaluateOffer({ kind: 'accommodation', normalized: n, supplierStatus: 'accredited', channel: { priceEur: 150, conditionsMatch: true }, rules: DEFAULT_RULES, contract: { contractRateId: 'b', price: 100 } });
    expect(withChannel.benchmark.type).toBe('channel');
    expect(withChannel.contractBenchmark?.price).toBe(100);
    expect(contractAdvantage(100, null)).toBeNull();
  });
});

describe('S-03 allotment (K-12): release / attrition / pickup — pure', () => {
  const block = (over: Partial<AllotmentBlock> = {}): AllotmentBlock => ({
    id: 'b', projectId: null, serviceItemId: null, supplierId: 's', roomType: 'DBL', dateFrom: '2027-03-10', dateTo: '2027-03-12',
    roomsPerNight: 50, ratePerRoomNight: 120, currency: 'EUR', releaseDate: '2027-02-20', attritionPct: 0.1, penaltyPct: 1, penaltyTerms: null,
    releasedRooms: 0, pickup: [], status: 'active', createdAt: '', ...over,
  });
  it('nights, contracted room-nights and attrition penalty', () => {
    expect(blockNights(block())).toEqual(['2027-03-10', '2027-03-11', '2027-03-12']);
    // 30 rooms picked up each night; tolerated minimum 45 → 15 short × 3 nights × 120
    const b = block({ pickup: ['2027-03-10', '2027-03-11', '2027-03-12'].map((date) => ({ date, rooms: 30 })) });
    expect(attritionPenalty(b)).toEqual({ penalty: 5400, shortfallRoomNights: 45 });
    // releasing 20 rooms → contracted 30, minimum 27 → no shortfall
    expect(attritionPenalty(b, { releasedRooms: 20 }).penalty).toBe(0);
    // half-rate penalty clause
    expect(attritionPenalty({ ...b, penaltyPct: 0.5 }).penalty).toBe(2700);
    // pickup beyond the block does not count as block pickup
    expect(attritionPenalty(block({ pickup: [{ date: '2027-03-10', rooms: 80 }] })).shortfallRoomNights).toBe(90);
  });
  it('summary: release window (T-x), releasable rooms, penalty if hold vs release; after release date nothing is free', () => {
    const b = block({ pickup: ['2027-03-10', '2027-03-11', '2027-03-12'].map((date) => ({ date, rooms: 30 })) });
    const s = allotmentSummary(b, '2027-02-15', 7);
    expect(s).toMatchObject({ contractedRoomNights: 150, pickedUpRoomNights: 90, pickupPct: 0.6, daysToRelease: 5, releasableRooms: 20, penaltyIfHold: 5400, penaltyIfRelease: 0, stage: 'release_window' });
    expect(needsReleaseCard(s)).toBe(true);
    expect(allotmentSummary(b, '2027-01-01', 7).stage).toBe('before_release');
    const after = allotmentSummary(b, '2027-02-21', 7);
    expect(after).toMatchObject({ stage: 'after_release', releasableRooms: 0, penaltyIfRelease: 5400 });
    expect(needsReleaseCard(after)).toBe(false);
  });
});

describe('S-03 supplier options (K-13)', () => {
  it('1st / 2nd option ranking and 2nd-option warning', () => {
    expect(nextOptionRank([])).toBe(1);
    expect(nextOptionRank([{ rank: 1, status: 'active' }])).toBe(2);
    expect(nextOptionRank([{ rank: 1, status: 'released' }])).toBe(1);
    expect(optionRankWarning(2)).toMatch(/2\. opsiyon/);
    expect(optionRankWarning(1)).toBeNull();
  });
  it('T-3 card and extension validation', () => {
    expect(optionCardDue({ optionUntil: '2026-11-26', status: 'active' }, '2026-11-23', 3)).toEqual({ due: true, daysLeft: 3 });
    expect(optionCardDue({ optionUntil: '2026-11-27', status: 'active' }, '2026-11-23', 3).due).toBe(false);
    expect(optionCardDue({ optionUntil: '2026-11-22', status: 'active' }, '2026-11-23', 3).due).toBe(false);
    expect(optionCardDue({ optionUntil: '2026-11-24', status: 'confirmed' }, '2026-11-23', 3).due).toBe(false);
    expect(validateExtension('2026-11-26', '2026-12-03')).toBeNull();
    expect(validateExtension('2026-11-26', '2026-11-20')).toMatch(/sonra/);
  });
});

describe('S-06 kapora önce', () => {
  it('no deposit agreed → ok; collected → ok; missing → warn (default) or block', () => {
    expect(depositFirstCheck({ depositRate: 0, expectedDeposit: null, collected: 0, mode: 'warn' }).status).toBe('ok');
    expect(depositFirstCheck({ depositRate: 0.3, expectedDeposit: 3000, collected: 2990, mode: 'block' }).status).toBe('ok');
    const w = depositFirstCheck({ depositRate: 0.3, expectedDeposit: 3000, collected: 1000, mode: 'warn' });
    expect(w).toMatchObject({ status: 'warn', missing: 2000 });
    expect(w.message).toMatch(/gerekçe \+ Face ID/);
    expect(depositFirstCheck({ depositRate: 0.3, expectedDeposit: null, collected: 0, mode: 'block' }).status).toBe('block');
  });
});

describe('S-07 quote FX policy', () => {
  const defaults = { rateSource: 'TCMB', rateDate: '2026-11-20', validUntil: '2026-11-30', rules: DEFAULT_RULES };
  it('defaults: buffer only when quote currency ≠ base; customer rate = market × (1 + buffer)', () => {
    const r = resolveFxPolicy({ baseCurrency: 'EUR', quoteCurrency: 'TRY', marketRate: 40 }, defaults);
    expect(r.errors).toEqual([]);
    expect(r.policy).toMatchObject({ rateSource: 'TCMB', rateDate: '2026-11-20', validUntil: '2026-11-30', bufferPct: 0.02, customerRate: 40.8 });
    const same = resolveFxPolicy({ baseCurrency: 'TRY', quoteCurrency: 'TRY', marketRate: 1, bufferPct: 0.05 }, defaults);
    expect(same.policy).toMatchObject({ bufferPct: 0, customerRate: 1 });
  });
  it('validation: buffer above max / validity before rate date', () => {
    expect(resolveFxPolicy({ baseCurrency: 'EUR', quoteCurrency: 'TRY', marketRate: 40, bufferPct: 0.3 }, defaults).errors.join()).toMatch(/en fazla %15/);
    expect(resolveFxPolicy({ baseCurrency: 'EUR', quoteCurrency: 'TRY', marketRate: 40, validUntil: '2026-11-01' }, defaults).errors.join()).toMatch(/önce olamaz/);
    expect(fxBufferAmount(10000, 0.02)).toBe(200);
  });
});
