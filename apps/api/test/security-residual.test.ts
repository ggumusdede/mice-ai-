// Regression tests for the residual-risk fixes of the security review (docs/09-guvenlik-incelemesi.md, G-15 … G-21) and the
// configurable [Ürün kararı] defaults (TenantRules: neverAutomateKinds, outboundAutoSendRequiresStandingApproval,
// hideCustomerFromSuppliers, fieldRoleCanSeeFinancials).
import { deflateRawSync } from 'node:zlib';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { supplierSafeCode } from '@mice/domain';
import { loadConfig } from '../src/config.js';
import { toAppError } from '../src/errors.js';
import { getPool } from '../src/db/pool.js';
import { assertSafeZip } from '../src/lib/zip-guard.js';
import { xlsxToCsv } from '../src/services/offers.js';
import { createLeaderLock } from '../src/worker-lock.js';
import { runFollowupsOnce, runIfLeader } from '../src/worker.js';
import { rateLimitStore } from '../src/rate-limit-store.js';
import { advanceHours, client, closeApp, login, makeApp, newTenant, ownerSql, quotableProject, REQUEST_TEXT, resetClock, twoOptions, type TestApp } from './helpers.js';
import { signedProject } from './phase-b-helpers.js';

let T: TestApp;
beforeAll(async () => {
  T = await makeApp();
});
beforeEach(() => resetClock());
afterAll(() => closeApp(T));

// ------------------------------------------------------------------ crafted zips (dependency-free writer)
interface Entry { name: string; data: Buffer; method?: 0 | 8; declaredSize?: number }
function zip(entries: Entry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name);
    const method = e.method ?? 8;
    const comp = method === 8 ? deflateRawSync(e.data) : e.data;
    const usize = e.declaredSize ?? e.data.length;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(usize, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(usize, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, comp);
    centrals.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

describe('G-18 XLSX zip-bomb guard (before exceljs)', () => {
  const limits = { maxEntries: 2000, maxUncompressedBytes: 30 * 1024 * 1024, maxRatio: 100 };
  it('a real xlsx passes and is read', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Teklif').addRow(['DBL', 105]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    expect(assertSafeZip(buf, limits).entries).toBeGreaterThan(3);
    expect(await xlsxToCsv(buf)).toContain('DBL');
  });
  it('rejects a deflate bomb, a lying declared size, too many entries and non-zip input', async () => {
    const bomb = zip([{ name: 'xl/worksheets/sheet1.xml', data: Buffer.alloc(40 * 1024 * 1024) }]); // ~40 KB → 40 MB
    expect(bomb.length).toBeLessThan(200_000);
    expect(() => assertSafeZip(bomb, limits)).toThrow(/sınırı|oran/);
    // declared size says 10 bytes, real content is 31 MB → measured, not trusted
    const liar = zip([{ name: 'a.xml', data: Buffer.alloc(31 * 1024 * 1024, 0x41), declaredSize: 10 }]);
    expect(() => assertSafeZip(liar, limits)).toThrow(/sınırı/);
    // high ratio below the size cap (5 MB of zeros ≈ 1000:1)
    expect(() => assertSafeZip(zip([{ name: 'b.xml', data: Buffer.alloc(5 * 1024 * 1024) }]), limits)).toThrow(/oran/);
    const many = zip(Array.from({ length: 2001 }, (_, i) => ({ name: `f${i}`, data: Buffer.from('x'), method: 0 as const })));
    expect(() => assertSafeZip(many, limits)).toThrow(/çok fazla/);
    expect(() => assertSafeZip(Buffer.from('not a zip at all, just text'), limits)).toThrow(/xlsx/);
    // the service entry point used by offers / invoices / bank statements refuses before exceljs runs
    await expect(xlsxToCsv(bomb)).rejects.toMatchObject({ statusCode: 400, code: 'UNSAFE_ARCHIVE' });
  });
  it('bank statement upload (multipart xlsx) → 400 UNSAFE_ARCHIVE', async () => {
    const t = await newTenant('sec-zip');
    const token = await login(T.app, t.users.finance.email);
    const bomb = zip([{ name: 'xl/worksheets/sheet1.xml', data: Buffer.alloc(40 * 1024 * 1024) }]);
    const boundary = '----micetest';
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="ekstre.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`),
      bomb, Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const r = await T.app.inject({
      method: 'POST', url: '/api/finance/bank-statements', payload,
      headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('UNSAFE_ARCHIVE');
  });
});

describe('G-19 Postgres error text never reaches the client', () => {
  const pgErr = (code: string, message: string) => Object.assign(new Error(message), {
    code, severity: 'ERROR', constraint: 'users_email_uq', table: 'users', detail: 'Key (lower(email))=(gizli@example.com) already exists.',
  });
  it('known SQLSTATEs → generic text without constraint / detail; unknown → 500 generic; own trigger text kept', () => {
    const dup = toAppError(pgErr('23505', 'duplicate key value violates unique constraint "users_email_uq"'));
    expect(dup).toMatchObject({ statusCode: 409, code: 'DUPLICATE', message: 'Bu kayıt zaten var' });
    expect(JSON.stringify({ m: dup.message, d: dup.details })).not.toMatch(/users_email_uq|gizli@|duplicate key/);
    const fk = toAppError(pgErr('23503', 'insert or update on table "tasks" violates foreign key constraint "tasks_tenant_project_fk"'));
    expect(fk).toMatchObject({ statusCode: 400, code: 'INVALID_REFERENCE' });
    expect(fk.message).not.toMatch(/tasks|constraint/);
    expect(toAppError(pgErr('22P02', 'invalid input syntax for type uuid: "x"')).message).not.toMatch(/uuid/);
    const unknown = toAppError(pgErr('42703', 'column "secret_col" does not exist'));
    expect(unknown).toMatchObject({ statusCode: 500, code: 'INTERNAL', message: 'Beklenmeyen bir hata oluştu' });
    // our own trigger messages (MIxxx) are written for users and stay
    expect(toAppError(pgErr('MI002', 'İmzalı sözleşme kilitli; değişiklik ek protokol ile yapılır (§7 Adım 5)')).message).toMatch(/İmzalı sözleşme kilitli/);
  });
  it('API: a real FK violation answers with the generic message', async () => {
    const t = await newTenant('sec-pgerr');
    const other = await newTenant('sec-pgerr-b');
    const admin = client(T.app, await login(T.app, t.users.admin.email));
    const intake = await admin.post('/api/intake', { channel: 'email', body: REQUEST_TEXT });
    const r = await admin.post(`/api/projects/${intake.body.project.id}/field-issues`, { description: 'x', severity: 'low', supplierId: other.suppliers.moda });
    expect(r.body.error.code).toBe('INVALID_REFERENCE');
    expect(JSON.stringify(r.body)).not.toMatch(/constraint|violates|_fk|field_issues/);
  });
});

describe('G-17 session revocation (users.token_version)', () => {
  it('password change / admin revoke / role change / deactivation end old tokens; tokens without tv refused', async () => {
    const t = await newTenant('sec-sess');
    const admin = client(T.app, await login(T.app, t.users.admin.email));
    const oldToken = await login(T.app, t.users.clerk.email);
    const otherDevice = client(T.app, await login(T.app, t.users.clerk.email));
    const clerk = client(T.app, oldToken);
    expect((await clerk.get('/api/auth/me')).status).toBe(200);

    expect((await clerk.post('/api/auth/password', { currentPassword: 'yanlis', newPassword: 'yeni-sifre-2026' })).body.error.code).toBe('REAUTH_FAILED');
    const changed = await clerk.post('/api/auth/password', { currentPassword: 'demo1234', newPassword: 'yeni-sifre-2026' });
    expect(changed.status).toBe(200);
    expect((await clerk.get('/api/auth/me')).status).toBe(401);
    expect((await otherDevice.get('/api/auth/me')).status).toBe(401);
    const fresh = client(T.app, changed.body.token);
    expect((await fresh.get('/api/auth/me')).status).toBe(200);
    expect((await T.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: t.users.clerk.email, password: 'demo1234' } })).statusCode).toBe(401);

    // admin "log out everywhere" (admin only)
    expect((await fresh.post(`/api/users/${t.users.ops.id}/revoke-sessions`)).status).toBe(403);
    expect((await admin.post(`/api/users/${t.users.clerk.id}/revoke-sessions`)).body).toEqual({ userId: t.users.clerk.id, revoked: true });
    expect((await fresh.get('/api/auth/me')).status).toBe(401);

    // role change ends sessions, a name change does not
    const ops = client(T.app, await login(T.app, t.users.ops.email));
    await admin.patch(`/api/users/${t.users.ops.id}`, { fullName: 'Ops Yeni Ad' });
    expect((await ops.get('/api/auth/me')).status).toBe(200);
    await admin.patch(`/api/users/${t.users.ops.id}`, { role: 'clerk_sales' });
    expect((await ops.get('/api/auth/me')).status).toBe(401);
    const ops2 = client(T.app, await login(T.app, t.users.ops.email));
    await admin.patch(`/api/users/${t.users.ops.id}`, { active: false });
    expect((await ops2.get('/api/auth/me')).status).toBe(401);

    // a token without the tv claim (issued before this change / forged without it) is refused
    const legacy = T.app.jwt.sign({ userId: t.users.admin.id, tenantId: t.tenantId, role: 'admin' });
    expect((await client(T.app, legacy).get('/api/auth/me')).status).toBe(401);
  });
  it('JWT lifetime defaults to 8h, configurable with JWT_TTL', () => {
    expect(loadConfig({ NODE_ENV: 'test' }).jwtExpiresIn).toBe('8h');
    expect(loadConfig({ NODE_ENV: 'test', JWT_TTL: '2h' }).jwtExpiresIn).toBe('2h');
    expect(loadConfig({ NODE_ENV: 'test', JWT_EXPIRES_IN: '4h' }).jwtExpiresIn).toBe('4h');
  });
});

describe('G-15 supplier-facing outputs hide the customer ([Ürün kararı] hideCustomerFromSuppliers, default true)', () => {
  it('RFQ e-mail, supplier portal, 24h reminder and mail header use the supplier-safe reference', async () => {
    const t = await newTenant('sec-ref');
    const clerk = client(T.app, await login(T.app, t.users.clerk.email));
    const admin = client(T.app, await login(T.app, t.users.admin.email));
    const intake = await clerk.post('/api/intake', { channel: 'email', body: REQUEST_TEXT, customerId: t.customers.new });
    const code: string = intake.body.project.code;
    expect(code).toMatch(/ANADOLU/);
    const ref = supplierSafeCode(code);
    expect(ref).toMatch(/^PRJ-\d{4}-20270312-80$/);
    const item = (await clerk.get(`/api/projects/${intake.body.project.id}`)).body.items.find((i: any) => i.kind === 'hall');
    await clerk.post(`/api/items/${item.id}/rfqs`, { supplierIds: [t.suppliers.bogaz, t.suppliers.ortakoy, t.suppliers.tarabya] });
    const drafts = (await clerk.get(`/api/drafts?projectId=${intake.body.project.id}`)).body.items.filter((d: any) => d.kind === 'rfq');
    expect(drafts.length).toBe(3);
    for (const d of drafts) expect(`${d.subject}\n${d.body}`).not.toMatch(/ANADOLU|Anadolu/);
    const dec = (await clerk.get('/api/decisions')).body.items.find((d: any) => d.kind === 'rfq_send' && d.entityId === item.id);
    const before = T.email.sent.length;
    await clerk.post(`/api/decisions/${dec.id}/decide`, { action: 'approve' });
    const mails = T.email.sent.slice(before);
    expect(mails).toHaveLength(3);
    for (const m of mails) expect(`${m.subject}\n${m.body}`).not.toMatch(/ANADOLU|Anadolu/);
    const token = mails[0].body.match(/\/s\/rfq\/([A-Za-z0-9_-]{43})/)![1];
    const view = await client(T.app).get(`/api/public/rfq/${token}`);
    expect(view.body.projectCode).toBe(ref);
    expect(JSON.stringify(view.body)).not.toMatch(/ANADOLU|Anadolu/);

    advanceHours(25);
    const b2 = T.email.sent.length;
    await runFollowupsOnce(T.app.deps, T.app.deps.now());
    const reminders = T.email.sent.slice(b2).filter((m) => m.autonomous && m.projectId === intake.body.project.id);
    expect(reminders.length).toBe(3);
    for (const m of reminders) {
      expect(`${m.subject}\n${m.body}`).toContain(ref);
      expect(`${m.subject}\n${m.body}`).not.toMatch(/ANADOLU/);
    }

    // the rule is the tenant's decision: switched off → the full code again
    resetClock();
    expect((await admin.patch('/api/rules', { hideCustomerFromSuppliers: false })).body.hideCustomerFromSuppliers).toBe(false);
    expect((await client(T.app).get(`/api/public/rfq/${token}`)).body.projectCode).toBe(code);
  });
  it('supplier confirmation draft and rooming list (to the hotel) carry the safe reference; the contract keeps the customer', async () => {
    const t = await newTenant('sec-ref2');
    const admin = client(T.app, await login(T.app, t.users.admin.email));
    const sp = await signedProject(T.app, admin, t);
    const ref = supplierSafeCode(sp.code);
    const conf = (await admin.get(`/api/drafts?projectId=${sp.projectId}`)).body.items.find((d: any) => d.kind === 'supplier_confirmation');
    expect(conf).toBeTruthy();
    const customerSeg = sp.code.split('-')[2];
    expect(`${conf.subject}\n${conf.body}`).not.toContain(customerSeg);
    const contract = (await admin.get(`/api/contracts/${sp.contractId}`)).body;
    expect(contract.fields.customerName).toBeTruthy(); // the contract itself legitimately names the customer
    const x = await T.app.inject({ method: 'GET', url: `/api/projects/${sp.projectId}/rooming-list.xlsx`, headers: { authorization: `Bearer ${await login(T.app, t.users.admin.email)}` } });
    expect(decodeURIComponent(String(x.headers['content-disposition']))).toContain(`${ref}-rooming-list.xlsx`);
  });
});

describe('G-16 least privilege for the field role ([Ürün kararı] fieldRoleCanSeeFinancials, default false); draft sending', () => {
  it('field sees no profit / quotes / contracts / P&L / finance entries / other users\' drafts; rule on → visible', async () => {
    const t = await newTenant('sec-field');
    const admin = client(T.app, await login(T.app, t.users.admin.email));
    const field = client(T.app, await login(T.app, t.users.field.email));
    const sp = await signedProject(T.app, admin, t);
    await admin.post(`/api/projects/${sp.projectId}/documents`, { kind: 'pnl' });
    const full = (await admin.get(`/api/projects/${sp.projectId}`)).body;
    expect(full.profit.expected).not.toBeNull();
    const pnl = full.documents.find((d: any) => d.kind === 'pnl');
    expect(pnl).toBeTruthy();

    const d = (await field.get(`/api/projects/${sp.projectId}`)).body;
    expect(d.profit).toEqual({ expected: null, realized: null });
    expect(d.quotes).toEqual([]);
    expect(d.contracts).toEqual([]);
    expect(d.items.every((i: any) => i.costEur === null && i.saleEur === null && i.offers.length === 0)).toBe(true);
    expect(d.documents.some((x: any) => ['pnl', 'quote', 'customer_invoice_draft'].includes(x.kind))).toBe(false);
    expect(JSON.stringify(d)).not.toMatch(/unitCostEur|"margin"/);
    const quoteId = full.quotes[0].id;
    for (const url of [`/api/quotes/${quoteId}`, `/api/quotes/${quoteId}/pdf`, `/api/documents/${pnl.id}/file`, `/api/finance/entries?projectId=${sp.projectId}`,
      `/api/projects/${sp.projectId}/contracts`, `/api/contracts/${sp.contractId}`, `/api/items/${sp.accItemId}/comparison`]) {
      const r = await field.get(url);
      expect(r.status, url).toBe(403);
      expect(r.body.error.code, url).toBe('FINANCIALS_HIDDEN');
    }
    expect((await field.post(`/api/documents/${pnl.id}/regenerate`)).status).toBe(403);
    expect((await field.get(`/api/projects/${sp.projectId}/quotes`)).body.items).toEqual([]);
    expect((await field.get(`/api/projects/${sp.projectId}/documents`)).body.items.some((x: any) => x.kind === 'pnl')).toBe(false);
    const timeline = (await field.get(`/api/projects/${sp.projectId}/timeline`)).body.items;
    expect(timeline.filter((e: any) => e.entity === 'quote_lines' || e.entity === 'finance_entries').every((e: any) => e.before === null && e.after === null)).toBe(true);
    // decision detail of a card the field user cannot decide
    const anyDecision = (await ownerSql(`SELECT id FROM decisions WHERE tenant_id = $1 AND kind = 'quote_approval' LIMIT 1`, [t.tenantId]))[0]
      ?? (await ownerSql(`SELECT id FROM decisions WHERE tenant_id = $1 AND required_role = 'admin' LIMIT 1`, [t.tenantId]))[0];
    expect((await field.get(`/api/decisions/${anyDecision.id}`)).status).toBe(403);
    // drafts: only their own
    const all = (await admin.get(`/api/drafts?projectId=${sp.projectId}`)).body.items;
    expect(all.length).toBeGreaterThan(0);
    expect((await field.get(`/api/drafts?projectId=${sp.projectId}`)).body.items).toEqual([]);
    // the field role's own work still works (field extras need no money view of the project)
    expect((await field.post(`/api/projects/${sp.projectId}/field-extras`, { description: 'Ek su', amountTry: 300 })).status).toBe(200);

    await admin.patch('/api/rules', { fieldRoleCanSeeFinancials: true });
    expect((await field.get(`/api/projects/${sp.projectId}`)).body.profit.expected).not.toBeNull();
    expect((await field.get(`/api/quotes/${quoteId}`)).status).toBe(200);
    expect((await field.get(`/api/finance/entries?projectId=${sp.projectId}`)).status).toBe(200);
  });
  it('only the draft owner (from user) or the admin can send a draft', async () => {
    const t = await newTenant('sec-draft-own');
    const admin = client(T.app, await login(T.app, t.users.admin.email));
    const clerk = client(T.app, await login(T.app, t.users.clerk.email));
    const ops = client(T.app, await login(T.app, t.users.ops.email));
    const mk = async () => (await ownerSql(
      `INSERT INTO message_drafts (tenant_id, kind, body, subject, to_address, from_user_id) VALUES ($1, 'other', 'Merhaba', 'Konu', 'musteri@example.com', $2) RETURNING id`,
      [t.tenantId, t.users.clerk.id]))[0].id;
    const d1 = await mk();
    const r = await ops.post(`/api/drafts/${d1}/send`);
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('DRAFT_NOT_OWNER');
    expect((await clerk.post(`/api/drafts/${d1}/send`)).body.status).toBe('sent');
    expect((await admin.post(`/api/drafts/${await mk()}/send`)).body.status).toBe('sent');
  });
});

describe('§15 × §16 automation product decisions (neverAutomateKinds, outboundAutoSendRequiresStandingApproval)', () => {
  it('customer quote approval is never auto-executed nor proposed for promotion; promotion refused; rule validated', async () => {
    const t = await newTenant('sec-auto');
    const admin = client(T.app, await login(T.app, t.users.admin.email));
    const clerk = client(T.app, await login(T.app, t.users.clerk.email));
    expect((await admin.get('/api/rules')).body.neverAutomateKinds).toEqual(expect.arrayContaining(['customer_quote', 'quote_approval', 'margin_override']));
    expect((await admin.get('/api/rules')).body.outboundAutoSendRequiresStandingApproval).toBe(false);
    // counter forced into auto mode (as if promoted earlier) and a promotion threshold of 1
    await ownerSql(`INSERT INTO automation_counters (tenant_id, action_type, threshold, sample_rate, mode) VALUES ($1, 'customer_quote', 1, 0.05, 'auto')
                    ON CONFLICT (tenant_id, action_type) DO UPDATE SET mode = 'auto', threshold = 1`, [t.tenantId]);
    const q = await quotableProject(clerk, t, 'new');
    const quote = await clerk.post(`/api/projects/${q.projectId}/quotes`, twoOptions(q));
    expect(quote.body.status).toBe('pending_approval'); // not auto-approved by AI
    const dec = (await admin.get('/api/decisions')).body.items.find((d: any) => d.kind === 'quote_approval' && d.entityId === quote.body.id);
    expect(dec.requiresBiometric).toBe(true);
    await ownerSql(`UPDATE automation_counters SET mode = 'approval', consecutive_clean = 0 WHERE tenant_id = $1 AND action_type = 'customer_quote'`, [t.tenantId]);
    const ok = await admin.post(`/api/decisions/${dec.id}/decide`, { action: 'approve', biometric: { method: 'dev' } });
    expect(ok.status).toBe(200);
    expect(ok.body.effects.some((e: string) => e.startsWith('automation_promotion_proposed'))).toBe(false);
    expect((await admin.get('/api/decisions')).body.items.some((d: any) => d.kind === 'automation_promotion' && d.detail.actionType === 'customer_quote')).toBe(false);
    // an (old) promotion card for it cannot be applied either
    const [promo] = await ownerSql(
      `INSERT INTO decisions (tenant_id, kind, badge, summary, detail, required_role, primary_action_label) VALUES ($1, 'automation_promotion', 'suggestion', 'x', '{"actionType":"customer_quote"}', 'admin', 'Otomatiğe al') RETURNING id`, [t.tenantId]);
    expect((await admin.post(`/api/decisions/${promo.id}/decide`, { action: 'approve' })).body.error.code).toBe('NOT_PROMOTABLE');
    // rule validation
    expect((await admin.patch('/api/rules', { neverAutomateKinds: ['customer_quote', 42] })).body.error.code).toBe('INVALID_RULE_VALUE');
    expect((await admin.patch('/api/rules', { neverAutomateKinds: 'customer_quote' })).body.error.code).toBe('INVALID_RULE_VALUE');
    expect((await clerk.patch('/api/rules', { neverAutomateKinds: [] })).status).toBe(403);
  });
});

describe('G-20 worker leader lock (multi-instance)', () => {
  it('only one lock holder; standby takes over after release; runIfLeader returns null when standby', async () => {
    const a = createLeaderLock(getPool(), '991001');
    const b = createLeaderLock(getPool(), '991001');
    expect(await a.acquire()).toBe(true);
    expect(await a.acquire()).toBe(true); // re-entrant for the holder
    expect(await b.acquire()).toBe(false);
    expect(b.held).toBe(false);
    expect(await runIfLeader(b, T.app.deps)).toBeNull();
    await a.release();
    expect(a.held).toBe(false);
    expect(await b.acquire()).toBe(true);
    expect(await a.acquire()).toBe(false);
    await b.release();
    const held = await ownerSql(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND objid = 991001`);
    expect(held[0].n).toBe(0);
  });
});

describe('G-21 rate-limit store', () => {
  it('memory store by default; RATE_LIMIT_REDIS_URL without the optional ioredis package fails loudly', async () => {
    expect(await rateLimitStore(T.app)).toEqual({});
    const fake = { deps: { config: { rateLimitRedisUrl: 'redis://127.0.0.1:1' } }, addHook: () => {} } as never;
    let ioredis = true;
    try {
      await import('ioredis' as string);
    } catch {
      ioredis = false;
    }
    if (!ioredis) await expect(rateLimitStore(fake)).rejects.toThrow(/ioredis/);
    expect(loadConfig({ NODE_ENV: 'test', RATE_LIMIT_REDIS_URL: ' redis://r:6379 ' }).rateLimitRedisUrl).toBe('redis://r:6379');
    expect(loadConfig({ NODE_ENV: 'test' }).rateLimitRedisUrl).toBeNull();
  });
});
