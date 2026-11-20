// §7 Adım 3/4: quote blocking rules, approval gate (personal authority, delegation), staleness, public approval.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  client, closeApp, login, makeApp, newTenant, ownerSql, quotableProject, resetClock, twoOptions, type Client, type TestApp,
} from './helpers.js';

let T: TestApp;
let t: Awaited<ReturnType<typeof newTenant>>;
let admin: Client;
let clerk: Client;
let ops: Client;

beforeAll(async () => {
  T = await makeApp();
  t = await newTenant('quotes');
  admin = client(T.app, await login(T.app, t.users.admin.email));
  clerk = client(T.app, await login(T.app, t.users.clerk.email));
  ops = client(T.app, await login(T.app, t.users.ops.email));
});
beforeEach(() => resetClock());
afterAll(() => closeApp(T));

describe('quote blocking rules', () => {
  it('blocks an option date later than the supplier option; default option = min(today+7 business days, supplier option)', async () => {
    const q = await quotableProject(clerk, t);
    const bad = await clerk.post(`/api/projects/${q.projectId}/quotes`, { ...twoOptions(q), optionUntil: '2027-02-15' });
    expect(bad.status).toBe(200);
    expect(bad.body.status).toBe('blocked');
    expect(bad.body.blockReasons.join(' ')).toMatch(/opsiyon/i);
    const ok = await clerk.post(`/api/projects/${q.projectId}/quotes`, twoOptions(q));
    expect(ok.body.status).not.toBe('blocked');
    expect(ok.body.optionUntil).toBe('2026-12-01'); // 7 business days after Fri 2026-11-20 < supplier option 2027-01-20
    expect(ok.body.version).toBe(2);
    const prev = await clerk.get(`/api/quotes/${bad.body.id}`);
    expect(prev.body.status).toBe('superseded');
  });

  it('VAT and accommodation tax separated; margin and markup separate', async () => {
    const q = await quotableProject(clerk, t);
    const r = await clerk.post(`/api/projects/${q.projectId}/quotes`, twoOptions(q, 0.25));
    const o = r.body.options[0];
    // cost: 25×2×105 + 30×2×90 + 2×1300 = 5250 + 5400 + 2600 = 13250
    expect(o.totals.costEur).toBeCloseTo(13250, 1);
    expect(o.totals.markup).toBeCloseTo(0.25, 3);
    expect(o.totals.margin).toBeCloseTo(0.2, 3);
    const accSale = (5250 + 5400) * 1.25;
    expect(o.accommodationTaxEur).toBeCloseTo(accSale * 0.02, 1);
    expect(o.vatEur).toBeCloseTo(accSale * 0.1 + 2600 * 1.25 * 0.2, 1);
    const docs = await clerk.get(`/api/projects/${q.projectId}/documents`);
    expect(docs.body.items.map((d: any) => d.kind).sort()).toEqual(['pnl', 'quote']);
    const pdf = await T.app.inject({ method: 'GET', url: `/api/quotes/${r.body.id}/pdf`, headers: { authorization: `Bearer ${await login(T.app, t.users.clerk.email)}` } });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('below target margin → blocked; only the admin opens it, and only with a reason', async () => {
    const q = await quotableProject(clerk, t);
    const r = await clerk.post(`/api/projects/${q.projectId}/quotes`, twoOptions(q, 0.03));
    expect(r.body.status).toBe('blocked');
    const dec = (await admin.get('/api/decisions')).body.items.find((d: any) => d.kind === 'margin_override' && d.entityId === r.body.id);
    expect(dec).toBeTruthy();
    expect((await clerk.get('/api/decisions')).body.items.find((d: any) => d.id === dec.id)).toBeUndefined();
    expect((await clerk.post(`/api/decisions/${dec.id}/decide`, { action: 'approve', reason: 'x' })).status).toBe(403);
    const noReason = await admin.post(`/api/decisions/${dec.id}/decide`, { action: 'approve' });
    expect(noReason.body.error.code).toBe('REASON_REQUIRED');
    const ok = await admin.post(`/api/decisions/${dec.id}/decide`, { action: 'approve', reason: 'Stratejik müşteri, ilk iş' });
    expect(ok.body.effects).toContain('quote_approved');
    const quote = await clerk.get(`/api/quotes/${r.body.id}`);
    expect(quote.body.status).toBe('approved');
    expect(quote.body.marginOverrideReason).toBe('Stratejik müşteri, ilk iş');
  });

  it('candidate (non-accredited) supplier blocks the quote', async () => {
    const q = await quotableProject(clerk, t);
    const r = await clerk.post(`/api/projects/${q.projectId}/quotes`, twoOptions(q, 0.2, q.accOffers.galata));
    expect(r.body.status).toBe('blocked');
    expect(r.body.blockReasons.join(' ')).toMatch(/aday|akredit/i);
  });
});

describe('approval gate (§4 personal authority, §17.1 delegation, §15 inbox)', () => {
  it('clerk without authority → pending_approval + quote_approval card for the admin; admin approves', async () => {
    const q = await quotableProject(clerk, t, 'new');
    const r = await clerk.post(`/api/projects/${q.projectId}/quotes`, twoOptions(q));
    expect(r.body.status).toBe('pending_approval');
    expect(r.body.requiresApproval).toBe(true);
    expect((await clerk.post(`/api/quotes/${r.body.id}/send`)).body.error.code).toBe('QUOTE_NOT_APPROVED');
    const dec = (await admin.get('/api/decisions')).body.items.find((d: any) => d.kind === 'quote_approval' && d.entityId === r.body.id);
    expect(dec.badge).toBe('within_rules');
    expect(dec.requiresBiometric).toBe(false);
    // ops user cannot decide; with an active delegation they can (marked viaDelegation)
    expect((await ops.post(`/api/decisions/${dec.id}/decide`, { action: 'approve' })).status).toBe(403);
    await ownerSql(`INSERT INTO delegations (tenant_id, admin_id, delegate_id, starts_at, ends_at) VALUES ($1,$2,$3,$4,$5)`,
      [t.tenantId, t.users.admin.id, t.users.ops.id, '2026-11-19T00:00:00Z', '2026-11-30T00:00:00Z']);
    expect((await ops.get('/api/decisions')).body.items.find((d: any) => d.id === dec.id)).toBeTruthy();
    const res = await ops.post(`/api/decisions/${dec.id}/decide`, { action: 'approve', device: 'iPhone 15' });
    expect(res.status).toBe(200);
    expect(res.body.decision.viaDelegation).toBe(true);
    expect(res.body.decision.decidedDevice).toBe('iPhone 15');
    expect((await clerk.get(`/api/quotes/${r.body.id}`)).body.status).toBe('approved');
    // a decided card cannot be decided again
    expect((await admin.post(`/api/decisions/${dec.id}/decide`, { action: 'reject' })).body.error.code).toBe('DECISION_CLOSED');
  });

  it('delegates can never decide admin-only kinds (accreditation)', async () => {
    const r = await clerk.patch(`/api/suppliers/${t.suppliers.galata}`, { status: 'accredited', reason: 'iyi fiyat verdi' });
    expect(r.body.status).toBe('candidate'); // never applied directly
    const dec = (await admin.get('/api/decisions')).body.items.find((d: any) => d.kind === 'supplier_accreditation' && d.entityId === t.suppliers.galata);
    expect(dec).toBeTruthy();
    expect((await ops.get('/api/decisions')).body.items.find((d: any) => d.id === dec.id)).toBeUndefined();
    expect((await ops.post(`/api/decisions/${dec.id}/decide`, { action: 'approve' })).status).toBe(403);
    // and an AI actor can never accredit, even at DB level
    await expect(ownerSql(`BEGIN; SELECT set_config('app.actor_type','ai',true); UPDATE suppliers SET status='accredited', accredited_by=$1 WHERE id=$2; COMMIT;`.replace(/\$1/, `'${t.users.admin.id}'`).replace(/\$2/, `'${t.suppliers.galata}'`))).rejects.toThrow(/yönetici/);
  });

  it('scoped clerk sends without approval for the trusted customer', async () => {
    const q = await quotableProject(clerk, t, 'trusted');
    const r = await clerk.post(`/api/projects/${q.projectId}/quotes`, twoOptions(q));
    expect(r.body.status).toBe('approved');
    expect(r.body.appliedCustomerRules.length).toBeGreaterThan(0);
  });
});

describe('change propagation (§3.5) and public approval (Adım 4)', () => {
  it('a data change marks dependent documents stale; stale quote cannot be sent until rebuilt', async () => {
    const q = await quotableProject(clerk, t, 'trusted');
    const r = await clerk.post(`/api/projects/${q.projectId}/quotes`, twoOptions(q));
    await clerk.patch(`/api/projects/${q.projectId}`, { pax: 95 });
    const docs = (await clerk.get(`/api/projects/${q.projectId}/documents`)).body.items;
    expect(docs.every((d: any) => d.status === 'stale')).toBe(true);
    expect(docs[0].staleReason).toMatch(/pax/);
    const send = await clerk.post(`/api/quotes/${r.body.id}/send`);
    expect(send.status).toBe(409);
    expect(send.body.error.code).toBe('DOCUMENT_STALE');
    const quoteDoc = docs.find((d: any) => d.kind === 'quote');
    expect((await clerk.post(`/api/documents/${quoteDoc.id}/regenerate`)).body.error.code).toBe('QUOTE_REBUILD_REQUIRED');
    // DB-level guard too: a stale document cannot be marked sent
    await expect(ownerSql(`UPDATE documents SET sent_at = now() WHERE id = $1`, [quoteDoc.id])).rejects.toThrow(/stale/i);
    // P&L may be regenerated
    const pnl = docs.find((d: any) => d.kind === 'pnl');
    const regen = await clerk.post(`/api/documents/${pnl.id}/regenerate`);
    expect(regen.body.status).toBe('current');
    expect(regen.body.version).toBe(2);
    // a non-pricing change (customer billing info) → quote doc can be regenerated, then sent
    const q2 = await clerk.post(`/api/projects/${q.projectId}/quotes`, twoOptions(q));
    await clerk.patch(`/api/projects/${q.projectId}`, { billingInfo: 'Marmara Teknoloji A.Ş. Maslak VD' });
    const qd = (await clerk.get(`/api/projects/${q.projectId}/documents`)).body.items.find((d: any) => d.kind === 'quote');
    expect(qd.status).toBe('stale');
    expect((await clerk.post(`/api/documents/${qd.id}/regenerate`)).body.status).toBe('current');
    const sent = await clerk.post(`/api/quotes/${q2.body.id}/send`);
    expect(sent.status).toBe(200);
    expect(sent.body.approvalLink).toMatch(/^\/q\/[A-Za-z0-9_-]{43}$/);
    const proj = (await clerk.get(`/api/projects/${q.projectId}`)).body.project;
    expect(proj.quoteSentAt).toBe(new Date('2026-11-20T07:00:00Z').toISOString());
    expect(proj.step).toBe(4);
  });

  it('online customer: open tracking + accept → won; signed_or_po customer without PO → awaiting signed form', async () => {
    const q = await quotableProject(clerk, t, 'trusted');
    const r = await clerk.post(`/api/projects/${q.projectId}/quotes`, twoOptions(q));
    const token = (await clerk.post(`/api/quotes/${r.body.id}/send`)).body.approvalLink.split('/q/')[1];
    const pub = client(T.app);
    const view = await pub.get(`/api/public/quotes/${token}`);
    expect(view.status).toBe(200);
    expect(view.body.firmApproval).toBe('online');
    expect(view.body.options).toHaveLength(2);
    expect((await clerk.get(`/api/quotes/${r.body.id}`)).body.openedAt).not.toBeNull();
    const acc = await pub.post(`/api/public/quotes/${token}/accept`, { optionNo: 1, approverName: 'Burak Şahin' });
    expect(acc.body).toEqual({ ok: true, firm: true });
    expect((await clerk.get(`/api/projects/${q.projectId}`)).body.project.outcome).toBe('won');
    expect((await pub.post(`/api/public/quotes/${token}/accept`, { optionNo: 1, approverName: 'x' })).status).toBe(409);

    // default (new) customer: signed form or PO required
    const q2 = await quotableProject(admin, t, 'new');
    const r2 = await admin.post(`/api/projects/${q2.projectId}/quotes`, twoOptions(q2));
    const tok2 = (await admin.post(`/api/quotes/${r2.body.id}/send`)).body.approvalLink.split('/q/')[1];
    expect((await pub.post(`/api/public/quotes/${tok2}/accept`, { optionNo: 2, approverName: 'Selin' })).body.firm).toBe(false);
    expect((await admin.get(`/api/projects/${q2.projectId}`)).body.project.outcome).toBe('open');
    const firm = await admin.post(`/api/quotes/${r2.body.id}/firm-approval`, { poNumber: 'PO-1' });
    expect(firm.status).toBe(200);
    expect((await admin.get(`/api/projects/${q2.projectId}`)).body.project.outcome).toBe('won');
  });

  it('revision request → diff list and routing back (dates/pax → step 1)', async () => {
    const q = await quotableProject(admin, t, 'trusted');
    const r = await admin.post(`/api/projects/${q.projectId}/quotes`, twoOptions(q));
    const token = (await admin.post(`/api/quotes/${r.body.id}/send`)).body.approvalLink.split('/q/')[1];
    const rev = await client(T.app).post(`/api/public/quotes/${token}/revision`, { message: 'Kişi sayısı 100 kişi olacak, tarihler aynı.' });
    expect(rev.status).toBe(200);
    expect(rev.body.targetStep).toBe(1);
    expect(rev.body.diff.map((d: any) => d.field)).toContain('pax');
    expect((await admin.get(`/api/projects/${q.projectId}`)).body.project.step).toBe(1);
  });
});
