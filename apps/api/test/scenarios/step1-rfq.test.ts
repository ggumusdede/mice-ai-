// Senaryolar — §7 Adım 1 Tedarikçi seçimi ve RFQ, §10 tedarikçi linki, §17.5 / §17.6 (docs/10-senaryolar.md S1-xx)
import { describe, expect, it } from 'vitest';
import { advanceHours, clock } from '../helpers.js';
import { accLines, makeWorld, ownerSql, REQUEST_TEXT, scenarioSuite, type World } from './_scenario.js';

const S = scenarioSuite();
let w: World;
const world = async () => (w ??= await makeWorld(S, 's1'));
const sup = (w: World, ...k: string[]) => k.map((x) => w.supplier(x));

describe('Adım 1 — RFQ', () => {
  it('S1-01 §17.6 3 tedarikçiden az: gerekçesiz reddedilir; gerekçe kayda geçer, kart kritik rozetli ve haftalık raporda görünür', async () => {
    const w = await world();
    const p = await w.flow().intake();
    const two = await w.clerk.post(`/api/items/${p.item('accommodation')}/rfqs`, { supplierIds: sup(w, 'moda', 'kalamis') });
    expect(two.body.error.code).toBe('RFQ_OVERRIDE_REASON_REQUIRED');
    await p.flow().rfqs('accommodation', ['moda', 'kalamis'], { overrideReason: 'Semtte yalnız iki uygun otel' });
    const c = await w.card('rfq_send', { entityId: p.item('accommodation'), who: 'clerk' });
    expect(c.badge).toBe('critical');
    expect(c.aiNote).toContain('Semtte yalnız iki uygun otel');
    const rep = await w.admin.get('/api/reports/weekly');
    expect(rep.body.rfqOverrides).toEqual(expect.arrayContaining([{ projectCode: p.code, reason: 'Semtte yalnız iki uygun otel' }]));
  });

  it('S1-02 §17.6 5 tedarikçiden fazla gerekçesiz reddedilir, gerekçeyle kabul; tek tedarikçili talep gerekçeyle 1 RFQ', async () => {
    const w = await world();
    const p = await w.flow().intake();
    const six = sup(w, 'moda', 'kalamis', 'bomonti', 'nisantasi', 'bogaz', 'ortakoy');
    expect((await w.clerk.post(`/api/items/${p.item('accommodation')}/rfqs`, { supplierIds: six })).body.error.code).toBe('RFQ_OVERRIDE_REASON_REQUIRED');
    expect((await w.clerk.post(`/api/items/${p.item('accommodation')}/rfqs`, { supplierIds: six, overrideReason: 'Yüksek sezon, geniş tarama' })).body.items).toHaveLength(6);
    await p.flow().rfqs('transfer', ['transfer'], { overrideReason: 'Tek tedarikçili hizmet' });
    expect(p.last.items).toHaveLength(1);
  });

  it('S1-03 §7.1 aday tedarikçi fiyat verebilir ama müşteriye sunulamaz / konfirme edilemez; yönetici akredite edince sunulabilir', async () => {
    const w = await world();
    const p = await w.flow().intake(REQUEST_TEXT, { customer: 'trusted' })
      .rfqs('accommodation', ['moda', 'kalamis', 'galata']).approveRfqs('accommodation')
      .portalOffer('accommodation', 'galata', { price: 95 }).offers({ accommodation: { moda: 105 }, hall: { moda: 1300 } })
      .select('accommodation', 'galata').quote([{ lines: [{ kind: 'accommodation' }, { kind: 'hall' }] }, { lines: [{ kind: 'accommodation', supplier: 'moda' }, { kind: 'hall' }] }]);
    expect(p.quote.status).toBe('blocked');
    expect((await p.detail()).alerts.some((a: any) => a.code === 'CANDIDATE_SUPPLIER')).toBe(true);
    // clerk asks for accreditation → only an admin card
    await w.clerk.patch(`/api/suppliers/${w.supplier('galata')}`, { status: 'accredited', reason: 'iyi fiyat' });
    const c = await w.card('supplier_accreditation', { entityId: w.supplier('galata') });
    expect((await w.decide(c, 'approve')).body.effects).toContain('supplier_accredited');
    await p.flow().quote([{ lines: [{ kind: 'accommodation' }, { kind: 'hall' }] }, { lines: [{ kind: 'accommodation', supplier: 'moda' }, { kind: 'hall' }] }]);
    expect(p.quote.status).not.toBe('blocked');
  });

  it('S1-04 §7.1 ekibin eklediği tedarikçi her zaman "aday" açılır', async () => {
    const w = await world();
    const r = await w.clerk.post('/api/suppliers', { name: 'Fenerbahçe Butik Otel', city: 'İstanbul', district: 'Kadıköy', kinds: ['accommodation'], status: 'accredited' });
    expect(r.body.status).toBe('candidate');
  });

  it('S1-05 §7.1 takip: 24 saatte yanıt vermeyenlere otomatik hatırlatma (yanıt verene değil), 48 saatte "telefonla ara" görevi', async () => {
    const w = await makeWorld(S, 's1x');
    const p = await w.flow().intake().rfqs('accommodation', ['moda', 'kalamis', 'bomonti']).approveRfqs('accommodation');
    advanceHours(3);
    await p.flow().portalOffer('accommodation', 'moda', { price: 100 });
    const before = w.mails.length;
    advanceHours(22);
    await w.worker(clock.now);
    const rem = w.mailsSince(before).filter((m) => m.autonomous && /Hatırlatma/.test(m.subject ?? ''));
    expect(rem.map((m) => m.to).sort()).toEqual(['satis@bomonti.example.com', 'satis@kalamis.example.com']);
    expect(rem.every((m) => m.from === w.user('clerk').email && !m.body.includes('ANADOLU'))).toBe(true);
    advanceHours(24);
    await w.worker(clock.now);
    expect((await p.tasks('call_supplier')).length).toBe(2);
  });

  it('S1-06 §17.6 acil talep: gerekçeyle 24 saat yanıt süresi → 12 sa hatırlatma, 24 sa telefon görevi', async () => {
    const w = await makeWorld(S, 's1x');
    const p = await w.flow().intake().rfqs('hall', ['moda', 'kalamis', 'bomonti'], { deadlineHours: 24, overrideReason: 'Acil talep' }).approveRfqs('hall');
    const rfq = (await ownerSql('SELECT reminder_hours, call_hours FROM rfqs WHERE id = $1', [p.rfqs.hall.moda]))[0];
    expect(rfq).toEqual({ reminder_hours: 12, call_hours: 24 });
    advanceHours(11);
    expect((await w.worker(clock.now)).filter((x) => x === 'supplier_reminder')).toHaveLength(0);
    advanceHours(2);
    expect((await w.worker(clock.now)).filter((x) => x === 'supplier_reminder')).toHaveLength(3);
    advanceHours(12);
    expect((await w.worker(clock.now)).filter((x) => x === 'call_task')).toHaveLength(3);
  });

  it('S1-07 §17.5 tedarikçi son tarihe kadar revize eder → yeni sürüm (eskisi silinmez, seçim yeni sürüme kayar); sonra salt okunur; opsiyon bitince link kapanır', async () => {
    const w = await world();
    const p = await w.flow().intake().rfqs('accommodation', ['moda', 'kalamis', 'bomonti']).approveRfqs('accommodation')
      .portalOffer('accommodation', 'moda', { price: 110, optionUntil: '2027-01-31' });
    const v1 = p.offer('accommodation', 'moda');
    await p.flow().select('accommodation', 'moda');
    advanceHours(20);
    await p.flow().portalOffer('accommodation', 'moda', { price: 104, optionUntil: '2027-01-31' });
    const v2 = p.offer('accommodation', 'moda');
    expect(v2).not.toBe(v1);
    expect((await ownerSql('SELECT superseded_by FROM supplier_offers WHERE id = $1', [v1]))[0].superseded_by).toBe(v2);
    expect((await p.detail()).items.find((i: any) => i.kind === 'accommodation').selectedOfferId).toBe(v2);
    const tok = p.rfqTokens.accommodation.moda;
    advanceHours(30); // deadline 48h passed
    expect((await w.pub.get(`/api/public/rfq/${tok}`)).body.readOnly).toBe(true);
    expect((await w.pub.post(`/api/public/rfq/${tok}`, { currency: 'EUR', lines: accLines(99, 88) })).body.error.code).toBe('RFQ_READ_ONLY');
    advanceHours(24 * 75); // after the option date (2027-01-31) the link is gone
    expect((await w.pub.get(`/api/public/rfq/${tok}`)).status).toBe(410);
  });

  it('S1-08 §17.5 proje kaybedilince linkler kapanır, hatırlatma gitmez; ekip iptali gerekçe ister', async () => {
    const w = await makeWorld(S, 's1x');
    const p = await w.flow().intake().rfqs('accommodation', ['moda', 'kalamis', 'bomonti']).approveRfqs('accommodation');
    expect((await w.clerk.post(`/api/rfqs/${p.rfqs.accommodation.moda}/cancel`, {})).status).toBe(400);
    expect((await w.clerk.post(`/api/rfqs/${p.rfqs.accommodation.moda}/cancel`, { reason: 'Tedarikçi elendi' })).body.status).toBe('cancelled');
    expect((await w.pub.get(`/api/public/rfq/${p.rfqTokens.accommodation.moda}`)).status).toBe(410);
    await p.flow().lost('Müşteri iptal etti');
    expect((await w.pub.get(`/api/public/rfq/${p.rfqTokens.accommodation.kalamis}`)).status).toBe(410);
    advanceHours(30);
    expect((await w.worker(clock.now)).filter((x) => x === 'supplier_reminder')).toHaveLength(0);
  });

  it('S1-09 §7.1 pasif tedarikçi, yanlış hizmet türü ve aynı tedarikçiye ikinci açık RFQ reddedilir', async () => {
    const w = await world();
    const p = await w.flow().intake().rfqs('accommodation', ['moda', 'kalamis', 'bomonti']);
    expect((await w.clerk.post(`/api/items/${p.item('accommodation')}/rfqs`, { supplierIds: sup(w, 'moda', 'bogaz', 'ortakoy') })).body.error.code).toBe('RFQ_EXISTS');
    expect((await w.clerk.post(`/api/items/${p.item('accommodation')}/rfqs`, { supplierIds: sup(w, 'transfer', 'bogaz', 'ortakoy') })).body.error.code).toBe('SUPPLIER_KIND');
    await ownerSql(`UPDATE suppliers SET status = 'passive' WHERE id = $1`, [w.supplier('atasehir')]);
    expect((await w.clerk.post(`/api/items/${p.item('accommodation')}/rfqs`, { supplierIds: sup(w, 'atasehir', 'bogaz', 'ortakoy') })).body.error.code).toBe('SUPPLIER_PASSIVE');
  });

  it('S1-10 §7.1 / G-15 RFQ sorumlunun adresinden gider; tedarikçi müşteri adını görmez (güvenli referans)', async () => {
    const w = await world();
    const p = await w.flow().intake().assign('clerk');
    const before = w.mails.length;
    await p.flow().rfqs('accommodation', ['moda', 'kalamis', 'bomonti']).approveRfqs('accommodation');
    const mails = w.mailsSince(before);
    expect(mails).toHaveLength(3);
    expect(mails.every((m) => m.from === w.user('clerk').email && !/ANADOLU|Anadolu/.test(m.body + m.subject))).toBe(true);
    const view = await w.pub.get(`/api/public/rfq/${p.rfqTokens.accommodation.moda}`);
    expect(view.body.projectCode).toMatch(/^PRJ-\d{4}-20270312-80$/);
    expect(JSON.stringify(view.body)).not.toMatch(/Anadolu|ANADOLU/);
  });

  it('S1-11 §6 RFQ kartı reddedilirse RFQ iptal, tek e-posta gitmez', async () => {
    const w = await world();
    const p = await w.flow().intake().rfqs('accommodation', ['moda', 'kalamis', 'bomonti']);
    const before = w.mails.length;
    const c = await w.card('rfq_send', { entityId: p.item('accommodation'), who: 'clerk' });
    expect((await w.decide(c, 'reject', { who: 'clerk', reason: 'yanlış kalem' })).body.effects).toContain('rfqs_cancelled');
    expect(w.mails.length).toBe(before);
    expect((await ownerSql('SELECT DISTINCT status FROM rfqs WHERE id = ANY($1)', [Object.values(p.rfqs.accommodation)])).map((r) => r.status)).toEqual(['cancelled']);
  });

  it('S1-12 §7.1 tedarikçi yanıtı fiyat geçmişine kalem kalem yazılır; yanıt süresi tedarikçi kaydına işlenir', async () => {
    const w = await world();
    const p = await w.flow().intake().rfqs('accommodation', ['moda', 'kalamis', 'bomonti']).approveRfqs('accommodation');
    advanceHours(5);
    await p.flow().portalOffer('accommodation', 'kalamis', { price: 150 });
    const ph = await ownerSql(`SELECT price_type, room_type FROM price_history WHERE offer_id = $1 ORDER BY room_type`, [p.offer('accommodation', 'kalamis')]);
    expect(ph).toEqual([{ price_type: 'initial', room_type: 'DBL' }, { price_type: 'initial', room_type: 'SGL' }]);
    const s = (await ownerSql('SELECT avg_response_hours FROM suppliers WHERE id = $1', [w.supplier('kalamis')]))[0];
    expect(Number(s.avg_response_hours)).toBeCloseTo((4 * 3 + 5) / 4, 1);
  });
});
