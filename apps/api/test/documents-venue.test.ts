// Phase B completion — project code venue segment (§5), program / rooming list / realized P&L documents (§3.1, §3.5, §17.9).
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { client, closeApp, login, makeApp, newTenant, ownerSql, quotableProject, resetClock, twoOptions, type Client, type TestApp } from './helpers.js';
import { signedProject, type SignedProject } from './phase-b-helpers.js';

let T: TestApp;
let t: Awaited<ReturnType<typeof newTenant>>;
let admin: Client, clerk: Client, ops: Client, finance: Client;
let sp: SignedProject;
let adminToken = '';
let clerkToken = '';

async function xlsxText(app: TestApp['app'], token: string, url: string): Promise<{ status: number; headers: Record<string, unknown>; text: string }> {
  const r = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
  if (r.statusCode !== 200) return { status: r.statusCode, headers: r.headers, text: r.body };
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(r.rawPayload as unknown as ArrayBuffer);
  const lines: string[] = [];
  wb.worksheets[0].eachRow((row) => lines.push((row.values as unknown[]).slice(1).map((v) => (v == null ? '' : String(v))).join('|')));
  return { status: 200, headers: r.headers, text: lines.join('\n') };
}

beforeAll(async () => {
  T = await makeApp();
  t = await newTenant('docs');
  adminToken = await login(T.app, t.users.admin.email);
  clerkToken = await login(T.app, t.users.clerk.email);
  admin = client(T.app, adminToken);
  clerk = client(T.app, clerkToken);
  ops = client(T.app, await login(T.app, t.users.ops.email));
  finance = client(T.app, await login(T.app, t.users.finance.email));
  resetClock();
  sp = await signedProject(T.app, admin, t);
});
beforeEach(() => resetClock());
afterAll(() => closeApp(T));

describe('project code venue segment (§5)', () => {
  it('selecting the accommodation offer sets venue_name and regenerates the venue segment; PRJ-#### stays, old code in audit', async () => {
    const q = await quotableProject(clerk, t, 'new');
    const p = (await clerk.get(`/api/projects/${q.projectId}`)).body.project;
    expect(p.venueName).toBe('Moda Sahil Otel');
    expect(p.code).toMatch(/^PRJ-\d{4}-.*-MODASAHILOTEL$/);
    const audits = await ownerSql(`SELECT before->>'code' AS old, after->>'code' AS new FROM audit_log WHERE entity = 'projects' AND entity_id = $1 AND before->>'code' IS DISTINCT FROM after->>'code' AND action = 'update'`, [q.projectId]);
    expect(audits.length).toBeGreaterThan(0);
    expect(audits[0].old).toMatch(/-TBD$/);
    expect(audits[0].old.split('-').slice(0, 2).join('-')).toBe(p.code.split('-').slice(0, 2).join('-')); // same PRJ-#### sequence
    // a manual venue (PATCH) also regenerates the segment
    const patched = await clerk.patch(`/api/projects/${q.projectId}`, { venueName: 'Kalamış Marina Otel', billingInfo: 'Anadolu İlaç A.Ş., Şişli VD 1112223334' });
    expect(patched.body.code).toMatch(/-80-KALAMISMARINAO$/);
    expect(patched.body.billingInfo).toMatch(/Şişli VD/);
  });
});

describe('billing info fixed in the project (Overview) un-blocks an agency-template contract', () => {
  it('empty billing field → contract diff; PATCH project billingInfo → re-compare fills it → clean', async () => {
    const q = await quotableProject(admin, t, 'new');
    await ownerSql('UPDATE projects SET customer_id = NULL, billing_info = NULL WHERE id = $1', [q.projectId]);
    const quote = await admin.post(`/api/projects/${q.projectId}/quotes`, twoOptions(q));
    const sent = await admin.post(`/api/quotes/${quote.body.id}/send`);
    expect(sent.status).toBe(200);
    await client(T.app).post(`/api/public/quotes/${sent.body.approvalLink.split('/q/')[1]}/accept`, { optionNo: 1, approverName: 'Müşteri' });
    const c = await admin.post(`/api/projects/${q.projectId}/contracts`, { supplierId: t.suppliers.moda, serviceItemIds: [q.accItemId, q.hallItemId], template: 'agency' });
    const first = await admin.post(`/api/contracts/${c.body.id}/compare`);
    expect(first.body.status).toBe('diff_pending');
    expect(first.body.diff.some((d: any) => d.field === 'billingInfo')).toBe(true);
    await clerk.patch(`/api/projects/${q.projectId}`, { billingInfo: 'Yeni Müşteri A.Ş., Beşiktaş VD 1231231231' });
    const second = await admin.post(`/api/contracts/${c.body.id}/compare`);
    expect(second.body.fields.billingInfo).toMatch(/Beşiktaş VD/);
    expect(second.body.diff.some((d: any) => d.field === 'billingInfo')).toBe(false);
    expect(second.body.status).toBe('clean');
  });
});

describe('documents generated from data (program, rooming list, realized P&L)', () => {
  it('program: per event day with the items; stale on item change; regenerate', async () => {
    const r = await clerk.post(`/api/projects/${sp.projectId}/documents`, { kind: 'program' });
    expect(r.status).toBe(200);
    expect(r.body.kind).toBe('program');
    expect(r.body.downloadUrl).toBeTruthy();
    const days = r.body.content.days as any[];
    expect(days.map((d) => d.date)).toEqual(['2027-03-12', '2027-03-13', '2027-03-14']);
    expect(days[0].entries.some((e: any) => e.kind === 'Konaklama' && e.supplier === 'Moda Sahil Otel')).toBe(true);
    const pdf = await T.app.inject({ method: 'GET', url: r.body.downloadUrl, headers: { authorization: `Bearer ${clerkToken}` } });
    expect(pdf.headers['content-type']).toBe('application/pdf');
    await admin.patch(`/api/items/${sp.hallItemId}`, { description: 'Salon (tiyatro, 90 kişi)' });
    const doc = (await clerk.get(`/api/projects/${sp.projectId}/documents`)).body.items.find((d: any) => d.kind === 'program');
    expect(doc.status).toBe('stale');
    const regen = await clerk.post(`/api/documents/${doc.id}/regenerate`);
    expect(regen.body.status).toBe('current');
    expect(regen.body.version).toBe(2);
  });

  it('rooming list: document keeps counts only; Excel template decrypts PII only for authorized roles; new guest → stale', async () => {
    expect((await clerk.post(`/api/projects/${sp.projectId}/documents`, { kind: 'rooming_list' })).body.error.code).toBe('NO_GUESTS');
    await ops.post(`/api/projects/${sp.projectId}/guests`, [
      { fullName: 'Zeynep Kaya', email: 'zeynep@example.com', phone: '+90 555 111 22 33', roomType: 'SGL', consentReuse: true },
      { fullName: 'Mert Demir', roomType: 'DBL' },
    ]);
    const doc = await ops.post(`/api/projects/${sp.projectId}/documents`, { kind: 'rooming_list' });
    expect(doc.body.content.guestCount).toBe(2);
    expect(doc.body.content.byRoomType).toEqual({ DBL: 1, SGL: 1 });
    expect(JSON.stringify(doc.body.content)).not.toMatch(/Zeynep|zeynep@/);
    const stored = await ownerSql(`SELECT content::text AS c, file_data IS NULL AS nofile FROM documents WHERE id = $1`, [doc.body.id]);
    expect(stored[0].c).not.toMatch(/Zeynep/);
    expect(stored[0].nofile).toBe(true);

    const asAdmin = await xlsxText(T.app, adminToken, `/api/projects/${sp.projectId}/rooming-list.xlsx`);
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.headers['x-pii-masked']).toBe('0');
    expect(asAdmin.text).toMatch(/Ad Soyad\|Oda Tipi\|Giriş\|Çıkış/);
    expect(asAdmin.text).toMatch(/Zeynep Kaya\|SGL\|2027-03-12\|2027-03-14\|2\|zeynep@example.com/);
    const asClerk = await xlsxText(T.app, clerkToken, `/api/projects/${sp.projectId}/rooming-list.xlsx`);
    expect(asClerk.headers['x-pii-masked']).toBe('1');
    expect(asClerk.text).not.toMatch(/Zeynep|zeynep@|555/);
    expect(asClerk.text).toMatch(/Misafir 1 \(SGL\) — \*\*\*/);

    await ops.post(`/api/projects/${sp.projectId}/guests`, [{ fullName: 'Ece Yıldız', roomType: 'SGL' }]);
    const after = (await ops.get(`/api/projects/${sp.projectId}/documents`)).body.items.find((d: any) => d.kind === 'rooming_list');
    expect(after.status).toBe('stale');
    expect((await ops.post(`/api/documents/${after.id}/regenerate`)).body.content.guestCount).toBe(3);
  });

  it('realized P&L: plan vs actual with margin and markup separately after a supplier invoice', async () => {
    const inv = await finance.post('/api/finance/supplier-invoices', { projectId: sp.projectId, supplierId: t.suppliers.moda, invoiceNo: 'MSO-DOC-1', amount: 9000, currency: 'EUR', vatAmount: 1000, issueDate: '2026-11-25', serviceItemIds: [sp.accItemId, sp.hallItemId] });
    expect(inv.status).toBe(200);
    const r = await finance.post(`/api/projects/${sp.projectId}/documents`, { kind: 'pnl' });
    expect(r.status).toBe(200);
    const real = r.body.content.realized;
    expect(real.planned.margin).toBeGreaterThan(0);
    expect(real.actual.costEur).toBe(9000);
    expect(real.planned).toHaveProperty('markup');
    expect(real.suppliers[0]).toMatchObject({ supplier: 'Moda Sahil Otel', invoicedEur: 9000 });
    // a new finance entry marks it stale
    await finance.post('/api/finance/customer-invoices', { projectId: sp.projectId, invoiceNo: 'SF-DOC-1', amount: 12000, currency: 'EUR' });
    const doc = (await finance.get(`/api/projects/${sp.projectId}/documents`)).body.items.find((d: any) => d.kind === 'pnl');
    expect(doc.status).toBe('stale');
    const regen = await finance.post(`/api/documents/${doc.id}/regenerate`);
    expect(regen.body.content.realized.actual.saleEur).toBe(12000);
    expect(regen.body.content.realized.actual.markup).toBeCloseTo(3000 / 9000, 3);
  });
});
