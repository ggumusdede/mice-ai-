// §18.9: real corrections → eval fixtures (PII masked), same format as packages/ai/eval/fixtures.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, makeApp, newTenant, ownerSql, type TestApp } from './helpers.js';
import { withTenant } from '../src/db/pool.js';
import { buildEvalFixtures, fetchExportRows } from '../src/scripts/export-eval-set.js';

let T: TestApp;
let t: Awaited<ReturnType<typeof newTenant>>;
beforeAll(async () => { T = await makeApp(); t = await newTenant('evalexp'); });
afterAll(() => closeApp(T));

describe('export-eval-set', () => {
  it('builds offer fixtures from corrected readings: gold = AI output + human corrections; PII masked', () => {
    const { fixtures, skipped } = buildEvalFixtures([
      {
        id: '11111111-2222-3333-4444-555555555555', action_type: 'document_reading', created_at: '2026-11-02T10:00:00Z', input_summary: { kind: 'supplier_offer' },
        output: { supplierName: 'Moda Sahil Otel', currency: 'EUR', optionUntil: '2027-01-10', lines: [{ description: 'Oda DBL', kind: 'accommodation', unitPrice: 120, quantity: 20, nights: 2, roomType: 'DBL' }] },
        correction: { changes: { optionUntil: { before: '2027-01-10', after: '2027-01-20' } } },
        source_text: 'Moda Sahil Otel\nOda DBL 120 EUR x 20 oda x 2 gece\nOpsiyon 20.01.2027\nİletişim: Ayşe Demir, ayse.demir@modasahil.com.tr, 0532 111 22 33', source_channel: null,
      },
      { id: 'x2', action_type: 'document_reading', created_at: '2026-11-02', input_summary: { kind: 'supplier_invoice' }, output: {}, correction: {}, source_text: null, source_channel: null },
    ], ['Ayşe Demir']);
    expect(skipped).toEqual({ 'no_source_text:supplier_invoice': 1 });
    expect(fixtures).toHaveLength(1);
    const f = fixtures[0];
    expect(f).toMatchObject({ docType: 'offer', language: 'tr', gold: { supplierName: 'Moda Sahil Otel', optionUntil: '2027-01-20', currency: 'EUR' } });
    expect(f.gold.lines).toEqual([{ kind: 'accommodation', unitPrice: 120, quantity: 20, nights: 2, roomType: 'DBL' }]);
    expect(f.input.text).not.toMatch(/Ayşe Demir|ayse\.demir|0532/);
    expect(f.input.text).toMatch(/\[PERSON_1\]/);
    expect(f.tags).toContain('corrected:optionUntil');
  });

  it('the export query runs under RLS (fresh tenant → nothing to export)', async () => {
    await ownerSql('SELECT 1');
    const r = await withTenant(t.tenantId, { type: 'system', id: null }, (db) => fetchExportRows(db, '2000-01-01', 10));
    expect(r.rows).toEqual([]);
    expect(r.names.length).toBeGreaterThan(0);
  });
});
