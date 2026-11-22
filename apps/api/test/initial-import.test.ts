// §8 İlk veri yükü: upload → staging → validation → manual verification → commit (admin only, one transaction, audited);
// historical projects stay out of active lists / worker but feed similar projects, price medians and rule suggestions.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runFollowupsOnce } from '../src/worker.js';
import { appSql, client, closeApp, login, makeApp, newTenant, ownerSql, quotableProject, type Client, type TestApp } from './helpers.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'import');
const fixture = (n: string) => readFileSync(path.join(FIX, `${n}.csv`), 'utf8');
const ENTITIES = ['suppliers', 'customers', 'projects', 'service_lines', 'price_points', 'channel_prices'] as const;

let T: TestApp;
let t: Awaited<ReturnType<typeof newTenant>>;
let tb: Awaited<ReturnType<typeof newTenant>>;
let admin: Client;
let clerk: Client;
let adminB: Client;
let adminToken: string;
let batchId: string;
let hallItemId: string;
let projectIdLive: string;
let sampleBefore = 0;

const codes = (row: any) => row.issues.map((i: any) => i.code);
const find = (detail: any, entity: string, rowNo: number) => detail.rows.find((r: any) => r.entity === entity && r.rowNo === rowNo);

function multipart(fields: Record<string, string>, file: { name: string; type: string; data: Buffer }) {
  const boundary = '----miceimp' + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`), file.data, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, authorization: `Bearer ${adminToken}` } };
}

beforeAll(async () => {
  T = await makeApp();
  t = await newTenant('imp');
  tb = await newTenant('impb');
  adminToken = await login(T.app, t.users.admin.email);
  admin = client(T.app, adminToken);
  clerk = client(T.app, await login(T.app, t.users.clerk.email));
  adminB = client(T.app, await login(T.app, tb.users.admin.email));
  // a live project with a hall offer: comparison median before the import
  const q = await quotableProject(admin, t, 'new');
  projectIdLive = q.projectId;
  hallItemId = q.hallItemId;
  const cmp = await admin.get(`/api/items/${hallItemId}/comparison`);
  sampleBefore = cmp.body.evaluations[0].benchmark.sampleSize;
});
afterAll(async () => closeApp(T));

describe('§8 initial import — access', () => {
  it('non-admin roles are forbidden everywhere', async () => {
    expect((await clerk.get('/api/import/batches')).status).toBe(403);
    expect((await clerk.post('/api/import/batches', {})).status).toBe(403);
    expect((await clerk.get('/api/import/templates/suppliers')).status).toBe(403);
    const b = await admin.post('/api/import/batches', { label: 'x' });
    expect((await clerk.post(`/api/import/batches/${b.body.id}/commit`)).status).toBe(403);
    expect((await clerk.post(`/api/import/batches/${b.body.id}/files`, { entity: 'suppliers', csv: fixture('suppliers') })).status).toBe(403);
    await admin.post(`/api/import/batches/${b.body.id}/abandon`, { reason: 'test' });
  });

  it('templates download as XLSX (header + example) and CSV', async () => {
    const r = await T.app.inject({ method: 'GET', url: '/api/import/templates/service_lines', headers: { authorization: `Bearer ${adminToken}` } });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('spreadsheetml');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.rawPayload as unknown as ArrayBuffer);
    const header = (wb.worksheets[0].getRow(1).values as unknown[]).slice(1);
    expect(header).toContain('Birim alış (KDV hariç)');
    const csv = await T.app.inject({ method: 'GET', url: '/api/import/templates/projects?format=csv', headers: { authorization: `Bearer ${adminToken}` } });
    expect(csv.body).toContain('Proje kodu;');
  });
});

describe('§8 initial import — staging, validation, manual verification, commit', () => {
  it('upload parses TR formats and validates every row (ok / warning / error)', async () => {
    batchId = (await admin.post('/api/import/batches', { label: 'İlk yük' })).body.id;
    let d: any;
    for (const e of ENTITIES) {
      const r = await admin.post(`/api/import/batches/${batchId}/files`, { entity: e, fileName: `${e}.csv`, csv: fixture(e) });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      d = r.body;
    }
    expect(d.files).toHaveLength(6);
    // suppliers
    expect(find(d, 'suppliers', 2).status).toBe('ok');
    expect(codes(find(d, 'suppliers', 3))).toContain('EXISTING_RECORD'); // Moda → link
    expect(find(d, 'suppliers', 4).data).toMatchObject({ status: 'candidate', accredit: false });
    expect(codes(find(d, 'suppliers', 4))).toContain('ACCREDITATION_REVIEW');
    expect(find(d, 'suppliers', 5).status).toBe('error');
    expect(codes(find(d, 'suppliers', 5))).toEqual(expect.arrayContaining(['INVALID_VKN', 'UNKNOWN_KIND']));
    // customers
    expect(find(d, 'customers', 2).status).toBe('ok');
    expect(find(d, 'customers', 3).resolved.existingId).toBe(t.customers.new);
    // projects: 18-month window, not closed
    expect(find(d, 'projects', 2).status).toBe('ok');
    expect(find(d, 'projects', 3).data).toMatchObject({ outcome: 'lost', lostReason: 'Fiyat yüksek bulundu', closedDate: '2025-09-20' });
    expect(codes(find(d, 'projects', 4))).toContain('OUT_OF_WINDOW');
    expect(codes(find(d, 'projects', 5))).toContain('NOT_CLOSED');
    // service lines: TR numbers, supplier by VKN (staged), cost ≤ sale, unresolved project
    const hall = find(d, 'service_lines', 3);
    expect(hall.data).toMatchObject({ kind: 'hall', unit: 'day', unitCost: 2900, unitSale: 3480, dateFrom: '2026-03-10' });
    expect(hall.resolved.supplier.stagedRowId).toBe(find(d, 'suppliers', 2).id);
    expect(codes(find(d, 'service_lines', 4))).toContain('COST_ABOVE_SALE');
    expect(find(d, 'service_lines', 4).status).toBe('warning');
    expect(codes(find(d, 'service_lines', 6))).toContain('PROJECT_NOT_FOUND');
    // price points / channel
    expect(find(d, 'price_points', 2).data.price).toBe(2800);
    expect(codes(find(d, 'price_points', 4))).toContain('OUT_OF_WINDOW');
    expect(find(d, 'channel_prices', 2).status).toBe('ok');
    expect(d.batch.summary.windowMonths).toBe(18);
    expect(d.batch.summary.error).toBe(5);
  });

  it('re-uploading the identical file into the batch is idempotent', async () => {
    const before = (await admin.get(`/api/import/batches/${batchId}`)).body.rows.length;
    const r = await admin.post(`/api/import/batches/${batchId}/files`, { entity: 'customers', fileName: 'customers.csv', csv: fixture('customers') });
    expect(r.body.rows.length).toBe(before);
    expect(r.body.files.filter((f: any) => f.entity === 'customers')).toHaveLength(1);
  });

  it('nothing goes live until a human approves: commit refused while rows are pending; error rows cannot be approved', async () => {
    const c = await admin.post(`/api/import/batches/${batchId}/commit`);
    expect(c.status).toBe(409);
    expect(c.body.error.code).toBe('ROWS_PENDING');
    const d = (await admin.get(`/api/import/batches/${batchId}`)).body;
    const bad = await admin.post(`/api/import/batches/${batchId}/review`, { action: 'approve', rowIds: [find(d, 'suppliers', 5).id] });
    expect(bad.status).toBe(409);
    expect(bad.body.error.code).toBe('ROW_HAS_ERRORS');
    expect((await ownerSql(`SELECT count(*)::int AS n FROM suppliers WHERE tenant_id = $1 AND name = 'Kuzguncuk Konak Otel'`, [t.tenantId]))[0].n).toBe(0);
    expect((await ownerSql(`SELECT count(*)::int AS n FROM projects WHERE tenant_id = $1 AND historical`, [t.tenantId]))[0].n).toBe(0);
  });

  it('inline edit revalidates and resets review; rejecting a referenced row turns dependents into errors', async () => {
    let d = (await admin.get(`/api/import/batches/${batchId}`)).body;
    const badRow = find(d, 'suppliers', 5);
    d = (await admin.patch(`/api/import/rows/${badRow.id}`, { input: { vkn: '', kinds: 'salon' } })).body;
    expect(find(d, 'suppliers', 5).status).toBe('ok');
    expect(find(d, 'suppliers', 5).review).toBe('pending');
    d = (await admin.post(`/api/import/batches/${batchId}/review`, { action: 'reject', rowIds: [badRow.id] })).body;
    expect(find(d, 'suppliers', 5).review).toBe('rejected');
    // admin accredits Beykoz in review (goes through the decision box at commit)
    d = (await admin.patch(`/api/import/rows/${find(d, 'suppliers', 4).id}`, { input: { accredit: true } })).body;
    expect(find(d, 'suppliers', 4).data.accredit).toBe(true);
    // reject the customer → its project (and the project's lines) become errors; reset brings them back
    const cust = find(d, 'customers', 2);
    d = (await admin.post(`/api/import/batches/${batchId}/review`, { action: 'reject', rowIds: [cust.id] })).body;
    expect(codes(find(d, 'projects', 2))).toContain('CUSTOMER_NOT_USABLE');
    expect(codes(find(d, 'service_lines', 2))).toContain('PROJECT_NOT_USABLE');
    d = (await admin.post(`/api/import/batches/${batchId}/review`, { action: 'reset', rowIds: [cust.id] })).body;
    expect(find(d, 'projects', 2).status).toBe('ok');
  });

  it('bulk approve + commit writes approved rows into the live tables in one audited transaction', async () => {
    const ap = await admin.post(`/api/import/batches/${batchId}/review`, { action: 'approve', statuses: ['ok', 'warning'] });
    expect(ap.body.batch.summary.pending).toBe(4); // only the error rows remain unreviewed (they are excluded)
    const c = await admin.post(`/api/import/batches/${batchId}/commit`);
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    expect(c.body.batch.status).toBe('committed');
    expect(c.body.batch.summary.committed).toMatchObject({
      suppliers: { created: 2, linked: 1 }, customers: { created: 1, linked: 1 }, projects: { created: 2, linked: 0 },
      service_lines: { created: 4, linked: 0 }, price_points: { created: 2, linked: 0 }, channel_prices: { created: 2, linked: 0 },
    });
    const sup = await ownerSql(`SELECT * FROM suppliers WHERE tenant_id = $1 AND name IN ('Kuzguncuk Konak Otel','Beykoz Koru Otel','Moda Sahil Otel') ORDER BY name`, [t.tenantId]);
    expect(sup).toHaveLength(3); // Moda linked, not duplicated
    const kuz = sup.find((s) => s.name === 'Kuzguncuk Konak Otel')!;
    expect(kuz).toMatchObject({ status: 'candidate', tax_number: '4445556667', import_batch_id: batchId });
    const bey = sup.find((s) => s.name === 'Beykoz Koru Otel')!;
    expect(bey.status).toBe('accredited');
    expect(bey.accredited_by).toBe(t.users.admin.id);
    const dec = await ownerSql(`SELECT * FROM decisions WHERE tenant_id = $1 AND kind = 'supplier_accreditation' AND entity_id = $2`, [t.tenantId, bey.id]);
    expect(dec[0]).toMatchObject({ status: 'approved', decided_by: t.users.admin.id });
    const proj = await ownerSql(`SELECT * FROM projects WHERE tenant_id = $1 AND historical ORDER BY code`, [t.tenantId]);
    expect(proj.map((p) => [p.code, p.outcome])).toEqual([['H-2025-101', 'closed'], ['H-2025-102', 'lost']]);
    expect(proj[0].closed_at).not.toBeNull();
    expect(proj[0].seq).toBeLessThan(0);
    expect(Number(proj[0].historical_sale_eur)).toBeGreaterThan(Number(proj[0].historical_cost_eur));
    expect(proj[1].lost_reason).toBe('Fiyat yüksek bulundu');
    const audit = await ownerSql(`SELECT * FROM audit_log WHERE tenant_id = $1 AND entity = 'projects' AND entity_id = $2 AND action = 'insert'`, [t.tenantId, proj[0].id]);
    expect(audit[0]).toMatchObject({ actor_type: 'user', actor_id: t.users.admin.id });
    expect(audit[0].after.import_batch_id).toBe(batchId);
    const ph = await ownerSql(`SELECT price_type, count(*)::int AS n FROM price_history WHERE tenant_id = $1 AND import_batch_id = $2 GROUP BY price_type ORDER BY price_type`, [t.tenantId, batchId]);
    // won project: 2 Kuzguncuk lines + transfer (supplier resolved) realized; lost project line negotiated; 2 price points realized
    expect(ph).toEqual([{ price_type: 'negotiated', n: 1 }, { price_type: 'realized', n: 5 }]);
    const rows = (await admin.get(`/api/import/batches/${batchId}`)).body.rows;
    expect(rows.filter((r: any) => r.committedEntityId).length).toBe(15);
    expect(rows.filter((r: any) => r.status === 'error').every((r: any) => !r.committedEntityId)).toBe(true);
  });

  it('historical projects never show in active lists, inbox or worker jobs', async () => {
    const list = (await admin.get('/api/projects')).body.items;
    expect(list.some((p: any) => p.code.startsWith('H-'))).toBe(false);
    const only = (await admin.get('/api/projects?historical=only')).body.items;
    expect(only.map((p: any) => p.code).sort()).toEqual(['H-2025-101', 'H-2025-102']);
    expect(only.every((p: any) => p.historical)).toBe(true);
    expect((await admin.get(`/api/projects/${only[0].id}`)).status).toBe(200);
    const ids = only.map((p: any) => p.id);
    await runFollowupsOnce(T.app.deps, new Date('2026-11-20T16:00:00Z'));
    await runFollowupsOnce(T.app.deps, new Date('2026-12-25T16:00:00Z'));
    expect((await ownerSql(`SELECT count(*)::int AS n FROM tasks WHERE project_id = ANY($1)`, [ids]))[0].n).toBe(0);
    expect((await ownerSql(`SELECT count(*)::int AS n FROM decisions WHERE project_id = ANY($1)`, [ids]))[0].n).toBe(0);
    expect((await ownerSql(`SELECT count(*)::int AS n FROM message_drafts WHERE project_id = ANY($1)`, [ids]))[0].n).toBe(0);
    const inbox = (await admin.get('/api/decisions')).body.items;
    expect(inbox.some((d: any) => ids.includes(d.projectId))).toBe(false);
    const weekly = await admin.get('/api/reports/weekly?weekStart=2026-11-16');
    expect(weekly.body.quotes.lost).toBe(0);
  });

  it('feeds similar projects (know-how) and the comparison history median', async () => {
    const sim = (await admin.get(`/api/projects/${projectIdLive}/similar`)).body.items;
    const lost = sim.find((s: any) => s.code === 'H-2025-102');
    expect(lost).toMatchObject({ outcome: 'lost', lostReason: 'Fiyat yüksek bulundu' });
    expect(lost.totalSaleEur).toBe(3700);
    const won = sim.find((s: any) => s.code === 'H-2025-101');
    expect(won.margin).toBeGreaterThan(0);
    const cmp = await admin.get(`/api/items/${hallItemId}/comparison`);
    // 3 imported hall prices (2 lines + 1 price point) join the İstanbul / day history
    expect(cmp.body.evaluations[0].benchmark.sampleSize).toBe(sampleBefore + 3);
  });

  it('re-import is idempotent: closed batch, duplicate file, duplicate rows vs live data', async () => {
    expect((await admin.post(`/api/import/batches/${batchId}/commit`)).body.error.code).toBe('BATCH_CLOSED');
    const b2 = (await admin.post('/api/import/batches', { label: 'tekrar' })).body.id;
    const same = await admin.post(`/api/import/batches/${b2}/files`, { entity: 'projects', csv: fixture('projects') });
    expect(same.status).toBe(409);
    expect(same.body.error.code).toBe('DUPLICATE_FILE');
    let d: any;
    for (const e of ['suppliers', 'projects', 'price_points', 'channel_prices'] as const) {
      d = (await admin.post(`/api/import/batches/${b2}/files`, { entity: e, csv: fixture(e) + '\n' })).body; // different bytes, same rows
    }
    expect(codes(find(d, 'projects', 2))).toContain('ALREADY_IMPORTED');
    expect(codes(find(d, 'price_points', 2))).toContain('ALREADY_IMPORTED');
    expect(codes(find(d, 'channel_prices', 3))).toContain('ALREADY_IMPORTED');
    expect(find(d, 'suppliers', 2).resolved.existingId).toBeTruthy();
    // abandon (no deletes): status only; afterwards no further changes
    const ab = await admin.post(`/api/import/batches/${b2}/abandon`, { reason: 'mükerrer' });
    expect(ab.body.status).toBe('abandoned');
    expect((await admin.post(`/api/import/batches/${b2}/files`, { entity: 'customers', csv: fixture('customers') })).body.error.code).toBe('BATCH_CLOSED');
    expect((await admin.del(`/api/import/batches/${b2}`)).status).toBe(404);
    await expect(appSql(t.tenantId, 'DELETE FROM import_batches WHERE id = $1', [b2])).rejects.toThrow();
  });

  it('window is a rule: widening initialImportWindowMonths accepts the older project after revalidation', async () => {
    const b3 = (await admin.post('/api/import/batches', {})).body.id;
    const csv = 'Proje kodu;Müşteri;Başlangıç;Sonuç\n2024-777;Anadolu İlaç;10.01.2025;kazanıldı\n';
    let d = (await admin.post(`/api/import/batches/${b3}/files`, { entity: 'projects', csv })).body;
    expect(codes(d.rows[0])).toContain('OUT_OF_WINDOW');
    expect((await admin.patch('/api/rules', { initialImportWindowMonths: 24, reason: 'test' })).status).toBe(200);
    d = (await admin.post(`/api/import/batches/${b3}/revalidate`)).body;
    expect(d.rows[0].status).toBe('ok');
    await admin.patch('/api/rules', { initialImportWindowMonths: 18 });
    await admin.post(`/api/import/batches/${b3}/abandon`, {});
  });

  it('XLSX upload (zip guard + exceljs, Date / number cells) feeds the rule-suggestion generator', async () => {
    const wbPrice = new ExcelJS.Workbook();
    const ws = wbPrice.addWorksheet('Fiyatlar');
    ws.addRow(['Tedarikçi', 'Hizmet tarihi', 'Tür', 'Birim', 'Birim fiyat (KDV hariç)', 'Para birimi', 'Oda tipi', 'Pansiyon', 'İptal koşulu']);
    const wbCh = new ExcelJS.Workbook();
    const wc = wbCh.addWorksheet('Kanal');
    wc.addRow(['Tedarikçi', 'Konaklama tarihi', 'Oda tipi', 'Pansiyon', 'İptal koşulu', 'Fiyat', 'Para birimi']);
    for (let i = 0; i < 7; i++) {
      const day = new Date(Date.UTC(2026, 0, 5 + i * 3));
      ws.addRow(['Kalamış Marina Hotel', day, 'konaklama', 'oda/gece', 120.5, 'EUR', 'DBL', 'BB', 'esnek']);
      wc.addRow(['Kalamış Marina Hotel', day, 'DBL', 'BB', 'esnek', 165, 'EUR']);
    }
    const b4 = (await admin.post('/api/import/batches', { label: 'xlsx' })).body.id;
    for (const [entity, wb] of [['price_points', wbPrice], ['channel_prices', wbCh]] as const) {
      const mp = multipart({ entity }, { name: `${entity}.xlsx`, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', data: Buffer.from(await wb.xlsx.writeBuffer()) });
      const r = await T.app.inject({ method: 'POST', url: `/api/import/batches/${b4}/files`, ...mp });
      expect(r.statusCode, r.body).toBe(200);
    }
    const d = (await admin.get(`/api/import/batches/${b4}`)).body;
    expect(d.rows.every((r: any) => r.status === 'ok')).toBe(true);
    expect(d.rows.find((r: any) => r.entity === 'price_points').data).toMatchObject({ date: '2026-01-05', price: 120.5 });
    await admin.post(`/api/import/batches/${b4}/review`, { action: 'approve', statuses: ['ok'] });
    expect((await admin.post(`/api/import/batches/${b4}/commit`)).status).toBe(200);
    const run = await admin.post('/api/rules/suggestions/run');
    expect(run.status).toBe(200);
    const cards = await ownerSql(`SELECT detail FROM decisions WHERE tenant_id = $1 AND kind = 'rule_suggestion' AND status = 'open'`, [t.tenantId]);
    expect(cards.some((c) => JSON.stringify(c.detail).includes(t.suppliers.kalamis))).toBe(true);
  });

  it('a zip bomb / non-xlsx is refused before exceljs', async () => {
    const b5 = (await admin.post('/api/import/batches', {})).body.id;
    const mp = multipart({ entity: 'suppliers' }, { name: 'x.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', data: Buffer.from('not a zip') });
    const r = await T.app.inject({ method: 'POST', url: `/api/import/batches/${b5}/files`, ...mp });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('UNSAFE_ARCHIVE');
    const miss = await admin.post(`/api/import/batches/${b5}/files`, { entity: 'projects', csv: 'Proje kodu;Başlık\nX;Y\n' });
    expect(miss.body.error.code).toBe('MISSING_COLUMNS');
    await admin.post(`/api/import/batches/${b5}/abandon`, {});
  });
});

describe('§8 initial import — tenant isolation', () => {
  it('staging data is invisible to another tenant (API 404, RLS 0 rows, no context → 0)', async () => {
    expect((await adminB.get(`/api/import/batches/${batchId}`)).status).toBe(404);
    expect((await adminB.get('/api/import/batches')).body.items.some((b: any) => b.id === batchId)).toBe(false);
    expect((await adminB.post(`/api/import/batches/${batchId}/commit`)).status).toBe(404);
    const a = await appSql(t.tenantId, 'SELECT count(*)::int AS n FROM import_rows');
    expect(a[0].n).toBeGreaterThan(0);
    expect((await appSql(tb.tenantId, 'SELECT count(*)::int AS n FROM import_rows WHERE batch_id = $1', [batchId]))[0].n).toBe(0);
    expect((await appSql(null, 'SELECT count(*)::int AS n FROM import_batches'))[0].n).toBe(0);
    await expect(appSql(tb.tenantId, `INSERT INTO import_batches (tenant_id, created_by) VALUES ($1, $2)`, [t.tenantId, t.users.admin.id])).rejects.toThrow();
  });
});

describe('§8 initial import — finansal hareketler (Q5: kanıtlı EUR + TL kâr)', () => {
  it('movements with their actual rates give the historical project evidence-based EUR + TL profit; without a rate → "kur kanıtı yok"', async () => {
    const b = (await admin.post('/api/import/batches', { label: 'fx' })).body;
    const up = (entity: string, csv: string) => admin.post(`/api/import/batches/${b.id}/files`, { entity, fileName: `${entity}.csv`, csv });
    expect((await up('customers', 'Müşteri adı;VKN\nKur Test A.Ş.;9998887776\n')).status).toBe(200);
    await up('projects', [
      'Proje kodu;Müşteri;Başlangıç;Bitiş;Sonuç',
      'FX-1;Kur Test A.Ş.;10.03.2026;12.03.2026;kazanıldı',
      'FX-2;Kur Test A.Ş.;10.04.2026;12.04.2026;kazanıldı',
    ].join('\n'));
    await up('service_lines', [
      'Proje kodu;Tür;Açıklama;Miktar;Birim;Para birimi;Birim alış (KDV hariç);Birim satış (KDV hariç)',
      'FX-1;salon;Salon;1;gün;EUR;8000;10000',
      'FX-2;salon;Salon;1;gün;EUR;8000;10000',
    ].join('\n'));
    const d = (await up('finance_movements', [
      'Proje kodu;Hareket türü;Tarih (valör);Tutar;Para birimi;Kur (1 EUR = ? TL);TL karşılığı;EUR karşılığı;Belge no;Kapattığı fatura no',
      'FX-1;müşteri faturası;12.03.2026;10.000,00;EUR;36,00;;;SF-1;',
      'FX-1;tahsilat;20.03.2026;370.000,00;TL;;;10.000,00;DK-1;SF-1',
      'FX-1;tedarikçi faturası;12.03.2026;288.000,00;TL;36,00;;;AF-1;',
      'FX-1;ödeme;25.03.2026;288.000,00;TL;38,40;;;DK-2;AF-1',
      'FX-1;tahsilat;20.12.2026;1,00;EUR;;;;;',
    ].join('\n'))).body;
    const mv = d.rows.filter((r: any) => r.entity === 'finance_movements');
    expect(mv[1].data).toMatchObject({ type: 'collection', currency: 'TRY', eurTryRate: 37, eurRate: 37 });
    expect(codes(mv[4])).toContain('FUTURE_DATE');
    await admin.post(`/api/import/batches/${b.id}/review`, { action: 'approve', statuses: ['ok', 'warning'] });
    await admin.post(`/api/import/batches/${b.id}/review`, { action: 'reject', rowIds: [mv[4].id] });
    const c = await admin.post(`/api/import/batches/${b.id}/commit`);
    expect(c.status).toBe(200);
    expect(c.body.batch.summary.committed.finance_movements).toEqual({ created: 4, linked: 0 });
    const [p1] = await ownerSql(`SELECT id, historical_cost_eur, historical_sale_eur FROM projects WHERE tenant_id = $1 AND source_ref = 'FX1'`, [t.tenantId]);
    const r = (await admin.get(`/api/projects/${p1.id}/realized-fx`)).body;
    expect(r.status).toBe('complete');
    expect(r.revenue).toEqual({ eur: 10000, try: 370000 });
    expect(r.cost).toEqual({ eur: 7500, try: 288000 });
    expect(r.profit).toEqual({ eur: 2500, try: 82000 });
    expect(r.evidence.every((e: any) => ['import'].includes(e.rateSource))).toBe(true);
    // historical totals come from the evidence, not from today's FX of the lines
    expect(Number(p1.historical_cost_eur)).toBe(7500);
    expect(Number(p1.historical_sale_eur)).toBe(10000);
    // imported entries are closed bookkeeping: never bank-match candidates, never re-exported to Mikro
    expect((await ownerSql(`SELECT count(*)::int AS n FROM finance_entries WHERE project_id = $1 AND (status <> 'matched' OR invoice_no IS NOT NULL)`, [p1.id]))[0].n).toBe(0);
    // FX-2 without movements: current behaviour, flagged "kur kanıtı yok"
    const [p2] = await ownerSql(`SELECT id FROM projects WHERE tenant_id = $1 AND source_ref = 'FX2'`, [t.tenantId]);
    const r2 = (await admin.get(`/api/projects/${p2.id}/realized-fx`)).body;
    expect(r2.status).toBe('none');
    expect(r2.reasons.map((x: any) => x.code)).toEqual(['no_movements', 'no_fx_evidence']);
  });
});
