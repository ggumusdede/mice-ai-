// §7 Adım 0 intake end-to-end (mock AI) and Adım 1 RFQ + supplier token flow.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { advanceHours, client, closeApp, login, makeApp, newTenant, ownerSql, REQUEST_TEXT, resetClock, type Client, type TestApp } from './helpers.js';
import { sha256Hex } from '../src/lib/crypto.js';
import { runFollowupsOnce } from '../src/worker.js';

let T: TestApp;
let t: Awaited<ReturnType<typeof newTenant>>;
let admin: Client;
let clerk: Client;

beforeAll(async () => {
  T = await makeApp();
  t = await newTenant('intake');
  admin = client(T.app, await login(T.app, t.users.admin.email));
  clerk = client(T.app, await login(T.app, t.users.clerk.email));
});
beforeEach(() => resetClock());
afterAll(() => closeApp(T));

describe('intake (Adım 0)', () => {
  it('creates a coded project, items, missing list + draft, pre-match, assignment decision; detects duplicates', async () => {
    const r = await clerk.post('/api/intake', { channel: 'email', body: REQUEST_TEXT, fromAddress: 'selin@anadolu.example.com', subject: 'Toplantı' });
    expect(r.status).toBe(200);
    const b = r.body;
    expect(b.project.code).toMatch(/^PRJ-\d{4}-ANADOLUILAC-20270312-80-TBD$/);
    expect(b.project.customerId).toBe(t.customers.new);
    expect(b.project.pax).toBe(80);
    expect(b.project.budget).toBe(20000); // kişi başı 250 × 80
    expect(b.project.receivedAt).toBe(new Date('2026-11-20T07:00:00Z').toISOString());
    expect(b.rfqReady).toBe(true);
    expect(b.preMatchedSuppliers.length).toBeGreaterThan(0);
    expect(b.preMatchedSuppliers[0].supplier.district).toBe('Kadıköy');
    expect(b.assignmentSuggestion?.userId).toBe(t.users.clerk.id);
    expect(Array.isArray(b.missingQuestions)).toBe(true);
    expect(b.duplicates).toEqual([]);

    const detail = await clerk.get(`/api/projects/${b.project.id}`);
    expect(detail.body.items.map((i: any) => i.kind).sort()).toEqual(expect.arrayContaining(['accommodation', 'hall', 'fnb', 'transfer']));
    const ai = await ownerSql(`SELECT action_type, authority, confidence FROM ai_actions WHERE project_id = $1`, [b.project.id]);
    expect(ai.find((x) => x.action_type === 'request_extraction')?.authority).toBe('autonomous');

    // assignment suggestion → admin decision (clerk cannot see it)
    const clerkInbox = await clerk.get('/api/decisions');
    expect(clerkInbox.body.items.find((d: any) => d.kind === 'assignment')).toBeUndefined();
    const inbox = await admin.get('/api/decisions');
    const dec = inbox.body.items.find((d: any) => d.kind === 'assignment' && d.projectId === b.project.id);
    expect(dec).toBeTruthy();
    const decided = await admin.post(`/api/decisions/${dec.id}/decide`, { action: 'approve' });
    expect(decided.status).toBe(200);
    expect((await admin.get(`/api/projects/${b.project.id}`)).body.project.ownerId).toBe(t.users.clerk.id);

    // missing-info question: clerk sends directly (no price → no admin approval)
    if (b.questionDraft) {
      const s = await clerk.post(`/api/drafts/${b.questionDraft.id}/send`);
      expect(s.status).toBe(200);
      expect(s.body.status).toBe('sent');
      expect(T.email.sent.at(-1)?.from).toBe(t.users.clerk.email); // human's own address
    }

    const dup = await clerk.post('/api/intake', { channel: 'phone_note', body: REQUEST_TEXT });
    expect(dup.body.duplicates.map((d: any) => d.projectId)).toContain(b.project.id);
    expect(dup.body.project.seq).toBe(b.project.seq + 1);
  });

  it('lost requires a reason; PATCH target override requires a reason', async () => {
    const r = await clerk.post('/api/intake', { channel: 'manual', body: 'Mayısta Sarıyer 40 kişi yönetim toplantısı' });
    const id = r.body.project.id;
    expect((await clerk.post(`/api/projects/${id}/outcome`, { outcome: 'lost' })).body.error.code).toBe('LOST_REASON_REQUIRED');
    expect((await clerk.patch(`/api/projects/${id}`, { targetBusinessDays: 1 })).body.error.code).toBe('REASON_REQUIRED');
    expect((await clerk.patch(`/api/projects/${id}`, { targetBusinessDays: 1, targetOverrideReason: 'acil talep' })).status).toBe(200);
    const lost = await clerk.post(`/api/projects/${id}/outcome`, { outcome: 'lost', lostReason: 'Bütçe uymadı' });
    expect(lost.body.outcome).toBe('lost');
  });
});

describe('RFQ + supplier link (Adım 1, §10, §17.5)', () => {
  it('enforces 3–5 suppliers unless a reason is recorded; sends after approval with a one-time link (hash only stored)', async () => {
    const intake = await clerk.post('/api/intake', { channel: 'email', body: REQUEST_TEXT, customerId: t.customers.trusted });
    const item = (await clerk.get(`/api/projects/${intake.body.project.id}`)).body.items.find((i: any) => i.kind === 'accommodation');

    const short = await clerk.get(`/api/items/${item.id}/shortlist`);
    expect(short.body.items[0].sameDistrict).toBe(true);

    const two = await clerk.post(`/api/items/${item.id}/rfqs`, { supplierIds: [t.suppliers.moda, t.suppliers.kalamis] });
    expect(two.status).toBe(400);
    expect(two.body.error.code).toBe('RFQ_OVERRIDE_REASON_REQUIRED');

    const r = await clerk.post(`/api/items/${item.id}/rfqs`, { supplierIds: [t.suppliers.moda, t.suppliers.kalamis, t.suppliers.galata] });
    expect(r.status).toBe(200);
    expect(r.body.items).toHaveLength(3);
    expect(r.body.items.every((x: any) => x.status === 'pending_approval')).toBe(true);

    const dec = (await clerk.get('/api/decisions')).body.items.find((d: any) => d.kind === 'rfq_send' && d.entityId === item.id);
    expect(dec).toBeTruthy();
    const before = T.email.sent.length;
    const ok = await clerk.post(`/api/decisions/${dec.id}/decide`, { action: 'approve' });
    expect(ok.status).toBe(200);
    expect(ok.body.effects.filter((e: string) => e.startsWith('rfq_sent'))).toHaveLength(3);
    const mails = T.email.sent.slice(before);
    expect(mails).toHaveLength(3);
    const owner = (await clerk.get(`/api/projects/${intake.body.project.id}`)).body.project.ownerId;
    const ownerEmail = owner ? (await ownerSql('SELECT email FROM users WHERE id = $1', [owner]))[0].email : t.users.clerk.email;
    expect(mails.every((m) => m.from === ownerEmail)).toBe(true);
    const link = mails[0].body.match(/\/s\/rfq\/([A-Za-z0-9_-]{43})/);
    expect(link).toBeTruthy();
    const token = link![1];

    // only the SHA-256 is stored; the plain token appears nowhere in the DB (outbox copy is redacted)
    const rfqRow = (await ownerSql('SELECT * FROM rfqs WHERE token_hash = $1', [sha256Hex(token)]))[0];
    expect(rfqRow).toBeTruthy();
    const leak = await ownerSql(`SELECT
      (SELECT count(*) FROM outbox WHERE body LIKE '%' || $1 || '%') + (SELECT count(*) FROM message_drafts WHERE body LIKE '%' || $1 || '%')
      + (SELECT count(*) FROM audit_log WHERE after::text LIKE '%' || $1 || '%') AS n`, [token]);
    expect(Number(leak[0].n)).toBe(0);

    // public view is scoped to the single item; each POST is a new version
    const pub = client(T.app);
    const view = await pub.get(`/api/public/rfq/${token}`);
    expect(view.status).toBe(200);
    expect(view.body.readOnly).toBe(false);
    expect(view.body.item.kind).toBe('accommodation');
    expect(JSON.stringify(view.body)).not.toContain(intake.body.project.id);
    const offer = { currency: 'EUR', lines: [{ description: 'DBL BB', kind: 'accommodation', quantity: 25, unit: 'room_night', nights: 2, unitPrice: 110, vatIncluded: false, vatRate: 0.1, roomType: 'DBL', board: 'BB' }], optionUntil: '2027-01-31' };
    const v1 = await pub.post(`/api/public/rfq/${token}`, offer);
    expect(v1.body).toEqual({ ok: true, version: 1 });
    const v2 = await pub.post(`/api/public/rfq/${token}`, { ...offer, lines: [{ ...offer.lines[0], unitPrice: 104 }] });
    expect(v2.body.version).toBe(2);
    const versions = await ownerSql('SELECT version, superseded_by FROM supplier_offers WHERE rfq_id = $1 ORDER BY version', [rfqRow.id]);
    expect(versions).toHaveLength(2);
    expect(versions[0].superseded_by).not.toBeNull();
    expect((await pub.get(`/api/public/rfq/${token}`)).body.previousVersions).toHaveLength(2);
    expect((await ownerSql('SELECT status FROM rfqs WHERE id = $1', [rfqRow.id]))[0].status).toBe('responded');

    // the candidate supplier (Galata) can also quote through its link
    const galataMail = mails.find((m) => m.to.includes('galata'))!;
    const gTok = galataMail.body.match(/\/s\/rfq\/([A-Za-z0-9_-]{43})/)![1];
    expect((await pub.post(`/api/public/rfq/${gTok}`, offer)).body.ok).toBe(true);

    // unknown token
    expect((await pub.get(`/api/public/rfq/${'x'.repeat(43)}`)).status).toBe(404);

    // after the deadline: read-only; after the option end: gone
    advanceHours(49);
    expect((await pub.get(`/api/public/rfq/${token}`)).body.readOnly).toBe(true);
    const late = await pub.post(`/api/public/rfq/${token}`, offer);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('RFQ_READ_ONLY');
    advanceHours(24 * 80);
    expect((await pub.get(`/api/public/rfq/${token}`)).status).toBe(410);
  });

  it('follow-up worker: 24h autonomous reminder (pre-approved template), 48h call task', async () => {
    const intake = await clerk.post('/api/intake', { channel: 'email', body: REQUEST_TEXT.replace('Kadıköy', 'Beşiktaş'), customerId: t.customers.deposit });
    const item = (await clerk.get(`/api/projects/${intake.body.project.id}`)).body.items.find((i: any) => i.kind === 'hall');
    await clerk.post(`/api/items/${item.id}/rfqs`, { supplierIds: [t.suppliers.bogaz, t.suppliers.ortakoy, t.suppliers.tarabya] });
    const dec = (await clerk.get('/api/decisions')).body.items.find((d: any) => d.kind === 'rfq_send' && d.entityId === item.id);
    await clerk.post(`/api/decisions/${dec.id}/decide`, { action: 'approve' });
    const before = T.email.sent.length;
    advanceHours(25);
    await runFollowupsOnce(T.app.deps, T.app.deps.now());
    const reminders = T.email.sent.slice(before).filter((m) => m.autonomous && /Hatırlatma/.test(m.subject ?? ''));
    expect(reminders.length).toBeGreaterThanOrEqual(3);
    advanceHours(24);
    await runFollowupsOnce(T.app.deps, T.app.deps.now());
    const tasks = await clerk.get(`/api/tasks?projectId=${intake.body.project.id}`);
    expect(tasks.body.items.filter((x: any) => x.kind === 'call_supplier').length).toBe(3);
    // idempotent
    await runFollowupsOnce(T.app.deps, T.app.deps.now());
    expect((await clerk.get(`/api/tasks?projectId=${intake.body.project.id}`)).body.items.filter((x: any) => x.kind === 'call_supplier').length).toBe(3);
  });
});
