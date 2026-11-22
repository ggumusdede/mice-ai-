// Senaryolar — §7 Adım 7 Fatura, ödeme ve tahsilat (onay kapısı), §17.8 Mikro, e-Fatura (docs/10-senaryolar.md S7-xx)
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { makeWorld, ownerSql, scenarioSuite, upload, type World } from './_scenario.js';

const S = scenarioSuite();
const UBL = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/ubl-tr-invoice.xml'));
const inv = (w: World, p: { id: string }, invoiceNo: string, amount: number, extra: Record<string, unknown> = {}) =>
  w.finance.post('/api/finance/supplier-invoices', { projectId: p.id, supplierId: w.supplier('moda'), invoiceNo, amount, currency: 'EUR', issueDate: '2027-03-15', ...extra });

describe('Adım 7 — finans', () => {
  it('S7-01 §7.7 tedarikçi faturası sözleşmeye bağlanır; tolerans (%0,5) içi alarm yok, üstü alarm + görev + yönetici bildirimi; mükerrer fatura reddedilir', async () => {
    const w = await makeWorld(S, 's7a');
    const p = await w.flow().signed();
    expect((await inv(w, p, 'MSO-1', 13250 * 1.004)).body.alarms).toEqual([]);
    expect((await inv(w, p, 'MSO-1', 1)).body.error.code).toBe('DUPLICATE_INVOICE');
    const over = await inv(w, p, 'MSO-2', 100);
    expect(over.body.alarms[0]).toMatch(/Tutar farkı/);
    expect((await p.tasks('invoice_mismatch')).length).toBe(1);
    expect((await ownerSql(`SELECT count(*)::int AS n FROM notifications WHERE tenant_id = $1 AND entity_id = $2`, [w.t.tenantId, over.body.entry.id]))[0].n).toBeGreaterThan(0);
    // same number from ANOTHER supplier is a different invoice
    expect((await w.finance.post('/api/finance/supplier-invoices', { projectId: p.id, supplierId: w.supplier('transfer'), invoiceNo: 'MSO-1', amount: 200, currency: 'EUR' })).status).toBe(200);
  });

  it('S7-02 §7.7 farklı para birimi: TRY fatura EUR\'ya çevrilir, sözleşme EUR olduğundan para birimi alarmı', async () => {
    const w = await makeWorld(S, 's7b');
    const p = await w.flow().signed();
    const r = await w.finance.post('/api/finance/supplier-invoices', { projectId: p.id, supplierId: w.supplier('moda'), invoiceNo: 'TRY-1', amount: 13250 * 48.5, currency: 'TRY' });
    expect(r.body.entry.amountEur).toBeCloseTo(13250, 0);
    expect(r.body.alarms.join(' ')).toMatch(/Para birimi farklı/);
  });

  it('S7-03 §7.7 / §17.1 ödeme: finans talep eder (onaylayamaz) → yönetici Face ID ile tek tek onaylar → "ödendi"yi insan işaretler; clerk talep açamaz', async () => {
    const w = await makeWorld(S, 's7c');
    const p = await w.flow().signed();
    const payables = await p.finance('payable');
    const prep = payables.find((e) => e.meta.part === 'prepayment');
    expect((await w.clerk.post('/api/finance/payment-requests', { entryId: prep.id })).status).toBe(403);
    expect((await w.finance.post('/api/finance/payment-requests', { entryId: prep.id })).body.status).toBe('pending_approval');
    const c = await w.card('payment_approval', { entityId: prep.id });
    expect((await w.cards({ kind: 'payment_approval', who: 'finance' })).length).toBe(0);
    expect((await w.decide(c, 'approve', { who: 'finance' })).status).toBe(403);
    expect((await w.finance.post(`/api/finance/entries/${prep.id}/mark-paid`, {})).body.error.code).toBe('PAYMENT_NOT_APPROVED');
    expect((await w.decide(c, 'approve', { bio: false })).body.error.code).toBe('BIOMETRIC_REQUIRED');
    expect((await w.decide(c, 'approve', { device: 'iPhone 15' })).body.effects).toContain('payment_approved');
    expect((await p.finance('payable')).find((e) => e.id === prep.id).status).toBe('approved'); // sistem para hareket ettirmez
    expect((await w.finance.post(`/api/finance/entries/${prep.id}/mark-paid`, { reference: 'EFT-1' })).body.status).toBe('paid');
    // the balance needs its own approval (each payment individually)
    const balance = payables.find((e) => e.meta.part === 'balance');
    expect(balance.status).toBe('open');
  });

  it('S7-04 §17.1 vekil (finans) kendi açtığı ödeme talebini onaylayamaz; yönetici onaylayabilir', async () => {
    const w = await makeWorld(S, 's7d');
    const p = await w.flow().signed();
    await w.admin.post('/api/delegations', { delegateId: w.user('finance').id, startsAt: '2026-11-19T00:00:00Z', endsAt: '2026-12-31T00:00:00Z' });
    const prep = (await p.finance('payable')).find((e) => e.meta.part === 'prepayment');
    await w.finance.post('/api/finance/payment-requests', { entryId: prep.id });
    const c = await w.card('payment_approval', { entityId: prep.id, who: 'finance' });
    expect((await w.decide(c, 'approve', { who: 'finance' })).body.error.code).toBe('SELF_APPROVAL_FORBIDDEN');
    expect((await w.decide(c, 'approve')).body.effects).toContain('payment_approved');
  });

  it('S7-05 §7.7 banka ekstresi (TR biçimi: ; ayraç, 1.234,56, GG.AA.YYYY): otomatik eşleşme / öneri / eşleşmeyen; tekrar yükleme idempotent', async () => {
    const w = await makeWorld(S, 's7e');
    const p = await w.flow().signed();
    const fin = await p.finance();
    const prep = fin.find((e) => e.kind === 'payable' && e.meta.part === 'prepayment');
    const rec = fin.find((e) => e.kind === 'receivable');
    const tr = (n: number) => n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const csv = ['İşlem Tarihi;Açıklama;Karşı Taraf;Tutar;Döviz',
      `20.11.2026;${p.code} ön ödeme;Moda Sahil Otel;-${tr(prep.amount)};EUR`,
      `21.11.2026;Havale gelen;;${tr(rec.amount * 0.995)};EUR`,
      '21.11.2026;Kart ödemesi;Bilinmeyen Ltd;-1.250,00;EUR'].join('\n');
    const imp = await upload(w, 'finance', '/api/finance/bank-statements', {}, { name: 'ekstre.csv', type: 'text/csv', content: csv });
    expect(imp.body).toMatchObject({ imported: 3, matched: 1, suggested: 1, unmatched: 1 });
    expect((await upload(w, 'finance', '/api/finance/bank-statements', {}, { name: 'ekstre.csv', type: 'text/csv', content: csv })).body).toMatchObject({ imported: 0, duplicates: 3 });
    const tx = (await w.finance.get('/api/finance/bank-transactions')).body.items;
    expect(tx.find((t: any) => t.status === 'unmatched').amount).toBe(-1250);
    const sug = tx.find((t: any) => t.status === 'suggested');
    const c = await w.card('low_confidence_review', { entityId: sug.id, who: 'finance' });
    expect((await w.decide(c, 'approve', { who: 'finance' })).body.effects).toContain(`payment_matched:${rec.id}`);
  });

  it('S7-06 §7.7 fatura edilmemiş ödeme: ödeyene her gün hatırlatma, 7. günde yöneticiye eskalasyon (6. gün değil); eşleştirince kapanır', async () => {
    const w = await makeWorld(S, 's7f');
    const p = await w.flow().signed();
    await w.finance.post('/api/finance/bank-statements', { csv: 'Tarih;Açıklama;Tutar;Döviz\n20.11.2026;Nakit avans;-750,00;EUR' });
    const tx = (await w.finance.get('/api/finance/bank-transactions?status=unmatched')).body.items[0];
    await w.worker('2026-11-21T10:00');
    await w.worker('2026-11-22T10:00');
    expect((await w.finance.get('/api/tasks?mine=1&status=open')).body.items.filter((t: any) => t.kind === 'unbilled_payment')).toHaveLength(2);
    await w.worker('2026-11-26T10:00'); // 6 gün
    expect(await w.cards({ kind: 'unbilled_payment_escalation' })).toHaveLength(0);
    await w.worker('2026-11-27T10:00'); // 7 gün
    expect(await w.cards({ kind: 'unbilled_payment_escalation', entityId: tx.id })).toHaveLength(1);
    const i = await w.finance.post('/api/finance/supplier-invoices', { projectId: p.id, supplierId: w.supplier('moda'), invoiceNo: 'AV-1', amount: 750, currency: 'EUR' });
    expect((await w.finance.post(`/api/finance/bank-transactions/${tx.id}/match`, { entryId: i.body.entry.id })).body.status).toBe('matched');
    expect((await w.finance.get('/api/tasks?mine=1&status=open')).body.items.filter((t: any) => t.kind === 'unbilled_payment')).toHaveLength(0);
  });

  it('S7-07 §7.7 komisyon mutabakatı (ayrı faturalanan %10, KDV ayrı notu) + Mikro Excel aktarımı (tarih filtresi, cari kodlar)', async () => {
    const w = await makeWorld(S, 's7g');
    const p = await w.flow().signed();
    await inv(w, p, 'MSO-9', 13250, { vatAmount: 1585, issueDate: '2027-03-15' });
    await w.finance.post('/api/finance/customer-invoices', { projectId: p.id, invoiceNo: 'SF-1', amount: 15900, currency: 'EUR', vatAmount: 2120, issueDate: '2027-03-16' });
    await w.finance.post('/api/finance/customer-invoices', { projectId: p.id, invoiceNo: 'SF-OLD', amount: 1, currency: 'EUR', issueDate: '2027-02-01' });
    const com = (await w.finance.get(`/api/finance/commissions?projectId=${p.id}`)).body.items[0];
    expect(com).toMatchObject({ amount: 1325, status: 'open' });
    expect(com.meta.vatNote).toBe('KDV ayrı');
    expect((await w.finance.post(`/api/finance/commissions/${com.id}/reconcile`, { invoiceNo: 'KOM-1', amount: 1300 })).body.meta.difference).toBe(-25);
    const exp = async (qs: string) => {
      const x = await w.T.app.inject({ method: 'GET', url: `/api/finance/export/mikro${qs}`, headers: { authorization: `Bearer ${w.tokens.finance}` } });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(x.rawPayload as unknown as ArrayBuffer);
      const out: any[][] = [];
      wb.worksheets[0].eachRow((r, i) => i > 1 && out.push((r.values as any[]).slice(1)));
      return out;
    };
    expect((await exp('?from=2027-03-01&to=2027-03-31')).map((r) => r[3]).sort()).toEqual(['MSO-9', 'SF-1']); // SF-OLD dışarıda
    // komisyon satırının fatura tarihi yok → kayıt tarihiyle süzülür; tam aktarımda yer alır
    const rows = await exp('');
    expect(rows.map((r) => r[3]).sort()).toEqual(['KOM-1', 'MSO-9', 'SF-1', 'SF-OLD']);
    expect(rows.find((r) => r[3] === 'SF-1').slice(0, 2)).toEqual(['Satış Faturası', '120.MARMARATEK']);
    expect(rows.find((r) => r[3] === 'MSO-9')).toEqual(expect.arrayContaining(['Alış Faturası', '15.03.2027', 13250, 1585, 14835, 'EUR']));
    expect(rows.find((r) => r[3] === 'KOM-1')[0]).toBe('Satış Faturası (komisyon)');
  });

  it('S7-08 §10 e-Fatura UBL-TR: VKN ile tedarikçi bulunur, AI\'sız (güven 1.0) okunur, sözleşmeyle tutar uyumlu; aynı ETTN ikinci kez reddedilir', async () => {
    const w = await makeWorld(S, 's7h');
    const p = await w.flow().signed();
    await w.admin.patch(`/api/suppliers/${w.supplier('moda')}`, { taxNumber: '6080712345' });
    const up = () => upload(w, 'finance', '/api/finance/supplier-invoices', { projectId: p.id }, { name: 'fatura.xml', type: 'application/xml', content: UBL });
    const r = await up();
    expect(r.body.entry).toMatchObject({ supplierId: w.supplier('moda'), amount: 13250, invoiceNo: 'MSO2026000000042' });
    expect(r.body.entry.meta.readConfidence).toBe(1);
    expect(r.body.alarms.filter((a: string) => /Tutar farkı/.test(a))).toEqual([]);
    expect((await up()).body.error.code).toBe('DUPLICATE_INVOICE');
  });

  it('S7-09 §7.7 müşteri faturası taslağı: sözleşme + müşteri onaylı VE yansıtılan ekstralar (yansıtılmayan / onaysız değil)', async () => {
    const w = await makeWorld(S, 's7i');
    const p = await w.flow().signed();
    const mk = async (description: string, amountTry: number) => (await w.field.post(`/api/projects/${p.id}/field-extras`, { description, amountTry })).body;
    const a = await mk('Ek coffee break', 2000), b = await mk('İkram', 1000), c = await mk('Onaysız ekstra', 500);
    for (const e of [a, b]) await w.pub.post(`/api/public/extras/${e.approvalLink.split('/e/')[1]}/approve`, { approverName: 'Burak' });
    await w.ops.post(`/api/field-extras/${a.id}/reflect`, { reflected: true });
    await w.ops.post(`/api/field-extras/${b.id}/reflect`, { reflected: false, reason: 'ikram' });
    await w.ops.post(`/api/field-extras/${c.id}/reflect`, { reflected: true });
    const doc = (await w.finance.post(`/api/projects/${p.id}/customer-invoice-draft`)).body;
    const d = doc.content.lines.map((l: any) => l.description).join(' | ');
    expect(d).toContain('Ek coffee break');
    expect(d).not.toContain('İkram');
    expect(d).not.toContain('Onaysız');
  });
});
