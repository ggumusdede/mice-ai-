// Phase B — §7 Adım 7 finance: supplier invoice reading + mismatch alarm, payment request → Face ID decision (AI never),
// bank statement import with automatic / suggested matching, unbilled payment reminder + 7-day escalation, Mikro export.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import pg from 'pg';
import { APP_URL, client, closeApp, login, makeApp, newTenant, ownerSql, resetClock, type Client, type TestApp } from './helpers.js';
import { signedProject } from './phase-b-helpers.js';
import { withSystemCtx } from '../src/context.js';
import { runDecisionEffect } from '../src/services/decisions.js';
import { runFollowupsForTenant } from '../src/worker.js';

let T: TestApp;

beforeAll(async () => {
  T = await makeApp();
});
beforeEach(() => resetClock());
afterAll(() => closeApp(T));

async function users(t: Awaited<ReturnType<typeof newTenant>>) {
  return {
    admin: client(T.app, await login(T.app, t.users.admin.email)),
    clerk: client(T.app, await login(T.app, t.users.clerk.email)),
    ops: client(T.app, await login(T.app, t.users.ops.email)),
    finance: client(T.app, await login(T.app, t.users.finance.email)),
  };
}

function multipart(fields: Record<string, string>, file: { name: string; type: string; content: Buffer | string }) {
  const boundary = '----micetest' + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`));
  parts.push(Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, 'utf8'));
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

async function upload(token: string, url: string, fields: Record<string, string>, file: { name: string; type: string; content: Buffer | string }) {
  const mp = multipart(fields, file);
  const r = await T.app.inject({ method: 'POST', url, payload: mp.payload, headers: { ...mp.headers, authorization: `Bearer ${token}` } });
  return { status: r.statusCode, body: r.json() };
}

describe('supplier invoices', () => {
  it('reads an invoice file (AI), links it to the contract; amount mismatch → alarm + alert task; separate commission listed', async () => {
    const t = await newTenant('fin-inv');
    const u = await users(t);
    const sp = await signedProject(T.app, u.admin, t);
    const ftoken = await login(T.app, t.users.finance.email);
    const text = `MODA SAHIL OTEL\nFatura No: MSO2026-0042\nFatura Tarihi: 25.11.2026\nVade: 10.12.2026\nKonaklama 110 oda gece  10.650,00 EUR\nSalon kirası 2.600,00 EUR\nMatrah: 13.250,00 EUR\nKDV: 1.585,00 EUR\nGenel Toplam: 14.835,00 EUR`;
    const ok = await upload(ftoken, '/api/finance/supplier-invoices', { projectId: sp.projectId, supplierId: t.suppliers.moda, serviceItemIds: `${sp.accItemId},${sp.hallItemId}` },
      { name: 'fatura.txt', type: 'text/plain', content: text });
    expect(ok.status).toBe(200);
    expect(ok.body.entry).toMatchObject({ kind: 'supplier_invoice', invoiceNo: 'MSO2026-0042', amount: 13250, currency: 'EUR', dueDate: '2026-12-10', serviceItemId: sp.accItemId });
    expect(ok.body.entry.meta.serviceItemIds).toEqual([sp.accItemId, sp.hallItemId]);
    expect(ok.body.alarms).toEqual([]);
    expect((await u.finance.post('/api/finance/supplier-invoices', { projectId: sp.projectId, supplierId: t.suppliers.moda, invoiceNo: 'MSO2026-0042', amount: 1, currency: 'EUR', issueDate: '2026-11-25' })).body.error.code).toBe('DUPLICATE_INVOICE');

    // a second invoice exceeds the contract → alarm + alert task
    const extra = await u.finance.post('/api/finance/supplier-invoices', { projectId: sp.projectId, supplierId: t.suppliers.moda, invoiceNo: 'MSO2026-0050', amount: 900, currency: 'EUR', vatAmount: 180, issueDate: '2026-11-26' });
    expect(extra.status).toBe(200);
    expect(extra.body.alarms[0]).toMatch(/Tutar farkı/);
    expect(extra.body.entry.meta.mismatch).toBe(true);
    const tasks = (await u.finance.get(`/api/tasks?projectId=${sp.projectId}`)).body.items;
    expect(tasks.some((x: any) => x.kind === 'invoice_mismatch' && x.title.includes('MSO2026-0050'))).toBe(true);
    // supplier without a contract → alarm
    const noC = await u.finance.post('/api/finance/supplier-invoices', { projectId: sp.projectId, supplierId: t.suppliers.transfer, invoiceNo: 'TR-1', amount: 300, currency: 'EUR' });
    expect(noC.body.alarms[0]).toMatch(/imzalı sözleşme yok/);
    expect((await u.clerk.post('/api/finance/supplier-invoices', { projectId: sp.projectId, supplierId: t.suppliers.moda, invoiceNo: 'X', amount: 1, currency: 'EUR' })).status).toBe(403);

    // moda bills its 10 % commission separately → commission entries (reconciliation list)
    const com = await u.finance.get(`/api/finance/commissions?projectId=${sp.projectId}`);
    expect(com.body.items[0]).toMatchObject({ kind: 'commission', amount: 1325, status: 'open' });
    const rec = await u.finance.post(`/api/finance/commissions/${com.body.items[0].id}/reconcile`, { invoiceNo: 'KOM-1', amount: 1325 });
    expect(rec.body.status).toBe('matched');

    const list = await u.finance.get(`/api/finance/entries?projectId=${sp.projectId}&kind=supplier_invoice`);
    expect(list.body.items).toHaveLength(3);
    // realized profit appears in the project detail (margin and markup separately)
    const detail = await u.admin.get(`/api/projects/${sp.projectId}`);
    expect(detail.body.profit.realized.costEur).toBeCloseTo(14450, 0);
    expect(detail.body.profit.realized).toHaveProperty('margin');
    expect(detail.body.profit.realized).toHaveProperty('markup');

    // Mikro export: customer invoice recorded + supplier invoices in the date range
    await u.finance.post('/api/finance/customer-invoices', { projectId: sp.projectId, invoiceNo: 'SF-2026-001', amount: 15900, currency: 'EUR', vatAmount: 2120, issueDate: '2026-11-27' });
    const x = await T.app.inject({ method: 'GET', url: '/api/finance/export/mikro?from=2026-11-01&to=2026-11-30', headers: { authorization: `Bearer ${ftoken}` } });
    expect(x.statusCode).toBe(200);
    expect(x.headers['content-type']).toContain('spreadsheetml');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.rawPayload as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    expect((ws.getRow(1).values as unknown[]).slice(1, 6)).toEqual(['Evrak Tipi', 'Cari Kod', 'Cari Ünvan', 'Belge No', 'Tarih']);
    const rows: unknown[][] = [];
    ws.eachRow((r, i) => i > 1 && rows.push((r.values as unknown[]).slice(1)));
    const sale = rows.find((r) => r[3] === 'SF-2026-001')!;
    expect(sale[0]).toBe('Satış Faturası');
    expect(sale[1]).toBe('120.MARMARATEK');
    expect(sale[4]).toBe('27.11.2026');
    const buy = rows.find((r) => r[3] === 'MSO2026-0042')!;
    expect(buy[0]).toBe('Alış Faturası');
    expect(String(buy[1])).toMatch(/^320\./);
    expect(buy[6]).toBe(13250);
    expect((await u.clerk.get('/api/finance/export/mikro')).status).toBe(403);
  });
});

describe('payment approval (every payment individually, Face ID, never AI)', () => {
  it('finance requests → admin approves with biometric → finance marks paid; AI / DB guards', async () => {
    const t = await newTenant('fin-pay');
    const u = await users(t);
    const sp = await signedProject(T.app, u.admin, t);
    const payables = (await u.finance.get(`/api/finance/entries?projectId=${sp.projectId}&kind=payable`)).body.items;
    const pre = payables.find((e: any) => e.meta.part === 'prepayment');
    expect((await u.clerk.post('/api/finance/payment-requests', { entryId: pre.id })).status).toBe(403);
    const req = await u.finance.post('/api/finance/payment-requests', { entryId: pre.id });
    expect(req.body.status).toBe('pending_approval');
    expect((await u.finance.post('/api/finance/payment-requests', { entryId: pre.id })).body.error.code).toBe('ENTRY_NOT_OPEN');
    const d = (await u.admin.get('/api/decisions')).body.items.find((x: any) => x.kind === 'payment_approval' && x.entityId === pre.id);
    expect(d.requiresBiometric).toBe(true);
    expect((await u.finance.get('/api/decisions')).body.items.some((x: any) => x.id === d.id)).toBe(false); // finance cannot approve
    expect((await u.finance.post(`/api/decisions/${d.id}/decide`, { action: 'approve', biometric: { method: 'dev' } })).status).toBe(403);
    expect((await u.finance.post(`/api/finance/entries/${pre.id}/mark-paid`, {})).body.error.code).toBe('PAYMENT_NOT_APPROVED');

    // AI path: the effect refuses to run automatically, and the DB refuses an AI actor approving money
    await expect(withSystemCtx(T.app.deps, t.tenantId, { type: 'ai', id: null }, async (ctx) => {
      const row = (await ctx.db.query('SELECT * FROM decisions WHERE id = $1', [d.id])).rows[0];
      return runDecisionEffect(ctx, row, { action: 'approve', decidedBy: null, auto: true });
    })).rejects.toMatchObject({ code: 'AI_FORBIDDEN_ACTION' });
    const c = new pg.Client({ connectionString: APP_URL });
    await c.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true), set_config('app.actor_type', 'ai', true)`, [t.tenantId]);
      await expect(c.query(`UPDATE finance_entries SET status = 'approved' WHERE id = $1`, [pre.id])).rejects.toMatchObject({ code: 'MI006' });
      await c.query('ROLLBACK');
    } finally {
      await c.end();
    }

    expect((await u.admin.post(`/api/decisions/${d.id}/decide`, { action: 'approve' })).body.error.code).toBe('BIOMETRIC_REQUIRED');
    const ok = await u.admin.post(`/api/decisions/${d.id}/decide`, { action: 'approve', biometric: { method: 'dev' }, device: 'iPhone 15' });
    expect(ok.body.effects).toContain('payment_approved');
    expect(ok.body.decision.decidedDevice).toBe('iPhone 15');
    const approved = (await u.finance.get(`/api/finance/entries?projectId=${sp.projectId}&kind=payable`)).body.items.find((e: any) => e.id === pre.id);
    expect(approved.status).toBe('approved'); // approved ≠ paid: no money moved by the system
    const paid = await u.finance.post(`/api/finance/entries/${pre.id}/mark-paid`, { reference: 'EFT-123' });
    expect(paid.body.status).toBe('paid');

    // a delegate (ops) may approve payments during the delegation window; rejection returns the entry to 'open'
    const bal = payables.find((e: any) => e.meta.part === 'balance');
    await u.finance.post('/api/finance/payment-requests', { entryId: bal.id });
    const d2 = (await u.admin.get('/api/decisions')).body.items.find((x: any) => x.kind === 'payment_approval' && x.entityId === bal.id);
    expect((await u.ops.post(`/api/decisions/${d2.id}/decide`, { action: 'reject' })).status).toBe(403);
    const del = await u.admin.post('/api/delegations', { delegateId: t.users.ops.id, startsAt: '2026-11-19T00:00:00Z', endsAt: '2026-11-30T00:00:00Z' });
    expect(del.status).toBe(200);
    const rej = await u.ops.post(`/api/decisions/${d2.id}/decide`, { action: 'reject', reason: 'Vade gelmedi' });
    expect(rej.body.decision.viaDelegation).toBe(true);
    expect((await u.finance.get(`/api/finance/entries?projectId=${sp.projectId}&status=open&kind=payable`)).body.items.map((e: any) => e.id)).toContain(bal.id);
  });
});

describe('bank statements', () => {
  it('CSV import: high-confidence auto match, low-confidence suggestion (aiGate), unmatched → daily reminder + 7-day escalation; idempotent', async () => {
    const t = await newTenant('fin-bank');
    const u = await users(t);
    const sp = await signedProject(T.app, u.admin, t);
    const fin = (await u.finance.get(`/api/finance/entries?projectId=${sp.projectId}`)).body.items;
    const pre = fin.find((e: any) => e.kind === 'payable' && e.meta.part === 'prepayment');
    const rec = fin.find((e: any) => e.kind === 'receivable');
    const nearly = (rec.amount * 0.995).toFixed(2).replace('.', ',');
    const preTr = pre.amount.toFixed(2).replace('.', ',');
    const csv = [
      'Hesap Hareketleri;;;;',
      'İşlem Tarihi;Açıklama;Karşı Taraf;Tutar;Döviz',
      `20.11.2026;${sp.code} ön ödeme;Moda Sahil Otel;-${preTr};EUR`,
      `19.11.2026;Havale gelen;;${nearly};EUR`,
      '18.11.2026;Kart ödemesi bilinmeyen;Bilinmeyen Ltd;-750,00;EUR',
    ].join('\n');
    const ftoken = await login(T.app, t.users.finance.email);
    const imp = await upload(ftoken, '/api/finance/bank-statements', {}, { name: 'ekstre.csv', type: 'text/csv', content: csv });
    expect(imp.status).toBe(200);
    expect(imp.body).toMatchObject({ imported: 3, matched: 1, suggested: 1, unmatched: 1 });
    const again = await upload(ftoken, '/api/finance/bank-statements', {}, { name: 'ekstre.csv', type: 'text/csv', content: csv });
    expect(again.body).toMatchObject({ imported: 0, duplicates: 3 });

    const txs = (await u.finance.get('/api/finance/bank-transactions')).body.items;
    const auto = txs.find((x: any) => x.status === 'matched');
    expect(auto.matchedEntryId).toBe(pre.id);
    expect((await u.finance.get(`/api/finance/entries?projectId=${sp.projectId}&kind=payable`)).body.items.find((e: any) => e.id === pre.id).status).toBe('matched');

    // suggestion → finance decision (AI suggestion through aiGate) → approve → matched
    const sug = txs.find((x: any) => x.status === 'suggested');
    expect(sug.matchedEntryId).toBe(rec.id);
    const card = (await u.finance.get('/api/decisions')).body.items.find((x: any) => x.kind === 'low_confidence_review' && x.entityId === sug.id);
    expect(card).toBeTruthy();
    expect((await u.finance.post(`/api/decisions/${card.id}/decide`, { action: 'approve' })).body.effects).toContain(`payment_matched:${rec.id}`);
    expect((await u.finance.get('/api/finance/bank-transactions?status=matched')).body.items).toHaveLength(2);

    // unmatched outgoing payment: daily reminder to the payer, escalation to the admin after 7 days
    const un = txs.find((x: any) => x.status === 'unmatched');
    expect(un.payerUserId).toBe(t.users.finance.id);
    await runFollowupsForTenant(T.app.deps, t.tenantId, new Date('2026-11-21T07:00:00Z'));
    const reminders = (await u.finance.get('/api/tasks?mine=1&status=open')).body.items.filter((x: any) => x.kind === 'unbilled_payment');
    expect(reminders).toHaveLength(1);
    expect(reminders[0].title).toBe('Bu ödeme nereye fatura edildi?');
    expect((await u.admin.get('/api/decisions')).body.items.some((x: any) => x.kind === 'unbilled_payment_escalation')).toBe(false);
    await runFollowupsForTenant(T.app.deps, t.tenantId, new Date('2026-11-26T07:00:00Z'));
    const esc = (await u.admin.get('/api/decisions')).body.items.find((x: any) => x.kind === 'unbilled_payment_escalation' && x.entityId === un.id);
    expect(esc).toBeTruthy();
    expect((await u.finance.get('/api/tasks?mine=1&status=open')).body.items.filter((x: any) => x.kind === 'unbilled_payment')).toHaveLength(2);
    // finance answers "where was it billed": manual match against an invoice closes it
    const inv = await u.finance.post('/api/finance/supplier-invoices', { projectId: sp.projectId, supplierId: t.suppliers.moda, invoiceNo: 'MSO-750', amount: 750, currency: 'EUR' });
    const m = await u.finance.post(`/api/finance/bank-transactions/${un.id}/match`, { entryId: inv.body.entry.id });
    expect(m.body.status).toBe('matched');
    expect((await u.finance.get('/api/tasks?mine=1&status=open')).body.items.filter((x: any) => x.kind === 'unbilled_payment')).toHaveLength(0);
    expect((await u.finance.post(`/api/finance/bank-transactions/${un.id}/match`, { entryId: inv.body.entry.id })).status).toBe(409);
    const outbox = await ownerSql(`SELECT count(*)::int AS n FROM notifications WHERE tenant_id = $1 AND entity_type = 'bank_transaction'`, [t.tenantId]);
    expect(outbox[0].n).toBeGreaterThan(0);
  });
});
