import { describe, expect, it } from 'vitest';
import { diffContractVsQuote, isContractClean, conditionRisk, type QuoteSnapshotForContract } from '../src/contract-diff.js';
import { contractFields } from './fixtures.js';
import type { ContractFields } from '@mice/shared';

const quote = (over: Partial<QuoteSnapshotForContract> = {}): QuoteSnapshotForContract => ({ ...contractFields(), valueAddDescriptions: [], ...over });
const find = (d: ReturnType<typeof diffContractVsQuote>, field: string) => d.find((x) => x.field === field);

describe('diffContractVsQuote', () => {
  it('identical contract → clean (case/whitespace-insensitive text)', () => {
    const c = contractFields({ menu: '  akşam YEMEĞİ   set menü.', customerName: 'ACME İLAÇ A.Ş.' });
    const d = diffContractVsQuote(c, quote());
    expect(d).toEqual([]);
    expect(isContractClean(d)).toBe(true);
  });

  it('flags date, pax, guarantee mismatches as errors', () => {
    const d = diffContractVsQuote(contractFields({ startDate: '2027-03-13', pax: 75, guaranteePax: 80 }), quote());
    expect(find(d, 'startDate')).toMatchObject({ kind: 'mismatch', severity: 'error', contractValue: '2027-03-13', quoteValue: '2027-03-12' });
    expect(find(d, 'pax')).toMatchObject({ kind: 'mismatch', severity: 'error' });
    expect(find(d, 'guaranteePax')).toMatchObject({ severity: 'error' });
    expect(isContractClean(d)).toBe(false);
  });

  it('empty customer / billing fields are errors even if quote also lacks them', () => {
    const d = diffContractVsQuote(contractFields({ customerName: '', billingInfo: null }), quote({ billingInfo: null }));
    expect(find(d, 'customerName')).toMatchObject({ kind: 'empty_field', severity: 'error' });
    expect(find(d, 'billingInfo')).toMatchObject({ kind: 'empty_field', severity: 'error' });
  });

  it('rooms: count / nights / price per type, missing types both ways', () => {
    const c = contractFields({ rooms: [{ type: 'dbl', count: 38, nights: 2, unitPrice: 105 }, { type: 'SUITE', count: 1, nights: 2, unitPrice: 300 }] });
    const q = quote({ rooms: [{ type: 'DBL', count: 40, nights: 2, unitPrice: 100 }, { type: 'SGL', count: 5, nights: 2, unitPrice: 90 }] });
    const d = diffContractVsQuote(c, q);
    expect(find(d, 'rooms.DBL.count')).toMatchObject({ contractValue: 38, quoteValue: 40, severity: 'error' });
    expect(find(d, 'rooms.DBL.unitPrice')).toBeDefined();
    expect(find(d, 'rooms.DBL.nights')).toBeUndefined();
    expect(find(d, 'rooms.SGL')).toMatchObject({ kind: 'missing_in_contract', severity: 'error' });
    expect(find(d, 'rooms.SUITE')).toMatchObject({ kind: 'missing_in_quote', severity: 'warning' });
  });

  it('numeric tolerance 0.01', () => {
    const d = diffContractVsQuote(contractFields({ totalAmount: 9920.01, rooms: [{ type: 'DBL', count: 40, nights: 2, unitPrice: 100.005 }] }), quote());
    expect(d).toEqual([]);
    expect(find(diffContractVsQuote(contractFields({ totalAmount: 9920.5 }), quote()), 'totalAmount')).toMatchObject({ severity: 'error' });
  });

  it('VAT & accommodation tax separation, currency', () => {
    const d = diffContractVsQuote(contractFields({ vatSeparated: false, accommodationTaxSeparated: null, currency: 'TRY' }), quote());
    expect(find(d, 'vatSeparated')).toMatchObject({ kind: 'mismatch', severity: 'error' });
    expect(find(d, 'accommodationTaxSeparated')).toMatchObject({ kind: 'missing_in_contract', severity: 'error' });
    expect(find(d, 'currency')).toMatchObject({ severity: 'error' });
  });

  it('payment / prepayment / cancellation / attrition terms', () => {
    const d = diffContractVsQuote(contractFields({ paymentTerms: '%50 imzada', prepaymentRate: 0.5, cancellationTerms: null, attritionTerms: 'Düşüş yok' }), quote({ attritionTerms: null }));
    expect(find(d, 'paymentTerms')).toMatchObject({ kind: 'mismatch', severity: 'warning' });
    expect(find(d, 'prepaymentRate')).toMatchObject({ kind: 'mismatch', severity: 'error', contractValue: 0.5, quoteValue: 0.3 });
    expect(find(d, 'cancellationTerms')).toMatchObject({ kind: 'missing_in_contract', severity: 'error' });
    expect(find(d, 'attritionTerms')).toMatchObject({ kind: 'missing_in_quote', severity: 'warning' });
  });

  it('unit prices: price/quantity mismatch, missing lines', () => {
    const c = contractFields({ unitPrices: [{ description: 'coffee break', unitPrice: 14, quantity: 120 }, { description: 'Overtime', unitPrice: 200, quantity: 1 }] });
    const q = quote({ unitPrices: [{ description: 'Coffee break', unitPrice: 12, quantity: 160 }, { description: 'Gala yemeği', unitPrice: 45, quantity: 80 }] });
    const d = diffContractVsQuote(c, q);
    expect(find(d, 'unitPrices.Coffee break.unitPrice')).toMatchObject({ severity: 'error' });
    expect(find(d, 'unitPrices.Coffee break.quantity')).toMatchObject({ severity: 'error' });
    expect(find(d, 'unitPrices.Gala yemeği')).toMatchObject({ kind: 'missing_in_contract', severity: 'error' });
    expect(find(d, 'unitPrices.Overtime')).toMatchObject({ kind: 'missing_in_quote', severity: 'warning' });
  });

  it('value-add (yalnız satış) lines are flagged, not errors — contract stays clean', () => {
    const q = quote({ unitPrices: [...contractFields().unitPrices, { description: 'Ses-ışık sistemi', unitPrice: 0, quantity: 1 }], valueAddDescriptions: ['Ses-ışık sistemi', 'Salon kirası'] });
    const d = diffContractVsQuote(contractFields(), q);
    expect(d).toHaveLength(2);
    expect(d.every((x) => x.kind === 'value_add' && x.severity === 'info')).toBe(true);
    expect(isContractClean(d)).toBe(true);
  });
  it('value-add present in contract with price 0 still only flagged', () => {
    const c = contractFields({ unitPrices: [...contractFields().unitPrices, { description: 'salon kirası', unitPrice: 0, quantity: 1 }] });
    const d = diffContractVsQuote(c, quote({ valueAddDescriptions: ['Salon kirası'] }));
    expect(d).toHaveLength(1);
    expect(d[0].kind).toBe('value_add');
  });

  it('internal date inconsistencies: end before start, option after start', () => {
    const c = contractFields({ startDate: '2027-03-12', endDate: '2027-03-10', optionDate: '2027-03-20' });
    const d = diffContractVsQuote(c, quote({ endDate: '2027-03-10', optionDate: '2027-03-20' }));
    const inc = d.filter((x) => x.kind === 'date_inconsistency');
    expect(inc.map((x) => x.field).sort()).toEqual(['endDate', 'optionDate']);
    expect(inc.every((x) => x.severity === 'error')).toBe(true);
  });

  it('null fields on both sides are ignored', () => {
    const blank: Partial<ContractFields> = { menu: null, hall: null, guaranteePax: null, optionDate: null, totalAmount: null };
    expect(diffContractVsQuote(contractFields(blank), quote(blank))).toEqual([]);
  });
});

describe('isContractClean', () => {
  it('warnings also prevent signature', () => {
    expect(isContractClean([{ field: 'menu', label: 'Menü', contractValue: 'a', quoteValue: 'b', severity: 'warning', kind: 'mismatch', message: '' }])).toBe(false);
    expect(isContractClean([])).toBe(true);
  });
});

describe('conditionRisk (§7 Adım 5)', () => {
  it('supplier 30% prepayment, no customer deposit → full prepayment at risk', () => {
    const r = conditionRisk({ supplierTotalEur: 10000, supplierPrepaymentRate: 0.3, customerTotalEur: 12500, customerDepositRate: 0 });
    expect(r.riskEur).toBe(3000);
    expect(r.note).toMatch(/kapora yok/);
  });
  it('partial deposit reduces risk', () => {
    const r = conditionRisk({ supplierTotalEur: 10000, supplierPrepaymentRate: 0.3, customerTotalEur: 12500, customerDepositRate: 0.2 });
    expect(r.riskEur).toBe(500);
    expect(r.note).toMatch(/%20/);
  });
  it('deposit covering prepayment → no risk', () => {
    expect(conditionRisk({ supplierTotalEur: 10000, supplierPrepaymentRate: 0.3, customerTotalEur: 12500, customerDepositRate: 0.3 })).toEqual({ riskEur: 0, note: null });
    expect(conditionRisk({ supplierTotalEur: 10000, supplierPrepaymentRate: 0, customerTotalEur: 12500, customerDepositRate: 0 })).toEqual({ riskEur: 0, note: null });
  });
});
