// Senaryolar — §7 Adım 3 Müşteri teklifi (onay kapısı), §4 kişi bazlı yetki (docs/10-senaryolar.md S3-xx)
import { describe, expect, it } from 'vitest';
import { makeWorld, REQUEST_TEXT, scenarioSuite, type World } from './_scenario.js';

const S = scenarioSuite();
let w: World;
const world = async () => (w ??= await makeWorld(S, 's3'));
const OFFERS = { accommodation: { moda: 105, kalamis: 150 }, hall: { moda: 1300 } };
const opt = (...kinds: string[]) => ({ lines: kinds.map((kind) => ({ kind })) });

describe('Adım 3 — müşteri teklifi', () => {
  it('S3-01 §7.3 müşteri opsiyonu tedarikçi opsiyonundan uzun olamaz → bloklanır; eşit tarih kabul', async () => {
    const w = await world();
    const p = await w.flow().intake(REQUEST_TEXT, { customer: 'trusted' }).offers(OFFERS).quote(undefined, { optionUntil: '2027-01-21' });
    expect(p.quote.status).toBe('blocked');
    expect(p.quote.blockReasons.join(' ')).toMatch(/2027-01-20/);
    await p.flow().quote(undefined, { optionUntil: '2027-01-20' });
    expect(p.quote.status).toBe('approved');
    await p.flow().quote();
    expect(p.quote.optionUntil).toBe('2026-12-01'); // standart 7 iş günü < tedarikçi opsiyonu
  });

  it('S3-02 §7.3 hedef marj altı bloklanır; yalnız yönetici gerekçe + Face ID ile açar; gerekçe teklifte kayıtlı', async () => {
    const w = await world();
    const p = await w.flow().intake(REQUEST_TEXT, { customer: 'trusted' }).offers(OFFERS).quote(undefined, { markup: 0.05 });
    expect(p.quote.status).toBe('blocked');
    const c = await w.card('margin_override', { entityId: p.quote.id });
    expect((await w.cards({ kind: 'margin_override', who: 'clerk' })).length).toBe(0);
    expect((await w.decide(c, 'approve')).body.error.code).toBe('REASON_REQUIRED');
    expect((await w.decide(c, 'approve', { reason: 'Stratejik müşteri', bio: false })).body.error.code).toBe('BIOMETRIC_REQUIRED');
    expect((await w.decide(c, 'approve', { reason: 'Stratejik müşteri' })).body.effects).toContain('quote_approved');
    expect((await w.admin.get(`/api/quotes/${p.quote.id}`)).body).toMatchObject({ status: 'approved', marginOverrideReason: 'Stratejik müşteri' });
  });

  it('S3-03 §7.3 marj sınırı: %8,1 marj geçer (hedef %8); yönetici teklifte gerekçe yazarsa hemen açılır, clerk yazarsa açılmaz', async () => {
    const w = await world();
    const p = await w.flow().intake(REQUEST_TEXT, { customer: 'trusted' }).offers(OFFERS).quote(undefined, { markup: 0.0885 });
    expect(p.quote.options[0].totals.margin).toBeGreaterThan(0.08);
    expect(p.quote.status).toBe('approved');
    await p.flow().quote(undefined, { markup: 0.05, marginOverrideReason: 'clerk gerekçesi' });
    expect(p.quote.status).toBe('blocked');
    await p.flow().as('admin').quote(undefined, { markup: 0.05, marginOverrideReason: 'Yönetici: ilk iş' });
    expect(p.quote.status).toBe('approved');
  });

  it('S3-04 §4 kapsamlı yetki: clerk tanımlı müşteride serbest, diğerinde onaya; etkinlik tipi kapsamı da serbest bırakır', async () => {
    const w = await world();
    const trusted = await w.flow().intake(REQUEST_TEXT, { customer: 'trusted' }).offers(OFFERS).quote();
    expect(trusted.quote.status).toBe('approved');
    const other = await w.flow().intake(REQUEST_TEXT, { customer: 'new' }).offers(OFFERS).quote();
    expect(other.quote.status).toBe('pending_approval');
    const c = await w.card('quote_approval', { entityId: other.quote.id });
    expect(c.requiresBiometric).toBe(true);
    expect((await w.decide(c, 'approve', { who: 'clerk' })).status).toBe(403);
    await w.admin.patch(`/api/users/${w.user('clerk').id}`, { authorityScope: { customerIds: [w.customer('trusted')], eventTypes: ['toplantı'] } });
    await w.relogin('clerk');
    const byType = await w.flow().intake(REQUEST_TEXT, { customer: 'new' }).offers(OFFERS).quote();
    expect(byType.quote.status).toBe('approved');
    await w.admin.patch(`/api/users/${w.user('clerk').id}`, { authorityScope: { customerIds: [w.customer('trusted')], eventTypes: [] } });
    await w.relogin('clerk');
  });

  it('S3-05 §4 yetki seviyeleri: "her teklif onaya" clerk ve satış dışı rol her zaman onaya; "tam yetki" serbest', async () => {
    const w = await makeWorld(S, 's3b');
    await w.admin.patch(`/api/users/${w.user('clerk').id}`, { authorityLevel: 'all_need_approval' });
    await w.relogin('clerk');
    expect((await w.flow().intake(REQUEST_TEXT, { customer: 'trusted' }).offers(OFFERS).quote()).quote.status).toBe('pending_approval');
    expect((await w.flow().as('ops').intake(REQUEST_TEXT, { customer: 'trusted' }).offers(OFFERS).quote()).quote.status).toBe('pending_approval');
    await w.admin.patch(`/api/users/${w.user('clerk').id}`, { authorityLevel: 'full' });
    await w.relogin('clerk');
    expect((await w.flow().intake(REQUEST_TEXT, { customer: 'new' }).offers(OFFERS).quote()).quote.status).toBe('approved');
  });

  it('S3-06 §7.3 müşteriye özel kurallar otomatik uygulanır ve listelenir (ödeme/iptal maddesi yok, özel madde)', async () => {
    const w = await world();
    const p = await w.flow().intake(REQUEST_TEXT, { customer: 'trusted' }).offers(OFFERS).quote();
    expect(p.quote.appliedCustomerRules).toEqual(expect.arrayContaining(['Kesin onay: online onay yeterli', 'Teklifte ödeme / iptal maddesi yer almaz', 'Özel madde: Fiyatlara KDV dahil değildir.']));
    const doc = (await p.docs()).find((d) => d.kind === 'quote');
    expect(doc.content.clauses).toEqual(['Fiyatlara KDV dahil değildir.']);
    const n = await w.flow().intake(REQUEST_TEXT, { customer: 'new' }).offers(OFFERS).quote();
    expect(n.quote.appliedCustomerRules).toEqual(expect.arrayContaining(['Kesin onay: imzalı onay veya PO şart', 'Kapora yok']));
    expect((await n.docs()).find((d) => d.kind === 'quote').content.clauses.join(' ')).toMatch(/Ödeme:.*İptal:/s);
  });

  it('S3-07 §7.3 seçenek sayısı 2–3: 1 ve 4 seçenek bloklanır, 3 kabul', async () => {
    const w = await world();
    const p = await w.flow().intake(REQUEST_TEXT, { customer: 'trusted' }).offers(OFFERS).quote([opt('accommodation', 'hall')]);
    expect(p.quote.blockReasons.join(' ')).toMatch(/2–3 seçenek/);
    await p.flow().quote([1, 2, 3, 4].map(() => opt('accommodation', 'hall')));
    expect(p.quote.status).toBe('blocked');
    await p.flow().quote([1, 2, 3].map(() => opt('accommodation', 'hall')));
    expect(p.quote.status).toBe('approved');
  });

  it('S3-08 §17.4 katma değer kalemi (alış 0, satışı acenta belirler): bloklamaz, RFQ açılmaz, kâr-zararda "katma değer"', async () => {
    const w = await world();
    const p = await w.flow().intake(REQUEST_TEXT, { customer: 'trusted' }).offers(OFFERS)
      .addItem('technical', { description: 'Ses-ışık sistemi (otel ücretsiz)', valueAdd: true });
    expect((await w.clerk.post(`/api/items/${p.items['technical:valueAdd']}/rfqs`, { supplierIds: [w.supplier('av'), w.supplier('moda'), w.supplier('kalamis')] })).body.error.code).toBe('VALUE_ADD_ITEM');
    const lines = [{ kind: 'accommodation' }, { kind: 'hall' }, { kind: 'technical:valueAdd', unitPriceEur: 600 }];
    await p.flow().quote([{ lines }, { lines }]);
    expect(p.quote.status).toBe('approved');
    const va = p.quote.options[0].lines.find((l: any) => l.valueAdd);
    expect(va).toMatchObject({ unitCostEur: 0, unitPriceEur: 600 });
    expect((await w.admin.get(`/api/quotes/${p.quote.id}`)).body.validation?.issues?.some?.((i: any) => i.code === 'zero_price') ?? false).toBe(false);
    const pnl = (await p.docs()).find((d) => d.kind === 'pnl');
    expect(pnl.content.options[0].lines.find((l: any) => l.valueAdd).costEur).toBe(0);
  });

  it('S3-09 §3.5 veri değişince belge eski: eski teklif gönderilemez; yeni sürüm üretilir, eski sürüm ve kartı kapanır', async () => {
    const w = await world();
    const p = await w.flow().intake(REQUEST_TEXT, { customer: 'new' }).offers(OFFERS).quote();
    const v1 = p.quote.id;
    const card = await w.card('quote_approval', { entityId: v1 });
    await p.flow().patch({ pax: 90 });
    expect((await w.admin.post(`/api/quotes/${v1}/send`)).status).toBe(409);
    await p.flow().quote();
    expect((await w.admin.get(`/api/quotes/${v1}`)).body.status).toBe('superseded');
    expect((await w.cards({ kind: 'quote_approval' })).some((c) => c.id === card.id)).toBe(false);
    await p.flow().approveQuote().send();
    expect(p.quoteToken).toHaveLength(43);
  });

  it('S3-10 §7.3 aday tedarikçi yalnız B seçeneğinde olsa bile teklif bloklanır', async () => {
    const w = await world();
    const p = await w.flow().intake(REQUEST_TEXT, { customer: 'trusted' }).offers({ ...OFFERS, accommodation: { moda: 105, galata: 95 } })
      .quote([opt('accommodation', 'hall'), { lines: [{ kind: 'accommodation', supplier: 'galata' }, { kind: 'hall' }] }]);
    expect(p.quote.status).toBe('blocked');
    expect(p.quote.blockReasons.join(' ')).toMatch(/aday/);
  });

  it('S3-11 §15 onay kartında "Düzelt" teklifi ekibe geri gönderir, "Reddet" reddeder; karar kapanır', async () => {
    const w = await world();
    const a = await w.flow().intake(REQUEST_TEXT, { customer: 'new' }).offers(OFFERS).quote();
    const r1 = await w.decide(await w.card('quote_approval', { entityId: a.quote.id }), 'edit', { edits: { note: 'B seçeneğinde marjı artırın' } });
    expect(r1.body.effects).toContain('quote_returned_for_edit');
    expect((await w.admin.get(`/api/quotes/${a.quote.id}`)).body.status).toBe('draft');
    const b = await w.flow().intake(REQUEST_TEXT, { customer: 'new' }).offers(OFFERS).quote();
    expect((await w.decide(await w.card('quote_approval', { entityId: b.quote.id }), 'reject', { reason: 'fiyat yüksek' })).body.effects).toContain('quote_rejected');
    expect((await w.clerk.post(`/api/quotes/${b.quote.id}/send`)).body.error.code).toBe('QUOTE_NOT_APPROVED');
  });

  it('S3-12 §7.3 konaklama ve hizmet KDV oranları ayrı, konaklama vergisi ayrı satır; PDF üretilir', async () => {
    const w = await world();
    const p = await w.flow().intake(REQUEST_TEXT, { customer: 'trusted' }).offers(OFFERS).quote();
    const doc = (await p.docs()).find((d) => d.kind === 'quote');
    const o = doc.content.options[0];
    expect(o.vatLines.map((v: any) => v.rate)).toEqual([0.1, 0.2]);
    expect(o.accommodationTax).toBeCloseTo((5250 + 5400) * 1.2 * 0.02, 1);
    expect(o.grandTotal).toBeCloseTo(o.subtotal + o.vatLines.reduce((s: number, v: any) => s + v.amount, 0) + o.accommodationTax, 0);
    const pdf = await w.T.app.inject({ method: 'GET', url: `/api/quotes/${p.quote.id}/pdf`, headers: { authorization: `Bearer ${w.tokens.clerk}` } });
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('S3-13 §7.4 kaybedilen projeye teklif hazırlanamaz', async () => {
    const w = await world();
    const p = await w.flow().intake(REQUEST_TEXT, { customer: 'trusted' }).offers(OFFERS).lost('Bütçe');
    const r = await w.clerk.post(`/api/projects/${p.id}/quotes`, { options: [{ title: 'A', lines: [{ serviceItemId: p.item('hall') }] }] });
    expect(r.body.error.code).toBe('PROJECT_CLOSED');
  });
});
