// Senaryolar — §7 Adım 2 Karşılaştırma ve pazarlık, §9 fiyat değerlendirme (docs/10-senaryolar.md S2-xx)
import { describe, expect, it } from 'vitest';
import { makeWorld, REQUEST_TEXT, scenarioSuite, type World } from './_scenario.js';

const S = scenarioSuite();
let w: World;
const world = async () => (w ??= await makeWorld(S, 's2'));
const cmp = async (w: World, itemId: string) => (await w.clerk.get(`/api/items/${itemId}/comparison`)).body;
const evalOf = (c: any, offerId: string) => c.evaluations.find((e: any) => e.offerId === offerId);
const dbl = (price: number, extra: Record<string, unknown> = {}) => [{ description: 'Oda DBL BB', kind: 'accommodation', quantity: 25, unit: 'room_night', nights: 2, unitPrice: price, vatIncluded: false, vatRate: 0.1, roomType: 'DBL', board: 'BB', ...extra }];

describe('Adım 2 — normalizasyon, değerlendirme, pazarlık', () => {
  it('S2-01 §7.2 KDV dahil / hariç teklifler KDV hariç tek tabana çevrilir', async () => {
    const w = await world();
    const p = await w.flow().intake()
      .offer('accommodation', 'moda', { lines: dbl(110, { vatIncluded: true, vatRate: 10 }) }) // %10 dahil (yüzde girişi) → 100 net
      .offer('accommodation', 'kalamis', { lines: dbl(100) });
    const c = await cmp(w, p.item('accommodation'));
    const a = evalOf(c, p.offer('accommodation', 'moda')).normalized;
    const b = evalOf(c, p.offer('accommodation', 'kalamis')).normalized;
    expect(a.totalNetExVatEur).toBeCloseTo(5000, 2);
    expect(b.totalNetExVatEur).toBeCloseTo(5000, 2);
    expect(a.vatEur).toBeCloseTo(500, 2);
  });

  it('S2-02 §7.2 konaklama vergisi ayrı: vergi dahil fiyat %2 + KDV ayrıştırılır', async () => {
    const w = await world();
    const p = await w.flow().intake().offer('accommodation', 'moda', { lines: dbl(112, { vatIncluded: true, accommodationTaxIncluded: true }) });
    const n = evalOf(await cmp(w, p.item('accommodation')), p.offer('accommodation', 'moda')).normalized;
    expect(n.totalNetExVatEur).toBeCloseTo(5000, 1); // 112 / 1.12 = 100 × 50
    expect(n.accommodationTaxEur).toBeCloseTo(100, 1);
    expect(n.perRoomNightEur).toBeCloseTo(100, 1);
  });

  it('S2-03 §7.2 çok para birimi: TRY teklif EUR\'ya kayıtlı kurla çevrilir; TRY müşteri teklifinde kur kaynağı ve tarihi kayıtlı', async () => {
    const w = await world();
    const p = await w.flow().intake(REQUEST_TEXT, { customer: 'deposit' })
      .offers({ accommodation: { moda: { currency: 'TRY', lines: dbl(4850) } }, hall: { moda: 1300 } }).as('admin').quote();
    const n = evalOf(await cmp(w, p.item('accommodation')), p.offer('accommodation', 'moda')).normalized;
    expect(n.totalNetExVatEur).toBeCloseTo(5000, 1); // 4850 TRY / 48.5
    expect(p.quote).toMatchObject({ currency: 'TRY', fxRate: 48.5, fxSource: 'TCMB efektif satış (seed)', fxDate: '2026-11-19' });
    expect(p.quote.options[0].grandTotalCustomerCurrency).toBeCloseTo((p.quote.options[0].totals.saleEur + p.quote.options[0].vatEur + p.quote.options[0].accommodationTaxEur) * 48.5, 0);
  });

  it('S2-04 §9 kanal fiyatıyla avantaj % → markup kademesi; markup ve marj ayrı', async () => {
    const w = await world();
    const p = await w.flow().intake().offer('accommodation', 'moda', { lines: dbl(100) }).offer('accommodation', 'kalamis', { lines: dbl(165) });
    const c = await cmp(w, p.item('accommodation'));
    const m = evalOf(c, p.offer('accommodation', 'moda'));
    expect(m.benchmark).toMatchObject({ type: 'channel', value: 125 });
    expect(m.advantage).toBeCloseTo(0.2, 3); // (125-100)/125
    expect(m.priceClass).toBe('good');
    expect(m.suggestedMarkup).toBe(0.25);
    const k = evalOf(c, p.offer('accommodation', 'kalamis'));
    expect(k.advantage).toBeCloseTo((175 - 165) / 175, 3); // %5,7
    expect(k.priceClass).toBe('normal');
    expect(k.suggestedMarkup).toBe(0.1);
  });

  it('S2-05 §9 iadesiz kanal fiyatı esnek grup fiyatıyla kıyaslanmaz → "bilmiyorum", en düşük kademe', async () => {
    const w = await world();
    const s = await w.clerk.post('/api/suppliers', { name: 'Moda Koru Otel', city: 'İstanbul', district: 'Kadıköy', kinds: ['accommodation'] });
    await w.ops.post('/api/channel-prices', { supplierId: s.body.id, date: '2027-03-12', roomType: 'DBL', board: 'BB', cancellation: 'non_refundable', price: 90, currency: 'EUR', source: 'Booking.com' });
    w.t.suppliers.modakoru = s.body.id;
    const p = await w.flow().intake().offer('accommodation', 'modakoru', { lines: dbl(100) });
    const e = evalOf(await cmp(w, p.item('accommodation')), p.offer('accommodation', 'modakoru'));
    expect(e.priceClass).toBe('unknown');
    expect(e.advantage).toBeNull();
    expect(e.risks.join(' ')).toMatch(/koşulları farklı/);
    expect(e.suggestedMarkup).toBe(0.05);
    expect(e.candidateSupplier).toBe(true);
  });

  it('S2-06 §3.7 geçmiş veri yoksa "bilmiyorum" (etkinlik kalemi); geçmiş medyan varsa salon değerlendirilir', async () => {
    const w = await world();
    const p = await w.flow().intake().addItem('activity', { description: 'Boğaz turu' }).offer('activity', 'tekne', 4000).offer('hall', 'moda', 1300);
    const act = evalOf(await cmp(w, p.item('activity')), p.offer('activity', 'tekne'));
    expect(act).toMatchObject({ priceClass: 'unknown', advantage: null, benchmark: { type: 'none' } });
    expect(act.risks.join(' ')).toMatch(/Fiyat geçmişi yok/);
    const hall = evalOf(await cmp(w, p.item('hall')), p.offer('hall', 'moda'));
    expect(hall.benchmark.type).toBe('history_median');
    expect(hall.benchmark.sampleSize).toBeGreaterThan(3);
    expect(hall.advantage).toBeCloseTo((hall.benchmark.value - 1300) / hall.benchmark.value, 3);
  });

  it('S2-07 §7.2 gizli maliyetler ayrıca işaretlenir (garanti > kişi, %50 ön ödeme, iadesiz iptal)', async () => {
    const w = await world();
    const p = await w.flow().intake().offer('accommodation', 'bogaz', { lines: dbl(150), guaranteePax: 90, prepaymentRate: 0.5, cancellationTerms: 'İadesiz, %100 ceza' });
    const e = evalOf(await cmp(w, p.item('accommodation')), p.offer('accommodation', 'bogaz'));
    const t = e.normalized.hiddenCosts.map((h: any) => h.type);
    expect(t).toEqual(expect.arrayContaining(['guarantee', 'payment', 'cancellation']));
    expect(e.risks.join(' ')).toMatch(/Garanti kişi sayısı \(90\)/);
  });

  it('S2-08 §7.2 pazarlık: yalnız izinli argümanlar; 3 tur onaylı taslak, 4. tur reddedilir → telefon görevi', async () => {
    const w = await world();
    const p = await w.flow().intake().assign().offer('accommodation', 'kalamis', { lines: dbl(150) });
    expect((await w.clerk.post(`/api/offers/${p.offer('accommodation', 'kalamis')}/negotiate`, { arguments: ['competitor_price'] })).status).toBe(400);
    for (let round = 1; round <= 3; round++) {
      const d = await w.clerk.post(`/api/offers/${p.offer('accommodation', 'kalamis')}/negotiate`, { arguments: round % 2 ? ['flexible_dates'] : ['payment_ease'] });
      expect(d.body.status).toBe('pending_approval');
      const c = await w.card('negotiation_message', { entityId: d.body.id });
      expect(c.detail.round).toBe(round);
      expect((await w.decide(c)).body.effects).toContain('draft_sent');
      expect(w.mails.at(-1)!.from).toBe(w.user('clerk').email);
      await p.flow().offer('accommodation', 'kalamis', { lines: dbl(150 - round * 5) });
    }
    const fourth = await w.clerk.post(`/api/offers/${p.offer('accommodation', 'kalamis')}/negotiate`, { arguments: ['volume'] });
    expect(fourth.body.error.code).toBe('NEGOTIATION_LIMIT');
    expect((await p.tasks('call_supplier')).length).toBe(1);
  });

  it('S2-09 §7.2 rakip fiyatı argüman olamaz: yönetici "Düzelt" ile rakip adı / fiyatı eklerse mesaj gönderilmez', async () => {
    const w = await world();
    const p = await w.flow().intake().offer('accommodation', 'moda', { lines: dbl(100) }).offer('accommodation', 'kalamis', { lines: dbl(150) });
    const d = await w.clerk.post(`/api/offers/${p.offer('accommodation', 'kalamis')}/negotiate`, { arguments: ['volume'] });
    expect(d.body.body).not.toMatch(/Moda Sahil/);
    const c = await w.card('negotiation_message', { entityId: d.body.id });
    const before = w.mails.length;
    const bad = await w.decide(c, 'edit', { edits: { body: 'Merhaba, Moda Sahil Otel bize 100 EUR veriyor, siz de bu fiyata inin.' } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('NEGOTIATION_RULE_VIOLATION');
    expect(w.mails.length).toBe(before);
    const ok = await w.decide(c, 'edit', { edits: { body: 'Merhaba, 80 kişilik grubumuz ve uzun vadeli işbirliğimiz için fiyatı tekrar değerlendirebilir misiniz?' } });
    expect(ok.body.effects).toContain('draft_sent');
  });
});
