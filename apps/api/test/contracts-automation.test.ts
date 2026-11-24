// §7 Adım 5 contracts (diff → decisions, biometric approval, sign → lock + commitment record) and §16 automation.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  client, closeApp, login, makeApp, newTenant, ownerSql, quotableProject, resetClock, rng, twoOptions, REQUEST_TEXT, type Client, type TestApp,
} from './helpers.js';
import { withSystemCtx } from '../src/context.js';
import { aiGate } from '../src/services/automation.js';

let T: TestApp;
let t: Awaited<ReturnType<typeof newTenant>>;
let admin: Client;
let clerk: Client;

beforeAll(async () => {
  T = await makeApp();
  t = await newTenant('contracts');
  admin = client(T.app, await login(T.app, t.users.admin.email));
  clerk = client(T.app, await login(T.app, t.users.clerk.email));
});
beforeEach(() => resetClock());
afterAll(() => closeApp(T));

async function wonProject(customer: 'trusted' | 'new' = 'trusted') {
  const q = await quotableProject(admin, t, customer);
  const quote = await admin.post(`/api/projects/${q.projectId}/quotes`, twoOptions(q));
  const token = (await admin.post(`/api/quotes/${quote.body.id}/send`)).body.approvalLink.split('/q/')[1];
  await client(T.app).post(`/api/public/quotes/${token}/accept`, { optionNo: 1, approverName: 'Müşteri', poNumber: 'PO-9' });
  return q;
}

describe('contracts (Adım 5)', () => {
  it('candidate supplier is locked out of contracting', async () => {
    const q = await wonProject();
    const r = await admin.post(`/api/projects/${q.projectId}/contracts`, { supplierId: t.suppliers.galata, serviceItemIds: [q.accItemId], template: 'agency' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('SUPPLIER_NOT_ACCREDITED');
  });

  it('agency template → clean → biometric approval → sign (signatory only) → locked + payable/receivable + confirmation draft', async () => {
    const q = await wonProject();
    const c = await admin.post(`/api/projects/${q.projectId}/contracts`, { supplierId: t.suppliers.moda, serviceItemIds: [q.accItemId, q.hallItemId], template: 'agency' });
    expect(c.status).toBe(200);
    expect(c.body.status).toBe('draft');
    const cmp = await admin.post(`/api/contracts/${c.body.id}/compare`);
    expect(cmp.body.diff.filter((d: any) => d.severity === 'error')).toEqual([]);
    // moda asks 30% prepayment, customer gives no deposit → condition risk card first
    expect(cmp.body.conditionRiskEur).toBeGreaterThan(0);
    const risk = (await admin.get('/api/decisions')).body.items.find((d: any) => d.kind === 'condition_risk' && d.entityId === c.body.id);
    expect(risk).toBeTruthy();
    expect((await admin.post(`/api/contracts/${c.body.id}/sign`, { signedBy: t.users.admin.id })).body.error.code).toBe('CONTRACT_NOT_APPROVED');
    const acc = await admin.post(`/api/decisions/${risk.id}/decide`, { action: 'approve' });
    expect(acc.body.effects).toContain('contract_approval_requested');
    const appr = (await admin.get('/api/decisions')).body.items.find((d: any) => d.kind === 'contract_approval' && d.entityId === c.body.id);
    expect(appr.requiresBiometric).toBe(true);
    const noBio = await admin.post(`/api/decisions/${appr.id}/decide`, { action: 'approve' });
    expect(noBio.status).toBe(403);
    expect(noBio.body.error.code).toBe('BIOMETRIC_REQUIRED');
    const ok = await admin.post(`/api/decisions/${appr.id}/decide`, { action: 'approve', biometric: { method: 'dev' }, device: 'iPhone' });
    expect(ok.body.effects).toContain('contract_approved');

    // the clerk cannot record a signature; the signer must be an authorised signatory
    expect((await clerk.post(`/api/contracts/${c.body.id}/sign`, { signedBy: t.users.admin.id })).status).toBe(403);
    expect((await admin.post(`/api/contracts/${c.body.id}/sign`, { signedBy: t.users.clerk.id })).body.error.code).toBe('NOT_SIGNATORY');
    const signed = await admin.post(`/api/contracts/${c.body.id}/sign`, { signedBy: t.users.admin.id, scanFileName: 'sozlesme-imzali.pdf' });
    expect(signed.status).toBe(200);
    expect(signed.body.locked).toBe(true);
    expect(signed.body.status).toBe('signed');

    const fin = await ownerSql(`SELECT kind, amount, meta FROM finance_entries WHERE contract_id = $1 ORDER BY kind`, [c.body.id]);
    expect(fin.filter((f) => f.kind === 'payable')).toHaveLength(2); // prepayment + balance
    expect(fin.filter((f) => f.kind === 'receivable')).toHaveLength(1);
    const payTotal = fin.filter((f) => f.kind === 'payable').reduce((s, f) => s + Number(f.amount), 0);
    expect(payTotal).toBeCloseTo(13250, 0);

    // supplier confirmation is only a DRAFT; a clerk cannot send it, the admin can
    const draft = (await admin.get(`/api/drafts?projectId=${q.projectId}`)).body.items.find((d: any) => d.kind === 'supplier_confirmation');
    expect(draft.status).toBe('draft');
    expect((await clerk.post(`/api/drafts/${draft.id}/send`)).status).toBe(403);
    expect((await admin.post(`/api/drafts/${draft.id}/send`)).body.status).toBe('sent');
    expect((await ownerSql(`SELECT status FROM reservations WHERE contract_id = $1`, [c.body.id]))[0].status).toBe('confirmed');

    // locked in the database
    await expect(ownerSql(`UPDATE contracts SET fields = '{}' WHERE id = $1`, [c.body.id])).rejects.toThrow(/kilitli/);
    // amendment = new row; original becomes 'amended'
    const am = await admin.post(`/api/contracts/${c.body.id}/amend`, { changes: { pax: 90 }, reason: 'Kişi sayısı arttı' });
    expect(am.body.amendmentOf).toBe(c.body.id);
    expect(am.body.status).toBe('draft');
    expect((await ownerSql(`SELECT status FROM contracts WHERE id = $1`, [c.body.id]))[0].status).toBe('amended');
    const pnl = (await admin.get(`/api/projects/${q.projectId}/documents`)).body.items.find((d: any) => d.kind === 'pnl');
    expect(pnl.status).toBe('stale');
  });

  it('supplier contract with differences → contract_diff (revision draft) and condition_risk decisions', async () => {
    const q = await wonProject();
    const c = await admin.post(`/api/projects/${q.projectId}/contracts`, { supplierId: t.suppliers.moda, serviceItemIds: [q.accItemId, q.hallItemId], template: 'supplier' });
    const parsed = await admin.post(`/api/contracts/${c.body.id}/parse`, {
      text: `KONAKLAMA VE TOPLANTI SÖZLEŞMESİ\nOtel: Moda Sahil Otel\nMüşteri: Anadolu İlaç A.Ş.\nGiriş: 12.03.2027  Çıkış: 14.03.2027\nKatılımcı: 80 kişi, garanti 75 kişi\n25 DBL oda x 2 gece x 115 EUR (BB)\n30 SGL oda x 2 gece x 90 EUR (BB)\nSalon kirası: 1.300 EUR\nFiyatlar KDV hariçtir.\nÖdeme: %50 ön ödeme imzada.\nİptal: 45 günden az kalan iptallerde %100.`,
    });
    expect(parsed.status).toBe(200);
    expect(parsed.body.template).toBe('supplier');
    expect(parsed.body.extractionConfidence).not.toBeNull();
    const cmp = await admin.post(`/api/contracts/${c.body.id}/compare`);
    expect(cmp.body.status).toBe('diff_pending');
    expect(cmp.body.diff.length).toBeGreaterThan(0);
    expect(cmp.body.conditionRiskEur).toBeGreaterThan(0);
    const inbox = (await admin.get('/api/decisions')).body.items.filter((d: any) => d.entityId === c.body.id);
    expect(inbox.map((d: any) => d.kind).sort()).toEqual(['condition_risk', 'contract_diff']);
    const diffCard = inbox.find((d: any) => d.kind === 'contract_diff');
    expect(diffCard.draft.body.length).toBeGreaterThan(10);
    const before = T.email.sent.length;
    const res = await admin.post(`/api/decisions/${diffCard.id}/decide`, { action: 'edit', edits: { body: 'Merhaba, sözleşmedeki DBL fiyatı 105 EUR olmalı. Teşekkürler.' } });
    expect(res.body.effects).toContain('revision_request_sent');
    expect(T.email.sent.slice(before)[0].body).toContain('105 EUR');
    // still not signable
    expect((await admin.post(`/api/contracts/${c.body.id}/sign`, { signedBy: t.users.admin.id })).status).toBe(409);
  });
});

describe('automation (§16)', () => {
  it('N clean approvals → promotion proposal; admin promotes → auto-executed with sampling; sample error demotes', async () => {
    await ownerSql(`INSERT INTO automation_counters (tenant_id, action_type, threshold, sample_rate) VALUES ($1, 'rfq_send', 2, 0.05)
                    ON CONFLICT (tenant_id, action_type) DO UPDATE SET threshold = 2`, [t.tenantId]);
    const sendRfqFor = async (district: string) => {
      const intake = await clerk.post('/api/intake', { channel: 'email', body: REQUEST_TEXT.replace('Kadıköy', district) });
      const item = (await clerk.get(`/api/projects/${intake.body.project.id}`)).body.items.find((i: any) => i.kind === 'accommodation');
      const r = await clerk.post(`/api/items/${item.id}/rfqs`, { supplierIds: [t.suppliers.moda, t.suppliers.kalamis, t.suppliers.bogaz] });
      return { item, rfqs: r.body.items };
    };
    for (const d of ['Şişli', 'Beşiktaş']) {
      const { item } = await sendRfqFor(d);
      const dec = (await clerk.get('/api/decisions')).body.items.find((x: any) => x.kind === 'rfq_send' && x.entityId === item.id);
      await clerk.post(`/api/decisions/${dec.id}/decide`, { action: 'approve' });
    }
    const promo = (await admin.get('/api/decisions')).body.items.find((d: any) => d.kind === 'automation_promotion' && d.detail.actionType === 'rfq_send');
    expect(promo).toBeTruthy();
    expect((await clerk.get('/api/decisions')).body.items.find((d: any) => d.id === promo.id)).toBeUndefined();
    await admin.post(`/api/decisions/${promo.id}/decide`, { action: 'approve' });
    expect((await admin.get('/api/automation')).body.items.find((c: any) => c.actionType === 'rfq_send').mode).toBe('auto');

    // [Ürün kararı] outbound messages are auto-sent only with the standing-approval rule (default off → still a card)
    const held = await sendRfqFor('Üsküdar');
    expect(held.rfqs.every((r: any) => r.status === 'pending_approval')).toBe(true);
    const heldDec = (await clerk.get('/api/decisions')).body.items.find((x: any) => x.kind === 'rfq_send' && x.entityId === held.item.id);
    expect(heldDec.detail.automation).toBe('outbound_held_for_approval');
    expect((await admin.patch('/api/rules', { outboundAutoSendRequiresStandingApproval: true })).status).toBe(200);
    rng.value = 0; // force the ~1/20 sample
    const before = T.email.sent.length;
    const { rfqs } = await sendRfqFor('Sarıyer');
    expect(rfqs.every((r: any) => r.status === 'sent')).toBe(true);
    expect(T.email.sent.length - before).toBe(3);
    rng.value = 0.99;
    const sample = (await admin.get('/api/decisions')).body.items.find((d: any) => d.kind === 'audit_sample');
    expect(sample).toBeTruthy();
    const rej = await admin.post(`/api/decisions/${sample.id}/decide`, { action: 'reject', reason: 'yanlış tedarikçi' });
    expect(rej.body.effects).toContain('automation_demoted:rfq_send');
    expect((await admin.get('/api/automation')).body.items.find((c: any) => c.actionType === 'rfq_send').mode).toBe('approval');
    await admin.patch('/api/rules', { outboundAutoSendRequiresStandingApproval: false });
  });

  it('forbidden actions can never pass the AI gate', async () => {
    await withSystemCtx(T.app.deps, t.tenantId, { type: 'ai', id: null }, async (ctx) => {
      await expect(aiGate(ctx, 'supplier_accreditation', { kind: 'supplier_accreditation', badge: 'critical', summary: 'x' })).rejects.toThrow(/yasak/);
      await expect(aiGate(ctx, 'contract_signature', { kind: 'contract_approval', badge: 'critical', summary: 'x' })).rejects.toThrow(/yasak/);
    });
  });
});
