// Phase B — §7 Adım 8 closing (check blocks; close side effects; survey; 30-day overdue alarm), §16.6 weekly report,
// admin-only rules / users / delegations / checklist (§17.1: delegate and AI can never change rules).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { client, closeApp, login, makeApp, newTenant, ownerSql, REQUEST_TEXT, resetClock, type Client, type TestApp } from './helpers.js';
import { signedProject, type SignedProject } from './phase-b-helpers.js';
import { runFollowupsForTenant } from '../src/worker.js';

let T: TestApp;
let t: Awaited<ReturnType<typeof newTenant>>;
let admin: Client, clerk: Client, ops: Client, field: Client, finance: Client;
let sp: SignedProject;
let sp2: SignedProject;

beforeAll(async () => {
  T = await makeApp();
  t = await newTenant('closing');
  admin = client(T.app, await login(T.app, t.users.admin.email));
  clerk = client(T.app, await login(T.app, t.users.clerk.email));
  ops = client(T.app, await login(T.app, t.users.ops.email));
  field = client(T.app, await login(T.app, t.users.field.email));
  finance = client(T.app, await login(T.app, t.users.finance.email));
  resetClock();
  sp = await signedProject(T.app, admin, t);
  sp2 = await signedProject(T.app, admin, t);
});
beforeEach(() => resetClock());
afterAll(() => closeApp(T));

describe('admin (§17.1: rules / authority stay with the Admin)', () => {
  it('rules PATCH is admin-only (delegate and other roles refused), validated and audited', async () => {
    expect((await clerk.patch('/api/rules', { lowSupplierScore: 80 })).status).toBe(403);
    expect((await admin.patch('/api/rules', { noSuchRule: 1 })).body.error.code).toBe('UNKNOWN_RULE');
    expect((await admin.patch('/api/rules', { lowSupplierScore: 'x' })).body.error.code).toBe('INVALID_RULE_VALUE');
    const r = await admin.patch('/api/rules', { lowSupplierScore: 80, reason: 'Kalite hedefi' });
    expect(r.status).toBe(200);
    expect(r.body.lowSupplierScore).toBe(80);
    const audit = await admin.get('/api/audit?entity=rules');
    expect(audit.body.items.some((a: any) => a.after?.key === 'lowSupplierScore' && a.actorId === t.users.admin.id)).toBe(true);

    // an active delegate may approve payments/contracts but never change rules / authority / checklist
    const del = await admin.post('/api/delegations', { delegateId: t.users.ops.id, startsAt: '2026-11-19T00:00:00Z', endsAt: '2026-12-31T00:00:00Z' });
    expect(del.status).toBe(200);
    expect(del.body).toMatchObject({ adminId: t.users.admin.id, delegateId: t.users.ops.id });
    expect((await ops.patch('/api/rules', { lowSupplierScore: 10 })).body.error.code).toBe('ADMIN_ONLY');
    expect((await ops.patch(`/api/users/${t.users.clerk.id}`, { authorityLevel: 'full' })).status).toBe(403);
    expect((await ops.post('/api/delegations', { delegateId: t.users.finance.id, startsAt: '2026-11-19T00:00:00Z', endsAt: '2026-11-30T00:00:00Z' })).status).toBe(403);
    expect((await ops.post(`/api/delegations/${del.body.id}/end`)).status).toBe(403);
    expect((await ops.get('/api/delegations')).body.items.map((d: any) => d.id)).toContain(del.body.id);
    // no DELETE — delegations are ended, never deleted
    expect((await admin.del(`/api/delegations/${del.body.id}`)).status).toBe(404);
    const end = await admin.post(`/api/delegations/${del.body.id}/end`);
    expect(end.status).toBe(200);
    expect(Date.parse(end.body.endsAt)).toBeLessThanOrEqual(Date.parse('2026-11-20T07:00:00Z'));
    expect((await ownerSql('SELECT ended_at FROM delegations WHERE id = $1', [del.body.id]))[0].ended_at).toBeTruthy();
    expect((await admin.get('/api/auth/me')).status).toBe(200);
  });

  it('users PATCH (admin only), user stats, checklist PATCH', async () => {
    expect((await clerk.patch(`/api/users/${t.users.clerk.id}`, { authorityLevel: 'full' })).status).toBe(403);
    const u = await admin.patch(`/api/users/${t.users.ops.id}`, { authorityLevel: 'scoped', authorityScope: { customerIds: [t.customers.trusted] }, canSign: true });
    expect(u.body).toMatchObject({ authorityLevel: 'scoped', canSign: true, authorityScope: { customerIds: [t.customers.trusted] } });
    // G-17: an authority / signing change ends the user's existing sessions → the old token is refused, a new login works
    expect((await ops.get('/api/auth/me')).status).toBe(401);
    ops = client(T.app, await login(T.app, t.users.ops.email));
    expect((await admin.patch(`/api/users/${t.users.admin.id}`, { role: 'clerk_sales' })).body.error.code).toBe('SELF_DEMOTION');
    const stats = await admin.get(`/api/users/${t.users.admin.id}/stats`);
    expect(stats.body).toMatchObject({ userId: t.users.admin.id });
    expect(stats.body.quotesTotal).toBeGreaterThan(0);
    for (const k of ['quotesCorrected', 'avgPriceChangePct', 'avgMarginChangePct', 'won', 'lost', 'winRate']) expect(stats.body).toHaveProperty(k);
    expect((await clerk.get(`/api/users/${t.users.admin.id}/stats`)).status).toBe(403);
    expect((await clerk.get(`/api/users/${t.users.clerk.id}/stats`)).status).toBe(200);

    const q = (await admin.get('/api/checklist')).body.items[0];
    expect((await ops.patch(`/api/checklist/${q.id}`, { status: 'rejected' })).status).toBe(403);
    expect((await admin.patch(`/api/checklist/${q.id}`, { status: 'rejected' })).body.status).toBe('rejected');
    expect((await admin.patch(`/api/checklist/${q.id}`, { status: 'active' })).body.status).toBe('active');
  });
});

describe('closing (Adım 8)', () => {
  it('closing check blocks until invoices / collections / commissions are complete; close writes learning data + survey', async () => {
    const check = await finance.get(`/api/projects/${sp.projectId}/closing-check`);
    expect(check.body.ok).toBe(false);
    const byKey = Object.fromEntries(check.body.items.map((i: any) => [i.key, i.ok]));
    expect(byKey).toMatchObject({ supplier_invoices: false, customer_invoice: false, collections: false, unbilled_payments: true, commissions: true });
    expect(check.body.planVsActual.planned.margin).toBeGreaterThan(0);
    const blocked = await admin.post(`/api/projects/${sp.projectId}/close`, { lessonsLearned: 'x' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('CLOSING_BLOCKED');
    expect(blocked.body.error.details.items.length).toBeGreaterThan(0);

    // field issues against the supplier (score input) + an unreflected field extra (deviation)
    for (const d of ['Klima arızası', 'Geç servis', 'Eksik oda']) await field.post(`/api/projects/${sp.projectId}/field-issues`, { description: d, severity: 'high', supplierId: t.suppliers.moda });
    const ex = await field.post(`/api/projects/${sp.projectId}/field-extras`, { description: 'Ek ikram', amountTry: 2425 });
    await ops.post(`/api/field-extras/${ex.body.id}/reflect`, { reflected: false, reason: 'İkram' });

    // invoices + collection + commission reconciliation
    await finance.post('/api/finance/supplier-invoices', { projectId: sp.projectId, supplierId: t.suppliers.moda, invoiceNo: 'MSO-9', amount: 13250, currency: 'EUR', vatAmount: 1585, issueDate: '2027-03-15' });
    const rec = (await finance.get(`/api/finance/entries?projectId=${sp.projectId}&kind=receivable`)).body.items[0];
    await finance.post('/api/finance/customer-invoices', { projectId: sp.projectId, invoiceNo: 'SF-77', amount: rec.amount, currency: rec.currency, issueDate: '2027-03-15' });
    let c2 = await finance.get(`/api/projects/${sp.projectId}/closing-check`);
    expect(Object.fromEntries(c2.body.items.map((i: any) => [i.key, i.ok]))).toMatchObject({ supplier_invoices: true, customer_invoice: true, collections: false, commissions: false });
    const csv = `Tarih;Açıklama;Tutar;Döviz\n16.03.2027;SF-77 tahsilat ${sp.code};${String(rec.amount).replace('.', ',')};${rec.currency}`;
    const imp = await finance.post('/api/finance/bank-statements', { csv });
    expect(imp.body.matched).toBe(1);
    const com = (await finance.get(`/api/finance/commissions?projectId=${sp.projectId}`)).body.items[0];
    await finance.post(`/api/finance/commissions/${com.id}/reconcile`, { invoiceNo: 'KOM-9' });
    c2 = await finance.get(`/api/projects/${sp.projectId}/closing-check`);
    expect(c2.body.ok).toBe(true);
    expect(c2.body.planVsActual.actual).not.toBeNull();
    expect(c2.body.planVsActual.deviations.map((d: any) => d.reason)).toEqual(expect.arrayContaining(['Müşteriye yansıtılmayan farklar (saha ekstraları)', 'Saha ekstraları (toplam)']));

    expect((await clerk.post(`/api/projects/${sp.projectId}/close`, {})).status).toBe(403);
    const closed = await admin.post(`/api/projects/${sp.projectId}/close`, { lessonsLearned: 'Vejetaryen katılımcı sayısını geç öğrendik.' });
    expect(closed.status).toBe(200);
    expect(closed.body.outcome).toBe('closed');
    expect(closed.body.closedAt).toBeTruthy();
    expect(closed.body.step).toBe(8);
    expect(closed.body.surveyUrl).toMatch(/^\/survey\/[\w-]{20,}$/);
    expect((await admin.post(`/api/projects/${sp.projectId}/close`, {})).body.error.code).toBe('ALREADY_CLOSED');

    // realized prices → price history; supplier score updated (lowSupplierScore = 80 from the admin test) → warning card
    const ph = await ownerSql(`SELECT count(*)::int AS n FROM price_history WHERE project_id = $1 AND price_type = 'realized'`, [sp.projectId]);
    expect(ph[0].n).toBeGreaterThan(0);
    const score = Number((await ownerSql('SELECT performance_score FROM suppliers WHERE id = $1', [t.suppliers.moda]))[0].performance_score);
    expect(score).toBeLessThan(80);
    const decisions = (await admin.get('/api/decisions')).body.items;
    const low = decisions.find((d: any) => d.kind === 'low_supplier_score' && d.entityId === t.suppliers.moda);
    expect(low).toBeTruthy();
    expect((await admin.post(`/api/decisions/${low.id}/decide`, { action: 'edit', edits: { status: 'passive' } })).body.effects).toContain('supplier_passive');
    // lessons → AI checklist question suggestion → admin decision
    const cq = decisions.find((d: any) => d.kind === 'checklist_question' && d.projectId === sp.projectId);
    expect(cq.summary).toMatch(/diyet/i);
    expect((await ops.get('/api/decisions')).body.items.some((d: any) => d.id === cq.id)).toBe(false);
    expect((await admin.post(`/api/decisions/${cq.id}/decide`, { action: 'approve' })).body.effects).toContain('checklist_question_activated');
    expect((await admin.get('/api/checklist')).body.items.some((q: any) => /diyet/i.test(q.question) && q.status === 'active' && q.source === 'closing')).toBe(true);

    // 3-question survey (public)
    const token = closed.body.surveyUrl.split('/survey/')[1];
    const pub = client(T.app);
    const sv = await pub.get(`/api/public/survey/${token}`);
    expect(sv.body.questions).toHaveLength(3);
    expect(sv.body.submitted).toBe(false);
    expect((await pub.post(`/api/public/survey/${token}`, { answers: { overall: 9 } })).body.error.code).toBe('INVALID_RATING');
    expect((await pub.post(`/api/public/survey/${token}`, { answers: { overall: 5, recommend: 4, improve: 'Transfer daha erken' } })).body).toEqual({ ok: true });
    expect((await pub.post(`/api/public/survey/${token}`, { answers: { overall: 5 } })).status).toBe(409);
    expect((await pub.get(`/api/public/survey/${token}`)).body.submitted).toBe(true);
  });

  it('lost project closes without the finance checklist (reason required by the outcome); 30-day closing overdue alarm', async () => {
    const intake = await admin.post('/api/intake', { channel: 'email', body: REQUEST_TEXT, customerId: t.customers.new });
    const pid = intake.body.project.id;
    expect((await admin.post(`/api/projects/${pid}/close`, {})).body.error.code).toBe('PROJECT_OPEN');
    await admin.post(`/api/projects/${pid}/outcome`, { outcome: 'lost', lostReason: 'Fiyat yüksek bulundu' });
    const cl = await admin.post(`/api/projects/${pid}/close`, {});
    expect(cl.status).toBe(200);
    expect(cl.body).toMatchObject({ outcome: 'lost', surveyUrl: null });

    // won project whose event ended > 30 days ago and is not closed → worker marks the event end and alerts the admin
    const r1 = await runFollowupsForTenant(T.app.deps, t.tenantId, new Date('2027-03-20T08:00:00Z'));
    expect(r1.some((x) => x.startsWith('events_ended'))).toBe(true);
    expect((await ownerSql('SELECT event_ended_at, step FROM projects WHERE id = $1', [sp2.projectId]))[0].step).toBe(7);
    expect((await admin.get('/api/decisions')).body.items.some((d: any) => d.kind === 'closing_overdue' && d.projectId === sp2.projectId)).toBe(false);
    await runFollowupsForTenant(T.app.deps, t.tenantId, new Date('2027-04-16T08:00:00Z'));
    expect((await admin.get('/api/decisions')).body.items.some((d: any) => d.kind === 'closing_overdue' && d.projectId === sp2.projectId)).toBe(true);
  });
});

describe('weekly report (§16.6)', () => {
  it('returns the single-screen report shape (admin only)', async () => {
    expect((await clerk.get('/api/reports/weekly')).status).toBe(403);
    // a corrected AI draft this month feeds the style summary
    // (a draft waiting for approval is frozen — G-01 — so correct a plain draft)
    const d = (await admin.get('/api/drafts')).body.items.find((x: any) => x.status === 'draft');
    if (d) await admin.patch(`/api/drafts/${d.id}`, { body: `${d.body}\n\nSaygılarımla` });
    const r = await admin.get('/api/reports/weekly?weekStart=2026-11-16');
    expect(r.status).toBe(200);
    expect(r.body.weekStart).toBe('2026-11-16');
    expect(r.body.quoteTime).toMatchObject({ targetBusinessHours: 18 });
    expect(r.body.quoteTime.medianBusinessHours).not.toBeNull();
    expect(r.body.quoteTime.onTargetRate).toBe(1);
    expect(r.body.corrections.trend).toHaveLength(8);
    expect(r.body.quotes.won).toBeGreaterThan(0);
    expect(r.body.quotes.lostReasons).toEqual(expect.arrayContaining([{ reason: 'Fiyat yüksek bulundu', count: 1 }]));
    expect(r.body.automation).toEqual(expect.objectContaining({ autoCount: expect.any(Number), sampled: expect.any(Number), sampleErrors: expect.any(Number), demotions: expect.any(Number) }));
    expect(typeof r.body.unreflectedPriceDiffEur).toBe('number');
    expect(r.body.unreflectedPriceDiffEur).toBeGreaterThan(0);
    expect(r.body.pending).toEqual(expect.objectContaining({ rules: expect.any(Number), automations: expect.any(Number), checklist: expect.any(Number) }));
    expect(Array.isArray(r.body.rfqOverrides)).toBe(true);
    if (d) expect(typeof r.body.styleUpdate).toBe('string');
    const def = await admin.get('/api/reports/weekly');
    expect(def.body.weekStart).toBe('2026-11-16'); // Monday of the current week (clock: Fri 20 Nov 2026)
  });
});
