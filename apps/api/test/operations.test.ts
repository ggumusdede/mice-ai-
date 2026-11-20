// Phase B — §7 Adım 6 operations: calendar on signature, field extras (limits, customer approval, reflect), rooming list
// with KVKK consent / withdrawal / anonymization, PII encryption & masking, daily summary, change flow, notifications.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { client, clock, closeApp, login, makeApp, newTenant, ownerSql, resetClock, type Client, type TestApp } from './helpers.js';
import { signedProject, type SignedProject } from './phase-b-helpers.js';
import { runFollowupsForTenant } from '../src/worker.js';
import { nextDigestSlot } from '../src/services/notifications.js';

let T: TestApp;
let t: Awaited<ReturnType<typeof newTenant>>;
let admin: Client, clerk: Client, ops: Client, field: Client, finance: Client;
let sp: SignedProject;

beforeAll(async () => {
  T = await makeApp();
  t = await newTenant('ops');
  admin = client(T.app, await login(T.app, t.users.admin.email));
  clerk = client(T.app, await login(T.app, t.users.clerk.email));
  ops = client(T.app, await login(T.app, t.users.ops.email));
  field = client(T.app, await login(T.app, t.users.field.email));
  finance = client(T.app, await login(T.app, t.users.finance.email));
  resetClock();
  sp = await signedProject(T.app, admin, t);
});
beforeEach(() => resetClock());
afterAll(() => closeApp(T));

describe('operations calendar (Adım 6)', () => {
  it('contract signature creates calendar tasks assigned to the responsible roles', async () => {
    const tasks = (await admin.get(`/api/tasks?projectId=${sp.projectId}`)).body.items as any[];
    const kinds = new Set(tasks.map((x) => x.kind));
    for (const k of ['final_pax', 'attrition', 'rooming_list', 'menu_approval', 'tech_brief', 'event_day_checklist', 'payment_due']) expect(kinds.has(k)).toBe(true);
    expect(kinds.has('transfer_list')).toBe(false); // no transfer item in this contract
    const rooming = tasks.find((x) => x.kind === 'rooming_list');
    expect(rooming.assigneeId).toBe(t.users.ops.id);
    expect(rooming.dueAt.slice(0, 10)).toBe('2027-03-02'); // T-10 of 12 Mar 2027
    expect(tasks.find((x) => x.kind === 'payment_due').assigneeId).toBe(t.users.finance.id);
    expect(tasks.find((x) => x.kind === 'event_day_checklist').assigneeId).toBe(t.users.field.id);

    const mine = (await ops.get('/api/tasks?mine=1&status=open')).body.items as any[];
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((x) => x.projectId === sp.projectId && x.assigneeId === t.users.ops.id)).toBe(true);
    const done = await ops.post(`/api/tasks/${rooming.id}/complete`);
    expect(done.body.status).toBe('done');
    expect((await ops.post(`/api/tasks/${rooming.id}/complete`)).status).toBe(404);
  });

  it('item change on a contracted project → change impact, supplier notice draft, decision when margin falls below target', async () => {
    const r = await admin.patch(`/api/items/${sp.accItemId}`, { quantity: 120 }); // ~2× rooms, sale not reflected
    expect(r.status).toBe(200);
    const d = (await admin.get(`/api/decisions?projectId=${sp.projectId}`)).body.items.find((x: any) => x.kind === 'condition_risk' && x.entityId === sp.accItemId);
    expect(d).toBeTruthy();
    expect(d.detail.impact.belowTarget).toBe(true);
    const drafts = (await admin.get(`/api/drafts?projectId=${sp.projectId}`)).body.items;
    expect(drafts.some((x: any) => x.subject?.includes('değişiklik bildirimi'))).toBe(true);
    await admin.patch(`/api/items/${sp.accItemId}`, { quantity: 55 });
  });
});

describe('field extras (§17.1 / §17.7)', () => {
  it('limits 5.000 / 15.000 TL, admin decision above, customer one-tap approval, reflect requires a reason', async () => {
    const a = await field.post(`/api/projects/${sp.projectId}/field-extras`, { description: 'Ek coffee break', amountTry: 4000, customerPhone: '+90 532 111 22 33' });
    expect(a.status).toBe(200);
    expect(a.body.needsAdminApproval).toBe(false);
    expect(a.body.approvalLink).toMatch(/^\/e\/[\w-]{20,}$/);
    // SMS with the one-time link went out from the field lead; the outbox copy is redacted
    const sms = T.email.sent.find((m) => m.channel === 'sms' && m.body.includes(a.body.approvalLink));
    expect(sms?.to).toBe('+90 532 111 22 33');
    const outbox = await ownerSql(`SELECT body FROM outbox WHERE tenant_id = $1 AND channel = 'sms'`, [t.tenantId]);
    expect(outbox.some((o) => o.body.includes(a.body.approvalLink.split('/e/')[1]))).toBe(false);

    const b = await field.post(`/api/projects/${sp.projectId}/field-extras`, { description: 'Ek teknik ekipman', amountTry: 6000 });
    expect(b.body.needsAdminApproval).toBe(true); // per-item limit
    const dec = (await admin.get('/api/decisions')).body.items.find((x: any) => x.kind === 'field_extra' && x.entityId === b.body.id);
    expect(dec.requiresBiometric).toBe(true);
    expect((await field.get('/api/decisions')).body.items.some((x: any) => x.id === dec.id)).toBe(false);
    expect((await admin.post(`/api/decisions/${dec.id}/decide`, { action: 'approve' })).body.error.code).toBe('BIOMETRIC_REQUIRED');
    expect((await admin.post(`/api/decisions/${dec.id}/decide`, { action: 'approve', biometric: { method: 'dev' } })).body.effects).toContain('field_extra_approved');
    // critical decision → immediate push notification to the admin
    const push = await ownerSql(`SELECT priority, status FROM notifications WHERE tenant_id = $1 AND entity_id = $2`, [t.tenantId, dec.id]);
    expect(push.some((n) => n.priority === 'critical' && n.status === 'sent')).toBe(true);

    // project total: 4.000 + 6.000 + 5.000 = 15.000 (inclusive) → still field lead; +1 TL → admin
    expect((await field.post(`/api/projects/${sp.projectId}/field-extras`, { description: 'Ek su', amountTry: 5000 })).body.needsAdminApproval).toBe(false);
    expect((await field.post(`/api/projects/${sp.projectId}/field-extras`, { description: 'Kalem', amountTry: 1 })).body.needsAdminApproval).toBe(true);
    expect((await clerk.post(`/api/projects/${sp.projectId}/field-extras`, { description: 'x', amountTry: 10 })).status).toBe(403);

    // public approval: person / time / amount recorded; second approval refused
    const token = a.body.approvalLink.split('/e/')[1];
    const pub = client(T.app);
    const view = await pub.get(`/api/public/extras/${token}`);
    expect(view.body).toMatchObject({ description: 'Ek coffee break', amountTry: 4000, approvedAt: null });
    expect((await pub.post(`/api/public/extras/${token}/approve`, { approverName: 'Burak Şahin' })).body).toEqual({ ok: true });
    expect((await pub.post(`/api/public/extras/${token}/approve`, { approverName: 'Burak Şahin' })).status).toBe(409);
    const row = (await ownerSql(`SELECT customer_approver_name, customer_approved_at, customer_approved_amount_try FROM field_extras WHERE id = $1`, [a.body.id]))[0];
    expect(row.customer_approver_name).toBe('Burak Şahin');
    expect(row.customer_approved_at).toBeTruthy();
    expect(Number(row.customer_approved_amount_try)).toBe(4000);

    // reflect: not reflected requires a reason; field lead cannot decide
    expect((await ops.post(`/api/field-extras/${b.body.id}/reflect`, { reflected: false })).body.error.code).toBe('REASON_REQUIRED');
    expect((await field.post(`/api/field-extras/${b.body.id}/reflect`, { reflected: true })).status).toBe(403);
    const nr = await ops.post(`/api/field-extras/${b.body.id}/reflect`, { reflected: false, reason: 'Müşteri ilişkisi — ikram' });
    expect(nr.body).toMatchObject({ reflectedToCustomer: false, notReflectedReason: 'Müşteri ilişkisi — ikram' });
    expect((await ops.post(`/api/field-extras/${a.body.id}/reflect`, { reflected: true })).body.reflectedToCustomer).toBe(true);
    const totals = await admin.get('/api/field-extras/unreflected-totals');
    expect(totals.body.byProject.find((x: any) => x.projectId === sp.projectId).amountTry).toBe(6000);
    expect(totals.body.byCustomer[0].amountTry).toBe(6000);
    expect((await ops.get('/api/field-extras/unreflected-totals')).status).toBe(403);

    const list = await ops.get(`/api/projects/${sp.projectId}/field-extras`);
    expect(list.body.items).toHaveLength(4);

    // customer invoice draft: contract + approved & reflected extras only
    const doc = await finance.post(`/api/projects/${sp.projectId}/customer-invoice-draft`);
    expect(doc.status).toBe(200);
    expect(doc.body.kind).toBe('customer_invoice_draft');
    expect(doc.body.content.lines.some((l: any) => l.description.includes('Ek coffee break'))).toBe(true);
    expect(doc.body.content.lines.some((l: any) => l.description.includes('Ek teknik'))).toBe(false);
    expect(doc.body.downloadUrl).toMatch(/\/file$/);
  });

  it('field issues + daily 3-line summary', async () => {
    const i = await field.post(`/api/projects/${sp.projectId}/field-issues`, { description: 'Salon klimaları çalışmıyor', severity: 'high', supplierId: t.suppliers.moda });
    expect(i.status).toBe(200);
    expect((await ops.get(`/api/projects/${sp.projectId}/field-issues`)).body.items[0].description).toBe('Salon klimaları çalışmıyor');
    const s = await admin.get(`/api/projects/${sp.projectId}/daily-summary`);
    expect(s.body.lines).toHaveLength(3);
    expect(s.body.lines[1]).toContain('Salon klimaları');
  });

  it('routine notifications are batched into the next morning / evening digest', async () => {
    const pending = await ownerSql(`SELECT count(*)::int AS n FROM notifications WHERE tenant_id = $1 AND status = 'pending' AND priority = 'routine'`, [t.tenantId]);
    expect(pending[0].n).toBeGreaterThan(0);
    const slot = nextDigestSlot(clock.now, 'Europe/Istanbul');
    expect(slot.toISOString()).toBe('2026-11-20T15:00:00.000Z'); // 18:00 Istanbul
    const done = await runFollowupsForTenant(T.app.deps, t.tenantId, new Date(slot.getTime() + 60_000));
    expect(done.some((x) => x.startsWith('notification_digests:'))).toBe(true);
    const left = await ownerSql(`SELECT count(*)::int AS n FROM notifications WHERE tenant_id = $1 AND status = 'pending' AND deliver_after <= $2`, [t.tenantId, slot]);
    expect(left[0].n).toBe(0);
    expect((await ownerSql(`SELECT count(*)::int AS n FROM notifications WHERE tenant_id = $1 AND priority = 'digest'`, [t.tenantId]))[0].n).toBeGreaterThan(0);
  });
});

describe('rooming list & KVKK (§17.9)', () => {
  it('public form with per-guest consent; PII encrypted at rest; masked for unauthorized roles; withdraw + anonymization job', async () => {
    const link = await ops.post(`/api/projects/${sp.projectId}/rooming-link`);
    expect(link.body.url).toMatch(/^\/r\/[\w-]{20,}$/);
    expect((await finance.post(`/api/projects/${sp.projectId}/rooming-link`)).status).toBe(403);
    const token = link.body.url.split('/r/')[1];
    const pub = client(T.app);
    const view = await pub.get(`/api/public/rooming/${token}`);
    expect(view.body).toMatchObject({ projectCode: sp.code, readOnly: false, submittedCount: 0 });
    expect(view.body.roomTypes).toEqual(expect.arrayContaining(['SGL', 'DBL']));
    const sub = await pub.post(`/api/public/rooming/${token}`, {
      guests: [
        { fullName: 'Zehra Kırmızıgül', email: 'zehra@example.com', phone: '+90 555 000 11 22', roomType: 'DBL', arrival: '2027-03-12', departure: '2027-03-14', consentReuse: true },
        { fullName: 'Okan Beyazıt', roomType: 'SGL', consentReuse: false },
        { fullName: 'Selma Turuncu', email: 'selma@example.com', roomType: 'SGL', consentReuse: true },
      ],
    });
    expect(sub.body).toEqual({ ok: true, saved: 3 });

    // encrypted at rest: no plaintext in the table nor in the audit log
    const raw = await ownerSql(`SELECT full_name_enc, email_enc, retention_until, consent_reuse FROM guests WHERE project_id = $1 ORDER BY created_at`, [sp.projectId]);
    expect(raw).toHaveLength(3);
    for (const g of raw) expect(Buffer.from(g.full_name_enc).toString('latin1')).not.toMatch(/Zehra|Okan|Selma/);
    expect(raw[0].retention_until).toBe('2029-03-13'); // event end 2027-03-14 + 730 days
    const audit = await ownerSql(`SELECT after::text AS a FROM audit_log WHERE tenant_id = $1 AND entity = 'guests'`, [t.tenantId]);
    expect(audit.length).toBeGreaterThan(0);
    expect(audit.some((x) => /Zehra|zehra@example/.test(x.a))).toBe(false);
    const events = await ownerSql(`SELECT event FROM consent_events WHERE tenant_id = $1`, [t.tenantId]);
    expect(events.filter((e) => e.event === 'given')).toHaveLength(2);

    // authorized roles see clear text; others see masked labels (nothing decrypted)
    const clear = await ops.get(`/api/projects/${sp.projectId}/guests`);
    expect(clear.body.items.map((g: any) => g.fullName)).toEqual(['Zehra Kırmızıgül', 'Okan Beyazıt', 'Selma Turuncu']);
    expect(clear.body.items[0].email).toBe('zehra@example.com');
    for (const who of [clerk, finance]) {
      const masked = await who.get(`/api/projects/${sp.projectId}/guests`);
      expect(masked.status).toBe(200);
      expect(JSON.stringify(masked.body)).not.toMatch(/Zehra|Okan|Selma|zehra@|555 000/);
      expect(masked.body.items[0].fullName).toContain('***');
    }
    expect((await clerk.post(`/api/projects/${sp.projectId}/guests`, [{ fullName: 'X Y' }])).status).toBe(403);
    expect((await ops.post(`/api/projects/${sp.projectId}/guests`, [{ fullName: 'Personel Girişi', roomType: 'SGL' }])).body.items).toHaveLength(4);

    // consent withdrawal link went to the guest by e-mail (redacted in the outbox)
    const mail = T.email.sent.find((m) => m.to === 'zehra@example.com');
    const wtoken = /consent\/([\w-]+)\/withdraw/.exec(mail!.body)![1];
    expect((await ownerSql(`SELECT body FROM outbox WHERE tenant_id = $1 AND to_address = 'zehra@example.com'`, [t.tenantId]))[0].body).not.toContain(wtoken);
    const confirmPage = await T.app.inject({ method: 'GET', url: `/api/public/consent/${wtoken}/withdraw` });
    expect(confirmPage.headers['content-type']).toContain('text/html'); // the e-mail link opens a confirmation page (no side effect)
    expect((await ops.get(`/api/projects/${sp.projectId}/guests`)).body.items[0].consentWithdrawnAt).toBeNull();
    expect((await pub.post(`/api/public/consent/${wtoken}/withdraw`)).body).toEqual({ ok: true });
    expect((await pub.post(`/api/public/consent/${wtoken}/withdraw`)).status).toBe(404); // link revoked
    const zehra = (await ops.get(`/api/projects/${sp.projectId}/guests`)).body.items[0];
    expect(zehra.consentWithdrawnAt).toBeTruthy();
    expect(zehra.anonymizedAt).toBeNull(); // retention period still running

    // anonymization job (worker): after retention → withdrawn + non-consenting guests anonymized; consenting kept
    const done = await runFollowupsForTenant(T.app.deps, t.tenantId, new Date('2029-03-15T08:00:00Z'));
    expect(done).toContain('guests_anonymized:3'); // Zehra (withdrawn), Okan (no consent), staff entry (no consent)
    const after = (await ops.get(`/api/projects/${sp.projectId}/guests`)).body.items;
    expect(after.map((g: any) => g.fullName)).toEqual(['[anonim]', '[anonim]', 'Selma Turuncu', '[anonim]']);
    const rows = await ownerSql(`SELECT full_name_enc, email_enc, phone_enc, anonymized_at FROM guests WHERE project_id = $1 AND anonymized_at IS NOT NULL`, [sp.projectId]);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.full_name_enc === null && r.email_enc === null && r.phone_enc === null)).toBe(true);
    expect((await ownerSql(`SELECT count(*)::int AS n FROM consent_events WHERE tenant_id = $1 AND event = 'anonymized'`, [t.tenantId]))[0].n).toBe(3);
  });
});
