// Regression tests for the findings of the security review (docs/09-guvenlik-incelemesi.md). Each block names its finding.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { withSystemCtx } from '../src/context.js';
import { anonymizeGuest } from '../src/services/guests.js';
import { client, closeApp, login, makeApp, newTenant, ownerSql, resetClock, type TestApp } from './helpers.js';
import { signedProject } from './phase-b-helpers.js';

let T: TestApp;
beforeAll(async () => {
  T = await makeApp();
});
beforeEach(() => resetClock());
afterAll(() => closeApp(T));

describe('G-01 approved outbound drafts cannot be changed and sent without a new approval', () => {
  it('pending → edit refused; approved → recipient may be filled in, content change voids approval; CR/LF refused', async () => {
    const t = await newTenant('sec-draft');
    const admin = client(T.app, await login(T.app, t.users.admin.email));
    const clerk = client(T.app, await login(T.app, t.users.clerk.email));
    const [d] = await ownerSql(
      `INSERT INTO message_drafts (tenant_id, kind, body, subject, from_user_id) VALUES ($1, 'other', 'Onaylanan metin', 'Konu', $2) RETURNING id`,
      [t.tenantId, t.users.clerk.id]);
    const dec = await clerk.post(`/api/drafts/${d.id}/request-approval`);
    expect(dec.status).toBe(200);
    // while waiting for approval the content is frozen (the card shows a snapshot of it)
    const frozen = await clerk.patch(`/api/drafts/${d.id}`, { body: 'Sonradan değiştirilmiş metin' });
    expect(frozen.body.error.code).toBe('DRAFT_PENDING_APPROVAL');
    const ok = await admin.post(`/api/decisions/${dec.body.id}/decide`, { action: 'approve' });
    expect(ok.body.effects).toContain('draft_approved');
    // filling in a missing recipient keeps the approval
    const to = await clerk.patch(`/api/drafts/${d.id}`, { to: 'musteri@example.com' });
    expect(to.body.status).toBe('approved');
    // header injection through recipient / subject
    expect((await clerk.patch(`/api/drafts/${d.id}`, { to: 'musteri@example.com\r\nBcc: rakip@example.com' })).body.error.code).toBe('INVALID_HEADER_VALUE');
    expect((await clerk.patch(`/api/drafts/${d.id}`, { subject: 'Konu\nBcc: rakip@example.com' })).body.error.code).toBe('INVALID_HEADER_VALUE');
    // changing the approved content (or redirecting it) voids the approval
    const edited = await clerk.patch(`/api/drafts/${d.id}`, { body: 'Onaysız yeni metin' });
    expect(edited.body.status).toBe('draft');
    const send = await clerk.post(`/api/drafts/${d.id}/send`);
    expect(send.body.error.code).toBe('DRAFT_NOT_APPROVED');
    expect((await ownerSql('SELECT count(*)::int AS n FROM outbox WHERE draft_id = $1', [d.id]))[0].n).toBe(0);
  });
});

describe('G-03 login brute force / user enumeration', () => {
  it('login is rate limited per IP', async () => {
    const app = await buildApp({ config: { loginRateLimitPerMinute: 3 }, logger: false });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 4; i++) {
        codes.push((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'yok@example.com', password: 'x' } })).statusCode);
      }
      expect(codes).toEqual([401, 401, 401, 429]);
    } finally {
      await app.close(); // the shared pool stays open for the other tests
    }
  });
});

describe('G-04 configuration fails closed outside development / test', () => {
  it('unknown NODE_ENV needs real secrets and gets no dev biometric', () => {
    expect(() => loadConfig({ NODE_ENV: 'staging' })).toThrow(/JWT_SECRET/);
    expect(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'kisa', GUEST_DATA_KEY: 'k' })).toThrow(/JWT_SECRET/);
    expect(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40) })).toThrow(/GUEST_DATA_KEY/);
    const secrets = { JWT_SECRET: 'x'.repeat(40), GUEST_DATA_KEY: 'k' };
    expect(loadConfig({ NODE_ENV: 'staging', ...secrets }).allowDevBiometric).toBe(false);
    expect(loadConfig({ NODE_ENV: 'production', ...secrets }).allowDevBiometric).toBe(false);
    expect(loadConfig({ NODE_ENV: 'production', ...secrets, ALLOW_DEV_BIOMETRIC: '1' }).allowDevBiometric).toBe(true); // explicit demo opt-in
    expect(loadConfig({ NODE_ENV: 'test' }).allowDevBiometric).toBe(true);
  });
});

describe('G-05 four-eyes: a delegate cannot approve their own payment request', () => {
  it('finance as delegate → own payment refused; G-10 bank transactions / commissions admin + finance only', async () => {
    const t = await newTenant('sec-4eyes');
    const admin = client(T.app, await login(T.app, t.users.admin.email));
    const finance = client(T.app, await login(T.app, t.users.finance.email));
    const clerk = client(T.app, await login(T.app, t.users.clerk.email));
    const sp = await signedProject(T.app, admin, t);
    const pre = (await finance.get(`/api/finance/entries?projectId=${sp.projectId}&kind=payable`)).body.items.find((e: any) => e.meta.part === 'prepayment');
    expect((await finance.post('/api/finance/payment-requests', { entryId: pre.id })).status).toBe(200);
    expect((await admin.post('/api/delegations', { delegateId: t.users.finance.id, startsAt: '2026-11-19T00:00:00Z', endsAt: '2026-11-30T00:00:00Z' })).status).toBe(200);
    const d = (await finance.get('/api/decisions')).body.items.find((x: any) => x.kind === 'payment_approval' && x.entityId === pre.id);
    expect(d).toBeTruthy(); // visible through the delegation …
    const self = await finance.post(`/api/decisions/${d.id}/decide`, { action: 'approve', biometric: { method: 'dev' } });
    expect(self.body.error.code).toBe('SELF_APPROVAL_FORBIDDEN'); // … but not for their own request
    expect((await ownerSql('SELECT status FROM finance_entries WHERE id = $1', [pre.id]))[0].status).toBe('pending_approval');
    expect((await admin.post(`/api/decisions/${d.id}/decide`, { action: 'approve', biometric: { method: 'dev' } })).body.effects).toContain('payment_approved');

    // G-10: the agency's bank movements / commissions are finance data
    expect((await clerk.get('/api/finance/bank-transactions')).status).toBe(403);
    expect((await clerk.get('/api/finance/commissions')).status).toBe(403);
    expect((await finance.get('/api/finance/bank-transactions')).status).toBe(200);
  });
});

describe('G-06 KVKK: no guest PII copies in outbox / audit log; G-13 rooming form abuse bound', () => {
  it('consent notice stored redacted, audit keeps no recipient, anonymization clears the sent row; > cap refused', async () => {
    const t = await newTenant('sec-kvkk');
    const admin = client(T.app, await login(T.app, t.users.admin.email));
    const ops = client(T.app, await login(T.app, t.users.ops.email));
    const sp = await signedProject(T.app, admin, t);
    const token = (await ops.post(`/api/projects/${sp.projectId}/rooming-link`)).body.url.split('/r/')[1];
    const pub = client(T.app);
    const sub = await pub.post(`/api/public/rooming/${token}`, { guests: [{ fullName: 'Nermin Özgürcan', email: 'nermin.ozgurcan@example.com', roomType: 'DBL', consentReuse: true }] });
    expect(sub.body).toEqual({ ok: true, saved: 1 });
    expect(T.email.sent.some((m) => m.to === 'nermin.ozgurcan@example.com' && m.body.includes('Nermin Özgürcan'))).toBe(true); // delivered in full
    const out = await ownerSql(`SELECT id, body, to_address FROM outbox WHERE tenant_id = $1 AND to_address = 'nermin.ozgurcan@example.com'`, [t.tenantId]);
    expect(out).toHaveLength(1);
    expect(out[0].body).not.toContain('Nermin'); // stored copy redacted
    const audit = await ownerSql(`SELECT before::text AS b, after::text AS a FROM audit_log WHERE tenant_id = $1 AND entity = 'outbox'`, [t.tenantId]);
    expect(audit.length).toBeGreaterThan(0);
    expect(audit.some((x) => /nermin|Nermin/.test(`${x.a} ${x.b}`))).toBe(false); // append-only log never gets the PII

    const [g] = await ownerSql('SELECT id FROM guests WHERE project_id = $1', [sp.projectId]);
    await withSystemCtx(T.app.deps, t.tenantId, { type: 'system', id: null }, (ctx) => anonymizeGuest(ctx, g.id));
    expect((await ownerSql('SELECT to_address FROM outbox WHERE id = $1', [out[0].id]))[0].to_address).toBe('[anonim]');

    // a forwarded / leaked link cannot become an unlimited e-mail relay
    const many = Array.from({ length: 200 }, (_, i) => ({ fullName: `Misafir ${i}`, consentReuse: false }));
    expect((await pub.post(`/api/public/rooming/${token}`, { guests: many })).body.error.code).toBe('ROOMING_LIMIT');
  });
});

describe('G-07 public RFQ upload: link checked before the body is accepted', () => {
  it('an unknown token gets 404 even for an oversized upload (not buffered first)', async () => {
    const boundary = '----sec' + Date.now();
    const big = Buffer.alloc(21 * 1024 * 1024, 0x41);
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.csv"\r\nContent-Type: text/csv\r\n\r\n`),
      big, Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const r = await T.app.inject({
      method: 'POST', url: `/api/public/rfq/${'A'.repeat(43)}/files`, payload,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    expect(r.statusCode).toBe(404);
  });
});

describe('G-08 bank statement size bound', () => {
  it('more than 5000 rows → 400 before any matching work', async () => {
    const t = await newTenant('sec-bank');
    const finance = client(T.app, await login(T.app, t.users.finance.email));
    const rows = Array.from({ length: 5001 }, (_, i) => `20.11.2026;Satır ${i};X Ltd;-${i + 1},00;EUR`);
    const csv = ['İşlem Tarihi;Açıklama;Karşı Taraf;Tutar;Döviz', ...rows].join('\n');
    const r = await finance.post('/api/finance/bank-statements', { csv });
    expect(r.body.error.code).toBe('STATEMENT_TOO_LARGE');
    expect((await ownerSql('SELECT count(*)::int AS n FROM bank_transactions WHERE tenant_id = $1', [t.tenantId]))[0].n).toBe(0);
  });
});

describe('G-09 survey replay / double submit', () => {
  it('two concurrent submits: exactly one wins', async () => {
    const t = await newTenant('sec-survey');
    const [p] = await ownerSql('SELECT id FROM projects WHERE tenant_id = $1 LIMIT 1', [t.tenantId]).then(async (r) => r.length ? r
      : ownerSql(`INSERT INTO projects (tenant_id, seq, code, title) VALUES ($1, 9999, 'PRJ-9999-SEC', 'Anket') RETURNING id`, [t.tenantId]));
    const token = 'survey-token-' + 'x'.repeat(30) + Date.now();
    const { createHash } = await import('node:crypto');
    await ownerSql('INSERT INTO surveys (tenant_id, project_id, token_hash) VALUES ($1, $2, $3)', [t.tenantId, p.id, createHash('sha256').update(token).digest('hex')]);
    const pub = client(T.app);
    const res = await Promise.all([1, 2, 3].map((n) => pub.post(`/api/public/survey/${token}`, { answers: { overall: n } })));
    expect(res.map((r) => r.status).sort()).toEqual([200, 409, 409]);
  });
});

describe('G-11 suspended tenant', () => {
  it('no login, existing tokens stop working, public links stop resolving', async () => {
    const t = await newTenant('sec-suspend');
    const tok = await login(T.app, t.users.admin.email);
    const admin = client(T.app, tok);
    const sp = await signedProject(T.app, admin, t);
    const ops = client(T.app, await login(T.app, t.users.ops.email));
    const token = (await ops.post(`/api/projects/${sp.projectId}/rooming-link`)).body.url.split('/r/')[1];
    await ownerSql(`UPDATE tenants SET status = 'suspended' WHERE id = $1`, [t.tenantId]);
    try {
      expect((await T.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: t.users.admin.email, password: 'demo1234' } })).statusCode).toBe(401);
      expect((await admin.get('/api/projects')).status).toBe(401);
      expect((await client(T.app).get(`/api/public/rooming/${token}`)).status).toBe(404);
    } finally {
      await ownerSql(`UPDATE tenants SET status = 'active' WHERE id = $1`, [t.tenantId]);
    }
    expect((await admin.get('/api/projects')).status).toBe(200);
  });
});

describe('G-12 security headers', () => {
  it('nosniff / frame / referrer / CSP everywhere; no-store on public token routes', async () => {
    const r = await T.app.inject({ method: 'GET', url: `/api/public/quotes/${'B'.repeat(43)}` });
    expect(r.statusCode).toBe(404);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['referrer-policy']).toBe('no-referrer');
    expect(r.headers['cache-control']).toBe('no-store');
    expect(String(r.headers['content-security-policy'])).toContain("default-src 'none'");
  });
});
