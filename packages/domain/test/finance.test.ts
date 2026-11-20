import { describe, expect, it } from 'vitest';
import { matchBankTransaction, parseBankCsv, parseTrNumber, parseTrDate } from '../src/bank-matching.js';
import { closingCheck, supplierScore, type ClosingInput } from '../src/closing.js';
import { profitSummary } from '../src/pricing.js';

describe('parseTrNumber', () => {
  it.each([
    ['1.234,56', 1234.56], ['1,234.56', 1234.56], ['1234,56', 1234.56], ['1234.56', 1234.56], ['1.234', 1234], ['1.234.567', 1234567],
    ['1,234,567', 1234567], ['12,5', 12.5], ['-1.234,56', -1234.56], ['(1.234,56)', -1234.56], ['1.234,56-', -1234.56], ['1.234,56 TL', 1234.56],
    ['€ 1,234.56', 1234.56], ['+500', 500], ['0,00', 0], ['1 234,56', 1234.56], ['42', 42],
  ])('%s → %f', (s, n) => {
    expect(parseTrNumber(s)).toBeCloseTo(n, 6);
  });
  it('unparsable → NaN', () => {
    expect(parseTrNumber('')).toBeNaN();
    expect(parseTrNumber('abc')).toBeNaN();
    expect(parseTrNumber('1.2.3,4.5')).toBeNaN();
  });
});

describe('parseTrDate', () => {
  it('handles TR and ISO formats', () => {
    expect(parseTrDate('05.03.2027')).toBe('2027-03-05');
    expect(parseTrDate('5/3/2027 14:22')).toBe('2027-03-05');
    expect(parseTrDate('2027-03-05')).toBe('2027-03-05');
    expect(parseTrDate('31.02.2027')).toBeNull();
    expect(parseTrDate('Toplam')).toBeNull();
  });
});

describe('parseBankCsv', () => {
  it('semicolon export with Tutar column, quotes, title & total rows', () => {
    const csv = [
      'Hesap Hareketleri;;;;',
      'Tarih;Açıklama;Tutar;Bakiye;Döviz',
      '16.11.2026;"EFT GELEN ACME ILAC; FTR 2026-118";125.000,00;300.000,00;TL',
      '17.11.2026;HAVALE HILTON BOMONTI PRJ-0042;-37.500,50;262.499,50;TRY',
      ';Toplam;87.499,50;;',
    ].join('\r\n');
    const rows = parseBankCsv(csv);
    expect(rows).toEqual([
      { bookedAt: '2026-11-16', amount: 125000, currency: 'TRY', description: 'EFT GELEN ACME ILAC; FTR 2026-118', counterparty: null },
      { bookedAt: '2026-11-17', amount: -37500.5, currency: 'TRY', description: 'HAVALE HILTON BOMONTI PRJ-0042', counterparty: null },
    ]);
  });
  it('Borç / Alacak columns, comma separator with quoted TR amounts, counterparty', () => {
    const csv = '﻿İşlem Tarihi,Valör,Karşı Taraf,Açıklama,Borç,Alacak\n01/12/2026,01/12/2026,Hilton Bomonti,"Ödeme",' + '"1.500,00",\n02/12/2026,02/12/2026,Acme,"Tahsilat",,"2.000,00"\n';
    const rows = parseBankCsv(csv);
    expect(rows).toEqual([
      { bookedAt: '2026-12-01', amount: -1500, currency: 'TRY', description: 'Ödeme', counterparty: 'Hilton Bomonti' },
      { bookedAt: '2026-12-02', amount: 2000, currency: 'TRY', description: 'Tahsilat', counterparty: 'Acme' },
    ]);
  });
  it('headerless fallback (date, description, amount, currency) and EUR', () => {
    expect(parseBankCsv('16.11.2026;Transfer;1.000,00;EUR')).toEqual([{ bookedAt: '2026-11-16', amount: 1000, currency: 'EUR', description: 'Transfer', counterparty: null }]);
  });
  it('empty input', () => {
    expect(parseBankCsv('')).toEqual([]);
  });
});

describe('matchBankTransaction', () => {
  const entries = [
    { id: 'e1', amount: 125000, currency: 'TRY', reference: 'PRJ-0042', invoiceNo: 'FTR 2026-118', counterpartyName: 'Acme İlaç A.Ş.', dueDate: '2026-11-15', direction: 'in' as const },
    { id: 'e2', amount: 125000, currency: 'TRY', reference: null, invoiceNo: 'FTR 2026-200', counterpartyName: 'Beta Holding', dueDate: '2026-12-30', direction: 'in' as const },
    { id: 'e3', amount: 125000, currency: 'TRY', reference: null, invoiceNo: null, counterpartyName: null, dueDate: null, direction: 'out' as const },
    { id: 'e4', amount: 3000, currency: 'EUR', reference: null, invoiceNo: null, counterpartyName: null, dueDate: null, direction: 'in' as const },
  ];
  it('exact amount + invoice no + name + date → high confidence first', () => {
    const r = matchBankTransaction({ amount: 125000, currency: 'TRY', description: 'EFT GELEN ACME ILAC FTR2026118', counterparty: 'ACME ILAC AS', bookedAt: '2026-11-16' }, entries);
    expect(r[0].entryId).toBe('e1');
    expect(r[0].confidence).toBeGreaterThanOrEqual(0.9);
    expect(r[1]).toMatchObject({ entryId: 'e2' });
    expect(r[1].confidence).toBeCloseTo(0.6);
    expect(r.find((c) => c.entryId === 'e3')).toBeUndefined(); // wrong direction
    expect(r.find((c) => c.entryId === 'e4')).toBeUndefined(); // other currency, no evidence
  });
  it('ambiguous exact-amount ties are penalised below auto-match', () => {
    const r = matchBankTransaction({ amount: 125000, currency: 'TRY', description: 'EFT', counterparty: null, bookedAt: '2026-10-01' }, entries);
    expect(r.map((c) => c.entryId)).toEqual(['e1', 'e2']);
    expect(r[0].confidence).toBeCloseTo(0.48);
    expect(r[0].reasons.join()).toMatch(/belirsiz/);
  });
  it('near amounts and outgoing payments', () => {
    const out = matchBankTransaction({ amount: -124000, currency: 'TRY', description: 'Havale', counterparty: null, bookedAt: '2026-11-16' }, entries);
    expect(out).toEqual([{ entryId: 'e3', confidence: 0.4, reasons: ['Para birimi aynı', 'Tutar %1 içinde'] }]);
  });
  it('zero amount → no candidates', () => {
    expect(matchBankTransaction({ amount: 0, currency: 'TRY', description: '', counterparty: null, bookedAt: '2026-11-16' }, entries)).toEqual([]);
  });
});

describe('closingCheck', () => {
  const base: ClosingInput = {
    supplierInvoicesExpected: 3, supplierInvoicesReceived: 3, customerInvoiceIssued: true, receivablesOpenEur: 0, unbilledPayments: 0,
    commissionsUnreconciled: 0, lostReasonMissing: false, planned: profitSummary(10000, 12500), actual: profitSummary(10400, 12500),
    deviations: [{ reason: 'Saha ekstrası yansıtılmadı', amountEur: 400 }],
  };
  it('all done → ok, plan vs actual passed through', () => {
    const r = closingCheck(base);
    expect(r.ok).toBe(true);
    expect(r.items).toHaveLength(6);
    expect(r.planVsActual.deviations[0].amountEur).toBe(400);
    expect(r.planVsActual.actual!.profitEur).toBe(2100);
  });
  it('each open item blocks closing', () => {
    const cases: Partial<ClosingInput>[] = [
      { supplierInvoicesReceived: 2 }, { customerInvoiceIssued: false }, { receivablesOpenEur: 50 }, { unbilledPayments: 1 }, { commissionsUnreconciled: 2 }, { lostReasonMissing: true },
    ];
    for (const c of cases) {
      const r = closingCheck({ ...base, ...c });
      expect(r.ok).toBe(false);
      expect(r.items.filter((i) => !i.ok)).toHaveLength(1);
    }
    expect(closingCheck({ ...base, supplierInvoicesReceived: 1 }).items[0].detail).toContain('2 eksik');
  });
});

describe('supplierScore', () => {
  it('perfect supplier → 100; unknown response → no penalty', () => {
    expect(supplierScore({ avgResponseHours: 2, contractErrors: 0, fieldIssues: 0, invoiceMismatches: 0, projects: 5 })).toBe(100);
    expect(supplierScore({ avgResponseHours: null, contractErrors: 0, fieldIssues: 0, invoiceMismatches: 0, projects: 0 })).toBe(100);
  });
  it('penalties accumulate and are normalised by project count', () => {
    const one = supplierScore({ avgResponseHours: 4, contractErrors: 1, fieldIssues: 0, invoiceMismatches: 0, projects: 1 });
    const five = supplierScore({ avgResponseHours: 4, contractErrors: 1, fieldIssues: 0, invoiceMismatches: 0, projects: 5 });
    expect(one).toBe(85);
    expect(five).toBe(97);
    expect(supplierScore({ avgResponseHours: 72, contractErrors: 0, fieldIssues: 0, invoiceMismatches: 0, projects: 1 })).toBe(75);
  });
  it('clamped to 0..100', () => {
    expect(supplierScore({ avgResponseHours: 500, contractErrors: 10, fieldIssues: 10, invoiceMismatches: 10, projects: 1 })).toBe(0);
    expect(supplierScore({ avgResponseHours: 1, contractErrors: -3, fieldIssues: 0, invoiceMismatches: 0, projects: 1 })).toBe(100);
  });
});
