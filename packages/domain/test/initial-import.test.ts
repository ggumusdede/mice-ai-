import { describe, expect, it } from 'vitest';
import {
  historicalProjectCode, importDate, importKinds, importNaturalKey, importNumber, importUnit, importWindowStart, matchHeaders,
  normalizeImportRow, normalizeName, normalizeVkn, parseCsv, rowStatus,
} from '../src/initial-import.js';

const opts = { today: '2026-11-20', windowMonths: 18 };

describe('§8 initial import — parsing helpers', () => {
  it('parses ; and , CSV with quotes, BOM and embedded newlines', () => {
    expect(parseCsv('﻿a;b;c\n1;"x;y";"çok\nsatır"\n\n')).toEqual([['a', 'b', 'c'], ['1', 'x;y', 'çok\nsatır']]);
    expect(parseCsv('a,b\r\n"1,5",2')).toEqual([['a', 'b'], ['1,5', '2']]);
  });
  it('TR numbers / dates and Excel serials', () => {
    expect(importNumber('1.234,56')).toBeCloseTo(1234.56);
    expect(importNumber(105.5)).toBe(105.5);
    expect(importDate('05.03.2026')).toBe('2026-03-05');
    expect(importDate(45000)).toBe('2023-03-15');
    expect(importDate('31.02.2026')).toBeNull();
  });
  it('matches Turkish headers and aliases; reports missing required columns', () => {
    const m = matchHeaders('suppliers', ['Tedarikçi adı', 'Vergi No', 'İl', 'Hizmet türleri', 'Foo']);
    expect(m.keys).toEqual(['name', 'vkn', 'city', 'kinds', null]);
    expect(m.unknown).toEqual(['Foo']);
    expect(matchHeaders('projects', ['Proje kodu']).missing).toContain('Müşteri');
  });
  it('normalizes names, VKN, kinds, units', () => {
    expect(normalizeName('Anadolu İlaç A.Ş.')).toBe(normalizeName('ANADOLU ILAC'));
    expect(normalizeName('Ege Otomotiv San. ve Tic. Ltd. Şti.')).toBe('EGEOTOMOTIV');
    expect(normalizeVkn('123 456 7890')).toEqual({ value: '1234567890', invalid: false });
    expect(normalizeVkn('12345').invalid).toBe(true);
    expect(importKinds('konaklama, Salon; yiyecek-içecek').kinds).toEqual(['accommodation', 'hall', 'fnb']);
    expect(importUnit('oda/gece')).toEqual({ unit: 'room_night', known: true });
    expect(importUnit('Kişi/Gün').unit).toBe('pax_day');
  });
  it('window start subtracts months (clamped)', () => {
    expect(importWindowStart('2026-11-20', 18)).toBe('2025-05-20');
    expect(importWindowStart('2026-08-31', 6)).toBe('2026-02-28');
  });
});

describe('§8 initial import — row validation', () => {
  const project = (o: Record<string, string>) => normalizeImportRow('projects', { code: 'P1', customer: 'ACME', start_date: '10.03.2026', outcome: 'kazanıldı', ...o }, opts);
  it('18-month window: older is an error (excluded), future is NOT_CLOSED, inside is ok', () => {
    expect(rowStatus(project({}).issues)).toBe('ok');
    expect(project({ start_date: '10.03.2025' }).issues.map((i) => i.code)).toContain('OUT_OF_WINDOW');
    expect(project({ start_date: '10.03.2027' }).issues.map((i) => i.code)).toContain('NOT_CLOSED');
    // configurable: a 24-month rule accepts it
    expect(rowStatus(normalizeImportRow('projects', { code: 'P1', customer: 'A', start_date: '10.03.2025', outcome: 'won' }, { ...opts, windowMonths: 24 }).issues)).toBe('ok');
  });
  it('lost needs a reason; unknown outcome is an error', () => {
    expect(project({ outcome: 'kaybedildi' }).issues.map((i) => i.code)).toContain('LOST_REASON_REQUIRED');
    expect(rowStatus(project({ outcome: 'kaybedildi', lost_reason: 'Fiyat' }).issues)).toBe('ok');
    expect(project({ outcome: 'belki' }).issues.map((i) => i.code)).toContain('UNKNOWN_OUTCOME');
  });
  it('service lines: required, currency, cost ≤ sale sanity', () => {
    const base = { project_code: 'P1', kind: 'salon', description: 'Salon', supplier: 'X', quantity: '2', unit: 'gün', currency: 'EUR', unit_cost: '1.300,00', unit_sale: '1.560,00' };
    const ok = normalizeImportRow('service_lines', base, opts);
    expect(rowStatus(ok.issues)).toBe('ok');
    expect(ok.data).toMatchObject({ kind: 'hall', unit: 'day', unitCost: 1300, unitSale: 1560, currency: 'EUR' });
    expect(normalizeImportRow('service_lines', { ...base, unit_sale: '1000' }, opts).issues.map((i) => i.code)).toContain('COST_ABOVE_SALE');
    expect(rowStatus(normalizeImportRow('service_lines', { ...base, currency: 'JPY' }, opts).issues)).toBe('error');
    expect(normalizeImportRow('service_lines', { ...base, quantity: '' }, opts).issues.map((i) => i.code)).toContain('REQUIRED');
  });
  it('supplier status akredite is never trusted from the file', () => {
    const r = normalizeImportRow('suppliers', { name: 'X', city: 'İstanbul', kinds: 'salon', status: 'akredite' }, opts);
    expect(r.data).toMatchObject({ status: 'candidate', accredit: false });
    expect(rowStatus(r.issues)).toBe('warning');
    const a = normalizeImportRow('suppliers', { name: 'X', city: 'İstanbul', kinds: 'salon', status: 'akredite', accredit: 'evet' }, opts);
    expect(a.data.accredit).toBe(true);
  });
  it('natural keys and historical codes', () => {
    expect(importNaturalKey('customers', { vkn: '1234567890' })).toBe('vkn:1234567890');
    expect(importNaturalKey('suppliers', { name: 'Moda Otel', city: 'İstanbul' })).toBe(importNaturalKey('suppliers', { name: 'MODA OTEL', city: 'istanbul' }));
    expect(historicalProjectCode(' 2025 034 ')).toBe('H-2025-034');
  });
});

describe('finance_movements (Q5: historical movements with their actual rate)', () => {
  const opts = { today: '2026-11-20', windowMonths: 18 };
  it('derives the rate from rate / TL / EUR equivalents; flags missing evidence; refuses future dates', () => {
    const a = normalizeImportRow('finance_movements', { project_code: 'X', type: 'tahsilat', date: '20.03.2026', amount: '370.000,00', currency: 'TL', eur_amount: '10.000' }, opts);
    expect(a.data).toMatchObject({ type: 'collection', currency: 'TRY', eurRate: 37, eurTryRate: 37 });
    expect(a.issues).toEqual([]);
    const b = normalizeImportRow('finance_movements', { project_code: 'X', type: 'müşteri faturası', date: '12.03.2026', amount: '10000', currency: 'EUR' }, opts);
    expect(b.issues.map((i) => i.code)).toEqual(['FX_EVIDENCE_MISSING']);
    const c = normalizeImportRow('finance_movements', { project_code: 'X', type: 'havale?', date: '12.12.2026', amount: '1', currency: 'EUR', rate: '36' }, opts);
    expect(c.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['UNKNOWN_MOVEMENT_TYPE', 'FUTURE_DATE']));
  });
});
