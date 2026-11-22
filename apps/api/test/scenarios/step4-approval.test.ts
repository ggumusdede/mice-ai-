// Senaryolar — §7 Adım 4 Müşteri onayı, §17.2 kesin onay (docs/10-senaryolar.md S4-xx)
import { describe, expect, it } from 'vitest';
import { clock } from '../helpers.js';
import { makeWorld, ownerSql, REQUEST_TEXT, scenarioSuite, setClock, type World } from './_scenario.js';

const S = scenarioSuite();
let w: World;
const world = async () => (w ??= await makeWorld(S, 's4'));
const OFFERS = { accommodation: { moda: 105, kalamis: 150 }, hall: { moda: 1300 } };
const sent = (w: World, customer: 'trusted' | 'new' | 'deposit' = 'trusted') =>
  w.flow().intake(REQUEST_TEXT, { customer }).offers(OFFERS).as('admin').quote().send();

describe('Adım 4 — müşteri onayı', () => {
  it('S4-01 §7.4 online onay yeterli müşteri: açılma zamanı görünür, seçenek seçip onaylar → kazanıldı; ikinci onay reddedilir', async () => {
    const w = await world();
    const p = await sent(w);
    expect((await w.pub.get(`/api/public/quotes/${p.quoteToken}`)).body.firmApproval).toBe('online');
    expect((await w.admin.get(`/api/quotes/${p.quote.id}`)).body.openedAt).not.toBeNull();
    await p.flow().accept(2, { approverName: 'Burak Şahin' });
    expect(p.last).toEqual({ ok: true, firm: true });
    expect((await p.project()).outcome).toBe('won');
    expect((await p.detail()).items.find((i: any) => i.kind === 'accommodation').selectedOfferId).toBe(p.offer('accommodation', 'kalamis'));
    expect((await w.pub.post(`/api/public/quotes/${p.quoteToken}/accept`, { optionNo: 1, approverName: 'x' })).status).toBe(409);
  });

  it('S4-02 §17.2 yeni müşteri varsayılanı: PO / imzalı form şart; online seçim kesin onay değildir', async () => {
    const w = await world();
    const p = await sent(w, 'new');
    await p.flow().accept(1, { approverName: 'Selin' });
    expect(p.last.firm).toBe(false);
    expect((await p.project()).outcome).toBe('open');
    expect((await p.tasks('signed_form')).length).toBe(1);
    expect((await w.admin.post(`/api/quotes/${p.quote.id}/firm-approval`, {})).body.error.code).toBe('PO_OR_FORM_REQUIRED');
    await w.admin.post(`/api/quotes/${p.quote.id}/firm-approval`, { signedFormFileName: 'onay-formu.pdf' });
    expect((await p.project()).outcome).toBe('won');
    expect((await p.tasks('signed_form'))[0].status).toBe('done');
    const q = await sent(w, 'new');
    await q.flow().accept(1, { poNumber: 'PO-77' });
    expect(q.last.firm).toBe(true);
  });

  it('S4-03 §7.4 revizyon: kişi/tarih değişti → Adım 1; yalnız fiyat → Adım 2; fark listesi ve görev', async () => {
    const w = await world();
    const a = await sent(w);
    const r1 = await w.pub.post(`/api/public/quotes/${a.quoteToken}/revision`, { message: 'Tarihler 19-21 Mart 2027 olarak değişti.' });
    expect(r1.body.targetStep).toBe(1);
    expect(r1.body.diff.map((d: any) => d.field)).toContain('startDate');
    const b = await sent(w);
    const r2 = await w.pub.post(`/api/public/quotes/${b.quoteToken}/revision`, { message: 'Fiyat biraz yüksek, indirim yapabilir misiniz?' });
    expect(r2.body).toMatchObject({ targetStep: 2, diff: [{ field: 'price' }] });
    expect((await b.project()).step).toBe(2);
    expect((await b.tasks('quote_revision')).length).toBe(1);
    expect((await w.pub.post(`/api/public/quotes/${b.quoteToken}/accept`, { optionNo: 1, approverName: 'x' })).status).toBe(409);
  });

  it('S4-04 §7.3 opsiyon süresi dolan teklif online onaylanamaz', async () => {
    const w = await world();
    const p = await sent(w);
    setClock('2026-12-02T10:00'); // opsiyon 2026-12-01
    const r = await w.pub.post(`/api/public/quotes/${p.quoteToken}/accept`, { optionNo: 1, approverName: 'Geç' });
    expect(r.body.error.code).toBe('QUOTE_OPTION_EXPIRED');
  });

  it('S4-05 §7.4 takip: yanıt yoksa 2 iş günü sonra hatırlatma taslağı (onaylı gönderim); opsiyondan 2 gün önce ikinci (acil) taslak', async () => {
    const w = await makeWorld(S, 's4b');
    const p = await sent(w); // Cuma 10:00
    await w.worker('2026-11-23T12:00'); // Pzt: 1 iş günü
    expect((await w.cards({ kind: 'outbound_message', projectId: p.id, who: 'clerk' })).length).toBe(0);
    await w.worker('2026-11-24T10:30'); // Salı: 2 iş günü
    const c = await w.card('outbound_message', { projectId: p.id, who: 'clerk' });
    expect(c.detail.reason).toBe('no_response');
    expect((await ownerSql('SELECT status FROM message_drafts WHERE id = $1', [c.detail.draftId]))[0].status).toBe('pending_approval');
    await w.worker('2026-11-25T10:30');
    expect((await w.cards({ kind: 'outbound_message', projectId: p.id, who: 'clerk' })).length).toBe(1); // idempotent
    await w.worker('2026-11-29T10:30'); // opsiyon 2026-12-01 − 2 gün
    const urgent = (await w.cards({ kind: 'outbound_message', projectId: p.id, who: 'clerk' })).find((x) => x.detail.reason === 'option_expiring');
    expect(urgent.urgent).toBe(true);
  });

  it('S4-06 §7.4 tedarikçi opsiyon alarmı: seçili teklifin opsiyonu dolmak üzere → görev + uzatma talebi taslağı (onaya, güvenli referans)', async () => {
    const w = await makeWorld(S, 's4c');
    const p = await w.flow().intake(REQUEST_TEXT, { customer: 'trusted' }).offers({ accommodation: { moda: { price: 105, optionUntil: '2026-11-24' } }, hall: { moda: 1300 } });
    await w.worker('2026-11-22T09:30');
    expect((await p.tasks('option_expiry')).length).toBe(1);
    const c = (await w.cards({ kind: 'outbound_message', projectId: p.id, who: 'clerk' })).find((x) => x.detail.optionUntil === '2026-11-24');
    expect(c.urgent).toBe(true);
    expect(c.draft.body).not.toMatch(/ANADOLU|Anadolu/);
    const before = w.mails.length;
    await w.decide(c, 'approve', { who: 'clerk' });
    expect(w.mailsSince(before)[0]).toMatchObject({ to: 'satis@moda.example.com' });
  });

  it('S4-07 §7.4 kayıp nedeni zorunlu; açık (kararsız) proje kapatılamaz; kayıp + neden → kapanır', async () => {
    const w = await world();
    const p = await w.flow().intake();
    expect((await w.admin.post(`/api/projects/${p.id}/close`, {})).body.error.code).toBe('PROJECT_OPEN');
    expect((await w.clerk.post(`/api/projects/${p.id}/outcome`, { outcome: 'lost', lostReason: '   ' })).body.error.code).toBe('LOST_REASON_REQUIRED');
    await p.flow().lost('Rakip acentaya gitti');
    expect((await w.admin.post(`/api/projects/${p.id}/close`, {})).body).toMatchObject({ outcome: 'lost', step: 8 });
  });

  it('S4-08 §7.4 kaybedilen projede gönderilmiş teklif için takip taslağı üretilmez', async () => {
    const w = await makeWorld(S, 's4d');
    const p = await sent(w);
    await p.flow().as('clerk').lost('Müşteri etkinliği iptal etti');
    await w.worker('2026-11-24T10:30');
    await w.worker('2026-11-29T10:30');
    expect((await w.cards({ kind: 'outbound_message', projectId: p.id, who: 'admin' })).length).toBe(0);
    void clock;
  });
});
