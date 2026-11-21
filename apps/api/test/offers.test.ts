// §7 Adım 2: AI offer reading (text / xlsx multipart), low-confidence review, verification (new version + correction),
// comparison (channel price / history median), negotiation drafts (allowed arguments, max rounds), WebAuthn options.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { client, closeApp, login, makeApp, newTenant, ownerSql, quotableProject, REQUEST_TEXT, type Client, type TestApp } from './helpers.js';

let T: TestApp;
let t: Awaited<ReturnType<typeof newTenant>>;
let admin: Client;
let clerk: Client;
let clerkToken: string;

const OFFER_TEXT = `Moda Sahil Otel olarak 12-14 Mart 2027 tarihli toplantınız için teklifimiz:
Oda (DBL, BB): 120 EUR x 25 oda x 2 gece
Oda (SGL, BB): 100 EUR x 30 oda x 2 gece
Fiyatlarımıza KDV dahil, konaklama vergisi hariçtir.
Opsiyon tarihi: 15.02.2027
Rezervasyon için %30 ön ödeme.`;

beforeAll(async () => {
  T = await makeApp();
  t = await newTenant('offers');
  admin = client(T.app, await login(T.app, t.users.admin.email));
  clerkToken = await login(T.app, t.users.clerk.email);
  clerk = client(T.app, clerkToken);
});
afterAll(() => closeApp(T));

function multipart(fields: Record<string, string>, file: { name: string; type: string; data: Buffer }) {
  const boundary = '----mice' + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`), file.data, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

describe('offers', () => {
  it('AI reads a mail offer (logged with confidence), verify → new version + correction; comparison uses channel prices', async () => {
    const intake = await clerk.post('/api/intake', { channel: 'email', body: REQUEST_TEXT });
    const item = (await clerk.get(`/api/projects/${intake.body.project.id}`)).body.items.find((i: any) => i.kind === 'accommodation');
    const r = await clerk.post(`/api/items/${item.id}/offers/parse`, { text: OFFER_TEXT, supplierId: t.suppliers.moda });
    expect(r.status).toBe(200);
    expect(r.body.lines.length).toBeGreaterThanOrEqual(2);
    expect(r.body.confidence).toBeGreaterThan(0);
    expect(r.body.version).toBe(1);
    const ai = await ownerSql(`SELECT * FROM ai_actions WHERE entity_type = 'supplier_offer' AND entity_id = $1`, [r.body.id]);
    expect(ai[0].action_type).toBe('document_reading');
    const hist = await ownerSql(`SELECT price_type FROM price_history WHERE offer_id = $1`, [r.body.id]);
    expect(hist.length).toBeGreaterThan(0);
    expect(hist[0].price_type).toBe('initial');

    const lines = r.body.lines.map((l: any) => ({ ...l, unitPrice: l.roomType === 'DBL' ? 118 : l.unitPrice }));
    const v = await clerk.post(`/api/offers/${r.body.id}/verify`, { lines });
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    expect(v.body.version).toBe(2);
    expect(v.body.verifiedBy).toBe(t.users.clerk.id);
    const corr = await ownerSql(`SELECT corrected, correction FROM ai_actions WHERE id = $1`, [ai[0].id]);
    expect(corr[0].corrected).toBe(true);
    expect((await clerk.post(`/api/offers/${r.body.id}/verify`, {})).body.error.code).toBe('OFFER_SUPERSEDED');

    const cmp = await clerk.get(`/api/items/${item.id}/comparison`);
    expect(cmp.status).toBe(200);
    expect(cmp.body.offers).toHaveLength(1);
    const ev = cmp.body.evaluations[0];
    expect(ev.benchmark.type).toBe('channel');
    expect(ev.normalized.totalNetExVatEur).toBeGreaterThan(0);
    expect(['good', 'normal']).toContain(ev.priceClass);
  });

  it('multipart xlsx upload is converted to CSV text and read; low confidence → review card for the team', async () => {
    const intake = await clerk.post('/api/intake', { channel: 'email', body: REQUEST_TEXT });
    const item = (await clerk.get(`/api/projects/${intake.body.project.id}`)).body.items.find((i: any) => i.kind === 'hall');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Teklif');
    ws.addRow(['Açıklama', 'Miktar', 'Birim fiyat', 'Para birimi']);
    ws.addRow(['Salon kirası', 2, 1500, 'EUR']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const mp = multipart({ supplierId: t.suppliers.kalamis }, { name: 'teklif.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', data: buf });
    const r = await T.app.inject({ method: 'POST', url: `/api/items/${item.id}/offers/parse`, payload: mp.payload, headers: { ...mp.headers, authorization: `Bearer ${clerkToken}` } });
    expect(r.statusCode).toBe(200);
    const offer = r.json();
    expect(offer.source).toBe('excel');
    const raw = await ownerSql(`SELECT raw_text FROM supplier_offers WHERE id = $1`, [offer.id]);
    expect(raw[0].raw_text).toContain('Salon kirası,2,1500,EUR');
    const files = await ownerSql(`SELECT file_name FROM offer_files WHERE offer_id = $1`, [offer.id]);
    expect(files[0].file_name).toBe('teklif.xlsx');
    if (offer.confidence < 0.8) {
      const card = (await clerk.get('/api/decisions')).body.items.find((d: any) => d.kind === 'low_confidence_review' && d.entityId === offer.id);
      expect(card).toBeTruthy();
    }
  });

  it('negotiation: only allowed arguments, approval card, max 3 rounds then a call task', async () => {
    const q = await quotableProject(clerk, t, 'trusted');
    expect((await clerk.post(`/api/offers/${q.accOffers.kalamis}/negotiate`, { arguments: ['competitor_price'] })).status).toBe(400);
    let offerId = q.accOffers.kalamis;
    for (let round = 1; round <= 3; round++) {
      const d = await clerk.post(`/api/offers/${offerId}/negotiate`, { arguments: ['volume', 'relationship'] });
      expect(d.status).toBe(200);
      expect(d.body.kind).toBe('negotiation');
      expect(d.body.status).toBe('pending_approval');
      expect(d.body.body).not.toMatch(/Moda Sahil|Galata/);
      const card = (await admin.get('/api/decisions')).body.items.find((x: any) => x.kind === 'negotiation_message' && x.entityId === d.body.id);
      expect(card.detail.round).toBe(round);
      const res = await admin.post(`/api/decisions/${card.id}/decide`, { action: 'approve' });
      expect(res.body.effects).toContain('draft_sent');
      // supplier answers with a negotiated version
      const nv = await clerk.post(`/api/items/${q.accItemId}/offers`, { supplierId: t.suppliers.kalamis, source: 'email', currency: 'EUR', lines: [{ description: 'DBL', kind: 'accommodation', quantity: 25, unit: 'room_night', nights: 2, unitPrice: 150 - round * 5, vatIncluded: false, vatRate: 0.1, roomType: 'DBL', board: 'BB' }], optionUntil: '2027-01-25' });
      expect(nv.body.negotiationRound).toBe(round);
      offerId = nv.body.id;
    }
    const hist = await ownerSql(`SELECT price_type FROM price_history WHERE offer_id = $1`, [offerId]);
    expect(hist[0].price_type).toBe('negotiated');
    const fourth = await clerk.post(`/api/offers/${offerId}/negotiate`, { arguments: ['volume'] });
    expect(fourth.status).toBe(409);
    expect(fourth.body.error.code).toBe('NEGOTIATION_LIMIT');
    const tasks = await clerk.get(`/api/tasks?projectId=${q.projectId}`);
    expect(tasks.body.items.some((x: any) => x.kind === 'call_supplier')).toBe(true);
  });

  it('WebAuthn options are issued for the logged-in user (Face ID step-up)', async () => {
    const r = await admin.post('/api/auth/webauthn/authenticate/options', { decisionId: null });
    expect(r.status).toBe(200);
    expect(typeof r.body.challenge).toBe('string');
    expect((await admin.post('/api/auth/webauthn/register/options')).status).toBe(400); // password re-auth required
    expect((await admin.post('/api/auth/webauthn/register/options', { password: 'wrong' })).status).toBe(403);
    const reg = await admin.post('/api/auth/webauthn/register/options', { password: 'demo1234' });
    expect(reg.body.rp.id).toBe('localhost');
  });

  it('suppliers created by the team are always candidates; field staff can read suppliers and rules', async () => {
    const s = await clerk.post('/api/suppliers', { name: 'Yeni Otel', city: 'İstanbul', kinds: ['accommodation'], status: 'accredited' });
    expect(s.body.status).toBe('candidate');
    const field = client(T.app, await login(T.app, t.users.field.email));
    expect((await field.get('/api/suppliers')).status).toBe(200);
    expect((await field.get('/api/rules')).body.targetMarginMin).toBe(0.08);
    expect((await field.get('/api/projects?outcome=won')).status).toBe(200);
  });
});
